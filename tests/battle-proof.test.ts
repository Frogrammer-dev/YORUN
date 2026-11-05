import {expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {verifyRun} from "@/lib/server/verifyRun";
import {tracePrefix,type DerbyTrace} from "@/lib/battle/derbyTrace";
const {read}=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/lib/server/battle",()=>({battleDatabase:()=>({from:()=>({select:()=>({eq:()=>({eq:(_key:string,owner:string)=>({maybeSingle:()=>read(owner)})})})})})}));
vi.mock("@/lib/server/http",()=>({HttpError:class extends Error{},mapDbError:()=>new Error()}));
it("계정, 시작 코스, 달리는 중 확인한 지점, 종료 해시, 서버 시간을 모두 확인한다",async()=>{
 const trace:DerbyTrace={course:[[0,0],[1000,0]],moves:[],segments:[[[[0,0],0],[[10,0],5000],[[25,0],10000],[[1000,0],500000]]]};
 const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
 const row={course_hash:digest([trace.course,trace.moves]),trace_hash:digest(trace),checkpoint_hash:digest(tracePrefix(trace,3)),checkpoint_count:3,checkpoint_time:10000,started:new Date(0).toISOString(),sealed_at:new Date(500000).toISOString()};
 read.mockImplementation(owner=>({data:owner==="a"?row:null}));
 await expect(verifyRun("a","id",trace)).resolves.toBeUndefined();
 await expect(verifyRun("b","id",trace)).rejects.toThrow();
 for(const [key,value] of Object.entries({course_hash:"wrong",trace_hash:"wrong",checkpoint_hash:"wrong",sealed_at:new Date(0).toISOString()})){
   read.mockReturnValue({data:{...row,[key]:value}});
   await expect(verifyRun("a","id",trace)).rejects.toThrow();
 }
});
