import {verifyRun} from "@/lib/server/verifyRun";
import {createHash} from "node:crypto";
import {battleDatabase as database,playerName} from "@/lib/server/battle";
import {z} from "zod";
import {handle,ok,requireUser,HttpError,limit,readJson,assertWriteRequest,mapDbError} from "@/lib/server/http";

import {derbyTrace,assessTrace} from "@/lib/battle/derbyTrace";
import {simulateDerby} from "@/lib/battle/derby";

export function POST(req:Request){return handle("POST derby",async()=>{
  assertWriteRequest(req);
  const {user}=await requireUser();
  limit("derby-enter:"+user.id,6);
  const {trace,session}=await readJson(req,z.object({consent:z.literal(true),session:z.uuid(),trace:derbyTrace}));
  await verifyRun(user.id,session,trace);
  let stats;
  try{stats=assessTrace(trace);}catch(e){throw new HttpError(422,"ineligible",(e as Error).message);}
  const {data,error}=await database().rpc("derby_enter",{p_owner:user.id,p_hash:createHash("sha256").update(JSON.stringify(trace)).digest("hex"),p_stats:stats});
  if(error) throw mapDbError(error);
  return ok({race:data});
});}
export function GET(req:Request){return handle("GET derby",async()=>{
  const {user}=await requireUser(),db=database();
  const id=new URL(req.url).searchParams.get("race");
  if(id&&!z.uuid().safeParse(id).success) throw new HttpError(400,"bad_race","경주 번호를 확인해 주세요.");
  let mine=db.from("derby_entries").select("race,lane").eq("owner_id",user.id);
  if(id) mine=mine.eq("race",id);
  const {data:entry,error}=await mine.order("entered",{ascending:false}).limit(1).maybeSingle();
  if(error) throw mapDbError(error);
  if(!entry) return ok({race:null});
  const rows=await db.from("derby_entries").select("lane,stats,owner_id").eq("race",entry.race).order("lane");
  if(rows.error) throw mapDbError(rows.error);
  const runners=rows.data.map(r=>({id:String(r.lane),ghost:true,stats:r.stats}));
  return ok({race:entry.race,lane:String(entry.lane),count:runners.length,players:rows.data.map(r=>({lane:String(r.lane),name:playerName(r.owner_id)})),result:runners.length===8?simulateDerby(runners,entry.race):null});
});}
