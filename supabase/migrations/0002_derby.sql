-- Only the authenticated Next.js endpoint can admit server-validated traces.
create table public.derby_entries (
  race uuid not null, lane smallint not null check(lane between 1 and 8),
  owner_id uuid not null, fingerprint text not null, stats jsonb not null,
  entered timestamptz not null default now(),
  primary key(race,lane), unique(race,owner_id), unique(owner_id,fingerprint)
);
alter table public.derby_entries enable row level security;
revoke all on public.derby_entries from public,anon,authenticated;
grant select,insert on public.derby_entries to service_role;

create function public.derby_enter(p_owner uuid,p_hash text,p_stats jsonb) returns uuid
language plpgsql set search_path='' as $$
declare chosen uuid; n integer;
begin
  perform pg_advisory_xact_lock(84192271);
  select race into chosen from public.derby_entries where owner_id=p_owner and fingerprint=p_hash;
  if found then return chosen; end if;
  select e.race into chosen from public.derby_entries e
    where e.owner_id=p_owner and (select count(*) from public.derby_entries other where other.race=e.race)<8
    limit 1;
  if found then return chosen; end if;
  select e.race,count(*) into chosen,n from public.derby_entries e group by e.race
    having count(*)<8 and not bool_or(e.owner_id=p_owner) order by min(e.entered) limit 1;
  if chosen is null then chosen:=gen_random_uuid(); n:=0; end if;
  insert into public.derby_entries(race,lane,owner_id,fingerprint,stats) values(chosen,n+1,p_owner,p_hash,p_stats);
  return chosen;
end $$;
revoke all on function public.derby_enter(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.derby_enter(uuid,text,jsonb) to service_role;
