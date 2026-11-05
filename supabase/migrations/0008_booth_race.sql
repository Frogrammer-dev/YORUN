-- 부스 전용 8인 경주. 가상 달리기 기록이라 실제 더비(derby_entries)와 섞지 않는다.
-- 첫 참가 뒤 60초가 지나거나 8명이 모이면 마감하고, 빈 레인은 서버가 연습 러너로 채운다.
create table public.booth_races (
  id uuid primary key default gen_random_uuid(),
  created timestamptz not null default now(),
  closes timestamptz not null default now()+interval '60 seconds'
);
create table public.booth_race_entries (
  race uuid not null references public.booth_races(id) on delete cascade,
  lane smallint not null check(lane between 1 and 8),
  owner_id uuid references auth.users(id) on delete set null,
  stats jsonb not null,
  entered timestamptz not null default now(),
  primary key(race,lane), unique(race,owner_id)
);
create index booth_race_entries_owner on public.booth_race_entries(owner_id);
alter table public.booth_races enable row level security;
alter table public.booth_race_entries enable row level security;
revoke all on public.booth_races,public.booth_race_entries from public,anon,authenticated;
grant select,insert on public.booth_races,public.booth_race_entries to service_role;

create function public.booth_race_enter(p_owner uuid,p_stats jsonb) returns uuid
language plpgsql set search_path='' as $$
declare chosen uuid; n integer;
begin
  perform pg_advisory_xact_lock(84192272);
  -- 이미 모집 중인 경주에 있으면 그 경주로 돌려보낸다
  select e.race into chosen from public.booth_race_entries e join public.booth_races r on r.id=e.race
    where e.owner_id=p_owner and r.closes>clock_timestamp()
      and (select count(*) from public.booth_race_entries o where o.race=e.race)<8
    limit 1;
  if found then return chosen; end if;
  select r.id into chosen from public.booth_races r
    where r.closes>clock_timestamp()
      and (select count(*) from public.booth_race_entries o where o.race=r.id)<8
    order by r.created limit 1;
  if chosen is null then
    insert into public.booth_races default values returning id into chosen;
  end if;
  select count(*) into n from public.booth_race_entries e where e.race=chosen;
  insert into public.booth_race_entries(race,lane,owner_id,stats) values(chosen,n+1,p_owner,p_stats);
  return chosen;
end $$;

-- 마감 판단은 DB 시계 하나로 한다. 서버 인스턴스마다 시각이 달라 결과가 바뀌는 일을 막는다.
create function public.booth_race_status(p_race uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'closed',clock_timestamp()>=r.closes or (select count(*) from public.booth_race_entries e where e.race=r.id)>=8,
    'secondsLeft',greatest(0,ceil(extract(epoch from r.closes-clock_timestamp())))::integer
  ) from public.booth_races r where r.id=p_race
$$;
revoke all on function public.booth_race_enter(uuid,jsonb),public.booth_race_status(uuid) from public,anon,authenticated;
grant execute on function public.booth_race_enter(uuid,jsonb),public.booth_race_status(uuid) to service_role;
