import { JSDOM } from "jsdom";
import { parseGpxText, type ParseOptions } from "@/lib/gpx/parser";

const { DOMParser } = new JSDOM("").window;
export const domParser = new DOMParser();

export function parse(xml: string, opts: ParseOptions = {}) {
  return parseGpxText(xml, { domParser, ...opts });
}

type P = [number, number, string?];

export function gpx(tracks: P[][][], { ns = 'xmlns="http://www.topografix.com/GPX/1/1"', prefix = "" } = {}) {
  const t = (n: string) => (prefix ? `${prefix}:${n}` : n);
  const pt = ([lat, lon, time]: P) =>
    `<${t("trkpt")} lat="${lat}" lon="${lon}">${time ? `<${t("time")}>${time}</${t("time")}>` : ""}</${t("trkpt")}>`;
  const body = tracks
    .map(
      (segs, i) =>
        `<${t("trk")}><${t("name")}>T${i + 1}</${t("name")}>` +
        segs.map((pts) => `<${t("trkseg")}>${pts.map(pt).join("")}</${t("trkseg")}>`).join("") +
        `</${t("trk")}>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><${t("gpx")} version="1.1" creator="test" ${ns}>${body}</${t("gpx")}>`;
}

/** 부산 근처 기준점에서 미터 단위 오프셋으로 점 생성 */
export function m(dxMeters: number, dyMeters: number, lat0 = 35.15, lon0 = 129.05): [number, number] {
  return [lat0 + dyMeters / 111_195, lon0 + dxMeters / (111_195 * Math.cos((lat0 * Math.PI) / 180))];
}
