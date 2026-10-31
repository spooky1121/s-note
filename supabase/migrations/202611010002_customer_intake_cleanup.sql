-- 0001 접수 마이그레이션 적용 후, 운영 배포 전에 전체 실행하세요.
-- 고지한 30일 보관정책을 이행하려면 이 스케줄을 반드시 활성화해야 합니다.
-- pg_cron을 지원하는 Supabase SQL Editor의 관리 권한으로 실행합니다.
begin;
create extension if not exists pg_cron;

-- 같은 이름의 작업을 먼저 해제하여 여러 번 적용해도 중복 실행하지 않습니다.
do $schedule$
declare
  v_job bigint;
begin
  for v_job in select job.jobid from cron.job as job where job.jobname = 'snote-customer-intake-daily-purge' loop
    perform cron.unschedule(v_job);
  end loop;
  perform cron.schedule(
    'snote-customer-intake-daily-purge',
    '0 18 * * *',
    'select public.snote_intake_purge();'
  );
end;
$schedule$;
commit;

-- 등록 확인: 매일 UTC 18:00(한국시간 다음 날 03:00), active=true, 정확한 정리 함수여야 합니다.
select jobid, jobname, schedule, command, active
  from cron.job where jobname = 'snote-customer-intake-daily-purge';
-- 다음 실행 후 확인: status=succeeded인지 확인하고 실패 시 운영 배포를 완료로 보지 마세요.
select detail.jobid, detail.status, detail.start_time, detail.end_time
  from cron.job_run_details as detail
  join cron.job as job on job.jobid = detail.jobid
  where job.jobname = 'snote-customer-intake-daily-purge'
  order by detail.start_time desc limit 5;
