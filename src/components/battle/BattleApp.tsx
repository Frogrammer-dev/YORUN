"use client";
// 대결 시제품: 내 작품 두 개(또는 예시 기록)를 골라 생명체처럼 달려와 싸우게 한다.
// 매칭·서버 판정 없이 이 화면에서 씨앗을 뽑아 simulate로 승패를 정하고 그대로 재생한다.
// 구도는 포켓몬 배틀처럼: 내 그림은 앞(왼쪽 아래, 크게), 상대는 뒤(오른쪽 위 받침대, 작게).

import Link from "next/link";
import { Fragment, memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { buildDemoArtwork, type DemoShape } from "@/lib/art/artwork";
import { DEMO_ROUTES } from "@/lib/art/demoRoutes";
import {
  addResult,
  deform,
  josa,
  makeFighter,
  simulate,
  summarize,
  type BattleRecord,
  type BattleRecords,
  type Fight,
  type Fighter,
  type PartName,
} from "@/lib/battle/battle";
import { api } from "@/lib/client/api";
import type { ArtworkView, MyRoomDto, Pt } from "@/lib/contracts/types";
import { DraftRepository } from "@/lib/draft/DraftRepository";
import { formatDistance } from "@/lib/gpx/metrics";
import { formatPace } from "@/lib/run/tracker";
import { makeShareCard, shareCard } from "./shareCard";

const W = 1000,
  H = 740;
/** 발 위치와 크기: 0 = 나(앞), 1 = 상대(뒤) */
const SPOT = [
  { x: 270, y: 690, size: 330 },
  { x: 735, y: 330, size: 230 },
] as const;
/** 등장씬은 한 마리씩: 상대 먼저, 그다음 나 */
const ENTER_MS = 2400,
  HIT_MS = 1400,
  OUTRO_MS = 2600;

/** 등장 방식: 이름으로 정해서 같은 그림은 늘 같은 방식으로 나온다 */
const ENTRANCES = [
  { kind: "run", verb: "전력으로 달려왔다!" },
  { kind: "drop", verb: "하늘에서 쿵 떨어졌다!" },
  { kind: "spin", verb: "빙글빙글 날아왔다!" },
  { kind: "pop", verb: "땅에서 불쑥 솟아올랐다!" },
] as const;
const entranceOf = (f: Fighter) => ENTRANCES[[...f.name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % ENTRANCES.length];

/** 이름 띠에 들어갈 만큼만: 길면 말줄임 */
const clip = (s: string, n: number) => ([...s].length > n ? [...s].slice(0, n - 1).join("") + "…" : s);

/** 기기의 '동작 줄이기' 설정. 켜져 있으면 번쩍임·흔들림·확대·지글거림을 뺀다 */
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

/** 어느 부위로 칠지: 같은 씨앗이면 같은 순서 */
const MOVES = [
  { part: "handR", name: "펀치" },
  { part: "head", name: "박치기" },
  { part: "footR", name: "발차기" },
] as const;

/** 로그인했으면 서버 작품, 아니면 이 기기의 임시 작품. 예시 기록은 늘 덧붙인다. */
async function loadArtworks(): Promise<ArtworkView[]> {
  let mine: ArtworkView[] = [];
  try {
    mine = (await api<MyRoomDto>("/api/me/room")).artworks;
  } catch {
    mine = (await DraftRepository.loadGuest().catch(() => null))?.artworks ?? [];
  }
  return [...mine, ...(Object.keys(DEMO_ROUTES) as DemoShape[]).map((s) => buildDemoArtwork(s).view)];
}

/** 작품별 대결 전적은 이 기기에만 둔다 */
// ponytail: 기기 저장이라 다른 기기·재설치 땐 사라진다. 로그인 전적이 필요해지면 /api/me/room 옆에 서버 저장으로 옮긴다.
const RECORDS_KEY = "yorun.battle.records";
function loadRecords(): BattleRecords {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) ?? "{}") as BattleRecords;
  } catch {
    return {};
  }
}
function saveRecords(r: BattleRecords) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(r));
  } catch {
    // 사생활 보호 모드 등 저장이 막혀도 대결은 그대로 된다
  }
}
const recordText = (r: BattleRecord | undefined) => (r ? `${r.w}승 ${r.l}패${r.streak >= 2 ? ` · ${r.streak}연승` : ""}` : "첫 대결");

/** 마지막 한 방: KO면 누가 무엇으로 끝냈는지 */
function finisherText(fight: Fight, fs: [Fighter, Fighter]) {
  const n = fight.hits.length - 1,
    h = fight.hits[n];
  if (!fight.ko || !h) return "끝까지 버텨 판정으로 갈렸다!";
  return `${fs[h.by].name}의 ${h.crit ? "급소 " : ""}${MOVES[(fight.seed + n) % MOVES.length].name}!`;
}

const toFighter = (a: ArtworkView): Fighter =>
  // ponytail: 작품에는 아직 달린 시간이 없어 속도는 기본값. 작품 stats에 시간을 넣으면 durationMs로 넘긴다.
  makeFighter({
    name: a.title,
    renderLines: a.renderLines,
    distanceMeters: a.stats.distanceEstimateMeters,
    durationMs: null,
  });

const level = (a: ArtworkView) => Math.max(1, Math.round(a.stats.distanceEstimateMeters / 1000));
const ease = (p: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, p)));

interface Pose {
  /** 제자리(SPOT)에서 옮긴 양 */
  dx: number;
  dy: number;
  rot: number;
  squash: number;
  opacity: number;
  moves: Partial<Record<PartName, Pt>>;
  /** 회전 축 높이 (키 대비). 없으면 발끝을 축으로 돈다 */
  pivot?: number;
}

