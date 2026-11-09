import { describe, expect, it } from "vitest";
import { railWheelStep } from "@/components/route/wheelRail";

const wheel = (deltaY: number, more: Partial<{ deltaX: number; deltaMode: number; ctrlKey: boolean }> = {}) => ({ deltaX: 0, deltaMode: 0, ctrlKey: false, deltaY, ...more });

describe("모양 줄 휠 이동", () => {
  it("세로 휠을 가로 이동으로 바꾼다", () => {
    expect(railWheelStep(wheel(100), 0, 500)).toBe(100);
    expect(railWheelStep(wheel(-100), 200, 500)).toBe(-100);
  });

  it("줄 끝에 닿으면 패널이 이어서 움직이도록 놓아준다", () => {
    expect(railWheelStep(wheel(100), 500, 500)).toBe(0);
    expect(railWheelStep(wheel(-100), 0, 500)).toBe(0);
    expect(railWheelStep(wheel(100), 0, 0)).toBe(0);
  });

  it("터치패드 가로 쓸기와 확대 동작은 건드리지 않는다", () => {
    expect(railWheelStep(wheel(10, { deltaX: 40 }), 100, 500)).toBe(0);
    expect(railWheelStep(wheel(100, { ctrlKey: true }), 100, 500)).toBe(0);
  });

  it("줄 단위 휠은 픽셀로 환산한다", () => {
    expect(railWheelStep(wheel(3, { deltaMode: 1 }), 100, 500)).toBe(48);
  });
});
