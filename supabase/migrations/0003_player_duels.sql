create table public.duel_players (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  player_id uuid unique not null default gen_random_uuid(),
  stats jsonb not null, plan jsonb not null,
  updated timestamptz not null default now()
);
create table public.duel_matches (
  id uuid primary key, challenger uuid not null references auth.users(id) on delete cascade,
  defender uuid not null references auth.users(id) on delete cascade,
  result jsonb not null, played timestamptz not null default now(),
  check(challenger<>defender)
);
create index duel_players_recent on public.duel_players(updated desc);
create index duel_challenges on public.duel_matches(challenger,played desc);
create index duel_defenses on public.duel_matches(defender,played desc);
alter table public.duel_players enable row level security;
alter table public.duel_matches enable row level security;
revoke all on public.duel_players,public.duel_matches from public,anon,authenticated;
grant select,insert,update on public.duel_players to service_role;
grant select,insert on public.duel_matches to service_role;
