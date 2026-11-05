// 부스 사인보드용 경로 그림: 실험 결과 SVG(eval/recognition/llm-routes-20261010)의 왼쪽 패널(앱 기본 탐색 결과)에서
// 실제 도로망과 생성 경로만 꺼내, 경로 주변으로 잘라 img/*.svg로 저장한다. 실행: node docs/booth/build-routes.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../../eval/recognition/llm-routes-20261010");
mkdirSync(join(here, "img"), { recursive: true });

const themes = {
  dark: { bg: "#0B1220", road: "#24324A", route: "#38BDF8", w: 6 },
  light: { bg: "#FFFFFF", road: "#DCE1E7", route: "#0A72D6", w: 6 },
};

function build(name, theme, pad = 0.35) {
  const svg = readFileSync(join(src, `${name}-comparison.svg`), "utf8");
  const left = svg.split("<g ")[1];
  const [roads, , route] = [...left.matchAll(/<path d="([^"]*)"/g)].map((m) => m[1]);
  const pts = [...route.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // 정사각형으로 잘라 경로가 가운데 오게 한다
  const size = Math.max(x1 - x0, y1 - y0) * (1 + 2 * pad);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const t = themes[theme];
  const [sx, sy] = pts[0];
  const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(cx - size / 2).toFixed(1)} ${(cy - size / 2).toFixed(1)} ${size.toFixed(1)} ${size.toFixed(1)}">
<rect x="-9999" y="-9999" width="99999" height="99999" fill="${t.bg}"/>
<path d="${roads}" fill="none" stroke="${t.road}" stroke-width="1.6" stroke-linecap="round"/>
<path d="${route}" fill="none" stroke="${t.route}" stroke-opacity=".25" stroke-width="${t.w * 3}" stroke-linejoin="round" stroke-linecap="round"/>
<path d="${route}" fill="none" stroke="${t.route}" stroke-width="${t.w}" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="${sx}" cy="${sy}" r="${t.w * 1.6}" fill="#fff" stroke="${t.route}" stroke-width="${t.w * 0.8}"/>
</svg>`;
  writeFileSync(join(here, "img", `${name}-${theme}.svg`), out);
  console.log(name, theme, `${(out.length / 1024).toFixed(0)}KB`);
}

build("gangnam-cat", "dark", 0.12);
for (const n of ["gangnam-star", "gwangalli-heart", "gangnam-square"]) build(n, "light", 0.18);
