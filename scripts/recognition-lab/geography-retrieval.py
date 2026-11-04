"""Frozen G/H/I retrieval for complete request grids, including empty road pools.

The v18 wrapper remains unchanged. Scores, representatives and display conventions
are identical; this adapter supports new source counts and explicit failures.
"""
import argparse
import copy
import json
from pathlib import Path
import numpy as np
import importlib.util

spec=importlib.util.spec_from_file_location('frozen_query',Path(__file__).with_name('image-query-retrieval.py'))
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
head=old.head


def retrieve(source,road_features,catalog,query_keys,query_features,hand_labels,hand_weights):
    if source.get('status')!='complete':raise ValueError('Complete source required')
    rows=source['results'];slots=source['reviewSlots'];keys={c['key'] for c in catalog}
    if len(keys)!=25 or len(catalog)!=25 or set(query_keys)!=keys or len(query_keys)!=25:raise ValueError('Frozen25 query scope required')
    pairs={(s['area'],s['proposalShape']) for s in slots};areas={a for a,k in pairs}
    if len(slots)!=75 or len(pairs)!=75 or len(areas)!=3 or pairs!={(a,k) for a in areas for k in keys}:raise ValueError('Complete25x3 request grid required')
    lookup={r['id']:i for i,r in enumerate(rows)}
    if len(lookup)!=len(rows) or any((r['area'],r['proposalShape']) not in pairs for r in rows):raise ValueError('Duplicate IDs or out-of-scope candidates')
    x=old.unit(road_features);q=old.unit(query_features);h=old.unit(np.asarray(hand_weights).T)
    if x.shape[0]!=len(rows) or q.shape!=(25,x.shape[1]) or h.shape!=(len(hand_labels),x.shape[1]):raise ValueError('Embedding shape mismatch')
    qmap=dict(zip(query_keys,q));hmap={c.get('key',c['name'].replace(' ','_')):h[i] for i,c in enumerate(hand_labels) if c['object']}
    entries={c['key']:c for c in catalog}
    outputs={m:copy.deepcopy(source) for m in ('geometry','hand','image')}
    for out in outputs.values():out['reviewSlots']=[];out['selectedDisplayRotations']={}
    diagnostics=[]
    for slot in slots:
        area,key=slot['area'],slot['proposalShape'];unique={}
        for row in rows:
            if (row['area'],row['proposalShape'])!=(area,key):continue
            if row['geometryKey'] not in unique or row['id']<unique[row['geometryKey']]['id']:unique[row['geometryKey']]=row
        pool=sorted(unique.values(),key=lambda r:r['id'])
        hk=next((a for a in entries[key]['aliases'] if a in hmap),None)
        if hk is None and key!='rocket':raise ValueError('Unexpected unsupported hand class')
        choices={}
        for mode,out in outputs.items():
            fallback=mode=='hand' and hk is None
            scores=[]
            for row in pool:
                score=float(row['generatorSimilarity']) if mode=='geometry' or fallback else float(x[lookup[row['id']]]@(qmap[key] if mode=='image' else hmap[hk]))
                if not np.isfinite(score):raise ValueError('Nonfinite score')
                scores.append((score,row['id'],row))
            winner=sorted(scores,key=lambda z:(-z[0],z[1]))[0] if scores else None
            identifier=winner[1] if winner else None
            out['reviewSlots'].append({**copy.deepcopy(slot),'id':identifier,'validRoad':winner is not None,
                'proposalPoolRank':winner[2].get('proposalPoolRank') if winner else None,
                'retrievalScore':winner[0] if winner else None,'scoreType':'geometry' if mode=='geometry' or fallback else 'cosine',
                'handQueryFallback':fallback,'selection':'v19 frozen conditional top1' if winner else 'missing road pool; denominator retained',
                'selectionReason':mode+' conditional top1;fixed minimum-ID geometry representatives;no gate' if winner else 'no valid road candidate'})
            if winner:
                rotation=float(winner[2]['generatorPlacement']['rotDeg'])
                if not np.isfinite(rotation):raise ValueError('Nonfinite rotation')
                out['selectedDisplayRotations'][identifier]=(-rotation)%360
            choices[mode]={'id':identifier,'score':winner[0] if winner else None,'fallback':fallback}
        diagnostics.append({'area':area,'key':key,'representativeCandidates':len(pool),'choices':choices})
    return outputs,diagnostics


def select(args):
    if args.out.exists():raise ValueError('Preserve existing outputs')
    source=old.read(args.source);catalog=old.read(args.catalog)['catalog'];qm=old.read(args.queries/'metadata.json')
    if qm['catalogSHA256']!=head.sha(args.catalog) or qm['queryFeaturesSHA256']!=head.sha(args.queries/'query-features.npz'):raise ValueError('Frozen queries changed')
    if qm['protocolSHA256']!=head.sha(args.query_protocol):raise ValueError('Original query protocol changed')
    views,_,ids=head.load_features(args.road_features,[r['id'] for r in source['results']])
    prov=head.feature_provenance(args.road_features,args.source,'roads')
    models,meta=head.load_checkpoint(args.hand_checkpoint);compat=head.verify_feature_compatibility(meta,prov)
    rm=prov['extractorMetadata']
    if meta.get('representation')!='canonical0' or qm['encoder']!=rm['checkpoint'] or qm['rendererCodeSHA256']!=rm['rendererCodeSHA256'] or rm['rotations']!=4 or qm['referenceViewIndex']!=0 or qm['referenceViews']!=1:raise ValueError('Encoding mismatch')
    with np.load(args.queries/'query-features.npz',allow_pickle=False) as f:
        outputs,diag=retrieve(source,views[:,0],catalog,f['keys'].tolist(),f['features'],meta['classLabels'],models['prototype']['weights'])
    identity={k:head.sha(getattr(args,k)) for k in ('source','catalog','road_features','hand_checkpoint','query_protocol','protocol')}
    identity.update(codeSHA256=head.sha(__file__),frozenV18CodeSHA256=head.sha(old.__file__),queriesSHA256=head.sha(args.queries/'query-features.npz'),
        queryMetadataSHA256=head.sha(args.queries/'metadata.json'),featureIDsVerified=ids,featureCompatibility=compat,
        newWeightsTrained=False,humanLabelsFitted=False,view='canonical0',requests=75)
    args.out.mkdir(parents=True)
    for mode,out in outputs.items():
        out['selection']={**identity,'method':mode,'choices':diag,'humanRecognitionMeasured':False}
        head.write_json(args.out/(mode+'.json'),out)
    head.write_json(args.out/'selection-metadata.json',{**identity,'choices':diag})
    print(json.dumps({'requests':75,'candidates':len(source['results']),'representatives':sum(d['representativeCandidates'] for d in diag)}))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ('source','catalog','road-features','hand-checkpoint','queries','query-protocol','protocol','out'):
        p.add_argument('--'+key,type=Path,required=True)
    select(p.parse_args())
