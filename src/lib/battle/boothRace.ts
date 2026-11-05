// 부스 전용 8인 경주의 계산. 가상 달리기라 능력치는 서버가 만들고, 실제 더비 기록과 섞지 않는다.

import { DERBY_MAX_RUNNERS, simulateDerby, type DerbyStats } from "./derby";
import { seededRandom } from "./seed";

export const BOOTH_STYLES = {
  speed: { label: "속도형", hint: "직선에서 빠르고 코너에서 느려요.", pace: [300, 340], cornering: [0.62, 0.74] },
  balance: { label: "균형형", hint: "직선과 코너 모두 무난해요.", pace: [330, 365], cornering: [0.72, 0.84] },
  corner: { label: "코너형", hint: "코너에서 빠르고 스퍼트가 자주 나와요.", pace: [360, 395], cornering: [0.84, 0.96] },
} as const;
export type BoothStyle = keyof typeof BOOTH_STYLES;
const STYLE_IDS = Object.keys(BOOTH_STYLES) as BoothStyle[];

const within = ([low, high]: readonly [number, number], roll: number) => low + (high - low) * roll;

/** roll은 0 이상 1 미만의 난수를 돌려준다 */
export function boothStats(style: BoothStyle, roll: () => number): DerbyStats {
  const { pace, cornering } = BOOTH_STYLES[style];
  return { avgPaceSecPerKm: Math.round(within(pace, roll())), cornering: Number(within(cornering, roll()).toFixed(2)), corners: [], paceSplits: [] };
}

export interface BoothSeat { lane: number; name: string; stats: DerbyStats; mine?: boolean }
export interface BoothPlacing { rank: number; lane: number; name: string; seconds: number; practice: boolean; mine: boolean }

/** 빈 레인을 연습 러너로 채워 결과를 낸다. 같은 경주는 어느 서버에서 계산해도 결과가 같다. */
export function boothRaceResult(raceId: string, seats: readonly BoothSeat[]): BoothPlacing[] {
  const taken = new Set(seats.map((seat) => seat.lane));
  const practice: BoothSeat[] = [];
  for (let lane = 1; lane <= DERBY_MAX_RUNNERS; lane++) {
    if (taken.has(lane)) continue;
    const random = seededRandom(`booth-practice:${raceId}:${lane}`);
    const style = STYLE_IDS[Math.floor(random() * STYLE_IDS.length)];
    practice.push({ lane, name: `연습 러너 ${lane}`, stats: boothStats(style, random) });
  }
  const field = [...seats, ...practice];
  const race = simulateDerby(field.map((seat) => ({ id: String(seat.lane), stats: seat.stats })), `booth:${raceId}`);
  return race.entries.map((entry) => {
    const seat = field.find((candidate) => String(candidate.lane) === entry.id)!;
    return { rank: entry.rank, lane: seat.lane, name: seat.name, seconds: Math.round(entry.finishSeconds * 10) / 10, practice: !taken.has(seat.lane), mine: !!seat.mine };
  });
}
