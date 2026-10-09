// 낙서 인식: 코스 선을 28×28 흑백 낙서로 그려 DoodleNet(Quick, Draw! 345가지, ml5.js 배포본·MIT)에 보여 주고
// '무엇처럼 보이는지'를 고른다. 정해진 몇 가지 그림과 겹쳐 보는 대신, 사람들이 그린 낙서 5천만 장에서 배운 눈으로 본다.
// 모델은 /models/doodlenet 에 함께 배포하며 코스 모양은 기기 밖으로 보내지 않는다.

import type { LayersModel } from "@tensorflow/tfjs-layers";

export type XY = [number, number];

export const DOODLE_SIZE = 28;

/**
 * 닫힌 선(y 위로) → 28×28 낙서 (선 1, 바탕 0). Quick, Draw! 비트맵처럼 그림을 가운데 두고 긴 변을 꽉 채운 뒤
 * 약 2픽셀 굵기로 그린다 (ml5 전처리: 흰 바탕 검은 선을 뒤집어 0/1로).
 */
export function rasterizeLoop(pts: readonly XY[], size = DOODLE_SIZE, pad = 2, halfWidth = 0.85): Float32Array {
  const out = new Float32Array(size * size);
  if (pts.length < 2) return out;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const k = (size - 2 * pad - 1) / span;
  const ox = pad + ((size - 2 * pad - 1) - (maxX - minX) * k) / 2, oy = pad + ((size - 2 * pad - 1) - (maxY - minY) * k) / 2;
  // 픽셀 좌표 (행 0이 위쪽)
  const P = pts.map(([x, y]) => [ox + (x - minX) * k, oy + (maxY - y) * k] as XY);
  const closed = P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1] ? P : [...P, P[0]];
  for (let i = 1; i < closed.length; i++) {
    const [ax, ay] = closed[i - 1], [bx, by] = closed[i];
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - 1)), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - 1)), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by) + 1));
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
        if (Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= halfWidth) out[py * size + px] = 1;
      }
  }
  return out;
}

export interface DoodleGuess {
  /** 클래스 번호 (class_names.txt 순서) */
  index: number;
  name: string;
  prob: number;
}

/** 모델과 클래스 이름. load()는 한 번만 받는다 */
export class DoodleClassifier {
  private constructor(
    private model: LayersModel,
    readonly classes: string[],
    private tf: typeof import("@tensorflow/tfjs-core"),
  ) {}

  /** 브라우저: /models/doodlenet 에서 받는다. webgl이 안 되면 cpu로 */
  static async load(base = "/models/doodlenet"): Promise<DoodleClassifier> {
    const tf = await import("@tensorflow/tfjs-core");
    const layers = await import("@tensorflow/tfjs-layers");
    await import("@tensorflow/tfjs-backend-cpu");
    try {
      await import("@tensorflow/tfjs-backend-webgl");
      if (!(await tf.setBackend("webgl"))) await tf.setBackend("cpu");
    } catch {
      await tf.setBackend("cpu");
    }
    await tf.ready();
    const [model, names] = await Promise.all([layers.loadLayersModel(`${base}/model.json`), fetch(`${base}/class_names.txt`).then((r) => r.text())]);
    return new DoodleClassifier(model, parseClassNames(names), tf);
  }

  /** 테스트·서버용: 파일 내용으로 바로 만든다 */
  static async fromMemory(modelJson: { modelTopology: unknown; weightsManifest: Array<{ weights: unknown[] }> }, weights: ArrayBuffer, classNames: string): Promise<DoodleClassifier> {
    const tf = await import("@tensorflow/tfjs-core");
    const layers = await import("@tensorflow/tfjs-layers");
    await import("@tensorflow/tfjs-backend-cpu");
    await tf.setBackend("cpu");
    const model = await layers.loadLayersModel(
      tf.io.fromMemory({ modelTopology: modelJson.modelTopology as object, weightSpecs: modelJson.weightsManifest.flatMap((m) => m.weights) as never, weightData: weights }),
    );
    return new DoodleClassifier(model, parseClassNames(classNames), tf);
  }

  /** 낙서 여러 장 → 장마다 확률 높은 순 topK */
  async classify(images: Float32Array[], topK = 5): Promise<DoodleGuess[][]> {
    if (!images.length) return [];
    const tf = this.tf;
    const S = DOODLE_SIZE;
    const flat = new Float32Array(images.length * S * S);
    images.forEach((im, i) => flat.set(im, i * S * S));
    const probs = tf.tidy(() => this.model.predict(tf.tensor4d(flat, [images.length, S, S, 1])) as import("@tensorflow/tfjs-core").Tensor);
    const data = (await probs.data()) as Float32Array;
    probs.dispose();
    const C = this.classes.length;
    return images.map((_, i) => {
      const row = Array.from(data.subarray(i * C, (i + 1) * C), (prob, index) => ({ index, prob, name: this.classes[index] }));
      return row.sort((a, b) => b.prob - a.prob).slice(0, topK);
    });
  }
}

export function parseClassNames(text: string): string[] {
  return text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}
