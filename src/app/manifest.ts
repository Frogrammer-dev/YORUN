import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "요런 — 드로잉 러닝",
    short_name: "요런",
    description: "내 주변 길에서 그림 러닝 코스를 찾고, 달린 선을 작품으로 남겨요.",
    start_url: "/routes",
    display: "standalone",
    background_color: "#faf8f5",
    theme_color: "#0A72D6",
    lang: "ko",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
