// 지도 장소 검색: 카카오 로컬 키워드 검색을 서버에서 대신 호출한다 (REST 키를 브라우저에 두지 않는다).
// 검색어만 카카오로 보내고, 사용자 위치·지도 영역은 보내지 않는다. 로그에 검색어를 남기지 않는다.
import { HttpError, clientKey, handle, limit, ok } from "@/lib/server/http";

export const runtime = "nodejs";

export interface Place {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

type KakaoDoc = { place_name: string; road_address_name: string; address_name: string; x: string; y: string };

export async function GET(req: Request) {
  return handle("places", async () => {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (!q || q.length > 60) throw new HttpError(400, "invalid_query", "검색어를 1~60자로 입력해 주세요.");
    const key = process.env.KAKAO_REST_API_KEY;
    if (!key) throw new HttpError(503, "search_unavailable", "장소 검색이 설정되지 않았어요. 지도를 직접 움직여 주세요.");
    limit(`places:${clientKey(req)}`, 30);
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?size=8&query=${encodeURIComponent(q)}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(5000), cache: "no-store" });
    } catch {
      throw new HttpError(502, "search_failed", "장소 검색 서버에 연결하지 못했어요.");
    }
    if (!res.ok) throw new HttpError(502, "search_failed", "장소를 검색하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    const body = (await res.json()) as { documents?: KakaoDoc[] };
    const places: Place[] = (body.documents ?? [])
      .map((d) => ({ name: d.place_name, address: d.road_address_name || d.address_name, lat: Number(d.y), lon: Number(d.x) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    return ok({ places });
  });
}
