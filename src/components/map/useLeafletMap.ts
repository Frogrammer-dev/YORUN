"use client";
// Leaflet 지도 초기화 (브라우저 전용 → 동적 import). 바탕 지도는 OpenFreeMap 벡터 타일(키 불필요).
import { useEffect, useState, type RefObject } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { applyBasemap, type Basemap } from "./basemap";

export type { Basemap } from "./basemap";
export { mapAlive } from "./basemap";
export type LeafletNS = typeof Leaflet;

export const DEFAULT_CENTER: [number, number] = [35.1532, 129.1186]; // 부산 광안리 일대

export interface LeafletState {
  L: LeafletNS;
  map: Leaflet.Map;
}

export function useLeafletMap(ref: RefObject<HTMLDivElement | null>, opts: { center?: [number, number]; zoom?: number; basemap?: Basemap } = {}) {
  const [state, setState] = useState<LeafletState | null>(null);
  /** 바탕 지도를 못 불러왔으면 false (WebGL 없음·네트워크 문제). 코스 찾기·달리기는 계속 동작 */
  const [basemapOk, setBasemapOk] = useState<boolean | null>(null);

  useEffect(() => {
    let map: Leaflet.Map | null = null;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    // 화면이 지도 상자를 조금 늦게 그리는 경우(데이터를 읽는 동안 ‘불러오는 중’ 표시)가 있어
    // 지도 상자가 생길 때까지 기다린다. 기다리지 않으면 라이브러리가 캐시돼 빨리 준비될 때 지도가 안 뜬다.
    const waitForContainer = () =>
      new Promise<HTMLDivElement | null>((resolve) => {
        const started = performance.now();
        const tick = () => {
          if (cancelled) return resolve(null);
          if (ref.current) return resolve(ref.current);
          if (performance.now() - started > 10_000) return resolve(null);
          requestAnimationFrame(tick);
        };
        tick();
      });
    void Promise.all([import("leaflet"), waitForContainer()]).then(([mod, el]) => {
      const L = ((mod as unknown as { default?: LeafletNS }).default ?? mod) as LeafletNS;
      if (cancelled || !el) return;
      map = L.map(el, { zoomControl: true, attributionControl: true }).setView(opts.center ?? DEFAULT_CENTER, opts.zoom ?? 15);
      const m = map;
      compactAttribution(L, m);
      // 바탕 지도를 바꿀 수 있는 화면은 직접 setBasemap을 부른다(중복 생성 방지)
      if (opts.basemap) void applyBasemap(L, m, opts.basemap).then((ok) => !cancelled && setBasemapOk(ok));
      // 화면 회전·레이아웃 변경으로 지도 상자 크기가 바뀌면 다시 계산한다.
      ro = new ResizeObserver(() => m.invalidateSize({ pan: false }));
      ro.observe(el);
      setState({ L, map });
    });
    return () => {
      cancelled = true;
      ro?.disconnect();
      // Leaflet 1.9는 확대 애니메이션 끝 처리를 250ms 타이머로 예약하고 stop()으로 취소하지 않는다.
      // 제거된 지도에서 그 타이머가 돌면 오류가 나므로, 처리기가 바로 끝나도록 애니메이션 중 표시를 끈다.
      if (map) (map as unknown as { _animatingZoom: boolean })._animatingZoom = false;
      map?.stop();
      map?.off();
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // lm은 지도가 만들어질 때 한 번만 바뀐다(효과 의존성으로 써도 안전).
  return { lm: state, basemapOk, setBasemapOk };
}

/** 지도 영역의 가로·세로 길이(미터) */
export function boundsSizeMeters(b: Leaflet.LatLngBounds) {
  const lat = (b.getNorth() + b.getSouth()) / 2;
  const h = (b.getNorth() - b.getSouth()) * 111_195;
  const w = (b.getEast() - b.getWest()) * 111_195 * Math.cos((lat * Math.PI) / 180);
  return { w, h };
}

/** 바탕 지도 바꾸기. 성공 여부를 돌려준다 */
export function setBasemap(L: LeafletNS, map: Leaflet.Map, kind: Basemap): Promise<boolean> {
  return applyBasemap(L, map, kind);
}

/**
 * 지도 출처 표시를 작은 ⓘ 버튼으로 접는다. OpenStreetMap(ODbL)·OpenFreeMap 이용 조건상 출처는 지도에서 볼 수 있어야 하므로
 * 지우지 않고, 누르면 펼쳐 보이게 한다. 'Leaflet' 머리말은 의무가 아니라 뺀다.
 */
function compactAttribution(L: LeafletNS, map: Leaflet.Map) {
  const ac = map.attributionControl;
  if (!ac) return;
  ac.setPrefix(false);
  const attr = ac.getContainer();
  if (!attr) return;
  attr.id ||= `map-attr-${Math.random().toString(36).slice(2, 8)}`;
  const Toggle = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create("button", "attr-toggle") as HTMLButtonElement;
      btn.type = "button";
      btn.textContent = "ⓘ";
      btn.setAttribute("aria-label", "지도 출처 보기");
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", attr.id);
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, "click", () => {
        const open = attr.classList.toggle("attr-open");
        btn.setAttribute("aria-expanded", String(open));
        btn.setAttribute("aria-label", open ? "지도 출처 접기" : "지도 출처 보기");
      });
      return btn;
    },
  });
  new Toggle({ position: "bottomright" }).addTo(map);
}
