// 선수 그림 묶음. 한 장의 캔버스에 달리기 프레임을 나란히 그리고, 3D에서는 프레임만 넘긴다.
// 눈과 팔다리는 1대1 대결과 같은 부위 판별(makeCreature)과 몸 비틀기(deform)로 만든다.
// 캔버스는 CSS 토큰을 읽지 못하므로 색을 이곳에 둔다.

import { gait } from "@/components/battle/scene";
import type { BodyPlan } from "@/lib/battle/bodyPlan";
import { deform, makeCreature, toRenderLine, type Creature, type PartName } from "@/lib/battle/creature";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";

export const FRAME_COUNT = 6;
export const FRAME_SIZE = 256;
/** 선 두께와 눈 크기를 정하는 그림 단위. 클로즈업에서 흐려지지 않도록 칸은 이보다 크게 만들어 확대해 그린다 */
const DRAW_SIZE = 160;
/** 팔다리가 흔들려도 옆 프레임을 넘지 않도록 그림을 칸 안쪽에 둔다 */
const INSET = 0.12, SCALE = 0.76;
/** 그림 발끝 아래에 남는 칸의 비율. 3D에서 이만큼 내려 땅에 닿게 한다 */
export const FOOT_GAP = 0.158;
const INK = "#0b1f36";
const WHITE = "#ffffff";
const GOLD = "#f6c042";

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];
type Line = readonly (readonly number[])[] | null;

/** 코스 그림이 없는 선수(봇, 코스를 받지 않는 다른 참가자, 기본 유형)가 쓰는 모양 */
const STAND_INS: Record<BodyPlan, ShapeId[]> = {
  biped: ["star", "rabbit", "bird", "duck"],
  quadruped: ["dog", "cat", "elephant", "giraffe"],
  roller: ["apple", "heart", "turtle", "fish"],
};
const GAIT_AMP: Record<BodyPlan, number> = { biped: 1.8, quadruped: 2.2, roller: 0.8 };

/** line은 지도 좌표(y가 아래). 1대1과 똑같이 y를 뒤집어 생명체로 만든다 */
export function runnerCreature(body: BodyPlan, lane: number, line: Line): Creature {
  const list = STAND_INS[body];
  const source = line?.length ? line.map(([x, y]) => [x, -y]) : SHAPE_BY_ID[list[(lane - 1) % list.length]].points;
  return makeCreature([toRenderLine(source)]);
}

