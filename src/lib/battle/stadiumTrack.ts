/** Standard 400m layout, not an as-built survey of Busan Asiad.
 * Busan confirms 8 lanes: https://www.busan.go.kr/stadium/sfcimplexmain
 * World Athletics facilities manual: radius 36.5m, straights 84.39m, lane width 1.22m.
 */
export const TRACK = { radius: 36.5, straight: 84.39, laneWidth: 1.22, lanes: 8 };

/** Constant arc-length sampling of the stadium oval, in metres. */
export function trackPoint(fraction: number, radius = TRACK.radius) {
  const straight = TRACK.straight;
  const arc = Math.PI * radius;
  let distance = ((fraction % 1) + 1) % 1 * (2 * straight + 2 * arc);
  if (distance < straight) return { x: -straight / 2 + distance, z: radius };
  distance -= straight;
  if (distance < arc) {
    const angle = Math.PI / 2 - distance / radius;
    return { x: straight / 2 + radius * Math.cos(angle), z: radius * Math.sin(angle) };
  }
  distance -= arc;
  if (distance < straight) return { x: straight / 2 - distance, z: -radius };
  distance -= straight;
  const angle = -Math.PI / 2 - distance / radius;
  return { x: -straight / 2 + radius * Math.cos(angle), z: radius * Math.sin(angle) };
}
