import { z } from "zod";
import { readLocalRoads } from "@/lib/route/roadData.server";

export const runtime = "nodejs";
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
    const large = (error as Error).message === "road_area_too_large";
    if (process.env.NODE_ENV === "development") console.warn("Local road data:", (error as Error).message);
    return Response.json({ error: large ? "road_area_too_large" : "road_data_unavailable" }, { status: large ? 413 : 503 });
  }
}
