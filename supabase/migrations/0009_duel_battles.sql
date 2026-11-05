-- 사용자가 직접 고르는 1대1 턴 대결. 상대 판단과 올인 판정은 서버에서 하고 상태도 서버에 둔다.
-- 상대의 능력치는 시작할 때 복사한다. 상대 계정이 지워져도 내 전적은 이름 없이 남는다.
create table public.duel_battles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  opponent_name text not null,
  state jsonb not null,
  last_turn jsonb,
  finished boolean not null default false,
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create index duel_battles_recent on public.duel_battles(owner_id,updated desc);
alter table public.duel_battles enable row level security;
revoke all on public.duel_battles from public,anon,authenticated;
grant select,insert,update on public.duel_battles to service_role;