/** 달리는 다리·흔드는 팔 (상대 쪽이 +x인 자기 좌표) */
function gait(t: number, amp: number): Partial<Record<PartName, Pt>> {
  const s = Math.sin(t / 90),
    c = Math.cos(t / 90);
  return {
    footL: [s * 0.07 * amp, -Math.max(0, s) * 0.06 * amp],
    footR: [-s * 0.07 * amp, -Math.max(0, -s) * 0.06 * amp],
    handL: [-s * 0.05 * amp, c * 0.03 * amp],
    handR: [s * 0.05 * amp, -c * 0.03 * amp],
    head: [0, Math.abs(c) * -0.02 * amp],
  };
}

interface View {
  poses: [Pose, Pose];
  hp: [number, number];
  pop: { side: 0 | 1; text: string; crit: boolean; p: number } | null;
  say: string;
  shake: Pt;
  flash: number;
  /** 등장씬 카메라: (x, y)를 중심으로 z배 확대 */
  cam: { x: number; y: number; z: number } | null;
  /** 등장씬 이름 띠: 누구의 띠인지와 그 등장씬의 진행도(0~1) */
  banner: { side: 0 | 1; q: number } | null;
  /** 등장씬 강조: k는 세기(0~1), ring은 착지 충격파 진행도(0~1 밖이면 안 보임) */
  focus: { side: 0 | 1; k: number; ring: number } | null;
  /** 치명타 충격: 맞은 쪽, 세기(0~1), 경직(히트스톱) 중인지 */
  impact: { side: 0 | 1; k: number; stop: boolean } | null;
}

/** 치명타 경직: 맞은 자세가 보이는 순간(FREEZE_AT)에서 한 대결 동작의 STOP 비율만큼 화면을 멈춘다 */
const FREEZE_AT = 0.47,
  STOP = 0.16;

/** 정수 n마다 고정된 0~1 난수 (집중선이 매 프레임 같은 모양으로 나오게) */
const rnd = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** 0~1 사이로 자르고 부드럽게 */
const smooth = (p: number) => {
  const x = Math.min(1, Math.max(0, p));
  return x * x * (3 - 2 * x);
};

/** side의 등장씬 진행도 q(0~1)에 맞춰 자세·카메라·띠를 정한다 */
function enter(v: View, side: 0 | 1, f: Fighter, q: number, t: number) {
  const pose = v.poses[side],
    out = side === 0 ? -1 : 1,
    kind = entranceOf(f).kind;
  const a = Math.min(1, q / 0.4),
    r = 1 - a;
  if (a < 1) {
    if (kind === "run") {
      pose.dx = out * r * r * 700;
      pose.dy = -Math.abs(Math.sin(t / 90)) * 16;
      pose.moves = gait(t, 1.3);
    } else if (kind === "drop") {
      pose.dy = -r * r * 900;
      pose.moves = {
        handL: [-0.06, -0.22],
        handR: [0.06, -0.22],
        footL: [0, 0.04],
        footR: [0, 0.04],
      };
    } else if (kind === "spin") {
      pose.dx = out * r * 700;
      pose.dy = -Math.sin(Math.PI * a) * 220;
      pose.rot = -out * r * 720;
      pose.pivot = 0.5;
    } else {
      // 발끝에서 위로 자라나며 살짝 넘쳤다가 돌아온다 (0배는 변환이 깨지니 아주 작게 시작)
      pose.squash = Math.max(0.02, a < 0.7 ? (a / 0.7) * 1.25 : 1.25 - ((a - 0.7) / 0.3) * 0.25);
      pose.moves = gait(t, 1);
    }
  } else {
    // 착지해서 찌그러졌다가, 만세하며 두 번 콩콩 뛰어 뽐낸다
    const s = (q - 0.4) / 0.6;
    if (s < 0.15) {
      pose.squash = 1 - 0.25 * ease(s / 0.15);
      if (kind === "drop") v.shake = [0, Math.sin(t / 14) * 16 * (1 - s / 0.15)];
    } else {
      pose.dy = -Math.abs(Math.sin(((s - 0.15) / 0.85) * Math.PI * 2)) * 50;
      pose.rot = Math.sin(t / 120) * 6;
      pose.moves = {
        ...gait(t, 0.4),
        handL: [-0.06, -0.25],
        handR: [0.06, -0.25],
      };
    }
  }
  // 1.5배로 바짝 당기고, 착지하는 순간엔 1.6배까지 한 번 더 '쿵' 들어갔다 돌아온다
  const z = 1 + (0.5 * smooth((q - 0.3) / 0.12) + 0.1 * ease((q - 0.4) / 0.12)) * smooth((1 - q) / 0.15);
  // 나는 화면 아래 끝에 서 있어 발을, 상대는 몸 위쪽을 중심으로 당겨 잘리지 않게 한다.
  // 뽐내며 뛰는 높이만큼 카메라도 따라 올라가 머리가 화면 밖으로 나가지 않게 (날아오는 동안의 큰 움직임은 따라가지 않는다)
  const follow = Math.max(-60, Math.min(0, pose.dy));
  v.cam = { x: SPOT[side].x, y: (side === 0 ? SPOT[side].y : SPOT[side].y - SPOT[side].size * 0.6) + follow, z };
  if (q > 0.45) v.banner = { side, q };
  // 착지하는 순간부터 주인공만 밝게: 번쩍 + 충격파, 그리고 끝날 때까지 강조
  v.focus = { side, k: smooth((q - 0.38) / 0.06) * smooth((1 - q) / 0.15), ring: (q - 0.4) / 0.2 };
  if (q >= 0.4 && q < 0.46) v.flash = 0.55 * (1 - (q - 0.4) / 0.06);
}

