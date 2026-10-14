"use client";
// 달리기 (/run): 선택한 그림 코스를 GPS로 안내하고 기록한다. 기록은 이 기기 안에만 남는다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type * as Leaflet from "leaflet";
import { useLeafletMap } from "@/components/map/useLeafletMap";
import { buildArtwork } from "@/lib/art/artwork";
import { describeImportError } from "@/lib/gpx/errors";
import type { GpxTrack } from "@/lib/gpx/parser";
import { setPendingArtwork } from "@/lib/client/pending";
import { downloadBlob } from "@/lib/render/png";
import { Icon, PathThumb, latlngToXY, type IconName } from "@/components/Icon";
import { awardRun, loadActiveRun, loadPlannedRoute, loadWallet, plannedRouteBadge, saveActiveRun, type PlannedRoute } from "@/lib/run/storage";
import { DAILY_POINT_CAP, POINTS_PER_CHECKPOINT, cappedPoints, collectedCount, emptyRewards, isMissed, placeCheckpoints, stepRewards, type RewardState } from "@/lib/run/rewards";
import {
  RouteTracker,
  TURN_LABEL,
  addFix,
  elapsedMs,
  emptyRecord,
  formatDuration,
  formatPace,
  pause,
  startOrResume,
  toGpx,
  type RunRecord,
} from "@/lib/run/tracker";

type Status = "ready" | "running" | "paused" | "finished";

const OFF_ROUTE_M = 40;

