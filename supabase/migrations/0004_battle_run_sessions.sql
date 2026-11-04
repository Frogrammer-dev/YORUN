-- Only hashes and server times; location data stays on the device until entry.
create table public.battle_run_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_id bigint not null, course_hash text not null,
  started timestamptz not null default now(),
  checkpoint_hash text, checkpoint_count integer, checkpoint_time integer,
  trace_hash text, sealed_at timestamptz,
  unique(owner_id,run_id)
);
alter table public.battle_run_sessions enable row level security;
revoke all on public.battle_run_sessions from public,anon,authenticated;
grant select,insert,update on public.battle_run_sessions to service_role;
