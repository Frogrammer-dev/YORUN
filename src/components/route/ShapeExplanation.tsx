"use client";

import { useId, useState } from "react";
import type { RouteCandidate } from "@/lib/route/fit";
import { latlngToXY } from "@/components/Icon";

/** Illustration only: route coordinates, route storage and GPX are never modified. */
export function ShapeExplanation({ c }: { c: RouteCandidate }) {
  const [enabled, setEnabled] = useState(true);
  const clipId = useId().replace(/:/g, "");
  const key = c.doodle?.name ?? c.shapeId;
  const rectangle = key === "square" || c.shapeName === "네모";
  const kind = rectangle || ["bread", "toast"].includes(key) ? "toast"
    : ["cell_phone", "phone", "door", "toaster", "hammer", "knife", "sword", "saw", "seesaw", "star", "crown"].includes(key) ? key : null;
  if (!kind || c.latlngs.length < 2) return null;
  const xy = latlngToXY(c.latlngs), xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX-minX, maxY-minY) || 1;
  const points = xy.map(([x,y]) => [150+(x-(minX+maxX)/2)/span*240,150-(y-(minY+maxY)/2)/span*240]);
  const route = points.map(([x,y],i)=>`${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const left = Math.min(...points.map(p=>p[0])), top = Math.min(...points.map(p=>p[1]));
  const w = Math.max(...points.map(p=>p[0]))-left, h = Math.max(...points.map(p=>p[1]))-top;
  const x = (v:number)=>left+w*v, y=(v:number)=>top+h*v;
  const title = rectangle ? "토스트로 상상해 보기" : `${c.shapeName}로 해석해 보기`;
  const explanation = kind === "toast" ? "외곽선을 빵의 가장자리로 보고, 안쪽에 빵 테두리와 작은 기공을 상상해 보세요."
    : kind === "hammer" ? "넓은 부분을 망치 머리, 길고 좁은 부분을 손잡이로 보는 해석이에요."
    : ["knife","sword","saw"].includes(kind) ? "길게 뻗은 부분을 날로 보는 해석이에요. 안쪽 선은 날과 손잡이를 상상하도록 돕는 표시예요."
    : kind === "seesaw" ? "긴 부분을 시소 판, 아래로 뻗은 부분을 받침으로 보는 해석이에요."
    : "실제 외곽선에 내부 특징을 상상해 더한 설명 그림이에요.";
  return <section className="shape-explanation" aria-label="경로 모양 해석">
    <div className="shape-explanation-head"><strong>{title}</strong><label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} /> 꾸밈선</label></div>
    <svg viewBox="0 0 300 300" role="img" aria-label={`${title}. 파란 실선은 실제 경로, 보라색 점선은 상상한 특징입니다.`}>
      <defs><clipPath id={clipId}><path d={`${route} Z`} /></clipPath></defs>
      <path d={route} fill="none" stroke="#0EA5E9" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
      {enabled && <g stroke="#9864C6" strokeWidth="2" strokeDasharray="4 5" fill="none" strokeLinecap="round" clipPath={`url(#${clipId})`}>
        {kind === "toast" && <><rect x={x(.12)} y={y(.12)} width={w*.76} height={h*.76} rx={Math.min(w,h)*.13} />{[[.3,.3],[.65,.27],[.45,.5],[.7,.65],[.27,.73]].map(([a,b],i)=><circle key={i} cx={x(a)} cy={y(b)} r="3" />)}</>}
        {["cell_phone","phone","door"].includes(kind) && <><rect x={x(.14)} y={y(.13)} width={w*.72} height={h*.68} rx="4" /><circle cx={x(.5)} cy={y(.89)} r="4" /></>}
        {kind === "toaster" && <><path d={`M${x(.2)} ${y(.2)} H${x(.8)} M${x(.2)} ${y(.29)} H${x(.8)}`} /><circle cx={x(.8)} cy={y(.75)} r="6" /></>}
        {kind === "hammer" && <>{[.68,.76,.84].map(v=><path key={v} d={`M${x(.32)} ${y(v)} H${x(.68)}`} />)}</>}
        {["knife","sword","saw"].includes(kind) && <path d={`M${x(.22)} ${y(.78)} L${x(.8)} ${y(.22)}`} />}
        {kind === "seesaw" && <path d={`M${x(.18)} ${y(.7)} L${x(.82)} ${y(.3)}`} />}
        {["star","crown"].includes(kind) && <>{[.35,.5,.65].map(v=><circle key={v} cx={x(v)} cy={y(.75)} r="4" />)}</>}
      </g>}
    </svg>
    <p>{explanation}</p><p className="hint">파란 실선: 달릴 길 · 보라색 점선: 꾸밈선(달리는 길이 아니에요).{rectangle && " 토스트는 인식 결과가 아닌 상상 예시예요."}</p>
  </section>;
}
