import { Capacitor } from '@capacitor/core';
import { Recorder } from '@yorun/recorder';
import { summarize, toGpx, diagnosticReport } from './model.mjs';
import { createSnapshotReader } from './snapshot-reader.mjs';
import { createRouteStore, canChangeRoute } from './route-store.mjs';
import { MAX_ROUTE_BYTES, parseRouteTransfer } from '../../shared/route-transfer.mjs';
const $ = id => document.getElementById(id);
const native = Capacitor.isNativePlatform();
let snapshot = { events: [], id: null }, selectedId = null, busy = false, refreshing = false;
let snapshotSelection = null, snapshotReady = !native;
const routeStore = createRouteStore();
const labels = { empty: '시작할 준비가 되었어요', running: '휴대폰에 기록 중', paused: '일시정지', stopped: '러닝 종료 · 저장 완료', interrupted: '기록 중단 · 저장된 위치 복원됨' };
$('platform').textContent = native ? `${Capacitor.getPlatform()} · 시제품 0.1.0` : '브라우저 미리보기';
function showError(error) { $('error').hidden = false; $('error').textContent = error.message || String(error); }
function ready() { return snapshotReady && snapshotSelection === selectedId; }
function canAct() { return native && !busy && !refreshing && ready(); }
function canImport() {
  return canChangeRoute({ native, ready: ready(), busy, refreshing, selectedId, status: summarize(snapshot.events).status });
}
function render() {
  const state = summarize(ready() ? snapshot.events : []);
  $('status').textContent = !native ? '브라우저 미리보기 · 코스 가져오기 시험 가능' : ready() ? labels[state.status] : '기록 불러오는 중…';
  $('distance').textContent = (state.meters / 1000).toFixed(2);
  const seconds = Math.floor(state.activeMs / 1000);
  $('duration').textContent = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  const historical = selectedId !== null;
  $('start').hidden = historical || !['empty', 'stopped'].includes(state.status);
  $('pause').hidden = historical || state.status !== 'running';
  $('resume').hidden = historical || !['paused', 'interrupted'].includes(state.status);
  $('stop').hidden = historical || !['running', 'paused', 'interrupted'].includes(state.status);
  $('current').hidden = !historical;
  for (const id of ['start', 'pause', 'resume', 'stop']) $(id).disabled = !canAct();
  $('gpx').disabled = !canAct() || !state.segments.length;
  $('diagnostics').disabled = !canAct() || !snapshot.events.length;
  $('history').disabled = busy || !native;
  $('current').disabled = busy;
  const age = state.lastReceivedAt ? Math.max(0, Math.floor((Date.now() - state.lastReceivedAt) / 1000)) : null;
  $('quality').textContent = `위치 ${state.rawCount}개 수신 · 정확도/공백 검사 제외 ${state.rejectedCount}개${state.status === 'running' ? ` · 마지막 수신 ${age === null ? '대기 중' : `${age}초 전`}` : ''}${state.messages.length ? `\n${state.messages.at(-1)}` : ''}`;
  const boundCourse = ready() ? routeStore.forRun(snapshot.id) : null;
  const preparing = selectedId === null && ['empty', 'stopped'].includes(state.status);
  const course = preparing ? routeStore.selected : boundCourse;
  $('route-title').textContent = `${preparing ? '다음 러닝 목표' : '이 러닝의 목표'}: ${course?.name ?? '자유 달리기'}`;
  $('route-meta').textContent = course ? `${(course.lengthMeters / 1000).toFixed(2)}km · 이동 구간 ${course.moves.length}개` : '웹에서 고른 코스 파일을 가져오거나 코스 없이 시작하세요.';
  $('route-file').disabled = !canImport();
  $('route-clear').disabled = !canImport() || !routeStore.selected;
  $('route-preview').hidden = !preparing || !course;
  draw([], course, $('route-preview'));
  draw(state.segments, boundCourse, $('track'));
}
function draw(segments, course, svg) {
  svg.replaceChildren();
  const lines = [];
  if (course) {
    const points = course.points.map(([lat, lng]) => ({ lat, lng }));
    let from = 0;
    for (const [start, end] of course.moves) {
      if (start > from) lines.push({ points: points.slice(from, start + 1), kind: 'planned' });
      lines.push({ points: points.slice(start, end + 1), kind: 'transfer' });
      from = end;
    }
    if (from < points.length - 1) lines.push({ points: points.slice(from), kind: 'planned' });
  }
  for (const points of segments) lines.push({ points, kind: 'recorded' });
  const points = lines.flatMap(line => line.points); if (!points.length) return;
  const lat0 = points[0].lat * Math.PI / 180;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of points) {
    const x = point.lng * Math.cos(lat0), y = -point.lat;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const scale = Math.min(280 / Math.max(maxX - minX, .00001), 180 / Math.max(maxY - minY, .00001));
  const xy = p => [160 + (p.lng * Math.cos(lat0) - (minX + maxX) / 2) * scale, 110 + (-p.lat - (minY + maxY) / 2) * scale];
  for (const { points: segment, kind } of lines) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', segment.length > 1 ? 'polyline' : 'circle');
    if (segment.length > 1) line.setAttribute('points', segment.map(p => xy(p).join(',')).join(' '));
    else { const [x, y] = xy(segment[0]); line.setAttribute('cx', x); line.setAttribute('cy', y); line.setAttribute('r', '3'); }
    line.setAttribute('class', kind);
    svg.append(line);
  }
}
const snapshotReader = createSnapshotReader({
  load: id => Recorder.snapshot(id ? { id } : {}),
  onSnapshot: (result, id) => {
    snapshot = result; snapshotSelection = id; snapshotReady = true;
    if (snapshot.nativeError) showError(new Error(snapshot.nativeError));
  },
  onError: error => { snapshotReady = false; showError(error); },
  onLoading: value => { refreshing = value; render(); },
});
async function refresh(options) {
  if (!native || busy) return;
  await snapshotReader.read(selectedId, options);
}
async function history() {
  const { records } = await Recorder.list();
  $('history').replaceChildren(new Option('현재 기록', ''));
  for (const record of records) $('history').append(new Option(new Date(Number(record.id.split('-')[0])).toLocaleString('ko-KR'), record.id));
  $('history').value = selectedId || '';
}
async function command(action) {
  if (!canAct()) return;
  busy = true; snapshotReady = false; snapshotReader.invalidate(); $('error').hidden = true; render();
  try {
    await Recorder.command({ action }); selectedId = null;
    if (action === 'start') {
      const started = await Recorder.snapshot({});
      // A missing/failed display association does not change the native GPS journal.
      routeStore.bind(started.id);
    }
    await history();
  }
  catch (error) { showError(error); }
  finally { busy = false; await refresh({ force: true }); render(); }
}
for (const action of ['start', 'pause', 'resume', 'stop']) $(action).onclick = () => command(action);
async function share(kind) {
  if (!canAct()) return;
  busy = true; render();
  try {
    const data = kind === 'gpx' ? toGpx(snapshot.events) : JSON.stringify(diagnosticReport(snapshot, Capacitor.getPlatform()), null, 2);
    const filename = kind === 'gpx' ? `yorun-${snapshot.id}.gpx` : `yorun-diagnostics-${Date.now()}.json`;
    await Recorder.exportFile({ filename, data });
  } catch (error) { showError(error); }
  finally { busy = false; render(); }
}
$('gpx').onclick = () => share('gpx'); $('diagnostics').onclick = () => share('json');
$('history').onchange = async () => { if (busy) return; selectedId = $('history').value || null; snapshotReady = false; render(); await refresh(); };
$('current').onclick = async () => { if (busy) return; selectedId = null; snapshotReady = false; $('history').value = ''; render(); await refresh(); };
$('route-file').onchange = async () => {
  const file = $('route-file').files[0];
  $('route-file').value = '';
  if (!file || busy) return;
  // Returning from the OS file picker can trigger a visibility refresh before
  // change arrives. Wait for that read rather than silently dropping the file.
  if (native && refreshing) await refresh();
  if (!canImport()) { showError(new Error('진행 중인 러닝을 종료하고 현재 기록 화면에서 코스를 가져와 주세요.')); return; }
  busy = true; $('error').hidden = true; render();
  try {
    if (file.size > MAX_ROUTE_BYTES) throw new Error('코스 파일은 2MB 이하여야 합니다.');
    routeStore.select(parseRouteTransfer(await file.text()));
  } catch (error) { showError(error); }
  finally { busy = false; render(); }
};
$('route-clear').onclick = () => {
  if (!canImport()) return;
  try { routeStore.select(null); $('error').hidden = true; render(); }
  catch (error) { showError(error); }
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
if (native) { await refresh(); await history().catch(showError); setInterval(() => { if (!document.hidden) void refresh(); }, 2000); }
else { render(); showError(new Error('이 화면은 미리보기입니다. 실제 백그라운드 기록은 Android 또는 iPhone에 설치한 앱에서 시험하세요.')); }
if (routeStore.loadError) showError(new Error(routeStore.loadError));
