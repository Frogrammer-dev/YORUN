// 대결 결과 공유 카드: 두 그림·결정타·내 거리와 전적을 인스타 세로 비율(1080×1350) 한 장에 그린다.
// 캔버스로 직접 그려 라이브러리 없이 PNG를 만들고, 공유가 되면 공유 시트, 아니면 내려받기.

import type { Fighter } from "@/lib/battle/battle";
import type { Pt } from "@/lib/contracts/types";
import { downloadBlob } from "@/lib/render/png";

const CW = 1080,
  CH = 1350;

export interface ShareCardInput {
  fs: [Fighter, Fighter];
  won: boolean;
  ko: boolean;
  /** 결정타 한 줄 (예: "강아지의 박치기!") */
  finisher: string;
  /** 내 그림 아래 한 줄 (거리·준 피해 등) */
  detail: string;
}

/** 무대의 Creature와 같은 좌표계: 발끝이 (x, y), 키가 size. fallen이면 옆으로 쓰러져 X 눈 */
function drawCreature(g: CanvasRenderingContext2D, f: Fighter, x: number, y: number, size: number, flip: 1 | -1, color: string, fallen: boolean) {
  const c = f.creature;
  g.save();
  g.translate(x, y);
  if (fallen) {
    // 카드 가운데 쪽으로 쓰러뜨리고, 옆으로 누운 몸이 땅 밑으로 꺼지지 않게 가장 아래로 간 끝만큼 들어 올린다
    const maxX = Math.max(...c.lines.flat().map((p) => p[0]));
    g.translate(0, -(maxX - 0.5) * size);
    g.rotate((flip * Math.PI) / 2);
  }
  g.scale(flip * size, size);
  g.translate(-0.5, -0.95);
  g.lineCap = g.lineJoin = "round";
  const line = (pts: Pt[], width: number, stroke: string) => {
    g.strokeStyle = stroke;
    g.lineWidth = width / size;
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.stroke();
  };
  for (const l of c.lines) line(l, 12, color);
  // 튀어나온 곳이 없던 부위는 무대처럼 막대 팔다리를 단다
  for (const p of Object.values(c.parts)) {
    if (!p.stub) continue;
    const [ax, ay] = p.at,
      len = Math.hypot(ax - c.center[0], ay - c.center[1]) || 1;
    line(
      [
        [ax - ((ax - c.center[0]) / len) * 0.16, ay - ((ay - c.center[1]) / len) * 0.16],
        [ax, ay],
      ],
      12,
      color,
    );
  }
  const h = c.parts.head.at,
    ex = h[0] + (c.center[0] - h[0]) * 0.18,
    ey = h[1] + (c.center[1] - h[1]) * 0.18;
  for (const dx of [-0.045, 0.045]) {
    g.beginPath();
    g.arc(ex + dx, ey, 0.035, 0, Math.PI * 2);
    g.fillStyle = "#fff";
    g.fill();
    g.strokeStyle = "#111318";
    g.lineWidth = 5 / size;
    g.stroke();
    if (fallen) {
      const o = 0.02;
      line(
        [
          [ex + dx - o, ey - o],
          [ex + dx + o, ey + o],
        ],
        5,
        "#111318",
      );
      line(
        [
          [ex + dx - o, ey + o],
          [ex + dx + o, ey - o],
        ],
        5,
        "#111318",
      );
    } else {
      g.beginPath();
      g.arc(ex + dx + 0.013, ey + 0.005, 0.016, 0, Math.PI * 2);
      g.fillStyle = "#111318";
      g.fill();
    }
  }
  g.restore();
}

export async function makeShareCard(input: ShareCardInput): Promise<Blob> {
  // 웹 글꼴이 다 내려온 뒤 그려야 한글이 대체 글꼴로 찍히지 않는다
  if (document.fonts?.ready) await document.fonts.ready;
  const cv = document.createElement("canvas");
  cv.width = CW;
  cv.height = CH;
  const g = cv.getContext("2d");
  if (!g) throw new Error("canvas_unavailable");
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";
  const blue = "#1570EF",
    red = "#D92D20",
    ink = "#111318",
    gray = "#646B78";

  // 무대처럼 하늘·풀밭·받침대
  g.fillStyle = "#DDF0FF";
  g.fillRect(0, 0, CW, CH);
  g.fillStyle = "#E8F5DC";
  g.fillRect(0, 560, CW, CH - 560);
  g.fillStyle = "#C7E3B2";
  for (const [x, y, rx, ry] of [
    [780, 810, 260, 52],
    [300, 1090, 330, 66],
  ]) {
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }

  // 위: 결과와 결정타
  g.textAlign = "center";
  g.fillStyle = input.won ? blue : gray;
  g.font = `900 40px ${font}`;
  g.fillText(input.ko ? "K.O." : "판정", CW / 2, 110);
  g.font = `900 150px ${font}`;
  g.fillText(input.won ? "승리!" : "패배…", CW / 2, 260);
  g.fillStyle = ink;
  g.font = `800 46px ${font}`;
  g.fillText(input.finisher, CW / 2, 340, CW - 120);

  // 두 그림: 진 쪽은 쓰러져 있다 (나 = 왼쪽 앞 파랑, 상대 = 오른쪽 뒤 빨강)
  const [me, foe] = input.fs;
  drawCreature(g, foe, 780, 800, 320, -1, red, input.won);
  drawCreature(g, me, 300, 1080, 420, 1, blue, !input.won);

  // 아래: 내 그림 이름과 기록
  g.fillStyle = "rgba(255,255,255,.92)";
  g.fillRect(60, 1140, CW - 120, 150);
  g.textAlign = "left";
  g.fillStyle = blue;
  g.font = `900 44px ${font}`;
  g.fillText(me.name, 100, 1200, CW - 200);
  g.fillStyle = ink;
  g.font = `700 34px ${font}`;
  g.fillText(input.detail, 100, 1256, CW - 200);
  g.textAlign = "right";
  g.fillStyle = gray;
  g.font = `800 30px ${font}`;
  g.fillText("요런 · 달려서 그린 그림이 싸워요", CW - 60, CH - 22);

  return new Promise((ok, fail) => cv.toBlob((b) => (b ? ok(b) : fail(new Error("png_encode_failed"))), "image/png"));
}

/** 휴대폰처럼 파일 공유가 되면 공유 시트, 아니면 PNG 내려받기 */
export async function shareCard(blob: Blob) {
  const file = new File([blob], "yorun-battle.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "그림 대결" });
    } catch (e) {
      // 공유 시트를 그냥 닫으면 AbortError: 실패가 아니다
      if ((e as Error).name !== "AbortError") throw e;
    }
    return;
  }
  downloadBlob(blob, file.name);
}
