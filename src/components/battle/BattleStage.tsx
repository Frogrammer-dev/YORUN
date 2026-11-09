"use client";
// 대결 무대: 생명체처럼 움직이는 그림, 등장 장면, 공격 동작과 효과를 그린다. 판정은 하지 않고 받은 결과만 보여 준다.

import { Fragment, memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { deform, makeCreature, toRenderLine, type PartName } from "@/lib/battle/creature";
import type { BattleState, TurnLog } from "@/lib/battle/turnBattle";
import { turnFx } from "@/lib/battle/turnFx";
import { ENTER_MS, H, HIT_MS, OUTRO_MS, REVEAL_MS, SPOT, W, idleView, introView, outroView, turnView, type Pose, type SceneFighter } from "./scene";
import "./battle.css";

type Pt = [number, number];
const REDUCE = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(REDUCE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(REDUCE).matches,
    () => false,
  );
}

const WAVES = 4, WAVE_MS = 1400, SPEED_TICK_MS = 340;
const rnd = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};
const smooth = (p: number) => {
  const x = Math.min(1, Math.max(0, p));
  return x * x * (3 - 2 * x);
};
const clip = (s: string, n: number) => ([...s].length > n ? [...s].slice(0, n - 1).join("") + "…" : s);

/** 등장 무대 조명: 배경을 어둡게 누르고 주인공에서 제 색 고리가 잔잔히 퍼져 나간다 */
function Spotlight({ side, k, ring, t }: { side: 0 | 1; k: number; ring: number; t: number }) {
  const { x, y, size } = SPOT[side];
  return (
    <g className={side === 0 ? "bt-blue" : "bt-red"}>
      <rect x={-W} y={-H} width={W * 3} height={H * 3} className="bt-dim" opacity={0.55 * k} />
      {Array.from({ length: WAVES }, (_, i) => {
        const ph = (t / WAVE_MS + i / WAVES) % 1;
        return <circle key={i} cx={x} cy={y - size * 0.5} r={size * (0.45 + ph * 1.1)} className="bt-wave" strokeWidth={14 * (1 - ph) + 3} opacity={0.75 * k * (1 - ph)} />;
      })}
      {ring > 0 && ring < 1 && <ellipse cx={x} cy={y} rx={size * (0.3 + ring)} ry={size * (0.06 + ring * 0.2)} className="bt-ring" opacity={1 - ring} />}
    </g>
  );
}

/** 만화 집중선: 화면 가장자리에서 주인공 쪽으로 몰려든다. 깜빡임 기준을 넘지 않게 초당 3번 아래로만 바꾼다 */
const SpeedLines = memo(function SpeedLines({ cx, cy, r, tick, cls = "bt-speed" }: { cx: number; cy: number; r: number; tick: number; cls?: string }) {
  const pt = (a: number, d: number) => `${(cx + Math.cos(a) * d).toFixed(1)} ${(cy + Math.sin(a) * d).toFixed(1)}`;
  return (
    <g className={cls}>
      {Array.from({ length: 56 }, (_, i) => {
        const a = ((i + rnd(tick * 97 + i)) / 56) * Math.PI * 2;
        const w = 0.006 + rnd(tick * 13 + i) * 0.012;
        const d = r * (1.7 + rnd(tick * 31 + i * 7) * 0.5);
        return <path key={i} d={`M${pt(a - w, 1600)} L${pt(a, d)} L${pt(a + w, 1600)} Z`} />;
      })}
    </g>
  );
});

