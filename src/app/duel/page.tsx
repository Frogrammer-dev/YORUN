"use client";
import Link from "next/link";
import { DuelArena, exampleDuel } from "@/components/duel/DuelArena";
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
  const [demo, setDemo] = useState(false);
  const [sample] = useState(() => exampleDuel());
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
  return <main className="hub-page"><Link href="/contents">← 콘텐츠</Link><h1>1대1 플레이어 대결</h1>
    <p>상대가 접속하지 않아도 미리 등록한 기록과 5턴 전략으로 겨뤄요. 도전과 방어 결과는 양쪽의 전적에 남아요.</p>
    <button type="button" className="btn" onClick={() => setDemo(!demo)}>{demo ? "예시 닫기" : "예시 대결 보기"}</button>
    {demo && <DuelArena result={sample} example /> }
    {result && <DuelArena key={JSON.stringify(result)} result={result.match} opponent={result.opponent} /> }
    <section className="hub-card"><h2>내 선수 {lobby?.name}</h2>
      <p>최근 완료한 코스 기록과 아래 전략을 등록하면 다른 플레이어도 나에게 도전할 수 있어요.</p>
      {plan.map((v,i)=><label key={i}>{i+1}턴 <select value={v} onChange={e=>setPlan(plan.map((a,j)=>i===j?e.target.value as DuelAction:a))}>{Object.entries(labels).map(([k,n])=><option key={k} value={k}>{n}</option>)}</select> </label>)}
      <p><label><input type="checkbox" checked={consent} onChange={e=>agree(e.target.checked)}/> 위치를 제거한 기록을 검증하고 내 선수를 상대 목록에 표시하는 데 동의해요.</label></p>
      <button className="btn btn-primary" disabled={!trace||!consent||busy} onClick={()=>act()}>{lobby?.plan?"기록·전략 갱신":"선수 등록"}</button>
      {!trace&&<p>로그인한 상태에서 온라인으로 코스 달리기를 시작하고 완료하면 인증 기록이 생겨요. <Link href="/running">러닝으로 이동</Link></p>}</section>
    {msg&&<p role="status">{msg} {msg.includes("로그인")&&<Link href="/room">로그인하기</Link>}</p>}
    <section className="hub-card"><h2>대결할 플레이어</h2><button disabled={busy} onClick={()=>refresh().then(()=>notice("")).catch(e=>notice(e.message))}>목록 새로고침</button>
      <p>나를 제외한 참가자 중 최근 등록한 최대 10명을 표시해요.</p>
      {lobby?.players.length===0&&<p>아직 등록된 상대가 없어요.</p>}
      <ol>{lobby?.players.map(p=><li key={p.id}>{p.name} <button disabled={busy||!lobby.plan} onClick={()=>act(p)}>도전하기</button></li>)}</ol></section>
    {result&&<section className="hub-card" role="status"><h2>{result.opponent}와의 대결 · {result.match.winner===null?"무승부":result.match.winner===0?"승리":"패배"}</h2>
      <ol>{result.match.turns.map(t=><li key={t.turn}>내 {labels[t.actions[0]]} / 상대 {labels[t.actions[1]]} · 남은 체력 {Math.round(t.hp[0])} 대 {Math.round(t.hp[1])}</li>)}</ol></section>}
    <section className="hub-card"><h2>최근 대결</h2><ul>{lobby?.history.map(m=><li key={m.id}>{m.attacking?"도전":"방어"} · {m.opponent} · {m.winner===null?"무승부":m.winner===(m.attacking?0:1)?"승리":"패배"} · {m.turns}턴</li>)}</ul></section>
    </main>;
}
