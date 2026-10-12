// 올린 원본 이미지를 코스 위에 반투명하게 겹치는 Leaflet 레이어.
// Leaflet 이미지 레이어는 회전을 못 해서, 세 모서리(왼위·오른위·왼아래)의 화면 위치로 CSS 행렬을 만든다.
import type * as Leaflet from "leaflet";

export function artImageLayer(L: typeof Leaflet, url: string, corners: [number, number][]): Leaflet.Layer {
  const img = document.createElement("img");
  img.src = url;
  img.alt = "";
  img.style.cssText = "position:absolute;left:0;top:0;max-width:none;transform-origin:0 0;opacity:.45;pointer-events:none;visibility:hidden";
  let map: Leaflet.Map | null = null;
  // 레이어 좌표는 확대 단계가 바뀔 때만 달라진다 (끌어 옮길 때는 그대로). 원본 해상도로 그려 확대해도 덜 흐리다.
  const update = () => {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!map || !w || !h) return;
    const [a, b, c] = corners.map((ll) => map!.latLngToLayerPoint(ll));
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    img.style.transform = `matrix(${(b.x - a.x) / w},${(b.y - a.y) / w},${(c.x - a.x) / h},${(c.y - a.y) / h},${a.x},${a.y})`;
    img.style.visibility = "";
  };
  const hide = () => (img.style.visibility = "hidden");
  img.onload = update;
  const layer = new L.Layer();
  layer.onAdd = (m) => {
    map = m;
    const pane = m.getPane("artImage") ?? m.createPane("artImage");
    pane.style.zIndex = "350"; // 코스 선(overlayPane 400) 아래
    pane.style.pointerEvents = "none";
    pane.appendChild(img);
    m.on("zoomend viewreset", update).on("zoomstart", hide);
    update();
    return layer;
  };
  layer.onRemove = (m) => {
    m.off("zoomend viewreset", update).off("zoomstart", hide);
    img.remove();
    map = null;
    return layer;
  };
  return layer;
}
