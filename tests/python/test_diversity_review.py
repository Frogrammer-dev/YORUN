import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('dr',ROOT/'scripts/recognition-lab/diversity-review.py')
dr=importlib.util.module_from_spec(spec);spec.loader.exec_module(dr)


class DiversityReviewTest(unittest.TestCase):
    def test_all_kinds_and_missing_requests_remain_and_blind_page_does_not_leak(self):
        temp=ROOT/'eval/recognition/tmp';temp.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temp) as folder:
            root=Path(folder);catalog=[];rows=[];slots=[];counts=[]
            for i in range(25):
                key=f'SECRET_KIND_{i}'
                catalog.append({'key':key,'kind':'animal' if i<11 else 'object','shape':{'name':f'SECRET_NAME_{i}','points':[[0,0],[1,0],[1,1],[0,0]]},'identifyingFeatures':'feature','roadRisk':'risk','ambiguity':'ambiguity','headSupported':False,'clipSupported':True})
                for area in dr.AREAS:
                    identifier=f'{area}-{key}';missing=i==0 and area==next(iter(dr.AREAS))
                    row={'id':identifier,'area':area,'proposalShape':key,'generatorPlacement':{'rotDeg':0},'xy':[[0,0],[1000,0],[1000,1000],[0,0]],'latlon':[[37,127],[37.01,127],[37.01,127.01],[37,127]],'meters':4000,'repeatRatio':0}
                    if not missing:rows.append(row)
                    slots.append({'area':area,'proposalShape':key,'category':'animal' if i<11 else 'object','id':None if missing else identifier})
                    counts.append({'area':area,'proposalShape':key,'validCandidates':0 if missing else 1,'requestOutcome':'no_valid_road_candidate' if missing else 'valid_road_candidates'})
            source=root/'roads.json';source.write_text(json.dumps({'status':'complete','results':rows,'reviewSlots':slots,'counts':counts}),encoding='utf-8')
            cat=root/'catalog.json';cat.write_text(json.dumps({'catalog':catalog}),encoding='utf-8')
            result=dr.export(source,cat,root/'out')
            self.assertEqual(result['requests'],75);self.assertEqual(result['missing'],1)
            self.assertEqual(len(result['species']),25);self.assertEqual(len(result['mapping']),74)
            self.assertEqual(len(result['pages']),5)
            page=(root/'out/blind.html').read_text(encoding='utf-8')
            self.assertNotIn('SECRET_KIND_',page);self.assertNotIn('SECRET_NAME_',page)
            self.assertNotIn('cheonan-buldang',page)
            gpx=ET.fromstring((root/'out/R001.gpx').read_text(encoding='utf-8'))
            points=gpx.findall('.//{http://www.topografix.com/GPX/1/1}trkpt')
            self.assertEqual(len(points),4)
            self.assertEqual(float(points[1].attrib['lat']),37.01)
            with self.assertRaises(ValueError):dr.export(source,cat,root/'out')
            data=json.loads(source.read_text(encoding='utf-8'))
            data['selectedDisplayRotations']={r['id']:90 for r in rows}
            source.write_text(json.dumps(data),encoding='utf-8')
            rotated=dr.export(source,cat,root/'rotated')
            self.assertTrue(all(r['rotation']==90 for r in rotated['mapping']))
            self.assertEqual((root/'out/R001.gpx').read_bytes(),(root/'rotated/R001.gpx').read_bytes())


if __name__=='__main__':unittest.main()
