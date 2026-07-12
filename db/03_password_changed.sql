-- ============================================================
-- 학생이 첫 비밀번호 변경을 마쳤을 때 must_change_password 를 내리는 RPC
-- (students 직접 UPDATE 는 RLS 상 관리자만 → 본인 플래그만 안전하게 내리도록 함수 제공)
-- schema.sql 이후 SQL Editor 에서 실행. 재실행 안전.
-- ============================================================

create or replace function public.mark_password_changed()
returns void
language sql
security definer
set search_path = public
as $$
  update public.students
     set must_change_password = false
   where auth_user_id = auth.uid();
$$;

grant execute on function public.mark_password_changed() to authenticated;
