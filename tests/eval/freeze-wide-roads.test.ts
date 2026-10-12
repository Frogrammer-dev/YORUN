import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { readLocalRoads } from "@/lib/route/roadData.server";
import type { BBox } from "@/lib/route/osm";

it.skipIf(!process.env.FREEZE_WIDE_ROADS)("freeze a separate wider-area comparison without altering the primary benchmark",()=>{
  const folder="eval/recognition/route-improvement/wide-roads";
  mkdirSync(folder,{recursive:true});
  const original=JSON.parse(readFileSync("eval/recognition/route-improvement/frozen-baseline.json","utf8")) as {protocol:{areas:Array<{id:string;bbox:BBox}>;shapes:string[]}};
  const factor=1.8;
  const areas=original.protocol.areas.map(area=>{
    const centerLat=(area.bbox.south+area.bbox.north)/2,centerLon=(area.bbox.west+area.bbox.east)/2;
    const halfLat=(area.bbox.north-area.bbox.south)*factor/2,halfLon=(area.bbox.east-area.bbox.west)*factor/2;
    const bbox={south:centerLat-halfLat,north:centerLat+halfLat,west:centerLon-halfLon,east:centerLon+halfLon};
    const file=`${folder}/${area.id}-roads.json`;
    if(!existsSync(file))writeFileSync(file,JSON.stringify(readLocalRoads(bbox)));
    const raw=readFileSync(file,"utf8"),data=JSON.parse(raw);
    expect(data.elements.length).toBeGreaterThan(0);
    return {id:area.id,originalBBox:area.bbox,bbox,sha256:createHash("sha256").update(raw).digest("hex"),timestamp:data.osm3s?.timestamp_osm_base};
  });
  const protocol={purpose:"User-approved supplemental wider-area comparison; primary fixed 12 cases remain unchanged",linearFactor:factor,areaFactor:factor*factor,areas,shapes:original.protocol.shapes,graphDetail:"simple",excludeSteps:true,minMeters:3000,maxMeters:8000,maxRepeatRatio:.2,score:"original evaluatePath",closed:true,actualEdgesOnly:true,pathAndTemplateInside:true};
  const file=`${folder}/protocol.json`;
  if(existsSync(file))expect(JSON.parse(readFileSync(file,"utf8"))).toEqual(protocol);
  else writeFileSync(file,JSON.stringify(protocol,null,2));
});
