import {createHash} from "node:crypto";
import {tracePrefix,type DerbyTrace} from "@/lib/battle/derbyTrace";
import {battleDatabase} from "./battle";
import {HttpError,mapDbError} from "./http";

const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function verifyRun(owner:string,id:string,trace:DerbyTrace){
  const {data,error}=await battleDatabase().from("battle_run_sessions").select("trace_hash,course_hash,started,sealed_at,checkpoint_hash,checkpoint_count,checkpoint_time").eq("id",id).eq("owner_id",owner).maybeSingle();
  if(error)throw mapDbError(error);
  const prefix=data?.checkpoint_count ? tracePrefix(trace,data.checkpoint_count) : [];
  if(!data?.sealed_at || !prefix.length || prefix.at(-1)?.[1][1]!==data.checkpoint_time || hash(prefix)!==data.checkpoint_hash || (trace.segments.at(-1)?.at(-1)?.[1]??Infinity)>Date.parse(data.sealed_at)-Date.parse(data.started)+10000 || data.trace_hash!==hash(trace) || data.course_hash!==hash([trace.course,trace.moves]))
    throw new HttpError(422,"unverified_run","이 계정에서 시작하고 완료 확인을 받은 기록만 참가할 수 있어요.");
}
