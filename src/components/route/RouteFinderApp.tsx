"use client";
// 드로잉 루트 찾기 (/routes): 지금 지도에 보이는 영역의 실제 길에서 한붓 그림 코스를 찾는다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type * as Leaflet from "leaflet";
import { boundsSizeMeters, mapAlive, setBasemap, useLeafletMap, type Basemap } from "@/components/map/useLeafletMap";
import type { RouteCandidate } from "@/lib/route/fit";
import type { FinderRequest, FinderResponse } from "@/lib/route/finder.worker";
import { fetchOverpassTiles, splitBBox, type BBox } from "@/lib/route/osm";
import { fetchElevation } from "@/lib/route/elevation";
import { recognizeCourses } from "@/lib/art/recognize";
import { moveLines, nameDiscoveries, pixelToLatLng } from "@/lib/route/present";
import type { ShapeGroup } from "@/lib/route/shapes";
import { artImageLayer } from "@/components/route/artImageLayer";
import { PlaceSearch } from "@/components/route/PlaceSearch";
import { AREAS, DEFAULT_SETTINGS, MAX_SIDE, MIN_SIDE, RANGES, nearbyDataBox, type AreaId, type FinderSettingsValue } from "@/components/route/finderOptions";
import { FinderSettings } from "@/components/route/FinderSettings";
import { CourseList } from "@/components/route/CourseList";
import { SelectedCourse, type ElevationState } from "@/components/route/SelectedCourse";
import { savePlannedRoute } from "@/lib/run/storage";
import { toGpx } from "@/lib/run/tracker";
import { downloadBlob } from "@/lib/render/png";
import { BrandMark, Icon } from "@/components/Icon";

const ROUTE_COLOR = "#0EA5E9";

type Phase =
  | { kind: "idle" }
  | { kind: "fetching"; done: number; total: number }
  | { kind: "searching"; fraction: number; label: string }
  | { kind: "done"; candidates: RouteCandidate[]; partial: boolean; dataTimestamp: string | null; nodes: number; discover: boolean; doodleError?: boolean; naming?: boolean }
  | { kind: "error"; message: string };

