// GpxParser (8.3): 형식·구조·한도 검사, 트랙·구간 좌표 추출.
// 원본 XML·좌표는 브라우저 안에서만 다루며 서버로 보내지 않는다 (1.3-5).

import { GPX_LIMITS } from "@/lib/contracts/limits";
import { ImportError } from "./errors";

export const GPX_NS = {
  v10: "http://www.topografix.com/GPX/1/0",
  v11: "http://www.topografix.com/GPX/1/1",
} as const;

export interface GpxPoint {
  lat: number;
  lon: number;
  /** ISO 문자열. 날짜 후보 계산에만 쓰고 저장하지 않는다. */
  time?: string;
}

export interface GpxTrack {
  index: number;
  name: string | null;
  segments: GpxPoint[][];
  pointCount: number;
}

export interface ParsedGpx {
  tracks: GpxTrack[];
  totalSegments: number;
  totalPoints: number;
}

export type ParseStage = "read" | "parse" | "extract";

export interface ParseOptions {
  signal?: AbortSignal;
  onProgress?: (stage: ParseStage, fraction: number) => void;
  /** 테스트·Node 환경용 DOMParser 주입. 기본은 전역 DOMParser. */
  domParser?: { parseFromString(text: string, type: "application/xml"): Document };
  timeoutMs?: number;
  /** 청크 사이에 이벤트 루프로 양보해 취소·진행 표시를 가능하게 한다. */
  chunkSize?: number;
}

const yieldToLoop = () => new Promise<void>((r) => setTimeout(r, 0));

