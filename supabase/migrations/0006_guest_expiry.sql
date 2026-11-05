-- 게스트(익명 계정)는 만든 지 6시간이 지나면 계정과 서버 데이터를 지운다.
-- 나머지 표는 auth.users 삭제에 함께 지워지고, 더비 기록은 계정 삭제와 같은 규칙(derby_forget)을 따른다.
create function public.purge_expired_guests() returns integer
language plpgsql set search_path='' as $$
declare guest record; removed integer:=0;
begin
  for guest in select u.id from auth.users u
    where u.is_anonymous and u.created_at<now()-interval '6 hours'
    order by u.created_at limit 500 loop
    perform public.derby_forget(guest.id);
    delete from auth.users where id=guest.id;
    removed:=removed+1;
  end loop;
  return removed;
end $$;
revoke all on function public.purge_expired_guests() from public,anon,authenticated,service_role;