function CreatureArt({ f, pose, side, glow = 0 }: { f: SceneFighter; pose: Pose; side: 0 | 1; glow?: number }) {
  const c = f.creature, { x, y, size } = SPOT[side];
  const pts = deform(c, pose.moves).map((l) => l.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(" "));
  const flip = side === 0 ? 1 : -1;
  const at = (k: PartName): Pt => [c.parts[k].at[0] + (pose.moves[k]?.[0] ?? 0), c.parts[k].at[1] + (pose.moves[k]?.[1] ?? 0)];
  // 눈은 몸 안쪽 자리에서 머리를 따라 움직이고, 눈동자는 상대(+x) 쪽을 본다
  const eye: Pt = [c.eye[0] + (pose.moves.head?.[0] ?? 0), c.eye[1] + (pose.moves.head?.[1] ?? 0)];
  const eyeR = c.eyeRadius, eyeGap = eyeR * 1.25;
  const air = Math.min(1, -Math.min(0, pose.dy) / 150);
  return (
    <g className={side === 0 ? "bt-blue" : "bt-red"} opacity={pose.opacity}>
      <ellipse cx={x + pose.dx} cy={y + Math.max(0, pose.dy)} rx={size * 0.3 * (1 - air * 0.5)} ry={size * 0.05 * (1 - air * 0.5)} className="bt-shadow" />
      <g transform={`translate(${x + pose.dx} ${y + pose.dy}) rotate(${pose.rot} 0 ${-size * (pose.pivot ?? 0)}) scale(${flip * size} ${size * pose.squash}) translate(-0.5 -0.95)`}>
        {glow > 0 && ["bt-halo", "bt-rim"].map((cls) => pts.map((p, i) => <polyline key={cls + i} points={p} className={cls} opacity={glow} vectorEffect="non-scaling-stroke" />))}
        {pts.map((p, i) => <polyline key={i} points={p} className="bt-line" vectorEffect="non-scaling-stroke" />)}
        {(Object.keys(c.parts) as PartName[]).map((k) => {
          const part = c.parts[k];
          if (!part.stub || !part.root) return null;
          // 튀어나온 곳이 없던 부위: 윤곽선에서 짧은 팔다리를 뻗고 끝에 주먹·발을 단다
          const p = at(k);
          return (
            <g key={k}>
              <line x1={part.root[0]} y1={part.root[1]} x2={p[0]} y2={p[1]} className="bt-line" vectorEffect="non-scaling-stroke" />
              <circle cx={p[0]} cy={p[1]} r={0.025} className="bt-fist" />
            </g>
          );
        })}
        {[-eyeGap, eyeGap].map((ex) => (
          <g key={ex}>
            <circle cx={eye[0] + ex} cy={eye[1]} r={eyeR} className="bt-eye" vectorEffect="non-scaling-stroke" />
            <circle cx={eye[0] + ex + eyeR * 0.37} cy={eye[1] + eyeR * 0.14} r={eyeR * 0.46} className="bt-pupil" />
          </g>
        ))}
      </g>
    </g>
  );
}

/** 등장 이름 띠: 화면을 비스듬히 가로질러 미끄러져 들어온다 */
function Banner({ f, side, q }: { f: SceneFighter; side: 0 | 1; q: number }) {
  const k = smooth((q - 0.45) / 0.12), fade = smooth((1 - q) / 0.1);
  const y = side === 1 ? 600 : 80, from = side === 1 ? -1 : 1;
  return (
    <g className={side === 0 ? "bt-blue" : "bt-red"} opacity={fade} transform={`translate(${(1 - k) * from * W} ${y}) rotate(-4 ${W / 2} 0)`}>
      <rect x={-60} y={-64} width={W + 120} height={128} className="bt-band" />
      <text x={W / 2} y={6} textAnchor="middle" className="bt-band-name">{clip(f.name, 16)}</text>
      <text x={W / 2} y={46} textAnchor="middle" className="bt-band-sub">체력 {f.maxHp}, 공격력 {f.attack}</text>
    </g>
  );
}

