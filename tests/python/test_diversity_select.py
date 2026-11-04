"""Synthetic selector-contract tests; no model runs, real road data or AI labels."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('diversity_select', ROOT / 'scripts/recognition-lab/diversity-select.py')
ds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ds)
KEYS = ['cat','fish','dog','rabbit','bird','whale','turtle','elephant','giraffe','butterfly','duck',
        'house','tree','car','rocket','apple','crown','airplane','mug','tshirt','pants','hammer','bottle','key','chair']
ALIASES = {'turtle': ['sea_turtle'], 'mug': ['coffee_cup'], 'tshirt': ['t-shirt'], 'bottle': ['wine_bottle']}


class DiversitySelectTests(unittest.TestCase):
    def setUp(self):
        rows, slots = [], []
        for area in ('a', 'b', 'c'):
            for key in KEYS:
                identifier = f'{area}-{key}'
                row = {'id': identifier, 'area': area, 'proposalShape': key, 'proposalPoolRank': 1,
                       'path': [1, 2, 3, 1], 'xy': [[0,0],[1,0],[1,1],[0,0]],
                       'latlon': [[37,127],[37.01,127],[37.01,127.01],[37,127]],
                       'meters': 4000., 'repeatRatio': 0, 'generatorPlacement': {'rotDeg': 30},
                       'arbitrarySource': {'list': [1,2]}}
                rows.append(row)
                slots.append({'area': area, 'proposalShape': key, 'category': 'animal' if key in KEYS[:11] else 'object',
                              'id': identifier, 'proposalPoolRank': 1, 'validRoad': True})
        while len(rows) < 1003:
            rows.append({**copy.deepcopy(rows[0]), 'id': f'natural-{len(rows)}', 'proposalShape': None})
        self.source = {'status': 'complete', 'results': rows, 'reviewSlots': slots,
                       'counts': [{'generation': 'keep'}], 'provenance': {'frozen': 'unchanged'}}
        self.pred = {'outputs': [{**copy.deepcopy(r), 'accepted': False, 'predictedClass': 'square',
                                 'rankingScore': .5, 'margin': .5, 'rotation': 60.} for r in rows],
                     'method': 'sketch-head-v10', 'mode': 'head'}
        self.catalog = {'catalog': [{'key': k, 'aliases': ALIASES.get(k, [k]), 'headSupported': k != 'rocket'} for k in KEYS]}

    def run_select(self):
        source_sha = ds.digest(ds.canonical(self.source).encode())
        self.pred['inputSHA256'] = source_sha
        return ds.select_records(self.source, self.pred, self.catalog, source_sha, 'b'*64, 'c'*64)

    def accept(self, identifier, label, **fields):
        record = next(r for r in self.pred['outputs'] if r['id'] == identifier)
        record.update(accepted=True, predictedClass=label, **fields)

    def test_aliases_absolute_rotation_and_rocket_abstention_preserve75(self):
        for key, label in [('turtle','sea_turtle'),('mug','coffee_cup'),('tshirt','t-shirt'),('bottle','wine_bottle')]:
            self.accept('a-'+key, label, rotation=60.)
        for area in ('a', 'b', 'c'):
            self.accept(area+'-rocket', 'house', rankingScore=100.)
        source = copy.deepcopy(self.source)
        out = self.run_select()
        self.assertEqual(out['selectionCounts']['requests'], 75)
        self.assertEqual(out['selectionCounts']['selected'], 4)
        self.assertEqual(out['selectionCounts']['unsupportedRequests'], 3)
        self.assertEqual(out['selectedDisplayRotations']['a-turtle'], 60.)  # NOT 60-30
        self.assertEqual(out['results'], source['results'])
        self.assertEqual(out['counts'], source['counts'])
        self.assertEqual(out['provenance'], source['provenance'])
        for slot in out['reviewSlots']:
            if slot['proposalShape'] == 'rocket':
                self.assertIsNone(slot['id'])
                self.assertFalse(slot['validRoad'])
                self.assertTrue(slot['generationValidRoad'])
                self.assertEqual(slot['selectionReason'], 'unsupported_training_class:rocket')
        self.assertEqual(self.source, source)
        out['results'][0]['arbitrarySource']['list'].append(3)
        self.assertEqual(self.source, source)

    def test_prediction_hash_mismatch_and_exact_coverage_fail(self):
        with self.assertRaisesRegex(ValueError, 'inputSHA256'):
            ds.select_records(self.source, {**self.pred, 'inputSHA256': 'wrong'}, self.catalog, 'a'*64, 'b'*64, 'c'*64)
        for change in ('missing', 'duplicate', 'extra'):
            with self.subTest(change=change):
                pred = copy.deepcopy(self.pred)
                pred['inputSHA256'] = 'a'*64
                if change == 'missing': pred['outputs'].pop()
                if change == 'duplicate': pred['outputs'][-1] = copy.deepcopy(pred['outputs'][0])
                if change == 'extra': pred['outputs'].append({**copy.deepcopy(pred['outputs'][0]), 'id': 'not-in-source'})
                with self.assertRaises(ValueError):
                    ds.select_records(self.source, pred, self.catalog, 'a'*64, 'b'*64, 'c'*64)

    def test_changed_or_missing_original_coordinates_and_metadata_fail(self):
        for field in ('xy', 'path', 'latlon', 'meters', 'generatorPlacement', 'arbitrarySource'):
            with self.subTest(field=field):
                original = copy.deepcopy(self.pred['outputs'][0])
                self.pred['outputs'][0][field] = 'changed'
                with self.assertRaisesRegex(ValueError, field): self.run_select()
                self.pred['outputs'][0] = original
        del self.pred['outputs'][0]['latlon']
        with self.assertRaisesRegex(ValueError, 'latlon'): self.run_select()

    def test_finite_score_ties_use_id_not_source_order_and_margin_fallback(self):
        for index, identifier in [(75, 'tie-z'), (76, 'tie-a')]:
            self.source['results'][index].update(id=identifier, area='a', proposalShape='house')
            self.pred['outputs'][index] = {**copy.deepcopy(self.source['results'][index]), 'accepted': True,
                'predictedClass': 'house', 'margin': .7, 'rotation': 17.25}
        out = self.run_select()
        slot = next(s for s in out['reviewSlots'] if s['area'] == 'a' and s['proposalShape'] == 'house')
        self.assertEqual(slot['id'], 'tie-a')
        self.assertEqual(slot['selectionScoreField'], 'margin')
        self.assertEqual(out['selectedDisplayRotations']['tie-a'], 17.25)

    def test_invalid_score_or_rotation_is_not_selected_and_reason_is_explicit(self):
        self.accept('a-house', 'house', rankingScore=float('nan'))
        self.accept('a-tree', 'tree', rotation=float('inf'))
        self.accept('a-car', 'car', rankingScore=True)
        out = self.run_select()
        by_key = {s['proposalShape']: s for s in out['reviewSlots'] if s['area'] == 'a'}
        self.assertEqual(by_key['house']['selectionReason'], 'no_finite_candidate_score')
        self.assertEqual(by_key['tree']['selectionReason'], 'no_finite_display_rotation')
        self.assertIsNone(by_key['car']['id'])
        self.assertEqual(out['selectionCounts']['abstentions'], 75)

    def test_wrong_intent_or_other_area_cannot_fill_a_request(self):
        self.accept('a-cat', 'dog')
        self.accept('b-cat', 'cat')
        out = self.run_select()
        a = next(s for s in out['reviewSlots'] if s['area'] == 'a' and s['proposalShape'] == 'cat')
        b = next(s for s in out['reviewSlots'] if s['area'] == 'b' and s['proposalShape'] == 'cat')
        self.assertIsNone(a['id'])
        self.assertEqual(a['selectionReason'], 'no_accepted_target_match')
        self.assertEqual(b['id'], 'b-cat')

    def test_old_catalog_or_incomplete_grid_is_rejected(self):
        self.catalog['catalog'][0]['headSupported'] = False
        with self.assertRaisesRegex(ValueError, 'v12 catalog'): self.run_select()
        self.catalog['catalog'][0]['headSupported'] = True
        self.source['reviewSlots'].pop()
        with self.assertRaisesRegex(ValueError, '75'): self.run_select()

    def test_class_metadata_prevents_using_old_model_and_fingerprint_is_isolated(self):
        self.pred['classLabels'] = [{'name': 'house', 'key': 'house', 'object': True},
                                    {'name': 'square', 'key': 'square', 'object': False}]
        with self.assertRaisesRegex(ValueError, 'does not support'): self.run_select()
        del self.pred['classLabels']
        first = self.run_select()
        second = self.run_select()
        self.assertEqual(first['selection']['fingerprint'], second['selection']['fingerprint'])
        self.assertFalse(first['selection']['predictionClassSupportVerified'])
        h = self.pred['inputSHA256']
        different = ds.select_records(self.source, self.pred, self.catalog, h, 'd'*64, 'c'*64)
        self.assertNotEqual(first['selection']['fingerprint'], different['selection']['fingerprint'])
        self.pred['mode'] = 'prototype'
        self.assertEqual(self.run_select()['selection']['predictionMode'], 'prototype')

    def test_full_model_support_metadata_and_highest_score_selection(self):
        self.pred['classLabels'] = [{'name': ALIASES.get(k, [k])[0], 'object': True} for k in KEYS if k != 'rocket']
        self.pred['classLabels'].append({'name': 'square', 'object': False})
        self.accept('a-house', 'house', rankingScore=.8, rotation=101.5)
        for index, identifier, score in [(75, 'lower-a', .5), (76, 'winner-z', .9)]:
            self.source['results'][index].update(id=identifier, area='a', proposalShape='house')
            self.pred['outputs'][index] = {**copy.deepcopy(self.source['results'][index]), 'accepted': True,
                'predictedClass': 'house', 'rankingScore': score, 'rotation': 17.25}
        out = self.run_select()
        slot = next(s for s in out['reviewSlots'] if s['area'] == 'a' and s['proposalShape'] == 'house')
        self.assertEqual(slot['id'], 'winner-z')
        self.assertTrue(out['selection']['predictionClassSupportVerified'])
        self.pred['outputs'][0]['predictedClass'] = 'not-in-model'
        with self.assertRaisesRegex(ValueError, 'absent from'):
            self.run_select()


if __name__ == '__main__':
    unittest.main()
