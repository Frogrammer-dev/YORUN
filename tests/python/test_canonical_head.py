import copy
import importlib.util
from pathlib import Path
import unittest
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('canon',ROOT/'scripts/recognition-lab/canonical-head.py')
canon=importlib.util.module_from_spec(spec);spec.loader.exec_module(canon)


class CanonicalHeadTest(unittest.TestCase):
    def fixture(self):
        views=np.array([[[1.,0.],[0.,1.],[0.,1.],[0.,1.]]])
        means=np.array([[1.,3.]])/np.sqrt(10)
        model={'weights':np.eye(2),'bias':np.zeros(2),'policy':{'rejectAll':False,'marginThreshold':0}}
        labels=[{'name':'dog','key':'dog','object':True},{'name':'chair','key':'chair','object':True}]
        rows=[{'id':'r','proposalShape':'dog','xy':[[0,0],[1,0],[0,0]],'latlon':[[37,127],[37,128],[37,127]],'generatorPlacement':{'rotDeg':37.5}}]
        return rows,views,means,model,labels

    def test_canonical_information_changes_classification_without_faking_views_or_coordinates(self):
        rows,v,m,model,labels=self.fixture();original=copy.deepcopy(rows)
        a=canon.canonical_rank(rows,v,m,model,labels,'mean4')[0]
        b=canon.canonical_rank(rows,v,m,model,labels,'canonical0')[0]
        self.assertEqual(a['predictedClass'],'chair');self.assertEqual(b['predictedClass'],'dog')
        for row in [a,b]:
            self.assertEqual(row['displayViewIndex'],0);self.assertEqual(row['rotation'],322.5)
            self.assertEqual(row['viewClassScores'],v[0].tolist())
            self.assertEqual(row['xy'],rows[0]['xy']);self.assertEqual(row['latlon'],rows[0]['latlon'])
        self.assertEqual(rows,original)

    def test_legacy_mean_class_scores_and_decisions_are_identical(self):
        rows,v,m,model,labels=self.fixture()
        old=canon.base.rank_records(rows,v,m,model,labels)[0]
        now=canon.canonical_rank(rows,v,m,model,labels,'mean4')[0]
        for field in ['predictedClass','pooledClassScores','margin','accepted','score']:self.assertEqual(old[field],now[field])
        self.assertNotEqual(old['displayViewIndex'],now['displayViewIndex'])

    def test_representation_shape_and_source_field_collisions_reject(self):
        rows,v,m,model,labels=self.fixture()
        with self.assertRaises(ValueError):canon.classification_features(v,m,'select-best-view')
        with self.assertRaises(ValueError):canon.classification_features(v[:,:2],m,'canonical0')
        rows[0]['canonicalDisplayApplied']=False
        with self.assertRaises(ValueError):canon.canonical_rank(rows,v,m,model,labels,'canonical0')


if __name__=='__main__':unittest.main()
