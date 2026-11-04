import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('ds',ROOT/'scripts/recognition-lab/diversity-score.py')
ds=importlib.util.module_from_spec(spec);spec.loader.exec_module(ds)


class DiversityScoreTest(unittest.TestCase):
    def fixture(self):
        catalog=[{'key':'bird','kind':'animal','shape':{'name':'새'},'freeNameAliases':['새','bird'],'headSupported':False,'clipSupported':True},
            {'key':'duck','kind':'animal','shape':{'name':'오리'},'freeNameAliases':['오리','duck'],'headSupported':False,'clipSupported':True}]
        mapping={'fingerprint':'f','mapping':[{'id':'one','token':'R001'}],
            'slots':[{'area':'a','proposalShape':'bird','id':'one'},{'area':'a','proposalShape':'duck','id':None}]}
        reviews=[{'fingerprint':'f','evaluatorAgent':str(i),'results':[{'token':'R001','name':'오리','clarity':'clear'}]} for i in range(3)]
        return mapping,catalog,reviews

    def test_different_named_animal_is_not_relabelled_as_target(self):
        result=ds.aggregate(*self.fixture())
        self.assertEqual(result['groups']['animal']['clearAny'],1)
        self.assertEqual(result['groups']['animal']['clearTarget'],0)
        self.assertEqual(result['cases'][0]['otherKnownClearInterpretations'],['duck'])
        self.assertEqual(result['groups']['animal']['requests'],2)
        self.assertEqual(result['cases'][1]['clarity'],'not_measured_no_route')
        self.assertFalse(result['humanRecognitionMeasured'])

    def test_exact_frozen_aliases_only(self):
        mapping,catalog,reviews=self.fixture()
        for r in reviews:r['results'][0]['name']=' BIRD! '
        self.assertTrue(ds.aggregate(mapping,catalog,reviews)['cases'][0]['targetClear'])
        for r in reviews:r['results'][0]['name']='unknown animal'
        self.assertFalse(ds.aggregate(mapping,catalog,reviews)['cases'][0]['targetClear'])

    def test_missing_rater_image_or_wrong_study_is_not_none(self):
        mapping,catalog,reviews=self.fixture();reviews[0]['results']=[]
        with self.assertRaises(ValueError):ds.aggregate(mapping,catalog,reviews)
        mapping,catalog,reviews=self.fixture();reviews[0]['fingerprint']='other'
        with self.assertRaises(ValueError):ds.aggregate(mapping,catalog,reviews)


if __name__=='__main__':unittest.main()
