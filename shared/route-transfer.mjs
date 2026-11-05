// This portable file contains a planned course, never a recorded activity or account data.
export const MAX_ROUTE_BYTES = 2_000_000;
export const MAX_ROUTE_POINTS = 20_000;
const MAX_ROUTE_METERS = 100_000;
const radians = degrees => degrees * Math.PI / 180;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkBytes(text) {
  if (text.length > MAX_ROUTE_BYTES || new TextEncoder().encode(text).length > MAX_ROUTE_BYTES) {
    throw new Error('코스 파일은 2MB 이하여야 해요.');
  }
}

function checkFormat(value) {
  if (!object(value) || value.format !== 'yorun.route' || value.version !== 1) {
    throw new Error('지원하는 요런 코스 파일이 아니에요. 웹에서 코스를 다시 저장해 주세요.');
  }
}

function distance(a, b) {
  const h = Math.sin(radians(b[0] - a[0]) / 2) ** 2
    + Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(radians(b[1] - a[1]) / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

/** Validate and copy only the fields needed to display the planned course. */
export function createRouteTransfer(input) {
  if (!object(input)) throw new Error('코스 정보가 올바르지 않아요.');
  const rawName = input.name;
  if (typeof rawName !== 'string' || [...rawName].some(character => {
    const code = character.codePointAt(0);
    return code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029;
  })) throw new Error('코스 이름에는 줄바꿈이나 제어문자를 넣을 수 없어요.');
  const name = rawName.trim();
  if (!name || [...name].length > 80) throw new Error('코스 이름은 1~80자여야 해요.');
  if (!Array.isArray(input.points) || input.points.length < 2 || input.points.length > MAX_ROUTE_POINTS) {
    throw new Error('코스 좌표는 2~20,000개여야 해요.');
  }
  const points = [];
  let lengthMeters = 0;
  // An indexed loop also rejects sparse arrays supplied by JavaScript callers.
  for (let index = 0; index < input.points.length; index++) {
    const point = input.points[index];
    if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
      || Math.abs(point[0]) > 90 || Math.abs(point[1]) > 180) {
      throw new Error('코스에 올바르지 않은 위도·경도가 있어요.');
    }
    const copy = [point[0], point[1]];
    if (index > 0) lengthMeters += distance(points[index - 1], copy);
    if (lengthMeters > MAX_ROUTE_METERS) throw new Error('코스의 전체 길이는 100km 이하여야 해요.');
    points.push(copy);
  }
  if (!(lengthMeters > 0)) throw new Error('서로 다른 위치가 있는 코스를 선택해 주세요.');

  const sourceMoves = input.moves === undefined ? [] : input.moves;
  if (!Array.isArray(sourceMoves) || sourceMoves.length > MAX_ROUTE_POINTS) {
    throw new Error('코스의 이동 구간 정보가 올바르지 않아요.');
  }
  const moves = [];
  let previousEnd = -1;
  for (const move of sourceMoves) {
    if (!Array.isArray(move) || move.length !== 2 || !Number.isInteger(move[0]) || !Number.isInteger(move[1])
      || move[0] < 0 || move[0] > move[1] || move[1] >= points.length || move[0] < previousEnd) {
      throw new Error('코스의 이동 구간 순서나 좌표 범위가 올바르지 않아요.');
    }
    // Existing multi-stroke courses can meet at one point: there is no moving edge to draw.
    if (move[0] !== move[1]) moves.push([move[0], move[1]]);
    previousEnd = move[1];
  }
  return { format: 'yorun.route', version: 1, name, points, moves, lengthMeters };
}

export function parseRouteTransfer(text) {
  if (typeof text !== 'string') throw new Error('코스 파일을 읽을 수 없어요.');
  checkBytes(text);
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('코스 파일의 JSON 형식이 올바르지 않아요.'); }
  checkFormat(value);
  return createRouteTransfer(value);
}

export function stringifyRouteTransfer(route) {
  checkFormat(route);
  const text = JSON.stringify(createRouteTransfer(route));
  checkBytes(text);
  return text;
}
