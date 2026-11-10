import { describe, expect, it } from "vitest";
import { trialArtwork, trialTrack } from "@/lib/art/fromTrial";
import { GUEST_RECORDS, type TrialRecord } from "@/lib/battle/trialRecords";
import { trackDistanceMeters } from "@/lib/gpx/metrics";

describe("체험·기본 코스 → 작품", () => {
  const square: TrialRecord = { id: "t1", name: "네모", line: [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], meters: 400, paceSecPerKm: 330, style: "balance" };

  it("미터 상대 좌표를 위경도로 옮겨도 거리가 거의 같다", () => {
    expect(trackDistanceMeters(trialTrack(square))).toBeGreaterThan(395);
    expect(trackDistanceMeters(trialTrack(square))).toBeLessThan(405);
  });

  it("y가 아래인 좌표: y가 커지면 남쪽(위도 감소)", () => {
    const pts = trialTrack(square).segments[0];
    expect(pts[2].lat).toBeLessThan(pts[1].lat);
  });

  it("실제 활동이 아니므로 예시(demo)로, 제목에 종류를 붙인다", () => {
    const trial = trialArtwork(square, "trial");
    expect(trial.sourceKind).toBe("demo");
    expect(trial.title).toBe("네모 체험 코스");
    expect(trial.renderLines.length).toBe(1);
    expect(trialArtwork(square, "guest").title).toBe("네모 기본 코스");
  });

  it("게스트 기본 코스 다섯 개 모두 작품이 된다", () => {
    expect(GUEST_RECORDS).toHaveLength(5);
    for (const r of GUEST_RECORDS) expect(trialArtwork(r, "guest").renderLines[0].length).toBeGreaterThan(2);
  });
});
