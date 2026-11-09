// 대결 장면 계산 (순수 함수): 시각을 넣으면 자세·카메라·흔들림·대사를 돌려준다.
// 구도는 포켓몬 배틀처럼: 내 그림은 앞(왼쪽 아래, 크게), 상대는 뒤(오른쪽 위 받침대, 작게).

import { josa, type Creature, type PartName } from "@/lib/battle/creature";
import { CHOICE_LABELS, type TurnLog } from "@/lib/battle/turnBattle";
import type { TurnFx } from "@/lib/battle/turnFx";

type Pt = [number, number];
export const W = 1000, H = 740;
/** 발 위치와 크기: 0 = 나(앞), 1 = 상대(뒤) */
export const SPOT = [
  { x: 270, y: 690, size: 330 },
  { x: 735, y: 330, size: 230 },
] as const;
export const ENTER_MS = 2400, REVEAL_MS = 700, HIT_MS = 1400, OUTRO_MS = 2200;

export interface SceneFighter { name: string; creature: Creature; maxHp: number; attack: number }

/** 등장 방식: 이름으로 정해서 같은 그림은 늘 같은 방식으로 나온다 */
const ENTRANCES = [
  { kind: "run", verb: "전력으로 달려왔다!" },
  { kind: "drop", verb: "하늘에서 쿵 떨어졌다!" },
  { kind: "spin", verb: "빙글빙글 날아왔다!" },
  { kind: "pop", verb: "땅에서 불쑥 솟아올랐다!" },
] as const;
export const entranceOf = (name: string) => ENTRANCES[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % ENTRANCES.length];

/** 무엇을 내서 이겼는지에 따라 치는 부위가 다르다 */
const MOVES = {
  rock: { part: "handR", name: "펀치" },
  scissors: { part: "footR", name: "발차기" },
  paper: { part: "handR", name: "손바닥 치기" },
  allin: { part: "head", name: "이판사판 박치기" },
} as const;

