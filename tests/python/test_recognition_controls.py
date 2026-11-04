import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('controls',ROOT/'scripts/recognition-lab/recognition-controls.py')
controls=importlib.util.module_from_spec(spec);spec.loader.exec_module(controls)


class ControlsTest(unittest.TestCase):
    def test_separate_strokes_are_not_joined(self):
        image=controls.draw_strokes([[[-1,-1],[-1,1]],[[1,-1],[1,1]]])
        self.assertEqual(image.getpixel((150,150)),(255,255,255))
        self.assertNotEqual(image.getpixel((20,150)),(255,255,255))

    def test_full_scope_hash_sampling_missing_rocket_and_anonymous_html(self):
        temp=ROOT/'eval/recognition/tmp';temp.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temp) as name:
            root=Path(name);catalog=[];classes=[];records=[]
            for i in range(25):
                key=f'target{i}' if i<24 else 'rocket'
                catalog.append({'key':key,'kind':'animal' if i<11 else 'object','shape':{'points':[[0,0],[1,0],[.5,1],[0,0]]},'aliases':[key],'freeNameAliases':[key]})
                if i<24:classes.append({'name':key,'object':True})
            classes.extend({'name':f'generic{i}','object':False} for i in range(8))
            for c in classes:
                for i in range(3):
                    records.append({'id':c['name']+str(i),'className':c['name'],'groupSHA256':'group-'+c['name']+str(i),'split':'test','sourceRecognized':True,'strokes':[[[0,0],[1,i+.5]]]})
            cat=root/'catalog.json';cat.write_text(json.dumps({'catalog':catalog}))
            dataset=root/'dataset.json';dataset.write_text(json.dumps({'classes':classes,'records':records}))
            protocol=root/'protocol.md';protocol.write_text('frozen')
            m=controls.export(cat,dataset,protocol,root/'out')
            self.assertEqual(len(m['mapping']),89);self.assertEqual(len(m['pages']),6)
            self.assertEqual(m['missing'][0]['target'],'rocket')
            self.assertEqual(len({r['sourceId'] for r in m['mapping'] if r['sourceId']}),64)
            page=(root/'out/blind.html').read_text(encoding='utf-8')
            self.assertNotIn('target0',page);self.assertNotIn('rocket',page);self.assertNotIn('generic0',page)
            self.assertIn('이 선은',page);self.assertFalse(m['actualRoadsIncluded'])
            with self.assertRaises(ValueError):controls.export(cat,dataset,protocol,root/'out')
            actual={r['sourceId'] for r in m['mapping'] if r['sourceId']}
            records.reverse();dataset.write_text(json.dumps({'classes':classes,'records':records}))
            other=controls.export(cat,dataset,protocol,root/'other')
            self.assertEqual(actual,{r['sourceId'] for r in other['mapping'] if r['sourceId']})
            records.append({**records[0],'id':'another-id-same-group'})
            dataset.write_text(json.dumps({'classes':classes,'records':records}))
            grouped=controls.export(cat,dataset,protocol,root/'grouped')
            self.assertEqual(len({r['sourceGroup'] for r in grouped['mapping'] if r['sourceId']}),64)
            controls.verify_files(root/'out/mapping.json',cat)
            (root/'out/Q001.png').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'Individual'):controls.verify_files(root/'out/mapping.json',cat)

    def test_other_species_is_not_target_and_missing_ratings_reject(self):
        manifest={'fingerprint':'f','mapping':[{'token':'Q001','group':'template','target':'bird'},{'token':'Q002','group':'sketch','target':'bird'},{'token':'Q003','group':'generic','target':None}],
            'missing':[{'target':'rocket','planned':2}]}
        catalog=[{'key':'bird','freeNameAliases':['새','bird']}]
        reviews=[{'fingerprint':'f','evaluatorAgent':controls.PRIMARY if i==0 else str(i),'results':[{'token':'Q001','name':'새','clarity':'clear'},{'token':'Q002','name':'오리','clarity':'clear'},{'token':'Q003','name':'없음','clarity':'none'}]} for i in range(3)]
        result=controls.aggregate(manifest,catalog,reviews)
        self.assertEqual(result['groups']['template']['targetClear'],1)
        self.assertEqual(result['groups']['sketch']['targetClear'],0)
        self.assertEqual(result['groups']['sketch']['clearAny'],1)
        self.assertFalse(result['actualRoadRecognitionMeasured'])
        self.assertEqual(result,controls.aggregate(manifest,catalog,list(reversed(reviews))))
        reviews[0]['results'].pop()
        with self.assertRaises(ValueError):controls.aggregate(manifest,catalog,reviews)


if __name__=='__main__':unittest.main()
