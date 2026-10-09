"use client";
// 드로잉 루트 찾기 (/routes): 지금 지도에 보이는 영역의 실제 길에서 한붓 그림 코스를 찾는다.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type * as Leaflet from "leaflet";
import { boundsSizeMeters, mapAlive, setBasemap, useLeafletMap, type Basemap } from "@/components/map/useLeafletMap";
import type { RouteCandidate } from "@/lib/route/fit";
import type { FinderRequest, FinderResponse } from "@/lib/route/finder.worker";
import { fetchOverpassTiles, splitBBox, type BBox, type RoadDetail } from "@/lib/route/osm";
import { fetchElevation, type ElevationProfile } from "@/lib/route/elevation";
import { overlap } from "@/lib/route/discover";
import { recognizeCourses, type Recognized } from "@/lib/art/recognize";
import { doodleKo } from "@/lib/art/doodleNames";
import { SHAPES, groupLines, type ShapeGroup, type ShapeId } from "@/lib/route/shapes";
import { CustomShapeInput } from "@/components/route/CustomShapeInput";
import { savePlannedRoute } from "@/lib/run/storage";
import { toGpx } from "@/lib/run/tracker";
import { downloadBlob } from "@/lib/render/png";
import { BrandMark, Icon, PathThumb, latlngToXY } from "@/components/Icon";

const RANGES = [
  { label: "2~5km", min: 2000, max: 5000 },
  { label: "3~8km", min: 3000, max: 8000 },
  { label: "5~12km", min: 5000, max: 12000 },
  { label: "8~16km", min: 8000, max: 16000 },
] as const;

const DETAILS: Array<{ id: RoadDetail; label: string; hint: string }> = [
  { id: "simple", label: "큰길 위주", hint: "골목·보도·진입로를 빼고 이어진 길만 써서 선이 깔끔해요 (추천)" },
  { id: "normal", label: "보통", hint: "생활도로까지 쓰되 도로 옆 보도·횡단보도·진입로는 빼요" },
  { id: "detailed", label: "상세", hint: "모든 보행로를 써요. 그림은 촘촘하지만 삐죽해질 수 있어요" },
];

const MAX_SIDE = 9000;
/** 찾을 영역: 지금 화면, 또는 지도 가운데를 중심으로 한 정사각형 (한 변 km) */
const AREAS = [
  { id: "screen", label: "지금 화면", km: 0 },
  { id: "2", label: "2km", km: 2 },
  { id: "5", label: "5km", km: 5 },
  { id: "10", label: "10km", km: 10 },
  { id: "15", label: "15km", km: 15 },
] as const;
type AreaId = (typeof AREAS)[number]["id"];
const ROUTE_COLOR = "#0EA5E9";
const MIN_SIDE = 500;

type Phase =
  | { kind: "idle" }
  | { kind: "fetching"; done: number; total: number }
  | { kind: "searching"; fraction: number; label: string }
  | { kind: "done"; candidates: RouteCandidate[]; partial: boolean; dataTimestamp: string | null; nodes: number; discover: boolean; doodleError?: boolean }
  | { kind: "error"; message: string };

