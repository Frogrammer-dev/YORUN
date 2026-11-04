"""CPU sketch-ranking pilot. Scores existing routes; never predicts road coordinates.

train: paired clean/road augmentation, seeds 17/29, original 590-ID split.
rank: consumes {results: [{id, area, xy, ...}]} and preserves every source field.
Synthetic `none` examples are NOT human-labelled negatives or real-road truth.
No other research module is imported: some have import-time RNG/filesystem effects.
"""
import argparse
import copy
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / 'eval/recognition/road-ranker-20261102'
DEFAULT_REPORT = ROOT / 'reports/road-ranker-20261102'
CLASSES = ['apple', 'fish', 'bird', 'synthetic_none']
SEEDS = (17, 29)
MODES = ('clean', 'grid', 'axis_step')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def dump(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def normalize(points):
    p = np.array(points, dtype=np.float64, copy=True)
    if p.ndim != 2 or p.shape[1] != 2 or len(p) < 2 or not np.isfinite(p).all():
        raise ValueError('Expected at least two finite XY points')
    extent = np.ptp(p, axis=0).max()
    if extent <= 1e-9:
        raise ValueError('Degenerate XY path')
    return (p - (p.max(0) + p.min(0)) / 2) / extent


def canonical(points):
    """Exact local copy of the old manifest transform, without importing its script."""
    p = np.array(points, dtype='float32', copy=True)
    p[:, 1] *= -1
    p = (p - (p.max(0) + p.min(0)) / 2) / np.ptp(p, axis=0).max()
    if np.sum(p[:, 0] * np.roll(p[:, 1], -1) - p[:, 1] * np.roll(p[:, 0], -1)) < 0:
        p = p[::-1]
    p = np.roll(p, -int(np.argmax(p[:, 0])), axis=0)
    p = np.asarray(p, dtype=np.float64)  # old resample() promotes before measuring lengths
    if not np.allclose(p[0], p[-1]):
        p = np.concatenate([p, p[:1]])
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    keep = np.r_[True, np.diff(d) > 1e-9]
    p, d = p[keep], d[keep]
    t = np.linspace(0, d[-1], 64, endpoint=False)
    return np.stack([np.interp(t, d, p[:, j]) for j in range(2)], 1).astype('float32')


def deform(points, mode, grid=16):
    p = np.array(points, dtype=np.float64, copy=True)
    if mode == 'clean':
        return p
    p = np.round(p * grid) / grid
    if mode == 'grid':
        return p
    if mode != 'axis_step':
        raise ValueError(mode)
    # Include the closing segment; no hidden diagonal closure in the raster.
    if not np.allclose(p[0], p[-1]):
        p = np.concatenate([p, p[:1]])
    out = [p[0]]
    for i, (a, b) in enumerate(zip(p[:-1], p[1:])):
        out.extend(([b[0], a[1]] if i % 2 == 0 else [a[0], b[1]], b))
    return np.asarray(out)


def raster(points, rotation=0, close=True):
    p = np.array(points, dtype=np.float64, copy=True)
    for _ in range(rotation % 4):
        p = np.column_stack([-p[:, 1], p[:, 0]])
    if close and not np.allclose(p[0], p[-1]):
        p = np.concatenate([p, p[:1]])
    image = Image.new('L', (48, 48), 0)
    xy = [(float(x) * 38 + 24, 24 - float(y) * 38) for x, y in p]
    ImageDraw.Draw(image).line(xy, fill=255, width=2, joint='curve')
    return np.asarray(image, dtype='float32')[None] / 255


def synthetic(seed):
    """Procedural generic shapes; semantic absence is unverified, even here."""
    rng = np.random.default_rng(seed)
    family = seed % 3
    if family == 0:
        w, h = rng.uniform(.2, 1, 2)
        p = np.array([[-w, -h], [w, -h], [w, h], [-w, h]])
    else:
        n = int(rng.integers(5, 13))
        angles = np.sort(rng.uniform(0, 2 * np.pi, n))
        radii = rng.uniform(.35, 1, n) if family == 1 else np.ones(n)
        p = np.column_stack([np.cos(angles), np.sin(angles)]) * radii[:, None]
        p[:, 1] *= rng.uniform(.3, 1)
    return normalize(p)


def load_data(data):
    data = Path(data)
    manifest = json.loads((data / 'manifest.json').read_text(encoding='utf-8'))
    lookup = {}
    for source in manifest['sources']:
        path = data / (source['class'] + '.selected.json')
        if sha(path) != source['cacheSHA256']:
            raise ValueError('Quick Draw cache hash mismatch: ' + str(path))
        for r in json.loads(path.read_text(encoding='utf-8')):
            lookup[str(r['key_id'])] = canonical(r['points'])
    records, points = [], []
    for r in manifest['records']:
        p = lookup[str(r['id'])]
        if hashlib.sha256(p.tobytes()).hexdigest() != r['hash']:
            raise ValueError('Canonical geometry hash mismatch: ' + str(r['id']))
        if r['split'] not in ('train', 'val', 'test') or r['class'] not in (0, 1, 2):
            raise ValueError('Invalid fixed manifest split/class')
        records.append({**r, 'id': str(r['id']), 'origin': 'quickdraw_closed'})
        points.append(p)
    if len(records) != 590 or len({r['id'] for r in records}) != 590:
        raise ValueError('Expected the fixed 590 unique Quick Draw records')
    # Approximately one class worth of negatives, with disjoint generator seeds.
    for s, offset in [('train', 100000), ('val', 200000), ('test', 300000)]:
        count = sum(r['split'] == s for r in records) // 3
        for j in range(count):
            seed = offset + j
            points.append(synthetic(seed))
            records.append({'id': f'synthetic-{seed}', 'class': 3, 'split': s,
                            'origin': 'procedural_synthetic', 'generatorSeed': seed})
    return records, points


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv2d(1, 8, 5, padding=2), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(8, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(16, 24, 3, padding=1), nn.ReLU(),
            nn.AdaptiveAvgPool2d((3, 3)), nn.Flatten(),
            nn.Linear(216, 48), nn.ReLU(), nn.Linear(48, 4))

    def forward(self, x):
        return self.layers(x)


def probabilities(model, x, batch_size=128):
    """x: N x rotations x 1 x H x W; average probabilities, not max rotation."""
    model.eval()
    flat = x.flatten(0, 1)
    with torch.inference_mode():
        p = torch.cat([model(b).softmax(-1) for b in flat.split(batch_size)])
    return p.reshape(len(x), x.shape[1], 4).mean(1).numpy()


def gate(probs, policy):
    predicted = probs[:, :3].argmax(1)
    score = probs[np.arange(len(probs)), predicted]
    rivals = probs.copy()
    rivals[np.arange(len(probs)), predicted] = -1
    margin = score - rivals.max(1)
    accepted = ((probs.argmax(1) == predicted) & (score >= policy['threshold'])
                & (margin >= policy['margin']))
    return predicted, score, margin, accepted


def calibrate(probs, labels):
    """VAL only. Maximize accepted-correct macro recall subject to synthetic FAR<=10%."""
    best, chosen = None, None
    for threshold in (.25, .35, .45, .55, .65, .75, .85, .95, 1.01):
        for margin in (0., .05, .1, .2):
            policy = {'threshold': threshold, 'margin': margin}
            pred, _, _, accepted = gate(probs, policy)
            far = float(accepted[labels == 3].mean())
            recall = float(np.mean([((pred == c) & accepted)[labels == c].mean() for c in range(3)]))
            if far <= .1:
                key = (recall, -far, threshold, margin)
                if best is None or key > best:
                    best, chosen = key, {**policy, 'validationSyntheticFalseAccept': far,
                                         'validationMacroAcceptedCorrectRecall': recall}
    return {**chosen, 'calibration': 'validation only; synthetic negative FAR <= 0.10',
            'realRoadRejectCalibrated': False}


def metrics(probs, labels, policy):
    pred, _, _, accepted = gate(probs, policy)
    obj, neg = labels < 3, labels == 3
    # Classification accuracy counts a none winner as incorrect, prior to gating.
    acc = probs.argmax(1) == labels
    return {'objectAccuracy': float(acc[obj].mean()),
            'perClassAccuracy': {CLASSES[c]: float(acc[labels == c].mean()) for c in range(3)},
            'objectCount': int(obj.sum()), 'syntheticNegativeCount': int(neg.sum()),
            'objectCoverage': float(accepted[obj].mean()),
            'objectAcceptedCorrectRecall': float(((pred == labels) & accepted)[obj].mean()),
            'syntheticNegativeFalseAccept': float(accepted[neg].mean()),
            'syntheticNegativeAccuracy': float(acc[neg].mean()),
            'humanRecognitionMeasured': False, 'realRoadAccuracyMeasured': False}


def train(args):
    began = time.perf_counter()
    out, report = Path(args.out), Path(args.report)
    protocol = Path(args.protocol)
    if not protocol.is_file():
        raise ValueError('Record the protocol before training: ' + str(protocol))
    for name in ['training-summary.json', *(f'{t}-{s}.pt' for s in SEEDS for t in ('clean', 'road'))]:
        if (out / name).exists():
            raise ValueError('Refusing to overwrite experiment: ' + name)
    records, points = load_data(args.data)
    labels = np.array([r['class'] for r in records])
    splits = {s: np.array([i for i, r in enumerate(records) if r['split'] == s]) for s in ('train', 'val', 'test')}
    # Fixed views shared by all runs, including common random rotations for fairness.
    print('Preparing fixed raster views', flush=True)
    views = {m: torch.from_numpy(np.stack([[raster(deform(p, m), k) for k in range(4)] for p in points])) for m in MODES}
    # Training uses grids 12/20; the fixed evaluation grid16 is not a training view.
    aug_views = [views['clean']]
    for m in ('grid', 'axis_step'):
        for g in (12, 20):
            aug_views.append(torch.from_numpy(np.stack([[raster(deform(p, m, g), k) for k in range(4)] for p in points])))
    out.mkdir(parents=True, exist_ok=True)
    frozen = {'sourceManifestSHA256': sha(Path(args.data) / 'manifest.json'), 'records': records,
              'classes': CLASSES, 'syntheticNegativeTruth': 'procedural assumption, NOT real-road absence',
              'license': 'Quick Draw CC BY 4.0', 'testPreviouslyUsed': True}
    dump(out / 'training-manifest.json', frozen)
    runs = []
    for seed in SEEDS:
        for treatment in ('clean', 'road'):
            torch.manual_seed(seed)
            order_rng, aug_rng = np.random.default_rng(seed), np.random.default_rng(seed + 1000)
            model = Net()
            opt = torch.optim.Adam(model.parameters(), lr=.001)
            best, state, best_epoch, history = float('inf'), None, 0, []
            train_idx, val_idx = splits['train'], splits['val']
            for epoch in range(args.epochs):
                model.train()
                order = order_rng.permutation(train_idx)
                losses = []
                for start in range(0, len(order), 64):
                    idx = order[start:start + 64]
                    rotations = aug_rng.integers(0, 4, len(idx))
                    levels = aug_rng.integers(0, len(aug_views), len(idx))
                    if treatment == 'clean':
                        levels[:] = 0
                    x = torch.stack([aug_views[level][i, rot] for i, rot, level in zip(idx, rotations, levels)])
                    loss = nn.functional.cross_entropy(model(x), torch.from_numpy(labels[idx]).long())
                    opt.zero_grad()
                    loss.backward()
                    opt.step()
                    losses.append(float(loss.detach()))
                val_probs = [probabilities(model, views[m][val_idx]) for m in MODES]
                val_loss = float(np.mean([-np.log(np.maximum(p[np.arange(len(val_idx)), labels[val_idx]], 1e-9)).mean() for p in val_probs]))
                history.append({'epoch': epoch + 1, 'trainLoss': float(np.mean(losses)), 'validationLoss': val_loss})
                if val_loss < best:
                    best, state, best_epoch = val_loss, copy.deepcopy(model.state_dict()), epoch + 1
                print(f'seed={seed} {treatment} epoch={epoch+1}/{args.epochs} train={np.mean(losses):.4f} val={val_loss:.4f}', flush=True)
            model.load_state_dict(state)
            val_p = np.concatenate([probabilities(model, views[m][val_idx]) for m in MODES])
            policy = calibrate(val_p, np.tile(labels[val_idx], len(MODES)))
            checkpoint = {'state_dict': state, 'seed': seed, 'treatment': treatment, 'bestEpoch': best_epoch,
                          'classes': CLASSES, 'policy': policy, 'rotations': 4,
                          'sourceManifestSHA256': frozen['sourceManifestSHA256'],
                          'protocolSHA256': sha(protocol), 'codeSHA256': sha(__file__),
                          'coordinatesPredicted': False, 'renderer': 'ink48-span38-width2-v1'}
            ckpath = out / f'{treatment}-{seed}.pt'
            with ckpath.open('wb') as stream:
                torch.save(checkpoint, stream)
            test_idx = splits['test']
            evaluated = {m: metrics(probabilities(model, views[m][test_idx]), labels[test_idx], policy) for m in MODES}
            runs.append({'seed': seed, 'treatment': treatment, 'bestEpoch': best_epoch, 'policy': policy,
                         'metrics': evaluated, 'history': history, 'checkpointSHA256': sha(ckpath)})
            print(json.dumps({'seed': seed, 'treatment': treatment, 'test': evaluated}), flush=True)
    decisions = []
    for seed in SEEDS:
        a, b = [next(r['metrics'] for r in runs if r['seed'] == seed and r['treatment'] == t) for t in ('clean', 'road')]
        grid_gain = b['grid']['objectAccuracy'] - a['grid']['objectAccuracy']
        # Mean FAR across the two fixed transformed synthetic views (not real roads).
        fa = float(np.mean([a[m]['syntheticNegativeFalseAccept'] for m in ('grid', 'axis_step')]))
        fb = float(np.mean([b[m]['syntheticNegativeFalseAccept'] for m in ('grid', 'axis_step')]))
        reduction = 1 - fb / fa if fa > 0 else None
        clean_delta = b['clean']['objectAccuracy'] - a['clean']['objectAccuracy']
        decisions.append({'seed': seed, 'gridAccuracyDelta': grid_gain, 'cleanAccuracyDelta': clean_delta,
                          'transformedSyntheticFalseAcceptClean': fa, 'transformedSyntheticFalseAcceptRoad': fb,
                          'syntheticFalseAcceptRelativeReduction': reduction,
                          'auxiliaryPassed': clean_delta >= -.03 - 1e-9 and (grid_gain >= .05 - 1e-9 or (reduction is not None and reduction >= .2 - 1e-9))})
    summary = {'runs': runs, 'decisions': decisions, 'auxiliaryPassed': all(d['auxiliaryPassed'] for d in decisions),
               'decisionDefinition': 'grid object accuracy; negative FAR mean(grid,axis_step); clean object accuracy',
               'sourceManifestSHA256': frozen['sourceManifestSHA256'], 'trainingManifestSHA256': sha(out / 'training-manifest.json'),
               'protocolSHA256': sha(protocol), 'codeSHA256': sha(__file__),
               'splitCounts': {s: {'quickdraw': sum(records[i]['class'] < 3 for i in ix), 'synthetic': sum(records[i]['class'] == 3 for i in ix)} for s, ix in splits.items()},
               'epochs': args.epochs, 'seeds': list(SEEDS), 'torch': torch.__version__,
               'elapsedSeconds': time.perf_counter() - began, 'humanRecognitionMeasured': False,
               'realRoadGeneralizationMeasured': False, 'appDefaultChanged': False,
               'limitations': ['3 known objects only; other real objects can be rejected or misnamed',
                              'Synthetic none is NOT real-road negative truth',
                              'Test IDs were used in prior research; no new independent holdout',
                              'No road-network-constrained augmentation; grid/axis-step are proxies',
                              'No human probability calibration; synthetic test success is not product success']}
    dump(out / 'training-summary.json', summary)
    dump(report / 'training-summary.json', summary)
    print(json.dumps({'decisions': decisions, 'auxiliaryPassed': summary['auxiliaryPassed'], 'elapsedSeconds': summary['elapsedSeconds']}), flush=True)


def rank_records(model, checkpoint, data, rotations=4):
    rows = data['results']
    if not rows or len({r['id'] for r in rows}) != len(rows):
        raise ValueError('Expected nonempty unique candidate IDs')
    outputs = []
    for start in range(0, len(rows), 32):
        batch = rows[start:start + 32]
        # Only the model input is normalized/rotated. Source coordinates are untouched.
        x = torch.from_numpy(np.stack([[raster(normalize(r['xy']), k, close=False) for k in range(rotations)] for r in batch]))
        probs = probabilities(model, x)
        pred, scores, margins, accepted = gate(probs, checkpoint['policy'])
        for i, r in enumerate(batch):
            outputs.append({**copy.deepcopy(r), 'predictedClass': CLASSES[int(pred[i])],
                            'winningClass': CLASSES[int(probs[i].argmax())], 'score': float(scores[i]),
                            'rankingScore': float(scores[i]), 'margin': float(margins[i]), 'accepted': bool(accepted[i]),
                            'classScores': dict(zip(CLASSES, map(float, probs[i]))),
                            'reason': 'validation synthetic gate passed' if accepted[i] else 'validation synthetic gate rejected',
                            'coordinatesUnchanged': True, 'humanRecognitionVerified': False})
    return outputs


def rank(args):
    output = Path(args.output)
    if output.exists():
        raise ValueError('Refusing to overwrite rank output')
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=True)
    if checkpoint['classes'] != CLASSES:
        raise ValueError('Checkpoint class mismatch')
    if args.rotations != checkpoint['rotations']:
        raise ValueError('Rotations must match validation-calibrated checkpoint (4)')
    model = Net()
    model.load_state_dict(checkpoint['state_dict'])
    data = json.loads(Path(args.input).read_text(encoding='utf-8'))
    began = time.perf_counter()
    outputs = rank_records(model, checkpoint, data, args.rotations)
    dump(output, {'outputs': outputs, 'inputSHA256': sha(args.input), 'checkpointSHA256': sha(args.checkpoint),
                  'policy': checkpoint['policy'], 'seed': checkpoint['seed'], 'treatment': checkpoint['treatment'],
                  'rotations': args.rotations, 'elapsedSeconds': time.perf_counter() - began,
                  'roadValidityIndependentlyVerified': False, 'humanRecognitionMeasured': False,
                  'notes': 'No geometry modification. Score is not human recognition probability. synthetic_none is not real-road ground truth.'})
    print(f'Ranked {len(outputs)} roads, accepted {sum(r["accepted"] for r in outputs)}; {output}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--threads', type=int, default=4)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('train')
    p.add_argument('--data', type=Path, default=ROOT / 'eval/recognition/point-contour-20261028')
    p.add_argument('--out', type=Path, default=DEFAULT_OUT)
    p.add_argument('--report', type=Path, default=DEFAULT_REPORT)
    p.add_argument('--protocol', type=Path, default=DEFAULT_REPORT / 'protocol.md')
    p.add_argument('--epochs', type=int, default=16)
    p = sub.add_parser('rank')
    p.add_argument('--input', type=Path, default=DEFAULT_OUT / 'roads.json')
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--rotations', type=int, choices=(4,), default=4)
    args = parser.parse_args()
    if args.threads < 1 or (args.command == 'train' and args.epochs < 1):
        parser.error('threads/epochs must be positive')
    torch.set_num_threads(args.threads)
    torch.use_deterministic_algorithms(True)
    train(args) if args.command == 'train' else rank(args)


if __name__ == '__main__':
    main()
