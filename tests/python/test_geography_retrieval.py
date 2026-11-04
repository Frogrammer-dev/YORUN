import importlib.util
from pathlib import Path
import unittest
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
def load(name,path):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
geo=load('geo',ROOT/'scripts/recognition-lab/geography-retrieval.py')
fixture=load('oldtests',Path(__file__).with_name('test_image_query_retrieval.py'))

class GeographyRetrievalTest(unittest.TestCase):
    def args(self):
        args=list(fixture.ImageQueryTest().fixture())
        args[0]['results']=args[0]['results'][:225];args[1]=args[1][:225]
        return args

    def test_same_choices_scores_and_angles_as_frozen_v18(self):
        oldargs=fixture.ImageQueryTest().fixture();expected,diag=geo.old.retrieve(*oldargs)
        actual,newdiag=geo.retrieve(*self.args())
        self.assertEqual(diag,newdiag)
        for mode in actual:
            self.assertEqual(actual[mode]['selectedDisplayRotations'],expected[mode]['selectedDisplayRotations'])
            for a,b in zip(actual[mode]['reviewSlots'],expected[mode]['reviewSlots']):
                for key in ('id','retrievalScore','scoreType','handQueryFallback','proposalPoolRank'):
                    self.assertEqual(a[key],b[key])

    def test_missing_pool_preserves_every_slot_and_does_not_fallback_other_intent(self):
        args=self.args();args[0]['results']=args[0]['results'][3:];args[1]=args[1][3:]
        out,diag=geo.retrieve(*args)
        for result in out.values():
            self.assertEqual(len(result['reviewSlots']),75)
            self.assertIsNone(result['reviewSlots'][0]['id'])
            self.assertFalse(result['reviewSlots'][0]['validRoad'])
            self.assertIsNone(result['reviewSlots'][0]['retrievalScore'])
        self.assertEqual(diag[0]['representativeCandidates'],0)

    def test_entire_empty_generation_and_bad_scope(self):
        args=self.args();args[0]['results']=[];args[1]=np.empty((0,2))
        out,_=geo.retrieve(*args)
        self.assertTrue(all(s['id'] is None for result in out.values() for s in result['reviewSlots']))
        args=self.args();args[0]['reviewSlots'].pop()
        with self.assertRaises(ValueError):geo.retrieve(*args)

if __name__=='__main__':unittest.main()
