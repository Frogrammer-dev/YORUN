import { describe, expect, it } from "vitest";
import type { RoomItem } from "@/lib/contracts/types";
import { clampIntoRoom, fitsInRoom, itemBounds, nextPlacement } from "@/lib/room/geometry";
import { sceneToSvgString, type Scene } from "@/lib/render/scene";
import { TOKEN_PATTERN, hashShareToken, newShareToken } from "@/lib/server/shareToken";

const mk = (p: NonNullable<ReturnType<typeof nextPlacement>>, i: number): RoomItem => ({
  id: `i${i}`,
  artworkId: `a${i}`,
  ...p,
  style: { strokeColor: "#000000", strokeWidth: 0.01, frame: "plain" },
});

describe("작품방 배치", () => {
  it("첫 작품은 중앙 기본 크기, 이후는 겹치지 않는 슬롯 (FR-05)", () => {
    const items: RoomItem[] = [];
    const first = nextPlacement(items)!;
    expect(first).toMatchObject({ x: 0.5, y: 0.5, size: 0.3, zIndex: 0 });
    items.push(mk(first, 0));
    const second = nextPlacement(items)!;
    const a = itemBounds(items[0]);
    const b = itemBounds(second);
    const overlap = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
    expect(overlap).toBe(false);
    expect(second.zIndex).toBe(1);
  });

  it("모든 기본 슬롯이 방 안에 들어감", () => {
    const items: RoomItem[] = [];
    for (let i = 0; i < 20; i++) {
      const p = nextPlacement(items)!;
      expect(fitsInRoom(p)).toBe(true);
      items.push(mk(p, i));
    }
    // 전시 한도: 21번째는 배치하지 않음 (기존 작품 자동 제거 없음)
    expect(nextPlacement(items)).toBeNull();
  });

  it("회전을 포함해 방 안으로 당기기", () => {
    const c = clampIntoRoom({ x: 0.99, y: 0.01, size: 0.2, rotationDeg: 45 })!;
    expect(fitsInRoom(c)).toBe(true);
  });
});

describe("SceneRenderer", () => {
  const scene: Scene = {
    theme: "dark",
    items: [
      {
        key: "k",
        x: 0.5,
        y: 0.5,
        size: 0.24,
        rotationDeg: 10,
        zIndex: 0,
        style: { strokeColor: "#FF0000", strokeWidth: 0.01, frame: "neon" },
        lines: [
          [
            [0.1, 0.1],
            [0.9, 0.1],
          ],
          [[0.5, 0.5]],
          [
            [0.2, 0.8],
            [0.8, 0.8],
          ],
        ],
      },
    ],
  };

  it("구간마다 별도 선, 단일점은 원, 끝점 강제 연결 없음 (7.4, AT-05)", () => {
    const svg = sceneToSvgString(scene);
    expect(svg.match(/<polyline /g)).toHaveLength(2);
    expect(svg.match(/<circle /g)).toHaveLength(1);
    expect(svg).not.toMatch(/\bZ\b|closePath|<path /);
  });

  it("검증되지 않은 색은 출력하지 않음 (AT-19)", () => {
    const bad: Scene = { ...scene, items: [{ ...scene.items[0], style: { ...scene.items[0].style, strokeColor: '"/><script>' } }] };
    const svg = sceneToSvgString(bad);
    expect(svg).not.toContain("<script>");
  });
});

describe("공유 토큰 (11.2)", () => {
  it("32바이트 base64url 토큰과 SHA-256 해시", () => {
    const { token, hash } = newShareToken();
    expect(token).toMatch(TOKEN_PATTERN);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(token)).toBe(hash);
    expect(newShareToken().token).not.toBe(token);
  });
});
