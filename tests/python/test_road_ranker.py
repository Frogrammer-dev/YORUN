"""Run with model-env Python -B -m unittest discover -s tests/python -p test_road_ranker.py."""
import importlib.util
import io
import unittest
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('road_ranker', ROOT / 'scripts/recognition-lab/road_ranker.py')
rr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rr)


class RankerTests(unittest.TestCase):
    def test_fixed_manifest_hash_and_split(self):
        records, points = rr.load_data(ROOT / 'eval/recognition/point-contour-20261028')
        qd = [r for r in records if r['origin'] == 'quickdraw_closed']
        self.assertEqual(len(qd), 590)
        self.assertEqual([sum(r['split'] == s for r in qd) for s in ('train', 'val', 'test')], [413, 88, 89])
        self.assertEqual(len(records), len({r['id'] for r in records}))
        self.assertEqual(len(records), len(points))
        self.assertTrue(all(r['origin'] == 'procedural_synthetic' for r in records if r['class'] == 3))

    def test_axis_step_has_no_diagonal_or_mutation(self):
        p = np.array([[-.4, -.3], [.4, .1], [.2, .4]])
        original = p.copy()
        q = rr.deform(p, 'axis_step')
        self.assertTrue(np.all(np.isclose(np.diff(q, axis=0), 0).any(axis=1)))
        np.testing.assert_array_equal(p, original)
        np.testing.assert_array_equal(q[0], q[-1])

    def test_gate_none_winner_rejected_and_calibration_constraint(self):
        p = np.array([[.8, .1, .05, .05], [.1, .1, .1, .7], [.2, .2, .2, .4], [.1, .8, .05, .05], [.1, .1, .75, .05]])
        y = np.array([0, 3, 3, 1, 2])
        policy = rr.calibrate(p, y)
        _, _, _, accepted = rr.gate(p, policy)
        self.assertFalse(accepted[1])
        self.assertFalse(accepted[2])
        self.assertLessEqual(float(accepted[y == 3].mean()), .1)
        self.assertFalse(policy['realRoadRejectCalibrated'])

    def test_rank_preserves_geometry_and_rotation_average(self):
        torch.set_num_threads(2)
        torch.manual_seed(17)
        net = rr.Net().eval()
        row = {'id': 'a', 'area': 'test', 'xy': [[0, 0], [10, 0], [8, 7], [0, 0]],
               'path': [1, 2, 3, 1], 'latlon': [[37, 127], [37, 128]], 'meters': 4000, 'repeatRatio': .1}
        checkpoint = {'policy': {'threshold': .5, 'margin': .1}}
        result = rr.rank_records(net, checkpoint, {'results': [row]})[0]
        for key in row:
            self.assertEqual(result[key], row[key])
        points = rr.normalize(row['xy'])
        x = torch.from_numpy(np.stack([rr.raster(points, k, close=False) for k in range(4)]))[None]
        a = rr.probabilities(net, x)
        b = rr.probabilities(net, x.roll(1, dims=1))
        np.testing.assert_allclose(a, b, atol=1e-7)

    def test_degenerate_inputs_rejected(self):
        for p in ([[1, 1], [1, 1]], [[0, 0], [float('nan'), 1]]):
            with self.assertRaises(ValueError):
                rr.normalize(p)

    def test_checkpoint_is_weights_only_loadable(self):
        stream = io.BytesIO()
        torch.save({'state_dict': rr.Net().state_dict(), 'classes': rr.CLASSES,
                    'policy': {'threshold': .55, 'margin': .1}}, stream)
        stream.seek(0)
        self.assertEqual(torch.load(stream, weights_only=True)['classes'], rr.CLASSES)


if __name__ == '__main__':
    unittest.main()
