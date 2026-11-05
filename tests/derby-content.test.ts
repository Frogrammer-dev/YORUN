import {expect,it} from "vitest";
import {assessTrace,relativeTrace} from "@/lib/battle/derbyTrace";
import {simulateDerby} from "@/lib/battle/derby";
import {emptyRecord} from "@/lib/run/tracker";
it("원점·실제 출발 시각을 제거하고 페이스를 검산해 8레인 경기를 재현한다",()=>{
 const points=Array.from({length:121},(_,i)=>({lat:37+i*0.00009,lon:127,time:1700000000000+i*3500}));
 const input=relativeTrace({...emptyRecord(),segments:[points]},{latlngs:points.map(p=>[p.lat,p.lon]),ascentM:null});
 expect(input.segments[0][0]).toEqual([[0,0],0]);
 const stats=assessTrace(input);
 expect(stats.avgPaceSecPerKm).toBeCloseTo(350,-1);
 const field=Array.from({length:8},(_,i)=>({id:String(i+1),stats}));
 const result=simulateDerby(field,"room");
 expect(result).toEqual(simulateDerby(field,"room"));
 expect(result.entries.map(e=>e.rank)).toEqual([1,2,3,4,5,6,7,8]);
 expect(result.entries.every(e=>e.splits.length===12)).toBe(true);
 input.segments[0][1][1]=1;
 expect(()=>assessTrace(input)).toThrow();
});
