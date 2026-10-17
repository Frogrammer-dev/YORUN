import { z } from "zod";
import { fetchOverpassUpstream } from "@/lib/route/osm";
import { readLocalRoads } from "@/lib/route/roadData.server";

export const runtime = "nodejs";
// 공용 Overpass로 받을 때는 30초 안팎 걸리기도 한다
export const maxDuration = 60;
const schema = z.object({ south: z.number().min(-85).max(85), north: z.number().min(-85).max(85), west: z.number().min(-180).max(180), east: z.number().min(-180).max(180) }).strict()
  .refine(b => b.north > b.south && b.east > b.west && b.north-b.south <= .1 && (b.east-b.west)*Math.cos((b.north+b.south)*Math.PI/360) <= .1);
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 1000) return Response.json({ error: "invalid_area" }, { status: 400 });
  let area: z.infer<typeof schema>;
  try { area = schema.parse(JSON.parse(raw)); } catch { return Response.json({ error: "invalid_area" }, { status: 400 }); }
  try {
    return Response.json(readLocalRoads(area), { headers: { "X-Overpass-Endpoint": "local-south-korea", "Cache-Control": "no-store" } });
  } catch (error) {
    if ((error as Error).message === "road_area_too_large") return Response.json({ error: "road_area_too_large" }, { status: 413 });
    if (process.env.NODE_ENV === "development") console.warn("Local road data:", (error as Error).message);
  }
  // ponytail: 로컬 도로 파일이 없는 서버(Vercel 등)는 공용 Overpass로 받는다. 혼잡하면 느리거나 거절된다.
  // 사용자가 늘면 도로 API 전용 서버나 도로 타일 파일로 옮긴다 (docs/local-roads.md).
  // 공용 서버는 가끔 500·429를 돌려주므로 잠깐 쉬고 한 번 더 시도한다
  for (let attempt = 0; ; attempt++) {
    try {
      const { text, endpoint } = await fetchOverpassUpstream(area, request.signal);
      return new Response(text, { headers: { "Content-Type": "application/json", "X-Overpass-Endpoint": endpoint, "Cache-Control": "no-store" } });
    } catch (error) {
      if (attempt === 0 && !request.signal.aborted) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const busy = /busy|overpass_5\d\d/.test((error as Error).message);
      return Response.json({ error: busy ? "road_data_busy" : "road_data_unavailable" }, { status: 503 });
    }
  }
}
