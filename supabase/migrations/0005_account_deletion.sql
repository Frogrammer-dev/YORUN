-- 계정 삭제: 나머지 표는 auth.users 삭제에 함께 지워진다(on delete cascade). derby_entries만 연결이 없었다.
-- 끝난 경주는 다른 참가자의 결과이기도 하므로 지우지 않고, 누구의 기록인지 알 수 없게 만든다.
alter table public.derby_entries alter column owner_id drop not null;
alter table public.derby_entries alter column fingerprint drop not null;
update public.derby_entries e set owner_id=null,fingerprint=null
  where owner_id is not null and not exists(select 1 from auth.users u where u.id=e.owner_id);
alter table public.derby_entries add constraint derby_entries_owner_fkey
  foreign key(owner_id) references auth.users(id) on delete set null;
grant update,delete on public.derby_entries to service_role;

create function public.derby_forget(p_owner uuid) returns void
language plpgsql set search_path='' as $$
declare mine record; seat record;
begin
  perform pg_advisory_xact_lock(84192271);
  for mine in select e.race,e.lane from public.derby_entries e where e.owner_id=p_owner loop
    if (select count(*) from public.derby_entries o where o.race=mine.race)>=8 then
      update public.derby_entries set owner_id=null,fingerprint=null where race=mine.race and lane=mine.lane;
    else
      -- 아직 모집 중인 경주: 자리를 비우고 뒤 번호를 당겨 derby_enter의 번호 계산을 유지한다
      delete from public.derby_entries where race=mine.race and lane=mine.lane;
      for seat in select o.lane from public.derby_entries o where o.race=mine.race and o.lane>mine.lane order by o.lane loop
        update public.derby_entries set lane=seat.lane-1 where race=mine.race and lane=seat.lane;
      end loop;
    end if;
  end loop;
end $$;
revoke all on function public.derby_forget(uuid) from public,anon,authenticated;
grant execute on function public.derby_forget(uuid) to service_role;
