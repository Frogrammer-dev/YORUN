"""Deterministic frozen-feature prototype/ridge experiment; no road labels in training.

train --features sketches.npz --dataset dataset.json --checkpoint models.npz
rank --features roads.npz --roads v9-proposals.json --checkpoint models.npz
     --mode head --output ranked-head.json

NPZ: features[N,4,D], mean[N,D], optional ids[N] (same order as JSON records).
Generic classes mean recommendation exclusions, NOT verified absence of objects.
All original road fields are preserved. No coordinates or features are predicted.
"""
import argparse
import copy
import hashlib
import json
import platform
from pathlib import Path
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
REPORTS = ROOT / 'reports/road-ranker-20261102'
LAMBDAS = (.01, .1, 1., 10.)
MARGINS = (0., .01, .03, .05, .1, .2, .4, .8, float('inf'))
SPLITS = ('train', 'val', 'test')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write('\n')


def normalize(x):
    x = np.asarray(x, dtype=np.float64)
    lengths = np.linalg.norm(x, axis=-1, keepdims=True)
    if not np.isfinite(x).all() or np.any(lengths <= 1e-10):
        raise ValueError('Cannot normalize nonfinite/zero vectors')
    return x / lengths


def load_features(source, expected_ids):
    """Validate supplied pooled features rather than silently recomputing/reordering them."""
    with np.load(source, allow_pickle=False) as pack:
        views, means = np.array(pack['features']), np.array(pack['mean'])
        if 'ids' in pack:
            if pack['ids'].ndim != 1 or pack['ids'].astype(str).tolist() != list(map(str, expected_ids)):
                raise ValueError('NPZ ids/order do not match the JSON records')
        ids_verified = 'ids' in pack
    if views.ndim != 3 or views.shape[1] != 4 or views.shape[2] < 1:
        raise ValueError('Expected features[N,4,D]')
    if views.dtype != np.float32 or means.dtype != np.float32:
        raise ValueError('Feature arrays must be float32')
    if means.shape != (len(expected_ids), views.shape[2]) or views.shape[0] != len(expected_ids) or not len(expected_ids):
        raise ValueError('Feature count/dimension mismatch')
    if not np.isfinite(views).all() or not np.isfinite(means).all():
        raise ValueError('Features must be finite')
    if not np.allclose(np.linalg.norm(views, axis=-1), 1, atol=3e-4, rtol=0):
        raise ValueError('Every per-view feature must have L2 norm 1')
    if not np.allclose(np.linalg.norm(means, axis=-1), 1, atol=3e-4, rtol=0):
        raise ValueError('Every pooled feature must have L2 norm 1')
    if not np.allclose(means, normalize(views.astype(np.float64).sum(1)), atol=1e-4, rtol=1e-4):
        raise ValueError('mean must equal normalize(sum of four views)')
    return views.astype(np.float64), means.astype(np.float64), ids_verified


def class_labels(raw):
    if len(raw) < 2:
        raise ValueError('At least two classes are required')
    labels = []
    for c in raw:
        if not isinstance(c.get('name'), str) or not c['name'].strip() or type(c.get('object')) is not bool:
            raise ValueError('Classes require a name and boolean object flag')
        # Quick Draw source words are retained; spaces become the existing vocabulary keys.
        key = c.get('key', c['name'].strip().replace(' ', '_'))
        if not isinstance(key, str) or not key.strip() or key != key.strip():
            raise ValueError('Class keys must be nonempty trimmed strings')
        labels.append({**copy.deepcopy(c), 'key': key})
    if len({c['key'] for c in labels}) != len(labels):
        raise ValueError('Class keys must be unique')
    if not any(c['object'] for c in labels) or all(c['object'] for c in labels):
        raise ValueError('Both object and generic exclusion classes are required')
    return labels


def validate_dataset(data):
    labels = class_labels(data['classes'])
    records = data['records']
    if not records or len({str(r['id']) for r in records}) != len(records):
        raise ValueError('Dataset record IDs must be nonempty and unique')
    groups = {}
    for r in records:
        if type(r['classIndex']) is not int or not 0 <= r['classIndex'] < len(labels) or r['split'] not in SPLITS:
            raise ValueError('Invalid classIndex/split')
        for field in ('groupSHA256', 'groupHash', 'hash', 'geometryHash'):
            if r.get(field):
                key = (field, str(r[field]))
                if key in groups and groups[key] != r['split']:
                    raise ValueError('A source geometry group crosses splits')
                groups[key] = r['split']
    y = np.array([r['classIndex'] for r in records], dtype=np.int64)
    splits = np.array([r['split'] for r in records])
    for s in SPLITS:
        if np.any(np.bincount(y[splits == s], minlength=len(labels)) == 0):
            raise ValueError(f'Every class needs at least one {s} record; do not silently drop a class')
    return labels, y, splits