/** 한 프레임의 몸 선과 부위 위치. 값은 칸 크기를 1로 본 좌표다 */
export function runnerPose(creature: Creature, body: BodyPlan, frame: number) {
  const moves = gait((frame / FRAME_COUNT) * Math.PI * 2 * 90, GAIT_AMP[body]);
  // 구르는 몸은 칸 가운데를 축으로 돌도록 그림 가운데를 맞춘다
  const ys = creature.lines.flat().map((p) => p[1]);
  const shiftY = body === "roller" ? 0.5 - (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  const place = ([x, y]: readonly number[]): Pt => [INSET + x * SCALE, INSET + (y + shiftY) * SCALE];
  const moved = (k: PartName): Pt => {
    const at = creature.parts[k].at, d = moves[k];
    return place([at[0] + (d?.[0] ?? 0), at[1] + (d?.[1] ?? 0)]);
  };
  const stubs = (Object.keys(creature.parts) as PartName[]).flatMap((k) => {
    const part = creature.parts[k];
    return part.stub && part.root ? [{ from: place(part.root), to: moved(k) }] : [];
  });
  const eye = place([creature.eye[0] + (moves.head?.[0] ?? 0), creature.eye[1] + (moves.head?.[1] ?? 0)]);
  // 중계 화면에서는 대결 무대보다 작게 보여 눈을 조금 키운다
  const eyeR = Math.max(0.03, Math.min(0.046, creature.eyeRadius * 1.4));
  return { lines: deform(creature, moves).map((l) => l.map(place)), stubs, eye, eyeR };
}

/** 땅에서 그림 꼭대기까지의 높이(칸 크기 대비). 번호표를 머리 바로 위에 두는 데 쓴다. 구르는 몸은 돌아도 닿지 않게 칸 높이로 본다 */
export function runnerHeight(creature: Creature, body: BodyPlan) {
  if (body === "roller") return 0.82;
  const top = Math.min(...creature.lines.flat().map((p) => p[1]));
  return 1 - FOOT_GAP - (INSET + top * SCALE);
}

/** 카메라가 표정을 잡을 눈 위치 (그림 크기 대비). 구르는 몸은 눈이 돌아가므로 몸 가운데를 본다 */
export function runnerEye(creature: Creature, body: BodyPlan) {
  if (body === "roller") return { along: 0, height: 0.5 - FOOT_GAP };
  return { along: INSET + creature.eye[0] * SCALE - 0.5, height: 1 - FOOT_GAP - (INSET + creature.eye[1] * SCALE) };
}

function drawPose(ctx: Ctx, pose: ReturnType<typeof runnerPose>, color: string) {
  const S = DRAW_SIZE;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const { from, to } of pose.stubs) {
    for (const [width, stroke] of [[11, INK], [5, color]] as const) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(from[0] * S, from[1] * S);
      ctx.lineTo(to[0] * S, to[1] * S);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(to[0] * S, to[1] * S, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  for (const line of pose.lines) {
    ctx.beginPath();
    line.forEach(([x, y], i) => (i ? ctx.lineTo(x * S, y * S) : ctx.moveTo(x * S, y * S)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // 1대1과 같은 두 눈: 눈동자는 달리는 쪽(+x)을 본다
  const r = pose.eyeR * SCALE * S, gap = r * 1.25;
  for (const dx of [-gap, gap]) {
    const x = pose.eye[0] * S + dx, y = pose.eye[1] * S;
    ctx.fillStyle = WHITE;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x + r * 0.37, y + r * 0.14, r * 0.46, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 머리 위에 띄우는 번호표. 앱의 네이비 판에 선수 색 숫자를 얹고, 내 번호표만 금색으로 채운다. 몸과 따로 있어 함께 돌지 않는다 */
export function drawNumberTag(lane: number, mine: boolean, color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const left = 22, right = 106, top = 18, bottom = 82, r = 16, mid = 64;
  ctx.fillStyle = mine ? GOLD : INK;
  ctx.strokeStyle = mine ? INK : color;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.arcTo(right, top, right, bottom, r);
  ctx.arcTo(right, bottom, left, bottom, r);
  ctx.lineTo(mid + 10, bottom);
  ctx.lineTo(mid, bottom + 16);
  ctx.lineTo(mid - 10, bottom);
  ctx.arcTo(left, bottom, left, top, r);
  ctx.arcTo(left, top, right, top, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const face = getComputedStyle(document.body).getPropertyValue("--font-num").trim() || "sans-serif";
  ctx.fillStyle = mine ? INK : color;
  ctx.font = `700 44px ${face}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(lane), mid, (top + bottom) / 2 + 2);
  return canvas;
}

/** 프레임을 가로로 이어 그린 캔버스를 돌려준다. 그림은 오른쪽을 본다 */
export function drawRunnerFrames(body: BodyPlan, color: string, line: Line, lane: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_SIZE * FRAME_COUNT;
  canvas.height = FRAME_SIZE;
  const ctx = canvas.getContext("2d")!;
  const creature = runnerCreature(body, lane, line);
  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    ctx.save();
    ctx.translate(frame * FRAME_SIZE, 0);
    ctx.beginPath();
    ctx.rect(0, 0, FRAME_SIZE, FRAME_SIZE);
    ctx.clip();
    ctx.scale(FRAME_SIZE / DRAW_SIZE, FRAME_SIZE / DRAW_SIZE);
    drawPose(ctx, runnerPose(creature, body, frame), color);
    ctx.restore();
  }
  return canvas;
}

/** 몸 유형별 움직임. 프레임 이미지 위에 더해지는 튀어 오름, 기울기, 찌그러짐이다 */
export function bodyMotion(body: BodyPlan, time: number, seed: number, distance: number) {
  const beat = time / 95 + seed;
  if (body === "roller") {
    // 달린 거리만큼 구른다. 재생 속도가 빨라 실제 회전보다 천천히 돌리고, 가끔 돌부리에 걸린 듯 통통 튄다
    return { rise: Math.abs(Math.sin(beat * 0.6)) * 0.45, tilt: -distance * 0.22, squashX: 1, squashY: 1 };
  }
  if (body === "quadruped") {
    // 말이 뛰듯 앞뒤로 기우뚱하며 크게 도약한다
    const gallop = Math.sin(beat * 0.9);
    return { rise: Math.max(0, gallop) * 1.1, tilt: gallop * 0.2, squashX: 1 + Math.max(0, -gallop) * 0.1, squashY: 1 - Math.max(0, -gallop) * 0.1 };
  }
  // 두 발: 짧은 보폭으로 온몸을 좌우로 흔들며 열심히 뛴다
  const step = Math.sin(beat * 1.6);
  return { rise: Math.abs(step) * 0.55, tilt: step * 0.16, squashX: 1 - Math.abs(step) * 0.05, squashY: 1 + Math.abs(step) * 0.05 };
}