export function RouteFinderApp() {
  const router = useRouter();
  const mapEl = useRef<HTMLDivElement>(null);
  const { lm, basemapOk, setBasemapOk } = useLeafletMap(mapEl);
  /** auto: 동네 고리 코스 추천, ShapeId: 기본 그림, custom: 직접 그린 그림 */
  const [shape, setShape] = useState<ShapeId | "auto" | "custom">("auto");
  const [custom, setCustom] = useState<ShapeGroup | null>(null);
  const [area, setArea] = useState<AreaId>("screen");
  const areaRef = useRef<AreaId>("screen");
  const areaRect = useRef<Leaflet.Rectangle | null>(null);
  const [avoidUnpaved, setAvoidUnpaved] = useState(false);
  const [avoidMajor, setAvoidMajor] = useState(false);
  const [preferLit, setPreferLit] = useState(false);
  const [elev, setElev] = useState<Record<string, ElevationProfile | "loading" | "error">>({});
  const [range, setRange] = useState(1);
  const [excludeSteps, setExcludeSteps] = useState(true);
  const [detail, setDetail] = useState<RoadDetail>("simple");
  const [basemap, setBasemapState] = useState<Basemap>("simple");
  const [showRoads, setShowRoads] = useState(false);
  const roadsRef = useRef<number[] | null>(null);
  const roadLayer = useRef<Leaflet.Polyline | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [areaInfo, setAreaInfo] = useState<{ w: number; h: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const showRoadsRef = useRef(false);
  const reqId = useRef(0);
  const layers = useRef<Leaflet.LayerGroup | null>(null);
  const searchedBox = useRef<{ bbox: BBox; rect: Leaflet.Rectangle | null; fetchedKey: string; area: AreaId } | null>(null);
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
    if (phase.kind === "done") draw(phase.candidates, selected, hover);
  }, [phase, selected, hover, draw]);

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
    setArea(id);
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
    const bbox: BBox = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
    const r = RANGES[range];
    if (shape === "custom" && !custom) {
      setPhase({ kind: "error", message: "찾고 싶은 그림을 먼저 그려 주세요." });
      return;
    }
    const discover = shape === "auto";
    const id = ++reqId.current;
    setSelected(null);
    layers.current?.clearLayers();

    const key = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
    let texts: string[] | null = null;
    // 지금 화면이 이미 길 데이터를 받은 영역 안이면 다시 받지 않고 그 영역 전체에서 찾는다.
    const prev = searchedBox.current?.bbox;
    // 탐색 뒤 사용자가 지도를 움직이지 않았다면(앱이 코스로 확대만 했다면) 같은 영역으로 본다.
    // 찾을 영역 설정을 바꿨다면 지도를 안 움직였어도 다른 영역이다.
    const within = (!!prev && !userMoved.current && searchedBox.current?.area === area) || (!!prev && bbox.south >= prev.south && bbox.north <= prev.north && bbox.west >= prev.west && bbox.east <= prev.east);
    userMoved.current = false;
    fitTarget.current = null;
    if (!within) {
      setPhase({ kind: "fetching", done: 0, total: splitBBox(bbox).length });
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        // 넓은 영역은 5km 칸으로 나눠 차례로 받는다
        texts = await fetchOverpassTiles(bbox, ac.signal, (done, total) => {
          if (id === reqId.current) setPhase({ kind: "fetching", done, total });
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setPhase({
          kind: "error",
          message: /busy/.test(String((e as Error)?.message))
            ? "지도 데이터 서버가 바빠요. 잠시 뒤 다시 시도해 주세요."
            : "지도 길 데이터를 받지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.",
        });
        return;
      }
      // 길 데이터를 받는 사이 다른 화면으로 이동했으면(지도 제거) 여기서 멈춘다
      if (!mapAlive(lm.map) || id !== reqId.current) return;
      searchedBox.current?.rect?.remove();
      const rect = lm.L.rectangle(b, { color: "#111318", weight: 1.5, opacity: 0.45, fill: false, dashArray: "4 6", interactive: false });
      searchedBox.current = { bbox, rect, fetchedKey: key, area };
    }
    if (id !== reqId.current) return;
    setPhase({ kind: "searching", fraction: 0, label: "" });

    const w = workerRef.current;
    const req: FinderRequest = {
      type: "find",
      reqId: id,
      texts,
      dataBox: searchedBox.current!.bbox,
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
        const templ = m.result.candidates.filter((c) => c.similarity >= 50);
        const finish = (cands: RouteCandidate[], doodleError = false) => {
          if (id !== reqId.current) return;
          setPhase({ kind: "done", candidates: cands, partial: m.result.partial, dataTimestamp: m.graph.dataTimestamp, nodes: m.graph.nodes, discover, doodleError });
          // 첫 코스를 골라 그 코스로 확대한다. 확대는 탐색 영역 안쪽이라 같은 영역 재탐색 때 데이터를 그대로 재사용한다.
          if (cands[0]) choose(cands[0]);
        };
        if (!discover) return finish(templ);
        // 동네 추천: 낙서 인식 모델이 '무엇처럼 보이는지' 이름을 붙인 코스를 앞에, 도형과 닮은 코스를 뒤에
        setPhase({ kind: "searching", fraction: 0.97, label: "낙서 인식" });
        const pool = [...m.result.candidates, ...(m.result.pool ?? [])];
        // 그래픽 가속이 없는 기기에선 판정이 매우 느릴 수 있어 20초가 넘으면 도형 결과만 보여 준다
        Promise.race([recognizeCourses(pool), new Promise<never>((_, fail) => window.setTimeout(() => fail(new Error("doodle_timeout")), 20_000))])
          .then((rec) => {
            const named = pickDoodles(pool, rec);
            finish([...named, ...templ.filter((c) => !named.some((d) => overlap(c, d)))]);
          })
          .catch(() => finish(templ, true));
      }
    };
    w.postMessage(req);
  }

  function choose(c: RouteCandidate) {
    setSelected(c.id);
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


  const tooBig = areaInfo && (areaInfo.w > MAX_SIDE || areaInfo.h > MAX_SIDE);
  const busy = phase.kind === "fetching" || phase.kind === "searching";
  const sel = phase.kind === "done" ? phase.candidates.find((c) => c.id === selected) : undefined;

  function goSettings() {
    setSheetFull(true);
    requestAnimationFrame(() => settingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const settings = (
    <section className="sheet-section" ref={settingsRef} aria-labelledby="settings-title">
      <h2 id="settings-title">어떤 그림을 달릴까요?</h2>
      <div className="shape-rail" role="radiogroup" aria-label="그림 모양">
        <button
          type="button"
          role="radio"
          aria-checked={shape === "auto"}
          aria-label="동네 길로 만들 수 있는 코스 추천"
          className="shape-tile shape-tile-wide"
          onClick={() => setShape("auto")}
        >
          <span className="tick"><Icon name="check" size={12} strokeWidth={3} /></span>
          <Icon name="sparkle" size={30} strokeWidth={1.8} />
          동네 추천
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={shape === "custom"}
          aria-label="찾고 싶은 그림 직접 그리기"
          className="shape-tile shape-tile-wide"
          onClick={() => setShape("custom")}
        >
          <span className="tick"><Icon name="check" size={12} strokeWidth={3} /></span>
          {custom ? <PathThumb lines={groupLines(custom)} size={36} pad={3} width={2.5} /> : <Icon name="pencil" size={30} strokeWidth={1.8} />}
          내 그림
        </button>
        {SHAPES.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={shape === s.id} aria-label={s.name} className="shape-tile" onClick={() => setShape(s.id as ShapeId)}>
            <span className="tick"><Icon name="check" size={12} strokeWidth={3} /></span>
            <PathThumb lines={[s.points]} size={36} pad={3} width={2.5} />
            {s.name}
          </button>
        ))}
      </div>
      {shape === "auto" && <p className="hint">동네 길로 자연스럽게 이어지는 고리 코스를 먼저 찾고, 도형·동물·사물 {SHAPES.length}가지 중 어떤 그림과 닮았는지 알려 줘요. 같은 길을 되밟지 않아요.</p>}
      {shape === "custom" && <CustomShapeInput value={custom} onChange={setCustom} />}

      <fieldset className="seg-field">
        <legend>찾을 영역</legend>
        <div className="seg" role="radiogroup" aria-label="찾을 영역">
          {AREAS.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={area === a.id} aria-label={a.km ? `지도 가운데 ${a.label} 사방` : a.label} className={`seg-btn ${area === a.id ? "seg-on" : ""}`} onClick={() => chooseArea(a.id)}>
              {a.label}
            </button>
          ))}
        </div>
        <p className="hint">
          {area === "screen"
            ? `지금 보이는 지도에서 찾아요 (최대 ${MAX_SIDE / 1000}km × ${MAX_SIDE / 1000}km).`
            : `지도 가운데를 중심으로 ${AREAS.find((a) => a.id === area)!.label} × ${AREAS.find((a) => a.id === area)!.label} 사각형에서 찾아요. 넓을수록 길 데이터를 여러 번 나눠 받고 탐색도 오래 걸려요.`}
        </p>
      </fieldset>

      <fieldset className="seg-field">
        <legend>코스 거리 (km)</legend>
        <div className="seg" role="radiogroup" aria-label="코스 거리">
          {RANGES.map((r, i) => (
            <button key={r.label} type="button" role="radio" aria-checked={range === i} aria-label={r.label} className={`seg-btn ${range === i ? "seg-on" : ""}`} onClick={() => setRange(i)}>
              {r.label.replace("~", "–").replace("km", "")}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="seg-field">
        <legend>길 단순화</legend>
        <div className="seg" role="radiogroup" aria-label="길 단순화">
          {DETAILS.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={detail === d.id} className={`seg-btn ${detail === d.id ? "seg-on" : ""}`} onClick={() => setDetail(d.id)}>
              {d.label}
            </button>
          ))}
        </div>
        <p className="hint">{DETAILS.find((d) => d.id === detail)!.hint}</p>
      </fieldset>

      <label className="toggle-row">
        계단 제외
        <input type="checkbox" role="switch" className="switch" checked={excludeSteps} onChange={(e) => setExcludeSteps(e.target.checked)} />
      </label>
      <label className="toggle-row">
        비포장 길 빼기 (흙·자갈)
        <input type="checkbox" role="switch" className="switch" checked={avoidUnpaved} onChange={(e) => setAvoidUnpaved(e.target.checked)} />
      </label>
      <label className="toggle-row">
        큰 차도 피하기
        <input type="checkbox" role="switch" className="switch" checked={avoidMajor} onChange={(e) => setAvoidMajor(e.target.checked)} />
      </label>
      <label className="toggle-row">
        가로등 있는 길 우선
        <input type="checkbox" role="switch" className="switch" checked={preferLit} onChange={(e) => setPreferLit(e.target.checked)} />
      </label>
      <p className="hint">길 조건은 OpenStreetMap에 기록된 정보만 써요. 가로등·노면 정보가 없는 길이 많아 참고용이에요.</p>

      <div className="sheet-cta">
        {busy ? (
          <div className="progress-cta" role="status">
            <span>
              {phase.kind === "fetching"
                ? `지도 길 데이터를 받는 중…${phase.total > 1 ? ` (${Math.min(phase.done + 1, phase.total)}/${phase.total})` : ""}`
                : `그림 맞춰 보는 중${phase.label ? ` · ${phase.label}` : ""}`}
            </span>
            {phase.kind === "searching" && <span className="num">{Math.round(phase.fraction * 100)}%</span>}
            <i
              className={`progress-bar ${phase.kind === "fetching" ? "progress-indeterminate" : ""}`}
              style={phase.kind === "searching" ? { width: `${Math.round(phase.fraction * 100)}%` } : undefined}
            />
          </div>
        ) : (
          <button type="button" className={`btn btn-lg ${phase.kind === "done" ? "btn-ink" : "btn-primary"}`} onClick={() => void search()} disabled={!lm || !!tooBig || (shape === "custom" && !custom)}>
            지금 보이는 지도에서 코스 찾기
          </button>
        )}
        {tooBig && !busy && <p className="hint center">지도를 조금 더 확대해 주세요 (최대 {MAX_SIDE / 1000}km × {MAX_SIDE / 1000}km)</p>}
      </div>
      <p className="hint sheet-foot">지도 영역(좌표 범위)이 길 데이터를 받기 위해 OpenStreetMap 데이터 서버로 전송돼요. 내 정확한 위치는 보내지 않아요.</p>
    </section>
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
                  <h2>찾은 코스 {phase.candidates.length}개</h2>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={goSettings}>
                    조건 바꾸기
                  </button>
                </div>
                {phase.candidates.length === 0 && (
                  <p className="empty">이 영역·거리 조건에서는 그림이 잘 나오는 연결 코스를 찾지 못했어요. 지도를 옮기거나 거리 범위·그림·길 단순화를 바꿔 보세요. (끊긴 곳을 가짜 선으로 잇지 않아요.)</p>
                )}
                <ul className="cands">
                  {phase.candidates.map((c) => (
                    <li key={c.id}>
                      <button type="button" className={`cand ${c.id === selected ? "cand-on" : ""}`} aria-pressed={c.id === selected} onClick={() => choose(c)} onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)}>
                        <span className="cand-thumb">
                          <PathThumb lines={[latlngToXY(c.latlngs)]} size={56} pad={5} width={3} stroke="#0EA5E9" />
                        </span>
                        <span className="cand-body">
                          <span className="cand-top">
                            <span className="cand-title">{c.doodle ? `${c.shapeName}처럼 보이는 코스` : phase.discover ? `${c.shapeName} 닮은 코스` : c.shapeName}</span>
                            <span className={`cand-sim ${c.doodle ? "cand-ai" : ""}`}>{c.doodle ? `인식 ${c.similarity}%` : `유사도 ${c.similarity}`}</span>
                          </span>
                          <span className="cand-meta">
                            <span className="num">{(c.lengthMeters / 1000).toFixed(2)}</span>
                            <span className="unit">km</span>
                            <span>· 약 {Math.round((c.lengthMeters / 1000) * 6.5)}분</span>
                            {c.repeatRatio > 0.02 ? <span>· 같은 길 반복 {Math.round(c.repeatRatio * 100)}%</span> : null}
                            {c.moves?.length ? <span>· 이동 {(c.moveMeters / 1000).toFixed(1)}km</span> : null}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {sel && (
                  <>
                    <p className="sel-desc">
                      <strong>
                        {sel.shapeName} 코스 · {(sel.lengthMeters / 1000).toFixed(2)}km
                      </strong>{" "}
                      —{" "}
                      {sel.moves?.length
                        ? `획 ${sel.moves.length + 1}개를 차례로 그려요. 획 사이 점선 ${(sel.moveMeters / 1000).toFixed(1)}km는 이동 구간이라 기록을 멈추고 이동하면 돼요.`
                        : "초록 점에서 출발해 같은 곳으로 돌아오는 한붓 코스예요."}{" "}
                      {sel.doodle
                        ? `낙서 인식 모델(Quick, Draw! 345가지)이 이 코스 모양을 '${sel.shapeName}'(으)로 봤어요 (확신 ${sel.similarity}%). 사람 눈에는 다르게 보일 수 있어요.`
                        : `원래 그림에서 평균 ${sel.meanDeviationMeters}m, 최대 ${sel.maxDeviationMeters}m 벗어나요.`}
                    </p>
                    <RoadInfo c={sel} elev={elev[sel.id]} />
                    <div className="sel-legend" aria-hidden="true">
                      <span>
                        <i />달릴 길
                      </span>
                      {sel.outlines?.length !== 0 && (
                        <span>
                          <i className="lg-guide" />원래 그림
                        </span>
                      )}
                      <span>
                        <i className="lg-start" />출발·도착
                      </span>
                      {sel.moves?.length ? (
                        <span>
                          <i className="lg-move" />이동 구간
                        </span>
                      ) : null}
                    </div>
                    <div className="sheet-cta sheet-cta-split">
                      <button type="button" className="btn btn-primary btn-lg" onClick={() => runThis(sel, phase.dataTimestamp)}>
                        <Icon name="play" size={18} />
                        이 코스로 달리기
                      </button>
                      <button type="button" className="btn btn-secondary btn-lg btn-square" onClick={() => exportGpx(sel)} aria-label="GPX 내보내기 (시계용)" title="GPX 내보내기 (시계용)">
                        <Icon name="download" size={24} />
                      </button>
                    </div>
                  </>
                )}
                {phase.candidates.length > 0 && phase.candidates[0].similarity < 65 && (
                  <p className="hint">그림이 또렷하지 않다면: 거리를 늘리면 그림이 커져 길 간격에 덜 뭉개지고, 바둑판처럼 반듯한 길이 많은 동네일수록 잘 나와요.</p>
                )}
                <p className="hint">
                  지도 데이터 기준 {phase.dataTimestamp ? new Date(phase.dataTimestamp).toLocaleString("ko-KR") : "시각 미확인"} · OpenStreetMap. 실제 통행 가능 여부, 공사·임시 통제, 보도 유무, 야간 조명은 확인하지
                  않았어요. 현장 안전을 먼저 확인해 주세요.
                  {phase.partial && " 시간 제한으로 일부 조합만 탐색했어요."}
                  {phase.doodleError && " 낙서 인식 모델을 불러오지 못해 도형과 닮은 코스만 보여 줘요."}
                  {phase.discover && !phase.doodleError && " '처럼 보이는 코스'는 DoodleNet(ml5.js, Quick, Draw! 데이터)이 기기 안에서 판정했어요."}
                </p>
              </section>
            )}

            {settings}
          </div>
        </aside>
      </div>
    </main>
  );
}