/** 시각 t의 장면. fight가 없으면 제자리에서 꼼지락댄다. */
function frame(fight: Fight | null, fs: [Fighter, Fighter], time: number, enterMs: number): View {
  let t = time;
  const poses = [0, 1].map((i) => ({
    dx: 0,
    dy: 0,
    rot: 0,
    squash: 1,
    opacity: 1,
    moves: gait(t * 0.6 + i * 140, 0.25),
  })) as [Pose, Pose];
  const v: View = {
    poses,
    hp: [fs[0].hp, fs[1].hp],
    pop: null,
    say: "",
    shake: [0, 0],
    flash: 0,
    cam: null,
    banner: null,
    focus: null,
    impact: null,
  };
  if (!fight) return v;

  if (t < enterMs * 2) {
    // 상대가 먼저 등장하고 내 그림은 그동안 화면 밖에서 기다린다. 등장 문장은 착지한 뒤에 띄운다
    const side = t < enterMs ? 1 : 0,
      q = (t - (side === 1 ? 0 : enterMs)) / enterMs,
      f = fs[side];
    if (side === 1) poses[0].opacity = 0;
    enter(v, side, f, q, t);
    v.say = q >= 0.4 ? `${josa(f.name, "이", "가")} ${entranceOf(f).verb}` : side === 1 ? `앗! 상대 ${josa(f.name, "이", "가")} 나타났다!` : `가랏! ${f.name}!`;
    return v;
  }

  const ht = t - enterMs * 2,
    n = Math.min(fight.hits.length, Math.floor(ht / HIT_MS));
  if (n > 0) v.hp = [...fight.hits[n - 1].hp];

  if (n < fight.hits.length) {
    const h = fight.hits[n],
      raw = (ht % HIT_MS) / HIT_MS,
      // 치명타면 FREEZE_AT에서 STOP만큼 시간을 멈추고(경직), 남은 동작은 그만큼 빠르게 마저 한다
      stop = h.crit && !h.dodged && raw > FREEZE_AT && raw <= FREEZE_AT + STOP,
      p = !h.crit || h.dodged || raw <= FREEZE_AT ? raw : stop ? FREEZE_AT : FREEZE_AT + ((raw - FREEZE_AT - STOP) * (1 - FREEZE_AT)) / (1 - FREEZE_AT - STOP),
      a = h.by,
      d = (1 - a) as 0 | 1;
    // 경직 동안엔 다리·떨림도 같이 멈추도록 시계를 붙잡는다
    if (stop) t -= (raw - FREEZE_AT) * HIT_MS;
    const atk = poses[a],
      def = poses[d],
      move = MOVES[(fight.seed + n) % MOVES.length];
    const fwd = a === 0 ? 1 : -1;
    // 공격하는 쪽에서 맞는 쪽으로 가는 방향 (대각선)
    const vx = SPOT[d].x - SPOT[a].x,
      vy = SPOT[d].y - SPOT[a].y;
    const wind = p < 0.15 ? ease(p / 0.3) : 0,
      k = ease((p - 0.15) / 0.5);
    atk.dx = vx * 0.42 * k - fwd * 30 * wind;
    atk.dy = vy * 0.42 * k - Math.sin(Math.PI * k) * 40;
    atk.rot = fwd * (k * 10 - wind * 8);
    const reach = h.crit ? 0.6 : 0.42;
    atk.moves =
      move.part === "head"
        ? { ...gait(t, 0.4), head: [k * reach * 0.7, k * 0.06] }
        : move.part === "footR"
          ? { ...gait(t, 0.4), footR: [k * reach, -k * 0.3] }
          : { ...gait(t, 0.4), handR: [k * reach, -k * 0.06] };
    if (move.part === "head") atk.rot += fwd * k * 14;
    v.say = `${fs[a].name}의 ${move.name}!`;

    const hitAt = 0.4;
    if (h.dodged) {
      const j = ease((p - 0.25) / 0.5);
      def.dy = -j * 120;
      def.dx = -fwd * j * 40;
      def.moves = {
        footL: [0, -0.08],
        footR: [0, -0.08],
        handL: [-0.05, -0.15],
        handR: [0.05, -0.15],
      };
      if (p > hitAt) {
        v.say = "하지만 공격이 빗나갔다!";
        v.pop = {
          side: d,
          text: "MISS",
          crit: false,
          p: (p - hitAt) / (1 - hitAt),
        };
      }
    } else if (p > hitAt) {
      const q = (p - hitAt) / (1 - hitAt),
        kk = ease(q);
      def.dx = vx * 0.08 * kk + Math.sin(t / 25) * 8 * kk;
      def.dy = vy * 0.08 * kk;
      def.squash = 1 - 0.22 * kk;
      def.rot = fwd * kk * 14;
      def.moves = {
        head: [-0.12 * kk, 0.05 * kk],
        handL: [-0.1 * kk, -0.12 * kk],
        handR: [-0.1 * kk, -0.12 * kk],
      };
      // 맞으면 깜빡깜빡
      def.opacity = q < 0.6 && Math.floor(t / 70) % 2 ? 0.2 : 1;
      v.hp = h.hp;
      v.pop = { side: d, text: `-${h.damage}`, crit: h.crit, p: q };
      if (h.crit) {
        // 경직이 풀린 뒤부터 크게 흔들리고, 카메라는 맞은 쪽으로 확 당겼다가 천천히 풀린다
        // 맞은 순간부터 경직이 끝날 때까지(held)는 확대·번쩍임을 꽉 채운 채로 붙잡아 둔다
        const held = raw <= FREEZE_AT + STOP,
          after = held ? 0 : (raw - FREEZE_AT - STOP) / (1 - FREEZE_AT - STOP),
          decay = Math.max(0, 1 - after * 1.6);
        if (!held) v.shake = [Math.sin(t / 16) * 30 * decay, Math.cos(t / 21) * 20 * decay];
        v.flash = Math.max(0, 0.35 - after * 2);
        if (stop) def.opacity = 1;
        v.cam = { x: SPOT[d].x + def.dx, y: d === 0 ? SPOT[d].y : SPOT[d].y - SPOT[d].size * 0.4, z: 1 + 0.45 * smooth(decay) };
        v.impact = { side: d, k: decay, stop };
        if (q > 0.15) v.say = "급소에 맞았다! 효과는 굉장했다!";
      }
    }
  } else {
    const p = (ht - fight.hits.length * HIT_MS) / OUTRO_MS,
      w = fight.winner,
      l = (1 - w) as 0 | 1;
    // 발끝을 축으로 옆으로 쓰러지면 그림 왼쪽 끝(x 최소)이 땅 아래로 내려간다 → 정확히 그만큼 들어 올린다
    const fall = Math.min(1, p * 3),
      minX = Math.min(...fs[l].creature.lines.flat().map((q) => q[0]));
    poses[l].rot = (l === 0 ? -1 : 1) * fall * 90;
    poses[l].dy = -Math.sin((fall * Math.PI) / 2) * SPOT[l].size * (0.5 - minX);
    poses[l].opacity = 1 - Math.max(0, p - 0.5) * 1.2;
    poses[l].moves = {
      footL: [0.05, 0],
      footR: [-0.05, 0],
      handL: [0, 0.1],
      handR: [0, 0.1],
    };
    poses[w].dy = -Math.abs(Math.sin(t / 160)) * 60;
    poses[w].moves = {
      ...gait(t, 0.3),
      handL: [-0.05, -0.25],
      handR: [0.05, -0.25],
    };
    v.say = p < 0.45 ? `${josa(fs[l].name, "은", "는")} 쓰러졌다!` : `${fs[w].name} 승리!${fight.ko ? "" : " (판정승)"}`;
  }
  return v;
}

