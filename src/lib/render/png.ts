// FR-11 / NFR-05: 화면과 같은 장면을 1,000×750 PNG로 만든다. 브라우저 안에서만 실행.
// 한글 텍스트는 문서 글꼴 로드 완료 후 캔버스에 직접 그린다 (SVG 이미지 안에서는 웹 글꼴이 적용되지 않음).

import { ROOM } from "@/lib/contracts/limits";
import { formatDistance } from "@/lib/gpx/metrics";
import { THEME_COLORS, layoutScene, sceneToSvgString, type Scene } from "./scene";

export interface PngOptions {
  includeTitle: boolean;
  includeDistance: boolean;
  includeDate: boolean;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("svg_image_load_failed"));
    img.src = url;
  });
}

export async function renderScenePng(scene: Scene, opts: PngOptions): Promise<Blob> {
  if (document.fonts?.ready) await document.fonts.ready;
  const svg = sceneToSvgString(scene);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = ROOM.width;
    canvas.height = ROOM.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    ctx.drawImage(img, 0, 0, ROOM.width, ROOM.height);

    const fontFamily = getComputedStyle(document.body).fontFamily || "sans-serif";
    for (const it of layoutScene(scene)) {
      const parts = [
        opts.includeTitle ? it.item.title : null,
        opts.includeDistance && it.item.distanceEstimateMeters != null ? formatDistance(it.item.distanceEstimateMeters) : null,
        opts.includeDate ? it.item.recordedDate : null,
      ].filter(Boolean) as string[];
      if (!parts.length) continue;
      ctx.save();
      ctx.translate(it.item.x * ROOM.width, it.item.y * ROOM.height);
      ctx.rotate((it.item.rotationDeg * Math.PI) / 180);
      ctx.font = `${Math.max(10, it.side * 0.055)}px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = it.frame.label;
      ctx.fillText(parts.join(" · "), 0, it.half - it.side * 0.035, it.side * 0.92);
      ctx.restore();
    }
    // 워터마크 대신 작은 출처 표기 (테마 글자색)
    ctx.font = `12px ${fontFamily}`;
    ctx.fillStyle = THEME_COLORS[scene.theme].text;
    ctx.globalAlpha = 0.5;
    ctx.textAlign = "right";
    ctx.fillText("Yorun", ROOM.width - 12, ROOM.height - 12);

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png_encode_failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
