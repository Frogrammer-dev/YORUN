import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, toGpx, diagnosticReport } from '../src/model.mjs';

const start = { type: 'start', time: 1000 };
const point = (meters, time, extra = {}) => ({ type: 'point', lat: 35 + meters / 111195, lng: 129, accuracy: 8, time, receivedAt: time, ...extra });

test('screen lock batch replay preserves recorded GPS times, distance and GPX', () => {
  const events = [start, point(0, 2000, { receivedAt: 120000 }), point(10, 5000, { receivedAt: 120000 }), point(20, 8000, { receivedAt: 120000 }), { type: 'stop', time: 9000 }];
  const state = summarize(events, 900000);
  assert.equal(state.status, 'stopped');
  assert.equal(state.activeMs, 8000);
  assert.ok(Math.abs(state.meters - 20) < 1);
  assert.equal(state.segments.length, 1);
  assert.equal((toGpx(events).match(/<trkpt /g) ?? []).length, 3);
});

test('GPS loss never connects a missing kilometre or counts it toward distance', () => {
  const events = [start, point(0, 2000), point(10, 5000), point(1000, 60000), point(1010, 63000)];
  const state = summarize(events);
  assert.deepEqual(state.segments.map(segment => segment.length), [2, 2]);
  assert.ok(Math.abs(state.meters - 20) < 1);
  assert.equal((toGpx(events).match(/<trkseg>/g) ?? []).length, 2);
});

test('stationary fixes keep reception alive without inflating distance', () => {
  const events = [start, point(0, 2000), point(1, 22000), point(1, 42000), point(10, 45000)];
  const state = summarize(events);
  assert.equal(state.segments.length, 1);
  assert.equal(state.segments[0].length, 2);
  assert.ok(Math.abs(state.meters - 10) < 1);
});

test('a long standstill cannot hide a 150m jump in the next second', () => {
  const events = [start, point(0, 2000), point(0, 22000), point(0, 42000), point(0, 60000), point(150, 61000)];
  const state = summarize(events);
  assert.equal(state.rejectedCount, 1);
  assert.equal(state.meters, 0);
  assert.equal(state.segments[0].length, 1);
  events.push(point(10, 64000));
  assert.ok(Math.abs(summarize(events).meters - 10) < 1);
});

test('small stationary drift is allowed when checking speed from the latest fix', () => {
  const events = [start, point(0, 2000), point(2.5, 22000), point(2.5, 42000), point(2.5, 60000), point(11, 61000)];
  const state = summarize(events);
  assert.equal(state.rejectedCount, 0);
  assert.equal(state.segments[0].length, 2);
  assert.ok(Math.abs(state.meters - 11) < 1);
});

test('pause, interruption and relaunch preserve time and split resumed tracks', () => {
  const events = [start, point(0, 2000), point(10, 5000), { type: 'interrupted', time: 5000 }];
  assert.equal(summarize(events, 900000).activeMs, 4000);
  events.push({ type: 'resume', time: 100000 }, point(1000, 101000), point(1010, 104000), { type: 'stop', time: 105000 });
  const state = summarize(events, 900000);
  assert.equal(state.activeMs, 9000);
  assert.deepEqual(state.segments.map(segment => segment.length), [2, 2]);
  assert.ok(Math.abs(state.meters - 20) < 1);
});

test('invalid, stale, duplicate, reversed and implausible fixes cannot poison a track', () => {
  const events = [start, point(0, 2000), point(10, 5000), point(20, 5000), point(20, 4000), point(50, 6000, { accuracy: 100 }), point(5000, 7000), point(20, 8000, { lat: NaN }), point(20, 9000, { time: -1 }), point(20, 10000)];
  const state = summarize(events);
  assert.ok(Math.abs(state.meters - 20) < 1);
  assert.equal(state.rejectedCount, 6);
  assert.doesNotMatch(toGpx(events), /NaN|Invalid/);
});

test('diagnostics are bounded and omit locations, IDs, private text and injected properties', () => {
  const events = Array.from({ length: 510 }, (_, i) => point(i, 1000 + i * 1000, { token: 'private-token', reason: 'private-location-text' }));
  const report = diagnosticReport({ id: 'private-id', events }, 'android');
  assert.equal(report.events.length, 500);
  const json = JSON.stringify(report);
  assert.doesNotMatch(json, /"lat"|"lng"|private-|token|reason/);
  assert.equal(report.platform, 'android');
});