/** 파동 고리 수와 한 고리가 퍼져 나가는 시간 */
const WAVES = 4,
  WAVE_MS = 1400;

/**
 * 등장씬 무대 조명: 배경을 어둡게 누르고 주인공 몸 가운데에서 제 색 고리가 잔잔히 퍼져 나간다.
 * 방사형 햇살(빨강·흰 쐐기)이나 꽉 찬 색 원판은 빨간 캐릭터에서 욱일기·일장기를 떠올리게 해서 쓰지 않는다.
 */
function Spotlight({ side, k, ring, t }: { side: 0 | 1; k: number; ring: number; t: number }) {
  const { x, y, size } = SPOT[side];
  return (
    <g className={side === 0 ? "bt-blue" : "bt-red"}>
      <rect x={-W} y={-H} width={W * 3} height={H * 3} className="bt-dim" opacity={0.55 * k} />
      {Array.from({ length: WAVES }, (_, i) => {
        // 고리마다 출발을 엇갈려 늘 몇 겹이 보이게: 안쪽에서 생겨 커지며 옅어진다
        const ph = (t / WAVE_MS + i / WAVES) % 1;
        return (
          <circle
            key={i}
            cx={x}
            cy={y - size * 0.5}
            r={size * (0.45 + ph * 1.1)}
            className="bt-wave"
            strokeWidth={14 * (1 - ph) + 3}
            opacity={0.75 * k * (1 - ph)}
          />
        );
      })}
      {ring > 0 && ring < 1 && <ellipse cx={x} cy={y} rx={size * (0.3 + ring)} ry={size * (0.06 + ring * 0.2)} className="bt-ring" opacity={1 - ring} />}
    </g>
  );
}

/** 집중선 모양이 바뀌는 간격. 초당 3번 아래로 둬서 깜빡임(광과민) 기준을 넘지 않게 한다 */
const SPEED_TICK_MS = 340;

/** 만화 집중선: 화면 가장자리에서 주인공(화면 좌표 cx, cy) 쪽으로 몰려드는 가는 쐐기. tick이 바뀔 때만 다시 그린다 */
const SpeedLines = memo(function SpeedLines({ cx, cy, r, tick, cls = "bt-speed" }: { cx: number; cy: number; r: number; tick: number; cls?: string }) {
  const pt = (a: number, d: number) => `${(cx + Math.cos(a) * d).toFixed(1)} ${(cy + Math.sin(a) * d).toFixed(1)}`;
  return (
    <g className={cls}>
      {Array.from({ length: 56 }, (_, i) => {
        const a = ((i + rnd(tick * 97 + i)) / 56) * Math.PI * 2,
          w = 0.006 + rnd(tick * 13 + i) * 0.012,
          // 가장자리에만 짧게: 주인공 둘레를 비워 두어 방사형 무늬로 읽히지 않게 한다
          d = r * (1.7 + rnd(tick * 31 + i * 7) * 0.5);
        return <path key={i} d={`M${pt(a - w, 1600)} L${pt(a, d)} L${pt(a + w, 1600)} Z`} />;
      })}
    </g>
  );
});

