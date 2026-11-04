"""Fixed-pool conditional retrieval: geometry, train-sketch query, original-image query.

No class-winner/margin gate, road-coordinate changes, or human/AI label fitting.
"""
import argparse
import copy
import importlib.util
import json
from pathlib import Path
import time
import numpy as np

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
head=module('query_head','sketch-head.py');renderer=module('query_renderer','sketch-features.py')
ROOT=Path(__file__).resolve().parents[2]
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def unit(x):
    x=np.asarray(x,dtype=np.float64);n=np.linalg.norm(x,axis=-1,keepdims=True)
    if x.ndim!=2:raise ValueError('Embedding matrix required')
    if not np.isfinite(x).all() or np.any(n<=1e-12):raise ValueError('Finite nonzero embeddings required')
    return x/n


def extract(args):
    if args.out.exists():raise ValueError('Use an entirely new query cache folder')
    protocol_hash=head.sha(args.protocol)
    # Compare the actual snapshot/processor files with the during-v12 disk audit.
    audit=read(args.encoder_audit);cache=ROOT/'eval/recognition/model-cache/hub'
    snapshot=cache/'models--openai--clip-vit-base-patch32'/'snapshots'/audit['localRef']
    for f in audit['files']:
        if head.sha(snapshot/f['file'])!=f['SHA256']:raise ValueError('Local encoder/processor file differs from road-cache audit')
    road_meta=read(args.road_metadata)
    if road_meta['rendererCodeSHA256']!=head.sha(renderer.__file__):raise ValueError('Reference/road renderer source mismatch')
    catalog=read(args.catalog)['catalog']
    if len(catalog)!=25 or len({c['key'] for c in catalog})!=25:raise ValueError('All25 query kinds required')
    import torch
    from transformers import AutoModel,AutoProcessor
    torch.set_num_threads(4);began=time.perf_counter()
    name='openai/clip-vit-base-patch32'
    model=AutoModel.from_pretrained(name,revision=audit['localRef'],cache_dir=cache,local_files_only=True,use_safetensors=False).eval()
    processor=AutoProcessor.from_pretrained(name,revision=audit['localRef'],cache_dir=cache,local_files_only=True)
    if road_meta['checkpoint']!=name:raise ValueError('Encoder name mismatch')
    images=[renderer.render([c['shape']['points']],0) for c in catalog]
    with torch.inference_mode():
        value=model.get_image_features(**processor(images=images,return_tensors='pt'))
        value=value if torch.is_tensor(value) else value.pooler_output
        features=torch.nn.functional.normalize(value,dim=-1).numpy()
    args.out.mkdir(parents=True)
    for c,image in zip(catalog,images):image.save(args.out/(c['key']+'.png'))
    np.savez_compressed(args.out/'query-features.npz',keys=np.asarray([c['key'] for c in catalog]),features=features)
    meta={'catalogSHA256':head.sha(args.catalog),'queryFeaturesSHA256':head.sha(args.out/'query-features.npz'),
        'encoderAuditSHA256':head.sha(args.encoder_audit),'localSnapshot':audit['localRef'],'weightAndProcessorFilesMatchedPriorAudit':True,
        'encoder':name,'referenceViews':1,'referenceViewIndex':0,'roadCacheViews':road_meta['rotations'],
        'rendererCodeSHA256':head.sha(renderer.__file__),'codeSHA256':head.sha(__file__),'torch':torch.__version__,
        'protocolSHA256':protocol_hash,'newWeightsTrained':False,'humanOrRoadLabelsFitted':False,
        'elapsedSeconds':time.perf_counter()-began,'imageRule':'Original template allpoints;exact cached-road renderer;no extra strokes/augmentation'}
    head.write_json(args.out/'metadata.json',meta);print(json.dumps({'queries':len(catalog),'elapsedSeconds':meta['elapsedSeconds']}),flush=True)


