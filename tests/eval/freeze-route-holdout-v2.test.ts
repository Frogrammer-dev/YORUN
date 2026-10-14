import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {readLocalRoads} from '@/lib/route/roadData.server';

// Predeclared coordinates only; do not inspect candidate quality while choosing areas.
it.skipIf(!process.env.FREEZE_ROUTE_HOLDOUT_V2)('freezes a second independent road validation set before new algorithm results',()=>{
  const folder='eval/recognition/route-improvement/holdout-v2-20261012';
  mkdirSync(folder,{recursive:true});
  const areas=[
    {id:'validation-west',bbox:{south:37.49,west:126.71,north:37.515,east:126.74}},
    {id:'validation-central',bbox:{south:36.625,west:127.43,north:36.65,east:127.46}},
    {id:'validation-southwest',bbox:{south:35.135,west:126.84,north:35.16,east:126.87}},
  ];
  const snapshots=areas.map(area=>{
    const file=`${folder}/${area.id}-roads.json`;
    if(!existsSync(file))writeFileSync(file,JSON.stringify(readLocalRoads(area.bbox)));
    const raw=readFileSync(file,'utf8'),data=JSON.parse(raw);
    expect(data.elements.length).toBeGreaterThan(0);
    return {...area,sha256:createHash('sha256').update(raw).digest('hex'),timestamp:data.osm3s?.timestamp_osm_base};
  });
  const protocol={purpose:'Second independent validation set: fixed coordinates before pair-segment pilot outcomes; no quality evaluated during freezing',areas:snapshots,shapes:['square','heart','star','cat'],graphDetail:'simple',excludeSteps:true,minMeters:3000,maxMeters:8000,maxRepeatRatio:.2,score:'original evaluatePath',closed:true,actualEdgesOnly:true,pathAndTemplateInsideRegion:true,failuresCountAsZero:true,denominator:12};
  const file=`${folder}/protocol.json`;
  if(existsSync(file))expect(JSON.parse(readFileSync(file,'utf8'))).toEqual(protocol);
  else writeFileSync(file,JSON.stringify(protocol,null,2));
});