function Creature({ f, pose, side, glow = 0 }: { f: Fighter; pose: Pose; side: 0 | 1; glow?: number }) {
  const c = f.creature,
    { x, y, size } = SPOT[side];
  const pts = deform(c, pose.moves).map((l) => l.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(" "));
  const flip = side === 0 ? 1 : -1;
  const at = (k: PartName): Pt => [c.parts[k].at[0] + (pose.moves[k]?.[0] ?? 0), c.parts[k].at[1] + (pose.moves[k]?.[1] ?? 0)];
  const head = at("head");
  // 눈은 머리에서 몸 쪽으로 조금 들어온 곳, 눈동자는 상대(+x) 쪽을 본다
  const eye: Pt = [head[0] + (c.center[0] - head[0]) * 0.18, head[1] + (c.center[1] - head[1]) * 0.18];
  const air = Math.min(1, -Math.min(0, pose.dy) / 150);
  return (
    <g className={side === 0 ? "bt-blue" : "bt-red"} opacity={pose.opacity}>
      {/* 그림자: 뛰어오르면 작아진다 */}
      <ellipse cx={x + pose.dx} cy={y + Math.max(0, pose.dy)} rx={size * 0.3 * (1 - air * 0.5)} ry={size * 0.05 * (1 - air * 0.5)} className="bt-shadow" />
      <g
        transform={`translate(${x + pose.dx} ${y + pose.dy}) rotate(${pose.rot} 0 ${-size * (pose.pivot ?? 0)}) scale(${flip * size} ${size * pose.squash}) translate(-0.5 -0.95)`}
      >
        {/* 등장씬 주인공: 제 색 후광 + 흰 테두리를 선 밑에 깐다 */}
        {glow > 0 &&
          ["bt-halo", "bt-rim"].map((cls) =>
            pts.map((p, i) => <polyline key={cls + i} points={p} className={cls} opacity={glow} vectorEffect="non-scaling-stroke" />),
          )}
        {pts.map((p, i) => (
          <polyline key={i} points={p} className="bt-line" vectorEffect="non-scaling-stroke" />
        ))}
        {(Object.keys(c.parts) as PartName[]).map((k) => {
          if (!c.parts[k].stub) return null;
          // 튀어나온 곳이 없던 부위: 몸에서 막대를 뻗고 끝에 주먹·발을 단다
          const p = at(k),
            [ax, ay] = c.parts[k].at,
            len = Math.hypot(ax - c.center[0], ay - c.center[1]) || 1;
          const base: Pt = [ax - ((ax - c.center[0]) / len) * 0.16, ay - ((ay - c.center[1]) / len) * 0.16];
          return (
            <g key={k}>
              <line x1={base[0]} y1={base[1]} x2={p[0]} y2={p[1]} className="bt-line" vectorEffect="non-scaling-stroke" />
              {k !== "head" && <circle cx={p[0]} cy={p[1]} r={0.025} className="bt-fist" />}
            </g>
          );
        })}
        {[-0.045, 0.045].map((ex) => (
          <g key={ex}>
            <circle cx={eye[0] + ex} cy={eye[1]} r={0.035} className="bt-eye" vectorEffect="non-scaling-stroke" />
            <circle cx={eye[0] + ex + 0.013} cy={eye[1] + 0.005} r={0.016} className="bt-pupil" />
          </g>
        ))}
      </g>
    </g>
  );
}

/** 등장씬 이름 띠: 화면을 비스듬히 가로질러 미끄러져 들어온다 */
function Banner({ f, lv, side, q }: { f: Fighter; lv: number; side: 0 | 1; q: number }) {
  const k = smooth((q - 0.45) / 0.12),
    fade = smooth((1 - q) / 0.1);
  // 상대 띠는 아래, 내 띠는 위: 주인공 그림을 가리지 않게 반대편에 둔다
  const y = side === 1 ? 600 : 80,
    from = side === 1 ? -1 : 1;
  return (
    <g className={side === 0 ? "bt-blue" : "bt-red"} opacity={fade} transform={`translate(${(1 - k) * from * W} ${y}) rotate(-4 ${W / 2} 0)`}>
      <rect x={-60} y={-64} width={W + 120} height={128} className="bt-band" />
      <text x={W / 2} y={6} textAnchor="middle" className="bt-band-name">
        {clip(f.name, 16)}
      </text>
      <text x={W / 2} y={46} textAnchor="middle" className="bt-band-sub">
        Lv.{lv} · 체력 {f.hp} · 공격력 {f.power}
      </text>
    </g>
  );
}