def retrieve(source,road_features,catalog,query_keys,query_features,hand_labels,hand_weights):
    if source.get('status')!='complete' or len(source['results'])!=1003 or len(source['reviewSlots'])!=75:raise ValueError('Frozen1003/75 source required')
    rows=source['results'];lookup={r['id']:i for i,r in enumerate(rows)}
    if len(lookup)!=1003:raise ValueError('Duplicate source IDs')
    if len(catalog)!=25 or len({c['key'] for c in catalog})!=25 or set(query_keys)!={c['key'] for c in catalog} or len(query_keys)!=25:raise ValueError('Query/catalog25-kind mismatch')
    x=unit(road_features);q=unit(query_features);h=unit(np.asarray(hand_weights).T)
    if x.shape[0]!=len(rows) or q.shape!=(25,x.shape[1]) or h.shape!=(len(hand_labels),x.shape[1]):raise ValueError('Feature shape mismatch')
    qmap={k:q[i] for i,k in enumerate(query_keys)}
    hmap={c.get('key',c['name'].replace(' ','_')):h[i] for i,c in enumerate(hand_labels) if c['object']}
    entries={c['key']:c for c in catalog};outputs={mode:copy.deepcopy(source) for mode in ['geometry','hand','image']}
    for out in outputs.values():out['reviewSlots']=[];out['selectedDisplayRotations']={}
    diagnostics=[]
    pairs={(s['area'],s['proposalShape']) for s in source['reviewSlots']}
    if len(pairs)!=75 or len({a for a,k in pairs})!=3 or {k for a,k in pairs}!=set(entries):raise ValueError('Full25x3 grid required')
    for slot in source['reviewSlots']:
        area,key=slot['area'],slot['proposalShape'];unique={}
        for r in rows:
            if r['area']!=area or r.get('proposalShape')!=key:continue
            if r['geometryKey'] not in unique or r['id']<unique[r['geometryKey']]['id']:unique[r['geometryKey']]=r
        pool=sorted(unique.values(),key=lambda r:r['id'])
        if not pool:raise ValueError('Frozen source request unexpectedly empty')
        hand_key=next((a for a in entries[key]['aliases'] if a in hmap),None)
        if hand_key is None and key!='rocket':raise ValueError('Unexpected missing hand-query class')
        values={}
        for mode in outputs:
            fallback=mode=='hand' and hand_key is None
            scores=[]
            for row in pool:
                if mode=='geometry' or fallback:score=float(row['generatorSimilarity'])
                else:score=float(x[lookup[row['id']]]@(qmap[key] if mode=='image' else hmap[hand_key]))
                if not np.isfinite(score):raise ValueError('Nonfinite retrieval score')
                scores.append((score,row['id'],row))
            score,identifier,row=sorted(scores,key=lambda item:(-item[0],item[1]))[0]
            outputs[mode]['reviewSlots'].append({**copy.deepcopy(slot),'id':identifier,'validRoad':True,'proposalPoolRank':row.get('proposalPoolRank'),
                'retrievalScore':score,'scoreType':'geometry' if mode=='geometry' or fallback else 'cosine','handQueryFallback':fallback,
                'selectionReason':mode+' conditional top1;fixed minimum-ID geometry representatives;no gate'})
            outputs[mode]['selectedDisplayRotations'][identifier]=(-row['generatorPlacement']['rotDeg'])%360
            values[mode]={'id':identifier,'score':score,'fallback':fallback}
        diagnostics.append({'area':area,'key':key,'representativeCandidates':len(pool),'choices':values})
    return outputs,diagnostics


def select(args):
    if args.out.exists():raise ValueError('Use a new retrieval output folder')
    source=read(args.source);catalog=read(args.catalog)['catalog'];query_meta=read(args.queries/'metadata.json')
    if query_meta['catalogSHA256']!=head.sha(args.catalog) or query_meta['queryFeaturesSHA256']!=head.sha(args.queries/'query-features.npz'):raise ValueError('Query cache changed')
    if query_meta['protocolSHA256']!=head.sha(args.protocol):raise ValueError('Query protocol mismatch')
    views,means,ids=head.load_features(args.road_features,[r['id'] for r in source['results']])
    road_prov=head.feature_provenance(args.road_features,args.source,'roads')
    models,meta=head.load_checkpoint(args.hand_checkpoint)
    compatibility=head.verify_feature_compatibility(meta,road_prov)
    if meta.get('representation')!='canonical0':raise ValueError('Train-only canonical hand prototypes required')
    road_meta=road_prov['extractorMetadata']
    if query_meta['encoder']!=road_meta['checkpoint'] or query_meta['rendererCodeSHA256']!=road_meta['rendererCodeSHA256'] or query_meta['referenceViewIndex']!=0 or query_meta['referenceViews']!=1 or road_meta['rotations']!=4:raise ValueError('Query/road cache encoding mismatch')
    with np.load(args.queries/'query-features.npz',allow_pickle=False) as f:keys=f['keys'].tolist();features=f['features']
    outputs,diagnostics=retrieve(source,views[:,0],catalog,keys,features,meta['classLabels'],models['prototype']['weights'])
    args.out.mkdir(parents=True)
    identity={'sourceSHA256':head.sha(args.source),'catalogSHA256':head.sha(args.catalog),'queriesSHA256':head.sha(args.queries/'query-features.npz'),
        'queryMetadataSHA256':head.sha(args.queries/'metadata.json'),'roadFeaturesSHA256':head.sha(args.road_features),
        'handCheckpointSHA256':head.sha(args.hand_checkpoint),'protocolSHA256':head.sha(args.protocol),'codeSHA256':head.sha(__file__),
        'featureCompatibility':compatibility,'featureIDsVerified':ids,'noClassGate':True,'noMarginRejection':True,'humanLabelsFitted':False,
        'newGenerationExecuted':False,'newWeightsTrained':False,'view':'canonical0','representativeRule':'minimum source ID perrequest/geometry BEFORE scoring'}
    for mode,out in outputs.items():
        out['selection']={**identity,'method':mode,'requests':75,'choices':diagnostics,'humanRecognitionMeasured':False}
        head.write_json(args.out/(mode+'.json'),out)
    head.write_json(args.out/'selection-metadata.json',{**identity,'choices':diagnostics})
    print(json.dumps({'requests':75,'methods':list(outputs),'representativeCandidates':sum(d['representativeCandidates'] for d in diagnostics)}),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    a=sub.add_parser('extract');a.add_argument('--catalog',type=Path,required=True);a.add_argument('--encoder-audit',type=Path,required=True);a.add_argument('--road-metadata',type=Path,required=True);a.add_argument('--protocol',type=Path,required=True);a.add_argument('--out',type=Path,required=True)
    a=sub.add_parser('select');a.add_argument('--source',type=Path,required=True);a.add_argument('--catalog',type=Path,required=True);a.add_argument('--road-features',type=Path,required=True);a.add_argument('--hand-checkpoint',type=Path,required=True);a.add_argument('--queries',type=Path,required=True);a.add_argument('--protocol',type=Path,required=True);a.add_argument('--out',type=Path,required=True)
    args=p.parse_args();extract(args) if args.command=='extract' else select(args)
