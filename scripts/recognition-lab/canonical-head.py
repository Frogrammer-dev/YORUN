"""Controlled canonical-view ablation; reuses frozen ridge/prototype functions.

No road/human labels fit the model. Both checkpoint types display canonical view0.
Legacy mean checkpoints keep their weights and classification unchanged.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import time
import numpy as np

spec=importlib.util.spec_from_file_location('base_head',Path(__file__).with_name('sketch-head.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)


def classification_features(views,means,representation):
    if views.ndim!=3 or views.shape[1]!=4 or means.shape!=(views.shape[0],views.shape[2]):raise ValueError('Four cached views and aligned means required')
    if not np.isfinite(views).all() or not np.isfinite(means).all():raise ValueError('Nonfinite features')
    if representation=='canonical0':return views[:,0].copy()
    if representation=='mean4':return means
    raise ValueError('Unknown representation')


def canonical_rank(rows,views,means,model,labels,representation):
    for row in rows:
        if 'classificationRepresentation' in row or 'canonicalDisplayApplied' in row:raise ValueError('Refusing to overwrite original source fields')
    inputs=classification_features(views,means,representation)
    outputs=base.rank_records(rows,views,inputs,model,labels)
    for row in outputs:
        row['rotation']=(-float(row.get('generatorPlacement',{}).get('rotDeg',0)))%360
        row['displayViewIndex']=0
        row['classificationRepresentation']=representation
        row['canonicalDisplayApplied']=True
    return outputs


def train(args):
    began=time.perf_counter()
    if args.checkpoint.exists() or args.report.exists() or args.checkpoint.resolve()==args.report.resolve():raise ValueError('Use fresh distinct checkpoint/report paths')
    protocol_hash=base.sha(args.protocol)
    dataset=json.loads(args.dataset.read_text(encoding='utf-8'));labels,y,splits=base.validate_dataset(dataset)
    views,means,ids=base.load_features(args.features,[r['id'] for r in dataset['records']])
    provenance=base.feature_provenance(args.features,args.dataset,'dataset')
    if provenance.get('sidecarVerified') is not True:raise ValueError('Verified extractor sidecar required')
    inputs=classification_features(views,means,'canonical0')
    state=base.fit_experiment(inputs,y,splits,labels)
    models={m:{k:v for k,v in state[m].items() if k not in ('weights','bias')} for m in ('head','prototype')}
    meta={'schemaVersion':1,'classLabels':labels,'dimensions':inputs.shape[1],'views':4,'representation':'canonical0',
        'models':models,'lambdaGrid':state['lambdaGrid'],'selectedLambda':state['head']['lambda'],'classWeights':state['classWeights'].tolist(),
        'splitClassCounts':{s:np.bincount(y[splits==s],minlength=len(labels)).tolist() for s in base.SPLITS},
        'datasetSHA256':base.sha(args.dataset),'featuresSHA256':base.sha(args.features),'protocolSHA256':protocol_hash,
        'codeSHA256':base.sha(__file__),'baseCodeSHA256':base.sha(base.__file__),'featureProvenance':provenance,'idsVerifiedInFeatures':ids,
        'trainingInput':'cached canonical view0 only;train-only balanced ridge/prototype;unchanged val-only lambda and gate',
        'displayRule':'canonical view0 for both mean4 and canonical0;rotation=-generatorPlacement.rotDeg;no best-view selection',
        'humanRecognitionMeasured':False,'roadLabelsUsedForTraining':False,'testAlreadyUsedInPriorExperiments':True,
        'elapsedSeconds':time.perf_counter()-began}
    args.checkpoint.parent.mkdir(parents=True,exist_ok=True)
    with args.checkpoint.open('xb') as stream:base.save_checkpoint(stream,state,meta)
    base.write_json(args.report,{**meta,'checkpointSHA256':base.sha(args.checkpoint)})
    print(json.dumps({'selectedLambda':meta['selectedLambda'],'headTest':models['head']['testMetrics'],'prototypeTest':models['prototype']['testMetrics']}),flush=True)


def rank(args):
    if args.output.exists() or args.report.exists() or args.output.resolve()==args.report.resolve():raise ValueError('Use fresh distinct ranking/report paths')
    models,meta=base.load_checkpoint(args.checkpoint)
    representation=meta.get('representation')
    if representation is None:
        if not meta.get('trainingInput','').startswith('mean unchanged'):raise ValueError('Unrecognized legacy representation contract')
        representation='mean4'
    raw=args.roads.read_bytes();data=json.loads(raw)
    if data.get('status')!='complete':raise ValueError('Complete source roads required')
    rows=data['results']
    if not rows or len({r['id'] for r in rows})!=len(rows):raise ValueError('Unique nonempty road IDs required')
    views,means,ids=base.load_features(args.features,[r['id'] for r in rows])
    provenance=base.feature_provenance(args.features,args.roads,'roads')
    compatibility=base.verify_feature_compatibility(meta,provenance)
    if means.shape[1]!=meta['dimensions']:raise ValueError('Feature/checkpoint dimension mismatch')
    outputs=canonical_rank(rows,views,means,models[args.mode],meta['classLabels'],representation)
    summary={'method':f'v17-{representation}-{args.mode}-canonical-display','mode':args.mode,'representation':representation,'classLabels':meta['classLabels'],
        'inputSHA256':base.sha(args.roads),'featuresSHA256':base.sha(args.features),'checkpointSHA256':base.sha(args.checkpoint),
        'trainingDatasetSHA256':meta['datasetSHA256'],'protocolSHA256':base.sha(args.protocol),'trainingProtocolSHA256':meta['protocolSHA256'],
        'codeSHA256':base.sha(__file__),'baseCodeSHA256':base.sha(base.__file__),'featureProvenance':provenance,'featureCompatibility':compatibility,
        'idsVerifiedInFeatures':ids,'displayRule':'canonical view0 for both methods','perViewScores':'all four genuine cached-view scores;NOT duplicated view0',
        'candidateCount':len(rows),'acceptedCount':sum(x['accepted'] for x in outputs),'gate':models[args.mode]['policy'],
        'sourceCoordinatesChanged':False,'humanRecognitionMeasured':False,'roadValidityCheckedByThisScript':False,'intentGateApplied':False}
    base.write_json(args.output,{**summary,'outputs':outputs});base.write_json(args.report,{**summary,'outputSHA256':base.sha(args.output)})
    print(json.dumps({'representation':representation,'roads':len(rows),'accepted':summary['acceptedCount']}),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    t=sub.add_parser('train');t.add_argument('--dataset',type=Path,required=True)
    t.add_argument('--features',type=Path,required=True);t.add_argument('--checkpoint',type=Path,required=True);t.add_argument('--protocol',type=Path,required=True);t.add_argument('--report',type=Path,required=True)
    t=sub.add_parser('rank');t.add_argument('--roads',type=Path,required=True);t.add_argument('--features',type=Path,required=True);t.add_argument('--checkpoint',type=Path,required=True)
    t.add_argument('--mode',choices=['head','prototype'],required=True);t.add_argument('--output',type=Path,required=True);t.add_argument('--report',type=Path,required=True);t.add_argument('--protocol',type=Path,required=True)
    args=p.parse_args();train(args) if args.command=='train' else rank(args)