function formatBytes(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(n / 1024)} KiB`;
}

export async function parseGpxFile(file: File, opts: ParseOptions = {}): Promise<ParsedGpx> {
  // 9: DOMParser 동기 호출 중에는 취소할 수 없으므로 파일 한도를 먼저 적용한다.
  if (file.size === 0) throw new ImportError("empty_file", "빈 파일");
  if (file.size > GPX_LIMITS.maxFileBytes) {
    throw new ImportError("file_too_large", "파일 용량 초과", { size: formatBytes(file.size) });
  }
  opts.onProgress?.("read", 0);
  const text = await file.text();
  opts.onProgress?.("read", 1);
  return parseGpxText(text, opts);
}

function childElements(parent: Element, localName: string, ns: string | null): Element[] {
  const out: Element[] = [];
  for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === localName && c.namespaceURI === ns) out.push(c);
  }
  return out;
}

function firstChildText(parent: Element, localName: string, ns: string | null): string | null {
  const el = childElements(parent, localName, ns)[0];
  const t = el?.textContent?.trim();
  return t ? t : null;
}

export async function parseGpxText(text: string, opts: ParseOptions = {}): Promise<ParsedGpx> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? GPX_LIMITS.processingTimeoutMs;
  const chunkSize = opts.chunkSize ?? 2_000;
  const checkpoint = async () => {
    await yieldToLoop();
    if (opts.signal?.aborted) throw new ImportError("cancelled", "취소됨");
    if (Date.now() - started > timeoutMs) throw new ImportError("timeout", "처리 시간 초과");
  };

  if (!text.trim()) throw new ImportError("empty_file", "빈 파일");
  if (new TextEncoder().encode(text).length > GPX_LIMITS.maxFileBytes) {
    throw new ImportError("file_too_large", "파일 용량 초과", { size: formatBytes(text.length) });
  }
  // 6.1-2: DOCTYPE·ENTITY 선언은 거절한다 (외부 엔티티·확장 공격 차단).
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) {
    throw new ImportError("doctype_forbidden", "DOCTYPE/ENTITY 선언");
  }

  opts.onProgress?.("parse", 0);
  const parser = opts.domParser ?? new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  // 6.1-1: 확장자가 아니라 XML 파싱 성공 여부로 판단한다.
  if (doc.getElementsByTagName("parsererror").length > 0 || !doc.documentElement) {
    throw new ImportError("not_xml", "XML 형식 오류");
  }
  opts.onProgress?.("parse", 1);
  await checkpoint();

  const root = doc.documentElement;
  const ns = root.namespaceURI;
  // 6.1-3: 공식 GPX 네임스페이스(접두사 포함)와 네임스페이스 없는 GPX만 허용.
  if (root.localName !== "gpx" || !(ns === null || ns === GPX_NS.v10 || ns === GPX_NS.v11)) {
    throw new ImportError("not_gpx", "GPX 루트 요소가 아님");
  }

  const trkEls = childElements(root, "trk", ns);
  if (trkEls.length === 0) {
    const hasRoute = childElements(root, "rte", ns).length > 0 || childElements(root, "wpt", ns).length > 0;
    throw new ImportError(hasRoute ? "route_only" : "no_track", hasRoute ? "계획 경로/지점만 있음" : "트랙 없음");
  }
  if (trkEls.length > GPX_LIMITS.maxTracks) {
    throw new ImportError("too_many_tracks", "트랙 수 초과", { count: trkEls.length });
  }

  // 한도는 파일 전체 기준으로, 좌표를 읽기 전에 먼저 센다. 조용히 잘라 쓰지 않는다.
  const segEls = trkEls.map((t) => childElements(t, "trkseg", ns));
  const totalSegments = segEls.reduce((s, a) => s + a.length, 0);
  if (totalSegments > GPX_LIMITS.maxSegments) {
    throw new ImportError("too_many_segments", "구간 수 초과", { count: totalSegments });
  }
  const ptEls = segEls.map((segs) => segs.map((s) => childElements(s, "trkpt", ns)));
  const totalPoints = ptEls.flat().reduce((s, a) => s + a.length, 0);
  if (totalPoints > GPX_LIMITS.maxPoints) {
    throw new ImportError("too_many_points", "점 수 초과", { count: totalPoints });
  }

  const tracks: GpxTrack[] = [];
  let processed = 0;
  for (let ti = 0; ti < trkEls.length; ti++) {
    const segments: GpxPoint[][] = [];
    for (let si = 0; si < ptEls[ti].length; si++) {
      const pts: GpxPoint[] = [];
      const els = ptEls[ti][si];
      for (let pi = 0; pi < els.length; pi++) {
        const el = els[pi];
        const latRaw = el.getAttribute("lat");
        const lonRaw = el.getAttribute("lon");
        const lat = latRaw === null || latRaw.trim() === "" ? NaN : Number(latRaw);
        const lon = lonRaw === null || lonRaw.trim() === "" ? NaN : Number(lonRaw);
        // 6.1-5: 잘못된 필수 좌표가 하나라도 있으면 위치를 알려 주고 파일을 거절한다.
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          throw new ImportError("invalid_coordinate", "좌표 오류", { track: ti + 1, segment: si + 1, point: pi + 1 });
        }
        const time = firstChildText(el, "time", ns);
        pts.push(time ? { lat, lon, time } : { lat, lon });
        processed++;
        if (processed % chunkSize === 0) {
          opts.onProgress?.("extract", processed / Math.max(totalPoints, 1));
          await checkpoint();
        }
      }
      // 빈 trkseg는 그릴 것이 없으므로 건너뛴다. 이웃 구간을 잇지는 않는다.
      if (pts.length > 0) segments.push(pts);
    }
    tracks.push({
      index: ti,
      name: firstChildText(trkEls[ti], "name", ns),
      segments,
      pointCount: segments.reduce((s, a) => s + a.length, 0),
    });
  }
  opts.onProgress?.("extract", 1);
  await checkpoint();

  return { tracks, totalSegments, totalPoints };
}

/** 유효 작품 조건(6): 서로 다른 위치의 2점 이상으로 된 구간이 하나 이상. */
export function hasDrawableSegment(track: GpxTrack): boolean {
  return track.segments.some((seg) => seg.some((p) => p.lat !== seg[0].lat || p.lon !== seg[0].lon));
}
