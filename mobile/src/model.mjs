export const MAX_GAP_MS = 30_000;
const validTime = value => Number.isFinite(value) && value >= 0 && value <= 8.64e15;

export function distanceMeters(a, b) {
  const radians = value => value * Math.PI / 180;
  const h = Math.sin(radians(b.lat - a.lat) / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Native events are the source of truth. Rendering and GPX share the same segments.
export function summarize(events, now = Date.now()) {
  let status = 'empty', activeSince = null, activeMs = 0, meters = 0, last = null, lastValid = null;
  let current = [], segments = [], rawCount = 0, rejectedCount = 0, lastReceivedAt = null;
  const messages = [];
  function split() { if (current.length) segments.push(current); current = []; last = null; lastValid = null; }
  for (const event of events) {
    if (!validTime(event.time)) { rejectedCount++; continue; }
    if (event.type === 'start' || event.type === 'resume') {
      if (activeSince !== null) continue;
      split(); status = 'running'; activeSince = event.time;
    } else if (['pause', 'stop', 'interrupted'].includes(event.type)) {
      if (activeSince !== null) activeMs += Math.max(0, event.time - activeSince);
      activeSince = null; split(); status = { pause: 'paused', stop: 'stopped', interrupted: 'interrupted' }[event.type];
      if (event.reason) messages.push(event.reason);
    } else if (event.type === 'error') {
      messages.push(event.reason || '위치 수신 오류');
    } else if (event.type === 'point') {
      rawCount++;
      if (validTime(event.receivedAt)) lastReceivedAt = event.receivedAt;
      // OS may deliver a cached or batched fix. Judge gaps by GPS time, not UI polling time.
      if (status !== 'running' || ![event.lat, event.lng, event.accuracy].every(Number.isFinite) || !validTime(event.receivedAt) || Math.abs(event.lat) > 90 || Math.abs(event.lng) > 180 || event.accuracy < 0 || event.accuracy > 35 || event.time - event.receivedAt > 5_000 || event.time < activeSince) {
        rejectedCount++; continue;
      }
      if (lastValid !== null && event.time <= lastValid.time) { rejectedCount++; continue; }
      if (last && event.time - lastValid.time > MAX_GAP_MS) split();
      if (last) {
        const distance = distanceMeters(last, event);
        // Speed uses the latest valid fix, including stationary ones. Distance
        // still uses the kept track point so sub-3m drift does not accumulate.
        if (distanceMeters(lastValid, event) / ((event.time - lastValid.time) / 1000) > 8.5) { rejectedCount++; continue; }
        if (distance < 3) { lastValid = event; continue; }
        meters += distance;
      }
      current.push(event); last = event; lastValid = event;
    }
  }
  if (current.length) segments.push(current);
  if (activeSince !== null && validTime(now)) activeMs += Math.max(0, now - activeSince);
  return { status, activeMs, meters, segments, rawCount, rejectedCount, lastReceivedAt, messages: messages.slice(-5) };
}

export function diagnosticReport(snapshot, platform) {
  const summary = summarize(snapshot.events);
  let previousTime = null;
  const events = snapshot.events.slice(-500).map(event => {
    const result = { type: ['start', 'resume', 'pause', 'stop', 'interrupted', 'point', 'error'].includes(event.type) ? event.type : 'unknown', time: validTime(event.time) ? event.time : null };
    if (event.type === 'point') {
      result.accuracy = Number.isFinite(event.accuracy) && event.accuracy >= 0 ? event.accuracy : null;
      result.intervalMs = previousTime !== null && validTime(event.time) && event.time >= previousTime ? event.time - previousTime : null;
      if (validTime(event.time)) previousTime = event.time;
    }
    return result;
  });
  return { schema: 1, appVersion: '0.1.0', exportedAt: new Date().toISOString(), platform: ['android', 'ios'].includes(platform) ? platform : 'web', rawCount: summary.rawCount, rejectedCount: summary.rejectedCount, events };
}

export function toGpx(events) {
  const { segments } = summarize(events);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="YORUN" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>YORUN run</name>${segments.map(segment => `<trkseg>${segment.map(point => `<trkpt lat="${point.lat}" lon="${point.lng}"><time>${new Date(point.time).toISOString()}</time></trkpt>`).join('')}</trkseg>`).join('')}</trk></gpx>`;
}
