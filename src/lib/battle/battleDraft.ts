"use client";
import {browserSupabase} from "@/lib/client/supabaseBrowser";
import {tracePrefix,type DerbyTrace} from "./derbyTrace";

type Ticket={id:string;owner:string;runId:number};
export type BattleDraft=Ticket & {trace:DerbyTrace};
const ticketKey=(id:number)=>"yorun.battle.ticket."+id;
const draftKey=(owner:string)=>"yorun.battle.draft."+owner;
const invalidated=new Set<number>();
const starts=new Map<number,Promise<void>>();
async function digest(value:unknown){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
}
async function send(body:unknown){
  const res=await fetch("/api/battle-run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  const data=await res.json();
  if(!res.ok)throw Error(data.message??"대결 서버에 연결할 수 없어요.");
  return data as {id:string;owner:string};
}
export function beginBattleRun(runId:number,trace:DerbyTrace){
  const task=(async()=>{
    localStorage.removeItem("yorun.lastDerbyTrace");
    if(!(await browserSupabase()?.auth.getSession())?.data.session)return;
    const ticket=await send({action:"start",runId,courseHash:await digest([trace.course,trace.moves])});
    if(invalidated.has(runId))return;
    localStorage.setItem(ticketKey(runId),JSON.stringify({...ticket,runId}));
  })().catch(()=>{ /* 일반 러닝은 오프라인에서도 진행한다. */ });
  starts.set(runId,task);
  void task.finally(()=>{starts.delete(runId);invalidated.delete(runId);});
}
export async function checkpointBattleRun(runId:number,build:()=>DerbyTrace){
  const key=ticketKey(runId),raw=localStorage.getItem(key);
  if(!raw)return;
  const ticket=JSON.parse(raw);
  if(ticket.checked)return;
  const trace=build(),prefix=tracePrefix(trace,8000);
  const time=prefix.at(-1)?.[1][1]??0;
  if(prefix.length<3 || time<10000)return;
  await send({action:"checkpoint",id:ticket.id,hash:await digest(prefix),count:prefix.length,time});
  if(localStorage.getItem(key)===raw)localStorage.setItem(key,JSON.stringify({...ticket,checked:true}));
}
export async function finishBattleRun(runId:number,trace:DerbyTrace){
  await starts.get(runId);
  const key=ticketKey(runId),raw=localStorage.getItem(key);
  if(!raw){
    if(!(await browserSupabase()?.auth.getSession())?.data.session)return;
    throw Error("로그인 상태에서 온라인으로 시작한 코스 기록이 필요해요.");
  }
  const ticket:Ticket=JSON.parse(raw);
  const sealed=await send({action:"seal",id:ticket.id,traceHash:await digest(trace),duration:trace.segments.at(-1)?.at(-1)?.[1]??0});
  if(sealed.owner!==ticket.owner||JSON.parse(localStorage.getItem(key)??"null")?.id!==ticket.id)return;
  localStorage.setItem(draftKey(ticket.owner),JSON.stringify({...ticket,trace}));
  window.dispatchEvent(new Event("battle-draft"));
}
export function discardBattleRun(runId:number|null){
  localStorage.removeItem("yorun.lastDerbyTrace");
  if(runId===null)return;
  if(starts.has(runId))invalidated.add(runId);
  const key=ticketKey(runId),raw=localStorage.getItem(key);
  localStorage.removeItem(key);
  if(!raw)return;
  const owner=JSON.parse(raw).owner;
  if(JSON.parse(localStorage.getItem(draftKey(owner))??"null")?.runId===runId)localStorage.removeItem(draftKey(owner));
}
export function watchBattleDraft(set:(value:BattleDraft|null)=>void){
  localStorage.removeItem("yorun.lastDerbyTrace");
  const auth=browserSupabase()?.auth;
  let owner:string|undefined;
  function read(){
    try {set(owner?JSON.parse(localStorage.getItem(draftKey(owner))??"null"):null);}catch{set(null);}
  }
  const sub=auth?.onAuthStateChange((_event,session)=>{owner=session?.user.id;read();});
  window.addEventListener("battle-draft",read);
  window.addEventListener("storage",read);
  return ()=>{window.removeEventListener("battle-draft",read);sub?.data.subscription.unsubscribe();window.removeEventListener("storage",read);};
}
