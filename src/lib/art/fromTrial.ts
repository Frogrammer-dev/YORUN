// 체험 완주 기록·게스트 기본 코스(위치를 뺀 상대 모양)를 작품으로 만든다.
// 실제로 달린 기록이 아니므로 예시(demo)로 표시하고, 도로망은 붙이지 않는다(원래 위치가 없다).

import type { TrialRecord } from "@/lib/battle/trialRecords";
import type { GpxTrack } from "@/lib/gpx/parser";
import type { ArtworkView } from "@/lib/contracts/types";
import { buildArtwork } from "./artwork";

const M_PER_DEG = 111_320;

/** 미터 단위 상대 좌표(y가 아래)를 적도 근처 임의 원점의 위경도로 옮긴다. 작품은 모양만 쓰고 위치는 보관하지 않는다 */
export function trialTrack(record: Pick<TrialRecord, "name" | "line">): GpxTrack {
  const points = record.line.map(([x, y]) => ({ lat: -y / M_PER_DEG, lon: x / M_PER_DEG }));
  return { index: 0, name: record.name, segments: [points], pointCount: points.length };
}

export const trialTitle = (record: Pick<TrialRecord, "name">, kind: "trial" | "guest") => `${record.name} ${kind === "trial" ? "체험 코스" : "기본 코스"}`;

export function trialArtwork(record: TrialRecord, kind: "trial" | "guest"): ArtworkView {
  return buildArtwork(trialTrack(record), { title: trialTitle(record, kind), sourceKind: "demo" }).view;
}
