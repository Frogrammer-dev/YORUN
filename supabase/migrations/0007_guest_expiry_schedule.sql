-- 10분마다 만료된 게스트를 지운다. 같은 이름으로 다시 실행하면 일정을 덮어쓴다.
-- 실행 기록 확인: select * from cron.job_run_details order by start_time desc limit 5;
create extension if not exists pg_cron;
select cron.schedule('purge-expired-guests','*/10 * * * *',$$select public.purge_expired_guests()$$);
