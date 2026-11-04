import copy
import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('gate',ROOT/'scripts/recognition-lab/road-semantic-gate.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)


class SemanticGateTest(unittest.TestCase):
    def row(self):
        return {'id':'one','proposalShape':'house','generatorSimilarity':80,'score':.5,'xy':[[0,0],[1,0],[0,0]],'path':[1,2,1],'latlon':[[37,127],[38,127],[37,127]],'rotationAudit':[
            {'predictedClass':'bread','score':.5,'accepted':True,'rotation':0},
            {'predictedClass':'house','score':.4,'accepted':True,'rotation':33},
            {'predictedClass':'house','score':.45,'accepted':False,'rotation':123}]}

    def test_agreement_selects_supported_view_without_modifying_roads(self):
        row=self.row();original=copy.deepcopy(row);result=gate.gate_record(row)
        self.assertEqual(row,original)
        self.assertTrue(result['accepted'])
        self.assertEqual(result['rotation'],33)
        self.assertAlmostEqual(result['score'],.32)
        for key in ['xy','path','latlon']:self.assertEqual(result[key],row[key])

    def test_natural_or_mismatched_proposal_is_rejected(self):
        for proposal in [None,'rocket','mug']:
            row=self.row();row['proposalShape']=proposal
            self.assertFalse(gate.gate_record(row)['accepted'])


if __name__=='__main__':unittest.main()
