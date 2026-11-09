"use client";
// 메인·콘텐츠 탭의 기록 요약. 이 기기에 저장된 값만 읽고, 없으면 지어내지 않고 비어 있다고 보여 준다.

import { useEffect, useState } from "react";
import { formatPaceShort, summarizeMonth, summarizeWeek, type RunLogEntry } from "@/lib/run/history";
import { loadRunLog, loadWallet } from "@/lib/run/storage";
import { SHOW_POINTS } from "@/lib/run/rewards";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

/** 서버 렌더와 어긋나지 않게 첫 화면 뒤에 기기 저장값을 읽는다 */
function useRunLog() {
  const [state, setState] = useState<{ entries: RunLogEntry[]; now: number } | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 전용 값(저장소)은 첫 화면 뒤에 읽는다
    setState({ entries: loadRunLog(), now: Date.now() });
  }, []);
  return state;
}

export function MonthPanel() {
  const log = useRunLog();
  const month = summarizeMonth(log?.entries ?? [], log?.now ?? 0);
  const previous = month.previousKm;
  return (
    <section className="stat-panel" aria-label="이번 달 러닝">
      <div className="stat-panel-top">
        <h2>이번 달 러닝</h2>
        {log && <span>{month.label}</span>}
      </div>
      <p className="stat-panel-main">
        <b className="num">{month.km.toFixed(1)}</b> <span className="stat-unit">km</span>
        {log && previous !== null && (
          <span className="stat-compare">
            지난달 {previous.toFixed(1)}km
          </span>
        )}
      </p>
      <dl className="stat-panel-row">
        <div>
          <dt>러닝 횟수</dt>
          <dd><b className="num">{month.runs}</b> 회</dd>
        </div>
        <div>
          <dt>평균 페이스</dt>
          <dd><b className="num">{formatPaceShort(month.paceSecPerKm)}</b>{month.paceSecPerKm !== null && " /km"}</dd>
        </div>
        <div>
          <dt>그림 코스</dt>
          <dd><b className="num">{month.onCourseRuns}</b> 회</dd>
        </div>
      </dl>
    </section>
  );
}

export function WeekChart() {
  const log = useRunLog();
  const week = summarizeWeek(log?.entries ?? [], log?.now ?? 0);
  const peak = Math.max(...week.days, 0);
  const spoken = WEEKDAYS.map((d, i) => `${d} ${week.days[i].toFixed(1)}km`).join(", ");
  return (
    <div className="week-chart">
      <p className="week-total"><b className="num">{week.km.toFixed(1)}</b> km</p>
      <ol className="week-bars" role="img" aria-label={`요일별 거리: ${spoken}`}>
        {week.days.map((km, i) => (
          <li key={WEEKDAYS[i]} className={log && i === week.today ? "is-today" : undefined}>
            <span className="week-bar-track">
              <i className={km > 0 ? "has-run" : undefined} style={km > 0 ? { height: `${Math.max(14, (km / peak) * 100)}%` } : undefined} />
            </span>
            <span className="week-day">{WEEKDAYS[i]}</span>
          </li>
        ))}
      </ol>
      {log && week.km === 0 && <p className="week-empty">이번 주 첫 달리기를 기다리고 있어요.</p>}
    </div>
  );
}

export function PointsRow() {
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 전용 값(저장소)은 첫 화면 뒤에 읽는다
    setBalance(loadWallet(Date.now()).balance);
  }, []);
  if (!SHOW_POINTS) return null;
  return (
    <p className="points-row">
      <span>모은 포인트</span>
      <b className="num">{balance === null ? "–" : `${balance.toLocaleString("ko-KR")}P`}</b>
    </p>
  );
}