const ease = (p: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
const smooth = (p: number) => {
  const x = Math.min(1, Math.max(0, p));
  return x * x * (3 - 2 * x);
};
/** 치명타 경직: 맞은 자세가 보이는 순간(FREEZE_AT)에서 한 동작의 STOP 비율만큼 화면을 멈춘다 */
const FREEZE_AT = 0.47, STOP = 0.16;

export interface Pose {
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
export function gait(t: number, amp: number): Partial<Record<PartName, Pt>> {
  const s = Math.sin(t / 90), c = Math.cos(t / 90);
  return {
    footL: [s * 0.07 * amp, -Math.max(0, s) * 0.06 * amp],
    footR: [-s * 0.07 * amp, -Math.max(0, -s) * 0.06 * amp],
    handL: [-s * 0.05 * amp, c * 0.03 * amp],
    handR: [s * 0.05 * amp, -c * 0.03 * amp],
    head: [0, Math.abs(c) * -0.02 * amp],
  };
}

export interface View {
  poses: [Pose, Pose];
  hp: [number, number];
  pop: { side: 0 | 1; text: string; crit: boolean; p: number } | null;
  /** 양쪽이 낸 것을 머리 위에 보여 준다 */
  picks: [string, string] | null;
  say: string;
  shake: Pt;
  flash: number;
  /** 카메라: (x, y)를 중심으로 z배 확대 */
  cam: { x: number; y: number; z: number } | null;
  banner: { side: 0 | 1; q: number } | null;
  /** 등장 강조: k는 세기(0~1), ring은 착지 충격파 진행도 */
  focus: { side: 0 | 1; k: number; ring: number } | null;
  /** 치명타 충격: 맞은 쪽, 세기, 경직 중인지 */
  impact: { side: 0 | 1; k: number; stop: boolean } | null;
}

function blank(t: number, hp: [number, number]): View {
  const poses = [0, 1].map((i) => ({ dx: 0, dy: 0, rot: 0, squash: 1, opacity: 1, moves: gait(t * 0.6 + i * 140, 0.25) })) as [Pose, Pose];
  return { poses, hp, pop: null, picks: null, say: "", shake: [0, 0], flash: 0, cam: null, banner: null, focus: null, impact: null };
}

/** side의 등장 진행도 q(0~1)에 맞춰 자세·카메라·띠를 정한다 */
function enter(v: View, side: 0 | 1, name: string, q: number, t: number) {
  const pose = v.poses[side], out = side === 0 ? -1 : 1, kind = entranceOf(name).kind;
  const a = Math.min(1, q / 0.4), r = 1 - a;
  if (a < 1) {
    if (kind === "run") {
      pose.dx = out * r * r * 700;
      pose.dy = -Math.abs(Math.sin(t / 90)) * 16;
      pose.moves = gait(t, 1.3);
    } else if (kind === "drop") {
      pose.dy = -r * r * 900;
      pose.moves = { handL: [-0.06, -0.22], handR: [0.06, -0.22], footL: [0, 0.04], footR: [0, 0.04] };
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
      pose.moves = { ...gait(t, 0.4), handL: [-0.06, -0.25], handR: [0.06, -0.25] };
    }
  }
  // 1.5배로 바짝 당기고, 착지하는 순간엔 한 번 더 '쿵' 들어갔다 돌아온다
  const z = 1 + (0.5 * smooth((q - 0.3) / 0.12) + 0.1 * ease((q - 0.4) / 0.12)) * smooth((1 - q) / 0.15);
  // 나는 화면 아래 끝에 서 있어 발을, 상대는 몸 위쪽을 중심으로 당겨 잘리지 않게 한다
  const follow = Math.max(-60, Math.min(0, pose.dy));
  v.cam = { x: SPOT[side].x, y: (side === 0 ? SPOT[side].y : SPOT[side].y - SPOT[side].size * 0.6) + follow, z };
  if (q > 0.45) v.banner = { side, q };
  v.focus = { side, k: smooth((q - 0.38) / 0.06) * smooth((1 - q) / 0.15), ring: (q - 0.4) / 0.2 };
  if (q >= 0.4 && q < 0.46) v.flash = 0.55 * (1 - (q - 0.4) / 0.06);
}

/** 상대가 먼저, 그다음 내가 등장한다. t는 등장 시작 뒤 지난 시간 */
export function introView(fs: [SceneFighter, SceneFighter], t: number): View {
  const v = blank(t, [fs[0].maxHp, fs[1].maxHp]);
  const side = t < ENTER_MS ? 1 : 0, q = (t - (side === 1 ? 0 : ENTER_MS)) / ENTER_MS, name = fs[side].name;
  if (side === 1) v.poses[0].opacity = 0;
  enter(v, side, name, Math.min(1, q), t);
  v.say = q >= 0.4 ? `${josa(name, "이", "가")} ${entranceOf(name).verb}` : side === 1 ? `앗! 상대 ${josa(name, "이", "가")} 나타났다!` : `가랏! ${name}!`;
  return v;
}

export function idleView(fs: [SceneFighter, SceneFighter], t: number, hp: [number, number]): View {
  const v = blank(t, hp);
  v.say = "무엇을 낼까?";
  return v;
}

/** 한 턴: 낸 것 공개 → 공격 → 타격. t는 턴 시작 뒤 지난 시간 */
export function turnView(fs: [SceneFighter, SceneFighter], time: number, log: TurnLog, fx: TurnFx, before: [number, number], after: [number, number]): View {
  let t = time;
  const v = blank(t, before);
  if (t < REVEAL_MS) {
    v.picks = [CHOICE_LABELS[log.choices[0]], CHOICE_LABELS[log.choices[1]]];
    v.say = `나 ${CHOICE_LABELS[log.choices[0]]}, ${fs[1].name} ${CHOICE_LABELS[log.choices[1]]}!`;
    return v;
  }
  const raw = Math.min(1, (t - REVEAL_MS) / HIT_MS);
  if (fx.attacker === null || fx.victim === null) {
    // 비기면 서로 달려들어 부딪치고 돌아온다
    const k = ease(raw);
    for (const side of [0, 1] as const) {
      const other = side === 0 ? 1 : 0;
      v.poses[side].dx = (SPOT[other].x - SPOT[side].x) * 0.16 * k;
      v.poses[side].dy = (SPOT[other].y - SPOT[side].y) * 0.16 * k - Math.sin(Math.PI * k) * 30;
      v.poses[side].moves = { ...gait(t, 0.5), handR: [k * 0.2, -k * 0.05] };
    }
    if (raw > 0.42 && raw < 0.58) v.shake = [Math.sin(t / 16) * 8, Math.cos(t / 21) * 5];
    v.say = log.critical[0] && log.critical[1] ? "둘 다 이판사판 성공! 서로 피해가 없다!" : log.missed[0] && log.missed[1] ? "둘 다 이판사판 실패!" : "비겼다! 서로 물러섰다!";
    return v;
  }
  const a = fx.attacker, d = fx.victim, crit = fx.critical;
  // 치명타면 FREEZE_AT에서 STOP만큼 시간을 멈추고(경직), 남은 동작은 그만큼 빠르게 마저 한다
  const stop = crit && raw > FREEZE_AT && raw <= FREEZE_AT + STOP;
  const p = !crit || raw <= FREEZE_AT ? raw : stop ? FREEZE_AT : FREEZE_AT + ((raw - FREEZE_AT - STOP) * (1 - FREEZE_AT)) / (1 - FREEZE_AT - STOP);
  if (stop) t -= (raw - FREEZE_AT) * HIT_MS;
  const atk = v.poses[a], def = v.poses[d];
  const move = MOVES[log.choices[a]];
  const fwd = a === 0 ? 1 : -1;
  const vx = SPOT[d].x - SPOT[a].x, vy = SPOT[d].y - SPOT[a].y;
  const wind = p < 0.15 ? ease(p / 0.3) : 0, k = ease((p - 0.15) / 0.5);
  atk.dx = vx * 0.42 * k - fwd * 30 * wind;
  atk.dy = vy * 0.42 * k - Math.sin(Math.PI * k) * 40;
  atk.rot = fwd * (k * 10 - wind * 8);
  const reach = crit ? 0.6 : 0.42;
  atk.moves = move.part === "head"
    ? { ...gait(t, 0.4), head: [k * reach * 0.7, k * 0.06] }
    : move.part === "footR"
      ? { ...gait(t, 0.4), footR: [k * reach, -k * 0.3] }
      : { ...gait(t, 0.4), handR: [k * reach, -k * 0.06] };
  if (move.part === "head") atk.rot += fwd * k * 14;
  // 이판사판에 실패한 쪽은 달려들다 헛손질한 셈이라 대사로 알려 준다
  v.say = log.missed[d] ? `${fs[d].name}의 이판사판 실패! ${fs[a].name}의 ${move.name}!` : `${fs[a].name}의 ${move.name}!`;

  const hitAt = 0.4;
  if (p > hitAt) {
    const q = (p - hitAt) / (1 - hitAt), kk = ease(q);
    def.dx = vx * 0.08 * kk + Math.sin(t / 25) * 8 * kk;
    def.dy = vy * 0.08 * kk;
    def.squash = 1 - 0.22 * kk;
    def.rot = fwd * kk * 14;
    def.moves = { head: [-0.12 * kk, 0.05 * kk], handL: [-0.1 * kk, -0.12 * kk], handR: [-0.1 * kk, -0.12 * kk] };
    // 맞으면 깜빡깜빡
    def.opacity = q < 0.6 && Math.floor(t / 70) % 2 ? 0.2 : 1;
    v.hp = after;
    v.pop = { side: d, text: `-${fx.damage}`, crit, p: q };
    if (crit) {
      // 경직이 풀린 뒤부터 크게 흔들리고, 카메라는 맞은 쪽으로 확 당겼다가 천천히 풀린다
      const held = raw <= FREEZE_AT + STOP;
      const later = held ? 0 : (raw - FREEZE_AT - STOP) / (1 - FREEZE_AT - STOP);
      const decay = Math.max(0, 1 - later * 1.6);
      if (!held) v.shake = [Math.sin(t / 16) * 30 * decay, Math.cos(t / 21) * 20 * decay];
      v.flash = Math.max(0, 0.35 - later * 2);
      if (stop) def.opacity = 1;
      v.cam = { x: SPOT[d].x + def.dx, y: d === 0 ? SPOT[d].y : SPOT[d].y - SPOT[d].size * 0.4, z: 1 + 0.45 * smooth(decay) };
      v.impact = { side: d, k: decay, stop };
      if (q > 0.15) v.say = "급소에 맞았다! 효과는 굉장했다!";
    } else if (q < 0.4) {
      // 일반 공격도 맞는 순간 짧게 흔들린다
      v.shake = [Math.sin(t / 16) * 10 * (1 - q / 0.4), Math.cos(t / 21) * 6 * (1 - q / 0.4)];
    }
  }
  return v;
}

/** 승부가 난 뒤: 진 쪽은 쓰러지고 이긴 쪽은 만세한다. t는 시작 뒤 지난 시간 */
export function outroView(fs: [SceneFighter, SceneFighter], t: number, winner: 0 | 1 | "draw", hp: [number, number]): View {
  const v = blank(t, hp);
  if (winner === "draw") {
    v.say = "무승부!";
    return v;
  }
  const w = winner, l = (1 - w) as 0 | 1;
  const p = t / OUTRO_MS, fall = Math.min(1, p * 3);
  const minX = Math.min(...fs[l].creature.lines.flat().map((q) => q[0]));
  // 발끝을 축으로 옆으로 쓰러지면 그림 끝이 땅 아래로 내려간다 → 그만큼 들어 올린다
  v.poses[l].rot = (l === 0 ? -1 : 1) * fall * 90;
  v.poses[l].dy = -Math.sin((fall * Math.PI) / 2) * SPOT[l].size * (0.5 - minX);
  v.poses[l].opacity = 1 - Math.max(0, p - 0.5) * 1.2;
  v.poses[l].moves = { footL: [0.05, 0], footR: [-0.05, 0], handL: [0, 0.1], handR: [0, 0.1] };
  v.poses[w].dy = -Math.abs(Math.sin(t / 160)) * 60;
  v.poses[w].moves = { ...gait(t, 0.3), handL: [-0.05, -0.25], handR: [0.05, -0.25] };
  v.say = p < 0.45 ? `${josa(fs[l].name, "은", "는")} 쓰러졌다!` : `${fs[w].name} 승리!`;
  return v;
}
