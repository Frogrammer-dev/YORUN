"""Frozen v12 intent-matching selection, one selected hypothesis/abstention per75 requests.

--input complete1003.json --predictions ranked.json --catalog catalog-v12.json --output selected.json
No inference, coordinate edits, threshold fitting or cross-request slot removal.
predictions.rotation is ALREADY absolute; the exporter consumes selectedDisplayRotations.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path

POLICY = 'v12-intent-matching-top1-per-area-species-finite-margin-id-tie-absolute-view'


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def unique_rows(rows, label):
    if not isinstance(rows, list) or any(not isinstance(r, dict) or not isinstance(r.get('id'), str) or not r['id'] for r in rows):
        raise ValueError(f'{label} must contain rows with nonempty string IDs')
    lookup = {r['id']: r for r in rows}
    if len(lookup) != len(rows):
        raise ValueError(f'Duplicate {label} ID')
    return lookup


def select_records(source, predictions, catalog_data, source_sha, predictions_sha, catalog_sha):
    if source.get('status') != 'complete' or len(source.get('results', [])) != 1003:
        raise ValueError('Expected complete frozen1003 source rows')
    if predictions.get('inputSHA256') != source_sha:
        raise ValueError('Prediction inputSHA256 does not match source bytes')
    original = unique_rows(source['results'], 'source')
    pred = unique_rows(predictions.get('outputs'), 'prediction')
    if set(pred) != set(original):
        raise ValueError('Predictions must cover every source ID exactly once, without extras')
    for identifier, row in original.items():
        for field, value in row.items():
            if field not in pred[identifier] or canonical(pred[identifier][field]) != canonical(value):
                raise ValueError(f'Prediction changed/missed source field: {identifier}.{field}')
        if type(pred[identifier].get('accepted')) is not bool or not isinstance(pred[identifier].get('predictedClass'), str):
            raise ValueError('Prediction accepted/class fields are invalid')
    slots = source.get('reviewSlots')
    if not isinstance(slots, list) or len(slots) != 75:
        raise ValueError('Exactly75 frozen request slots are required')
    pairs = [(s['area'], s['proposalShape']) for s in slots]
    if len(set(pairs)) != 75:
        raise ValueError('Duplicate area/species request slot')
    keys, areas = {p[1] for p in pairs}, {p[0] for p in pairs}
    if len(keys) != 25 or len(areas) != 3 or set(pairs) != {(a, k) for a in areas for k in keys}:
        raise ValueError('Request grid must contain all25 species across all3 areas')
    raw_catalog = catalog_data.get('catalog')
    if not isinstance(raw_catalog, list) or len(raw_catalog) != 25:
        raise ValueError('Expected frozen25-kind catalog')
    catalog = {r['key']: r for r in raw_catalog}
    if len(catalog) != 25 or set(catalog) != keys:
        raise ValueError('Catalog keys must match the full request grid exactly')
    for key, item in catalog.items():
        aliases = item.get('aliases')
        if not isinstance(aliases, list) or not aliases or any(not isinstance(a, str) or not a.strip() or a != a.strip() for a in aliases) or len(set(aliases)) != len(aliases):
            raise ValueError(f'Invalid frozen aliases for {key}')
        if type(item.get('headSupported')) is not bool:
            raise ValueError(f'Missing explicit headSupported flag: {key}')
        if item['headSupported'] != (key != 'rocket'):
            raise ValueError('v12 requires24 supported targets and unsupported rocket; use the v12 catalog, not v11 coverage')
    if 'rocket' not in keys:
        raise ValueError('The three unsupported rocket requests must remain in the grid')
    # Optional class metadata provides an additional guard against accidentally using a v10 model.
    class_support_verified = 'classLabels' in predictions
    if class_support_verified:
        classes = predictions['classLabels']
        class_keys = [c.get('key', c.get('name')) for c in classes]
        if any(not isinstance(k, str) or not k for k in class_keys) or len(set(class_keys)) != len(class_keys):
            raise ValueError('Prediction class metadata has missing/duplicate keys')
        if any(r['predictedClass'] not in class_keys for r in pred.values()):
            raise ValueError('A predicted class is absent from the prediction model metadata')
        supported = {c.get('key', c.get('name')) for c in classes if c.get('object') is True}
        for key, item in catalog.items():
            if item['headSupported'] and not supported.intersection(item['aliases']):
                raise ValueError(f'Prediction model does not support required v12 target: {key}')
        if 'rocket' in supported:
            raise ValueError('Unexpected trained rocket class conflicts with the frozen v12 acquisition failure')

    selected_slots, rotations, request_counts = [], {}, []
    for slot in slots:
        area, key = slot['area'], slot['proposalShape']
        candidates = [r for r in source['results'] if r.get('area') == area and r.get('proposalShape') == key]
        tally = {'area': area, 'proposalShape': key, 'candidates': len(candidates), 'rejected': 0,
                 'intentMismatch': 0, 'invalidScore': 0, 'invalidRotation': 0, 'eligible': 0}
        eligible = []
        unsupported = key == 'rocket'  # always retained as an abstention, never replaced by a different object
        if not unsupported:
            for row in candidates:
                result = pred[row['id']]
                if not result['accepted']:
                    tally['rejected'] += 1
                    continue
                if result['predictedClass'] not in catalog[key]['aliases']:
                    tally['intentMismatch'] += 1
                    continue
                score_field = 'rankingScore' if 'rankingScore' in result else 'margin'
                score = result.get(score_field)
                if not finite_number(score):
                    tally['invalidScore'] += 1
                    continue
                rotation = result.get('rotation')
                if not finite_number(rotation):
                    tally['invalidRotation'] += 1
                    continue
                eligible.append((float(score), row['id'], row, result, score_field))
        eligible.sort(key=lambda t: (-t[0], t[1]))
        tally['eligible'] = len(eligible)
        if eligible:
            score, identifier, row, result, score_field = eligible[0]
            reason = 'accepted target match; highest finite score; lexical ID tie'
            updated = {**copy.deepcopy(slot), 'id': identifier, 'proposalPoolRank': row.get('proposalPoolRank'),
                       'validRoad': True, 'selectionReason': reason, 'selectionScore': score,
                       'selectionScoreField': score_field, 'selectedPredictedClass': result['predictedClass']}
            rotations[identifier] = result['rotation']  # absolute angle, no second generator-angle subtraction
        else:
            reason = ('unsupported_training_class:rocket' if unsupported else
                      'no_candidates_for_request' if not candidates else
                      'no_finite_display_rotation' if tally['invalidRotation'] else
                      'no_finite_candidate_score' if tally['invalidScore'] else
                      'no_accepted_target_match' if tally['intentMismatch'] else 'all_candidates_rejected')
            updated = {**copy.deepcopy(slot), 'id': None, 'proposalPoolRank': None, 'validRoad': False,
                       'selectionReason': reason, 'selectionScore': None, 'selectionScoreField': None,
                       'selectedPredictedClass': None}
        updated['generationValidRoad'] = slot.get('validRoad')
        updated['selection'] = POLICY
        selected_slots.append(updated)
        request_counts.append({**tally, 'unsupported': unsupported, 'selectedId': updated['id'], 'reason': reason})
    identity = {'sourceSHA256': source_sha, 'predictionsSHA256': predictions_sha, 'catalogSHA256': catalog_sha, 'policy': POLICY}
    selection = {**identity, 'fingerprint': digest(canonical(identity).encode('utf-8')),
                 'predictionMethod': predictions.get('method'), 'predictionMode': predictions.get('mode'),
                 'predictionClassSupportVerified': class_support_verified,
                 'displayRotationMeaning': 'absolute predictions.rotation; already includes negative generator placement angle',
                 'sourceRowsChanged': False, 'generationCountsChanged': False, 'thresholdFitted': False,
                 'globalGeometryDedupApplied': False, 'humanRecognitionMeasured': False,
                 'unsupportedRequestsRemainInDenominator': True}
    summary = {'requests': 75, 'selected': sum(s['id'] is not None for s in selected_slots),
               'abstentions': sum(s['id'] is None for s in selected_slots),
               'unsupportedRequests': sum(c['unsupported'] for c in request_counts),
               'byRequest': request_counts, 'recognitionMeasured': False}
    return {**copy.deepcopy(source), 'reviewSlots': selected_slots, 'selectedDisplayRotations': rotations,
            'selection': selection, 'selectionCounts': summary}


def read_json(path):
    raw = Path(path).read_bytes()
    def invalid(value):
        raise ValueError('Nonfinite JSON number: ' + value)
    return raw, json.loads(raw, parse_constant=invalid)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('input', 'predictions', 'catalog', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Refusing to overwrite an existing selection')
    source_raw, source = read_json(args.input)
    pred_raw, predictions = read_json(args.predictions)
    catalog_raw, catalog = read_json(args.catalog)
    selected = select_records(source, predictions, catalog, digest(source_raw), digest(pred_raw), digest(catalog_raw))
    selected['selection']['selectorCodeSHA256'] = digest(Path(__file__).read_bytes())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(selected, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write('\n')
    print(json.dumps({k: selected['selectionCounts'][k] for k in ('requests', 'selected', 'abstentions', 'unsupportedRequests')}), flush=True)


if __name__ == '__main__':
    main()
