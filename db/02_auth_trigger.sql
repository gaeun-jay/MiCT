-- ============================================================
-- auth.users 가입 시 profiles(+ 학생이면 students) 자동 생성 트리거
-- schema.sql 실행 후 이 파일을 SQL Editor 에 붙여넣고 실행하세요.
-- 재실행 안전(idempotent).
--
-- auth user 생성 시 user_metadata(raw_user_meta_data)를 읽어 채웁니다:
--   role         : 'admin' | 'student'  (없으면 student)
--   display_name : 표시 이름
--   student_code : Student001  (학생일 때)
--   name         : 학생 이름
--   age          : 나이
-- ============================================================

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
  -- 역할 결정 (안전 캐스팅)
  v_role := case when v_meta->>'role' = 'admin' then 'admin'::user_role
                 else 'student'::user_role end;

  -- 1) profiles 자동 생성
  insert into public.profiles (id, role, display_name)
  values (new.id, v_role, v_name)
  on conflict (id) do nothing;

  -- 2) 학생이고 student_code 가 있으면 students 행도 생성/연결
  if v_role = 'student' and (v_meta ? 'student_code') then
    insert into public.students (auth_user_id, student_code, name, age, must_change_password, is_active)
    values (
      new.id,
      v_meta->>'student_code',
      coalesce(v_meta->>'name', ''),
      nullif(v_meta->>'age', '')::int,
      true,
      true
    )
    on conflict (student_code) do update
      set auth_user_id = excluded.auth_user_id,
          name         = coalesce(nullif(excluded.name, ''), public.students.name),
          age          = coalesce(excluded.age, public.students.age);
  end if;

  return new;
end;
$$;

-- 트리거 (재실행 안전)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 확인:
--   select id, role, display_name from public.profiles;
-- 새 사용자를 Authentication > Add user 로 만들 때
-- User Metadata 에 아래처럼 넣으면 students 까지 자동 생성됩니다:
--   { "role":"student", "student_code":"Student001", "name":"Іванців Єва", "age":"14" }
-- ============================================================
