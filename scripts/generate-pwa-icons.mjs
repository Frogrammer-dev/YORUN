// public/icon.svg에서 PWA·홈 화면 PNG 아이콘을 만든다. 로고를 바꾼 뒤 한 번 실행한다:
//   node scripts/generate-pwa-icons.mjs
import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";

const source = readFileSync("public/icon.svg", "utf8");
const parts = source.match(/^<svg[^>]*>(<rect[^>]*fill="(#[0-9A-Fa-f]{6})"\/>)(.*)<\/svg>\s*$/s);
if (!parts) throw new Error("public/icon.svg 구조가 예상과 달라요: 첫 요소는 배경 <rect>여야 해요.");
const [, , background, artwork] = parts;

const square = (content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${background}"/>${content}</svg>`;
// 마스커블 아이콘은 가운데 지름 80% 원 밖이 잘릴 수 있다. 그림 모서리가 원 안에 들도록 줄인다.
const safeZone = square(`<g transform="translate(256 256) scale(.8) translate(-256 -256)">${artwork}</g>`);
const fullBleed = square(artwork);

const render = (svg, size) => sharp(Buffer.from(svg), { density: Math.ceil((72 * size) / 512) * 2 }).resize(size, size);

mkdirSync("public/icons", { recursive: true });
await Promise.all([
  render(source, 192).png().toFile("public/icons/icon-192.png"),
  render(source, 512).png().toFile("public/icons/icon-512.png"),
  render(safeZone, 192).png().toFile("public/icons/maskable-192.png"),
  render(safeZone, 512).png().toFile("public/icons/maskable-512.png"),
  // iOS는 모서리를 직접 둥글리고 투명 부분을 검게 칠하므로 알파 없는 정사각형으로 만든다.
  render(fullBleed, 180).removeAlpha().png().toFile("public/icons/apple-touch-icon.png"),
]);
