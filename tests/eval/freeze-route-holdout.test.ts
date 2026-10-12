import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { readLocalRoads } from "@/lib/route/roadData.server";

it.skipIf(!process.env.FREEZE_ROUTE_HOLDOUT)("freeze unseen road regions before algorithm validation", () => {
  const folder="eval/recognition/route-improvement/holdout";
  mkdirSync(folder,{recursive:true});
  const areas=[
    {id:"daejeon-dunsan",bbox:{south:36.34,west:127.375,north:36.365,east:127.405}},
    {id:"daegu-center",bbox:{south:35.855,west:128.575,north:35.88,east:128.606}},
    {id:"seoul-songpa",bbox:{south:37.495,west:127.095,north:37.52,east:127.126}},
  ];
  const snapshots=areas.map(area=>{
    const file=`${folder}/${area.id}-roads.json`;
    if(!existsSync(file))writeFileSync(file,JSON.stringify(readLocalRoads(area.bbox)));
    const raw=readFileSync(file,"utf8"),data=JSON.parse(raw);
    expect(data.elements.length).toBeGreaterThan(0);
    return {...area,sha256:createHash("sha256").update(raw).digest("hex"),timestamp:data.osm3s?.timestamp_osm_base};
  });
  const manifest={purpose:"Held out from tuning; no route quality evaluated during freezing",areas:snapshots,shapes:["square","heart","star","cat"],graphDetail:"simple",excludeSteps:true,minMeters:3000,maxMeters:8000,maxRepeatRatio:.2,score:"original evaluatePath",closed:true,actualEdgesOnly:true,templateInside:true};
  const file=`${folder}/protocol.json`;
  if(existsSync(file))expect(JSON.parse(readFileSync(file,"utf8"))).toEqual(manifest);
  else writeFileSync(file,JSON.stringify(manifest,null,2));
});
