import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteStore, canChangeRoute } from '../src/route-store.mjs';

const course = name => ({ name, points: [[35, 129], [35.001, 129]], moves: [] });
function memory() {
  let value = null;
  return { getItem: () => value, setItem: (_, next) => { value = next; } };
}
test('new course selection cannot change a previous run association, including after restart', () => {
  const storage = memory(), store = createRouteStore(() => storage);
  store.select(course('첫 코스')); store.bind('run-a'); store.select(course('다음 코스'));
  const restored = createRouteStore(() => storage);
  assert.equal(restored.selected.name, '다음 코스');
  assert.equal(restored.forRun('run-a').name, '첫 코스');
  assert.equal(restored.forRun('unrelated-run'), null);
  restored.bind('run-b');
  assert.equal(restored.forRun('run-a'), null);
  assert.equal(restored.forRun('run-b').name, '다음 코스');
});
test('failed storage preserves the selected course and run association', () => {
  const storage = memory(), store = createRouteStore(() => storage);
  store.select(course('보관 코스')); store.bind('run-a');
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.select(course('저장 실패 코스')), /저장하지 못/);
  assert.throws(() => store.select(null), /저장하지 못/);
  assert.equal(store.selected.name, '보관 코스');
  assert.equal(store.forRun('run-a').name, '보관 코스');
});
test('corrupt display metadata does not prevent opening the native recorder', () => {
  const store = createRouteStore(() => ({ getItem: () => '{broken' }));
  assert.match(store.loadError, /다시 가져와/);
  assert.equal(store.selected, null);
  assert.equal(store.forRun('run-a'), null);
});
test('course replacement is blocked for active, paused, interrupted, historical and pending reads', () => {
  const base = { native: true, ready: true, busy: false, refreshing: false, selectedId: null, status: 'empty' };
  assert.equal(canChangeRoute(base), true);
  assert.equal(canChangeRoute({ ...base, status: 'stopped' }), true);
  for (const patch of [{ status: 'running' }, { status: 'paused' }, { status: 'interrupted' }, { selectedId: 'old' }, { busy: true }, { refreshing: true }, { ready: false }]) {
    assert.equal(canChangeRoute({ ...base, ...patch }), false);
  }
});
