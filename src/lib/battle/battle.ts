// 달린 그림 대결 (순수 함수, 브라우저 API 없음 → 단위 시험 가능)
// - 그림을 생명체로 보고 머리·손·발 위치를 찾는다 (무게중심에서 방향별로 가장 멀리 튀어나온 점)
// - 능력치: 거리 → 체력, 평균 속도 → 선공·회피·치명타, 팔다리 길이 → 공격력
// - 같은 씨앗이면 같은 싸움이 나온다 (나중에 서버가 씨앗·승패를 정하고 두 화면이 같은 장면을 재생)

import type { Pt } from "@/lib/contracts/types";

export type PartName = "head" | "handL" | "handR" | "footL" | "footR";
export interface Part {
  at: Pt;
  /** 그림에 튀어나온 곳이 없어 막대 팔다리를 붙인 경우 */
  stub: boolean;
}
export interface Creature {
  /** 고르게 다시 찍은 그림 선 (화면 y는 아래로 증가하는 0~1 좌표) */
  lines: Pt[][];
  center: Pt;
  parts: Record<PartName, Part>;
  /** 머리·손·발이 중심에서 떨어진 평균 거리 */
  reach: number;
}

const STEP = 0.01;

/** 선을 STEP 간격으로 다시 찍는다 (점이 고르게 있어야 무게중심과 몸 비틀기가 자연스럽다) */
function resample(line: Pt[]): Pt[] {
  const out: Pt[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1],
      [bx, by] = line[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

// 화면 좌표 각도(도, y 아래) 구간: 머리는 위, 손은 옆, 발은 아래
const SECTORS: Record<PartName, { from: number; to: number; dir: number }> = {
  head: { from: -135, to: -45, dir: -90 },
  handR: { from: -45, to: 30, dir: -10 },
  footR: { from: 30, to: 90, dir: 65 },
  footL: { from: 90, to: 150, dir: 115 },
  handL: { from: 150, to: 225, dir: 190 },
};

export function makeCreature(renderLines: Pt[][]): Creature {
  const lines = renderLines.filter((l) => l.length > 0).map(resample);
  const pts = lines.flat();
  const center: Pt = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  const dists = pts.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1]));
  const radius = [...dists].sort((a, b) => a - b)[Math.floor(dists.length / 2)] || 0.2;

  const parts = {} as Record<PartName, Part>;
  for (const [name, s] of Object.entries(SECTORS) as [PartName, (typeof SECTORS)[PartName]][]) {
    // 발: 옆으로 긴 몸(강아지)은 다리 끝이 중심에서 그리 멀지 않다 → 좌우 절반에서 가장 아래 점을 발로 본다
    if (name === "footL" || name === "footR") {
      const side = pts.filter((p) => (name === "footL" ? p[0] < center[0] : p[0] >= center[0]));
      // 아래쪽이면서 바깥쪽 (평평한 밑면이면 두 발이 가운데로 몰리지 않게 모서리를 고른다)
      const score = (p: Pt) => p[1] + 0.3 * Math.abs(p[0] - center[0]);
      const low = side.reduce<Pt | null>((b, p) => (!b || score(p) > score(b) ? p : b), null);
      if (low && low[1] - center[1] > radius * 0.6) {
        parts[name] = { at: low, stub: false };
        continue;
      }
    }
    let best = -1,
      bestD = 0;
    pts.forEach((p, i) => {
      let a = (Math.atan2(p[1] - center[1], p[0] - center[0]) * 180) / Math.PI;
      if (a < s.from) a += 360;
      if (a >= s.from && a < s.to && dists[i] > bestD) {
        best = i;
        bestD = dists[i];
      }
    });
    // 중심 근처밖에 없으면 튀어나온 곳이 아니다 → 몸 바깥에 막대 팔다리를 붙인다 (오히려 더 우스꽝스럽다)
    if (best >= 0 && bestD > radius * 1.3) parts[name] = { at: pts[best], stub: false };
    else {
      const r = (s.dir * Math.PI) / 180,
        len = Math.max(bestD, radius) + 0.12;
      parts[name] = { at: [center[0] + Math.cos(r) * len, center[1] + Math.sin(r) * len], stub: true };
    }
  }
  const reach = Object.values(parts).reduce((s, p) => s + Math.hypot(p.at[0] - center[0], p.at[1] - center[1]), 0) / 5;
  return { lines, center, parts, reach };
}

