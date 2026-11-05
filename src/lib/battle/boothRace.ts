// 8인 경기 계산. 가상 달리기 캐릭터의 능력치는 서버가 만들고, 실제 더비 기록과 섞지 않는다.

import { STYLE_BODIES, type BodyPlan } from "./bodyPlan";
import { DERBY_MAX_RUNNERS, DERBY_SECTIONS, DERBY_SECTION_M, simulateDerby, type DerbyStats, type SectionKind } from "./derby";
import { seededRandom } from "./seed";

export const BOOTH_STYLES = {
  speed: { label: "속도형", hint: "직선에서 빠르고 코너에서 느려요.", pace: [300, 340], cornering: [0.62, 0.74] },
  balance: { label: "균형형", hint: "직선과 코너 모두 무난해요.", pace: [330, 365], cornering: [0.72, 0.84] },
  corner: { label: "코너형", hint: "코너에서 빠르고 스퍼트가 자주 나와요.", pace: [360, 395], cornering: [0.84, 0.96] },
} as const;
export type BoothStyle = keyof typeof BOOTH_STYLES;
export const BOOTH_STYLE_IDS = Object.keys(BOOTH_STYLES) as BoothStyle[];

/** 대기 시간이 끝나면 빈 자리를 채우는 봇. 사람이 아님을 이름에 밝힌다 */
const BOT_NAMES = ["봇 번개", "봇 파도", "봇 바람", "봇 구름", "봇 달빛", "봇 별똥", "봇 새벽", "봇 노을"];

const within = ([low, high]: readonly [number, number], roll: number) => low + (high - low) * roll;

/** roll은 0 이상 1 미만의 난수를 돌려준다 */
export function boothStats(style: BoothStyle, roll: () => number): DerbyStats {
  const { pace, cornering } = BOOTH_STYLES[style];
  return { avgPaceSecPerKm: Math.round(within(pace, roll())), cornering: Number(within(cornering, roll()).toFixed(2)), corners: [], paceSplits: [] };
}

export interface BoothSeat { lane: number; name: string; stats: DerbyStats; mine?: boolean; body?: BodyPlan }
export interface BoothPlacing { rank: number; lane: number; name: string; seconds: number; practice: boolean; mine: boolean; splits: number[]; body: BodyPlan }
export interface BoothRaceReplay {
  placings: BoothPlacing[];
  sections: SectionKind[];
  /** 코너 뒤 스퍼트가 나온 구간과 레인 */
  spurts: { section: number; lane: number }[];
  distanceM: number;
}

/** 빈 레인을 봇으로 채워 결과를 낸다. 같은 경기는 어느 서버에서 계산해도 결과가 같다. */
export function boothRaceResult(raceId: string, seats: readonly BoothSeat[]): BoothRaceReplay {
  const taken = new Set(seats.map((seat) => seat.lane));
  const practice: BoothSeat[] = [];
  for (let lane = 1; lane <= DERBY_MAX_RUNNERS; lane++) {
    if (taken.has(lane)) continue;
    const random = seededRandom(`booth-practice:${raceId}:${lane}`);
    const style = BOOTH_STYLE_IDS[Math.floor(random() * BOOTH_STYLE_IDS.length)];
    practice.push({ lane, name: BOT_NAMES[lane - 1], stats: boothStats(style, random), body: STYLE_BODIES[style] });
  }
  const field = [...seats, ...practice];
  const race = simulateDerby(field.map((seat) => ({ id: String(seat.lane), stats: seat.stats })), `booth:${raceId}`);
  return {
    placings: race.entries.map((entry) => {
      const seat = field.find((candidate) => String(candidate.lane) === entry.id)!;
      return {
        rank: entry.rank, lane: seat.lane, name: seat.name,
        seconds: Math.round(entry.finishSeconds * 10) / 10,
        practice: !taken.has(seat.lane), mine: !!seat.mine,
        splits: entry.splits.map((t) => Math.round(t * 100) / 100),
        body: seat.body ?? "biped",
      };
    }),
    sections: race.sections,
    spurts: race.events.map((event) => ({ section: event.section, lane: Number(event.runner) })),
    distanceM: DERBY_SECTIONS * DERBY_SECTION_M,
  };
}

/** 매칭 마감까지 남은 초. 남은 시간이 조금이라도 있으면 올림해 0은 정말 끝났을 때만 나온다 */
export const countdownSeconds = (deadline: number, now: number) => Math.max(0, Math.ceil((deadline - now) / 1000));

/** 새 서버 응답으로 마감 시각을 고친다. 지연된 응답 때문에 숫자가 거꾸로 올라가지 않게 앞당기기만 한다 */
export const nextDeadline = (current: number | null, now: number, msLeft: number) => {
  const reported = now + Math.max(0, msLeft);
  return current === null ? reported : Math.min(current, reported);
};

/** 구간 도착 시각으로 현재 진행 구간 수(0~12)를 구한다 */
export function raceProgress(splits: readonly number[], clock: number): number {
  const done = splits.filter((t) => t <= clock).length;
  if (done >= splits.length) return splits.length;
  const from = splits[done - 1] ?? 0;
  return done + (clock - from) / (splits[done] - from);
}
