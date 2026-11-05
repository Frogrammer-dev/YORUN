import { describe, expect, it } from "vitest";
import { buildDemoArtwork } from "@/lib/art/artwork";
import { DEFAULT_SPEED_MS, addResult, deform, josa, makeCreature, makeFighter, simulate, summarize } from "@/lib/battle/battle";
import type { Pt } from "@/lib/contracts/types";

// 사람 모양 막대 그림: 머리(위) · 두 팔(옆) · 두 다리(아래). 화면 y는 아래로 증가.
const stickman: Pt[][] = [
  [
    [0.5, 0.1],
    [0.5, 0.6],
  ],
  [
    [0.15, 0.4],
    [0.85, 0.4],
  ],
  [
    [0.5, 0.6],
    [0.3, 0.9],
  ],
  [
    [0.5, 0.6],
    [0.7, 0.9],
  ],
];
const square: Pt[][] = [
  [
    [0.3, 0.3],
    [0.7, 0.3],
    [0.7, 0.7],
    [0.3, 0.7],
    [0.3, 0.3],
  ],
];

describe("신체 부위 찾기", () => {
  it("막대 사람의 머리·손·발을 제자리에서 찾는다", () => {
    const { parts } = makeCreature(stickman);
    expect(parts.head.at[1]).toBeCloseTo(0.1, 2);
    expect(parts.handL.at[0]).toBeLessThan(0.25);
    expect(parts.handR.at[0]).toBeGreaterThan(0.75);
    expect(parts.footL.at).toEqual([0.3, 0.9]);
    expect(parts.footR.at).toEqual([0.7, 0.9]);
    expect(Object.values(parts).every((p) => !p.stub)).toBe(true);
  });

  it("옆으로 긴 강아지는 이미 있는 다리 끝을 발로 쓴다 (막대 다리를 붙이지 않는다)", () => {
    const { parts } = makeCreature(buildDemoArtwork("dog").view.renderLines);
    expect(parts.footL.stub).toBe(false);
    expect(parts.footR.stub).toBe(false);
    expect(parts.footL.at[1]).toBeGreaterThan(0.8);
    expect(parts.footR.at[1]).toBeGreaterThan(0.8);
  });

  it("튀어나온 곳이 없는 네모에는 막대 팔다리를 붙인다", () => {
    const { parts, center } = makeCreature(square);
    expect(parts.head.stub).toBe(true);
    expect(parts.head.at[1]).toBeLessThan(center[1]);
    expect(parts.footL.at[1]).toBeGreaterThan(center[1]);
  });

  it("손을 움직이면 손 근처만 크게 따라간다", () => {
    const c = makeCreature(stickman);
    const moved = deform(c, { handR: [0.2, 0] }).flat();
    const orig = c.lines.flat();
    const shift = (i: number) => moved[i][0] - orig[i][0];
    const handI = orig.findIndex((p) => p[0] === c.parts.handR.at[0] && p[1] === c.parts.handR.at[1]);
    const footI = orig.findIndex((p) => p[0] === c.parts.footL.at[0] && p[1] === c.parts.footL.at[1]);
    expect(shift(handI)).toBeCloseTo(0.2, 5);
    expect(shift(footI)).toBeLessThan(0.01);
  });
});

