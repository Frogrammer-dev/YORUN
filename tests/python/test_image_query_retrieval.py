import copy
import importlib.util
from pathlib import Path
import unittest
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('iq',ROOT/'scripts/recognition-lab/image-query-retrieval.py')
iq=importlib.util.module_from_spec(spec);spec.loader.exec_module(iq)


class ImageQueryTest(unittest.TestCase):
    def fixture(self):
        keys=[f'k{i}' for i in range(24)]+['rocket']
        catalog=[{'key':k,'aliases':[k]} for k in keys];rows=[];slots=[]
        for area in ['a','b','c']:
            for key in keys:
                for i in range(3):rows.append({'id':area+key+str(i),'area':area,'proposalShape':key,'geometryKey':area+key+'g'+str(i),
                    'generatorSimilarity':99-i,'generatorPlacement':{'rotDeg':33},'proposalPoolRank':i+1})
                slots.append({'area':area,'proposalShape':key,'id':area+key+'0','category':'object','validRoad':True})
        while len(rows)<1003:rows.append({'id':'unused'+str(len(rows)),'area':'a','proposalShape':None})
        x=np.tile([1.,0.],(1003,1))
        for i in range(225):x[i]=[[.8,.6],[1.,0.],[0.,1.]][i%3]
        source={'status':'complete','results':rows,'reviewSlots':slots,'counts':[]}
        labels=[{'name':k,'key':k,'object':True} for k in keys[:-1]]
        return source,x,catalog,keys,np.tile([1.,0.],(25,1)),labels,np.tile([[0.],[1.]],(1,24))

    def test_equal_coverage_different_queries_and_explicit_rocket_fallback(self):
        args=self.fixture();original=copy.deepcopy(args[0]);out,diag=iq.retrieve(*args)
        for mode,d in out.items():
            self.assertEqual(d['results'],original['results']);self.assertEqual(len(d['reviewSlots']),75)
            self.assertTrue(all(s['id'] for s in d['reviewSlots']))
        self.assertEqual(out['geometry']['reviewSlots'][0]['id'],'ak00')
        self.assertEqual(out['hand']['reviewSlots'][0]['id'],'ak02')
        self.assertEqual(out['image']['reviewSlots'][0]['id'],'ak01')
        rocket=[s for s in out['hand']['reviewSlots'] if s['proposalShape']=='rocket']
        self.assertEqual(len(rocket),3);self.assertTrue(all(s['handQueryFallback'] and s['scoreType']=='geometry' for s in rocket))
        self.assertFalse(any(s['handQueryFallback'] for s in out['image']['reviewSlots']))
        self.assertEqual(args[0],original);self.assertEqual(len(diag),75)

    def test_representative_is_fixed_before_scoring_not_best_view_per_geometry(self):
        args=self.fixture();args[0]['results'][1]['geometryKey']=args[0]['results'][0]['geometryKey']
        out,_=iq.retrieve(*args)
        self.assertEqual(out['image']['reviewSlots'][0]['id'],'ak00')
        self.assertEqual(out['image']['selectedDisplayRotations']['ak00'],327)

    def test_bad_embedding_and_scope_reject(self):
        args=list(self.fixture());args[1][0]=[0,0]
        with self.assertRaises(ValueError):iq.retrieve(*args)
        args=list(self.fixture());args[3]=args[3][:-1]
        with self.assertRaises(ValueError):iq.retrieve(*args)


if __name__=='__main__':unittest.main()
