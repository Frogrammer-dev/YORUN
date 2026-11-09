"use client";
// 홈·달리기 탭의 달리기 입구. 이 기기에 저장된 값(고른 코스·진행 중 기록)만 읽는다.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon, PathThumb, latlngToXY } from "./Icon";
import { loadActiveRun, loadPlannedRoute, type ActiveRun, type PlannedRoute } from "@/lib/run/storage";

/** /run이 실제로 이어 달리기나 결과 화면을 보여 줄 기록만 고른다 (RunApp의 불러오기 조건과 같다) */
function resumable(active: ActiveRun | null, route: PlannedRoute | null): ActiveRun | null {
  if (!active?.record.segments.length) return null;
  return active.finished || active.routeId === (route?.id ?? null) ? active : null;
}

export function ResumeBanner() {
  const [active, setActive] = useState<ActiveRun | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 전용 값(저장소)은 서버 렌더와 어긋나지 않게 첫 화면 뒤 효과에서 읽는다
    setActive(resumable(loadActiveRun(), loadPlannedRoute()));
  }, []);
  if (!active) return null;
  const km = (active.record.distanceMeters / 1000).toFixed(2);
  return (
    <Link href="/run" className="hub-resume">
      <span className="hub-row-icon">
        <Icon name="play" size={24} />
      </span>
      <span className="hub-row-body">
        <strong>{active.finished ? "달리기 결과 보기" : "이어 달리기"}</strong>
        <span>{active.finished ? `${km}km, 아직 작품방에 걸지 않았어요` : `끝내지 않은 달리기 ${km}km`}</span>
      </span>
      <Icon name="chevronRight" size={20} />
    </Link>
  );
}

/** /run은 고른 코스가 저장돼 있으면 그 코스를 불러온다. 입구 문구도 실제로 열릴 화면과 맞춘다. */
export function RunEntry() {
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 전용 값(저장소)은 서버 렌더와 어긋나지 않게 첫 화면 뒤 효과에서 읽는다
    setRoute(loadPlannedRoute());
  }, []);
  return (
    <Link href="/run" className="hub-row">
      <span className="hub-row-icon">
        {route ? <PathThumb lines={[latlngToXY(route.latlngs)]} size={40} pad={3} width={2.5} /> : <Icon name="run" size={24} />}
      </span>
      <span className="hub-row-body">
        <strong>{route ? "고른 코스로 달리기" : "코스 없이 달리기"}</strong>
        <span>{route ? `${route.shapeName} ${(route.lengthMeters / 1000).toFixed(2)}km` : "달린 선이 그대로 그림이 돼요"}</span>
      </span>
      <Icon name="chevronRight" size={20} />
    </Link>
  );
}