/** 코스 중 이동 구간들의 좌표 */
function moveLines(c: { latlngs: [number, number][]; moves?: Array<[number, number]> }): [number, number][][] {
  return (c.moves ?? []).map(([a, b]) => c.latlngs.slice(a, b + 1));
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 고른 코스의 길 성격과 고도 */
function RoadInfo({ c, elev }: { c: RouteCandidate; elev: ElevationProfile | "loading" | "error" | undefined }) {
  const r = c.roadInfo;
  return (
    <div className="road-info">
      <ul className="road-facts" aria-label="코스 길 정보">
        <li>
          <span>큰 차도</span>
          <b className="num">{pct(r.major)}</b>
        </li>
        <li>
          <span>비포장</span>
          <b className="num">{pct(r.unpaved)}</b>
        </li>
        <li>
          <span>가로등</span>
          <b className="num">{r.lit === null ? "정보 없음" : pct(r.lit)}</b>
        </li>
        <li>
          <span>계단</span>
          <b className="num">{r.steps ? `${r.steps}곳` : "없음"}</b>
        </li>
        <li>
          <span>오르막</span>
          <b className="num">{elev === "loading" || elev === undefined ? "…" : elev === "error" ? "확인 못 함" : `${elev.ascent}m`}</b>
        </li>
      </ul>
      {elev && elev !== "loading" && elev !== "error" && <ElevationChart p={elev} />}
      <p className="hint">
        길 정보는 OpenStreetMap 기록 기준이에요{r.lit !== null ? ` (가로등은 정보가 있는 ${pct(r.litKnown)} 구간 기준)` : ""}. 고도는 코스 좌표를 Open-Meteo 고도
        서버로 보내 약 90m 간격 지형 자료로 계산한 값이라 다리·고가·터널은 반영되지 않아요.
      </p>
    </div>
  );
}

function ElevationChart({ p }: { p: ElevationProfile }) {
  const W = 300, H = 56;
  const span = Math.max(10, p.max - p.min);
  const total = p.dist[p.dist.length - 1] || 1;
  const pts = p.elev.map((e, i) => `${((p.dist[i] / total) * W).toFixed(1)},${(H - 4 - ((e - p.min) / span) * (H - 12)).toFixed(1)}`);
  return (
    <figure className="elev-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`고도 ${Math.round(p.min)}m부터 ${Math.round(p.max)}m, 오르막 합계 ${p.ascent}m`}>
        <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} className="elev-fill" />
        <polyline points={pts.join(" ")} className="elev-line" />
      </svg>
      <figcaption>
        <span className="num">{Math.round(p.min)}m</span> ~ <span className="num">{Math.round(p.max)}m</span>
      </figcaption>
    </figure>
  );
}