def fit_ridge(x, y, count, ridge_lambda):
    """Weighted one-hot ridge with unpenalized bias; NO feature standardization.

    Per-sample w=N/(C*n_class), hence each class has total weight N/C.
    Objective: sum_i w_i ||[x_i,1] W - onehot_i||^2 + lambda ||W_without_bias||^2.
    """
    counts = np.bincount(y, minlength=count)
    if np.any(counts == 0) or ridge_lambda <= 0:
        raise ValueError('Ridge requires every training class and positive lambda')
    class_weights = len(y) / (count * counts.astype(np.float64))
    design = np.column_stack([x, np.ones(len(x))])
    targets = np.eye(count, dtype=np.float64)[y]
    weighted = design * class_weights[y, None]
    penalty = np.diag(np.r_[np.full(x.shape[1], ridge_lambda), 0.])
    solution = np.linalg.solve(design.T @ weighted + penalty, weighted.T @ targets)
    return solution[:-1], solution[-1], class_weights


def fit_prototype(x, y, count):
    return normalize(np.stack([x[y == c].mean(0) for c in range(count)])).T


def decisions(logits, object_mask, policy):
    logits = np.asarray(logits, dtype=np.float64)
    if logits.ndim != 2 or logits.shape[1] != len(object_mask) or not np.isfinite(logits).all():
        raise ValueError('Invalid class logits')
    predicted = logits.argmax(1)  # deterministic ties: smallest classIndex
    competing = logits.copy()
    competing[np.arange(len(logits)), predicted] = -np.inf
    margins = logits[np.arange(len(logits)), predicted] - competing.max(1)
    threshold = np.inf if policy['rejectAll'] else policy['marginThreshold']
    accepted = np.asarray(object_mask, dtype=bool)[predicted] & (margins >= threshold)
    return predicted, margins, accepted


def macro_accuracy(logits, y, count):
    return float(np.mean([(logits.argmax(1)[y == c] == c).mean() for c in range(count)]))


def calibrate(logits, y, object_mask):
    """VAL only. Generic FAR is micro over generic examples; recall is macro over objects."""
    objects = np.flatnonzero(object_mask)
    generic = ~np.asarray(object_mask, dtype=bool)[y]
    best, selected = None, None
    for margin in MARGINS:
        policy = {'rejectAll': bool(np.isinf(margin)), 'marginThreshold': None if np.isinf(margin) else margin}
        pred, _, accepted = decisions(logits, object_mask, policy)
        far = float(accepted[generic].mean())
        recall = float(np.mean([((pred == c) & accepted)[y == c].mean() for c in objects]))
        key = (recall, -far, margin)
        if far <= .1 + 1e-12 and (best is None or key > best):
            best = key
            selected = {**policy, 'validationMacroAcceptedCorrectRecall': recall,
                        'validationGenericFalseAccept': far, 'genericMeaning': 'exclusion classes, not real-road object absence',
                        'humanProbabilityCalibrated': False, 'realRoadRejectCalibrated': False}
    return selected


def metrics(logits, y, object_mask, policy):
    count = len(object_mask)
    predicted, _, accepted = decisions(logits, object_mask, policy)
    generic = ~np.asarray(object_mask, dtype=bool)[y]
    objects = ~generic
    return {'count': len(y), 'macroAccuracy': macro_accuracy(logits, y, count),
            'accuracy': float((predicted == y).mean()),
            'perClassCount': np.bincount(y, minlength=count).tolist(),
            'perClassAccuracy': [float((predicted[y == c] == c).mean()) for c in range(count)],
            'objectCoverage': float(accepted[objects].mean()),
            'objectMacroAcceptedCorrectRecall': float(np.mean([((predicted == c) & accepted)[y == c].mean() for c in np.flatnonzero(object_mask)])),
            'genericFalseAccept': float(accepted[generic].mean()),
            'acceptedCount': int(accepted.sum()), 'humanRecognitionMeasured': False}


