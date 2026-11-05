import {it,expect,vi,afterEach} from "vitest";
import {addFix,emptyRecord,startOrResume} from "@/lib/run/tracker";
import {relativeTrace,assessTrace,tracePrefix} from "@/lib/battle/derbyTrace";
import {discardBattleRun,finishBattleRun} from "@/lib/battle/battleDraft";

const {session}=vi.hoisted(()=>({session:vi.fn()}));
vi.mock("@/lib/client/supabaseBrowser",()=>({browserSupabase:()=>({auth:{getSession:session}})}));

afterEach(()=>vi.unstubAllGlobals());
it("정지 70초 동안 GPS가 수신된 후 움직인 정상 기록을 대결에 사용할 수 있다",()=>{
  let record=startOrResume(emptyRecord(),0);
  const fix=(m:number,t:number)=>{record=addFix(record,{lat:0,lon:m/111195,time:t,accuracy:3}).record;};
  for(let i=0;i<=110;i++)fix(10*i,4000*i);
  const distance=record.distanceMeters;
  for(let t=450000;t<=510000;t+=10000)fix(1100,t);
  expect(record.distanceMeters).toBe(distance);
  fix(1110,514000);
  const trace=relativeTrace(record,{latlngs:[[0,0],[0,1110/111195]],ascentM:null});
  expect(trace.segments).toHaveLength(1);
  expect(assessTrace(trace).distanceM).toBeCloseTo(1110,0);
  const prefix=tracePrefix(trace,3);
  trace.segments[0].push([[1120,0],518000]);
  expect(tracePrefix(trace,3)).toEqual(prefix);
});
it("계정별 참가 기록 중 폐기한 기록만 지운다",()=>{
  const values=new Map([["yorun.lastDerbyTrace","legacy"],["yorun.battle.ticket.17",'{"owner":"a"}'],["yorun.battle.draft.a",'{"runId":17}'],["yorun.battle.draft.b",'{"runId":18}']]);
  vi.stubGlobal("localStorage",{getItem:(k:string)=>values.get(k)??null,removeItem:(k:string)=>values.delete(k)});
  discardBattleRun(17);
  expect([...values.keys()]).toEqual(["yorun.battle.draft.b"]);
});
it("정지 뒤 끊겼다가 움직여도 앱이 받은 기록은 대결 검증도 통과한다",()=>{
  let record=startOrResume(emptyRecord(),0);
  const fix=(m:number,t:number)=>{const out=addFix(record,{lat:0,lon:m/111195,time:t,accuracy:3});record=out.record;return out.accepted;};
  for(let i=0;i<=110;i++)fix(10*i,4000*i);
  fix(1100,464000);
  fix(1100,492000); // 마지막 수신 지점
  expect(fix(1110,496000+30000)).toBe(true); // 62초 공백 뒤 정상 이동
  expect(()=>assessTrace(relativeTrace(record,{latlngs:[[0,0],[0,1110/111195]],ascentM:null}))).not.toThrow();
});
it("마지막 수신 지점 기준으로 비정상인 이동은 앱에서도 거절한다",()=>{
  let record=startOrResume(emptyRecord(),0);
  const fix=(m:number,t:number)=>{const out=addFix(record,{lat:0,lon:m/111195,time:t,accuracy:3});record=out.record;return out.accepted;};
  fix(0,0);fix(10,4000);
  fix(10,20000); // 마지막 이동 지점 뒤 16초에 수신
  fix(10,34500); // 30초를 넘겨 흔적으로 남는다
  fix(10,60000); // 25.5초 뒤 수신: 흔적을 남기지 않는다
  expect(fix(100,95000)).toBe(true); // 흔적 기준 60.5초 공백, 마지막 수신 기준 35초
  let other=startOrResume(emptyRecord(),0);
  const move=(m:number,t:number)=>{const out=addFix(other,{lat:0,lon:m/111195,time:t,accuracy:3});other=out.record;return out.accepted;};
  move(0,0);move(10,4000);move(10,34500);move(10,60000);
  expect(move(450,95000)).toBe(false); // 440m를 35초 = 약 12.6m/s
});
it("로그인하지 않은 러너의 완주는 조용히 끝나고, 로그인했는데 인증이 없으면 알린다",async()=>{
  vi.stubGlobal("localStorage",{getItem:()=>null});
  const trace={course:[],moves:[],segments:[]};
  session.mockResolvedValue({data:{session:null}});
  await expect(finishBattleRun(1,trace)).resolves.toBeUndefined();
  session.mockResolvedValue({data:{session:{user:{id:"a"}}}});
  await expect(finishBattleRun(1,trace)).rejects.toThrow("로그인");
});
