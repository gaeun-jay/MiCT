-- ============================================================
-- 11_self_register.sql — 학생 셀프 회원가입으로 전환
--   · 학생이 register 페이지에서 직접 계정 생성 (이름/나이대/아이디/비번)
--   · 관리자 계정 생성 없음, 비밀번호 변경 필요(must_change) 강제 없음
--   · 개인정보 보호를 위해 정확한 나이 대신 나이대(age_group, 예 "10-19")
-- schema.sql / 02_auth_trigger.sql 이후 실행. 재실행 안전.
-- ============================================================

-- 나이대 컬럼 (예: "10-19", "20-29" ... "80-89")
alter table public.students add column if not exists age_group text;

-- 가입 트리거: user_metadata(role/student_code/name/age_group)로
--   profiles(+ students) 자동 생성. 셀프 가입이므로 must_change_password = false.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := coalesce(v_meta->>'display_name', v_meta->>'name', '');
begin
  v_role := case when v_meta->>'role' = 'admin' then 'admin'::user_role
                 else 'student'::user_role end;

  insert into public.profiles (id, role, display_name)
  values (new.id, v_role, v_name)
  on conflict (id) do nothing;

  if v_role = 'student' and (v_meta ? 'student_code') then
    insert into public.students (auth_user_id, student_code, name, age, age_group, must_change_password, is_active)
    values (
      new.id,
      v_meta->>'student_code',
      coalesce(v_meta->>'name', ''),
      nullif(v_meta->>'age', '')::int,          -- 구버전 호환(있으면), 신규는 age_group 사용
      nullif(v_meta->>'age_group', ''),
      false,                                     -- 셀프 가입: 비번 변경 강제 안 함
      true
    )
    on conflict (student_code) do update
      set auth_user_id = excluded.auth_user_id,
          name         = coalesce(nullif(excluded.name, ''), public.students.name),
          age_group    = coalesce(excluded.age_group, public.students.age_group);
  end if;

  return new;
end;
$$;

-- 트리거 재설정 (재실행 안전)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
