import {z} from "zod";
import {battleDatabase} from "@/lib/server/battle";
import {handle,ok,requireUser,HttpError,limit,readJson,assertWriteRequest,mapDbError} from "@/lib/server/http";

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("start"),runId:z.number().int().positive(),courseHash:digest}),
  z.object({action:z.literal("checkpoint"),id:z.uuid(),hash:digest,count:z.number().int().min(3).max(8000),time:z.number().int().min(10000).max(86400000)}),
  z.object({action:z.literal("seal"),id:z.uuid(),traceHash:digest,duration:z.number().int().nonnegative().max(86400000)})
]);
export function POST(req:Request){return handle("POST battle-run",async()=>{
  assertWriteRequest(req); const {user}=await requireUser();limit("battle-session:"+user.id,20);
  const input=await readJson(req,schema),db=battleDatabase();
  if(input.action==="start"){
    const {error}=await db.from("battle_run_sessions").upsert({owner_id:user.id,run_id:input.runId,course_hash:input.courseHash},{onConflict:"owner_id,run_id",ignoreDuplicates:true});
    if(error)throw mapDbError(error);
    const row=await db.from("battle_run_sessions").select("id,course_hash").eq("owner_id",user.id).eq("run_id",input.runId).single();
    if(row.error)throw mapDbError(row.error);
    if(row.data.course_hash!==input.courseHash)throw new HttpError(409,"course_changed","시작 코스가 달라요.");
    return ok({id:row.data.id,owner:user.id});
  }
  const row=await db.from("battle_run_sessions").select("started,trace_hash,checkpoint_hash").eq("owner_id",user.id).eq("id",input.id).maybeSingle();
  if(row.error)throw mapDbError(row.error);
  if(!row.data)throw new HttpError(404,"unknown_run","달리기 세션을 찾을 수 없어요.");
  const elapsed=Date.now()-Date.parse(row.data.started);
  if(input.action==="checkpoint"){
    if(Math.abs(elapsed-input.time)>30000 || row.data.trace_hash) throw new HttpError(422,"stale_checkpoint","현재 달리기 수신 시각과 일치하지 않아요.");
    const saved=await db.from("battle_run_sessions").update({checkpoint_hash:input.hash,checkpoint_count:input.count,checkpoint_time:input.time})
      .eq("id",input.id).eq("owner_id",user.id).is("checkpoint_hash",null).is("trace_hash",null);
    if(saved.error)throw mapDbError(saved.error);
    return ok({id:input.id,owner:user.id});
  }
  if(!row.data.checkpoint_hash)throw new HttpError(422,"missing_checkpoint","달리기 중 서버 확인을 받지 못했어요.");
  if(elapsed>86460000 || input.duration>elapsed+10000)throw new HttpError(422,"invalid_time","기록 시간과 서버 경과 시간이 맞지 않아요.");
  const saved=await db.from("battle_run_sessions").update({trace_hash:input.traceHash,sealed_at:new Date().toISOString()}).eq("owner_id",user.id).eq("id",input.id).is("trace_hash",null).select("id");
  if(saved.error)throw mapDbError(saved.error);
  if(!saved.data.length){
    const existing=await db.from("battle_run_sessions").select("trace_hash").eq("id",input.id).eq("owner_id",user.id).single();
    if(existing.error)throw mapDbError(existing.error);
    if(existing.data.trace_hash!==input.traceHash)throw new HttpError(409,"sealed","이미 다른 기록으로 종료된 달리기예요.");
  }
  return ok({id:input.id,owner:user.id});
});}
