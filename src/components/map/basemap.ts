"use client";
// 바탕 지도: OpenFreeMap 벡터 타일 (무료, API 키·가입 불필요, OpenStreetMap 데이터).
// - simple: 글자·아이콘 층을 모두 뺀 연한 지도 (그림 코스가 잘 보임)
// - standard: 한국어 지명을 우선 표시하는 일반 지도 (달리기 화면)
// 벡터 지도는 WebGL이 필요하다. 쓸 수 없는 기기에서는 바탕 없이도 코스 찾기·달리기는 동작한다.

import type * as Leaflet from "leaflet";
import "maplibre-gl/dist/maplibre-gl.css";

export type Basemap = "simple" | "standard";

const STYLE_URL: Record<Basemap, string> = {
  simple: "https://tiles.openfreemap.org/styles/positron",
  standard: "https://tiles.openfreemap.org/styles/liberty",
};

export const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

type StyleJson = { layers: Array<{ id: string; type: string; layout?: Record<string, unknown> }>; [k: string]: unknown };

const KOREAN_NAME = ["coalesce", ["get", "name:ko"], ["get", "name:nonlatin"], ["get", "name"]];

/** 스타일을 받아 용도에 맞게 고친다 */
export function transformStyle(style: StyleJson, kind: Basemap): StyleJson {
  if (kind === "simple") {
    // 글자·아이콘(symbol)과 건물 층을 빼면 길·물·공원만 남는다
    return { ...style, layers: style.layers.filter((l) => l.type !== "symbol" && !/building/.test(l.id)) };
  }
  return {
    ...style,
    // 3D 건물은 달리면서 보기 산만하고 휴대폰 GPU·배터리를 더 쓴다
    layers: style.layers.filter((l) => l.type !== "fill-extrusion").map((l) => {
      const tf = l.layout?.["text-field"];
      if (l.type === "symbol" && tf && JSON.stringify(tf).includes("name:latin")) {
        return { ...l, layout: { ...l.layout, "text-field": KOREAN_NAME } };
      }
      return l;
    }),
  };
}

const styleCache = new Map<Basemap, Promise<StyleJson>>();
function loadStyle(kind: Basemap): Promise<StyleJson> {
  let p = styleCache.get(kind);
  if (!p) {
    p = fetch(STYLE_URL[kind])
      .then((r) => {
        if (!r.ok) throw new Error(`style_${r.status}`);
        return r.json() as Promise<StyleJson>;
      })
      .then((s) => transformStyle(s, kind));
    p.catch(() => styleCache.delete(kind));
    styleCache.set(kind, p);
  }
  return p;
}

const LAYER_KEY = "__runcanvasBasemap";
const SEQ_KEY = "__runcanvasBasemapSeq";

/** Leaflet 지도가 아직 살아 있는가 (map.remove() 뒤에는 _mapPane이 지워진다) */
export function mapAlive(map: Leaflet.Map | null | undefined): map is Leaflet.Map {
  return !!map && !!(map as unknown as { _mapPane?: HTMLElement })._mapPane;
}

type PluginModule = typeof import("@maplibre/maplibre-gl-leaflet");
type GlLayer = Leaflet.Layer & { _map: Leaflet.Map | null; _glMap: unknown };

let SafeLayer: (new (o: object) => Leaflet.Layer) | null = null;

/**
 * maplibre-gl-leaflet 0.1.x는 확대 애니메이션·크기 변경 처리를 requestAnimationFrame/타이머로 예약하고,
 * 층이나 지도가 제거된 뒤에도 그 예약이 실행되어 `getZoom` of null 오류가 난다
 * (확대 중 화면 이동, 바탕 지도 전환, 개발 모드 재실행에서 재현).
 * 예약된 처리가 실행될 때 층·지도가 살아 있는지 먼저 확인하는 확장판을 쓴다.
 */
function safeLayerClass(L: typeof Leaflet, plugin: PluginModule) {
  if (SafeLayer) return SafeLayer;
  const Base = plugin.MaplibreGL as unknown as { prototype: Record<string, (...a: unknown[]) => unknown>; extend: (p: object) => unknown };
  const proto = Base.prototype;
  const alive = (l: GlLayer) => !!l._map && !!l._glMap && mapAlive(l._map);
  SafeLayer = Base.extend({
    _update(this: GlLayer, e: unknown) {
      if (alive(this)) proto._update.call(this, e);
    },
    _pinchZoom(this: GlLayer, e: unknown) {
      if (alive(this)) proto._pinchZoom.call(this, e);
    },
    _animateZoom(this: GlLayer, e: unknown) {
      if (alive(this)) proto._animateZoom.call(this, e);
    },
    _zoomEnd(this: GlLayer) {
      if (alive(this)) proto._zoomEnd.call(this);
    },
    // 원본은 예약 안에서 바로 this._map을 쓰므로, 예약된 처리 안에서 생존을 확인하도록 감싼다
    _transitionEnd(this: GlLayer, e: unknown) {
      L.Util.requestAnimFrame(() => {
        if (!alive(this)) return;
        const self = this as unknown as Record<string, unknown> & { _map: Leaflet.Map; _glMap: { _actualCanvas: HTMLElement; once: (ev: string, f: () => void) => void; jumpTo: (o: object) => void } };
        const zoom = self._map.getZoom();
        const center = self._map.getCenter();
        const offset = self._map.latLngToContainerPoint(self._map.getBounds().getNorthWest());
        (self._resizeContainer as () => void).call(self);
        L.DomUtil.setTransform(self._glMap._actualCanvas, offset, 1);
        self._glMap.once("moveend", () => (self._zoomEnd as () => void).call(self));
        self._glMap.jumpTo({ center, zoom: zoom - 1 });
      });
    },
  }) as new (o: object) => Leaflet.Layer;
  return SafeLayer;
}

/**
 * 지도에 바탕 지도를 붙인다(이미 있으면 교체). 실패하면 false — 호출 측에서 안내만 하고 계속 진행.
 * 여러 번 겹쳐 호출되면(빠른 전환·개발 모드 재실행) 마지막 요청만 적용한다.
 */
export async function applyBasemap(L: typeof Leaflet, map: Leaflet.Map, kind: Basemap): Promise<boolean> {
  const holder = map as unknown as Record<string, Leaflet.Layer | undefined>;
  const seqHolder = map as unknown as Record<string, number>;
  const seq = (seqHolder[SEQ_KEY] = (seqHolder[SEQ_KEY] ?? 0) + 1);
  try {
    const [style, plugin, maplibre] = await Promise.all([loadStyle(kind), import("@maplibre/maplibre-gl-leaflet"), import("maplibre-gl")]);
    // 타일 처리 Worker는 앱이 직접 제공한다 (scripts/copy-maplibre-worker.mjs)
    maplibre.setWorkerUrl(`${window.location.origin}/vendor/maplibre-gl-worker.mjs`);
    // 기다리는 사이 지도가 제거됐거나 더 새로운 요청이 있으면 아무것도 하지 않는다
    if (!mapAlive(map) || seqHolder[SEQ_KEY] !== seq) return mapAlive(map);
    holder[LAYER_KEY]?.remove();
    const Layer = safeLayerClass(L, plugin);
    const layer = new Layer({ style, interactive: false });
    layer.addTo(map);
    holder[LAYER_KEY] = layer;
    // 출처 표시(OpenFreeMap·OpenMapTiles·OpenStreetMap)는 스타일의 source attribution을 플러그인이 넣는다
    return true;
  } catch {
    if (mapAlive(map)) holder[LAYER_KEY]?.remove();
    holder[LAYER_KEY] = undefined;
    return false;
  }
}
