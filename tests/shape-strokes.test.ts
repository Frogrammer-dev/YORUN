import { describe, expect, it } from "vitest";
import { SHAPES, SHAPE_BY_ID, anchorsOf, groupFromLoops, groupFromStrokes, groupLines, isClosedShape } from "@/lib/route/shapes";

describe("열린 손그림 변환", () => {
  it("U자 선의 두 끝점을 보존하고 돌아오는 변을 추가하지 않는다", () => {
    const group = groupFromStrokes([[[0, 0], [0, 100], [100, 100], [100, 0]]])!;
    const shape = group.parts[0].shape;
    expect(isClosedShape(shape)).toBe(false);
    expect(shape.points).toEqual([[-0.5, 0.5], [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5]]);
    expect(shape.perimeter).toBe(3);
    expect(shape.features).toContainEqual(shape.points[0]);
    expect(shape.features).toContainEqual(shape.points.at(-1));
    const anchors = anchorsOf(shape, 12);
    expect(anchors[0]).toEqual(shape.points[0]);
    expect(anchors.at(-1)).toEqual(shape.points.at(-1));
  });

  it("두 점짜리 직선도 면적 없이 받아들이고 중복 좌표와 탭은 걸러낸다", () => {
    const shape = groupFromStrokes([[[10, 20], [10, 20], [110, 20]]])!.parts[0].shape;
    expect(shape.points).toEqual([[-0.5, 0], [0.5, 0]]);
    expect(shape.perimeter).toBe(1);
    expect(groupFromStrokes([[[10, 20], [10, 20]]])).toBeNull();
    expect(groupFromStrokes([[[10, 20], [Number.NaN, 20]]])).toBeNull();
  });

  it("여러 획은 입력 순서와 상대 위치를 보존하고 서로 연결하지 않는다", () => {
    const group = groupFromStrokes([[[200, 0], [300, 0]], [[0, 100], [100, 100]]])!;
    expect(group.parts).toHaveLength(2);
    expect(group.parts.every((part) => !isClosedShape(part.shape))).toBe(true);
    const lines = groupLines(group);
    expect(lines.map((line) => line.length)).toEqual([2, 2]);
    expect(lines[0][0][0]).toBeGreaterThan(lines[1][1][0]);
    expect(lines[0][0][1]).toBeGreaterThan(lines[1][0][1]);
  });

  it("명시적으로 연결을 선택했을 때만 기존 닫힌 윤곽을 만든다", () => {
    const u: [number, number][] = [[0, 0], [0, 100], [100, 100], [100, 0]];
    expect(groupFromStrokes([u], { closed: true })).toEqual(groupFromLoops([u]));
    const closed = groupFromStrokes([u], { closed: true })!.parts[0].shape;
    expect(isClosedShape(closed)).toBe(true);
    expect(closed.points[0]).toEqual(closed.points.at(-1));
    expect(closed.perimeter).toBe(4);
  });

  it("글자·이미지 윤곽 변환과 기본 그림의 닫힌 좌표를 유지한다", () => {
    const loops: [number, number][][] = [[[100, 0], [140, 0], [140, 40], [100, 40]], [[0, 0], [40, 0], [40, 40], [0, 40]]];
    const group = groupFromLoops(loops, { order: "leftToRight" })!;
    expect(group.parts[0].ox).toBeLessThan(group.parts[1].ox);
    for (const shape of [...SHAPES, ...group.parts.map((part) => part.shape)]) {
      expect(isClosedShape(shape)).toBe(true);
      expect(shape.closed).toBeUndefined();
      expect(shape.points[0]).toEqual(shape.points.at(-1));
    }
    expect(SHAPE_BY_ID.square.points).toEqual([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5]]);
  });
});