def feature_provenance(feature_file, source_file, kind, metadata_file=None):
    """Check the extractor's optional sidecar: NPZ without ids otherwise aligns by row order."""
    if metadata_file is not None and not metadata_file.exists():
        raise ValueError('Explicit feature metadata file does not exist')
    metadata_file = metadata_file or feature_file.with_name(feature_file.stem + '-metadata.json')
    if not metadata_file.exists():
        return {'sidecarVerified': False, 'alignment': 'positional; NPZ ids checked separately if present'}
    meta = json.loads(metadata_file.read_text(encoding='utf-8'))
    if meta.get(kind + 'SHA256') != sha(source_file) or meta.get('featuresSHA256') != sha(feature_file):
        raise ValueError('Feature sidecar source/features hash mismatch')
    return {'sidecarVerified': True, 'metadataSHA256': sha(metadata_file), 'extractorMetadata': meta}


def verify_feature_compatibility(checkpoint_metadata, road_provenance):
    """Matching dimensions do not imply matching embedding coordinates.

    Both sidecars must already be bound to their NPZ/source hashes. Explicit null
    revisions may match (the current extractor contract), but missing keys cannot.
    A null revision does NOT independently prove identical encoder weight files.
    """
    training = checkpoint_metadata.get('featureProvenance')
    for label, provenance in (('training', training), ('road', road_provenance)):
        if not isinstance(provenance, dict) or provenance.get('sidecarVerified') is not True:
            raise ValueError(f'Missing verified {label} feature provenance; dimension-only ranking is unsafe')
        if not isinstance(provenance.get('extractorMetadata'), dict):
            raise ValueError(f'Missing {label} extractor metadata')
    train_meta, road_meta = training['extractorMetadata'], road_provenance['extractorMetadata']
    fields = ('checkpoint', 'revision', 'rendererCodeSHA256', 'rotations')
    for field in fields:
        if field not in train_meta or field not in road_meta:
            raise ValueError(f'Missing feature compatibility field: {field}')
        if type(train_meta[field]) is not type(road_meta[field]) or train_meta[field] != road_meta[field]:
            raise ValueError(f'Training/road feature compatibility mismatch: {field}')
    if not isinstance(train_meta['checkpoint'], str) or not train_meta['checkpoint'].strip():
        raise ValueError('Feature encoder checkpoint must be a nonempty string')
    if not isinstance(train_meta['rendererCodeSHA256'], str) or not train_meta['rendererCodeSHA256'].strip():
        raise ValueError('Feature renderer hash must be a nonempty string')
    if train_meta['revision'] is not None and (not isinstance(train_meta['revision'], str) or not train_meta['revision'].strip()):
        raise ValueError('Feature revision must be an explicit null or nonempty string')
    if type(train_meta['rotations']) is not int or train_meta['rotations'] != 4 or checkpoint_metadata.get('views') != 4:
        raise ValueError('Feature rotations must match the checkpoint four-view contract')
    return {'verified': True, 'comparedFields': list(fields),
            'extractorIdentity': {field: train_meta[field] for field in fields},
            'revisionPinned': train_meta['revision'] is not None,
            'weightFileHashesVerified': False,
            'limitation': 'Matching explicit null revisions do not independently prove encoder weight-file identity' if train_meta['revision'] is None else 'Weight-file hashes are not supplied by the extractor'}


def text_baseline(source, means, y, splits, labels):
    """Optional full-vocabulary text reference supplied by the frozen feature extractor.

    Never restrict its winner to the training classes or use it for head/gate selection.
    """
    with np.load(source, allow_pickle=False) as pack:
        fields = ('textFeatures', 'textClasses', 'textExcluded')
        if not any(k in pack for k in fields):
            return None
        if not all(k in pack for k in fields):
            raise ValueError('Incomplete text baseline arrays')
        text = np.asarray(pack['textFeatures'], dtype=np.float64)
        names = pack['textClasses'].astype(str).tolist()
        excluded = np.asarray(pack['textExcluded'], dtype=bool)
    if text.shape != (len(names), means.shape[1]) or excluded.shape != (len(names),) or len(set(names)) != len(names):
        raise ValueError('Text vocabulary dimensions/keys mismatch')
    if not np.isfinite(text).all() or not np.allclose(np.linalg.norm(text, axis=1), 1, atol=3e-4, rtol=0):
        raise ValueError('Text features must be finite L2-normalized vectors')
    if not all(c['key'] in names for c in labels):
        raise ValueError('A dataset class is missing from the full text vocabulary')
    expected = np.array([names.index(labels[c]['key']) for c in y])
    scores = means @ text.T
    top = scores.argmax(1)
    rivals = scores.copy()
    rivals[np.arange(len(y)), top] = -np.inf
    margin = scores[np.arange(len(y)), top] - rivals.max(1)
    accepted = ~excluded[top] & (scores[np.arange(len(y)), top] >= .30) & (margin >= .003)
    objects = np.array([c['object'] for c in labels])
    result = {'vocabularySize': len(names), 'threshold': .30, 'margin': .003,
              'notes': 'Full supplied vocabulary competes, including excluded classes; pooled features; not the original single-view v7 policy.',
              'humanRecognitionMeasured': False}
    for split in ('val', 'test'):
        ix = splits == split
        correct = top == expected
        per_class = [float(correct[ix & (y == c)].mean()) for c in range(len(labels))]
        result[split] = {'macroAccuracy': float(np.mean(per_class)), 'perClassAccuracy': per_class,
                         'genericFalseAccept': float(accepted[ix & ~objects[y]].mean()),
                         'objectMacroAcceptedCorrectRecall': float(np.mean([(correct & accepted)[ix & (y == c)].mean() for c in np.flatnonzero(objects)])),
                         'acceptedCount': int(accepted[ix].sum())}
    return result


