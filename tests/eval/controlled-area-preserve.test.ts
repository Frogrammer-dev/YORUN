import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
import {evaluatePath,placeShape,toCandidate,type RouteCandidate} from '@/lib/route/fit';
import {hasEdge,project,type RoadGraph} from '@/lib/route/graph';
import {graphFromOverpass,type BBox} from '@/lib/route/osm';
import {SHAPE_BY_ID,type ShapeId} from '@/lib/route/shapes';

it.skipIf(!process.env.CONTROLLED_PRESERVE)('verifies exact narrow route identity on wide graphs before supplemental incumbent preservation',()=>{
 const root=path.resolve('eval/recognition/route-improvement'),folder=path.join(root,'controlled-area'),sourceDir=path.resolve('eval/recognition/llm-routes-20261010'),wideDir=path.join(root,'wide-roads'),inputText=readFileSync(path.join(folder,'results.json'),'utf8');
 const input=JSON.parse(inputText) as {cases:Array<{label:string;caseId:string;candidate:RouteCandidate|null;similarity:number;elapsedMs:number;candidateDistances:unknown}>};
 const protocolText=readFileSync(path.join(wideDir,'protocol.json'),'utf8'),protocol=JSON.parse(protocolText) as {areas:Array<{id:string;originalBBox:BBox;bbox:BBox}>;shapes:ShapeId[]};
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),codeHashes=Object.fromEntries(['tests/eval/controlled-area-preserve.test.ts','src/lib/route/fit.ts','src/lib/route/graph.ts','src/lib/route/osm.ts','src/lib/route/shapes.ts'].map(f=>[f,hash(readFileSync(f,'utf8'))]));
 const results:Array<{caseId:string;similarity:number;narrowSimilarity:number;wideSimilarity:number;wideMapping:{valid:boolean}}> = [];
 const index=(g:RoadGraph)=>{const map=new Map<string,number[]>();for(let v=0;v<g.n;v++){const key=`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`;map.set(key,[...(map.get(key)??[]),v]);}return map;};
 for(const area of protocol.areas){
  const narrowText=readFileSync(path.join(sourceDir,`${area.id}-roads.json`),'utf8'),wideText=readFileSync(path.join(wideDir,`${area.id}-roads.json`),'utf8'),narrowJSON=JSON.parse(narrowText),wideJSON=JSON.parse(wideText),ng=graphFromOverpass(narrowJSON,area.originalBBox,{detail:'simple',excludeSteps:true}),wg=graphFromOverpass(wideJSON,area.bbox,{detail:'simple',excludeSteps:true}),ni=index(ng),wi=index(wg);
  const narrowWays=new Map<number,number[]>(narrowJSON.elements.filter((e:{type:string})=>e.type==='way').map((e:{id:number;nodes:number[]})=>[e.id,e.nodes])),wideWays=new Map<number,number[]>(wideJSON.elements.filter((e:{type:string})=>e.type==='way').map((e:{id:number;nodes:number[]})=>[e.id,e.nodes]));
  const sourceIdentity={narrowWays:narrowWays.size,missingWaysInWide:[...narrowWays].filter(([id])=>!wideWays.has(id)).length,changedNodeSequences:[...narrowWays].filter(([id,nodes])=>wideWays.has(id)&&JSON.stringify(nodes)!==JSON.stringify(wideWays.get(id))).length};
  const [minX,minY]=project(wg.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(wg.origin,area.bbox.north,area.bbox.east),[dx,dy]=project(wg.origin,ng.origin.lat0,ng.origin.lon0);
  for(const shapeId of protocol.shapes){const caseId=`${area.id}-${shapeId}`,narrow=input.cases.find(c=>c.label==='narrow'&&c.caseId===caseId)!,wide=input.cases.find(c=>c.label==='wide'&&c.caseId===caseId)!,shape=SHAPE_BY_ID[shapeId];
   const mapExact=(candidate:RouteCandidate,g:RoadGraph,map:Map<string,number[]>)=>{const nodes:number[]=[];for(const [lat,lon] of candidate.latlngs){const found=map.get(`${lat.toFixed(7)},${lon.toFixed(7)}`);if(!found)return{nodes:null,reason:'exact_coordinate_missing'};if(found.length!==1)return{nodes:null,reason:'exact_coordinate_ambiguous'};nodes.push(found[0]);}if(nodes[0]!==nodes.at(-1)||!nodes.every((v,i)=>!i||hasEdge(g,nodes[i-1],v)))return{nodes:null,reason:'actual_edge_missing'};return{nodes,reason:null};};
   let narrowMapped:RouteCandidate|null=null,narrowQuality=Infinity,wideQuality=Infinity;
   let wideMapping:{valid:boolean;reason:string|null;nodesMatched?:number;originalSimilarity?:number;mappedSimilarity?:number;lengthDifferenceMeters?:number;originTranslationMeters?:number[];intermediateNodesInserted?:number}={valid:false,reason:'narrow_candidate_missing'};
   if(narrow.candidate){const own=mapExact(narrow.candidate,ng,ni),mapped=mapExact(narrow.candidate,wg,wi);if(!own.nodes)wideMapping={valid:false,reason:`narrow_${own.reason}`};else if(!mapped.nodes)wideMapping={valid:false,reason:mapped.reason};else{
    const p={...narrow.candidate.placement,cx:narrow.candidate.placement.cx+dx,cy:narrow.candidate.placement.cy+dy},ownE=evaluatePath(ng,shape,narrow.candidate.placement,own.nodes,3000,8000),e=evaluatePath(wg,shape,p,mapped.nodes,3000,8000),inside=mapped.nodes.every(v=>wg.x[v]>=minX&&wg.x[v]<=maxX&&wg.y[v]>=minY&&wg.y[v]<=maxY)&&placeShape(shape.points,p).every(([x,y])=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY),sameScore=e.similarity===ownE.similarity&&e.similarity===narrow.similarity,sameLength=Math.abs(e.lengthMeters-ownE.lengthMeters)<.001;
    const valid=inside&&sameScore&&sameLength&&e.lengthMeters>=3000&&e.lengthMeters<=8000&&e.repeatRatio<=.2;
    wideMapping={valid,reason:valid?null:'score_length_region_or_repeat_mismatch',nodesMatched:mapped.nodes.length,originalSimilarity:ownE.similarity,mappedSimilarity:e.similarity,lengthDifferenceMeters:e.lengthMeters-ownE.lengthMeters,originTranslationMeters:[dx,dy],intermediateNodesInserted:0};
    if(valid){narrowMapped=toCandidate(wg,shape,p,e);narrowQuality=e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);}
   }}
   if(wide.candidate){const mapped=mapExact(wide.candidate,wg,wi);expect(mapped.nodes).not.toBeNull();const e=evaluatePath(wg,shape,wide.candidate.placement,mapped.nodes!,3000,8000);expect(e.similarity).toBe(wide.similarity);wideQuality=e.meanDev/(.08*wide.candidate.placement.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);}
   const chooseNarrow=!!narrowMapped&&narrowQuality<wideQuality,candidate=chooseNarrow?narrowMapped:wide.candidate,similarity=candidate?.similarity??0;
   if(wideMapping.valid)expect(similarity).toBeGreaterThanOrEqual(Math.max(narrow.similarity,wide.similarity));
   results.push({caseId,narrowSimilarity:narrow.similarity,wideSimilarity:wide.similarity,similarity,selectionSource:chooseNarrow?'narrow-preserved':'wide',wideMapping,sourceIdentity,candidate,narrowDistances:narrow.candidateDistances,wideDistances:wide.candidateDistances,preservedDistances:chooseNarrow?narrow.candidateDistances:wide.candidateDistances,totalSearchElapsedMs:narrow.elapsedMs+wide.elapsedMs} as typeof results[number]);
  }
 }
 expect(results).toHaveLength(12);
 writeFileSync(path.join(folder,'incumbent-preserve.json'),JSON.stringify({protocol:{purpose:'Supplemental preservation of two independently evaluated automatic searches; controlled same-budget comparison remains unchanged',controlledResultsSha256:hash(inputText),wideProtocolSha256:hash(protocolText),codeHashes,graphDetail:'simple',excludeSteps:true,searchBudgetMultiplier:2,extraSearchPerformed:false,nearestNodeSubstitution:false,exactCoordinateDecimals:7,intermediateRoadNodesInserted:0,originTranslation:'uniform translation only to preserve the identical geographic outline between graph origins'},summary:{caseCount:12,denominator:12,narrowAverage:results.reduce((s,c)=>s+c.narrowSimilarity,0)/12,wideAverage:results.reduce((s,c)=>s+c.wideSimilarity,0)/12,preservedAverage:results.reduce((s,c)=>s+c.similarity,0)/12,wideMappingFailures:results.filter(c=>!c.wideMapping.valid).length},cases:results},null,2));
},180000);
