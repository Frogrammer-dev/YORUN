import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('review', ROOT/'scripts/recognition-lab/road-ranker-review.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class ReviewTest(unittest.TestCase):
    def setUp(self):
        self.temp_root=ROOT/'eval/recognition/tmp'
        self.temp_root.mkdir(parents=True,exist_ok=True)

    def test_rejections_remain_in_denominator_and_blind_page_does_not_leak(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as folder:
            root=Path(folder)
            rows=[{'id':f'secret-{i}','area':'hidden-area','baselineId':f'baseline-{i}',
                   'xy':[[0,0],[1,0],[1,1],[0,0]],'latlon':[[37,127],[37.1,127],[37.1,127.1],[37,127]],
                   'meters':4000,'repeatRatio':0} for i in range(3)]
            (root/'roads.json').write_text(json.dumps({'results':rows}))
            (root/'predictions.json').write_text(json.dumps({'outputs':[{'id':r['id'],'predictedClass':'secret-class','score':.987654321,'accepted':False} for r in rows]}))
            result=review.export(root/'roads.json',root/'predictions.json',root/'output')
            self.assertEqual(result['methodsDenominator'],2)
            self.assertEqual(sum(s['id'] is None for s in result['slots']),2)
            self.assertEqual(result['uniqueBlindCandidates'],2)
            page=(root/'output/blind.html').read_text(encoding='utf-8')
            for secret in ['secret-class','hidden-area','secret-0','.987654321','baseline-0']:
                self.assertNotIn(secret,page)
            gpx=ET.fromstring((root/'output/R01.gpx').read_text())
            points=gpx.findall('.//{http://www.topografix.com/GPX/1/1}trkpt')
            self.assertEqual(len(points),4)
            self.assertEqual([(float(p.attrib['lat']),float(p.attrib['lon'])) for p in points],[(37,127),(37.1,127),(37.1,127.1),(37,127)])

    def test_missing_prediction_is_not_silently_skipped(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as folder:
            root=Path(folder)
            (root/'roads.json').write_text(json.dumps({'results':[{'id':'one'}]}))
            (root/'predictions.json').write_text(json.dumps({'outputs':[]}))
            with self.assertRaises(ValueError):
                review.export(root/'roads.json',root/'predictions.json',root/'output')

    def test_display_rotation_keeps_gpx_and_source_unchanged(self):
        row={'id':'a','xy':[[0,0],[2,0],[2,1],[0,0]],'latlon':[[37,127],[37,127.2],[37.1,127.2],[37,127]],'_rotation':90}
        original=json.loads(json.dumps(row))
        self.assertEqual(review.display_points(row),[[0,0],[0,2],[-1,2],[0,0]])
        self.assertEqual(row,original)
        xml=ET.fromstring(review.gpx(row))
        points=xml.findall('.//{http://www.topografix.com/GPX/1/1}trkpt')
        self.assertEqual([(float(p.attrib['lat']),float(p.attrib['lon'])) for p in points],[tuple(p) for p in row['latlon']])

    def test_same_geometry_under_multiple_intents_does_not_fill_two_model_slots(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as folder:
            root=Path(folder)
            rows=[{'id':name,'area':'one','roadHash':'source','path':[1,2,3,1],'baselineId':name,'xy':[[0,0],[1,0],[1,1],[0,0]],'latlon':[[37,127],[37.1,127],[37.1,127.1],[37,127]],'meters':4000,'repeatRatio':0} for name in ['a','b']]
            (root/'roads.json').write_text(json.dumps({'results':rows}))
            (root/'predictions.json').write_text(json.dumps({'outputs':[{'id':r['id'],'score':.9-i*.1,'accepted':True} for i,r in enumerate(rows)]}))
            result=review.export(root/'roads.json',root/'predictions.json',root/'output')
            self.assertEqual([s['id'] for s in result['slots'] if s['method']=='model'],['a',None])
            self.assertEqual(result['methodsDenominator'],2)


if __name__=='__main__':unittest.main()
