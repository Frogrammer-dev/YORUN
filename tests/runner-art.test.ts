import { describe, expect, it } from "vitest";
import { FRAME_COUNT, runnerCreature, runnerPose } from "@/components/derby/runnerArt";
import { GUEST_RECORDS } from "@/lib/battle/trialRecords";
import { SHAPES } from "@/lib/route/shapes";

const BODIES = ["biped", "quadruped", "roller"] as const;
const lines = [...GUEST_RECORDS.map((r) => r.line), ...SHAPES.map((s) => s.points.map(([x, y]) => [x, -y]))];

describe("8인 경주 선수 그림", () => {
  it("봇도 모양과 눈, 부위를 갖고 레인마다 다른 모양을 쓴다", () => {
    for (const body of BODIES) {
      const made = [1, 2, 3, 4].map((lane) => runnerCreature(body, lane, null));
      expect(new Set(made.map((c) => JSON.stringify(c.lines))).size).toBe(4);
      for (const c of made) expect(Object.keys(c.parts).sort()).toEqual(["footL", "footR", "handL", "handR", "head"]);
    }
  });

  it("팔다리가 흔들려도 옆 프레임으로 넘어가지 않는다", () => {
    let low = Infinity, high = -Infinity;
    for (const body of BODIES) for (const line of lines) {
      const c = runnerCreature(body, 1, line);
      for (let frame = 0; frame < FRAME_COUNT; frame++) {
        const pose = runnerPose(c, body, frame);
        for (const [x, y] of [...pose.lines.flat(), ...pose.stubs.map((s) => s.to), pose.eye]) {
          low = Math.min(low, x, y);
          high = Math.max(high, x, y);
        }
      }
    }
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
  }, 30_000);

  it("프레임마다 자세가 달라진다", () => {
    const c = runnerCreature("biped", 1, GUEST_RECORDS[2].line);
    expect(JSON.stringify(runnerPose(c, "biped", 0).lines)).not.toBe(JSON.stringify(runnerPose(c, "biped", 2).lines));
  });
});
