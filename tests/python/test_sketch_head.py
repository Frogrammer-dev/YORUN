"""Pure synthetic unit tests; no Quick Draw/road data, network, training artifacts or AI labels."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest import mock
from types import SimpleNamespace

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('sketch_head', ROOT / 'scripts/recognition-lab/sketch-head.py')
sh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sh)


def synthetic_dataset():
    labels = [{'name': 'coffee cup', 'object': True}, {'name': 'hammer', 'object': True}, {'name': 'square', 'object': False}]
    records, x = [], []
    for split in sh.SPLITS:
        for c in range(3):
            for j in range(2):
                records.append({'id': f'{split}-{c}-{j}', 'classIndex': c, 'split': split})
                x.append(np.eye(5)[c])
    dataset = {'classes': labels, 'records': records}
    labels, y, splits = sh.validate_dataset(dataset)
    return dataset, labels, np.array(x), y, splits


class SketchHeadTests(unittest.TestCase):
    def test_class_source_words_keys_and_flags_preserved(self):
        labels = sh.class_labels([{'name': 'wine bottle', 'object': True}, {'name': 't-shirt', 'object': True}, {'name': 'line', 'object': False}])
        self.assertEqual([c['key'] for c in labels], ['wine_bottle', 't-shirt', 'line'])
        self.assertEqual(labels[0]['name'], 'wine bottle')
        with self.assertRaises(ValueError):
            sh.class_labels([{'name': 'a', 'object': True}, {'name': 'a', 'object': False}])

    def test_dataset_rejects_duplicate_ids_cross_split_groups_and_missing_class(self):
        data, *_ = synthetic_dataset()
        duplicate = copy.deepcopy(data)
        duplicate['records'][1]['id'] = duplicate['records'][0]['id']
        with self.assertRaises(ValueError):
            sh.validate_dataset(duplicate)
        groups = copy.deepcopy(data)
        groups['records'][0]['groupHash'] = groups['records'][6]['groupHash'] = 'same-original'
        with self.assertRaises(ValueError):
            sh.validate_dataset(groups)
        groups = copy.deepcopy(data)
        groups['records'][0]['groupSHA256'] = groups['records'][6]['groupSHA256'] = 'official-source-group'
        with self.assertRaises(ValueError):
            sh.validate_dataset(groups)
        missing = copy.deepcopy(data)
        missing['records'] = [r for r in missing['records'] if not (r['split'] == 'val' and r['classIndex'] == 2)]
        with self.assertRaises(ValueError):
            sh.validate_dataset(missing)

    def test_features_dynamic_dimensions_and_order_and_mean_contract(self):
        views = np.tile(np.eye(5)[:2, None, :], (1, 4, 1)).astype('float32')
        stream = io.BytesIO()
        np.savez(stream, features=views, mean=views[:, 0], ids=np.array(['a', 'b']))
        stream.seek(0)
        v, m, verified = sh.load_features(stream, ['a', 'b'])
        self.assertEqual(v.shape, (2, 4, 5))
        self.assertEqual(m.shape, (2, 5))
        self.assertTrue(verified)
        stream.seek(0)
        with self.assertRaises(ValueError):
            sh.load_features(stream, ['b', 'a'])
        broken = io.BytesIO()
        np.savez(broken, features=views, mean=views[::-1, 0])
        broken.seek(0)
        with self.assertRaises(ValueError):
            sh.load_features(broken, ['a', 'b'])

    def test_balanced_ridge_unpenalized_bias_and_class_replication(self):
        # All inputs identical: an unpenalized intercept learns uniform class targets
        # despite 9:1 class imbalance. Ridge must not be sample-count biased.
        x = np.ones((10, 3))
        y = np.array([0] * 9 + [1])
        w, b, cw = sh.fit_ridge(x, y, 2, 10.)
        np.testing.assert_allclose(x @ w + b, .5, atol=1e-12)
        np.testing.assert_allclose(cw, [10 / 18, 5])
        np.testing.assert_allclose(w, 0, atol=1e-12)

    def test_prototype_is_normalized_train_class_mean(self):
        x = np.array([[1., 0, 0], [0, 1, 0], [0, 0, 1.]])
        w = sh.fit_prototype(x, np.array([0, 0, 1]), 2)
        np.testing.assert_allclose(w[:, 0], [2 ** -.5, 2 ** -.5, 0])
        np.testing.assert_allclose(w[:, 1], [0, 0, 1])

    def test_test_features_labels_cannot_change_lambda_weights_or_gate(self):
        _, labels, x, y, splits = synthetic_dataset()
        first = sh.fit_experiment(x, y, splits, labels)
        x2, y2 = x.copy(), y.copy()
        x2[splits == 'test'] = -x2[splits == 'test']
        y2[splits == 'test'] = (y2[splits == 'test'] + 1) % 3
        second = sh.fit_experiment(x2, y2, splits, labels)
        for mode in ('head', 'prototype'):
            np.testing.assert_array_equal(first[mode]['weights'], second[mode]['weights'])
            np.testing.assert_array_equal(first[mode]['bias'], second[mode]['bias'])
            self.assertEqual(first[mode]['policy'], second[mode]['policy'])
        self.assertEqual(first['head']['lambda'], 10.)  # equal validation accuracy: largest lambda
        self.assertEqual(first['lambdaGrid'], second['lambdaGrid'])

    def test_gate_generic_winner_rejects_and_ties_use_class_index(self):
        logits = np.array([[1., 1., 0.], [.1, .2, .8]])
        pred, margin, accepted = sh.decisions(logits, [True, True, False], {'rejectAll': False, 'marginThreshold': 0})
        np.testing.assert_array_equal(pred, [0, 2])
        np.testing.assert_array_equal(accepted, [True, False])
        self.assertEqual(margin[0], 0.)

    def test_validation_gate_enforces_generic_far_and_tie_prefers_higher_margin(self):
        logits = np.array([[.9, .1, 0], [.1, .9, 0], [.8, .1, .6]])
        policy = sh.calibrate(logits, np.array([0, 1, 2]), np.array([True, True, False]))
        self.assertEqual(policy['marginThreshold'], .8)
        self.assertEqual(policy['validationGenericFalseAccept'], 0)
        self.assertEqual(policy['validationMacroAcceptedCorrectRecall'], 1)

    def test_all_reject_is_explicit_json_safe_and_not_reported_as_probability(self):
        logits = np.array([[0., 0., 1.], [0., 0., 1.], [0., 0., 1.]])
        policy = sh.calibrate(logits, np.array([0, 1, 2]), np.array([True, True, False]))
        self.assertTrue(policy['rejectAll'])
        self.assertIsNone(policy['marginThreshold'])
        self.assertFalse(policy['humanProbabilityCalibrated'])

    def test_rank_preserves_every_source_field_and_pooled_prediction_controls_display(self):
        labels = sh.class_labels([{'name': 'hammer', 'object': True}, {'name': 'square', 'object': False}])
        row = {'id': 'road-a', 'area': 'frozen', 'xy': [[0, 0], [1, 0], [0, 0]],
               'path': [1, 2, 1], 'latlon': [[37, 127], [37.1, 127], [37, 127]],
               'meters': 4000, 'repeatRatio': .1, 'proposalShape': 'hammer',
               'generatorPlacement': {'rotDeg': 30}, 'arbitraryMetadata': {'nested': [1, 2]}}
        model = {'weights': np.eye(2), 'bias': np.array([.1, 0]), 'policy': {'rejectAll': False, 'marginThreshold': .03}}
        views = np.array([[[.8, .2], [.9, .1], [.9, .1], [.1, .9]]])
        means = np.array([[.8, .2]])
        original = copy.deepcopy(row)
        out = sh.rank_records([row], views, means, model, labels)[0]
        self.assertEqual(out['predictedClass'], 'hammer')
        self.assertAlmostEqual(out['score'], .7)
        self.assertEqual(out['displayViewIndex'], 1)  # view1/view2 tie: first
        self.assertEqual(out['rotation'], 60.)
        self.assertTrue(out['intentAgreement'])
        for k, value in original.items():
            self.assertEqual(out[k], value)
        out['arbitraryMetadata']['nested'].append(3)
        self.assertEqual(row, original)
        with self.assertRaises(ValueError):
            sh.rank_records([{**row, 'score': 10}], views, means, model, labels)

    def test_checkpoint_roundtrip_without_pickle_preserves_models_and_labels(self):
        _, labels, x, y, splits = synthetic_dataset()
        state = sh.fit_experiment(x, y, splits, labels)
        metadata = {'dimensions': 5, 'classLabels': labels, 'models': {m: {'policy': state[m]['policy']} for m in ('head', 'prototype')}}
        stream = io.BytesIO()
        sh.save_checkpoint(stream, state, metadata)
        stream.seek(0)
        models, restored = sh.load_checkpoint(stream)
        self.assertEqual(restored, metadata)
        for m in models:
            np.testing.assert_array_equal(models[m]['weights'], state[m]['weights'])
            np.testing.assert_array_equal(models[m]['bias'], state[m]['bias'])

    def test_full_text_baseline_cannot_promote_a_target_when_an_outside_class_wins(self):
        stream = io.BytesIO()
        np.savez(stream, textFeatures=np.array([[.8, .6], [0, 1], [1, 0]], dtype='float32'),
                 textClasses=np.array(['hammer', 'line', 'outside_object']), textExcluded=np.array([False, True, False]))
        stream.seek(0)
        labels = sh.class_labels([{'name': 'hammer', 'object': True}, {'name': 'line', 'object': False}])
        result = sh.text_baseline(stream, np.array([[1., 0], [0, 1.], [1, 0.], [0, 1.]]),
                                  np.array([0, 1, 0, 1]), np.array(['val', 'val', 'test', 'test']), labels)
        self.assertEqual(result['vocabularySize'], 3)
        self.assertEqual(result['test']['macroAccuracy'], .5)
        self.assertEqual(result['test']['objectMacroAcceptedCorrectRecall'], 0)
        self.assertEqual(result['test']['genericFalseAccept'], 0)

    def test_extractor_sidecar_binds_features_to_source_json(self):
        meta = {'datasetSHA256': 'dataset-hash', 'featuresSHA256': 'features-hash'}
        def digest(path):
            return {'dataset.json': 'dataset-hash', 'features.npz': 'features-hash'}.get(Path(path).name, 'metadata-hash')
        with mock.patch.object(Path, 'exists', return_value=True), mock.patch.object(Path, 'read_text', return_value=json.dumps(meta)), mock.patch.object(sh, 'sha', side_effect=digest):
            result = sh.feature_provenance(Path('features.npz'), Path('dataset.json'), 'dataset')
            self.assertTrue(result['sidecarVerified'])
        meta['datasetSHA256'] = 'different-dataset'
        with mock.patch.object(Path, 'exists', return_value=True), mock.patch.object(Path, 'read_text', return_value=json.dumps(meta)), mock.patch.object(sh, 'sha', side_effect=digest):
            with self.assertRaises(ValueError):
                sh.feature_provenance(Path('features.npz'), Path('dataset.json'), 'dataset')

    def test_explicit_missing_sidecar_is_not_silently_ignored(self):
        with mock.patch.object(Path, 'exists', return_value=False):
            with self.assertRaises(ValueError):
                sh.feature_provenance(Path('features.npz'), Path('dataset.json'), 'dataset', Path('missing.json'))

    def test_feature_compatibility_accepts_matching_extractor_and_explicit_null_revision(self):
        extractor = {'checkpoint': 'encoder-a', 'revision': None, 'rendererCodeSHA256': 'a' * 64, 'rotations': 4}
        training = {'views': 4, 'featureProvenance': {'sidecarVerified': True, 'extractorMetadata': extractor}}
        road = {'sidecarVerified': True, 'extractorMetadata': copy.deepcopy(extractor)}
        before = copy.deepcopy((training, road))
        result = sh.verify_feature_compatibility(training, road)
        self.assertTrue(result['verified'])
        self.assertFalse(result['revisionPinned'])
        self.assertFalse(result['weightFileHashesVerified'])
        self.assertEqual((training, road), before)
        training['featureProvenance']['extractorMetadata']['revision'] = 'frozen-revision'
        road['extractorMetadata']['revision'] = 'frozen-revision'
        self.assertTrue(sh.verify_feature_compatibility(training, road)['revisionPinned'])

    def test_feature_compatibility_rejects_same_dimensional_different_encoder_recipe(self):
        extractor = {'checkpoint': 'encoder-a', 'revision': 'rev-a', 'rendererCodeSHA256': 'a' * 64, 'rotations': 4}
        training = {'views': 4, 'dimensions': 512, 'featureProvenance': {'sidecarVerified': True, 'extractorMetadata': extractor}}
        for field, wrong in [('checkpoint', 'encoder-b'), ('revision', 'rev-b'),
                             ('rendererCodeSHA256', 'b' * 64), ('rotations', 8), ('rotations', 4.0)]:
            with self.subTest(field=field, wrong=wrong):
                road = {'sidecarVerified': True, 'extractorMetadata': {**extractor, field: wrong}}
                with self.assertRaisesRegex(ValueError, field):
                    sh.verify_feature_compatibility(training, road)

    def test_feature_compatibility_requires_both_verified_sidecars_and_all_identity_fields(self):
        extractor = {'checkpoint': 'encoder-a', 'revision': None, 'rendererCodeSHA256': 'a' * 64, 'rotations': 4}
        training = {'views': 4, 'featureProvenance': {'sidecarVerified': True, 'extractorMetadata': extractor}}
        road = {'sidecarVerified': True, 'extractorMetadata': copy.deepcopy(extractor)}
        for side in ('training', 'road'):
            with self.subTest(side=side):
                bad_train, bad_road = copy.deepcopy(training), copy.deepcopy(road)
                if side == 'training':
                    bad_train['featureProvenance'] = {'sidecarVerified': False}
                else:
                    bad_road = {'sidecarVerified': False}
                with self.assertRaises(ValueError):
                    sh.verify_feature_compatibility(bad_train, bad_road)
        for field in extractor:
            with self.subTest(missing=field):
                bad_road = copy.deepcopy(road)
                del bad_road['extractorMetadata'][field]
                with self.assertRaisesRegex(ValueError, field):
                    sh.verify_feature_compatibility(training, bad_road)

    def test_rank_cli_blocks_same_dimension_different_encoder_before_scoring_or_writing(self):
        extractor = {'checkpoint': 'encoder-a', 'revision': None, 'rendererCodeSHA256': 'a' * 64, 'rotations': 4}
        meta = {'dimensions': 512, 'views': 4, 'featureProvenance': {'sidecarVerified': True, 'extractorMetadata': extractor}}
        road_meta = {'sidecarVerified': True, 'extractorMetadata': {**extractor, 'checkpoint': 'encoder-b'}}
        args = SimpleNamespace(output=Path('ranked.json'), report=Path('report.json'), checkpoint=Path('models.npz'),
                               roads=Path('roads.json'), features=Path('roads.npz'), feature_metadata=None, mode='head')
        with mock.patch.object(Path, 'exists', return_value=False), \
                mock.patch.object(Path, 'read_bytes', return_value=b'{"status":"complete","results":[{"id":"r1"}]}'), \
                mock.patch.object(sh, 'load_checkpoint', return_value=({}, meta)), \
                mock.patch.object(sh, 'load_features', return_value=(np.zeros((1, 4, 512)), np.zeros((1, 512)), False)), \
                mock.patch.object(sh, 'feature_provenance', return_value=road_meta), \
                mock.patch.object(sh, 'rank_records') as score, mock.patch.object(sh, 'write_json') as write:
            with self.assertRaisesRegex(ValueError, 'checkpoint'):
                sh.rank_cli(args)
            score.assert_not_called()
            write.assert_not_called()


if __name__ == '__main__':
    unittest.main()
