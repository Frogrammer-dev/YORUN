import { z } from "zod";
import { analyzeRun, type BattleCourse } from "./analysis";
import { emptyRecord, type RunRecord } from "@/lib/run/tracker";

const xy = z.tuple([z.number().int().min(-60000).max(60000),z.number().int().min(-60000).max(60000)]);
export const derbyTrace = z.object({
  course:z.array(xy).min(2).max(4000),
  moves:z.array(z.tuple([z.number().int().nonnegative(),z.number().int().nonnegative()])).max(200),
  segments:z.array(z.array(z.tuple([xy,z.number().int().min(0).max(86400000)])).max(8000)).max(200)
});
export type DerbyTrace = z.infer<typeof derbyTrace>;
const unit = 6371000 * Math.PI / 180;
export function relativeTrace(record:RunRecord,course:BattleCourse):DerbyTrace {
  const [lat,lon]=course.latlngs[0];
  const horizontal=unit*Math.cos(lat*Math.PI/180);
  const point=(a:number,b:number):[number,number]=>[Math.round((b-lon)*horizontal), Math.round((a-lat)*unit)];
  const start=record.startedAt ?? record.segments.find(s=>s.length)?.[0].time ?? 0;
  return {course:course.latlngs.map(([a,b])=>point(a,b)),moves:course.moves??[],
    segments:record.segments.filter(s=>s.length>1).map(s=>s.map(p=>[point(p.lat,p.lon),p.time-start]))};
}
export function assessTrace(input:DerbyTrace) {
  const ll=([x,y]:number[]):[number,number]=>[y/unit,x/unit];
  let total=0, count=0, last=-1;
  for(const s of input.segments){
    count+=s.length;
    if(count>8000) throw Error("기록 지점이 너무 많아요.");
    for(let i=0;i<s.length;i++){
      const [p,t]=s[i];
      if(t<=last) throw Error("기록 시각을 확인해 주세요.");
      if(i){
        const q=s[i-1][0], d=Math.hypot(p[0]-q[0],p[1]-q[1]);
        if(t-last>60000 || d>8.5*(t-last)/1000+1.5) throw Error("GPS 공백이나 비정상 이동이 있는 기록이에요.");
        total+=d;
      }
      last=t;
    }
  }
  const length=input.course.slice(1).reduce((v,p,i)=>v+Math.hypot(p[0]-input.course[i][0],p[1]-input.course[i][1]),0);
  if(length>42000 || total>42000 || input.moves.some(([a,b])=>a>=b || b>=input.course.length)) throw Error("지원하지 않는 코스 범위예요.");
  const stats=analyzeRun({...emptyRecord(),segments:input.segments.map(s=>s.map(([p,time])=>({lat:ll(p)[0],lon:ll(p)[1],time})))},{latlngs:input.course.map(ll),moves:input.moves,ascentM:null});
  if(!stats.eligible) throw Error("1km 이상, 코스 일치 범위 50% 이상인 정상 페이스 기록이 필요해요.");
  const {avgPaceSecPerKm,paceSplits,corners,cornering}=stats;
  return {avgPaceSecPerKm,paceSplits,corners,cornering,distanceM:stats.distanceM,adherence:stats.adherence};
}

/** A stable chronological prefix; segment boundaries are part of the commitment. */
export function tracePrefix(trace:DerbyTrace,count:number){
  return trace.segments.flatMap((segment,i)=>segment.map(point=>[i,point] as const)).slice(0,count);
}
