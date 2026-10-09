-- 런캔버스 P0 스키마 (명세 9·10.2·10.3·11절)
-- - 모든 사용자 테이블 RLS, 직접 조회는 본인 행만, 직접 쓰기(INSERT/UPDATE/DELETE)는 금지
-- - 데이터 변경은 SECURITY DEFINER RPC로만: 매 호출 auth.uid() 확인, owner_id를 인자로 받지 않음
-- - 고정 search_path = '' 와 완전한 스키마 이름 사용, PUBLIC 실행 권한 제거
-- 사용자 정의 SQLSTATE: RC400 입력 오류 · RC401 인증 · RC404 없음/타인 · RC409 충돌 · RC422 한도/처리 불가


create schema if not exists app_private;
revoke all on schema app_private from public;

-- ───────────────────────── 테이블 ─────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 20),
  created_at timestamptz not null default now()
);

create table public.artworks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  geometry_json jsonb not null,
  stats_json jsonb not null,
  source_kind text not null check (source_kind in ('provided_gpx', 'demo')),
  revision integer not null default 0,
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (owner_id, client_request_id),
  unique (owner_id, id)
);
create index artworks_owner_created_idx on public.artworks (owner_id, created_at desc, id desc);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  theme text not null default 'light' check (theme in ('light', 'dark')),
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create table public.room_items (
  id uuid primary key,
  owner_id uuid not null,
  room_id uuid not null,
  artwork_id uuid not null,
  x double precision not null check (x between 0 and 1),
  y double precision not null check (y between 0 and 1),
  size double precision not null check (size between 0.08 and 0.30),
  rotation_deg double precision not null check (rotation_deg between -180 and 180),
  z_index integer not null check (z_index between 0 and 19),
  style_json jsonb not null,
  -- 복합 FK: 방과 작품이 같은 소유자일 때만 연결 가능 (다른 계정 교차 참조 차단)
  foreign key (owner_id, room_id) references public.rooms (owner_id, id) on delete cascade,
  foreign key (owner_id, artwork_id) references public.artworks (owner_id, id) on delete cascade,
  unique (room_id, artwork_id),
  unique (room_id, z_index)
);

create table public.room_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  room_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  source_revision integer not null,
  source_artwork_ids uuid[] not null,
  snapshot_json jsonb not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (owner_id, room_id) references public.rooms (owner_id, id) on delete cascade
);
-- 한 방에는 활성 링크 하나
create unique index room_shares_one_active on public.room_shares (room_id) where revoked_at is null;

-- ───────────────────────── 권한·RLS ─────────────────────────

alter table public.profiles enable row level security;
alter table public.artworks enable row level security;
alter table public.rooms enable row level security;
alter table public.room_items enable row level security;
alter table public.room_shares enable row level security;

revoke all on public.profiles, public.artworks, public.rooms, public.room_items, public.room_shares from anon, authenticated, public;
grant select on public.profiles, public.artworks, public.rooms, public.room_items to authenticated;
-- room_shares: 익명·사용자 직접 조회/쓰기 없음. 공개 조회는 서버의 ShareService 읽기 모듈(service_role)만.
grant select on public.room_shares to service_role;

create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy artworks_select_own on public.artworks for select to authenticated using ((select auth.uid()) = owner_id);
create policy rooms_select_own on public.rooms for select to authenticated using ((select auth.uid()) = owner_id);
create policy room_items_select_own on public.room_items for select to authenticated using ((select auth.uid()) = owner_id);

-- ───────────────────────── 내부 검사 함수 ─────────────────────────

create or replace function app_private.fail(p_code text, p_message text)
returns void language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = p_code, message = p_message;
end $$;

create or replace function app_private.require_uid()
returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then perform app_private.fail('RC401', 'unauthenticated'); end if;
  return v;
end $$;

