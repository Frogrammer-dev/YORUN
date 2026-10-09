// PGlite(WASM Postgres)로 supabase/migrations/0001_init.sql을 실행하고 RPC·RLS·권한 규칙을 확인한다.
// auth 스키마·역할은 Supabase를 흉내 낸 최소 스텁이다. 실제 Supabase 프로젝트 정책 시험을 대신하지 않는다.
// 실행: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const migration = readFileSync(process.argv[2], "utf8");
const db = new PGlite();

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated, service_role;
`);
await db.exec(migration);

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
await db.exec(`insert into auth.users values ('${A}'), ('${B}')`);

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};

async function as(uid, fn) {
  await db.exec(`set role ${uid ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
async function err(p) {
  try {
    await p;
    return "none";
  } catch (e) {
    return `${e.code}:${e.message}`;
  }
}
const q = (sql, params) => db.query(sql, params);
const rpc1 = async (sql, params) => (await q(sql, params)).rows[0];

const geom = {
  schemaVersion: 1,
  normalizationVersion: "local-plane-v1",
  sourceSegments: [[[0.1, 0.1], [0.5, 0.5], [0.9, 0.1]], [[0.3, 0.9]]],
  renderIndices: [[0, 2], [0]],
  renderMethod: "rdp",
  toleranceMeters: 2,
};
const stats = { distanceEstimateMeters: 123.4, recordedDate: "2026-10-01", pointCount: 4, segmentCount: 2 };
const req = (over = {}) => ({ clientRequestId: crypto.randomUUID(), title: "첫 번째 하트", sourceKind: "provided_gpx", geometry: geom, stats, ...over });

// ───── 작품 생성·중복 요청 (AT-13) ─────
const r1 = req();
const c1 = await as(A, () => rpc1("select public.create_artwork_and_place($1) r", [r1])).then((x) => x.r);
ok("A: 작품 생성 + 첫 방 생성 + 중앙 배치", c1.artworkId && c1.roomId && c1.itemId && c1.roomRevision === 1 && c1.duplicate === false, JSON.stringify(c1));
const c1b = await as(A, () => rpc1("select public.create_artwork_and_place($1) r", [r1])).then((x) => x.r);
ok("같은 요청 ID·같은 본문 → 기존 결과, 중복 없음", c1b.duplicate === true && c1b.artworkId === c1.artworkId);
ok("같은 요청 ID·다른 본문 → RC409", (await err(as(A, () => q("select public.create_artwork_and_place($1)", [{ ...r1, title: "다른 제목" }])))).startsWith("RC409"));

const item0 = (await as(A, () => q("select x, y, size, z_index from public.room_items"))).rows;
ok("첫 작품 배치 (0.5, 0.5, 0.3)", item0.length === 1 && item0[0].x === 0.5 && item0[0].size === 0.3);

const c2 = await as(A, () => rpc1("select public.create_artwork_and_place($1) r", [req({ title: "두 번째" })])).then((x) => x.r);
const items2 = (await as(A, () => q("select artwork_id, x, y, size, z_index from public.room_items order by z_index"))).rows;
ok("두 번째 작품은 겹치지 않는 슬롯 (0.1, 0.125, 0.16), z=1", items2[1].x === 0.1 && items2[1].y === 0.125 && items2[1].size === 0.16 && items2[1].z_index === 1, JSON.stringify(items2[1]));

// ───── 입력 검증 (AT-24, AT-19) ─────
const bad = async (name, over) => ok(name, (await err(as(A, () => q("select public.create_artwork_and_place($1)", [req(over)])))).startsWith("RC400"));
await bad("render 인덱스 역순 거절", { geometry: { ...geom, renderIndices: [[2, 0], [0]] } });
await bad("render 끝점 누락 거절", { geometry: { ...geom, renderIndices: [[0, 1], [0]] } });
await bad("render 구간 수 불일치 거절", { geometry: { ...geom, renderIndices: [[0, 2]] } });
await bad("정규화 범위 밖 좌표 거절", { geometry: { ...geom, sourceSegments: [[[0.01, 0.1], [0.5, 0.5], [0.9, 0.1]], [[0.3, 0.9]]] } });
await bad("geometry 알 수 없는 필드 거절", { geometry: { ...geom, origin: [35, 129] } });
await bad("pointCount 불일치 거절", { stats: { ...stats, pointCount: 5 } });
await bad("음수 거리 거절", { stats: { ...stats, distanceEstimateMeters: -1 } });
await bad("잘못된 날짜 거절", { stats: { ...stats, recordedDate: "2026-13-45" } });
await bad("요청 알 수 없는 필드 거절", { lat: 35 });
await bad("제목 제어 문자 거절", { title: "a\u0001b" });
await bad("문자열 좌표 거절", { geometry: { ...geom, sourceSegments: [[["0.1", 0.1], [0.5, 0.5], [0.9, 0.1]], [[0.3, 0.9]]] } });

// ───── 권한 (AT-12) ─────
ok("B는 A의 작품을 조회할 수 없음", (await as(B, () => q("select * from public.artworks"))).rows.length === 0);
ok("A 본인도 직접 INSERT 불가", (await err(as(A, () => q("insert into public.artworks (owner_id,title,geometry_json,stats_json,source_kind,client_request_id) values ($1,'x','{}','{}','demo',$2)", [A, crypto.randomUUID()])))).includes("permission denied"));
ok("A 본인도 직접 UPDATE 불가", (await err(as(A, () => q("update public.rooms set revision = 99")))).includes("permission denied"));
ok("A 본인도 직접 DELETE 불가", (await err(as(A, () => q("delete from public.room_items")))).includes("permission denied"));
ok("room_shares 직접 조회 불가 (authenticated)", (await err(as(A, () => q("select * from public.room_shares")))).includes("permission denied"));
ok("anon은 RPC 실행 불가", (await err(as(null, () => q("select public.create_artwork_and_place($1)", [req()])))).includes("permission denied"));
ok("anon은 작품 조회 불가", (await err(as(null, () => q("select * from public.artworks")))).includes("permission denied"));

// ───── 방 저장·버전 충돌 (AT-14) ─────
const room = (await as(A, () => q("select id, revision from public.rooms"))).rows[0];
const items = (await as(A, () => q("select id, artwork_id from public.room_items order by z_index"))).rows;
const layout = (rev, over = {}) => ({
  expectedRevision: rev,
  theme: "dark",
  items: items.map((it, i) => ({
    id: it.id,
    artworkId: it.artwork_id,
    x: i ? 0.2 : 0.6,
    y: 0.5,
    size: 0.16,
    rotationDeg: 10,
    zIndex: i,
    style: { strokeColor: "#E53E3E", strokeWidth: 0.01, frame: "neon" },
  })),
  ...over,
});
const s1 = await as(A, () => rpc1("select public.save_room($1, $2) r", [room.id, layout(room.revision)])).then((x) => x.r);
ok("기대 버전 일치 → 저장, 버전 +1", s1.revision === room.revision + 1);
ok("같은 이전 버전으로 다시 저장 → RC409 (자동 덮어쓰기 없음)", (await err(as(A, () => q("select public.save_room($1, $2)", [room.id, layout(room.revision)])))).startsWith("RC409"));
ok("B가 A의 방 저장 → RC404", (await err(as(B, () => q("select public.save_room($1, $2)", [room.id, layout(s1.revision)])))).startsWith("RC404"));
const outLayout = layout(s1.revision);
outLayout.items[0].x = 0.01;
ok("방 경계 밖 배치 거절", (await err(as(A, () => q("select public.save_room($1, $2)", [room.id, outLayout])))).startsWith("RC400"));
const urlLayout = layout(s1.revision);
urlLayout.items[0].style = { strokeColor: "url(http://x)", strokeWidth: 0.01, frame: "plain" };
ok("스타일 URL 거절", (await err(as(A, () => q("select public.save_room($1, $2)", [room.id, urlLayout])))).startsWith("RC400"));

// B의 작품을 A 방에 교차 참조
const cb = await as(B, () => rpc1("select public.create_artwork_and_place($1) r", [req()])).then((x) => x.r);
const cross = layout(s1.revision);
cross.items[1].artworkId = cb.artworkId;
ok("타인 작품 교차 참조 → 거절", (await err(as(A, () => q("select public.save_room($1, $2)", [room.id, cross])))).match(/^RC40[04]/));
ok("거절 뒤 A 배치는 그대로 (트랜잭션 롤백)", (await as(A, () => q("select count(*)::int n from public.room_items"))).rows[0].n === 2);

// ───── 제목 수정 ─────
const t1 = await as(A, () => rpc1("select public.update_artwork_title($1, $2, $3) r", [c1.artworkId, "새 제목", 0])).then((x) => x.r);
ok("제목 수정 → 작품·방 버전 증가", t1.artworkRevision === 1 && t1.roomRevision === s1.revision + 1);
ok("이전 작품 버전으로 수정 → RC409", (await err(as(A, () => q("select public.update_artwork_title($1, $2, $3)", [c1.artworkId, "x", 0])))).startsWith("RC409"));

// ───── 공유 (AT-16~18) ─────
const rev = (await as(A, () => q("select revision from public.rooms"))).rows[0].revision;
const h1 = "a".repeat(64);
ok("저장 버전과 다른 기대 버전으로 공유 → RC409", (await err(as(A, () => q("select public.create_room_share($1,$2,$3,true,false,null)", [room.id, rev - 1, h1])))).startsWith("RC409"));
const sh1 = await as(A, () => rpc1("select public.create_room_share($1,$2,$3,true,false,$4) r", [room.id, rev, h1, "러너"])).then((x) => x.r);
const snap = (await q("select snapshot_json s, source_artwork_ids ids from public.room_shares where id = $1", [sh1.shareId])).rows[0];
const sj = JSON.stringify(snap.s);
ok("스냅샷: 전시용 선만 (render 인덱스 적용)", JSON.stringify(snap.s.items.find((i) => i.title === "새 제목").lines) === JSON.stringify([[[0.1, 0.1], [0.9, 0.1]], [[0.3, 0.9]]]), JSON.stringify(snap.s.items[0].lines));
ok("스냅샷: owner·작품 ID·날짜·거리(미선택) 제외", !sj.includes(A) && !sj.includes(c1.artworkId) && !sj.includes("2026-10-01") && !sj.includes("distanceEstimateMeters"));
ok("스냅샷: 제목·표시 이름 포함(선택)", sj.includes("새 제목") && snap.s.displayName === "러너");
const h2 = "b".repeat(64);
const sh2 = await as(A, () => rpc1("select public.create_room_share($1,$2,$3,false,true,null) r", [room.id, rev, h2])).then((x) => x.r);
const active = (await q("select id from public.room_shares where revoked_at is null")).rows;
ok("새 링크 생성 시 이전 링크 폐기 (활성 1개)", active.filter((r) => r.id === sh1.shareId).length === 0 && active.some((r) => r.id === sh2.shareId));
const status = await as(A, () => rpc1("select public.get_my_share_status() r")).then((x) => x.r);
ok("소유자 공유 상태: 토큰 해시·스냅샷 제외", status.id === sh2.shareId && !JSON.stringify(status).includes("bbbb"));

// ───── 삭제 (AT-22) ─────
const d = await as(A, () => rpc1("select public.delete_artwork($1) r", [c1.artworkId])).then((x) => x.r);
const after = (await q("select revoked_at, snapshot_json from public.room_shares where id = $1", [sh2.shareId])).rows[0];
ok("작품 삭제 → 관련 공유 폐기·스냅샷 비움", after.revoked_at !== null && JSON.stringify(after.snapshot_json) === "{}");
ok("작품 삭제 → 배치 연쇄 삭제·방 버전 증가", (await as(A, () => q("select count(*)::int n from public.room_items"))).rows[0].n === 1 && d.roomRevision === rev + 1);
ok("B가 A 작품 삭제 → RC404", (await err(as(B, () => q("select public.delete_artwork($1)", [c2.artworkId])))).startsWith("RC404"));
ok("링크 폐기 소유권: B → RC404", (await err(as(B, () => q("select public.revoke_room_share($1)", [sh2.shareId])))).startsWith("RC404"));

// ───── 한도 ─────
for (let i = 0; i < 48; i++) await as(A, () => q("select public.create_artwork_and_place($1)", [req()]));
const cnt = (await as(A, () => q("select (select count(*)::int from public.artworks) a, (select count(*)::int from public.room_items) i"))).rows[0];
ok("전시 최대 20개, 초과분은 보관만", cnt.a === 49 && cnt.i === 20, JSON.stringify(cnt));
await as(A, () => q("select public.create_artwork_and_place($1)", [req()]));
ok("보관 최대 50개 → RC422", (await err(as(A, () => q("select public.create_artwork_and_place($1)", [req()])))).startsWith("RC422"));

// ───── 인증 없음 ─────
await db.exec("set role authenticated; select set_config('request.jwt.claim.sub', '', false);");
ok("auth.uid() 없음 → RC401", (await err(q("select public.create_artwork_and_place($1)", [req()]))).startsWith("RC401"));
await db.exec("reset role");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
