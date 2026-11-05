// 한 턴의 연출 대본. 판정 결과를 바꾸지 않고, 화면에 보여 줄 순서만 정한다.

import type { BattleState, TurnLog } from "./turnBattle";

export interface TurnFx {
  /** 공격하는 쪽. 아무도 맞지 않으면 null */
  attacker: 0 | 1 | null;
  /** 맞는 쪽 */
  victim: 0 | 1 | null;
  damage: number;
  critical: boolean;
  /** 비기거나 둘 다 빗나가 서로 부딪치기만 한다 */
  clash: boolean;
  /** 이번 턴으로 쓰러진 쪽 */
  knockedOut: 0 | 1 | null;
}

export function turnFx(log: TurnLog, winner: BattleState["winner"]): TurnFx {
  const victim = log.damage[1] > 0 ? 1 : log.damage[0] > 0 ? 0 : null;
  const attacker = victim === null ? null : victim === 1 ? 0 : 1;
  return {
    attacker,
    victim,
    damage: victim === null ? 0 : log.damage[victim],
    critical: attacker !== null && log.critical[attacker],
    clash: victim === null,
    knockedOut: winner === 0 ? 1 : winner === 1 ? 0 : null,
  };
}