create or replace function app_private.is_number(j jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select j is not null and jsonb_typeof(j) = 'number'
$$;

create or replace function app_private.has_exact_keys(j jsonb, keys text[])
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'object'
    then (j - keys) = '{}'::jsonb and (select count(*) from jsonb_object_keys(j)) = cardinality(keys)
    else false end
$$;

create or replace function app_private.clean_text(p text, p_max int)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := btrim(p);
begin
  if v is null or char_length(v) < 1 or char_length(v) > p_max or v ~ '[\x01-\x1f\x7f]' then
    perform app_private.fail('RC400', 'invalid_text');
  end if;
  return v;
end $$;

-- 작품 형상 검사: 10.1의 모든 규칙을 DB에서도 강제한다. 반환: {pointCount, segmentCount, renderCount}
create or replace function app_private.validate_geometry(g jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  segs jsonb; ris jsonb; seg jsonb; idx jsonb; pt jsonb;
  nseg int; n int; m int; i int; j int; k int; prev int;
  total int := 0; rtotal int := 0;
  first_pt jsonb := null; spread boolean := false;
  u double precision; v double precision;
begin
  if not app_private.has_exact_keys(g, array['schemaVersion','normalizationVersion','sourceSegments','renderIndices','renderMethod','toleranceMeters']) then
    perform app_private.fail('RC400', 'geometry_fields');
  end if;
  if g->'schemaVersion' <> '1'::jsonb or g->>'normalizationVersion' <> 'local-plane-v1'
     or g->>'renderMethod' <> 'rdp' or g->'toleranceMeters' <> '2'::jsonb then
    perform app_private.fail('RC400', 'geometry_version');
  end if;
  segs := g->'sourceSegments';
  ris := g->'renderIndices';
  if jsonb_typeof(segs) <> 'array' or jsonb_typeof(ris) <> 'array' then perform app_private.fail('RC400', 'geometry_shape'); end if;
  nseg := jsonb_array_length(segs);
  if nseg < 1 or nseg > 200 then perform app_private.fail('RC400', 'segment_count'); end if;
  if jsonb_array_length(ris) <> nseg then perform app_private.fail('RC400', 'render_segment_mismatch'); end if;

  for i in 0 .. nseg - 1 loop
    seg := segs->i;
    if jsonb_typeof(seg) <> 'array' then perform app_private.fail('RC400', 'segment_shape'); end if;
    n := jsonb_array_length(seg);
    if n < 1 then perform app_private.fail('RC400', 'empty_segment'); end if;
    total := total + n;
    if total > 20000 then perform app_private.fail('RC400', 'source_point_limit'); end if;
    for j in 0 .. n - 1 loop
      pt := seg->j;
      if jsonb_typeof(pt) <> 'array' or jsonb_array_length(pt) <> 2
         or not app_private.is_number(pt->0) or not app_private.is_number(pt->1) then
        perform app_private.fail('RC400', 'point_shape');
      end if;
      u := (pt->>0)::double precision;
      v := (pt->>1)::double precision;
      if u < 0.05 or u > 0.95 or v < 0.05 or v > 0.95 then perform app_private.fail('RC400', 'point_range'); end if;
      if first_pt is null then first_pt := pt; elsif pt <> first_pt then spread := true; end if;
    end loop;

    idx := ris->i;
    if jsonb_typeof(idx) <> 'array' then perform app_private.fail('RC400', 'render_shape'); end if;
    m := jsonb_array_length(idx);
    if m < 1 then perform app_private.fail('RC400', 'render_empty'); end if;
    rtotal := rtotal + m;
    if rtotal > 2000 then perform app_private.fail('RC400', 'render_point_limit'); end if;
    prev := -1;
    for j in 0 .. m - 1 loop
      if jsonb_typeof(idx->j) <> 'number' or (idx->>j) !~ '^\d+$' then perform app_private.fail('RC400', 'render_index_type'); end if;
      k := (idx->>j)::int;
      if k <= prev or k >= n then perform app_private.fail('RC400', 'render_index_order'); end if;
      prev := k;
    end loop;
    if (idx->>0)::int <> 0 or prev <> n - 1 then perform app_private.fail('RC400', 'render_endpoints'); end if;
  end loop;

  if not spread then perform app_private.fail('RC422', 'degenerate'); end if;
  return jsonb_build_object('pointCount', total, 'segmentCount', nseg, 'renderCount', rtotal);
end $$;

create or replace function app_private.validate_stats(s jsonb, counts jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare d text;
begin
  if not app_private.has_exact_keys(s, array['distanceEstimateMeters','recordedDate','pointCount','segmentCount']) then
    perform app_private.fail('RC400', 'stats_fields');
  end if;
  if not app_private.is_number(s->'distanceEstimateMeters') or (s->>'distanceEstimateMeters')::double precision < 0 then
    perform app_private.fail('RC400', 'distance');
  end if;
  if s->'pointCount' <> counts->'pointCount' or s->'segmentCount' <> counts->'segmentCount' then
    perform app_private.fail('RC400', 'stats_count_mismatch');
  end if;
  if jsonb_typeof(s->'recordedDate') <> 'null' then
    d := s->>'recordedDate';
    if jsonb_typeof(s->'recordedDate') <> 'string' or d !~ '^\d{4}-\d{2}-\d{2}$' then perform app_private.fail('RC400', 'recorded_date'); end if;
    begin
      perform d::date;
    exception when others then
      perform app_private.fail('RC400', 'recorded_date');
    end;
  end if;
end $$;

create or replace function app_private.validate_style(s jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if not app_private.has_exact_keys(s, array['strokeColor','strokeWidth','frame'])
     or jsonb_typeof(s->'strokeColor') <> 'string' or (s->>'strokeColor') !~ '^#[0-9A-Fa-f]{6}$'
     or not app_private.is_number(s->'strokeWidth')
     or (s->>'strokeWidth')::double precision < 0.002 or (s->>'strokeWidth')::double precision > 0.03
     or jsonb_typeof(s->'frame') <> 'string' or (s->>'frame') not in ('plain', 'paper', 'neon') then
    perform app_private.fail('RC400', 'style');
  end if;
end $$;

-- 회전·액자 포함 경계 상자의 반폭(방 픽셀). lib/room/geometry.ts의 itemBounds와 같은 식.
create or replace function app_private.item_half(p_size double precision, p_rot double precision)
returns double precision language sql immutable set search_path = '' as $$
  select p_size * 500.0 * (abs(cos(radians(p_rot))) + abs(sin(radians(p_rot))))
$$;

create or replace function app_private.item_fits(p_x double precision, p_y double precision, p_size double precision, p_rot double precision)
returns boolean language sql immutable set search_path = '' as $$
  select p_x * 1000 - app_private.item_half(p_size, p_rot) >= -1e-6
     and p_x * 1000 + app_private.item_half(p_size, p_rot) <= 1000 + 1e-6
     and p_y * 750 - app_private.item_half(p_size, p_rot) >= -1e-6
     and p_y * 750 + app_private.item_half(p_size, p_rot) <= 750 + 1e-6
$$;

-- 전시용 선: sourceSegments[i][renderIndices[i][k]]
create or replace function app_private.render_lines(g jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(
    (select jsonb_agg(s.seg -> (ri.value::text)::int order by ri.ord)
       from jsonb_array_elements(g->'renderIndices'->((s.ord - 1)::int)) with ordinality as ri(value, ord))
    order by s.ord), '[]'::jsonb)
  from jsonb_array_elements(g->'sourceSegments') with ordinality as s(seg, ord)
$$;

create or replace function app_private.lock_own_room(p_uid uuid)
returns public.rooms language plpgsql set search_path = '' as $$
declare r public.rooms;
begin
  insert into public.rooms (owner_id) values (p_uid) on conflict (owner_id) do nothing;
  select * into r from public.rooms where owner_id = p_uid for update;
  return r;
end $$;

-- ───────────────────────── RPC ─────────────────────────

-- 요청 중복 확인·최초 방 확보·작품 생성·여유 슬롯 배치·방 버전 증가
create or replace function public.create_artwork_and_place(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app_private.require_uid();
  r public.rooms;
  existing public.artworks;
  v_crid uuid; v_title text; v_kind text; v_geom jsonb; v_stats jsonb; counts jsonb;
  v_art uuid; v_item uuid := null;
  cnt int; px double precision; py double precision; psize double precision; pz int;
  i int; sx double precision; sy double precision; placed boolean := false;
begin
  if not app_private.has_exact_keys(p_request, array['clientRequestId','title','sourceKind','geometry','stats']) then
    perform app_private.fail('RC400', 'request_fields');
  end if;
  begin
    v_crid := (p_request->>'clientRequestId')::uuid;
  exception when others then
    perform app_private.fail('RC400', 'client_request_id');
  end;
  if jsonb_typeof(p_request->'title') <> 'string' then perform app_private.fail('RC400', 'title'); end if;
  v_title := app_private.clean_text(p_request->>'title', 60);
  v_kind := p_request->>'sourceKind';
  if v_kind is null or v_kind not in ('provided_gpx', 'demo') then perform app_private.fail('RC400', 'source_kind'); end if;
  v_geom := p_request->'geometry';
  v_stats := p_request->'stats';
  counts := app_private.validate_geometry(v_geom);
  perform app_private.validate_stats(v_stats, counts);

  -- 방 행을 먼저 잠가 같은 사용자의 작품 생성·첫 방 생성을 직렬화한다.
  r := app_private.lock_own_room(uid);

  select * into existing from public.artworks where owner_id = uid and client_request_id = v_crid;
  if found then
    if existing.title = v_title and existing.source_kind = v_kind and existing.geometry_json = v_geom and existing.stats_json = v_stats then
      return jsonb_build_object(
        'artworkId', existing.id, 'roomId', r.id, 'roomRevision', r.revision, 'duplicate', true,
        'itemId', (select id from public.room_items where room_id = r.id and artwork_id = existing.id));
    end if;
    perform app_private.fail('RC409', 'request_id_reused');
  end if;

  if (select count(*) from public.artworks where owner_id = uid) >= 50 then
    perform app_private.fail('RC422', 'artwork_limit');
  end if;

  insert into public.artworks (owner_id, title, geometry_json, stats_json, source_kind, client_request_id)
  values (uid, v_title, v_geom, v_stats, v_kind, v_crid)
  returning id into v_art;

  select count(*) into cnt from public.room_items where room_id = r.id;
  -- 전시 한도에 도달하면 보관 목록에만 추가하고 기존 작품을 제거하지 않는다.
  if cnt < 20 then
    if cnt = 0 then
      px := 0.5; py := 0.5; psize := 0.3;
    else
      psize := 0.16;
      for i in 0 .. 19 loop
        sx := 0.1 + (i % 5) * 0.2;
        sy := 0.125 + (i / 5) * 0.25;
        if not exists (
          select 1 from public.room_items ri
          where ri.room_id = r.id
            and abs(sx * 1000 - ri.x * 1000) < 80 + app_private.item_half(ri.size, ri.rotation_deg)
            and abs(sy * 750 - ri.y * 750) < 80 + app_private.item_half(ri.size, ri.rotation_deg)
        ) then
          px := sx; py := sy; placed := true;
          exit;
        end if;
      end loop;
      if not placed then px := 0.1; py := 0.125; end if;
    end if;
    select min(z) into pz from generate_series(0, 19) z
      where not exists (select 1 from public.room_items where room_id = r.id and z_index = z);
    v_item := gen_random_uuid();
    insert into public.room_items (id, owner_id, room_id, artwork_id, x, y, size, rotation_deg, z_index, style_json)
    values (v_item, uid, r.id, v_art, px, py, psize, 0, pz,
            jsonb_build_object('strokeColor', '#E6155F', 'strokeWidth', 0.026, 'frame', 'paper'));
  end if;

  update public.rooms set revision = revision + 1, updated_at = now() where id = r.id returning revision into r.revision;
  return jsonb_build_object('artworkId', v_art, 'roomId', r.id, 'roomRevision', r.revision, 'itemId', v_item, 'duplicate', false);
end $$;

-- 작품 버전 비교·제목 수정·방 버전 증가
create or replace function public.update_artwork_title(p_artwork_id uuid, p_title text, p_expected_revision int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app_private.require_uid();
  r public.rooms;
  a public.artworks;
  v_title text := app_private.clean_text(p_title, 60);
begin
  r := app_private.lock_own_room(uid);
  select * into a from public.artworks where id = p_artwork_id and owner_id = uid for update;
  if not found then perform app_private.fail('RC404', 'not_found'); end if;
  if a.revision <> p_expected_revision then perform app_private.fail('RC409', 'artwork_revision_conflict'); end if;
  update public.artworks set title = v_title, revision = revision + 1 where id = a.id returning revision into a.revision;
  update public.rooms set revision = revision + 1, updated_at = now() where id = r.id returning revision into r.revision;
  return jsonb_build_object('artworkRevision', a.revision, 'roomRevision', r.revision);
end $$;

-- 작품 소유권·삭제·배치 제거(FK cascade)·관련 공유 폐기·방 버전 증가를 한 트랜잭션으로
create or replace function public.delete_artwork(p_artwork_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app_private.require_uid();
  r public.rooms;
begin
  r := app_private.lock_own_room(uid);
  delete from public.artworks where id = p_artwork_id and owner_id = uid;
  if not found then perform app_private.fail('RC404', 'not_found'); end if;
  update public.room_shares
     set revoked_at = now(), snapshot_json = '{}'::jsonb
   where owner_id = uid and revoked_at is null and p_artwork_id = any (source_artwork_ids);
  update public.rooms set revision = revision + 1, updated_at = now() where id = r.id returning revision into r.revision;
  return jsonb_build_object('roomRevision', r.revision);
end $$;

-- 방 버전 비교·모든 참조 소유권·배치 전부 저장·버전 증가
create or replace function public.save_room(p_room_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app_private.require_uid();
  r public.rooms;
  items jsonb; it jsonb; n int; i int;
  x double precision; y double precision; sz double precision; rot double precision; z int;
begin
  select * into r from public.rooms where id = p_room_id and owner_id = uid for update;
  if not found then perform app_private.fail('RC404', 'not_found'); end if;
  if not app_private.has_exact_keys(p_payload, array['expectedRevision','theme','items']) then
    perform app_private.fail('RC400', 'payload_fields');
  end if;
  if not app_private.is_number(p_payload->'expectedRevision') then perform app_private.fail('RC400', 'expected_revision'); end if;
  if (p_payload->>'expectedRevision')::numeric <> r.revision then perform app_private.fail('RC409', 'revision_conflict'); end if;
  if (p_payload->>'theme') is null or (p_payload->>'theme') not in ('light', 'dark') then perform app_private.fail('RC400', 'theme'); end if;
  items := p_payload->'items';
  if jsonb_typeof(items) <> 'array' then perform app_private.fail('RC400', 'items'); end if;
  n := jsonb_array_length(items);
  if n > 20 then perform app_private.fail('RC422', 'display_limit'); end if;

  for i in 0 .. n - 1 loop
    it := items->i;
    if not app_private.has_exact_keys(it, array['id','artworkId','x','y','size','rotationDeg','zIndex','style'])
       or not app_private.is_number(it->'x') or not app_private.is_number(it->'y') or not app_private.is_number(it->'size')
       or not app_private.is_number(it->'rotationDeg') or not app_private.is_number(it->'zIndex')
       or (it->>'zIndex') !~ '^\d+$' then
      perform app_private.fail('RC400', 'item_fields');
    end if;
    x := (it->>'x')::double precision; y := (it->>'y')::double precision;
    sz := (it->>'size')::double precision; rot := (it->>'rotationDeg')::double precision; z := (it->>'zIndex')::int;
    if x < 0 or x > 1 or y < 0 or y > 1 or sz < 0.08 or sz > 0.30 or rot < -180 or rot > 180 or z > 19 then
      perform app_private.fail('RC400', 'item_range');
    end if;
    if not app_private.item_fits(x, y, sz, rot) then perform app_private.fail('RC400', 'item_out_of_room'); end if;
    perform app_private.validate_style(it->'style');
  end loop;

  -- 중복 검사 (배치 ID·작품·zIndex)
  if (select count(distinct e->>'id') from jsonb_array_elements(items) e) <> n
     or (select count(distinct e->>'artworkId') from jsonb_array_elements(items) e) <> n
     or (select count(distinct e->>'zIndex') from jsonb_array_elements(items) e) <> n then
    perform app_private.fail('RC400', 'duplicate_item');
  end if;

  begin
    delete from public.room_items where room_id = r.id;
    -- 모든 참조 작품이 본인 소유인지 확인 (복합 FK도 같은 규칙을 강제)
    if exists (
      select 1 from jsonb_array_elements(items) e
      where not exists (select 1 from public.artworks a where a.id = (e->>'artworkId')::uuid and a.owner_id = uid)
    ) then
      perform app_private.fail('RC404', 'artwork_not_found');
    end if;
    insert into public.room_items (id, owner_id, room_id, artwork_id, x, y, size, rotation_deg, z_index, style_json)
    select (e->>'id')::uuid, uid, r.id, (e->>'artworkId')::uuid,
           (e->>'x')::double precision, (e->>'y')::double precision, (e->>'size')::double precision,
           (e->>'rotationDeg')::double precision, (e->>'zIndex')::int, e->'style'
      from jsonb_array_elements(items) e;
  exception
    when invalid_text_representation or unique_violation or foreign_key_violation then
      perform app_private.fail('RC400', 'item_reference');
  end;

  update public.rooms set theme = p_payload->>'theme', revision = revision + 1, updated_at = now()
   where id = r.id returning revision into r.revision;
  return jsonb_build_object('revision', r.revision);
end $$;

-- 저장 버전 확인·허용 DTO 복사·이전 링크 폐기·새 링크 생성
create or replace function public.create_room_share(
  p_room_id uuid, p_expected_revision int, p_token_hash text,
  p_include_titles boolean, p_include_distances boolean, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := app_private.require_uid();
  r public.rooms;
  v_name text := null;
  v_items jsonb; v_snapshot jsonb; v_ids uuid[]; v_points int;
  v_share uuid; v_exp timestamptz;
begin
  select * into r from public.rooms where id = p_room_id and owner_id = uid for update;
  if not found then perform app_private.fail('RC404', 'not_found'); end if;
  if r.revision <> p_expected_revision then perform app_private.fail('RC409', 'revision_conflict'); end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then perform app_private.fail('RC400', 'token_hash'); end if;
  if p_display_name is not null then v_name := app_private.clean_text(p_display_name, 20); end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'x', ri.x, 'y', ri.y, 'size', ri.size, 'rotationDeg', ri.rotation_deg, 'zIndex', ri.z_index,
           'style', ri.style_json,
           'title', case when coalesce(p_include_titles, false) then to_jsonb(a.title) end,
           'distanceEstimateMeters', case when coalesce(p_include_distances, false) then a.stats_json->'distanceEstimateMeters' end,
           'lines', app_private.render_lines(a.geometry_json)))
         order by ri.z_index), '[]'::jsonb),
         coalesce(array_agg(a.id), '{}'::uuid[])
    into v_items, v_ids
    from public.room_items ri
    join public.artworks a on a.id = ri.artwork_id and a.owner_id = ri.owner_id
   where ri.room_id = r.id and ri.owner_id = uid;

  select coalesce(sum(jsonb_array_length(x)), 0) into v_points
    from public.artworks a, jsonb_array_elements(a.geometry_json->'renderIndices') x
   where a.owner_id = uid and a.id = any (v_ids);

  if jsonb_array_length(v_items) = 0 then perform app_private.fail('RC422', 'room_empty'); end if;

  v_snapshot := jsonb_build_object('schemaVersion', 1, 'theme', r.theme, 'items', v_items);
  if v_name is not null then v_snapshot := v_snapshot || jsonb_build_object('displayName', v_name); end if;
  if v_points > 40000 or octet_length(v_snapshot::text) > 2 * 1024 * 1024 then
    perform app_private.fail('RC422', 'snapshot_limit');
  end if;

  update public.room_shares set revoked_at = now(), snapshot_json = '{}'::jsonb
   where room_id = r.id and revoked_at is null;

  v_exp := now() + interval '30 days';
  insert into public.room_shares (owner_id, room_id, token_hash, source_revision, source_artwork_ids, snapshot_json, expires_at)
  values (uid, r.id, p_token_hash, r.revision, v_ids, v_snapshot, v_exp)
  returning id into v_share;

  if v_name is not null then
    insert into public.profiles (id, display_name) values (uid, v_name)
    on conflict (id) do update set display_name = excluded.display_name;
  end if;

  return jsonb_build_object('shareId', v_share, 'expiresAt', v_exp, 'sourceRevision', r.revision);
end $$;

-- 링크 소유권·폐기시각 갱신
create or replace function public.revoke_room_share(p_share_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := app_private.require_uid();
begin
  update public.room_shares set revoked_at = now(), snapshot_json = '{}'::jsonb
   where id = p_share_id and owner_id = uid and revoked_at is null;
  if not found then perform app_private.fail('RC404', 'not_found'); end if;
end $$;

-- 소유자용 공유 상태 조회: 토큰 해시·스냅샷 제외
create or replace function public.get_my_share_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := app_private.require_uid(); s public.room_shares;
begin
  select * into s from public.room_shares
   where owner_id = uid and revoked_at is null and expires_at > now()
   order by created_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', s.id, 'expiresAt', s.expires_at, 'sourceRevision', s.source_revision, 'createdAt', s.created_at);
end $$;

-- ───────────────────────── 함수 실행 권한 ─────────────────────────

revoke all on all functions in schema app_private from public, anon, authenticated;
revoke all on function public.create_artwork_and_place(jsonb) from public, anon;
revoke all on function public.update_artwork_title(uuid, text, int) from public, anon;
revoke all on function public.delete_artwork(uuid) from public, anon;
revoke all on function public.save_room(uuid, jsonb) from public, anon;
revoke all on function public.create_room_share(uuid, int, text, boolean, boolean, text) from public, anon;
revoke all on function public.revoke_room_share(uuid) from public, anon;
revoke all on function public.get_my_share_status() from public, anon;

grant execute on function public.create_artwork_and_place(jsonb) to authenticated;
grant execute on function public.update_artwork_title(uuid, text, int) to authenticated;
grant execute on function public.delete_artwork(uuid) to authenticated;
grant execute on function public.save_room(uuid, jsonb) to authenticated;
grant execute on function public.create_room_share(uuid, int, text, boolean, boolean, text) to authenticated;
grant execute on function public.revoke_room_share(uuid) to authenticated;
grant execute on function public.get_my_share_status() to authenticated;