describe("능력치·싸움", () => {
  const fighter = (km: number, minPerKm: number | null, lines = stickman) =>
    makeFighter({ name: "x", renderLines: lines, distanceMeters: km * 1000, durationMs: minPerKm ? minPerKm * km * 60_000 : null });

  it("멀리 달릴수록 체력이 높고, 시간이 없으면 기본 속도를 쓴다", () => {
    expect(fighter(10, 6).hp).toBeGreaterThan(fighter(3, 6).hp);
    expect(fighter(30, 6).hp).toBe(312);
    expect(fighter(21, 6).hp).toBe(312);
    const noTime = fighter(5, null);
    expect(noTime.speedKnown).toBe(false);
    expect(noTime.speed).toBe(DEFAULT_SPEED_MS);
    expect(fighter(5, 4).agility).toBeGreaterThan(fighter(5, 7).agility);
  });

  it("같은 씨앗이면 같은 싸움, 빠른 쪽이 먼저 치고, 끝나면 진 쪽 체력이 0", () => {
    const a = fighter(5, 4.5),
      b = fighter(8, 7, square);
    const f = simulate(a, b, 42);
    expect(simulate(a, b, 42)).toEqual(f);
    expect(f.hits[0].by).toBe(0);
    const last = f.hits[f.hits.length - 1];
    if (f.ko) expect(last.hp[f.winner === 0 ? 1 : 0]).toBe(0);
    expect(f.hits.length).toBeLessThanOrEqual(40);
  });

  it("운이 섞여도 능력치 차이가 크면 대체로 강한 쪽이 이긴다", () => {
    const strong = fighter(20, 4.5),
      weak = fighter(1, 8, square);
    const wins = Array.from({ length: 200 }, (_, s) => simulate(strong, weak, s).winner === 0).filter(Boolean).length;
    expect(wins).toBeGreaterThan(170);
  });
});

describe("조사", () => {
  it("받침이 있으면 앞 조사, 없으면 뒤 조사, 한글이 아니면 둘 다", () => {
    expect(josa("강아지", "이", "가")).toBe("강아지가");
    expect(josa("나무 공원", "이", "가")).toBe("나무 공원이");
    expect(josa("비행기", "은", "는")).toBe("비행기는");
    expect(josa("곰", "과", "와")).toBe("곰과");
    expect(josa("Run 5", "이", "가")).toBe("Run 5이(가)");
  });
});

it("거리가 모양보다 크게 가른다: 1km 긴 팔다리는 10km 짧은 팔다리를 거의 못 이긴다", () => {
  const legs = (len: number): Pt[][] => [
    [
      [0.5, 0.1],
      [0.5, 0.6],
    ],
    [
      [0.5, 0.35],
      [0.5 - len, 0.35],
    ],
    [
      [0.5, 0.35],
      [0.5 + len, 0.35],
    ],
    [
      [0.5, 0.6],
      [0.5 - len, 0.95],
    ],
    [
      [0.5, 0.6],
      [0.5 + len, 0.95],
    ],
  ];
  const longShort = makeFighter({ name: "a", renderLines: legs(0.45), distanceMeters: 1000 }),
    shortFar = makeFighter({ name: "b", renderLines: legs(0.1), distanceMeters: 10_000 });
  expect(longShort.power).toBeGreaterThan(shortFar.power);
  const wins = Array.from({ length: 300 }, (_, s) => simulate(longShort, shortFar, s).winner === 0).filter(Boolean).length;
  expect(wins / 300).toBeLessThan(0.1);
});

describe("결과 요약", () => {
  it("양쪽에서 본 준 피해·받은 피해가 서로 맞물리고 남은 체력은 마지막 타격 기준", () => {
    const fight = {
      seed: 1,
      winner: 0 as const,
      ko: true,
      hits: [
        { by: 0 as const, dodged: false, crit: true, damage: 30, hp: [50, 20] as [number, number] },
        { by: 1 as const, dodged: true, crit: false, damage: 0, hp: [50, 20] as [number, number] },
        { by: 0 as const, dodged: false, crit: false, damage: 20, hp: [50, 0] as [number, number] },
      ],
    };
    expect(summarize(fight, 0, 50)).toEqual({ won: true, dealt: 50, taken: 0, crits: 1, dodges: 1, hpLeft: 50 });
    expect(summarize(fight, 1, 50)).toEqual({ won: false, dealt: 0, taken: 50, crits: 0, dodges: 0, hpLeft: 0 });
  });
});

describe("작품 전적", () => {
  it("이기면 연승이 쌓이고 지면 연승만 끊기며 최고 연승은 남는다", () => {
    let r = addResult({}, "dog", "tree");
    r = addResult(r, "dog", "plane");
    expect(r.dog).toEqual({ w: 2, l: 0, streak: 2, best: 2 });
    r = addResult(r, "tree", "dog");
    expect(r.dog).toEqual({ w: 2, l: 1, streak: 0, best: 2 });
    expect(r.tree).toEqual({ w: 1, l: 1, streak: 1, best: 1 });
  });
});