function HpPanel({ name, hp, max, side, snap }: { name: string; hp: number; max: number; side: 0 | 1; snap: number }) {
  const r = hp / max;
  return (
    <div className={`bt-panel bt-panel-${side === 0 ? "me" : "foe"}`}>
      <div className="bt-panel-name"><span>{name}</span></div>
      <div className="bt-hpline">
        <small>HP</small>
        <div className="bt-bar" role="meter" aria-label={`${name} 체력`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={hp}>
          {/* 뒤: 방금 깎인 만큼 잠깐 남았다가 따라 줄어드는 잔상. 앞: 남은 체력 */}
          <i key={snap} style={{ transform: `scaleX(${r})` }} className="bt-trail" />
          <i style={{ transform: `scaleX(${r})` }} className={r > 0.5 ? "" : r > 0.2 ? "bt-mid" : "bt-low"} />
        </div>
      </div>
      <p className="bt-hpnum">{hp} / {max}</p>
    </div>
  );
}

type Scene =
  | { kind: "intro"; start: number }
  | { kind: "idle"; hp: [number, number] }
  | { kind: "turn"; start: number; log: TurnLog; before: [number, number]; after: [number, number]; winner: BattleState["winner"] }
  | { kind: "outro"; start: number; hp: [number, number]; winner: 0 | 1 | "draw" };

export interface StageCharacter { name: string; lines: readonly (readonly number[])[]; }

export function BattleStage({ me, foe, state, log, onSettled }: { me: StageCharacter; foe: StageCharacter; state: BattleState; log: TurnLog | null; onSettled: () => void }) {
  const calm = useReducedMotion();
  const fighters = useMemo<[SceneFighter, SceneFighter]>(() => [
    { name: me.name, creature: makeCreature([toRenderLine(me.lines)]), maxHp: state.sheets[0].maxHp, attack: state.sheets[0].attack },
    { name: foe.name, creature: makeCreature([toRenderLine(foe.lines)]), maxHp: state.sheets[1].maxHp, attack: state.sheets[1].attack },
    // 대결 하나에서 캐릭터와 능력치는 바뀌지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);
  const [now, setNow] = useState(0);
  const [scene, setScene] = useState<Scene>({ kind: "intro", start: 0 });
  const settledRef = useRef(onSettled);
  useEffect(() => { settledRef.current = onSettled; });

  // 새 턴 결과가 오면 공개부터 다시 연출한다
  const lastTurn = useRef(state.turn);
  const hpRef = useRef<[number, number]>([state.hp[0], state.hp[1]]);
  useEffect(() => {
    if (state.turn === lastTurn.current || !log) return;
    lastTurn.current = state.turn;
    const before = hpRef.current, after: [number, number] = [state.hp[0], state.hp[1]];
    hpRef.current = after;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버 결과가 도착한 시점에 연출을 시작한다
    setScene({ kind: "turn", start: performance.now(), log, before, after, winner: state.winner });
  }, [state.turn, state.hp, state.winner, log]);

  // 시계: 장면이 끝나면 다음 장면으로 넘긴다
  useEffect(() => {
    let id = 0;
    const startedIntro = performance.now();
    const tick = (time: number) => {
      setNow(time);
      setScene((current) => {
        if (current.kind === "intro") {
          const start = current.start || startedIntro;
          if (time - start >= ENTER_MS * 2) return { kind: "idle", hp: hpRef.current };
          return current.start ? current : { ...current, start };
        }
        if (current.kind === "turn" && time - current.start >= REVEAL_MS + HIT_MS) {
          if (current.winner !== null) return { kind: "outro", start: time, hp: current.after, winner: current.winner };
          return { kind: "idle", hp: current.after };
        }
        if (current.kind === "outro" && current.start > 0 && time - current.start >= OUTRO_MS) return { ...current, start: -1 };
        return current;
      });
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  // 장면이 끝나 선택을 받을 수 있게 되면 알린다
  const settledNow = scene.kind === "idle" || (scene.kind === "outro" && scene.start < 0);
  useEffect(() => {
    if (settledNow) settledRef.current();
  }, [settledNow]);

  const inIntro = scene.kind === "intro";
  const view = (() => {
    if (scene.kind === "intro") return introView(fighters, Math.max(0, now - scene.start));
    if (scene.kind === "turn") return turnView(fighters, Math.max(0, now - scene.start), scene.log, turnFx(scene.log, scene.winner), scene.before, scene.after);
    if (scene.kind === "outro") return outroView(fighters, scene.start < 0 ? OUTRO_MS : Math.max(0, now - scene.start), scene.winner, scene.hp);
    return idleView(fighters, now, scene.hp);
  })();
  if (calm) {
    view.shake = [0, 0];
    view.flash = 0;
    if (view.cam) view.cam.z = 1;
  }
  const skipIntro = () => setScene({ kind: "intro", start: performance.now() - ENTER_MS * 2 });

  return (
    <>
      <div className="bt-stage" style={{ "--bt-spd": 1 } as CSSProperties} onClick={inIntro ? skipIntro : undefined}>
        <svg viewBox={`0 0 ${W} ${H}`} className="bt-arena" role="img" aria-label="두 그림이 겨루는 장면">
          <g transform={`translate(${view.shake[0]} ${view.shake[1]})`}>
            <g transform={view.cam ? `translate(${view.cam.x} ${view.cam.y}) scale(${view.cam.z}) translate(${-view.cam.x} ${-view.cam.y})` : undefined}>
              <rect x={-40} y={-40} width={W + 80} height={H + 80} className="bt-sky" />
              <rect x={-40} y={H * 0.36} width={W + 80} height={H * 0.64 + 40} className="bt-field" />
              <ellipse cx={SPOT[1].x} cy={SPOT[1].y + 6} rx={220} ry={46} className="bt-plat" />
              <ellipse cx={SPOT[0].x} cy={SPOT[0].y + 8} rx={290} ry={60} className="bt-plat" />
              {(view.focus?.side === 1 ? ([0, 1] as const) : ([1, 0] as const)).map((i, n) => (
                <Fragment key={i}>
                  {n === 1 && view.focus && view.focus.k > 0 && <Spotlight side={view.focus.side} k={view.focus.k} ring={view.focus.ring} t={calm ? 0 : now} />}
                  <CreatureArt f={fighters[i]} pose={view.poses[i]} side={i} glow={view.focus?.side === i ? view.focus.k : view.impact?.side === i && view.impact.stop ? 1 : 0} />
                </Fragment>
              ))}
              {view.picks && ([0, 1] as const).map((i) => (
                <g key={i} className="bt-pick-bubble">
                  <rect x={SPOT[i].x - 90} y={SPOT[i].y - SPOT[i].size - 62} width={180} height={64} rx={32} />
                  <text x={SPOT[i].x} y={SPOT[i].y - SPOT[i].size - 18} textAnchor="middle">{view.picks![i]}</text>
                </g>
              ))}
              {view.pop && (
                <text x={SPOT[view.pop.side].x + view.poses[view.pop.side].dx} y={SPOT[view.pop.side].y - SPOT[view.pop.side].size - view.pop.p * 60} textAnchor="middle" className={`bt-pop${view.pop.crit ? " bt-crit" : ""}`} opacity={1 - view.pop.p * 0.6}>
                  {view.pop.text}
                </text>
              )}
            </g>
            {view.focus && view.cam && view.focus.k > 0 && (
              <g opacity={0.6 * view.focus.k}>
                <SpeedLines
                  cx={Math.round(view.cam.x + (SPOT[view.focus.side].x - view.cam.x) * view.cam.z)}
                  cy={Math.round(view.cam.y + (SPOT[view.focus.side].y + view.poses[view.focus.side].dy - SPOT[view.focus.side].size * 0.5 - view.cam.y) * view.cam.z)}
                  r={Math.round(SPOT[view.focus.side].size * view.cam.z * 0.85)}
                  tick={calm ? 0 : Math.floor(now / SPEED_TICK_MS)}
                />
              </g>
            )}
            {view.impact && view.cam && view.impact.k > 0 && (
              <g opacity={0.7 * view.impact.k}>
                <SpeedLines
                  cls="bt-impact"
                  cx={Math.round(view.cam.x + (SPOT[view.impact.side].x + view.poses[view.impact.side].dx - view.cam.x) * view.cam.z)}
                  cy={Math.round(view.cam.y + (SPOT[view.impact.side].y + view.poses[view.impact.side].dy - SPOT[view.impact.side].size * 0.5 - view.cam.y) * view.cam.z)}
                  r={Math.round(SPOT[view.impact.side].size * view.cam.z * 0.6)}
                  tick={calm ? 0 : Math.floor(now / SPEED_TICK_MS)}
                />
              </g>
            )}
            {view.banner && <Banner f={fighters[view.banner.side]} side={view.banner.side} q={view.banner.q} />}
          </g>
          {view.flash > 0 && <rect width={W} height={H} className="bt-flash" opacity={view.flash} />}
        </svg>
        {!inIntro && <HpPanel name={fighters[1].name} hp={view.hp[1]} max={fighters[1].maxHp} side={1} snap={0} />}
        {!inIntro && <HpPanel name={fighters[0].name} hp={view.hp[0]} max={fighters[0].maxHp} side={0} snap={0} />}
      </div>
      <div className="bt-msg" aria-live="polite">
        <p>{view.say}</p>
        {inIntro && <button type="button" className="derby-quiet" onClick={skipIntro}>건너뛰기</button>}
      </div>
    </>
  );
}
