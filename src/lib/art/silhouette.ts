// 이미지 모델이 그린 검은 실루엣에서 가장 큰 닫힌 윤곽을 뽑는다.

import sharp from "sharp";
import { groupFromLoops, type ShapeGroup } from "@/lib/route/shapes";
import { traceOutlines } from "./trace";

export const SILHOUETTE_IMAGE_MODEL = "gpt-image-1-mini";

export const silhouettePrompt = (subject: string) => `A single solid pure-black filled silhouette of: ${subject}. Bold, simple, instantly recognizable shape that clearly shows its most distinctive features, exaggerating them. One connected shape with no holes, no interior details, no outline effects, no text, no shadow, no background objects. Centered on a plain pure-white background, filling most of the frame.`;

const area = (loop: readonly (readonly number[])[]) => Math.abs(loop.reduce((sum, p, i) => {
  const q = loop[(i + 1) % loop.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

/**
 * 어두운 쪽을 항상 그림으로 본다. 실루엣이 이미지 절반을 넘어도 배경과 뒤집히지 않게
 * 일반 이미지용 binarize의 자동 반전을 쓰지 않는다.
 */
export async function traceSilhouette(png: Buffer, name = "설명으로 만든 그림"): Promise<ShapeGroup | null> {
  const size = 256;
  const { data } = await sharp(png).flatten({ background: "#ffffff" }).resize(size, size).greyscale().raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i] < 128 ? 1 : 0;
  const loops = traceOutlines(mask, size, size);
  if (!loops.length) return null;
  const largest = [...loops].sort((a, b) => area(b) - area(a))[0];
  return groupFromLoops([largest], { name, maxVertices: 48 });
}
