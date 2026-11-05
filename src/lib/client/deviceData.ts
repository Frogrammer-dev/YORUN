"use client";
// 이 기기에 남은 달리기·코스·작품 임시 데이터를 지운다. 음성·지도 표시 같은 설정은 위치 정보가 아니라서 남긴다.

import { loadActiveRun } from "@/lib/run/storage";

const KEYS = ["runcanvas.route", "runcanvas.activeRun", "runcanvas.runLog", "runcanvas.points", "yorun.lastDerbyTrace", "yorun.booth.v1"];
const PREFIXES = ["yorun.battle."];
const DATABASES = ["runcanvas", "yorun-roadmaps"];

/** 끝내지 않은 달리기가 있으면 먼저 끝내야 한다 (달리는 중인 기록이 사라지지 않게) */
export function hasRunInProgress(): boolean {
  const active = loadActiveRun();
  return !!active && !active.finished && active.record.resumedAt !== null;
}

function deleteDatabase(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(true);
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    // 다른 화면이 열어 둔 연결이 닫히면 브라우저가 이어서 지운다
    request.onblocked = () => resolve(true);
  });
}

/** 반환: 모두 지웠는가. 실패해도 지울 수 있는 것은 끝까지 지운다 */
export async function clearDeviceData(): Promise<boolean> {
  let done = true;
  try {
    for (const key of Object.keys(localStorage)) {
      if (KEYS.includes(key) || PREFIXES.some((prefix) => key.startsWith(prefix))) localStorage.removeItem(key);
    }
  } catch {
    done = false;
  }
  const results = await Promise.all(DATABASES.map(deleteDatabase));
  return done && results.every(Boolean);
}
