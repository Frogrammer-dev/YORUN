import {it,expect,vi} from "vitest";
const {entry}=vi.hoisted(()=>({entry:{collision:false,target:"defender"}}));
vi.mock("@/lib/server/http",()=>({assertWriteRequest:vi.fn(),limit:vi.fn(),requireUser:async()=>({user:{id:"attacker"}}),readJson:async()=>({action:"challenge",target:"target",requestId:"req"}),handle:async(_name:string,fn:()=>unknown)=>fn(),ok:(data:unknown)=>data,mapDbError:()=>Error(),HttpError:class extends Error{constructor(public status:number,public code:string,text:string){super(text);}}}));
vi.mock("@/lib/server/verifyRun",()=>({verifyRun:vi.fn()}));
vi.mock("@/lib/server/battle",()=>({playerName:vi.fn(),battleDatabase:()=>({from:(table:string)=>({
 select:()=>({eq:(field:string)=>({maybeSingle:async()=>({data:{owner_id:field==="owner_id"?"attacker":"defender",plan:Array(5).fill("guard"),stats:{distanceM:1000,adherence:1,climbMPerKm:null}}}),
 eq:()=>({maybeSingle:async()=>({data:entry.collision?null:{defender:entry.target,result:"saved"}}),single:async()=>({data:{defender:entry.target,result:"saved"}})})})}),
 insert:async()=>({error:{code:"23505",table}})
})})}));
import {POST} from "@/app/api/duel/route";
it("재시도와 동시 INSERT 충돌 모두 같은 상대만 원래 결과를 돌려준다",async()=>{
 for(const collision of [false,true]){
   entry.collision=collision;entry.target="defender";
   expect(await POST(new Request("http://localhost"))).toBe("saved");
   entry.target="other";
   await expect(POST(new Request("http://localhost"))).rejects.toMatchObject({status:409});
 }
});