def fit_experiment(means, y, splits, labels):
    count = len(labels)
    mask = np.array([c['object'] for c in labels])
    train, val, test = [splits == s for s in SPLITS]
    grid, candidates = [], []
    for lam in LAMBDAS:
        w, b, cw = fit_ridge(means[train], y[train], count, lam)
        score = macro_accuracy(means[val] @ w + b, y[val], count)
        grid.append({'lambda': lam, 'validationMacroAccuracy': score})
        candidates.append((score, lam, w, b, cw))
    _, selected, w, b, cw = max(candidates, key=lambda c: (c[0], c[1]))
    proto = fit_prototype(means[train], y[train], count)
    result = {'head': {'weights': w, 'bias': b, 'lambda': selected},
              'prototype': {'weights': proto, 'bias': np.zeros(count)}, 'classWeights': cw, 'lambdaGrid': grid}
    for mode in ('head', 'prototype'):
        model = result[mode]
        policy = calibrate(means[val] @ model['weights'] + model['bias'], y[val], mask)
        model['policy'] = policy
        model['validationMetrics'] = metrics(means[val] @ model['weights'] + model['bias'], y[val], mask, policy)
        # Test is evaluated only AFTER model/lambda/gate have been selected.
        model['testMetrics'] = metrics(means[test] @ model['weights'] + model['bias'], y[test], mask, policy)
    return result


def save_checkpoint(stream, state, metadata):
    np.savez_compressed(stream, head_weights=state['head']['weights'], head_bias=state['head']['bias'],
                        prototype_weights=state['prototype']['weights'], prototype_bias=state['prototype']['bias'],
                        class_weights=state['classWeights'], ridge_lambda=np.array(state['head']['lambda']),
                        metadata_json=np.array(json.dumps(metadata, ensure_ascii=False, allow_nan=False)))


def load_checkpoint(source):
    with np.load(source, allow_pickle=False) as pack:
        meta = json.loads(str(pack['metadata_json'].item()))
        labels = class_labels(meta['classLabels'])
        models = {m: {'weights': np.array(pack[m + '_weights']), 'bias': np.array(pack[m + '_bias']),
                      'policy': meta['models'][m]['policy']} for m in ('head', 'prototype')}
        for model in models.values():
            if model['weights'].shape != (meta['dimensions'], len(labels)) or model['bias'].shape != (len(labels),):
                raise ValueError('Checkpoint dimensions do not match class metadata')
            if not np.isfinite(model['weights']).all() or not np.isfinite(model['bias']).all():
                raise ValueError('Nonfinite checkpoint weights')
    return models, meta