export function RunApp() {
  const router = useRouter();
  const mapEl = useRef<HTMLDivElement>(null);
  // 회색 단순 지도: 분홍 코스가 햇빛 아래에서도 바로 보이게
  const { lm, basemapOk } = useLeafletMap(mapEl, { zoom: 16, basemap: "simple" });
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status>("ready");
  const [record, setRecord] = useState<RunRecord>(emptyRecord);
  const recordRef = useRef(record);
  const [now, setNow] = useState(() => Date.now());
  const [pos, setPos] = useState<{ lat: number; lon: number; accuracy: number } | null>(null);
  const [gpsState, setGpsState] = useState<"waiting" | "ok" | "weak" | "denied" | "unsupported">("waiting");
  const [guide, setGuide] = useState<ReturnType<RouteTracker["update"]> | null>(null);
  const [offStreak, setOffStreak] = useState(0);
  const [follow, setFollow] = useState(true);
  const [resumeOffer, setResumeOffer] = useState<RunRecord | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const isWide = useMediaQuery("(min-width: 861px)");
  // 시작할 때마다 새 추적기: 시작 전 위치가 진행률에 섞이지 않게 한다.
  const [trackerKey, setTrackerKey] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 달리기를 새로 시작할 때(trackerKey 증가) 추적기를 새로 만든다
  const tracker = useMemo(() => (route ? new RouteTracker(route.latlngs) : null), [route, trackerKey]);
  const layers = useRef<{ me?: Leaflet.CircleMarker; acc?: Leaflet.Circle; track?: Leaflet.Polyline; casing?: Leaflet.Polyline; guide?: Leaflet.Polyline } | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const lastSave = useRef(0);
  // 포인트: 코스 달리기는 그림 구간 100m마다 놓인 객체, 자유 달리기는 달린 거리 100m마다
  const checkpoints = useMemo(() => (route ? placeCheckpoints(route.latlngs, route.moves) : []), [route]);
  const checkpointsRef = useRef(checkpoints);
  const [rewards, setRewards] = useState<RewardState>(() => emptyRewards(0));
  const rewardsRef = useRef(rewards);
  const resumeRewards = useRef<RewardState | null>(null);
  const [todayPoints, setTodayPoints] = useState(0);
  const [award, setAward] = useState<{ points: number; collected: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);

  const setRec = useCallback((r: RunRecord) => {
    recordRef.current = r;
    setRecord(r);
  }, []);
  const setRew = useCallback((s: RewardState) => {
    rewardsRef.current = s;
    setRewards(s);
  }, []);
  useEffect(() => {
    checkpointsRef.current = checkpoints;
  }, [checkpoints]);

  // 코스·진행 중 기록 불러오기
  useEffect(() => {
    const r = loadPlannedRoute();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 전용 값(저장소·위치·로그인 세션)은 서버 렌더와 어긋나지 않게 첫 화면 뒤 효과에서 읽는다
    setRoute(r);
    const active = loadActiveRun();
    if (active && active.record.segments.length && (active.routeId === (r?.id ?? null))) {
      setResumeOffer({ ...active.record, resumedAt: null });
      resumeRewards.current = active.rewards ?? null;
    }
    setTodayPoints(loadWallet(Date.now()).dayPoints);
    setLoaded(true);
  }, []);

  // 지도에 코스 그리기
  useEffect(() => {
    if (!lm) return;
    const { L, map } = lm;
    const g = L.layerGroup().addTo(map);
    const round = { lineCap: "round", lineJoin: "round" } as const;
    let guideLine: Leaflet.Polyline | undefined;
    // 출발점은 내 위치 점보다 위에 그린다 (출발 전 내 위치가 출발점을 덮지 않게)
    const startPane = map.getPane("start") ? "start" : (map.createPane("start").style.zIndex = "460", "start");
    if (route) {
      L.polyline(route.latlngs, { ...round, color: "#fff", weight: 12, opacity: 0.6, interactive: false }).addTo(g);
      L.polyline(route.latlngs, { ...round, color: "#0EA5E9", weight: 8, opacity: 0.45, interactive: false }).addTo(g);
      // 여러 획 그림의 이동 구간: 그림이 아니라 다음 획으로 가는 길이라 회색 점선
      for (const [a, b] of route.moves ?? []) {
        const mv = route.latlngs.slice(a, b + 1);
        L.polyline(mv, { ...round, color: "#fff", weight: 9, opacity: 0.9, interactive: false }).addTo(g);
        L.polyline(mv, { ...round, color: "#646B78", weight: 4, dashArray: "2 9", opacity: 1, interactive: false }).addTo(g);
      }
      guideLine = L.polyline(route.outlines ?? route.outline, { ...round, color: "#2B2F38", weight: 2.5, dashArray: "1 8", opacity: 0, interactive: false }).addTo(g);
      L.circleMarker(route.latlngs[0], { radius: 12, color: "#fff", weight: 3, fillColor: "#12B76A", fillOpacity: 1, pane: startPane }).bindTooltip("출발·도착").addTo(g);
      map.invalidateSize({ pan: false });
      map.fitBounds(L.latLngBounds(route.latlngs), { paddingTopLeft: [24, 80], paddingBottomRight: [24, 48], animate: false });
    }
    const casing = L.polyline([], { ...round, color: "#fff", weight: 9, opacity: 0.9, interactive: false }).addTo(g);
    const track = L.polyline([], { ...round, color: "#075985", weight: 5, opacity: 1, interactive: false }).addTo(g);
    layers.current = { track, casing, guide: guideLine };
    map.on("dragstart", () => setFollow(false));
    return () => {
      map.off("dragstart");
      g.remove();
    };
  }, [lm, route]);

  // 포인트 객체: 주울 것(주황) · 주운 것(초록, 작게) · 지나쳐 놓친 것·오늘 한도를 넘은 것(회색)
  const cpMarkers = useRef<Leaflet.CircleMarker[]>([]);
  useEffect(() => {
    if (!lm) return;
    const g = lm.L.layerGroup().addTo(lm.map);
    cpMarkers.current = checkpoints.map((c, i) =>
      lm.L.circleMarker([c.lat, c.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#F59E0B", fillOpacity: 1 }).bindTooltip(`${(i + 1) * POINTS_PER_CHECKPOINT}m 지점 · ${POINTS_PER_CHECKPOINT}P`).addTo(g),
    );
    return () => {
      g.remove();
      cpMarkers.current = [];
    };
  }, [lm, checkpoints]);
  const capReached = cappedPoints(collectedCount(rewards), todayPoints) >= DAILY_POINT_CAP - todayPoints;
  useEffect(() => {
    cpMarkers.current.forEach((m, i) => {
      const got = rewards.got[i];
      const grey = !got && (isMissed(rewards, i) || capReached);
      m.setStyle({ radius: got ? 4 : 7, fillColor: got ? "#12B76A" : grey ? "#9CA3AF" : "#F59E0B", fillOpacity: got ? 0.8 : 1 });
    });
  }, [rewards, capReached, checkpoints]);

  // 목표 그림 밑그림은 출발 전에만 보여 준다 (달리는 중에는 달린 선과 경쟁하지 않게)
  useEffect(() => {
    layers.current?.guide?.setStyle({ opacity: status === "ready" ? 0.5 : 0 });
  }, [status, lm, route]);

  // 위치 추적 (화면이 켜져 있는 동안. 웹 앱은 백그라운드 위치 기록이 제한된다)
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 전용 값(저장소·위치·로그인 세션)은 서버 렌더와 어긋나지 않게 첫 화면 뒤 효과에서 읽는다
      setGpsState("unsupported");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, time: p.timestamp || Date.now() };
        setPos(fix);
        setGpsState(fix.accuracy <= 35 ? "ok" : "weak");
        const before = recordRef.current;
        const res = addFix(before, fix);
        if (!res.accepted) return;
        setRec(res.record);
        const seg = res.record.segments[res.record.segments.length - 1];
        setRew(stepRewards(rewardsRef.current, checkpointsRef.current, fix, res.record.distanceMeters - before.distanceMeters, seg.length === 1).state);
      },
      (e) => setGpsState(e.code === e.PERMISSION_DENIED ? "denied" : "weak"),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [setRec, setRew]);

  // 안내 갱신
  useEffect(() => {
    if (!pos || !tracker || status === "ready") return;
    const g = tracker.update(pos.lat, pos.lon);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 새 GPS 위치(외부 입력)가 올 때마다 추적기를 한 번 갱신한 결과다. 추적기는 상태를 가지므로 렌더 중 계산할 수 없다
    setGuide(g);
    if (status === "running") {
      setOffStreak((s) => {
        const n = g.offRouteMeters > OFF_ROUTE_M ? s + 1 : 0;
        if (n === 3) navigator.vibrate?.([200, 100, 200]);
        return n;
      });
    }
  }, [pos, tracker, status]);

  // 지도 표시 갱신
  useEffect(() => {
    if (!lm || !layers.current) return;
    const { L, map } = lm;
    if (pos) {
      const ll: [number, number] = [pos.lat, pos.lon];
      if (!layers.current.me) {
        layers.current.acc = L.circle(ll, { radius: pos.accuracy, color: "#1A73E8", weight: 0, fillOpacity: 0.1, interactive: false }).addTo(map);
        layers.current.me = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#1A73E8", fillOpacity: 1 }).addTo(map);
      } else {
        layers.current.me.setLatLng(ll);
        layers.current.acc?.setLatLng(ll).setRadius(pos.accuracy);
      }
      if (follow && status === "running") {
        // 모바일은 위쪽 방향 카드(약 100px)를 피해, 보이는 지도 한가운데에 내 위치가 오게 중심을 조금 위로 둔다
        const z = map.getZoom();
        map.panTo(isWide ? ll : map.unproject(map.project(ll, z).subtract(L.point(0, 50)), z), { animate: true });
      }
    }
    const lines = record.segments.map((s) => s.map((p) => [p.lat, p.lon] as [number, number]));
    layers.current.casing?.setLatLngs(lines);
    layers.current.track?.setLatLngs(lines);
  }, [lm, pos, record, follow, status, isWide]);

  // 시계 + 기기 보관 (5초마다)
  useEffect(() => {
    if (status !== "running") return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - lastSave.current > 5000) {
        lastSave.current = Date.now();
        saveActiveRun({ routeId: route?.id ?? null, record: recordRef.current, rewards: rewardsRef.current, savedAt: Date.now() });
      }
    }, 1000);
    return () => clearInterval(t);
  }, [status, route]);

  // 화면 꺼짐 방지
  useEffect(() => {
    if (status !== "running") {
      void wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
      return;
    }
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const req = () => void nav.wakeLock?.request("screen").then((l) => (wakeLock.current = l)).catch(() => undefined);
    req();
    // 다른 앱에 다녀오면 브라우저가 잠금을 풀어 버리므로, 화면이 다시 보일 때 다시 요청한다
    const onVis = () => document.visibilityState === "visible" && req();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [status]);

  function start() {
    if (status === "ready") {
      setTrackerKey((k) => k + 1);
      setGuide(null);
      const saved = resumeOffer ? resumeRewards.current : null;
      setRew(saved && saved.got.length === checkpoints.length ? saved : emptyRewards(checkpoints.length));
      resumeRewards.current = null;
    }
    setRec(startOrResume(resumeOffer ?? recordRef.current, Date.now()));
    setResumeOffer(null);
    setStatus("running");
    setFollow(true);
    setNow(Date.now());
  }
  function doPause() {
    const r = pause(recordRef.current, Date.now());
    setRec(r);
    saveActiveRun({ routeId: route?.id ?? null, record: r, rewards: rewardsRef.current, savedAt: Date.now() });
    setStatus("paused");
  }
  function finish() {
    const r = pause(recordRef.current, Date.now());
    setRec(r);
    const collected = collectedCount(rewardsRef.current);
    const { points, wallet } = awardRun(r.startedAt ?? Date.now(), collected, Date.now());
    setAward({ points, collected });
    setTodayPoints(wallet.dayPoints);
    saveActiveRun(null);
    setStatus("finished");
  }
  function discard() {
    saveActiveRun(null);
    setRec(emptyRecord());
    setRew(emptyRewards(checkpoints.length));
    resumeRewards.current = null;
    setAward(null);
    setResumeOffer(null);
    setGuide(null);
    setStatus("ready");
  }

  function toArtworkRoom() {
    const segs = record.segments.filter((s) => s.length > 0);
    const track: GpxTrack = { index: 0, name: null, segments: segs.map((s) => s.map((p) => ({ lat: p.lat, lon: p.lon }))), pointCount: segs.reduce((a, s) => a + s.length, 0) };
    try {
      const d = new Date(record.startedAt ?? Date.now());
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const { view } = buildArtwork(track, { title: route ? `${route.shapeName} 러닝` : "나의 러닝 그림", recordedDate: date });
      setPendingArtwork(view);
      router.push("/room");
    } catch (e) {
      setMessage(describeImportError(e).title);
    }
  }

  function exportRecord() {
    const gpx = toGpx(route ? `Yorun ${route.shapeName} 러닝 기록` : "Yorun 러닝 기록", record.segments);
    downloadBlob(new Blob([gpx], { type: "application/gpx+xml" }), "yorun-run.gpx");
  }

  const elapsed = elapsedMs(record, now);
  const startDist = pos && tracker ? tracker.distanceToStart(pos.lat, pos.lon) : null;
  const offRoute = status === "running" && offStreak >= 3;
  const pct = guide && tracker ? Math.min(100, Math.round((guide.progressMeters / tracker.total) * 100)) : 0;
  const active = status === "running" || status === "paused";
  const tooShort = record.segments.every((s) => s.length < 2);

  // ── 스크린리더 안내: 보이는 숫자는 계속 바뀌므로 aria-live를 달지 않고, 의미 있는 순간에만 따로 알린다.
  const [sayPolite, setSayPolite] = useState("");
  const [sayAlert, setSayAlert] = useState("");
  const lastKm = useRef(0);
  const lastTurn = useRef<{ key: string; stage: number } | null>(null);
  const wasOff = useRef(false);
  const lastStatus = useRef<Status>(status);
  const lastGps = useRef(gpsState);
  // 같은 문장을 다시 넣어도 낭독되도록 한 번 비웠다가 넣는다
  const announce = useCallback((set: (v: string) => void, text: string) => {
    set("");
    requestAnimationFrame(() => set(text));
  }, []);

  useEffect(() => {
    const km = Math.floor(record.distanceMeters / 1000);
    if (status === "running" && km > lastKm.current) announce(setSayPolite, `${km}킬로미터, ${formatDuration(elapsed)}`);
    lastKm.current = km;
  }, [record.distanceMeters, status, elapsed, announce]);

  // 객체를 주울 때: 진동 + "+100P" 표시 + 낭독
  const collected = collectedCount(rewards);
  const livePoints = cappedPoints(collected, todayPoints);
  const lastCollected = useRef(collected);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const prev = lastCollected.current;
    lastCollected.current = collected;
    if (status !== "running" || collected <= prev) return;
    const gained = livePoints - cappedPoints(prev, todayPoints);
    navigator.vibrate?.(80);
    const text = gained > 0 ? `+${gained}P` : "오늘 적립 완료";
    setToast({ text, key: collected });
    announce(setSayPolite, gained > 0 ? `${gained}포인트 획득, 이번 달리기 ${livePoints}포인트` : `오늘 적립 한도 ${DAILY_POINT_CAP}포인트를 채웠어요`);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, [collected, livePoints, todayPoints, status, announce]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = status;
    if (prev === status) return;
    if (status === "paused") announce(setSayPolite, "일시정지했어요");
    else if (status === "running" && prev === "paused") announce(setSayPolite, "다시 시작했어요");
    else if (status === "running") announce(setSayPolite, "달리기를 시작했어요");
  }, [status, announce]);

  useEffect(() => {
    if (status !== "running" || !guide?.nextTurn || offRoute) return;
    const t = guide.nextTurn;
    const key = `${t.dir}@${Math.round(t.atMeters)}`; // 코스 위 회전 지점의 절대 위치: GPS 흔들림에 바뀌지 않는다
    const stage = t.inMeters <= 50 ? 2 : t.inMeters <= 200 ? 1 : 0;
    const prev = lastTurn.current;
    if (!prev || prev.key !== key || stage > prev.stage) {
      announce(setSayAlert, `${Math.max(0, Math.round(t.inMeters / 10) * 10)}미터 앞 ${TURN_LABEL[t.dir]}`);
      lastTurn.current = { key, stage };
    }
  }, [guide, status, offRoute, announce]);

  useEffect(() => {
    if (offRoute && !wasOff.current) announce(setSayAlert, `코스에서 ${Math.round(guide?.offRouteMeters ?? 0)}미터 벗어났어요. 코스 쪽으로 돌아가 주세요.`);
    else if (!offRoute && wasOff.current && status === "running") announce(setSayAlert, "코스로 돌아왔어요");
    wasOff.current = offRoute;
  }, [offRoute, guide, status, announce]);

  useEffect(() => {
    if (lastGps.current === gpsState) return;
    lastGps.current = gpsState;
    if (gpsState === "ok") announce(setSayPolite, "GPS 신호가 양호해요");
    else if (gpsState === "weak") announce(setSayPolite, "GPS 신호가 약해요");
  }, [gpsState, announce]);

  if (!loaded) return <main className="run-page"><p role="status" style={{ padding: 24 }}>불러오는 중…</p></main>;

  const gpsLabel =
    gpsState === "ok" ? `GPS 양호 ±${Math.round(pos!.accuracy)}m` : gpsState === "weak" ? "GPS 약함" : gpsState === "denied" ? "GPS 권한 없음" : gpsState === "unsupported" ? "GPS 지원 안 됨" : "GPS 찾는 중";
  const gpsTone = gpsState === "ok" ? "ok" : gpsState === "waiting" ? "" : gpsState === "weak" ? "weak" : "bad";

  // 지도 위 안내 카드: 오류 > 이탈 경고 > 방향 안내 (같은 자리에서 바뀌어 아래 요소가 밀리지 않게)
  let topCard: React.ReactNode = null;
  if (gpsState === "denied") {
    topCard = (
      <div className="turn-card alert-error" role="alert">
        <span className="turn-icon"><Icon name="warn" size={34} /></span>
        <span className="turn-text"><span>위치 권한이 없어 기록할 수 없어요. 브라우저 설정에서 이 사이트의 위치 권한을 허용해 주세요.</span></span>
      </div>
    );
  } else if (message) {
    topCard = (
      <div className="turn-card alert-error" role="alert">
        <span className="turn-icon"><Icon name="warn" size={34} /></span>
        <span className="turn-text"><span>{message}</span></span>
      </div>
    );
  } else if (offRoute) {
    topCard = (
      <div className="turn-card alert-warn">
        <span className="turn-icon"><Icon name="warn" size={36} /></span>
        <span className="turn-text">
          <span>코스에서 {Math.round(guide!.offRouteMeters)}m 벗어났어요</span>
          <small>분홍 코스 쪽으로 돌아가 주세요</small>
        </span>
      </div>
    );
  } else if (route && status === "running" && guide) {
    const t = guide.nextTurn;
    const icon: IconName = guide.nearEnd || !t ? "flag" : t.dir === "left" ? "turnLeft" : t.dir === "right" ? "turnRight" : "uturn";
    topCard = (
      <p className="turn-card next-turn">
        <span className="turn-icon"><Icon name={icon} size={40} strokeWidth={2.4} /></span>
        <span className="turn-text">
          {guide.nearEnd ? (
            <span>거의 다 왔어요! 출발점이 도착점이에요.</span>
          ) : t ? (
            <>
              <strong>{Math.max(0, Math.round(t.inMeters / 10) * 10)}m</strong> <span>앞 {TURN_LABEL[t.dir]}</span>
            </>
          ) : (
            <>
              <span>남은 거리</span> <strong>{(guide.remainingMeters / 1000).toFixed(2)}km</strong>
            </>
          )}
        </span>
      </p>
    );
  }

  return (
    <main className={`run-page ${status === "paused" ? "hud-paused" : ""}`}>
      <p className="visually-hidden" aria-live="polite">
        {sayPolite}
      </p>
      <p className="visually-hidden" role="alert">
        {sayAlert}
      </p>
      <div className="run-map">
        <div ref={mapEl} className="map" role="application" aria-label="달리기 지도" />
        <div className="run-top">
          <div className="run-top-row">
            {!active && (
              <Link href="/routes" className="map-fab" aria-label="코스 찾기" title="코스 찾기">
                <Icon name="back" size={22} />
              </Link>
            )}
            {!(active && gpsState === "ok") && (
              <span className={`badge gps-badge ${gpsTone}`}>
                {gpsLabel}
              </span>
            )}
            {basemapOk === false && <span className="badge badge-failed map-glass">바탕 지도를 불러오지 못했어요 · 안내·기록은 돼요</span>}
          </div>
          {!isWide && topCard}
        </div>
        {toast && (
          <span key={toast.key} className="point-toast" aria-hidden="true">
            {toast.text}
          </span>
        )}
        {!follow && status === "running" && (
          <button type="button" className="btn map-recenter" onClick={() => setFollow(true)}>
            <Icon name="locate" size={20} />
            내 위치 따라가기
          </button>
        )}
      </div>

      <section className="hud-sheet" aria-label="달리기 기록">
        {isWide && topCard}
        {active ? (
          <>
            <div className="hud-hero">
              <div className="hud-hero-row">
                <span className="hud-label">거리</span>
                <span className="hud-hero-side">
                  <span className="hud-points" data-stat="points" title={`오늘 ${(todayPoints + livePoints).toLocaleString()} / ${DAILY_POINT_CAP.toLocaleString()}P`}>
                    {livePoints.toLocaleString()}P
                  </span>
                  {status === "paused" && <span className="badge pause-badge">일시정지됨</span>}
                  {gpsState === "ok" && <span className="hud-gps">{gpsLabel}</span>}
                </span>
              </div>
              <div className="hud-big" data-stat="distance">
                {(record.distanceMeters / 1000).toFixed(2)}
                <span className="unit">km</span>
              </div>
            </div>
            {route && (
              <div className="hud-progress" role="progressbar" aria-label="코스 진행" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <i style={{ width: `${pct}%` }} />
              </div>
            )}
            <div className="hud-grid">
              <div className="hud-stat">
                <span className="hud-label">시간</span>
                <strong data-stat="time">{formatDuration(elapsed)}</strong>
              </div>
              <div className="hud-stat">
                <span className="hud-label">평균 페이스</span>
                <strong data-stat="pace">{formatPace(elapsed, record.distanceMeters)}</strong>
              </div>
              <div className="hud-stat">
                <span className="hud-label">{route ? "코스 진행" : "구간"}</span>
                <strong data-stat="progress">
                  {route ? (
                    <>
                      {pct}
                      <span className="unit">%</span>
                    </>
                  ) : (
                    record.segments.length
                  )}
                </strong>
              </div>
            </div>
            <div className="run-btns">
              {status === "running" ? (
                <button type="button" className="btn btn-run hold" onClick={doPause}>
                  <Icon name="pause" size={24} />
                  일시정지
                </button>
              ) : (
                <button type="button" className="btn btn-run go" onClick={start}>
                  <Icon name="play" size={24} />
                  다시 시작
                </button>
              )}
              <button type="button" className="btn btn-run end" onClick={finish}>
                <Icon name="stop" size={22} />
                종료
              </button>
            </div>
          </>
        ) : (
          <>
            {route ? (
              <div className="route-info">
                <span className="route-thumb">
                  <PathThumb lines={[latlngToXY(route.latlngs)]} size={48} pad={4} width={3} stroke="#38BDF8" />
                </span>
                <div>
                  <span className="hud-label">그림 코스</span>
                  <h2>{route.shapeName}</h2>
                  <p>
                    {route.shapeName} 코스 · {(route.lengthMeters / 1000).toFixed(2)}km · {plannedRouteBadge(route)}
                    {startDist !== null && ` · 출발점까지 ${startDist < 1000 ? `${Math.round(startDist)}m` : `${(startDist / 1000).toFixed(1)}km`}`}
                  </p>
                  <p>
                    포인트 객체 {checkpoints.length}개 · 최대 {(checkpoints.length * POINTS_PER_CHECKPOINT).toLocaleString()}P
                    {todayPoints > 0 && ` · 오늘 적립 ${todayPoints.toLocaleString()} / ${DAILY_POINT_CAP.toLocaleString()}P`}
                  </p>
                  {route.moves?.length ? (
                    <p>
                      획 {route.moves.length + 1}개 · 점선 이동 구간 {((route.moveMeters ?? 0) / 1000).toFixed(1)}km는 그림이 아니에요. 한 획을 다 그리면 일시정지하고 다음 획
                      출발점까지 이동한 뒤 다시 시작하세요.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="route-info">
                <span className="route-thumb">
                  <Icon name="run" size={28} />
                </span>
                <div>
                  <h2>자유 달리기</h2>
                  <p>
                    선택한 그림 코스가 없어요. <Link href="/routes">코스를 먼저 찾거나</Link>, 코스 없이 달려 그림을 그릴 수도 있어요.
                  </p>
                  <p>
                    100m 달릴 때마다 {POINTS_PER_CHECKPOINT}P · 하루 최대 {DAILY_POINT_CAP.toLocaleString()}P
                    {todayPoints > 0 && ` (오늘 ${todayPoints.toLocaleString()}P 적립)`}
                  </p>
                </div>
              </div>
            )}
            {resumeOffer ? (
              <div className="resume">
                <p>이 기기에 끝내지 않은 달리기({(resumeOffer.distanceMeters / 1000).toFixed(2)}km)가 있어요.</p>
                <button type="button" className="btn btn-run go" onClick={start}>
                  <Icon name="play" size={24} />
                  이어 달리기
                </button>
                <button type="button" className="btn btn-link" onClick={discard}>
                  버리기
                </button>
              </div>
            ) : (
              <div className="run-btns single">
                <button type="button" className="btn btn-run go" onClick={start} disabled={gpsState === "denied" || gpsState === "unsupported"}>
                  <Icon name="play" size={24} />
                  시작
                </button>
              </div>
            )}
            <details className="run-note">
              <summary>
                <Icon name="info" size={16} />
                달리는 동안 화면을 켜 두세요
                <Icon name="chevronDown" size={14} />
              </summary>
              <p>웹 앱은 화면이 꺼지거나 다른 앱으로 전환하면 위치 기록이 멈출 수 있어요. 달리는 동안 화면 꺼짐을 막아 두지만, 잠금 버튼을 누르면 기록이 멈춰요. 기록은 이 기기에만 저장돼요.</p>
            </details>
          </>
        )}
      </section>

      {status === "finished" && (
        <div className="done-page" style={{ position: "fixed", inset: 0, zIndex: 1000, overflowY: "auto" }}>
          <div className="done-wrap">
            <div>
              <p className="done-date">{formatDate(record.startedAt)}</p>
              <div className="done-title">
                <h2>달리기 완료</h2>
                {route && pct >= 90 && <span className="badge volt">그림 완성</span>}
              </div>
            </div>
            <div className="done-art" role="img" aria-label={tooShort ? "기록된 선이 없어요" : "달린 선 미리보기"}>
              {tooShort ? <p>기록된 선이 없어요</p> : <RunPreview segments={record.segments} outline={route?.latlngs ?? null} />}
            </div>
            <div>
              <span className="hud-label">거리</span>
              <div className="done-big">
                {(record.distanceMeters / 1000).toFixed(2)}
                <span className="unit">km</span>
              </div>
            </div>
            <div className="done-stats">
              <div className="hud-stat">
                <span className="hud-label">시간</span>
                <strong>{formatDuration(record.activeMs)}</strong>
              </div>
              <div className="hud-stat">
                <span className="hud-label">평균 페이스</span>
                <strong>{formatPace(record.activeMs, record.distanceMeters)}</strong>
              </div>
              {route && (
                <div className="hud-stat">
                  <span className="hud-label">코스 진행</span>
                  <strong>{pct}%</strong>
                </div>
              )}
            </div>
            {route && (
              <div className="hud-progress">
                <i style={{ width: `${pct}%` }} />
              </div>
            )}
            {award && (
              <div className="done-points">
                <span className="hud-label">적립 포인트</span>
                <strong data-stat="award">+{award.points.toLocaleString()}P</strong>
                <p>
                  {route ? `포인트 객체 ${award.collected}/${checkpoints.length}개` : `${award.collected * 100}m 적립`}
                  {award.points < award.collected * POINTS_PER_CHECKPOINT && ` · 하루 최대 ${DAILY_POINT_CAP.toLocaleString()}P까지만 적립돼요`}
                  {` · 오늘 ${todayPoints.toLocaleString()}P`}
                </p>
              </div>
            )}
            <div className="done-actions">
              {tooShort && (
                <p className="done-reason">
                  <Icon name="info" size={16} />
                  기록된 선이 너무 짧아 작품을 만들 수 없어요. GPS가 잡힌 상태로 조금 더 달려 주세요.
                </p>
              )}
              <button type="button" className="btn btn-primary btn-lg" onClick={toArtworkRoom} disabled={tooShort}>
                <Icon name="frame" size={20} />
                달린 그림을 작품방에 걸기
              </button>
              <div className="row">
                <button type="button" className="btn btn-dark2" onClick={exportRecord} disabled={record.segments.every((s) => s.length === 0)}>
                  <Icon name="download" size={18} />
                  GPX로 저장
                </button>
                <button type="button" className="btn btn-dark2" onClick={discard}>
                  새로 달리기
                </button>
              </div>
              <p className="done-note">작품은 실제로 달린 GPS 선 그대로 만들어요. 계획 코스로 빈 곳을 메우지 않아요.</p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function formatDate(t: number | null) {
  const d = new Date(t ?? Date.now());
  return d.toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** 완료 화면: 계획 코스(옅게) 위에 실제로 달린 선(진하게) */
function RunPreview({ segments, outline }: { segments: { lat: number; lon: number }[][]; outline: [number, number][] | null }) {
  const segs = segments.filter((s) => s.length > 1).map((s) => s.map((p) => [p.lat, p.lon] as [number, number]));
  const all = [...segs.flat(), ...(outline ?? [])];
  const k = Math.cos((all[0][0] * Math.PI) / 180);
  const xs = all.map((p) => p[1] * k), ys = all.map((p) => p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.max(maxX - minX, maxY - minY) || 1;
  const S = 100;
  const ox = (S - ((maxX - minX) / s) * S) / 2, oy = (S - ((maxY - minY) / s) * S) / 2;
  const d = (line: [number, number][]) => line.map(([lat, lon], i) => `${i ? "L" : "M"}${(ox + ((lon * k - minX) / s) * S).toFixed(2)} ${(oy + ((maxY - lat) / s) * S).toFixed(2)}`).join("");
  return (
    <svg viewBox="-4 -4 108 108" aria-hidden="true">
      {outline && <path d={d(outline)} fill="none" stroke="#0A72D6" strokeOpacity={0.18} strokeWidth={3.2} strokeLinejoin="round" strokeLinecap="round" />}
      {segs.map((l, i) => (
        <path key={i} className="run-line" pathLength={1} d={d(l)} fill="none" stroke="#075985" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
      ))}
    </svg>
  );
}

function useMediaQuery(q: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return match;
}
