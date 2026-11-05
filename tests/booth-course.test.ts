import { describe, expect, it } from "vitest";
import { extract, extractOutline, nodes, shapes } from "@/components/booth/course";
import { findBoothCourse, presetShape } from "@/components/booth/engine";
import roads from "@/components/booth/roads.json";

const connected = (path: number[]) => path.every((id, i) => Number.isInteger(id) && nodes[id] && (i === 0 || id !== path[i - 1]));

describe("부스 코스", () => {
  it.each(shapes)("%s: 도로만 따라 닫힌 코스를 만든다", (shape) => {
    const course = extract(shape, [0, 0]);
    expect(connected(course.path)).toBe(true);
    expect(course.path[0]).toBe(course.path[course.path.length - 1]);
    expect(course.distance).toBeGreaterThan(0);
  });

  it("설명으로 만든 윤곽도 크기와 위치에 상관없이 닫힌 코스가 된다", () => {
    const square: [number, number][] = [[10, 10], [14, 10], [14, 14], [10, 14]];
    const small = extractOutline(square, [0, 0]);
    const large = extractOutline(square.map(([x, y]) => [x * 100, y * 100] as [number, number]), [0, 0]);
    expect(small.path).toEqual(large.path);
    expect(connected(small.path)).toBe(true);
    expect(small.path[0]).toBe(small.path[small.path.length - 1]);
  });

  it("윤곽의 위쪽(y 증가)은 지도의 위쪽(y 감소)으로 간다", () => {
    const tall: [number, number][] = [[-0.2, -1], [0.2, -1], [0, 1]];
    const course = extractOutline(tall, [0, 0]);
    const ys = course.path.map((id) => nodes[id][1]);
    expect(nodes[course.path[0]][1]).toBeGreaterThan(Math.min(...ys));
  });

  it("도로를 세 곳도 잇지 못하면 코스를 만들지 않는다", () => {
    expect(() => extractOutline([[0, 0], [0.0001, 0], [0, 0.0001]], [0, 0])).not.toThrow();
    expect(() => extractOutline([[0, 0], [0, 0], [0, 0]], [0, 0])).toThrow();
  });
});

describe("부스 코스 탐색 엔진", () => {
  const edges = new Set(roads.edges.flatMap(([a, b]) => [`${a},${b}`, `${b},${a}`]));
  it.each(shapes)("%s: 실제 도로 간선만 지나는 닫힌 코스를 찾고 왕복 잔가지가 없다", (shape) => {
    const target = presetShape(shape)!;
    const course = findBoothCourse(target, [0, 0], { timeBudgetMs: 2000 })!;
    expect(course.path[0]).toBe(course.path[course.path.length - 1]);
    course.path.slice(1).forEach((id, i) => expect(edges.has(`${course.path[i]},${id}`)).toBe(true));
    course.path.slice(2).forEach((id, i) => expect(id).not.toBe(course.path[i]));
  });
});
