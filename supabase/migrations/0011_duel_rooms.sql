-- 친구와 하는 1대1 대결 방. 방장이 방을 만들어 6자리 번호를 공유하고, 상대가 번호로 들어온다.
-- 매 턴 두 사람이 각자 선택을 내고, 둘 다 내면 서버가 판정한다. 상대의 선택은 판정 전까지 보여 주지 않는다.
-- 두 사람이 동시에 내도 서로 덮어쓰지 않게 선택은 사람마다 따로 둔다(host_choice, guest_choice).
-- 판정은 turn_no가 그대로일 때만 저장해 한 턴이 두 번 풀리지 않게 한다.
create table public.duel_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[0-9]{6}$'),
  host_id uuid not null references auth.users(id) on delete cascade,
  guest_id uuid references auth.users(id) on delete cascade,
  host_name text not null,
  guest_name text,
  host_sheet jsonb not null,
  guest_sheet jsonb,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  state jsonb,
  turn_no integer not null default 0,
  host_choice text check (host_choice in ('scissors', 'rock', 'paper', 'allin')),
  guest_choice text check (guest_choice in ('scissors', 'rock', 'paper', 'allin')),
  last_turn jsonb,
  -- 한 사람이 나가면 남은 사람이 이긴 것으로 끝낸다
  left_by text check (left_by in ('host', 'guest')),
  created timestamptz not null default now(),
  updated timestamptz not null default now(),
  -- 대기·진행 중인 방은 이 시각이 지나면 들어올 수도, 둘 수도 없다
  expires timestamptz not null default now() + interval '2 hours',
  check (guest_id is null or guest_id <> host_id),
  check (status = 'waiting' or (guest_id is not null and state is not null))
);
-- 끝나지 않은 방끼리는 번호가 겹치지 않는다 (끝난 방의 번호는 다시 쓸 수 있다)
create unique index duel_rooms_open_code on public.duel_rooms(code) where status <> 'finished';
create index duel_rooms_host on public.duel_rooms(host_id, updated desc);
create index duel_rooms_guest on public.duel_rooms(guest_id, updated desc);
alter table public.duel_rooms enable row level security;
revoke all on public.duel_rooms from public, anon, authenticated;
grant select, insert, update on public.duel_rooms to service_role;
