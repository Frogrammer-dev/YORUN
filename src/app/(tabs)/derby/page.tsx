"use client";
import Link from "next/link";
import {Icon} from "@/components/Icon";
import {useCallback,useEffect,useMemo,useState} from "react";
import {simulateDerby,type DerbyResult} from "@/lib/battle/derby";

import {watchBattleDraft,type BattleDraft} from "@/lib/battle/battleDraft";

type Room={race:string|null;count?:number;lane?:string;players?:{lane:string;name:string}[];result?:DerbyResult|null};
function Replay({result,mine,players}:{result:DerbyResult;mine?:string;players?:Room["players"]}){
  const [clock,setClock]=useState(0),[playing,play]=useState(false);
  const end=Math.max(...result.entries.map(r=>r.finishSeconds));
  useEffect(()=>{
    if(!playing) return;
    const start=performance.now(),base=clock;
    const timer=setInterval(()=>{const t=Math.min(end,base+(performance.now()-start)/1000*24);setClock(t);if(t===end)play(false);},100);
    return ()=>clearInterval(timer);
    // clock is sampled only when playback starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[playing,end]);
  const lanes=result.entries.map(r=>{
    const section=r.splits.filter(t=>t<=clock).length;
    const from=r.splits[section-1]??0;
    const progress=section===12?12:section+(clock-from)/(r.splits[section]-from);
    return {...r,section,progress};
  }).sort((a,b)=>b.progress-a.progress || (clock===end?a.rank-b.rank:Number(a.id)-Number(b.id)));
  return <section className="hub-card"><h2>{clock===end?"최종 순위":"경주 리플레이"}</h2>
    <p className="hint">1.2km, 12구간, 24배속</p>
    <button type="button" className="btn btn-primary wide" onClick={()=>{if(clock===end)setClock(0);play(!playing);}}>{playing?"일시정지":clock===end?"다시 보기":clock?"이어서 보기":"출발"}</button>
    <ol className="race-lanes">{lanes.map(r=><li key={r.id}><strong>{players?.find(p=>p.lane===r.id)?.name ?? (r.id+"번 러너")}{r.id===mine?" (나)":""}</strong>
      <span>{r.section===12?`완주 ${r.finishSeconds.toFixed(1)}초`:`${r.section+1}구간 ${result.sections[r.section]==="corner"?"코너":"직선"}`}</span>
      <progress aria-label={r.id+"번 러너 진행률"} value={r.progress} max={12}/>
    </li>)}</ol></section>;
}
export default function DerbyPage(){
  const [room,setRoom]=useState<Room>({race:null}),[trace,setTrace]=useState<BattleDraft|null>(null);
  const [demo,showDemo]=useState(false),[consent,agree]=useState(false),[busy,pending]=useState(false),[message,notice]=useState("");
  const sample=useMemo(()=>simulateDerby(Array.from({length:8},(_,i)=>({id:String(i+1),ghost:true,
    stats:{avgPaceSecPerKm:270+i*15,cornering:0.55+i*0.05,paceSplits:[],corners:[]}})),"practice-v1"),[]);
  const refresh=useCallback(async(id?:string)=>{
    const res=await fetch("/api/derby"+(id?"?race="+encodeURIComponent(id):""),{cache:"no-store"});
    const data=await res.json();
    if(!res.ok)throw Error(data.message??"경주를 불러오지 못했어요.");
    setRoom(data);notice("");
  },[]);
  useEffect(()=>{
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 화면을 열 때 서버에서 받아 온 값을 반영한다
    void refresh().catch(e=>notice(e.message));
  },[refresh]);
  useEffect(()=>{
    if(!room.race||room.result)return;
    const timer=setInterval(()=>void refresh(room.race!).catch(e=>notice(e.message)),7000);
    return ()=>clearInterval(timer);
  },[room.race,room.result,refresh]);
  useEffect(()=>watchBattleDraft(setTrace),[]);
  async function enter(){
    if(!trace||!consent||busy)return;
    pending(true);
    try{
      const res=await fetch("/api/derby",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({trace:trace.trace,session:trace.id,consent})});
      const data=await res.json();if(!res.ok)throw Error(data.message);
      await refresh(data.race);showDemo(false);
    }catch(e){notice(e instanceof Error?e.message:"참가하지 못했어요.");}finally{pending(false);}
  }
  return <main className="hub-page"><header className="appbar"><Link href="/hub" className="icon-btn appbar-back" aria-label="콘텐츠로 돌아가기"><Icon name="back" size={24} /></Link><span className="appbar-title"><h1>8인 드로잉 더비</h1></span></header>
    <div className="hub-body">
    <p className="battle-lead">여덟 명이 각자 달린 기록으로 경주해요. 직선에서는 구간 페이스가, 코너에서는 코스를 따라 달린 정교함이 속도를 결정해요.</p>
    {room.race && <p className="battle-msg" role="status">내 레인 {room.lane}번, {room.count}/8명, {room.result?"편성 완료":"참가 대기 중"}</p>}
    {room.race && !room.result && <section className="hub-card"><h2>매칭된 플레이어</h2><ol className="battle-list">{room.players?.map(p=><li key={p.lane}><strong>{p.name}{p.lane===room.lane?" (나)":""}</strong></li>)}</ol><p>나를 포함해 서로 다른 8명이 모이면 경기가 열려요.</p></section>}
    {(!room.race||room.result)&&<section className="hub-card"><h2>내 기록으로 참가</h2>
      <p>{trace?"최근 완료한 코스 기록을 사용할 수 있어요.":"로그인한 상태에서 온라인으로 코스 달리기를 시작하고 1km 이상 완료한 인증 기록이 필요해요."} <Link href="/routes">러닝으로 이동</Link></p>
      <label className="consent"><input type="checkbox" checked={consent} onChange={e=>agree(e.target.checked)}/> <span>참가 검증을 위해 출발 위치를 제거한 코스·달린 선과 상대 시간을 전송하는 데 동의해요. 서버에는 경기 능력치와 참가 이력을 저장해요.</span></label>
      <button type="button" className="btn btn-primary wide" disabled={!trace||!consent||busy} onClick={enter}>{busy?"기록 확인 중":"기록 제출하기"}</button></section>}
    {message&&<p className="battle-msg" role="status">{message} {message.includes("로그인") && <Link href="/room">로그인하러 가기</Link>} <button type="button" className="btn btn-ghost btn-sm" onClick={()=>void refresh().catch(e=>notice(e.message))}>다시 확인</button></p>}
    {room.result && !demo && <Replay key={room.race} result={room.result} mine={room.lane} players={room.players}/>}
    <button type="button" className="btn btn-secondary wide" onClick={()=>showDemo(!demo)}>{demo?"예시 닫기":"예시 경기 체험"}</button>
    {demo&&<><p className="hint">합성 기록 8개로 구성한 연습 경기예요.</p><Replay result={sample}/></>}
    </div>
  </main>;
}
