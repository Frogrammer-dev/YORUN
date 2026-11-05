import { describe, expect, it } from "vitest";
import { classifyBody, countFeet } from "@/lib/battle/bodyPlan";
import { boothRaceResult, boothStats } from "@/lib/battle/boothRace";
import { seededRandom } from "@/lib/battle/seed";

const circle = Array.from({ length: 24 }, (_, i) => [Math.cos((i / 24) * Math.PI * 2) * 100, Math.sin((i / 24) * Math.PI * 2) * 100]);
// y가 아래로 가는 좌표의 네 발 짐승과 두 발 인물
const animal = [[0, 0], [200, 0], [200, 100], [180, 100], [170, 40], [130, 40], [120, 100], [100, 100], [90, 40], [60, 40], [50, 100], [30, 100], [20, 40], [10, 100], [0, 100]];
const person = [[40, 0], [80, 0], [80, 60], [100, 60], [90, 120], [70, 120], [60, 80], [50, 120], [30, 120], [20, 60], [40, 60]];

describe("생김새로 고르는 달리기 방식", () => {
  it("이름이 있으면 이름을 먼저 본다", () => {
    expect(classifyBody(circle, "귀 한쪽이 접힌 토끼")).toBe("quadruped");
    expect(classifyBody(null, "강아지")).toBe("quadruped");
    expect(classifyBody(animal, "펭귄")).toBe("biped");
    expect(classifyBody(animal, "하트")).toBe("roller");
  });
  it("이름이 없으면 둥근 윤곽은 구르고, 아래 돌출부가 많으면 네 발이다", () => {
    expect(classifyBody(circle)).toBe("roller");
    expect(classifyBody(animal)).toBe("quadruped");
    expect(classifyBody(person)).toBe("biped");
  });
  it("바닥 근처 돌출부를 센다", () => {
    expect(countFeet(animal)).toBeGreaterThanOrEqual(3);
    expect(countFeet(person)).toBe(2);
    expect(countFeet(circle)).toBe(1);
  });
  it("닫힌 선의 끝점이 겹쳐도 같은 결과이고, 그림이 없으면 두 발이다", () => {
    expect(classifyBody([...circle, circle[0]])).toBe("roller");
    expect(classifyBody(null)).toBe("biped");
  });
});

describe("경기 결과의 몸 유형", () => {
  it("빈 레인의 봇도 몸 유형을 갖고, 참가자의 선택을 그대로 전한다", () => {
    const replay = boothRaceResult("race-body", [{ lane: 1, name: "나", stats: boothStats("balance", seededRandom("x")), mine: true, body: "roller" }]);
    expect(replay.placings.find((p) => p.mine)?.body).toBe("roller");
    expect(replay.placings.every((p) => ["biped", "quadruped", "roller"].includes(p.body))).toBe(true);
  });
});
