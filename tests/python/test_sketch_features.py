import importlib.util
from pathlib import Path
import unittest
import json
import tempfile
from types import SimpleNamespace
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('sf',ROOT/'scripts/recognition-lab/sketch-features.py')
sf=importlib.util.module_from_spec(spec);spec.loader.exec_module(sf)


class SketchFeaturesTest(unittest.TestCase):
    def test_custom_scope_keeps_explicit_protocol_and_report_without_network(self):
        temp=ROOT/'eval/recognition/tmp';temp.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temp) as folder:
            out=Path(folder)
            rows=[]
            for i in range(72):
                strokes=sf.normalized_strokes([[[0,i+2,1],[0,1,i+3]]])
                group=sf.geometry_hash(strokes)
                rows.append({'id':'synthetic-scope-test-'+str(i),'classIndex':0,'className':'house','strokes':strokes,'groupSHA256':group,'split':sf.split(group),'sourceRecognized':True})
            (out/'house.json').write_text(json.dumps({'url':'https://storage.googleapis.com/quickdraw_dataset/full/simplified/house.ndjson','limit':72,'records':rows,'scanned':72,'rejected':{}}),encoding='utf-8')
            classes=out/'classes.json';classes.write_text(json.dumps([sf.CLASSES[0]]),encoding='utf-8')
            protocol=out/'protocol.md';protocol.write_text('A frozen alternative scope',encoding='utf-8')
            report=out/'audit.json'
            sf.acquire(SimpleNamespace(out=out,classes_json=classes,protocol=protocol,data_report=report))
            dataset=json.loads((out/'dataset.json').read_text(encoding='utf-8'))
            self.assertEqual(len(dataset['records']),72)
            self.assertEqual(dataset['protocolSHA256'],sf.digest(protocol.read_bytes()))
            self.assertEqual(json.loads(report.read_text(encoding='utf-8'))['records'],72)

    def test_geometry_group_ignores_rotation_stroke_order_and_direction(self):
        strokes=sf.normalized_strokes([[[0,30,40],[0,10,50]],[[10,20],[10,20]]])
        rotated=[np.column_stack([-np.array(p)[:,1],np.array(p)[:,0]]).tolist() for p in strokes]
        self.assertEqual(sf.geometry_hash(strokes),sf.geometry_hash(rotated))
        self.assertEqual(sf.geometry_hash(strokes),sf.geometry_hash([p[::-1] for p in strokes[::-1]]))

    def test_split_hash_is_uniform_after_canonical_minimum_and_group_stable(self):
        # Regression: min-of-four hash prefixes put all initial house examples in train.
        groups=[min(sf.digest(f'{i}:{r}'.encode()) for r in range(4)) for i in range(4000)]
        ratios={s:sum(sf.split(g)==s for g in groups)/len(groups) for s in ['train','val','test']}
        self.assertTrue(.67<ratios['train']<.73)
        self.assertTrue(.12<ratios['val']<.18)
        self.assertTrue(.12<ratios['test']<.18)
        self.assertEqual(sf.split(groups[0]),sf.split(groups[0]))

    def test_road_render_matches_existing_frozen_renderer_without_geometry_change(self):
        # Importing the production renderer also validates the installed inference dependencies.
        spec=importlib.util.spec_from_file_location('clip_renderer',ROOT/'scripts/recognition-lab/road-clip-ranker.py')
        old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
        p=[[100,50],[600,50],[600,300],[100,50]];before=[x[:] for x in p]
        for turn in range(4):
            self.assertEqual(sf.render([p],turn,-31).tobytes(),old.render(p,turn,-31).tobytes())
        self.assertEqual(p,before)

    def test_invalid_and_nonfinite_drawings_are_rejected(self):
        for drawing in [[],[[[1],[1]]],[[[0,1],[0,float('nan')]]]]:
            with self.assertRaises(ValueError):sf.normalized_strokes(drawing)


if __name__=='__main__':unittest.main()