def rank_records(rows, views, means, model, labels):
    mask = np.array([c['object'] for c in labels])
    logits = means @ model['weights'] + model['bias']
    view_logits = views @ model['weights'] + model['bias']
    predicted, margins, accepted = decisions(logits, mask, model['policy'])
    outputs = []
    intent_aliases = {'mug': {'cup', 'coffee_cup'}, 'bottle': {'wine_bottle'}, 'tshirt': {'t-shirt'}}
    for i, row in enumerate(rows):
        c = int(predicted[i])
        view = int(view_logits[i, :, c].argmax())  # deterministic tie: lowest view index
        offset = -float(row.get('generatorPlacement', {}).get('rotDeg', 0))
        if not np.isfinite(offset):
            raise ValueError('Nonfinite generator rotation')
        intent = row.get('proposalShape')
        key = labels[c]['key']
        additions = {'score': float(margins[i]), 'rankingScore': float(margins[i]), 'margin': float(margins[i]),
                     'accepted': bool(accepted[i]), 'predictedClass': key, 'predictedClassName': labels[c].get('word', labels[c]['name']),
                     'predictedClassIndex': c, 'predictedObject': bool(mask[c]),
                     'rotation': (view * 90 + offset) % 360, 'displayViewIndex': view,
                     'pooledClassScores': {cl['key']: float(logits[i, j]) for j, cl in enumerate(labels)},
                     'viewClassScores': view_logits[i].tolist(),
                     'intentAgreement': key in intent_aliases.get(intent, {intent}) if intent else None,
                     'intentGateApplied': False, 'coordinatesUnchanged': True, 'humanRecognitionVerified': False,
                     'reason': 'generic class winner' if not mask[c] else 'validation margin passed' if accepted[i] else 'validation margin rejected'}
        if set(row) & set(additions):
            raise ValueError('Source contains ranking fields; refusing to overwrite original fields')
        outputs.append({**copy.deepcopy(row), **additions})
    return outputs


def train_cli(args):
    began = time.perf_counter()
    if args.checkpoint.exists() or args.report.exists():
        raise ValueError('Use fresh checkpoint/report paths; existing experiments are immutable')
    if args.checkpoint.resolve() == args.report.resolve():
        raise ValueError('Checkpoint and report paths must differ')
    protocol_hash = sha(args.protocol)  # require pre-registered protocol before any training
    dataset = json.loads(args.dataset.read_text(encoding='utf-8'))
    labels, y, splits = validate_dataset(dataset)
    views, means, ids_verified = load_features(args.features, [r['id'] for r in dataset['records']])
    feature_meta = feature_provenance(args.features, args.dataset, 'dataset', args.feature_metadata)
    print(f'Train/val/test fixed: {[int((splits == s).sum()) for s in SPLITS]}; D={means.shape[1]}, C={len(labels)}', flush=True)
    state = fit_experiment(means, y, splits, labels)
    models = {m: {k: v for k, v in state[m].items() if k not in ('weights', 'bias')} for m in ('head', 'prototype')}
    delta = models['head']['testMetrics']['macroAccuracy'] - models['prototype']['testMetrics']['macroAccuracy']
    far_delta = models['head']['testMetrics']['genericFalseAccept'] - models['prototype']['testMetrics']['genericFalseAccept']
    meta = {'schemaVersion': 1, 'classLabels': labels, 'dimensions': means.shape[1], 'views': 4,
            'models': models, 'lambdaGrid': state['lambdaGrid'], 'selectedLambda': state['head']['lambda'],
            'classWeights': state['classWeights'].tolist(),
            'splitClassCounts': {s: np.bincount(y[splits == s], minlength=len(labels)).tolist() for s in SPLITS},
            'datasetSHA256': sha(args.dataset), 'featuresSHA256': sha(args.features), 'protocolSHA256': protocol_hash,
            'codeSHA256': sha(__file__), 'idsVerifiedInFeatures': ids_verified, 'featureProvenance': feature_meta,
            'featureOrderContract': 'NPZ order must match records; ids checked when present',
            'trainingInput': 'mean unchanged; weighted one-hot ridge with unpenalized bias, no standardization',
            'sampleWeightFormula': 'N_train / (C * n_train_class)',
            'gateSelection': 'val macro accepted-correct object recall; generic FAR<=0.10; ties lower FAR then higher margin',
            'classificationTies': 'lowest classIndex', 'displayRule': 'per-view predicted-class score maximum; lowest index tie; rotation=(90*index-generatorPlacement.rotDeg)%360',
            'auxiliary': {'macroAccuracyDelta': delta, 'genericFalseAcceptDelta': far_delta,
                          'passed': delta >= .05 - 1e-12 and far_delta <= 1e-12},
            'humanRecognitionMeasured': False, 'roadLabelsUsedForTraining': False,
            'realRoadGeneralizationMeasured': False, 'textBaseline': text_baseline(args.features, means, y, splits, labels),
            'numpy': np.__version__, 'python': platform.python_version(),
            'elapsedSeconds': time.perf_counter() - began}
    args.checkpoint.parent.mkdir(parents=True, exist_ok=True)
    with args.checkpoint.open('xb') as stream:
        save_checkpoint(stream, state, meta)
    write_json(args.report, {**meta, 'checkpointSHA256': sha(args.checkpoint)})
    print(json.dumps({'selectedLambda': meta['selectedLambda'], 'auxiliary': meta['auxiliary'], 'checkpoint': str(args.checkpoint), 'report': str(args.report)}), flush=True)


