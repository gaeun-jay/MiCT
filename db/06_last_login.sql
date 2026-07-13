-- ============================================================
-- 06_last_login.sql — 학생 마지막 로그인 일시 기록
--   · students.last_login_at 컬럼 추가
--   · record_login() : 로그인한 학생이 자기 행의 last_login_at 을 now() 로 갱신
--     (students 테이블은 관리자만 write 가능하므로 SECURITY DEFINER RPC 로 우회)
-- 재실행 안전(idempotent).
-- ============================================================

alter table public.students
  add column if not exists last_login_at timestamptz;

create or replace function public.record_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.students
     set last_login_at = now(),
         updated_at    = now()
   where auth_user_id = auth.uid();
end;
$$;

revoke all on function public.record_login() from public;
grant execute on function public.record_login() to authenticated;
