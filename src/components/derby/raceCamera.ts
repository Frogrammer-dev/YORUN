// 8인 경기 자동 중계의 컷 편집. 어떤 샷을 언제 쓸지와 샷별 카메라 위치만 계산한다 (three.js를 쓰지 않는 순수 함수).
// 선수가 얇은 종이라 정면에서는 선으로 보인다. 그래서 정면 로우앵글은 약 40도 비껴 사선으로 잡는다.

import { TRACK, outwardAt, trackPoint } from "@/lib/battle/stadiumTrack";

export type Shot = "start" | "chase" | "tele" | "closeup" | "low" | "flank" | "finish" | "follow" | "overview";
export type Subject = "leader" | "mine" | "pack";
export interface Cut {
  /** 값이 바뀌면 카메라를 그대로 옮기는 컷 전환이 일어난다 */
  id: string;
  shot: Shot;
  subject: Subject;
  /** 샷 안에서 흐른 정도 (0~1) */
  progress: number;
}

const SECTIONS = 12, LAPS = 3, SECTION_METERS = 100;
/** 한 샷은 2~3초다. 순위를 보여 주는 샷과 표정을 보여 주는 샷을 번갈아 둔다 */
export const DIRECTOR_PLAN: readonly { shot: Shot; subject: Subject; ms: number }[] = [
  { shot: "chase", subject: "leader", ms: 2800 },
  { shot: "tele", subject: "pack", ms: 2600 },
  { shot: "closeup", subject: "mine", ms: 2000 },
  { shot: "low", subject: "leader", ms: 2400 },
  { shot: "flank", subject: "mine", ms: 2600 },
  { shot: "closeup", subject: "leader", ms: 2000 },
  { shot: "tele", subject: "pack", ms: 2400 },
  { shot: "low", subject: "mine", ms: 2400 },
  { shot: "flank", subject: "leader", ms: 2600 },
];
const PLAN_MS = DIRECTOR_PLAN.reduce((sum, item) => sum + item.ms, 0);
const START_UNTIL = 0.7, FINAL_FROM = 11, FINISH_FROM = 11.7;

export const OVERVIEW_CUT: Cut = { id: "overview", shot: "overview", subject: "leader", progress: 0 };
export const FOLLOW_CUT: Cut = { id: "follow", shot: "follow", subject: "mine", progress: 0 };

/** elapsedMs는 첫 선수가 움직인 뒤 흐른 시간, leaderProgress는 선두의 진행 구간(0~12)이다 */
export function directorCut(elapsedMs: number, leaderProgress: number): Cut {
  if (leaderProgress < START_UNTIL) return { id: "start", shot: "start", subject: "leader", progress: 0 };
  // 결승선에서만 카메라를 세워 선수가 화면을 가로지르게 한다
  if (leaderProgress >= FINISH_FROM) return { id: "finish", shot: "finish", subject: "leader", progress: 0 };
  // 마지막 직전에는 선두가 카메라로 밀고 들어오는 로우앵글로 긴장을 올린다
  if (leaderProgress >= FINAL_FROM) return { id: "final", shot: "low", subject: "leader", progress: (leaderProgress - FINAL_FROM) / (FINISH_FROM - FINAL_FROM) };
  const cycle = Math.floor(elapsedMs / PLAN_MS);
  let left = elapsedMs - cycle * PLAN_MS;
  for (let i = 0; i < DIRECTOR_PLAN.length; i++) {
    const item = DIRECTOR_PLAN[i];
    if (left < item.ms) return { id: `${cycle}-${i}`, shot: item.shot, subject: item.subject, progress: left / item.ms };
    left -= item.ms;
  }
  return { id: "start", shot: "start", subject: "leader", progress: 0 };
}

const lanePoint = (lane: number, progress: number) => trackPoint((progress / SECTIONS) * LAPS, TRACK.radius + (lane - 0.5) * TRACK.laneWidth);

