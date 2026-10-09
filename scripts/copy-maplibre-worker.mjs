// MapLibre는 타일 처리 Worker 파일을 자기 번들 옆에서 찾는데, Next.js 번들 후에는 그 경로가 깨진다.
// 그래서 Worker 파일을 public/vendor로 복사해 앱이 직접 제공한다 (basemap.ts에서 setWorkerUrl).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json"));
const out = join(process.cwd(), "public", "vendor");
mkdirSync(out, { recursive: true });
copyFileSync(join(dist, "dist", "maplibre-gl-worker.mjs"), join(out, "maplibre-gl-worker.mjs"));
console.log("maplibre worker → public/vendor/maplibre-gl-worker.mjs");
