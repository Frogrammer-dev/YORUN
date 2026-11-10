import type { NextConfig } from "next";

// 도로 파일(1.3GB)·CLIP 모델처럼 Vercel에 올릴 수 없는 데이터를 쓰는 API만 Azure 서버로 넘긴다.
// Azure 서버도 같은 코드를 빌드하므로 Vercel(또는 HEAVY_API_ORIGIN을 지정한 곳)에서만 켠다. 안 그러면 자기 자신으로 넘긴다.
const heavyApiOrigin = process.env.HEAVY_API_ORIGIN || (process.env.VERCEL ? "http://20.243.40.237" : "");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    if (!heavyApiOrigin) return [];
    return {
      // beforeFiles: 이 저장소의 app/api 경로보다 먼저 확인되어야 Vercel 자체 함수 대신 Azure가 응답한다
      beforeFiles: [
        { source: "/api/overpass", destination: `${heavyApiOrigin}/api/overpass` },
        { source: "/api/recognition", destination: `${heavyApiOrigin}/api/recognition` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        // 11.2: 공유 페이지는 noindex · no-referrer · no-store
        source: "/share/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
