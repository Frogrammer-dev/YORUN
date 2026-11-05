import { createRouteTransfer, parseRouteTransfer } from '../../shared/route-transfer.mjs';

export const ROUTE_STORAGE_KEY = 'yorun.recorder.route.v1';
const normalize = value => value === null ? null : parseRouteTransfer(JSON.stringify(value));

// Keep one pending course and the latest run association. GPS durability belongs
// to the native journal; losing these display hints must never lose a recorded fix.
export function createRouteStore(storage = () => localStorage) {
  let state = { selected: null, binding: null }, loadError = null;
  try {
    const raw = storage().getItem(ROUTE_STORAGE_KEY);
    if (raw) {
      if (raw.length > 4_100_000) throw new Error('코스 보관 정보가 너무 큽니다.');
      const value = JSON.parse(raw);
      if (value.version !== 1) throw new Error('지원하지 않는 코스 보관 정보입니다.');
      state = { selected: normalize(value.selected), binding: value.binding === null ? null : {
        id: recordId(value.binding.id), route: normalize(value.binding.route),
      } };
    }
  } catch { loadError = '기기에 보관한 목표 코스를 읽지 못했어요. 코스 파일을 다시 가져와 주세요. GPS 기록은 별도로 보관됩니다.'; }
  function save(next) {
    try { storage().setItem(ROUTE_STORAGE_KEY, JSON.stringify({ version: 1, ...next })); }
    catch { throw new Error('목표 코스를 기기에 저장하지 못했어요. 저장 공간을 확인하세요. 기존 코스는 유지됩니다.'); }
    state = next;
  }
  return {
    get loadError() { return loadError; },
    get selected() { return state.selected; },
    select(route) { save({ ...state, selected: route === null ? null : createRouteTransfer(route) }); },
    bind(id) { save({ ...state, binding: { id: recordId(id), route: state.selected } }); },
    forRun(id) { return state.binding?.id === id ? state.binding.route : null; },
  };
}

function recordId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('러닝 기록을 확인하지 못해 목표 코스를 연결하지 못했어요.');
  return id;
}

export function canChangeRoute({ native, ready, busy, refreshing, selectedId, status }) {
  return !busy && !refreshing && selectedId === null && (!native || ready) && ['empty', 'stopped'].includes(status);
}
