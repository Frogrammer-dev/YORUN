// 선수 그림 묶음. 한 장의 캔버스에 달리기 프레임을 나란히 그리고, 3D에서는 프레임만 넘긴다.
// 캔버스는 CSS 토큰을 읽지 못하므로 색을 이곳에 둔다.

import type { BodyPlan } from "@/lib/battle/bodyPlan";

export const FRAME_COUNT = 6;
export const FRAME_SIZE = 128;
const INK = "#0b1f36";
const WHITE = "#ffffff";
const SWEAT = "#9fd6ff";

type Ctx = CanvasRenderingContext2D;

function eyes(ctx: Ctx, x: number, y: number, frame: number) {
  // 힘든 표정: 위로 치켜뜬 왕눈이와 내려온 눈썹
  for (const dx of [-8, 8]) {
    ctx.fillStyle = WHITE;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x + dx, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x + dx + 2 + Math.sin(frame) * 1, y - 1, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + dx - 7, y - 9 - (dx > 0 ? 0 : 2));
    ctx.lineTo(x + dx + 6, y - 9 + (dx > 0 ? -2 : 0));
    ctx.stroke();
  }
  // 앙다문 입
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - 5, y + 13);
  ctx.quadraticCurveTo(x + 2, y + 9 + (frame % 2) * 3, x + 8, y + 13);
  ctx.stroke();
}

function sweat(ctx: Ctx, x: number, y: number, frame: number) {
  ctx.fillStyle = SWEAT;
  const drift = frame * 3;
  ctx.beginPath();
  ctx.arc(x - 18 - drift, y - 8 + drift / 2, 3.4, 0, Math.PI * 2);
  ctx.fill();
  if (frame % 2) {
    ctx.beginPath();
    ctx.arc(x - 25 - drift, y + 4, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function leg(ctx: Ctx, x: number, y: number, swing: number, length: number, color: string) {
  const footX = x + Math.sin(swing) * length * 0.7;
  const footY = y + length - Math.max(0, Math.cos(swing)) * length * 0.35;
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(footX, footY);
  ctx.stroke();
  // 우스꽝스럽게 큰 신발
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(footX + 4, footY + 2, 9, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 내 코스 그림을 주어진 상자에 맞춰 칠한다 */
function silhouette(ctx: Ctx, line: readonly (readonly number[])[], box: [number, number, number, number], color: string) {
  const xs = line.map((p) => p[0]), ys = line.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const k = Math.min(box[2] / (Math.max(...xs) - minX || 1), box[3] / (Math.max(...ys) - minY || 1));
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  line.forEach(([x, y], i) => {
    const px = box[0] + (x - minX) * k, py = box[1] + (y - minY) * k;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawBiped(ctx: Ctx, frame: number, color: string, line: Line) {
  const swing = (frame / FRAME_COUNT) * Math.PI * 2;
  leg(ctx, 54, 84, swing, 26, color);
  leg(ctx, 74, 84, swing + Math.PI, 26, color);
  if (line) silhouette(ctx, line, [30, 18, 68, 72], color);
  else {
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(64, 54, 28, 36, 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  eyes(ctx, 68, 42, frame);
  sweat(ctx, 40, 32, frame);
}

function drawQuadruped(ctx: Ctx, frame: number, color: string, line: Line) {
  // 앞다리 둘과 뒷다리 둘이 번갈아 뻗는 전력 질주
  const swing = (frame / FRAME_COUNT) * Math.PI * 2;
  leg(ctx, 34, 76, swing + 0.5, 22, color);
  leg(ctx, 44, 76, swing + 1.1, 22, color);
  leg(ctx, 84, 76, swing + Math.PI, 22, color);
  leg(ctx, 94, 76, swing + Math.PI + 0.6, 22, color);
  if (line) silhouette(ctx, line, [18, 26, 92, 54], color);
  else {
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(58, 62, 38, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(96, 46, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 뒤로 휘날리는 꼬리
    ctx.lineWidth = 7;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(22, 56);
    ctx.quadraticCurveTo(8, 42 + (frame % 3) * 5, 6, 30);
    ctx.stroke();
  }
  eyes(ctx, 98, 42, frame);
  sweat(ctx, 66, 28, frame);
}

function drawRoller(ctx: Ctx, frame: number, color: string, line: Line) {
  if (line) silhouette(ctx, line, [22, 22, 84, 84], color);
  else {
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(64, 64, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  eyes(ctx, 64, 58, frame);
}

type Line = readonly (readonly number[])[] | null;

/** 프레임을 가로로 이어 그린 캔버스를 돌려준다. 그림은 오른쪽을 본다 */
export function drawRunnerFrames(body: BodyPlan, color: string, lane: number, mine: boolean, line: Line): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_SIZE * FRAME_COUNT;
  canvas.height = FRAME_SIZE;
  const ctx = canvas.getContext("2d")!;
  const draw = body === "quadruped" ? drawQuadruped : body === "roller" ? drawRoller : drawBiped;
  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    ctx.save();
    ctx.translate(frame * FRAME_SIZE, 0);
    draw(ctx, frame, color, line);
    // 레인 번호는 구르는 동안에도 몸에 붙어 돌아가 더 우습게 보인다
    ctx.fillStyle = mine ? "#ffb020" : WHITE;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.font = "bold 24px sans-serif";
    ctx.textAlign = "center";
    ctx.strokeText(String(lane), 24, 118);
    ctx.fillText(String(lane), 24, 118);
    ctx.restore();
  }
  return canvas;
}

/** 몸 유형별 움직임. 프레임 이미지 위에 더해지는 튀어 오름, 기울기, 찌그러짐이다 */
export function bodyMotion(body: BodyPlan, time: number, seed: number, distance: number) {
  const beat = time / 95 + seed;
  if (body === "roller") {
    // 달린 거리만큼 실제로 구른다. 가끔 돌부리에 걸린 듯 통통 튄다
    return { rise: Math.abs(Math.sin(beat * 0.6)) * 0.45, tilt: -distance * 1.15, squashX: 1, squashY: 1 };
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
