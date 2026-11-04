import copy
import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('score',ROOT/'scripts/recognition-lab/road-ranker-score.py')
scoring=importlib.util.module_from_spec(spec);spec.loader.exec_module(scoring)


class ScoreTest(unittest.TestCase):
    def mapping(self):
        return {'fingerprint':'frozen','mapping':[{'token':'R01','id':'road1'},{'token':'R02','id':'road2'}],
                'slots':[{'method':'baseline','area':'one','slot':1,'id':'road1'},
                         {'method':'baseline','area':'one','slot':2,'id':'road2'},
                         {'method':'model','area':'one','slot':1,'id':'road2'},
                         {'method':'model','area':'one','slot':2,'id':None}]}

    def review(self,rater,clarity):
        return {'evaluatorAgent':rater,'fingerprint':'frozen','evaluationType':'AI surrogate','results':[
            {'token':'R01','name':'없음','clarity':'none'},
            {'token':'R02','name':'망치','clarity':clarity}]}

    def test_majority_preserves_disagreement_and_abstention_denominator(self):
        result=scoring.score_majority(self.mapping(),[self.review('a','weak'),self.review('b','clear'),self.review('c','clear')])
        self.assertEqual(result['individual'][0]['methods']['model']['clear'],0)
        self.assertEqual(result['majority']['methods']['model']['clear'],1)
        self.assertEqual(result['majority']['methods']['model']['denominator'],2)
        self.assertEqual(result['majority']['methods']['model']['abstentions'],1)
        self.assertEqual(result['votes'][1]['exactSameNameClearVotes'],2)
        self.assertFalse(result['humanRecognitionMeasured'])

    def test_missing_or_wrong_study_or_duplicate_rater_is_rejected(self):
        review=self.review('a','clear')
        wrong=copy.deepcopy(review);wrong['fingerprint']='other'
        with self.assertRaises(ValueError):scoring.score(self.mapping(),wrong)
        missing=copy.deepcopy(review);missing['results'].pop()
        with self.assertRaises(ValueError):scoring.score(self.mapping(),missing)
        with self.assertRaises(ValueError):scoring.score_majority(self.mapping(),[review,review,review])

    def human_review(self,code,clarity):
        source=self.review('unused',clarity)
        return {'fingerprint':source['fingerprint'],'reviewerCode':code,'answers':source['results']}

    def test_human_mode_requires_three_distinct_people_and_rejects_ai_files(self):
        reviews=[self.human_review(f'P{i}','clear') for i in range(3)]
        with self.assertRaises(ValueError):scoring.score_human_majority(self.mapping(),reviews[:2])
        with self.assertRaises(ValueError):scoring.score_human_majority(self.mapping(),[reviews[0]]*3)
        ai=self.review('agent-a','clear');ai['reviewerCode']='AI-as-human'
        with self.assertRaises(ValueError):scoring.score_human_majority(self.mapping(),[reviews[0],reviews[1],ai])

    def test_human_majority_keeps_abstentions_and_request_denominators(self):
        reviews=[self.human_review('P01','weak'),self.human_review('P02','clear'),self.human_review('P03','clear')]
        result=scoring.score_human_majority(self.mapping(),reviews)
        self.assertEqual(result['majorityThreshold'],2)
        self.assertEqual(result['majority']['methods']['model']['clear'],1)
        self.assertEqual(result['majority']['methods']['model']['denominator'],2)
        self.assertEqual(result['majority']['methods']['model']['abstentions'],1)
        self.assertEqual(result['majority']['methods']['model']['requestSuccessRate'],1)
        self.assertFalse(result['reviewerIdentityVerified'])

    def test_even_number_of_humans_needs_strict_majority(self):
        reviews=[self.human_review(f'P{i}','clear' if i<2 else 'weak') for i in range(4)]
        result=scoring.score_human_majority(self.mapping(),reviews)
        self.assertEqual(result['majorityThreshold'],3)
        self.assertEqual(result['majority']['methods']['model']['clear'],0)


if __name__=='__main__':unittest.main()