/** 낙서 인식이 이 정도 이상 확신해야 '○○처럼 보이는 코스'로 보여 준다 */
const DOODLE_MIN = 0.35;

/** 인식 결과 → 보여 줄 코스: 확신 높은 순, 같은 자리·같은 이름은 2개까지, 최대 8개 */
function pickDoodles(pool: RouteCandidate[], rec: Array<Recognized | null>): RouteCandidate[] {
  const ranked = pool
    .map((c, i) => ({ c, r: rec[i] }))
    .filter((x): x is { c: RouteCandidate; r: Recognized } => !!x.r && x.r.prob >= DOODLE_MIN)
    .sort((a, b) => b.r.prob - a.r.prob);
  const out: RouteCandidate[] = [];
  const perName = new Map<string, number>();
  for (const { c, r } of ranked) {
    if (out.length >= 8) break;
    if ((perName.get(r.name) ?? 0) >= 2 || out.some((d) => overlap(c, d))) continue;
    perName.set(r.name, (perName.get(r.name) ?? 0) + 1);
    out.push({
      ...c,
      id: `dd-${c.id}`,
      shapeId: "doodle",
      shapeName: doodleKo(r.name),
      // 모델이 본 이름은 처음 맞춰 본 그림과 다를 수 있으므로 그 그림 외곽선은 보여 주지 않는다
      outline: [],
      outlines: [],
      similarity: Math.round(r.prob * 100),
      doodle: { name: r.name, prob: r.prob },
    });
  }
  return out;
}
