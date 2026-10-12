// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { ShapeExplanation } from "@/components/route/ShapeExplanation";
import { makeCandidate } from "../helpers/candidate";

it("keeps actual route unchanged while toggling the separate imaginary toast details", async () => {
  const c = makeCandidate();
  const original = structuredClone(c);
  const { container } = render(<ShapeExplanation c={c} />);
  expect(screen.getByText("토스트로 상상해 보기")).toBeTruthy();
  expect(screen.getByText(/인식 결과가 아닌 상상 예시/)).toBeTruthy();
  const path = container.querySelector('path[stroke="#0EA5E9"]')!.getAttribute("d");
  expect(container.querySelector('g[stroke="#9864C6"]')).toBeTruthy();
  await userEvent.click(screen.getByRole("checkbox"));
  expect(container.querySelector('g[stroke="#9864C6"]')).toBeNull();
  expect(container.querySelector('path[stroke="#0EA5E9"]')!.getAttribute("d")).toBe(path);
  expect(c).toEqual(original);
});
