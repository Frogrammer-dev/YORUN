"use client";
import Link from "next/link";
import {Icon} from "@/components/Icon";
import {useEffect,useRef,useState} from "react";
import type {DuelAction,DuelResult} from "@/lib/battle/duel";

import {watchBattleDraft,type BattleDraft} from "@/lib/battle/battleDraft";

const labels={strike:"강타",pierce:"꿰뚫기",guard:"방어"};
type Lobby={name:string;plan:DuelAction[]|null;players:{id:string;name:string}[];history:{id:string;opponent:string;attacking:boolean;winner:number|null;turns:number}[]};
async function request(body?:unknown){
  const response=await fetch("/api/duel",body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{cache:"no-store"});
  const data=await response.json();
  if(!response.ok)throw Error(data.message??"대결 서버에 연결하지 못했어요.");
  return data;
}
export default function DuelPage(){
  const [lobby,setLobby]=useState<Lobby>(),[plan,setPlan]=useState<DuelAction[]>(["strike","guard","pierce","strike","guard"]);
  const [consent,agree]=useState(false),[trace,setTrace]=useState<BattleDraft|null>(null),[busy,setBusy]=useState(false),[msg,notice]=useState("");
  const [result,show]=useState<{opponent:string;match:DuelResult}|null>(null);
  const retry=useRef<{target:string;requestId:string}|null>(null);
  async function refresh(){
    const data:Lobby=await request();setLobby(data);return data;
  }
  useEffect(()=>{
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 화면을 열 때 서버에서 받아 온 값을 반영한다
    void refresh().then(data=>{if(data.plan)setPlan(data.plan);}).catch(e=>notice(e.message));
  },[]);
  useEffect(()=>watchBattleDraft(setTrace),[]);
  async function act(player?:{id:string;name:string}){
    if(busy)return;
    setBusy(true);notice("");
    try{
      if(player){
        if(retry.current?.target!==player.id)retry.current={target:player.id,requestId:crypto.randomUUID()};
        const match=await request({action:"challenge",...retry.current});
        show({opponent:player.name,match});retry.current=null;
      }else{
        await request({action:"register",trace:trace?.trace,session:trace?.id,plan,consent});notice("내 기록과 5턴 전략을 등록했어요.");
      }
      await refresh();
    }catch(e){notice(e instanceof Error?e.message:"요청에 실패했어요.");}finally{setBusy(false);}
  }
  return <main className="hub-page"><header className="appbar"><Link href="/hub" className="icon-btn appbar-back" aria-label="콘텐츠로 돌아가기"><Icon name="back" size={24} /></Link><span className="appbar-title"><h1>1대1 플레이어 대결</h1></span></header>
    <div className="hub-body">
    <p className="battle-lead">상대가 접속하지 않아도 미리 등록한 기록과 5턴 전략으로 겨뤄요. 도전과 방어 결과는 양쪽의 전적에 남아요.</p>
    <section className="hub-card"><h2>내 선수 {lobby?.name}</h2>
      <p>최근 완료한 코스 기록과 아래 전략을 등록하면 다른 플레이어도 나에게 도전할 수 있어요.</p>
      <div className="plan-turns">{plan.map((v,i)=><div className="plan-turn" key={i}><span>{i+1}턴</span>
        <div className="seg" role="radiogroup" aria-label={(i+1)+"턴 행동"}>{Object.entries(labels).map(([k,n])=><button key={k} type="button" role="radio" aria-checked={v===k} className={"seg-btn"+(v===k?" seg-on":"")} onClick={()=>setPlan(plan.map((a,j)=>i===j?k as DuelAction:a))}>{n}</button>)}</div></div>)}</div>
      <label className="consent"><input type="checkbox" checked={consent} onChange={e=>agree(e.target.checked)}/> <span>위치를 제거한 기록을 검증하고 내 선수를 상대 목록에 표시하는 데 동의해요.</span></label>
      <button className="btn btn-primary wide" disabled={!trace||!consent||busy} onClick={()=>act()}>{lobby?.plan?"기록과 전략 갱신":"선수 등록"}</button>
      {!trace&&<p className="hint">로그인한 상태에서 온라인으로 코스 달리기를 시작하고 완료하면 인증 기록이 생겨요. <Link href="/routes">러닝으로 이동</Link></p>}</section>
    {msg&&<p className="battle-msg" role="status">{msg} {msg.includes("로그인")&&<Link href="/login?next=/duel">로그인하기</Link>}</p>}
    <section className="hub-card"><div className="battle-head"><h2>대결할 플레이어</h2><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>refresh().then(()=>notice("")).catch(e=>notice(e.message))}>새로고침</button></div>
      <p className="hint">나를 제외한 참가자 중 최근 등록한 최대 10명을 표시해요.</p>
      {lobby?.players.length===0&&<p className="empty">아직 등록된 상대가 없어요.</p>}
      <ol className="battle-list">{lobby?.players.map(p=><li key={p.id}><strong>{p.name}</strong><button type="button" className="btn btn-secondary btn-sm" disabled={busy||!lobby.plan} onClick={()=>act(p)}>도전하기</button></li>)}</ol></section>
    {result&&<section className="hub-card" role="status"><h2>{result.opponent}와의 대결: {result.match.winner===null?"무승부":result.match.winner===0?"승리":"패배"}</h2>
      <table className="turn-table"><thead><tr><th scope="col">턴</th><th scope="col">나</th><th scope="col">상대</th><th scope="col">남은 체력</th></tr></thead><tbody>{result.match.turns.map(t=><tr key={t.turn}><td className="num">{t.turn}</td><td>{labels[t.actions[0]]}</td><td>{labels[t.actions[1]]}</td><td className="num">{Math.round(t.hp[0])} 대 {Math.round(t.hp[1])}</td></tr>)}</tbody></table></section>}
    <section className="hub-card"><h2>최근 대결</h2>
      {lobby?.history.length===0&&<p className="empty">아직 대결 기록이 없어요.</p>}
      <ul className="battle-list">{lobby?.history.map(m=><li key={m.id}><strong>{m.opponent}</strong><span>{m.attacking?"도전":"방어"}, {m.winner===null?"무승부":m.winner===(m.attacking?0:1)?"승리":"패배"}, {m.turns}턴</span></li>)}</ul></section>
    </div>
    </main>;
}