export interface ShotTarget {
  lane: number;
  progress: number;
  /** 선수 그림 크기 (샷의 거리를 정한다) */
  size: number;
  /** 눈 위치: 달리는 방향으로 떨어진 거리와 땅에서의 높이 (그림 크기 대비) */
  eye: { along: number; height: number };
}
export interface ShotFrame {
  position: [number, number, number];
  look: [number, number, number];
  fov: number;
}

/** 샷과 대상을 받아 이번 프레임의 카메라를 돌려준다. 대상 위치에 그대로 묶어 선수와 같은 속도로 움직인다 */
export function shotFrame(cut: Cut, target: ShotTarget): ShotFrame {
  const { lane, progress, size, eye } = target;
  const p = lanePoint(lane, progress);
  const ahead = lanePoint(lane, progress + 0.02);
  const length = Math.hypot(ahead.x - p.x, ahead.z - p.z) || 1;
  const d = { x: (ahead.x - p.x) / length, z: (ahead.z - p.z) / length };
  const out = outwardAt(p.x, p.z);
  const from = (x: number, z: number, along: number, outward: number) => [x + d.x * along + out.x * outward, z + d.z * along + out.z * outward] as const;
  const middle = TRACK.radius + (TRACK.lanes * TRACK.laneWidth) / 2;

  switch (cut.shot) {
    case "start":
      // 출발선을 비스듬히 앞에서 본다. 정면으로 보면 여덟 레인이 한 줄로 겹친다
      return { position: [p.x + 17, 8, middle - 21], look: [p.x, 3, middle], fov: 46 };
    case "finish": {
      const finishX = -TRACK.straight / 2;
      return { position: [finishX + 12, 6, TRACK.radius - 16], look: [finishX, 3, TRACK.radius + 6], fov: 46 };
    }
    case "overview":
      return { position: [0, 62, 92], look: [0, 0, 0], fov: 46 };
    case "tele": {
      // 망원 측면: 안쪽에서 길게 당겨 무리의 간격과 순위를 한눈에 보여 준다
      const [x, z] = from(p.x, p.z, 0, -34);
      return { position: [x, 6, z], look: [p.x, 2.6, p.z], fov: 26 };
    }
    case "closeup": {
      // 눈높이에서 표정을 본다. 바깥 레인은 앞을 가리는 선수가 적도록 바깥쪽에서 잡되 관중석에 닿지 않게 한다
      const outward = lane > TRACK.lanes / 2 ? 4.4 : -size * 0.72;
      const [x, z] = from(p.x, p.z, (eye.along + 0.08) * size, outward);
      const [lookX, lookZ] = from(p.x, p.z, eye.along * size, 0);
      return { position: [x, eye.height * size - 0.2, z], look: [lookX, eye.height * size, lookZ], fov: 40 };
    }
    case "low": {
      // 사선 로우앵글: 카메라가 선수보다 천천히 달려 선수가 화면 앞으로 밀고 들어온다
      const gap = 16 - cut.progress * 9;
      const front = lanePoint(lane, progress + gap / SECTION_METERS);
      const frontOut = outwardAt(front.x, front.z);
      return { position: [front.x - frontOut.x * gap * 0.82, 0.8, front.z - frontOut.z * gap * 0.82], look: [p.x, size * 0.42, p.z], fov: 58 };
    }
    case "flank": {
      const [x, z] = from(p.x, p.z, 3, -13);
      return { position: [x, 3, z], look: [p.x, 2.8, p.z], fov: 42 };
    }
    case "chase":
    case "follow": {
      // 뒤쪽 사선에서 따라간다. 레인이 화면을 대각선으로 지나가 달리는 방향이 잘 보인다
      const [x, z] = from(p.x, p.z, -9, -9);
      const [lookX, lookZ] = from(p.x, p.z, 3, 0);
      return { position: [x, 3.6, z], look: [lookX, 2.6, lookZ], fov: 50 };
    }
  }
}
