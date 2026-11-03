import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

const publicFile = (src: string) => path.join("public", src);

describe("PWA 아이콘", () => {
  const icons = manifest().icons ?? [];

  it("설치에 필요한 192·512 PNG를 일반·마스커블 모두 갖춘다", () => {
    for (const purpose of ["any", "maskable"]) {
      const sizes = icons.filter((i) => i.purpose === purpose && i.type === "image/png").map((i) => i.sizes);
      expect(sizes).toEqual(["192x192", "512x512"]);
    }
  });

  it("매니페스트의 파일이 있고 실제 크기가 선언과 같다", async () => {
    for (const icon of icons) {
      expect(existsSync(publicFile(icon.src)), icon.src).toBe(true);
      if (icon.type !== "image/png") continue;
      const { width, height } = await sharp(publicFile(icon.src)).metadata();
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
    }
  });

  it("마스커블 아이콘과 iOS 아이콘은 투명한 모서리가 없다", async () => {
    const opaque = [...icons.filter((i) => i.purpose === "maskable").map((i) => i.src), "/icons/apple-touch-icon.png"];
    for (const src of opaque) {
      const { channels } = await sharp(publicFile(src)).stats();
      expect(channels[3]?.min ?? 255, src).toBe(255);
    }
    expect((await sharp(publicFile("/icons/apple-touch-icon.png")).metadata()).width).toBe(180);
  });
});
