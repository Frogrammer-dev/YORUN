import importlib.util
import json
import copy
from pathlib import Path
import tempfile
import unittest
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('bridge',ROOT/'scripts/recognition-lab/diversity-bridge.py')
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)


class BridgeTest(unittest.TestCase):
    def folder(self,path,shapes):
        path.mkdir();im=Image.new('RGB',(900,330),'white');d=ImageDraw.Draw(im)
        for i,shape in enumerate(shapes):
            d.text((i*300+12,8),f'R{i+1:03d}',fill='black')
            d.line([(i*300+40,80),(i*300+200,80+shape*70)],fill='#172f45',width=3)
        im.save(path/'page.png')
        (path/'mapping.json').write_text(json.dumps({'fingerprint':path.name,'mapping':[{'token':f'R{i+1:03d}'} for i in range(len(shapes))],
            'pages':[{'file':'page.png','SHA256':bridge.digest((path/'page.png').read_bytes())}]}))

    def test_conflicting_prior_answers_are_not_cherry_picked(self):
        temp=ROOT/'eval/recognition/tmp';temp.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temp) as name:
            root=Path(name);self.folder(root/'old',[0,0]);self.folder(root/'new',[0,1])
            reviews=[]
            for i in range(3):
                path=root/f'r{i}.json';path.write_text(json.dumps({'fingerprint':'old','evaluatorAgent':str(i),
                    'results':[{'token':'R001','name':'cat','clarity':'clear'},{'token':'R002','name':'dog' if i==0 else 'cat','clarity':'clear'}]}));reviews.append(path)
            frozen=bridge.prepare(root/'old',reviews,[root/'new'],root/'out')
            self.assertEqual(len(frozen['pendingTokens']),2)
            self.assertEqual(len(frozen['conflictingOldRatings']),1)
            response={'evaluatorAgent':'0','fingerprint':frozen['fingerprint'],
                      'results':[{'token':t,'name':'new answer','clarity':'weak'} for t in frozen['pendingTokens']]}
            merged=bridge.merge(frozen,response,root/'out')[0]['review'];self.assertEqual(merged['exactPixelRatingsReused'],0)
            self.assertTrue(all(r['name']=='new answer' for r in merged['results']))
            response['evaluatorAgent']='1';merged=bridge.merge(frozen,response,root/'out')[0]['review']
            self.assertEqual(merged['exactPixelRatingsReused'],1);self.assertEqual(merged['results'][0]['name'],'cat')
            self.folder(root/'extra',[1]);extra_reviews=[]
            for i in range(3):
                path=root/f'extra-r{i}.json';path.write_text(json.dumps({'fingerprint':'extra','evaluatorAgent':str(i),
                    'results':[{'token':'R001','name':'fish','clarity':'weak'}]}));extra_reviews.append(path)
            multiple=bridge.prepare(root/'old',reviews,[root/'new'],root/'out2',[(root/'extra',extra_reviews)])
            self.assertEqual(len(multiple['pendingTokens']),1)
            extra_response={'evaluatorAgent':'1','fingerprint':multiple['fingerprint'],
                'results':[{'token':t,'name':'unused where old agrees','clarity':'none'} for t in multiple['pendingTokens']]}
            extra_merged=bridge.merge(multiple,extra_response,root/'out2')[0]['review']
            self.assertEqual(extra_merged['exactPixelRatingsReused'],2)
            self.assertEqual(extra_merged['results'][1]['name'],'fish')
            response['results'].pop()
            with self.assertRaises(ValueError):bridge.merge(frozen,response,root/'out')
            changed=copy.deepcopy(frozen);changed['studies'][0]['rows'].pop()
            with self.assertRaisesRegex(ValueError,'fingerprint'):bridge.merge(changed,response,root/'out')
            (root/'out/page-1.png').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'image changed'):bridge.merge(frozen,response,root/'out')
            m=bridge.read(root/'old/mapping.json');m['mapping'].reverse()
            (root/'old/mapping.json').write_text(json.dumps(m))
            with self.assertRaisesRegex(ValueError,'order'):bridge.bodies(root/'old')
            m['mapping']=[{'token':'R001'},{'token':'R001'}]
            (root/'old/mapping.json').write_text(json.dumps(m))
            with self.assertRaisesRegex(ValueError,'order'):bridge.bodies(root/'old')
            m['mapping']=[{'token':'R001'},{'token':'R002'}]
            (root/'old/mapping.json').write_text(json.dumps(m))
            (root/'old/page.png').write_bytes(b'changed')
            with self.assertRaises(ValueError):bridge.bodies(root/'old')


if __name__=='__main__':unittest.main()