def rank_cli(args):
    began = time.perf_counter()
    if args.output.exists() or args.report.exists():
        raise ValueError('Use fresh ranking/report paths')
    if args.output.resolve() == args.report.resolve():
        raise ValueError('Ranking and report paths must differ')
    models, meta = load_checkpoint(args.checkpoint)
    raw = args.roads.read_bytes()
    data = json.loads(raw)
    if data.get('status') != 'complete':
        raise ValueError('Road candidate generation must have status:complete')
    rows = data['results']
    if not rows or len({str(r['id']) for r in rows}) != len(rows):
        raise ValueError('Nonempty unique road IDs are required')
    views, means, ids_verified = load_features(args.features, [r['id'] for r in rows])
    feature_meta = feature_provenance(args.features, args.roads, 'roads', args.feature_metadata)
    if means.shape[1] != meta['dimensions']:
        raise ValueError('Road/checkpoint feature dimension mismatch')
    compatibility = verify_feature_compatibility(meta, feature_meta)
    outputs = rank_records(rows, views, means, models[args.mode], meta['classLabels'])
    summary = {'method': 'sketch-' + args.mode + '-v10', 'mode': args.mode, 'classLabels': meta['classLabels'],
               'inputSHA256': hashlib.sha256(raw).hexdigest(), 'featuresSHA256': sha(args.features),
               'checkpointSHA256': sha(args.checkpoint), 'protocolSHA256': meta['protocolSHA256'],
               'trainingDatasetSHA256': meta['datasetSHA256'], 'codeSHA256': sha(__file__),
               'gate': models[args.mode]['policy'], 'candidateCount': len(rows),
               'acceptedCount': sum(r['accepted'] for r in outputs),
               'acceptedByArea': {a: sum(r['accepted'] for r in outputs if r.get('area') == a) for a in dict.fromkeys(r.get('area') for r in rows)},
               'idsVerifiedInFeatures': ids_verified, 'featureProvenance': feature_meta,
               'featureCompatibility': compatibility,
               'scoreMeaning': 'raw top1-minus-top2 margin; NOT a probability; not comparable across model types',
               'classificationInput': 'normalized pooled mean', 'displayRule': meta['displayRule'],
               'intentGateApplied': False, 'geometryDeduplicatedByThisScript': False,
               'humanRecognitionMeasured': False, 'roadValidityCheckedByThisScript': False,
               'genericMeaning': 'recommendation exclusion classes, not real-road absence ground truth',
               'elapsedSeconds': time.perf_counter() - began}
    write_json(args.output, {**summary, 'outputs': outputs})
    write_json(args.report, {**summary, 'outputSHA256': sha(args.output)})
    print(json.dumps({'mode': args.mode, 'roads': len(rows), 'accepted': summary['acceptedCount'], 'output': str(args.output)}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    train = sub.add_parser('train')
    train.add_argument('--features', type=Path, required=True)
    train.add_argument('--dataset', type=Path, required=True)
    train.add_argument('--feature-metadata', type=Path, help='Optional extractor sidecar; default auto-detects FEATURES-stem-metadata.json')
    train.add_argument('--checkpoint', type=Path, required=True)
    train.add_argument('--protocol', type=Path, default=REPORTS / 'protocol-v10.md')
    train.add_argument('--report', type=Path, default=REPORTS / 'sketch-head-v10-train.json')
    rank = sub.add_parser('rank')
    rank.add_argument('--features', type=Path, required=True)
    rank.add_argument('--roads', type=Path, required=True)
    rank.add_argument('--feature-metadata', type=Path, help='Optional extractor sidecar; default auto-detects FEATURES-stem-metadata.json')
    rank.add_argument('--checkpoint', type=Path, required=True)
    rank.add_argument('--mode', choices=('head', 'prototype'), required=True)
    rank.add_argument('--output', type=Path, required=True)
    rank.add_argument('--report', type=Path)
    args = parser.parse_args()
    if args.command == 'train':
        train_cli(args)
    else:
        args.report = args.report or REPORTS / ('sketch-head-v10-rank-' + args.mode + '.json')
        rank_cli(args)


if __name__ == '__main__':
    main()
