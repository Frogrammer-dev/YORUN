// ArtworkRepository / RoomRepository의 조회 측 (8.3). 쓰기는 모두 DB RPC를 호출한다 (10.3).
// DB에서 읽은 값도 렌더 DTO 스키마로 다시 검사해, 잘못 저장된 값이 렌더러로 가지 않게 한다 (10.1).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtworkListItemDto, ArtworkView, MyRoomDto, RoomItem, ShareStatusDto } from "@/lib/contracts/types";
import { geometrySchema, renderLinesSchema, statsSchema, styleSchema } from "@/lib/contracts/schemas";
import { countRenderPoints, renderLines } from "@/lib/art/normalize";
import { API_LIMITS, THEMES, type Theme } from "@/lib/contracts/limits";
import { HttpError, mapDbError } from "./http";

interface ArtworkRow {
  id: string;
  title: string;
  source_kind: "provided_gpx" | "demo";
  revision: number;
  stats_json: unknown;
  geometry_json: unknown;
  created_at: string;
}

export function toArtworkView(row: ArtworkRow, { includeGeometry }: { includeGeometry: boolean }): ArtworkView | null {
  const g = geometrySchema.safeParse(row.geometry_json);
  const s = statsSchema.safeParse(row.stats_json);
  if (!g.success || !s.success) return null;
  const lines = renderLinesSchema.safeParse(renderLines(g.data));
  if (!lines.success) return null;
  return {
    id: row.id,
    title: row.title,
    sourceKind: row.source_kind,
    revision: row.revision,
    stats: s.data,
    renderLines: lines.data,
    renderPointCount: countRenderPoints(g.data),
    ...(includeGeometry ? { geometry: g.data } : {}),
  };
}

export async function loadMyRoom(supabase: SupabaseClient, uid: string): Promise<MyRoomDto> {
  const countRes = await supabase.from("artworks").select("id", { count: "exact", head: true }).eq("owner_id", uid);
  if (countRes.error) throw mapDbError(countRes.error);
  const artworkCount = countRes.count ?? 0;

  const roomRes = await supabase.from("rooms").select("id, theme, revision").eq("owner_id", uid).maybeSingle();
  if (roomRes.error) throw mapDbError(roomRes.error);
  if (!roomRes.data) return { room: null, items: [], artworks: [], share: null, artworkCount };
  const room = roomRes.data as { id: string; theme: Theme; revision: number };
  if (!THEMES.includes(room.theme)) room.theme = "light";

  const itemsRes = await supabase
    .from("room_items")
    .select("id, artwork_id, x, y, size, rotation_deg, z_index, style_json")
    .eq("room_id", room.id)
    .order("z_index");
  if (itemsRes.error) throw mapDbError(itemsRes.error);

  const ids = itemsRes.data.map((r) => r.artwork_id as string);
  const artworks: ArtworkView[] = [];
  if (ids.length) {
    // 초기 방 조회에는 전체 기준선을 내려보내지 않는다(전시용 선만). 기준선은 상세 API에서만.
    const artRes = await supabase
      .from("artworks")
      .select("id, title, source_kind, revision, stats_json, geometry_json, created_at")
      .in("id", ids);
    if (artRes.error) throw mapDbError(artRes.error);
    for (const row of artRes.data as ArtworkRow[]) {
      const v = toArtworkView(row, { includeGeometry: false });
      if (v) artworks.push(v);
    }
  }
  const valid = new Set(artworks.map((a) => a.id));
  const items: RoomItem[] = [];
  for (const r of itemsRes.data) {
    const style = styleSchema.safeParse(r.style_json);
    if (!style.success || !valid.has(r.artwork_id)) continue;
    items.push({
      id: r.id,
      artworkId: r.artwork_id,
      x: r.x,
      y: r.y,
      size: r.size,
      rotationDeg: r.rotation_deg,
      zIndex: r.z_index,
      style: style.data,
    });
  }

  const shareRes = await supabase.rpc("get_my_share_status");
  if (shareRes.error) throw mapDbError(shareRes.error);

  return { room, items, artworks, share: (shareRes.data as ShareStatusDto | null) ?? null, artworkCount };
}

function encodeCursor(createdAt: string, id: string) {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt)) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new HttpError(400, "invalid_cursor", "목록 위치 값이 올바르지 않아요.");
  }
  return { createdAt, id };
}

export async function listArtworks(
  supabase: SupabaseClient,
  uid: string,
  cursor: string | null,
  limitRaw: number,
): Promise<{ items: ArtworkListItemDto[]; nextCursor: string | null }> {
  const pageSize = Math.min(API_LIMITS.pageSize, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : API_LIMITS.pageSize));
  let q = supabase
    .from("artworks")
    .select("id, title, source_kind, revision, stats_json, created_at")
    .eq("owner_id", uid)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);
  if (cursor) {
    const c = decodeCursor(cursor);
    q = q.or(`created_at.lt.${c.createdAt},and(created_at.eq.${c.createdAt},id.lt.${c.id})`);
  }
  const res = await q;
  if (res.error) throw mapDbError(res.error);
  const rows = res.data.slice(0, pageSize);

  const displayedRes = await supabase.from("room_items").select("artwork_id").eq("owner_id", uid);
  if (displayedRes.error) throw mapDbError(displayedRes.error);
  const displayed = new Set(displayedRes.data.map((r) => r.artwork_id as string));

  const items: ArtworkListItemDto[] = [];
  for (const r of rows) {
    const s = statsSchema.safeParse(r.stats_json);
    if (!s.success) continue;
    items.push({
      id: r.id,
      title: r.title,
      sourceKind: r.source_kind,
      revision: r.revision,
      distanceEstimateMeters: s.data.distanceEstimateMeters,
      segmentCount: s.data.segmentCount,
      displayed: displayed.has(r.id),
      createdAt: r.created_at,
    });
  }
  const last = rows[rows.length - 1];
  return { items, nextCursor: res.data.length > pageSize && last ? encodeCursor(last.created_at, last.id) : null };
}
