// 친구와 하는 1대1 대결 방: 서버 행(row)을 화면용으로 바꾸는 순수 함수들.
// 판정 엔진(turnBattle)은 0번=방장, 1번=손님으로 계산한다. 화면은 누구든 '나'가 0번이 되도록 뒤집어 보여 준다.

import type { BattleChoice, BattleSheet, BattleState, TurnLog } from "./turnBattle";

export type RoomRole = "host" | "guest";
export type RoomStatus = "waiting" | "playing" | "finished";

/** DB의 duel_rooms 행 중 화면에 필요한 칸 */
export interface RoomRow {
  id: string;
  code: string;
  host_id: string;
  guest_id: string | null;
  host_name: string;
  guest_name: string | null;
  host_sheet: BattleSheet;
  guest_sheet: BattleSheet | null;
  status: RoomStatus;
  state: BattleState | null;
  turn_no: number;
  host_choice: BattleChoice | null;
  guest_choice: BattleChoice | null;
  last_turn: TurnLog | null;
  left_by: RoomRole | null;
  expires: string;
}

/** 화면에 보내는 방 정보. 상대의 이번 턴 선택은 담지 않고 '냈는지'만 알린다 */
export interface RoomView {
  id: string;
  code: string;
  role: RoomRole;
  status: RoomStatus;
  me: { name: string; sheet: BattleSheet };
  foe: { name: string; sheet: BattleSheet } | null;
  state: BattleState | null;
  log: TurnLog | null;
  turnNo: number;
  myChoice: BattleChoice | null;
  foeChose: boolean;
  /** 상대가 나가서 끝났으면 true */
  foeLeft: boolean;
  expired: boolean;
}

export const ROOM_CODE = /^[0-9]{6}$/;

/** 0~999999 난수로 6자리 방 번호 (앞자리 0 포함) */
export const roomCode = (n: number) => String(Math.floor(n) % 1_000_000).padStart(6, "0");

const swap = <T,>(pair: [T, T]): [T, T] => [pair[1], pair[0]];

/** 손님 쪽에서 보면 0번과 1번을 바꾼다 */
export function stateFor(state: BattleState, role: RoomRole): BattleState {
  if (role === "host") return state;
  const winner = state.winner === 0 ? 1 : state.winner === 1 ? 0 : state.winner;
  return { ...state, hp: swap(state.hp), sheets: swap(state.sheets), winner };
}

export function logFor(log: TurnLog | null, role: RoomRole): TurnLog | null {
  if (!log || role === "host") return log;
  return { ...log, choices: swap(log.choices), damage: swap(log.damage), critical: swap(log.critical), missed: swap(log.missed) };
}

export function roleOf(row: Pick<RoomRow, "host_id" | "guest_id">, userId: string): RoomRole | null {
  return row.host_id === userId ? "host" : row.guest_id === userId ? "guest" : null;
}

export function roomView(row: RoomRow, userId: string, now = Date.now()): RoomView | null {
  const role = roleOf(row, userId);
  if (!role) return null;
  const host = role === "host";
  const foeName = host ? row.guest_name : row.host_name;
  const foeSheet = host ? row.guest_sheet : row.host_sheet;
  return {
    id: row.id,
    code: row.code,
    role,
    status: row.status,
    me: { name: host ? row.host_name : row.guest_name ?? "", sheet: host ? row.host_sheet : row.guest_sheet ?? row.host_sheet },
    foe: foeName && foeSheet ? { name: foeName, sheet: foeSheet } : null,
    state: row.state ? stateFor(row.state, role) : null,
    log: logFor(row.last_turn, role),
    turnNo: row.turn_no,
    myChoice: host ? row.host_choice : row.guest_choice,
    foeChose: !!(host ? row.guest_choice : row.host_choice),
    foeLeft: !!row.left_by && row.left_by !== role,
    expired: row.status !== "finished" && Date.parse(row.expires) <= now,
  };
}

/** 나가기: 진행 중이면 남은 사람이 이긴다. 엔진 기준(0=방장) 승자 */
export function forfeitWinner(leaver: RoomRole): 0 | 1 {
  return leaver === "host" ? 1 : 0;
}
