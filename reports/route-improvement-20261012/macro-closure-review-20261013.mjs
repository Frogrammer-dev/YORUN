import { createServer } from 'vite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const server=await createServer({configFile:false,resolve:{alias:{'@':resolve('src')}},server:{middlewareMode:true,hmr:false}});
const out='eval/recognition/route-improvement/macro-closure-review-20261013';mkdirSync(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const codeHashes={};for(const file of ['src/lib/route/macroCycleSearch.ts','src/lib/route/exactRoadPortGraph.ts']){const bytes=readFileSync(file);codeHashes[file]=sha(bytes);writeFileSync(`${out}/${file.split('/').at(-1)}.source`,bytes);}
try {
 const {graphFromOverpass}=await server.ssrLoadModule('/src/lib/route/osm.ts');
 const {project}=await server.ssrLoadModule('/src/lib/route/graph.ts');
 const {exactRoadPortGraph,encodeExactRoadPath}=await server.ssrLoadModule('/src/lib/route/exactRoadPortGraph.ts');
 const input=readFileSync('eval/recognition/route-improvement/offline-cascade-20261013/results.json');const rows=JSON.parse(input).cases;
 const hash=s=>{let h=20261013>>>0;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619)>>>0;return h;};
 const band=(v,lo,hi,n)=>Math.max(0,Math.min(n-1,Math.floor((v-lo)/Math.max(hi-lo,1e-9)*n)));
 const regions=[],cases=[];
 for(const area of ['gwangalli','seomyeon','gangnam']) {
  const areaRows=rows.filter(r=>r.caseId.startsWith(area+'-')),bbox=areaRows[0].bbox,source=readFileSync(`eval/recognition/llm-routes-20261010/${area}-roads.json`);
  const g=graphFromOverpass(JSON.parse(source),bbox,{detail:'simple',excludeSteps:true});
  const [minX,minY]=project(g.origin,bbox.south,bbox.west),[maxX,maxY]=project(g.origin,bbox.north,bbox.east),pg=exactRoadPortGraph(g,{minX,minY,maxX,maxY});
  const coord=v=>`${g.x[v].toPrecision(15)},${g.y[v].toPrecision(15)}`,arcs=[],all=new Map(),kept=new Map();
  for(const e of pg.edges)for(const ns of [e.nodes,e.nodes.slice().reverse()]){const k=ns.map(coord).join('|'),a={id:arcs.length,edgeId:e.id,from:ns[0],to:ns.at(-1),forward:ns[0]===e.nodes[0],length:e.lengthMeters,key:k,hash:hash(k),bin:`${band(Math.atan2(g.y[ns[1]]-g.y[ns[0]],g.x[ns[1]]-g.x[ns[0]]),-Math.PI,Math.PI,8)}:${band(e.lengthMeters,0,8000,4)}`};arcs.push(a);all.set(a.from,[...(all.get(a.from)??[]),a]);}
  for(const [v,list]of all){const bins=new Map();for(const a of list){const p=bins.get(a.bin);if(!p||a.hash<p.hash||a.hash===p.hash&&a.key<p.key)bins.set(a.bin,a);}kept.set(v,[...bins.values()].sort((a,b)=>a.hash-b.hash||a.key.localeCompare(b.key)).slice(0,32));}
  const keptIds=new Set([...kept.values()].flat().map(a=>a.id)),order=new Map(pg.ports.map((v,i)=>[v,i]));
  const reachable=(start,graph,reverse=false)=>{const links=new Map();for(const list of graph.values())for(const a of list)if(order.get(a.from)>=order.get(start)&&order.get(a.to)>=order.get(start)){const from=reverse?a.to:a.from,to=reverse?a.from:a.to;links.set(from,[...(links.get(from)??[]),to]);}const seen=new Set([start]),stack=[start];while(stack.length){const v=stack.pop();for(const w of links.get(v)??[])if(!seen.has(w)){seen.add(w);stack.push(w);}}return seen;};
  let fullClosurePairs=0,retainedClosurePairs=0,startsNoCycleFull=0,startsNoCycleRetained=0;
  for(const s of pg.ports){const fa=reachable(s,all),fr=reachable(s,all,true),ka=reachable(s,kept),kr=reachable(s,kept,true);const full=[...fa].filter(v=>v!==s&&fr.has(v)).length,retain=[...ka].filter(v=>v!==s&&kr.has(v)).length;fullClosurePairs+=full;retainedClosurePairs+=retain;if(!full)startsNoCycleFull++;if(!retain)startsNoCycleRetained++;}
  regions.push({area,sourceHash:sha(source),ports:pg.ports.length,macroEdges:pg.edges.length,allArcs:arcs.length,retainedArcs:keptIds.size,arcsUnder2km:arcs.filter(a=>a.length<2000).length,fullClosurePairs,retainedClosurePairs,startsNoCycleFull,startsNoCycleRetained});
  const llkey=(lat,lon)=>`${lat.toFixed(7)},${lon.toFixed(7)}`,ids=new Map(Array.from({length:g.n},(_,v)=>[llkey(g.lat[v],g.lon[v]),v]));
  for(const row of areaRows){const nodes=row.candidate.latlngs.map(([lat,lon])=>ids.get(llkey(lat,lon))),spans=encodeExactRoadPath(pg,nodes),missing=[];
   for(const span of spans){const a=arcs.find(a=>a.edgeId===span.edgeId&&a.forward===(span.to>span.from));if(!keptIds.has(a.id))missing.push({edgeId:span.edgeId,from:a.from,to:a.to,meters:a.length});}
   cases.push({caseId:row.caseId,macroSpans:spans.length,missingForwardSpans:missing.length,missingReverseSpans:spans.filter(span=>{const a=arcs.find(a=>a.edgeId===span.edgeId&&a.forward===(span.to<span.from));return !keptIds.has(a.id);}).length,missing});
  }
 }
 const result={protocol:{codeHashes,inputHash:sha(input),qualityUsed:false,searchRun:false,fanoutFormulaCopiedFromSnapshot:true},regions,cases};writeFileSync(`${out}/results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({regions,cases:cases.map(({missing,...c})=>c)}));
}finally{await server.close();}
