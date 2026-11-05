-- 8인 경기 매칭 대기를 10초로 줄인다. 10초 안에 8명이 모이지 않으면 봇이 빈 자리를 채운다.
alter table public.booth_races alter column closes set default now()+interval '10 seconds';