/** 대결이 끝나면 뜨는 결과 창. '내 기록'(0번) 쪽에서 본 승패와 전적. 휴대폰에선 무대보다 커서 화면 전체 모달(<dialog>)로 띄운다 */
function ResultCard({
  fight,
  fs,
  km,
  record,
  onRematch,
  onClose,
}: {
  fight: Fight;
  fs: [Fighter, Fighter];
  /** 내 그림의 달린 거리 (m) */
  km: number;
  record: BattleRecord | undefined;
  onRematch: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [sharing, setSharing] = useState<"idle" | "busy" | "fail">("idle");
  // 모달로 열면 브라우저가 포커스 가두기·Esc 닫기·뒤 화면 어둡게를 해 준다
  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    d.showModal();
    // showModal은 첫 버튼(닫기)에 포커스를 주므로, 바로 다시 붙을 수 있게 '다시 대결'로 옮긴다
    d.querySelector<HTMLButtonElement>(".btn-primary")?.focus();
  }, []);
  const r = summarize(fight, 0, fs[0].hp),
    rows: [string, string][] = [
      ["준 피해", `${r.dealt}`],
      ["받은 피해", `${r.taken}`],
      ["치명타", `${r.crits}번`],
      ["피한 공격", `${r.dodges}번`],
      ["남은 체력", `${r.hpLeft} / ${fs[0].hp}`],
      ["이 그림 전적", recordText(record)],
    ];
  const share = async () => {
    setSharing("busy");
    try {
      const blob = await makeShareCard({
        fs,
        won: r.won,
        ko: fight.ko,
        finisher: finisherText(fight, fs),
        detail: [formatDistance(km), `준 피해 ${r.dealt}`, record ? recordText(record) : ""].filter(Boolean).join(" · "),
      });
      await shareCard(blob);
      setSharing("idle");
    } catch {
      setSharing("fail");
    }
  };
  return (
    <dialog ref={ref} className={`bt-result ${r.won ? "bt-win" : "bt-lose"}`} aria-labelledby="bt-result-title" onClose={onClose}>
      <p className="bt-result-kicker">{fight.ko ? "KO" : "판정"}</p>
      <h2 id="bt-result-title">{r.won ? "승리!" : "패배…"}</h2>
      <p className="bt-result-sub">
        {r.won ? `${josa(fs[0].name, "이", "가")} ${josa(fs[1].name, "을", "를")} 쓰러뜨렸어요` : `${fs[1].name}에게 졌어요. 다시 붙어 볼까요?`}
      </p>
      <dl>
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
      </dl>
      <div className="bt-result-actions">
        <button type="button" className="btn btn-secondary bt-result-share" onClick={share} disabled={sharing === "busy"}>
          {sharing === "busy" ? "카드 만드는 중…" : "결과 카드 공유"}
        </button>
        {sharing === "fail" && (
          <p className="bt-result-err" role="alert">
            카드를 만들지 못했어요. 다시 눌러 주세요.
          </p>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => ref.current?.close()}>
          닫기
        </button>
        <button type="button" className="btn btn-primary" onClick={onRematch}>
          다시 대결
        </button>
      </div>
    </dialog>
  );
}

