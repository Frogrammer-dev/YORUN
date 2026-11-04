import importlib.util
import copy
import tempfile
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('pool',ROOT/'scripts/recognition-lab/pool-diagnostic.py')
pool=importlib.util.module_from_spec(spec);spec.loader.exec_module(pool)


class PoolTest(unittest.TestCase):
    def fixture(self):
        rows=[];slots=[]
        for area in ['a','b','c']:
            for key in [f'kind{i}' for i in range(25)]:
                for i in range(3):rows.append({'id':area+key+str(i),'area':area,'proposalShape':key,'geometryKey':area+key+'g'+str(i),
                    'generatorPlacement':{'rotDeg':33},'generatorSimilarity':100-i,'proposalPoolRank':i+1})
                slots.append({'area':area,'proposalShape':key,'category':'animal','id':area+key+'0','validRoad':True})
        while len(rows)<1003:rows.append({'id':'unused'+str(len(rows)),'area':'a','proposalShape':None,'geometryKey':'extra'+str(len(rows))})
        return {'status':'complete','results':rows,'reviewSlots':slots,'counts':[]}

    def test_alternatives_ignore_scores_exclude_baseline_and_preserve_all_source_rows(self):
        source=self.fixture();original=copy.deepcopy(source);out=pool.choose(source,'s','p')
        self.assertEqual(source,original)
        for d in out:
            self.assertEqual(d['results'],source['results']);self.assertEqual(len(d['reviewSlots']),75)
            self.assertTrue(all(s['id']!=s['baselineIdForDiagnostic'] for s in d['reviewSlots']))
        first=[[s['id'] for s in d['reviewSlots']] for d in out]
        for r in source['results']:r['generatorSimilarity']=-999
        again=pool.choose(source,'newhash','p')
        self.assertEqual(first,[[s['id'] for s in d['reviewSlots']] for d in again])
        self.assertTrue(all(a!=b for a,b in zip(*first)))

    def test_same_geometry_different_id_is_not_an_alternative_and_missing_stays(self):
        source=self.fixture();source['results'][1]['geometryKey']=source['results'][0]['geometryKey'];source['results'][2]['geometryKey']=source['results'][0]['geometryKey']
        out=pool.choose(source,'s','p')
        self.assertIsNone(out[0]['reviewSlots'][0]['id']);self.assertIsNone(out[1]['reviewSlots'][0]['id'])
        self.assertEqual(len(out[1]['reviewSlots']),75)
        source['results'][1]['id']=source['results'][0]['id']
        with self.assertRaises(ValueError):pool.choose(source,'s','p')

    def test_union_is_a_sampled_lower_bound_and_primary_uses_frozen_identity(self):
        source=self.fixture();baseline=[];alt=[]
        for i,s in enumerate(source['reviewSlots']):
            raw={'token':'T'+str(i),'name':'bird','clarity':'none'}
            baseline.append({**s,'token':raw['token'],'kind':'animal','targetClear':False,'ratings':[raw,raw,raw],'missingRoute':False})
            alt.append({**s,'token':raw['token'],'kind':'animal','targetClear':i<6,'ratings':[{**raw,'clarity':'clear' if i<6 else 'none'},raw,{**raw,'clarity':'clear'}],'missingRoute':False})
        raters=sorted(pool.RATERS-{pool.PRIMARY})+[pool.PRIMARY]
        base={'cases':baseline,'raters':raters};a={'cases':alt,'raters':raters};second=copy.deepcopy(a)
        for c in a['cases']:c['id']+='-alt1'
        for c in second['cases']:c['id']+='-alt2'
        catalog=[{'key':f'kind{i}','kind':'animal','freeNameAliases':['bird']} for i in range(25)]
        result=pool.union(base,[a,second],catalog)
        self.assertEqual(result['summary']['majority']['additionalMissedRequests'],6)
        self.assertEqual(result['summary']['primary']['additionalMissedRequests'],75)
        self.assertFalse(result['modelImprovementVerified']);self.assertFalse(result['completePoolOracle'])
        bad=copy.deepcopy(a);bad['cases'][0]['ratings'][0]['token']='another-image'
        with self.assertRaisesRegex(ValueError,'Rating token'):pool.union(base,[bad,second],catalog)
        a['cases'].pop()
        with self.assertRaises(ValueError):pool.union(base,[a,second],catalog)

    def test_binding_rejects_wrong_selected_ids_repeated_study_and_catalog(self):
        source=self.fixture();selections=pool.choose(source,'source','protocol')
        manifests=[];studies=[]
        for i,selected in enumerate([source,*selections]):
            images=[];cases=[]
            for n,s in enumerate(selected['reviewSlots']):
                token=f'R{n+1:03d}' if s['id'] else None
                if s['id']:images.append({'id':s['id'],'token':token,'area':s['area'],'proposalShape':s['proposalShape']})
                cases.append({**s,'token':token,'missingRoute':s['id'] is None})
            manifests.append({'fingerprint':f'fp{i}','inputSHA256':['source','alt1','alt2'][i],'catalogSHA256':'cat','slots':selected['reviewSlots'],'mapping':images})
            studies.append({'fingerprint':f'fp{i}','cases':cases})
        args=[source,selections,manifests,studies,'source',['alt1','alt2'],'cat']
        pool.validate_linkage(*args)
        studies[1]['cases'][0]['id']=studies[0]['cases'][0]['id']
        with self.assertRaisesRegex(ValueError,'ID/missing'):pool.validate_linkage(*args)
        studies[1]['cases'][0]['id']=selections[0]['reviewSlots'][0]['id']
        studies[2]['fingerprint']='fp1'
        with self.assertRaisesRegex(ValueError,'another review'):pool.validate_linkage(*args)
        studies[2]['fingerprint']='fp2';manifests[2]['catalogSHA256']='other'
        with self.assertRaisesRegex(ValueError,'catalog'):pool.validate_linkage(*args)
        manifests[2]['catalogSHA256']='cat'
        with self.assertRaisesRegex(ValueError,'Repeated'):pool.validate_linkage(source,[selections[0],selections[0]],[manifests[0],manifests[1],manifests[1]],[studies[0],studies[1],studies[1]],'source',['alt1','alt1'],'cat')

    def test_frozen_mapping_bytes_cannot_change_under_existing_fingerprint(self):
        temp=ROOT/'eval/recognition/tmp';temp.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temp) as name:
            p=Path(name)/'mapping.json';p.write_text('original mapping')
            lock={'files':{str(p.resolve()):pool.sha(p.read_bytes())}}
            pool.verify_lock(lock,[p]);p.write_text('swapped tokens with same claimed fingerprint')
            with self.assertRaisesRegex(ValueError,'changed'):pool.verify_lock(lock,[p])


if __name__=='__main__':unittest.main()