/**
 * 몸 비틀기: 각 점을 가까운 신체 부위의 움직임만큼 끌고 간다 (가우스 가중치).
 * moves[부위] = 그 부위를 옮길 양. 부위에서 멀어질수록 덜 따라간다.
 */
export function deform(c: Creature, moves: Partial<Record<PartName, Pt>>, sigma = 0.16): Pt[][] {
  const ms = (Object.entries(moves) as [PartName, Pt][]).map(([k, d]) => ({ a: c.parts[k].at, d }));
  const k = 1 / (2 * sigma * sigma);
  const move = ([x, y]: Pt): Pt => {
    let dx = 0,
      dy = 0;
    for (const { a, d } of ms) {
      const w = Math.exp(-((x - a[0]) ** 2 + (y - a[1]) ** 2) * k);
      dx += w * d[0];
      dy += w * d[1];
    }
    return [x + dx, y + dy];
  };
  return c.lines.map((l) => l.map(move));
}

// ───────────────────────── 능력치 ─────────────────────────

/** 시간이 없는 기록(작품에는 아직 달린 시간이 없다)은 1km 6분으로 본다 */
export const DEFAULT_SPEED_MS = 1000 / 360;

export interface FighterInput {
  name: string;
  renderLines: Pt[][];
  distanceMeters: number;
  /** 달린 시간 (모르면 null) */
  durationMs?: number | null;
}
export interface Fighter {
  name: string;
  creature: Creature;
  hp: number;
  power: number;
  /** 평균 속도 m/s */
  speed: number;
  /** 0~1: 빠를수록 높다 (선공·회피·치명타) */
  agility: number;
  speedKnown: boolean;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 체력이 더 늘지 않는 거리 (하프 마라톤) */
export const MAX_KM = 21;

export function makeFighter(f: FighterInput): Fighter {
  const creature = makeCreature(f.renderLines);
  const speedKnown = !!f.durationMs && f.durationMs > 0 && f.distanceMeters > 0;
  const speed = speedKnown ? f.distanceMeters / (f.durationMs! / 1000) : DEFAULT_SPEED_MS;
  return {
    name: f.name,
    creature,
    // 승패는 달린 거리가 가장 크게 가른다: 0km 60 ~ 하프(21km) 이상 312. 1km 72, 5km 120, 10km 180
    hp: Math.round(60 + 12 * Math.min(MAX_KM, f.distanceMeters / 1000)),
    // 팔다리가 길수록 조금 세게: 16 ~ 20 (±10%). 같은 거리에서 모양 차이는 약 2km 더 달린 만큼의 효과
    // (그림은 0.9 상자에 맞춰져 있어 실제 작품의 reach는 대개 0.4~0.55)
    power: Math.round(18 * (0.9 + 0.2 * clamp01((creature.reach - 0.35) / 0.2))),
    speed,
    // 1km 8분20초(2m/s) 0 ~ 1km 3분20초(5m/s) 1
    agility: clamp01((speed - 2) / 3),
    speedKnown,
  };
}

// ───────────────────────── 싸움 ─────────────────────────

export interface Hit {
  /** 공격한 쪽 (0: 왼쪽, 1: 오른쪽) */
  by: 0 | 1;
  dodged: boolean;
  crit: boolean;
  damage: number;
  /** 맞은 뒤 두 쪽 체력 */
  hp: [number, number];
}
export interface Fight {
  seed: number;
  hits: Hit[];
  winner: 0 | 1;
  /** 체력이 바닥나 끝났는지 (아니면 남은 체력 비율로 판정) */
  ko: boolean;
}

/** 씨앗으로 같은 난수열을 만든다 (mulberry32) */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAX_HITS = 40;

export function simulate(a: Fighter, b: Fighter, seed: number): Fight {
  const r = rng(seed);
  const fs = [a, b] as const;
  const hp: [number, number] = [a.hp, b.hp];
  const hits: Hit[] = [];
  // 피해를 두 쪽 평균 체력에 맞춰 키운다: 체력이 크게 늘어도 한 판은 늘 10번 안팎으로 끝나고, 체력 비율이 승패를 가른다
  const scale = (a.hp + b.hp) / 200;
  // 빠른 쪽이 먼저 친다. 같으면 씨앗으로 정한다.
  let turn: 0 | 1 = a.speed === b.speed ? (r() < 0.5 ? 0 : 1) : a.speed > b.speed ? 0 : 1;
  while (hits.length < MAX_HITS && hp[0] > 0 && hp[1] > 0) {
    const atk = fs[turn],
      def = fs[1 - turn];
    const dodged = r() < 0.05 + 0.2 * def.agility;
    const crit = !dodged && r() < 0.1 + 0.15 * atk.agility;
    const damage = dodged ? 0 : Math.round(atk.power * scale * (0.75 + 0.5 * r()) * (crit ? 1.8 : 1));
    hp[1 - turn] = Math.max(0, hp[1 - turn] - damage);
    hits.push({ by: turn, dodged, crit, damage, hp: [hp[0], hp[1]] });
    turn = turn === 0 ? 1 : 0;
  }
  const ko = hp[0] === 0 || hp[1] === 0;
  const winner: 0 | 1 = ko ? (hp[0] === 0 ? 1 : 0) : hp[0] / a.hp >= hp[1] / b.hp ? 0 : 1;
  return { seed, hits, winner, ko };
}

/** 받침에 맞춰 조사를 붙인다. 끝 글자가 한글이 아니면 "이(가)"처럼 둘 다 적는다 */
export function josa(word: string, withFinal: string, without: string) {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return word + (c >= 0 && c < 11172 ? (c % 28 ? withFinal : without) : `${withFinal}(${without})`);
}

/** side 쪽에서 본 한 판 기록: 결과 창에 띄운다 */
export function summarize(fight: Fight, side: 0 | 1, startHp: number) {
  const mine = fight.hits.filter((h) => h.by === side),
    theirs = fight.hits.filter((h) => h.by !== side);
  return {
    won: fight.winner === side,
    dealt: mine.reduce((s, h) => s + (h.dodged ? 0 : h.damage), 0),
    taken: theirs.reduce((s, h) => s + (h.dodged ? 0 : h.damage), 0),
    crits: mine.filter((h) => h.crit && !h.dodged).length,
    dodges: theirs.filter((h) => h.dodged).length,
    hpLeft: fight.hits.at(-1)?.hp[side] ?? startHp,
  };
}

/** 작품 하나의 대결 전적 */
export interface BattleRecord {
  w: number;
  l: number;
  /** 지금 이어지는 연승 (지면 0) */
  streak: number;
  best: number;
}
export type BattleRecords = Record<string, BattleRecord>;

/** 한 판 결과를 더한 새 전적 */
export function addResult(recs: BattleRecords, winner: string, loser: string): BattleRecords {
  const w = recs[winner] ?? { w: 0, l: 0, streak: 0, best: 0 },
    l = recs[loser] ?? { w: 0, l: 0, streak: 0, best: 0 };
  return {
    ...recs,
    [winner]: { w: w.w + 1, l: w.l, streak: w.streak + 1, best: Math.max(w.best, w.streak + 1) },
    [loser]: { ...l, l: l.l + 1, streak: 0 },
  };
}
