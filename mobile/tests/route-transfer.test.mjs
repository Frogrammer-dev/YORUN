import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ROUTE_BYTES, MAX_ROUTE_POINTS, createRouteTransfer, parseRouteTransfer, stringifyRouteTransfer } from '../../shared/route-transfer.mjs';

const course = () => ({ name: '하트 코스', points: [[35, 129], [35.001, 129], [35.001, 129.001], [35, 129.001], [35, 129]], moves: [[1, 2]] });
const file = extra => JSON.stringify({ format: 'yorun.route', version: 1, ...course(), ...extra });

test('a portable course round trips without trusting supplied distance or metadata', () => {
  const parsed = parseRouteTransfer(file({ lengthMeters: 1, id: 'private-id', token: 'secret', outline: [[0, 0]], pointsOfInterest: [] }));
  assert.ok(parsed.lengthMeters > 400 && parsed.lengthMeters < 410);
  assert.deepEqual(parsed.moves, [[1, 2]]);
  assert.deepEqual(Object.keys(parsed).sort(), ['format', 'lengthMeters', 'moves', 'name', 'points', 'version']);
  assert.deepEqual(parseRouteTransfer(stringifyRouteTransfer(parsed)), parsed);
  assert.doesNotMatch(stringifyRouteTransfer(parsed), /secret|private-id|outline|pointsOfInterest/);
});

test('creation copies coordinates and moving sections in both directions', () => {
  const input = course();
  const result = createRouteTransfer(input);
  input.points[0][0] = 0;
  input.moves[0][0] = 0;
  assert.deepEqual(result.points[0], [35, 129]);
  assert.deepEqual(result.moves[0], [1, 2]);
  result.points[1][0] = 1;
  result.moves[0][1] = 4;
  assert.deepEqual(input.points[1], [35.001, 129]);
  assert.deepEqual(input.moves[0], [0, 2]);
});

test('only supported versioned JSON documents can be imported', () => {
  for (const text of ['', '{', 'null', '[]', file({ format: 'gpx' }), file({ version: 2 }), file({ version: '1' })]) {
    assert.throws(() => parseRouteTransfer(text), /코스/);
  }
  assert.throws(() => parseRouteTransfer(undefined), /읽을/);
  assert.equal(parseRouteTransfer(`\uFEFF${file()}`).name, '하트 코스');
});

test('the file size cap applies to UTF-8 bytes before parsing and ignores no oversized fields', () => {
  const base = file();
  assert.equal(parseRouteTransfer(base + ' '.repeat(MAX_ROUTE_BYTES - Buffer.byteLength(base))).name, '하트 코스');
  assert.throws(() => parseRouteTransfer(base + ' '.repeat(MAX_ROUTE_BYTES)), /2MB/);
  const multibyte = file({ unused: '가'.repeat(Math.floor(MAX_ROUTE_BYTES / 3)) });
  assert.ok(multibyte.length < MAX_ROUTE_BYTES);
  assert.throws(() => parseRouteTransfer(multibyte), /2MB/);
});

test('coordinate validation rejects coercion, malformed tuples, nonfinite values and sparse arrays', () => {
  for (const point of [[NaN, 129], [Infinity, 129], [91, 129], [35, -181], ['35', 129], [null, 129], [35], [35, 129, 0], [35, ,], {}]) {
    assert.throws(() => createRouteTransfer({ ...course(), points: [[35, 129], point] }), /위도|위치/);
  }
  assert.throws(() => createRouteTransfer({ ...course(), points: Array(2) }), /위도/);
  assert.deepEqual(createRouteTransfer({ name: '날짜변경선', points: [[0, 179.999], [0, -179.999]] }).points, [[0, 179.999], [0, -179.999]]);
});

test('point count boundaries and empty geometry are enforced without silently truncating', () => {
  const points = Array.from({ length: MAX_ROUTE_POINTS }, (_, index) => [35 + index * 1e-7, 129]);
  assert.equal(createRouteTransfer({ name: '긴 코스', points }).points.length, MAX_ROUTE_POINTS);
  for (const invalid of [[], [[35, 129]], [...points, [35.01, 129]], [[35, 129], [35, 129]]]) {
    assert.throws(() => createRouteTransfer({ name: '코스', points: invalid }), /좌표|서로 다른/);
  }
});

test('names remain plain bounded text and reject line breaks even around the name', () => {
  assert.equal(createRouteTransfer({ ...course(), name: '  동네 코스  ' }).name, '동네 코스');
  assert.equal([...createRouteTransfer({ ...course(), name: '🏃'.repeat(80) }).name].length, 80);
  for (const name of ['', ' ', '가'.repeat(81), '코스\n', '\t코스', '코\0스', '코\u007f스', '코\u2028스', 123, null]) {
    assert.throws(() => createRouteTransfer({ ...course(), name }), /코스 이름/);
  }
});

test('moving sections preserve edge boundaries while rejecting overlap and invalid indices', () => {
  assert.deepEqual(createRouteTransfer({ ...course(), moves: [[0, 0], [1, 2], [2, 3]] }).moves, [[1, 2], [2, 3]]);
  assert.deepEqual(createRouteTransfer({ name: '코스', points: course().points }).moves, []);
  for (const moves of [null, 'invalid', [[-1, 1]], [[1, 5]], [[2, 1]], [[0.5, 1]], [['1', 2]], [[1]], [[1, 2, 3]], [[2, 3], [1, 2]], [[0, 3], [2, 4]], [Array(2)]]) {
    assert.throws(() => createRouteTransfer({ ...course(), moves }), /이동 구간/);
  }
});

test('the 100km limit measures the entire path including return legs and moving sections', () => {
  const short = createRouteTransfer({ name: '짧은 코스', points: [[0, 0], [0, 0.5]] });
  assert.ok(short.lengthMeters > 55_000 && short.lengthMeters < 56_000);
  assert.throws(() => createRouteTransfer({ name: '왕복', points: [[0, 0], [0, 0.5], [0, 0]], moves: [[1, 2]] }), /100km/);
  assert.throws(() => createRouteTransfer({ name: '긴 코스', points: [[0, 0], [0, 1]] }), /100km/);
});

test('serialization revalidates mutated objects and removes unexpected fields', () => {
  const route = createRouteTransfer(course());
  route.token = 'private';
  route.lengthMeters = -20;
  assert.ok(parseRouteTransfer(stringifyRouteTransfer(route)).lengthMeters > 400);
  assert.doesNotMatch(stringifyRouteTransfer(route), /private/);
  route.points[0][0] = 100;
  assert.throws(() => stringifyRouteTransfer(route), /위도/);
  assert.throws(() => stringifyRouteTransfer({ ...route, version: 99 }), /지원/);
});
