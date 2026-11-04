import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('human_score',ROOT/'scripts/recognition-lab/geography-human-score.py')
scoring=importlib.util.module_from_spec(spec);spec.loader.exec_module(scoring)

CATALOG=[{'key':'fish','kind':'animal','freeNameAliases':['물고기','생선']},{'key':'mug','kind':'object','freeNameAliases':['머그','컵']}]
USES={'H1':[('geometry','fish'),('hand','fish'),('image','fish')],'H2':[('geometry','mug'),('hand','mug'),('image','mug')]}


def mapping():
    return {'fingerprint':'human','requests':2,'pictures':2,'mapping':[
        {'token':t,'pixelSHA256':t.lower(),'uses':[{'method':m,'area':'a','proposalShape':k} for m,k in uses]} for t,uses in USES.items()]}


def batch():return {'fingerprint':'ai','mapping':[{'token':'K1','pixelSHA256':'h1'},{'token':'K2','pixelSHA256':'h2'}]}


def ai(rater,first=('물고기','clear'),second=('없음','none')):
    return {'evaluatorAgent':rater,'fingerprint':'ai','results':[{'token':'K1','name':first[0],'clarity':first[1]},{'token':'K2','name':second[0],'clarity':second[1]}]}


def human(code,first=('물고기','clear'),second=('없음','none'),exposure='none',fingerprint='human'):
    return {'fingerprint':fingerprint,'reviewerCode':code,'exposure':exposure,'answers':[{'token':'H1','name':first[0],'clarity':first[1]},{'token':'H2','name':second[0],'clarity':second[1]}]}


def run(*reviews):
    return scoring.score(mapping(),batch(),[ai('a'),ai('b'),ai('c')],list(reviews),CATALOG)


class HumanScoreTest(unittest.TestCase):
    def test_under_three_naive_is_only_a_pilot(self):
        self.assertEqual(run(human('P1'),human('P2')).get('decision'),'pilot')

    def test_prior_exposure_is_excluded_from_primary_and_reported_separately(self):
        result=run(human('N1',second=('없음','none')),human('D',first=('없음','none'),exposure='prior'))
        self.assertEqual((result['naiveParticipants'],result['priorExposureParticipants']),(1,1))
        self.assertEqual(result['primaryNaiveOnly']['humanClearFixed'],1)
        self.assertEqual(result['secondaryAllParticipants']['humanClearFixed'],0)
        self.assertEqual(result['decision'],'pilot')

    def test_target_requires_majority_alias_and_method_denominator_stays_fixed(self):
        result=run(human('N1'),human('N2'),human('N3',first=('고래','clear')))
        image=result['primaryNaiveOnly']['methods']['image']
        self.assertEqual((image['targetClear'],image['requests'],image['animalTargetClear']),(1,2,1))
        split=run(human('N1'),human('N2',first=('고래','clear')),human('N3',first=('상어','clear')))['primaryNaiveOnly']
        self.assertEqual(split['humanClearFixed'],1)
        self.assertEqual(split['methods']['image']['targetClear'],0)
        self.assertEqual([x['name'] for x in split['unregisteredHumanClearNames']],['고래','상어'])

    def test_exact_same_unregistered_name_agrees_without_counting_as_target(self):
        raters=[ai(x,first=('고래','clear')) for x in 'abc']
        result=scoring.score(mapping(),batch(),raters,[human(c,first=('고래','clear')) for c in ('N1','N2','N3')],CATALOG)['primaryNaiveOnly']
        self.assertEqual((result['bothClearSameName'],result['bothClearDenominator']),(1,1))
        self.assertEqual(result['methods']['image']['targetClear'],0)

    def test_confusion_and_kappa(self):
        result=run(human('N1',first=('없음','none'),second=('컵','clear')),human('N2',first=('없음','none'),second=('컵','clear')),human('N3',first=('없음','none'),second=('컵','clear')))['primaryNaiveOnly']
        self.assertEqual(result['fixedConfusion'],{'bothClear':0,'aiOnlyClear':1,'humanOnlyClear':1,'neitherClear':0})
        self.assertEqual((result['precision'],result['recallFixed'],result['aiMissedFixed']),(0,0,1))
        self.assertAlmostEqual(result['kappaFixedReportOnly'],-1)

    def test_supplement_counts_for_precision_only(self):
        data=mapping();data['mapping'][0]['stratum']='aiClearSupplement';data['mapping'][1]['stratum']='fixed'
        data['requests']=1;data['mapping'][0]['uses']=[]
        data['mapping'][1]['uses']=[{'method':m,'area':'a','proposalShape':'mug'} for m in ('geometry','hand','image')]
        result=scoring.score(data,batch(),[ai('a'),ai('b'),ai('c')],[human(c) for c in ('N1','N2','N3')],CATALOG)
        primary=result['primaryNaiveOnly']
        self.assertEqual((primary['aiClearAll'],primary['aiClearAlsoHumanClear'],primary['precision']),(1,1,1))
        self.assertEqual(primary['fixedConfusion'],{'bothClear':0,'aiOnlyClear':0,'humanOnlyClear':0,'neitherClear':1})
        self.assertIsNone(primary['recallFixed'])
        self.assertEqual(primary['methods']['image']['targetClear'],0)
        self.assertEqual(result['decision'],'ai_clear_supported')

    def test_decision_thresholds(self):
        v=scoring.verdict
        self.assertEqual(v(2,1,9,1),'pilot')
        self.assertEqual(v(3,.49,0,None),'ai_proxy_unsuitable')
        self.assertEqual(v(3,1,5,.29),'ai_proxy_unsuitable')
        self.assertEqual(v(3,1,4,0),'ai_clear_supported')
        self.assertEqual(v(3,.7,5,.3),'ai_clear_supported')
        self.assertEqual(v(3,.69,5,.4),'hold')
        self.assertEqual(v(3,.5,0,None),'hold')

    def test_rejects_invalid_answers(self):
        for bad in (human('N1',fingerprint='old'),{**human('N1'),'evaluatorAgent':'x'},{**human('N1'),'reviewerCode':' '}):
            with self.assertRaises(ValueError):run(bad)
        with self.assertRaises(ValueError):run(human('N1'),human('N1'))
        short=human('N1');short['answers']=short['answers'][:1]
        with self.assertRaises(ValueError):run(short)


if __name__=='__main__':
    unittest.main()