export function RouteFinderApp() {
  const router = useRouter();
  const mapEl = useRef<HTMLDivElement>(null);
  const { lm, basemapOk, setBasemapOk } = useLeafletMap(mapEl);
  const [settings, setSettings] = useState<FinderSettingsValue>(DEFAULT_SETTINGS);
  const { shape, custom, area, range, detail, excludeSteps, avoidUnpaved, avoidMajor, preferLit, branches, nearby, minSimilarity } = settings;
  const areaRef = useRef<AreaId>("screen");
  const areaRect = useRef<Leaflet.Rectangle | null>(null);
  const [elev, setElev] = useState<Record<string, Exclude<ElevationState, undefined>>>({});
  const [basemap, setBasemapState] = useState<Basemap>("simple");
  const [showRoads, setShowRoads] = useState(false);
  const roadsRef = useRef<number[] | null>(null);
  const roadLayer = useRef<Leaflet.Polyline | null>(null);
  /** 장소 검색으로 고른 곳 표시 (새로 고르면 바뀐다) */
  const placeMarker = useRef<Leaflet.CircleMarker | null>(null);
  /** 지금 결과를 찾을 때 쓴 내 그림 (이미지 겹쳐 보기용, 찾은 뒤 그림을 바꿔도 결과와 맞게 유지) */
  const searchedGroup = useRef<ShapeGroup | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // 낙서 인식 코스는 점수 척도가 달라(모델 확신도) 유사도로 거르지 않는다
  const visible = useMemo(() => (phase.kind === "done" ? phase.candidates.filter((c) => c.doodle || c.similarity >= minSimilarity) : []), [phase, minSimilarity]);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const [hover, setHover] = useState<string | null>(null);
  const [areaInfo, setAreaInfo] = useState<{ w: number; h: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const showRoadsRef = useRef(false);
  const reqId = useRef(0);
  const layers = useRef<Leaflet.LayerGroup | null>(null);
  const searchedBox = useRef<{ bbox: BBox; dataBox: BBox; nearby: boolean; rect: Leaflet.Rectangle | null; fetchedKey: string; area: AreaId } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** 사용자가 지도를 직접 움직였거나 탐색을 시작했으면, 늦게 도착한 첫 위치로 지도를 옮기지 않는다. */
  const userTookOver = useRef(false);
  const [sheetFull, setSheetFull] = useState(false);
  const settingsRef = useRef<HTMLElement>(null);
  /** 사용자가 마지막 탐색 뒤 지도를 직접 움직였는지 (앱이 코스로 확대한 이동은 제외) */
  const userMoved = useRef(false);
  const programmatic = useRef(false);
  const fitTarget = useRef<Leaflet.LatLngBounds | null>(null);

  // 지도 영역 크기 표시 + 내 위치로 이동
  useEffect(() => {
    if (!lm) return;
    const upd = () => {
      const b = lm.map.getBounds();
      setAreaInfo(boundsSizeMeters(b));
      drawAreaRect();
      // 탐색한 영역 표시는 지도를 옮겨 화면과 달라졌을 때만 보인다 (같으면 화면 가장자리에 붙어 오류처럼 보임)
      const s = searchedBox.current;
      if (s?.rect) {
        const sb = lm.L.latLngBounds([s.bbox.south, s.bbox.west], [s.bbox.north, s.bbox.east]);
        // 사용자가 지도를 직접 옮겨 탐색 영역 밖이 보일 때만 그린다 (앱의 코스 확대 이동·안쪽 확대 때는 숨김)
        if (!userMoved.current || sb.contains(b)) s.rect.remove();
        else if (!lm.map.hasLayer(s.rect)) s.rect.addTo(lm.map);
      }
    };
    upd();
    lm.map.on("moveend zoomend resize", upd);
    lm.map.on("dragstart", () => {
      userTookOver.current = true;
      userMoved.current = true;
    });
    lm.map.on("zoomstart", () => {
      if (!programmatic.current) userMoved.current = true;
    });
    // 시트 높이가 바뀌어 지도 크기가 달라지면(결과 표시 등) 선택한 코스에 다시 맞춘다
    let raf = 0;
    const refit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!userMoved.current && fitTarget.current && mapAlive(lm.map)) fitTo(fitTarget.current);
      });
    };
    lm.map.on("resize", refit);
    layers.current = lm.L.layerGroup().addTo(lm.map);
    return () => {
      lm.map.off("moveend zoomend resize", upd);
      lm.map.off("resize", refit);
      cancelAnimationFrame(raf);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 지도·ref만 쓰는 함수라 매 렌더 다시 실행할 필요가 없다 (지도 생성 시 한 번 연결)
  }, [lm]);

  const locate = useCallback((auto: boolean) => {
    if (!lm || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        // 위치 확인은 늦게 끝날 수 있다. 그사이 화면을 떠나 지도가 제거됐으면 아무것도 하지 않는다.
        if (!mapAlive(lm.map)) return;
        if (!(auto && userTookOver.current)) lm.map.setView([p.coords.latitude, p.coords.longitude], 15);
        lm.L.circleMarker([p.coords.latitude, p.coords.longitude], { radius: 8, color: "#fff", weight: 3, fillColor: "#1A73E8", fillOpacity: 1 }).addTo(lm.map);
      },
      () => {
        if (!auto) setPhase({ kind: "error", message: "현재 위치를 확인하지 못했어요. 지도를 직접 움직여 찾을 영역을 맞춰 주세요." });
      },
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }, [lm]);

  useEffect(() => {
    if (lm) locate(true);
  }, [lm, locate]);

  useEffect(() => {
    const w = new Worker(new URL("../../lib/route/finder.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    if (lm) void setBasemap(lm.L, lm.map, basemap).then(setBasemapOk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lm, basemap]);

  useEffect(() => {
    showRoadsRef.current = showRoads;
    drawRoads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRoads, lm]);

  // 후보 그리기
  const draw = useCallback(
    (cands: RouteCandidate[], sel: string | null, hover: string | null) => {
      if (!lm || !layers.current || !mapAlive(lm.map)) return;
      const g = layers.current;
      g.clearLayers();
      const active = cands.find((c) => c.id === sel) ?? null;
      const round = { lineCap: "round", lineJoin: "round" } as const;
      // 선택한 코스만 그린다 (다른 후보는 목록 썸네일로 보여 준다). 목록에 마우스를 올린 후보는 회색으로 미리보기.
      const hovered = cands.find((c) => c.id === hover && c.id !== sel);
      if (hovered) lm.L.polyline(hovered.latlngs, { ...round, color: "#4A505C", weight: 3, opacity: 0.55, interactive: false }).addTo(g);
      if (!active) for (const c of cands) lm.L.polyline(c.latlngs, { ...round, color: ROUTE_COLOR, weight: 3, opacity: 0.5 }).on("click", () => setSelected(c.id)).addTo(g);
      if (active) {
        // 이미지로 만든 그림이면 원본 이미지를 첫 획 외곽선에 맞춰 반투명하게 코스 아래에 겹친다
        const art = searchedGroup.current;
        const part = art?.parts[0];
        const toLL = active.shapeId === "custom" && art?.image && part?.frame && part.shape.points.length === active.outline.length ? pixelToLatLng(part.shape.points, active.outline, part.frame) : null;
        if (toLL && art?.image) artImageLayer(lm.L, art.image.url, [toLL(0, 0), toLL(art.image.width, 0), toLL(0, art.image.height)]).addTo(g);
        lm.L.polyline(active.latlngs, { ...round, color: "#fff", weight: 10, opacity: 0.95, interactive: false }).addTo(g);
        lm.L.polyline(active.latlngs, { ...round, color: ROUTE_COLOR, weight: 6, opacity: 1, interactive: false }).addTo(g);
        // 획 사이 이동 구간: 그림이 아니므로 회색 점선으로 덮는다
        for (const mv of moveLines(active)) {
          lm.L.polyline(mv, { ...round, color: "#fff", weight: 7, opacity: 1, interactive: false }).addTo(g);
          lm.L.polyline(mv, { ...round, color: "#646B78", weight: 4, dashArray: "2 9", opacity: 1, interactive: false }).addTo(g);
        }
        for (const o of active.outlines ?? [active.outline])
          lm.L.polyline(o, { ...round, color: "#2B2F38", weight: 2.5, dashArray: "1 8", opacity: 0.7, interactive: false }).addTo(g);
        lm.L.circleMarker(active.latlngs[0], { radius: 10, color: "#fff", weight: 3, fillColor: "#12B76A", fillOpacity: 1 })
          .bindTooltip("출발·도착", { permanent: false })
          .addTo(g);
      }
    },
    [lm],
  );

  useEffect(() => {
    if (phase.kind === "done") draw(visible, selected, hover);
  }, [phase, visible, selected, hover, draw]);

  /** 탐색에 쓴(단순화된) 길을 회색 선으로 겹쳐 보기 */
  function drawRoads() {
    if (!lm || !mapAlive(lm.map)) return;
    roadLayer.current?.remove();
    roadLayer.current = null;
    const r = roadsRef.current;
    if (!showRoadsRef.current || !r) return;
    const lines: [number, number][][] = [];
    for (let i = 0; i < r.length; i += 4) lines.push([[r[i], r[i + 1]], [r[i + 2], r[i + 3]]]);
    roadLayer.current = lm.L.polyline(lines, { color: "#8A919E", weight: 1.5, opacity: 0.45, interactive: false, renderer: lm.L.canvas() }).addTo(lm.map);
    roadLayer.current.bringToBack();
  }

  /** 코스를 찾을 영역: 지금 화면, 또는 지도 가운데 중심의 정사각형 */
  function searchBounds(id: AreaId = area): Leaflet.LatLngBounds {
    const L = lm!.L, map = lm!.map;
    const km = AREAS.find((a) => a.id === id)!.km;
    if (!km) return map.getBounds();
    const c = map.getCenter();
    const dLat = (km * 1000) / 111_195 / 2, dLon = (km * 1000) / (111_195 * Math.cos((c.lat * Math.PI) / 180)) / 2;
    return L.latLngBounds([c.lat - dLat, c.lng - dLon], [c.lat + dLat, c.lng + dLon]);
  }

  /** 정사각형 영역을 지도에 점선 사각형으로 보여 준다 (지도를 옮기면 따라 움직임) */
  function drawAreaRect() {
    if (!lm || !mapAlive(lm.map)) return;
    areaRect.current?.remove();
    areaRect.current = null;
    if (areaRef.current === "screen") return;
    areaRect.current = lm.L.rectangle(searchBounds(areaRef.current), { color: "#0A72D6", weight: 2, opacity: 0.8, fillOpacity: 0.04, dashArray: "6 6", interactive: false }).addTo(lm.map);
  }

  function chooseArea(id: AreaId) {
    setSettings((v) => ({ ...v, area: id }));
    areaRef.current = id;
    if (!lm) return;
    drawAreaRect();
    // 고른 영역이 화면보다 크면 영역이 다 보이게 축소한다
    if (id !== "screen" && !lm.map.getBounds().contains(searchBounds(id))) {
      programmatic.current = true;
      lm.map.fitBounds(searchBounds(id), { padding: [16, 16] });
      window.setTimeout(() => (programmatic.current = false), 700);
    }
  }

  async function search() {
    if (!lm || !workerRef.current) return;
    userTookOver.current = true;
    const b = searchBounds();
    const size = boundsSizeMeters(b);
    if (area === "screen" && (size.w > MAX_SIDE || size.h > MAX_SIDE)) {
      setPhase({ kind: "error", message: `지도를 조금 더 확대해 주세요. 한 번에 찾을 수 있는 영역은 ${MAX_SIDE / 1000}km × ${MAX_SIDE / 1000}km 이하예요.` });
      return;
    }
    if (size.w < MIN_SIDE || size.h < MIN_SIDE) {
      setPhase({ kind: "error", message: "영역이 너무 좁아요. 지도를 조금 축소해 주세요." });
      return;
    }
    let bbox: BBox = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
    const r = RANGES[range];
    if (shape === "custom" && !custom) {
      setPhase({ kind: "error", message: "찾고 싶은 그림을 먼저 그려 주세요." });
      return;
    }
    const discover = shape === "auto";
    const compareNearby = nearby && !(shape === "custom" && custom && custom.parts.length > 1);
    const id = ++reqId.current;
    setSelected(null);
    selectedRef.current = null;
    layers.current?.clearLayers();

    let texts: string[] | null = null;
    const previous = searchedBox.current;
    const prev = previous?.bbox;
    // App-driven zoom to a chosen route keeps the original search rectangle.
    const reuseRegion = (!!prev && !userMoved.current && previous?.area === area) || (!!prev && bbox.south >= prev.south && bbox.north <= prev.north && bbox.west >= prev.west && bbox.east <= prev.east);
    if (reuseRegion && prev) bbox = prev;
    const dataBox = compareNearby ? nearbyDataBox(bbox) : bbox;
    const key = `${dataBox.south},${dataBox.west},${dataBox.north},${dataBox.east}`;
    // A changed nearby option or data extent must refresh the worker's raw data cache.
    const within = reuseRegion && previous?.nearby === compareNearby && previous.fetchedKey === key;
    userMoved.current = false;
    fitTarget.current = null;
    if (!within) {
      setPhase({ kind: "fetching", done: 0, total: splitBBox(dataBox).length });
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        // 넓은 영역은 5km 칸으로 나눠 차례로 받는다
        texts = await fetchOverpassTiles(dataBox, ac.signal, (done, total) => {
          if (id === reqId.current) setPhase({ kind: "fetching", done, total });
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (id !== reqId.current) return;
        setPhase({
          kind: "error",
          message: String((e as Error)?.message) === "road_data_unavailable"
            ? "저장된 한국 길 데이터를 열지 못했어요. 서버의 데이터 설치 상태를 확인해 주세요."
            : String((e as Error)?.message) === "road_area_too_large"
              ? "길이 많은 지역이에요. 검색 범위를 줄여 주세요."
              : "지도 길 데이터를 받지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
        });
        return;
      }
      // 길 데이터를 받는 사이 다른 화면으로 이동했으면(지도 제거) 여기서 멈춘다
      if (!mapAlive(lm.map) || id !== reqId.current) return;
      searchedBox.current?.rect?.remove();
      const rect = lm.L.rectangle(lm.L.latLngBounds([bbox.south, bbox.west], [bbox.north, bbox.east]), { color: "#111318", weight: 1.5, opacity: 0.45, fill: false, dashArray: "4 6", interactive: false });
      searchedBox.current = { bbox, dataBox, nearby: compareNearby, rect, fetchedKey: key, area };
    }
    if (id !== reqId.current) return;
    setPhase({ kind: "searching", fraction: 0, label: "" });

    const w = workerRef.current;
    searchedGroup.current = shape === "custom" ? custom : null;
    const req: FinderRequest = {
      type: "find",
      reqId: id,
      texts,
      dataBox: searchedBox.current!.dataBox,
      region: searchedBox.current!.bbox,
      mode: discover ? "discover" : "shape",
      shape: shape !== "auto" && shape !== "custom" ? shape : undefined,
      custom: shape === "custom" ? custom! : undefined,
      minMeters: r.min,
      maxMeters: r.max,
      excludeSteps,
      detail,
      avoidUnpaved,
      avoidMajor,
      preferLit,
      branches: discover && branches,
      nearby: compareNearby,
    };
    w.onmessage = (ev: MessageEvent<FinderResponse>) => {
      const m = ev.data;
      if (m.reqId !== reqId.current) return;
      if (m.type === "progress") setPhase({ kind: "searching", fraction: m.fraction, label: m.label });
      else if (m.type === "error") {
        if (m.code === "no_cache") {
          searchedBox.current = null;
          void search();
        } else setPhase({ kind: "error", message: m.message });
      } else {
        roadsRef.current = m.roads;
        drawRoads();
        const templ = m.result.candidates;
        const finish = (cands: RouteCandidate[], doodleError = false) => {
          if (id !== reqId.current) return;
          setPhase({ kind: "done", candidates: cands, partial: m.result.partial, dataTimestamp: m.graph.dataTimestamp, nodes: m.graph.nodes, discover, doodleError });
          // 원래 영역·주변 비교 후보 모두 실제 경로 좌표에 맞춰 지도를 확대한다.
          if (cands[0]) choose(cands[0]);
        };
        if (!discover) return finish(templ);
        // Show connected routes immediately; server interpretation can finish in the background.
        finish(templ);
        setPhase(p => p.kind === "done" ? { ...p, naming:true } : p);
        void nameDiscoveries(templ, [...m.result.candidates, ...(m.result.pool ?? [])], recognizeCourses, 90_000).then((r) => {
          if(id !== reqId.current) return;
          const chosen=templ.find(c=>c.id===selectedRef.current);
          const candidates=chosen && !r.candidates.some(c=>c.id===chosen.id) ? [...r.candidates,chosen] : r.candidates;
          setPhase(p=>p.kind === "done" ? {...p,candidates,naming:false,doodleError:r.doodleError} : p);
          if(!selectedRef.current && candidates[0])choose(candidates[0]);
        });
      }
    };
    w.postMessage(req);
  }

  function choose(c: RouteCandidate) {
    setSelected(c.id);
    selectedRef.current = c.id;
    // 고른 코스의 고도 (코스 좌표를 고도 서버로 보내므로 고른 코스만)
    if (!elev[c.id]) {
      setElev((m) => ({ ...m, [c.id]: "loading" }));
      fetchElevation(c.latlngs)
        .then((p) => setElev((m) => ({ ...m, [c.id]: p })))
        .catch(() => setElev((m) => ({ ...m, [c.id]: "error" })));
    }
    if (lm) {
      const b = lm.L.latLngBounds(c.latlngs);
      fitTarget.current = b;
      userMoved.current = false;
      fitTo(b);
    }
  }

  /** 앱이 하는 지도 이동: 사용자 이동으로 세지 않는다 */
  function fitTo(b: Leaflet.LatLngBounds) {
    if (!lm) return;
    programmatic.current = true;
    lm.map.fitBounds(b, { paddingTopLeft: [24, 72], paddingBottomRight: [68, 56], maxZoom: 16 });
    window.setTimeout(() => (programmatic.current = false), 700);
  }

  function runThis(c: RouteCandidate, dataTimestamp: string | null) {
    savePlannedRoute({
      id: c.id,
      shapeId: c.shapeId,
      shapeName: c.shapeName,
      latlngs: c.latlngs,
      outline: c.outline,
      outlines: c.outlines,
      moves: c.moves,
      moveMeters: c.moveMeters,
      lengthMeters: c.lengthMeters,
      similarity: c.similarity,
      dataTimestamp,
    });
    router.push("/run");
  }

  function exportGpx(c: RouteCandidate) {
    const gpx = toGpx(`Yorun ${c.shapeName} 코스`, [c.latlngs.map(([lat, lon]) => ({ lat, lon }))]);
    downloadBlob(new Blob([gpx], { type: "application/gpx+xml" }), `yorun-${c.shapeId}-course.gpx`);
  }


  // 넓이 제한은 '지금 화면'으로 찾을 때만 (정사각형 영역을 고르면 지도가 그 영역을 보이려고 축소된다)
  const tooBig = area === "screen" && !!areaInfo && (areaInfo.w > MAX_SIDE || areaInfo.h > MAX_SIDE);
  const sel = visible.find((c) => c.id === selected);

  function goSettings() {
    setSheetFull(true);
    requestAnimationFrame(() => settingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const settingsPanel = (
    <FinderSettings
      ref={settingsRef}
      value={settings}
      onChange={(patch) => setSettings((v) => ({ ...v, ...patch }))}
      onChooseArea={chooseArea}
      progress={phase.kind === "fetching" || phase.kind === "searching" ? phase : null}
      ready={!!lm}
      tooBig={!!tooBig}
      hasResults={phase.kind === "done"}
      onSearch={() => void search()}
    />
  );

  return (
    <main className="finder">
      <div className="finder-layout">
        <div className="finder-map">
          <div ref={mapEl} className="map" role="application" aria-label="지도. 움직이거나 확대해 코스를 찾을 영역을 맞춰 주세요." />
          <div className="map-tl">
            <Link href="/" className="map-pill">
              <BrandMark size={24} />
              요런
            </Link>
            <Link href="/room" className="map-pill">
              작품방
            </Link>
            <PlaceSearch
              onPick={(p) => {
                if (!lm) return;
                userTookOver.current = true;
                userMoved.current = true;
                lm.map.setView([p.lat, p.lon], 15);
                placeMarker.current?.remove();
                placeMarker.current = lm.L.circleMarker([p.lat, p.lon], { radius: 9, color: "#fff", weight: 3, fillColor: "#E5484D", fillOpacity: 1 })
                  .bindTooltip(p.name, { permanent: true, direction: "top", offset: [0, -10] })
                  .addTo(lm.map);
              }}
            />
          </div>
          <div className="map-fabs">
            <button type="button" className="map-fab" onClick={() => locate(false)} aria-label="내 위치로 이동" title="내 위치로 이동">
              <Icon name="locate" size={22} />
            </button>
            <button
              type="button"
              className="map-fab"
              aria-label={basemap === "simple" ? "기본 지도로 바꾸기" : "단순 지도로 바꾸기"}
              title={basemap === "simple" ? "기본 지도로 보기" : "단순 지도로 보기"}
              onClick={() => setBasemapState((b) => (b === "simple" ? "standard" : "simple"))}
            >
              <Icon name="layers" size={22} />
            </button>
            <button
              type="button"
              className="map-fab"
              aria-pressed={showRoads}
              aria-label={showRoads ? "길 숨기기" : "탐색에 쓴 길 보기"}
              title={showRoads ? "길 숨기기" : "탐색에 쓴 길 보기"}
              onClick={() => setShowRoads((v) => !v)}
              disabled={!roadsRef.current}
            >
              <Icon name="roads" size={22} />
            </button>
          </div>
          <div className="map-badges">
            {basemapOk === false && <span className="badge badge-failed map-glass">바탕 지도 없음 · 코스 찾기는 돼요</span>}
            {areaInfo && (
              <span className={`badge map-glass ${tooBig ? "badge-failed" : ""} ${phase.kind === "done" && !tooBig ? "visually-hidden" : ""}`}>
                화면 영역 {(areaInfo.w / 1000).toFixed(1)}×{(areaInfo.h / 1000).toFixed(1)}km{tooBig ? " · 확대 필요" : ""}
              </span>
            )}
          </div>
        </div>

        <aside className={`finder-side ${sheetFull ? "sheet-full" : ""} ${phase.kind === "done" ? "has-results" : ""}`} aria-label="코스 찾기 설정과 결과">
          <button type="button" className="sheet-handle" aria-label={sheetFull ? "시트 접기" : "시트 펼치기"} aria-expanded={sheetFull} onClick={() => setSheetFull((v) => !v)} />
          <div className="sheet-scroll">
            {phase.kind === "error" && (
              <p className="banner banner-error" role="alert" style={{ margin: "0 0 16px" }}>
                <Icon name="warn" size={18} />
                {phase.message}
              </p>
            )}

            {phase.kind === "done" && (
              <section className="sheet-section" aria-label="찾은 코스">
                <div className="sheet-head">
                  <h2>찾은 코스 {visible.length}개</h2>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={goSettings}>
                    조건 바꾸기
                  </button>
                </div>
                {visible.length === 0 && phase.candidates.length > 0 && (
                  <p className="empty">유사도 {minSimilarity} 이상인 코스가 없어요. 조건에서 최소 유사도를 낮추면 숨긴 {phase.candidates.length}개를 볼 수 있어요.</p>
                )}
                {phase.candidates.length === 0 && (
                  <p className="empty">이 영역·거리 조건에서는 그림이 잘 나오는 연결 코스를 찾지 못했어요. 지도를 옮기거나 거리 범위·그림·길 단순화를 바꿔 보세요. (끊긴 곳을 가짜 선으로 잇지 않아요.)</p>
                )}
                <CourseList candidates={visible} selected={selected} discover={phase.discover} onChoose={choose} onHover={setHover} />
                {sel && <SelectedCourse c={sel} elev={elev[sel.id]} onRun={() => runThis(sel, phase.dataTimestamp)} onExport={() => exportGpx(sel)} />}
                {visible.length > 0 && visible[0].similarity < 65 && (
                  <p className="hint">그림이 또렷하지 않다면: 거리를 늘리면 그림이 커져 길 간격에 덜 뭉개지고, 바둑판처럼 반듯한 길이 많은 동네일수록 잘 나와요.</p>
                )}
                <p className="hint">
                  저장된 한국 지도 데이터 기준 {phase.dataTimestamp ? new Date(phase.dataTimestamp).toLocaleString("ko-KR") : "시각 미확인"} · OpenStreetMap. 실제 통행 가능 여부, 공사·임시 통제, 보도 유무, 야간 조명은 확인하지
                  않았어요. 현장 안전을 먼저 확인해 주세요.
                  {phase.partial && " 시간 제한으로 일부 조합만 탐색했어요."}
                  {phase.doodleError && " 모양 인식을 사용할 수 없어 도형과 닮은 코스만 보여 줘요."}
                  {phase.naming && " 코스는 먼저 보여 드리고, 어떤 모양처럼 보이는지 더 살펴보고 있어요."}
                  {phase.discover && !phase.naming && !phase.doodleError && " '처럼 보이는 코스'는 CLIP이 해석한 실험 추천이에요. 위치를 제외한 외곽선만 앱 서버에서 처리해요."}
                </p>
              </section>
            )}

            {settingsPanel}
          </div>
        </aside>
      </div>
    </main>
  );
}
