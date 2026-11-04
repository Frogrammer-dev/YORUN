import {verifyRun} from "@/lib/server/verifyRun";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {handle,ok,requireUser,HttpError,limit,readJson,assertWriteRequest,mapDbError} from "@/lib/server/http";
import {battleDatabase,playerName} from "@/lib/server/battle";
import {derbyTrace,assessTrace} from "@/lib/battle/derbyTrace";
import {simulateDuel} from "@/lib/battle/duel";

const command=z.discriminatedUnion("action",[
  z.object({action:z.literal("register"),consent:z.literal(true),session:z.uuid(),trace:derbyTrace,plan:z.array(z.enum(["strike","pierce","guard"])).length(5)}),
  z.object({action:z.literal("challenge"),target:z.uuid(),requestId:z.uuid()})
]);
export function GET(){return handle("GET duel",async()=>{
  const {user}=await requireUser(),db=battleDatabase();
  const [me,others,history]=await Promise.all([
    db.from("duel_players").select("plan").eq("owner_id",user.id).maybeSingle(),
    db.from("duel_players").select("player_id,owner_id").neq("owner_id",user.id).order("updated",{ascending:false}).order("player_id").limit(10),
    db.from("duel_matches").select("id,challenger,defender,result,played").or(`challenger.eq.${user.id},defender.eq.${user.id}`).order("played",{ascending:false}).limit(10)
  ]);
  if(me.error||others.error||history.error) throw mapDbError(me.error||others.error||history.error);
  return ok({name:playerName(user.id),plan:me.data?.plan??null,players:others.data!.map(p=>({id:p.player_id,name:playerName(p.owner_id)})),
    history:history.data!.map(m=>({id:m.id,attacking:m.challenger===user.id,opponent:playerName(m.challenger===user.id?m.defender:m.challenger),winner:m.result.winner,turns:m.result.turns.length}))});
});}
export function POST(req:Request){return handle("POST duel",async()=>{
  assertWriteRequest(req);
  const {user}=await requireUser(),db=battleDatabase();
  limit("duel:"+user.id,12);
  const input=await readJson(req,command);
  if(input.action==="register"){
    await verifyRun(user.id,input.session,input.trace);
    let stats;
    try {stats=assessTrace(input.trace);}catch(e){throw new HttpError(422,"ineligible",(e as Error).message);}
    const saved=await db.from("duel_players").upsert({owner_id:user.id,plan:input.plan,stats:{distanceM:stats.distanceM,adherence:stats.adherence,climbMPerKm:null},updated:new Date().toISOString()},{onConflict:"owner_id"});
    if(saved.error)throw mapDbError(saved.error);
    return ok({registered:true});
  }
  const [a,b]=await Promise.all([db.from("duel_players").select("*").eq("owner_id",user.id).maybeSingle(),db.from("duel_players").select("*").eq("player_id",input.target).maybeSingle()]);
  if(a.error||b.error)throw mapDbError(a.error||b.error);
  if(!a.data||!b.data||b.data.owner_id===user.id)throw new HttpError(422,"invalid_match","참가 등록 후 다른 플레이어를 선택해 주세요.");
  const previous=await db.from("duel_matches").select("result,defender").eq("id",input.requestId).eq("challenger",user.id).maybeSingle();
  if(previous.error)throw mapDbError(previous.error);
  if(previous.data && previous.data.defender!==b.data.owner_id)throw new HttpError(409,"request_id_reused","다른 상대에게 사용한 요청이에요.");
  if(previous.data)return ok(previous.data.result);
  const result=simulateDuel({id:a.data.player_id,stats:a.data.stats,plan:a.data.plan},{id:b.data.player_id,stats:b.data.stats,plan:b.data.plan},randomUUID());
  const saved=await db.from("duel_matches").insert({id:input.requestId,challenger:user.id,defender:b.data.owner_id,result});
  if(saved.error?.code==="23505"){
    const existing=await db.from("duel_matches").select("result,defender").eq("id",input.requestId).eq("challenger",user.id).single();
    if(existing.data && existing.data.defender!==b.data.owner_id)throw new HttpError(409,"request_id_reused","다른 상대에게 사용한 요청이에요.");
    if(!existing.error)return ok(existing.data.result);
  }
  if(saved.error)throw mapDbError(saved.error);
  return ok(result);
});}
