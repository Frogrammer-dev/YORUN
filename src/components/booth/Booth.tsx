"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {extract,drawing,nodes,shapes,streets,type Shape} from "./course";
import {simulateDuel,type DuelAction} from "../../lib/battle/duel";
import {simulateDerby} from "../../lib/battle/derby";
import "./booth.css";

type Card={id:string;shape:Shape;center:number[];path:number[];distance:number;number:number};
type Game="duel"|"derby";
const key="yorun.booth.v1", labels={strike:"강타",pierce:"꿰뚫기",guard:"방어"};
function valid(c:Card){return c&&typeof c.id==="string"&&shapes.includes(c.shape)&&Array.isArray(c.path)&&c.path.length>1&&c.path.every(n=>Number.isInteger(n)&&nodes[n])&&Number.isFinite(c.distance)&&Number.isInteger(c.number);}
function history():Card[]{try{const raw=JSON.parse(localStorage.getItem(key)??"[]");return Array.isArray(raw)?raw.filter(valid).slice(-40):[];}catch{return [];}}
const title=(c:Card)=>c.number+"번 러너의 "+c.shape;
const zone=(n:number)=>Math.round(Math.max(-490,Math.min(490,n)));
export default function Booth(){
  const [cards,saveCards]=useState<Card[]>([]),[card,showCard]=useState<Card|null>(null);
  const [shape,choose]=useState<Shape>("강아지"),[center,place]=useState([0,0]),[course,setCourse]=useState<ReturnType<typeof extract>|null>(null);
  const [phase,setPhase]=useState<"map"|"run"|"done">("map"),[fraction,move]=useState(0),[warning,warn]=useState("");
  const [game,setGame]=useState<Game|null>(null),[opponent,pick]=useState(0),[action,plan]=useState<DuelAction>("strike"),[result,showResult]=useState("");
  const routeEl=useRef<SVGPathElement>(null),[runner,setRunner]=useState<number[]|null>(null);
  const map=useRef<SVGSVGElement>(null);
  useEffect(()=>{const h=history();saveCards(h);},[]);
  function reset(){setPhase("map");showCard(null);setCourse(null);setGame(null);showResult("");move(0);setRunner(null);warn("");}
  function relocate(p:number[]){place(p.map(zone));setCourse(null);warn("");}
  function finish(){
    if(!course)return;
    const previous=history(),number=Math.max(0,...cards.map(c=>c.number),...previous.map(c=>c.number))+1;
    const record={id:crypto.randomUUID(),number,shape,center,path:course.path,distance:course.distance};
    const next=[...(previous.length?previous:cards),record].slice(-40);
    try{localStorage.setItem(key,JSON.stringify(next));}catch{warn("기기 저장 공간이 부족해 이번 화면에서만 기록을 유지해요.");}
    saveCards(next);showCard(record);setPhase("done");move(1);
  }
  const finishRef=useRef(finish);
  useEffect(()=>{finishRef.current=finish;});
  useEffect(()=>{
    if(phase!=="run")return;
    const start=performance.now(),duration=window.matchMedia("(prefers-reduced-motion: reduce)").matches?1000:5200;
    let frame=0;
    function tick(t:number){const v=Math.min(1,(t-start)/duration);move(v);
      const path=routeEl.current;
      if(path){const p=path.getPointAtLength(v*path.getTotalLength());setRunner([p.x,p.y]);}
      if(v===1)finishRef.current();else frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);return ()=>cancelAnimationFrame(frame);
  },[phase]);
  const route=phase==="done"?card?.path:course?.path;
  const d=useMemo(()=>route?drawing(route):"",[route]);
  const peers=cards.filter(c=>c.id!==card?.id).slice(-10).reverse();
  function race(){
    if(!card)return;
    const stats=(distance:number)=>({distanceM:distance,adherence:.82,climbMPerKm:null});
    const seed=card.id+":"+game;
    if(game==="duel"){
      const foe=peers[opponent];const name=foe?title(foe):"연습 러너";
      const duel=simulateDuel({id:card.id,stats:stats(card.distance),plan:[action,"guard","pierce","strike",action]},
        {id:foe?.id??"practice",stats:stats(foe?.distance??3000),plan:["guard","strike","pierce","guard","strike"]},seed);
      showResult(name+"와의 체험 대결 · "+(duel.winner===null?"무승부":duel.winner===0?"승리":"패배")+" · "+duel.turns.length+"턴");
    }else{
      const field=Array.from({length:8},(_,i)=>{const c=i===0?card:peers[i-1];const identity=c?.id??"practice-"+i;
        const variant=Array.from(identity).reduce((n,ch)=>(n*31+ch.charCodeAt(0))>>>0,7);
        return {id:identity,name:c?title(c):"연습 러너 "+i,stats:{avgPaceSecPerKm:320+variant%75,cornering:.69+(variant%24)/100,corners:[],paceSplits:[]}};});
      const derby=simulateDerby(field,seed);
      showResult(derby.entries.map(r=>r.rank+"위  "+field.find(f=>f.id===r.id)!.name+(r.id===card.id?"  · 나":"")).join("\n"));
    }
  }
  return <main className="booth"><header><strong>요런</strong><span>드로잉런 체험 부스</span></header>
    <h1>{phase==="done"?"내가 고른 길이 작품이 됐어요":phase==="run"?"지금, 이 길을 달리는 중":"어떤 그림을 달려 볼까요?"}</h1>
    <p>{phase==="map"?"모양을 고르고 지도에서 중심을 눌러 보세요. 주변 도로를 이어 코스를 찾아요.":phase==="run"?"작은 점이 내가 선택한 도로를 따라 달려요.":card&&title(card)+" · "+(card.distance/1000).toFixed(2)+" km · 부스 체험 기록"}</p>
    {phase==="map"&&<div className="choices">{shapes.map(s=><button key={s} aria-pressed={shape===s} onClick={()=>{choose(s);setCourse(null);}}>{s}</button>)}</div>}
    <div className="boothmap"><svg ref={map} viewBox="-1100 -1100 2200 2200" role="img" aria-label="서울 강남 실제 도로망과 체험 경로" onClick={e=>{
      if(phase!=="map"||!map.current)return;const m=map.current.getScreenCTM();if(!m)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());relocate([p.x,p.y]);}}>
      <path d={streets} fill="none" stroke="#a2bdb4" strokeWidth="6"/>
      {d&&<><path d={d} stroke="#fff" strokeWidth="25" fill="none"/><path ref={routeEl} d={d} fill="none" stroke={phase==="run"?"#82a496":"#087763"} strokeWidth="15" strokeLinejoin="round"/>
      {phase==="run"&&<path d={d} pathLength="1" strokeDasharray={fraction+" 1"} fill="none" stroke="#087763" strokeWidth="17"/>}</>}
      {phase==="map"&&!course&&<circle cx={center[0]} cy={center[1]} r="25" fill="#d84428"/>}
      {phase==="run"&&runner&&<circle cx={runner[0]} cy={runner[1]} r="28" fill="#f66842" stroke="white" strokeWidth="8"/>}
    </svg><small>서울 강남 · © OpenStreetMap contributors</small></div>
    {phase==="map"&&<><div className="choices">{[["서쪽",-320,0],["중앙",0,0],["동쪽",320,0]].map(([n,x,y])=><button key={n} onClick={()=>relocate([Number(x),Number(y)])}>{n}</button>)}</div>
      <button className="primary" onClick={()=>{try{setCourse(extract(shape,center));}catch{warn("다른 중심을 골라 주세요.");}}}>이곳에서 경로 추출</button>
      {course&&<button className="primary" onClick={()=>setPhase("run")}>{(course.distance/1000).toFixed(2)} km · 가상 달리기 시작</button>}</>}
    {phase==="run"&&<p role="status">가상 완주 {Math.round(100*fraction)}%</p>}
    {phase==="done"&&card&&<><div className="choices"><button onClick={()=>{setGame("duel");showResult("");pick(0);}}>1대1 체험 대결</button><button onClick={()=>{setGame("derby");showResult("");}}>8인 체험 경주</button></div>
      {game&&<section className="play"><h2>{game==="duel"?"상대와 첫 전략을 고르세요":"여덟 레인에서 경주하기"}</h2>
      <p>{game==="duel"?"이 기기에서 먼저 체험한 러너에게 도전해요.":"이전 참가 기록으로 편성하고 빈 레인은 연습 러너로 채워요."} 능력치는 체험용이에요.</p>
      {game==="duel"&&<><label>상대 <select value={opponent} onChange={e=>{pick(+e.target.value);showResult("");}}>{peers.length?peers.map((p,i)=><option key={p.id} value={i}>{title(p)}</option>):<option value={0}>연습 러너</option>}</select></label>
      <label>첫 전략 <select value={action} onChange={e=>{plan(e.target.value as DuelAction);showResult("");}}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></>}
      <button onClick={race}>{game==="duel"?"대결 시작":"경주 결과 보기"}</button>{result&&<pre role="status">{result}</pre>}</section>}
      <button className="primary" onClick={reset}>다음 참가자 시작</button></>}
    {warning&&<p role="alert">{warning}</p>}
    {phase!=="run"&&cards.length>0&&<details><summary>이 기기의 체험 작품방 · {cards.length}개</summary><div className="gallery">{cards.slice().reverse().map(c=><button key={c.id} onClick={()=>{showCard(c);setPhase("done");setGame(null);showResult("");warn("");}}>
      <svg viewBox={(Math.min(...c.path.map(i=>nodes[i][0]))-60)+" "+(Math.min(...c.path.map(i=>nodes[i][1]))-60)+" "+(Math.max(...c.path.map(i=>nodes[i][0]))-Math.min(...c.path.map(i=>nodes[i][0]))+120)+" "+(Math.max(...c.path.map(i=>nodes[i][1]))-Math.min(...c.path.map(i=>nodes[i][1]))+120)}><path d={drawing(c.path)} fill="none" stroke="#087763" strokeWidth="24"/></svg>{title(c)}</button>)}</div></details>}
    <footer>가상 완주 기록은 이 브라우저의 체험 작품방에 최근 40개까지 보관해요. 실제 GPS 기록과 공식 순위는 별도로 관리해요.</footer>
    </main>;
}