function HpPanel({ name, lv, hp, max, side, snap }: { name: string; lv: number; hp: number; max: number; side: 0 | 1; snap: number }) {
  const r = hp / max;
  return (
    <div className={`bt-panel bt-panel-${side === 0 ? "me" : "foe"}`}>
      <div className="bt-panel-name">
        <span>{name}</span>
        <b>Lv.{lv}</b>
      </div>
      <div className="bt-hpline">
        <small>HP</small>
        <div className="bt-bar" role="meter" aria-label={`${name} 체력`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={hp}>
          {/* 뒤: 방금 깎인 만큼 잠깐 남았다가 천천히 따라 줄어드는 잔상 / 앞: 남은 체력 (바로 줄어든다) */}
          <i key={snap} style={{ width: `${r * 100}%` }} className="bt-trail" />
          <i style={{ width: `${r * 100}%` }} className={r > 0.5 ? "" : r > 0.2 ? "bt-mid" : "bt-low"} />
        </div>
      </div>
      {side === 0 && (
        <p className="bt-hpnum">
          {hp} / {max}
        </p>
      )}
    </div>
  );
}

function StatCard({ f, side, record }: { f: Fighter; side: 0 | 1; record: BattleRecord | undefined }) {
  return (
    <dl className={`bt-stats ${side === 0 ? "bt-blue" : "bt-red"}`}>
      <dt>전적</dt>
      <dd>{recordText(record)}</dd>
      <dt>체력</dt>
      <dd>{f.hp}</dd>
      <dt>공격력</dt>
      <dd>{f.power}</dd>
      <dt>평균 페이스</dt>
      <dd>
        {formatPace((1000 / f.speed) * 1000, 1000)}
        {!f.speedKnown && <small> (기본값)</small>}
      </dd>
    </dl>
  );
}

export function BattleApp() {
  const [arts, setArts] = useState<ArtworkView[] | null>(null);
  const [pick, setPick] = useState<[string, string]>(["", ""]);
  const [fight, setFight] = useState<Fight | null>(null);
  const [t, setT] = useState(0);
  // 배속: 경기 시계(등장·싸움·경직·잔상 체력바까지)를 통째로 빠르게 돌린다. 재대결이면 자동으로 2배
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  // 건너뛸 때마다 늘려 잔상 체력바를 새로 붙인다 (건너뛴 만큼 잔상이 혼자 늦게 따라오지 않게)
  const [snap, setSnap] = useState(0);
  const [resultClosed, setResultClosed] = useState(false);
  const [records, setRecords] = useState<BattleRecords>({});
  const t0 = useRef(0);
  const calm = useReducedMotion();

  useEffect(() => {
    void loadArtworks().then((list) => {
      setRecords(loadRecords());
      setArts(list);
      setPick([list[0]?.id ?? "", list[1 + Math.floor(Math.random() * (list.length - 1))]?.id ?? list[0]?.id ?? ""]);
    });
  }, []);

  const picked = useMemo(() => {
    const a = arts?.find((x) => x.id === pick[0]),
      b = arts?.find((x) => x.id === pick[1]);
    return a && b ? ([a, b] as const) : null;
  }, [arts, pick]);
  const fighters = useMemo(() => (picked ? ([toFighter(picked[0]), toFighter(picked[1])] as [Fighter, Fighter]) : null), [picked]);

  const intro = ENTER_MS * 2;
  const total = fight ? intro + fight.hits.length * HIT_MS + OUTRO_MS : 0;

  // 대결이 바뀔 때마다 시계를 0부터 다시 돌린다. 대기 중에는 꼼지락대도록 계속 돌고, 대결이 끝나면 멈춘다
  useEffect(() => {
    t0.current = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const el = (now - t0.current) * speedRef.current;
      setT(el);
      if (!total || el < total) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [fight, total]);

  const start = () => {
    if (!fighters) return;
    // 시계를 여기서 바로 0으로: 아니면 첫 화면이 대기 중 흘러간 시간으로 그려져 결과가 한 번 비친다
    t0.current = performance.now();
    setT(0);
    // fight가 남아 있으면 같은 두 그림으로 다시 붙는 것 (그림을 바꾸면 fight가 지워진다) → 2배로 켠다
    if (fight) {
      speedRef.current = 2;
      setSpeed(2);
    }
    setResultClosed(false);
    setFight(simulate(fighters[0], fighters[1], Math.floor(Math.random() * 2 ** 31)));
  };
  /** 경기 시각 to로 건너뛴다 */
  const skip = (to: number) => {
    t0.current = performance.now() - to / speedRef.current;
    // 시계와 잔상 체력바 교체를 같은 렌더에 넣어야 새 잔상이 건너뛴 뒤의 체력에서 시작한다
    setT(to);
    setSnap((n) => n + 1);
  };
  /** 배속을 바꿔도 지금 장면에서 그대로 이어지게 시계 기준점을 옮긴다 */
  const toggleSpeed = () => {
    const nowMs = performance.now(),
      at = (nowMs - t0.current) * speedRef.current,
      next = speedRef.current === 2 ? 1 : 2;
    t0.current = nowMs - at / next;
    speedRef.current = next;
    setSpeed(next);
  };
  const now = fight ? Math.min(t, total) : t;
  const view = fighters ? frame(fight, fighters, now, ENTER_MS) : null;
  if (view && calm) {
    view.shake = [0, 0];
    view.flash = 0;
    if (view.cam) view.cam.z = 1;
  }
  const done = !!fight && now >= total - OUTRO_MS;
  const inIntro = !!fight && now < intro;

  // 승패가 화면에 드러나는 순간(결과 장면 시작) 한 번만 두 작품 전적에 더한다. 미리 더하면 전적 칸이 결과를 먼저 알려 준다
  const recorded = useRef<Fight | null>(null);
  useEffect(() => {
    if (!fight || !done || !picked || recorded.current === fight) return;
    recorded.current = fight;
    const next = addResult(loadRecords(), picked[fight.winner].id, picked[1 - fight.winner].id);
    saveRecords(next);
    setRecords(next);
  }, [fight, done, picked]);

  return (
    <main className="battle-page">
      <header className="topbar">
        <Link href="/" className="brand">
          요런
        </Link>
        <nav className="actions">
          <Link href="/room" className="btn btn-link">
            작품방
          </Link>
        </nav>
      </header>
      <h1 className="bt-title">
        그림 대결 <small>시제품</small>
      </h1>

      {!arts ? (
        <p role="status">작품을 불러오는 중…</p>
      ) : (
        <>
          <div className="bt-pick">
            {([0, 1] as const).map((i) => (
              <label key={i} className={i === 0 ? "bt-blue" : "bt-red"}>
                {i === 0 ? "내 기록" : "상대 기록"}
                <select
                  value={pick[i]}
                  disabled={!!fight && !done}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFight(null);
                    setPick((p) => (i === 0 ? [v, p[1]] : [p[0], v]));
                  }}
                >
                  {arts.map((a) => (
                    // 같은 그림끼리는 누가 누군지 구분이 안 되니 상대 쪽에서 고른 그림은 막는다
                    <option key={a.id} value={a.id} disabled={a.id === pick[1 - i] && a.id !== pick[i]}>
                      {a.title} · {formatDistance(a.stats.distanceEstimateMeters)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {picked && fighters && view && (
            <>
              {/* 등장씬 중에 무대를 누르면 바로 싸움으로 (키보드는 아래 '등장 건너뛰기' 버튼) */}
              <div className="bt-stage" style={{ "--bt-spd": speed } as CSSProperties} onClick={inIntro ? () => skip(intro) : undefined}>
                <svg viewBox={`0 0 ${W} ${H}`} className="bt-arena" role="img" aria-label="두 그림이 싸우는 장면">
                  {/* 흔들림은 화면 전체(땅·집중선·이름 띠까지)에 건다. 흔들려도 빈 가장자리가 안 보이게 하늘·땅은 넉넉히 */}
                  <g transform={`translate(${view.shake[0]} ${view.shake[1]})`}>
                    <g
                      transform={view.cam ? `translate(${view.cam.x} ${view.cam.y}) scale(${view.cam.z}) translate(${-view.cam.x} ${-view.cam.y})` : undefined}
                    >
                      <rect x={-40} y={-40} width={W + 80} height={H + 80} className="bt-sky" />
                      <rect x={-40} y={H * 0.36} width={W + 80} height={H * 0.64 + 40} className="bt-field" />
                      <g>
                        {/* 받침대: 상대는 멀리(작게), 나는 가까이(크게) */}
                        <ellipse cx={SPOT[1].x} cy={SPOT[1].y + 6} rx={220} ry={46} className="bt-plat" />
                        <ellipse cx={SPOT[0].x} cy={SPOT[0].y + 8} rx={290} ry={60} className="bt-plat" />
                        {/* 멀리 있는 상대를 먼저 그려 내 그림이 앞에 오게 한다. 등장씬에선 주인공을 조명 위 맨 앞에 */}
                        {(view.focus?.side === 1 ? ([0, 1] as const) : ([1, 0] as const)).map((i, n) => (
                          <Fragment key={i}>
                            {n === 1 && view.focus && view.focus.k > 0 && (
                              <Spotlight side={view.focus.side} k={view.focus.k} ring={view.focus.ring} t={calm ? 0 : now} />
                            )}
                            <Creature
                              f={fighters[i]}
                              pose={view.poses[i]}
                              side={i}
                              glow={view.focus?.side === i ? view.focus.k : view.impact?.side === i && view.impact.stop ? 1 : 0}
                            />
                          </Fragment>
                        ))}
                        {view.pop && (
                          <text
                            x={SPOT[view.pop.side].x + view.poses[view.pop.side].dx}
                            y={SPOT[view.pop.side].y - SPOT[view.pop.side].size - view.pop.p * 60}
                            textAnchor="middle"
                            className={`bt-pop${view.pop.crit ? " bt-crit" : ""}`}
                            opacity={1 - view.pop.p * 0.6}
                          >
                            {view.pop.text}
                          </text>
                        )}
                      </g>
                    </g>
                    {view.focus && view.cam && view.focus.k > 0 && (
                      // 집중선은 화면 좌표: 확대된 주인공 몸 가운데를 카메라 식 그대로 옮겨 겨눈다. 정수로 맞춰 memo가 잘 듣게 한다
                      <g opacity={0.6 * view.focus.k}>
                        <SpeedLines
                          cx={Math.round(view.cam.x + (SPOT[view.focus.side].x - view.cam.x) * view.cam.z)}
                          cy={Math.round(
                            view.cam.y +
                              (SPOT[view.focus.side].y + view.poses[view.focus.side].dy - SPOT[view.focus.side].size * 0.5 - view.cam.y) * view.cam.z,
                          )}
                          r={Math.round(SPOT[view.focus.side].size * view.cam.z * 0.85)}
                          tick={calm ? 0 : Math.floor(now / SPEED_TICK_MS)}
                        />
                      </g>
                    )}
                    {view.impact && view.cam && view.impact.k > 0 && (
                      // 치명타 충격선: 맞은 쪽 몸 가운데로 몰리는 검은 선 (밝은 배경에서도 보이게)
                      <g opacity={0.7 * view.impact.k}>
                        <SpeedLines
                          cls="bt-impact"
                          cx={Math.round(view.cam.x + (SPOT[view.impact.side].x + view.poses[view.impact.side].dx - view.cam.x) * view.cam.z)}
                          cy={Math.round(
                            view.cam.y +
                              (SPOT[view.impact.side].y + view.poses[view.impact.side].dy - SPOT[view.impact.side].size * 0.5 - view.cam.y) * view.cam.z,
                          )}
                          r={Math.round(SPOT[view.impact.side].size * view.cam.z * 0.6)}
                          tick={calm ? 0 : Math.floor(now / SPEED_TICK_MS)}
                        />
                      </g>
                    )}
                    {view.banner && <Banner f={fighters[view.banner.side]} lv={level(picked[view.banner.side])} side={view.banner.side} q={view.banner.q} />}
                  </g>
                  {view.flash > 0 && <rect width={W} height={H} className="bt-flash" opacity={view.flash} />}
                </svg>
                {fight && now >= total && !resultClosed && (
                  <ResultCard
                    fight={fight}
                    fs={fighters}
                    km={picked[0].stats.distanceEstimateMeters}
                    record={records[picked[0].id]}
                    onRematch={start}
                    onClose={() => setResultClosed(true)}
                  />
                )}
                {/* 체력 띠는 등장씬이 다 끝나야 나온다 (내 이름 띠를 가리지 않게) */}
                {!inIntro && <HpPanel name={fighters[1].name} lv={level(picked[1])} hp={view.hp[1]} max={fighters[1].hp} side={1} snap={snap} />}
                {!inIntro && <HpPanel name={fighters[0].name} lv={level(picked[0])} hp={view.hp[0]} max={fighters[0].hp} side={0} snap={snap} />}
              </div>
              <div className="bt-msg" aria-live="polite">
                <p>{fight ? view.say : `${josa(fighters[1].name, "과", "와")} 대결할까요?`}</p>
                <button type="button" className="btn btn-secondary btn-sm bt-speed-btn" aria-pressed={speed === 2} onClick={toggleSpeed}>
                  ▶▶ 2배
                </button>
                {fight && !done ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => skip(inIntro ? intro : total - OUTRO_MS)}>
                    {inIntro ? "등장 건너뛰기" : "결과 바로 보기"}
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={start}>
                    {fight ? "다시 대결" : "대결 시작"}
                  </button>
                )}
              </div>
              <div className="bt-cards">
                <StatCard f={fighters[0]} side={0} record={records[picked[0].id]} />
                <StatCard f={fighters[1]} side={1} record={records[picked[1].id]} />
              </div>
              <p className="hint">
                많이 달린 그림일수록 체력이 높아 승패를 크게 가르고, 팔다리가 길면 조금 더 세게 쳐요. 먼저 치기·피하기·급소는 평균 속도로 정하고 운이 조금
                섞여요. 작품에는 아직 달린 시간이 저장되지 않아 페이스는 1km 6분으로 봐요.
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}
