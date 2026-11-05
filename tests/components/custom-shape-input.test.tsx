// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomShapeInput } from "@/components/route/CustomShapeInput";
import { groupFromStrokes, isClosedShape, type ShapeGroup } from "@/lib/route/shapes";

type Point = [number, number];

function draw(surface: Element, points: Point[]) {
  const pointer = (type: string, point: Point) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: point[0], clientY: point[1] });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(surface, event);
  };
  pointer("pointerdown", points[0]);
  for (const p of points.slice(1, -1)) pointer("pointermove", p);
  pointer("pointerup", points[points.length - 1]);
}

function setup() {
  const onChange = vi.fn<(group: ShapeGroup | null) => void>();
  const result = render(<CustomShapeInput value={null} onChange={onChange} />);
  const surface = screen.getByRole("img", { name: /찾고 싶은 그림을 그리는 칸/ });
  return { ...result, surface, onChange, latest: () => onChange.mock.calls.at(-1)?.[0] };
}

beforeEach(() => {
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 240, width: 240, height: 240, toJSON: () => ({}) });
  Object.defineProperty(SVGElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
});

afterEach(() => vi.restoreAllMocks());

describe("내 그림 열린 선 입력", () => {
  it("손을 뗀 실제 좌표를 포함해 직선을 저장하고 미리보기를 닫지 않는다", () => {
    const { surface, latest } = setup();
    draw(surface, [[20, 40], [160, 40]]);
    expect((screen.getByRole("checkbox", { name: "시작점과 끝점 연결" }) as HTMLInputElement).checked).toBe(false);
    expect(surface.querySelector("path")?.getAttribute("d")).toBe("M20.0 40.0L160.0 40.0");
    expect(latest()?.parts[0].shape.points).toEqual([[-0.5, 0], [0.5, 0]]);
    expect(isClosedShape(latest()!.parts[0].shape)).toBe(false);
  });

  it("U자에 연결 옵션을 켜고 끄면 저장한 선과 표시가 함께 바뀐다", () => {
    const { surface, latest } = setup();
    draw(surface, [[20, 20], [20, 180], [180, 180], [180, 20]]);
    expect(latest()?.parts[0].shape.perimeter).toBe(3);
    const connect = screen.getByRole("checkbox", { name: "시작점과 끝점 연결" });
    fireEvent.click(connect);
    expect(surface.querySelector("path")?.getAttribute("d")?.endsWith("Z")).toBe(true);
    expect(latest()?.parts[0].shape.perimeter).toBe(4);
    expect(isClosedShape(latest()!.parts[0].shape)).toBe(true);
    fireEvent.click(connect);
    expect(surface.querySelector("path")?.getAttribute("d")?.endsWith("Z")).toBe(false);
    expect(latest()?.parts[0].shape.perimeter).toBe(3);
  });

  it("여러 획 사이를 연결하지 않고 작은 유효 획도 보존한다", () => {
    const { surface, latest } = setup();
    draw(surface, [[20, 20], [200, 20]]);
    draw(surface, [[20, 100], [25, 100]]);
    expect(latest()?.parts).toHaveLength(2);
    expect([...surface.querySelectorAll("path")].map((p) => p.getAttribute("d"))).toEqual(["M20.0 20.0L200.0 20.0", "M20.0 100.0L25.0 100.0"]);
    expect(latest()?.parts.every((part) => !isClosedShape(part.shape))).toBe(true);
  });

  it("탭은 획 수를 소비하지 않고 일곱 번째 유효 획은 안내한다", () => {
    const { surface, latest, onChange } = setup();
    draw(surface, [[20, 20], [21, 21]]);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("조금 더 길게");
    for (let i = 0; i < 6; i++) draw(surface, [[20, 30 + i * 25], [100, 30 + i * 25]]);
    expect(latest()?.parts).toHaveLength(6);
    draw(surface, [[130, 30], [200, 30]]);
    expect(latest()?.parts).toHaveLength(6);
    expect(surface.querySelectorAll("path")).toHaveLength(6);
    expect(screen.getByRole("alert").textContent).toContain("6개까지");
  });

  it("그룹 미리보기도 열린 선을 유지하고 글자 안내는 닫힌 윤곽이라고 구분한다", () => {
    const group = groupFromStrokes([[[0, 0], [0, 100], [100, 100]]])!;
    render(<CustomShapeInput value={group} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "글자" }));
    const preview = screen.getByRole("img", { name: /정리된 그림 미리보기/ });
    expect(preview.querySelector("path")?.getAttribute("d")?.endsWith("Z")).toBe(false);
    expect(screen.getByText(/굵은 글꼴의 닫힌 바깥 윤곽/)).toBeTruthy();
    expect(screen.queryByText(/글자 하나가 획 하나/)).toBeNull();
  });
});
