import { describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
const { transformStyle } = await import("@/components/map/basemap");

const style = {
  version: 8,
  layers: [
    { id: "background", type: "background" },
    { id: "road", type: "line" },
    { id: "building", type: "fill" },
    { id: "building-3d", type: "fill-extrusion" },
    { id: "place_label", type: "symbol", layout: { "text-field": ["case", ["has", "name:nonlatin"], ["concat", ["get", "name:latin"], " ", ["get", "name:nonlatin"]], ["get", "name"]] } },
    { id: "road_shield", type: "symbol", layout: { "text-field": ["to-string", ["get", "ref"]] } },
  ],
};

describe("바탕 지도 스타일", () => {
  it("단순 지도: 글자·아이콘·건물 층 제거 (길만 남김)", () => {
    const ids = transformStyle(style, "simple").layers.map((l) => l.id);
    expect(ids).toEqual(["background", "road"]);
  });

  it("기본 지도: 한국어 지명 우선, 3D 건물 제거, 다른 글자는 유지", () => {
    const out = transformStyle(style, "standard").layers;
    expect(out.map((l) => l.id)).not.toContain("building-3d");
    const label = out.find((l) => l.id === "place_label")!;
    expect(label.layout!["text-field"]).toEqual(["coalesce", ["get", "name:ko"], ["get", "name:nonlatin"], ["get", "name"]]);
    expect(out.find((l) => l.id === "road_shield")!.layout!["text-field"]).toEqual(["to-string", ["get", "ref"]]);
  });
});
