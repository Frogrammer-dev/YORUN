// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { ShapeExplanation } from "@/components/route/ShapeExplanation";
import { SelectedCourse } from "@/components/route/SelectedCourse";
import { CourseList } from "@/components/route/CourseList";
import { normalizeRoadReferenceInput, parseRoadReferenceProposal } from "@/lib/art/roadReference";
import { makeCandidate } from "../helpers/candidate";

afterEach(cleanup);
function interpreted() {
  const c = makeCandidate({ shapeId: "doodle", shapeName: "옆얼굴", similarity: 0, outline: [], outlines: [] });
  const packet = normalizeRoadReferenceInput({ id: "road-01", latlngs: c.latlngs });
  c.semanticExplanation = parseRoadReferenceProposal(packet, {
    candidateId: "road-01", decision: "interpretation", label: { ko: "옆얼굴", en: "Face in profile" },
    reference: { coordinateSpace: packet.coordinateSpace,
      commands: [{ op: "M", to: [.2, .2] }, { op: "Q", control: [.9, .1], to: [.8, .7] }, { op: "L", to: [.2, .8] }, { op: "Z" }],
      observedParts: [{ name: "턱처럼 꺾인 부분", routeSpan: [.2, .5] }],
      imaginedParts: [{ name: "상상한 눈", commands: [{ op: "M", to: [.55, .35] }, { op: "L", to: [.6, .35] }] }],
    }, missingFeatures: ["코의 곡선"], explanation: "길의 꺾임을 옆얼굴의 턱으로 해석했어요.",
  }, { mode: "server-provider", provider: "openai", model: "test-model", promptVersion: "test-v1", generatedAt: "2026-10-14T00:00:00Z", sourceFingerprint: packet.fingerprint });
  return c;
}

it("toggles native/reference/imagined layers separately and keeps original road coordinates unchanged", async () => {
  const c = interpreted(), original = structuredClone(c);
  const { container } = render(<ShapeExplanation c={c} />);
  const nativePath = container.querySelector('[data-layer="native-route"]')!.getAttribute("d");
  expect(screen.getByText("턱처럼 꺾인 부분")).toBeTruthy();
  expect(screen.getByText("상상한 눈", { selector: "p" })).toBeTruthy();
  expect(screen.getByText("코의 곡선", { selector: "p" })).toBeTruthy();
  await userEvent.click(screen.getByRole("checkbox", { name: "참고 그림" }));
  expect(container.querySelector('[data-layer="reference"]')).toBeNull();
  expect(container.querySelector('[data-layer="native-route"]')!.getAttribute("d")).toBe(nativePath);
  await userEvent.click(screen.getByRole("checkbox", { name: "꾸밈선" }));
  expect(container.querySelector('[data-layer="imagined"]')).toBeNull();
  await userEvent.click(screen.getByRole("checkbox", { name: "실제 경로" }));
  expect(container.querySelector('[data-layer="native-route"]')).toBeNull();
  expect(c).toEqual(original);
});

it("describes interpretation as an experiment without turning zero geometric score into recognition percent", () => {
  const c = interpreted();
  const { container } = render(<><CourseList candidates={[c]} selected={c.id} discover onChoose={() => {}} onHover={() => {}} /><SelectedCourse c={c} elev="error" onRun={() => {}} onExport={() => {}} /></>);
  expect(screen.getByText("AI 해석 · 참고 그림")).toBeTruthy();
  expect(screen.getByText("옆얼굴처럼 보이는 코스")).toBeTruthy();
  expect(container.textContent).not.toMatch(/유사도 0|인식 0%|평균 12m/);
  expect(container.textContent).toContain("참고 그림과 꾸밈선은 달리는 길이 아니에요");
});

it("does not display a reference whose source fingerprint no longer matches the route", () => {
  const c = interpreted();
  c.latlngs[1][1] += .004;
  const { container } = render(<ShapeExplanation c={c} />);
  expect(container.querySelector("svg")).toBeNull();
});
