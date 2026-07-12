-- ============================================================
-- Python Coding Practice — Supabase schema + RLS
-- 스펙 §17(DB 구조) / §19(보안) 기준
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
--
-- 보안 모델:
--   · 학생 브라우저 : anon/authenticated + RLS (본인 데이터만)
--   · Vercel 서버리스: service_role 키 (RLS 우회, 채점·관리 작업)
--   · 정답 컬럼은 학생에게 직접 노출하지 않음
--     (학생은 get_student_questions() 함수로 '정답 없는 문제'만 수신)
-- ============================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------- Enums ----------
do $$ begin
  create type user_role         as enum ('admin', 'student');
exception when duplicate_object then null; end $$;
do $$ begin
  create type difficulty        as enum ('easy', 'medium', 'hard');
exception when duplicate_object then null; end $$;
do $$ begin
  create type question_type     as enum ('ox', 'multiple_choice', 'blank', 'code', 'matching');
exception when duplicate_object then null; end $$;
do $$ begin
  create type assignment_status as enum ('not_started', 'in_progress', 'submitted', 'graded', 'manual_review');
exception when duplicate_object then null; end $$;
do $$ begin
  create type code_status       as enum ('correct', 'needs_revision', 'manual_review', 'pending_ai_review');
exception when duplicate_object then null; end $$;

-- ---------- updated_at 트리거 ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ============================================================
-- Tables (§17)
-- ============================================================

-- 17.1 profiles : auth.users 확장 (역할)
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         user_role not null default 'student',
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 17.2 students
create table if not exists public.students (
  id                    uuid primary key default gen_random_uuid(),
  auth_user_id          uuid unique references auth.users(id) on delete set null,
  student_code          text unique not null,          -- Student001
  name                  text not null default '',
  age                   int,                            -- CSV 업로드 시 함께 저장
  must_change_password  boolean not null default true,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- 이미 students 테이블이 있던 경우를 위한 마이그레이션
alter table public.students add column if not exists age int;

-- 17.3 classes
create table if not exists public.classes (
  id            uuid primary key default gen_random_uuid(),
  class_number  int unique not null,                   -- 1..5
  title         text not null,
  description   text,
  is_published  boolean not null default false,        -- false = 학생 화면 Locked
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 17.4 question_sets : Class × 난이도 한 세트(=업로드된 MD 하나)
create table if not exists public.question_sets (
  id              uuid primary key default gen_random_uuid(),
  class_id        uuid not null references public.classes(id) on delete cascade,
  difficulty      difficulty not null,
  source_filename text,
  version         int not null default 1,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (class_id, difficulty, version)
);

-- 17.5 questions (정답 컬럼 포함 — 학생 직접 조회 금지)
create table if not exists public.questions (
  id               uuid primary key default gen_random_uuid(),
  question_set_id  uuid not null references public.question_sets(id) on delete cascade,
  question_number  int not null,
  question_type    question_type not null,
  question_text    text not null,
  choices          jsonb,          -- 객관식 보기
  correct_answers  jsonb,          -- 정답 (민감!)
  wrong_comment    text,           -- 오답 설명 (민감!)
  concept          text,
  requirements     jsonb,          -- 코드 문제 요구사항
  rubric           jsonb,          -- 코드 문제 채점 기준 (민감!)
  max_score        int,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (question_set_id, question_number)
);

-- 17.6 bonus_topics
create table if not exists public.bonus_topics (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,                  -- variables, input ...
  title         text not null,
  display_order int not null default 0,
  is_published  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 17.7 bonus_question_sets
create table if not exists public.bonus_question_sets (
  id              uuid primary key default gen_random_uuid(),
  bonus_topic_id  uuid not null references public.bonus_topics(id) on delete cascade,
  source_filename text,
  version         int not null default 1,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- Bonus 문제는 questions 테이블을 재사용 (question_set_id 대신 bonus set 연결용 컬럼 추가)
alter table public.questions
  add column if not exists bonus_question_set_id uuid references public.bonus_question_sets(id) on delete cascade;
alter table public.questions alter column question_set_id drop not null;

-- 17.8 assignments : 학생 × 과제 시도
create table if not exists public.assignments (
  id                     uuid primary key default gen_random_uuid(),
  student_id             uuid not null references public.students(id) on delete cascade,
  class_id               uuid references public.classes(id) on delete set null,
  bonus_topic_id         uuid references public.bonus_topics(id) on delete set null,
  question_set_id        uuid references public.question_sets(id) on delete set null,
  difficulty             difficulty,
  status                 assignment_status not null default 'not_started',
  started_at             timestamptz,
  last_saved_at          timestamptz,
  submitted_at           timestamptz,
  graded_at              timestamptz,
  total_duration_seconds int,
  objective_score        int,
  code_score             int,
  total_score            int,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- 17.9 answers
create table if not exists public.answers (
  id              uuid primary key default gen_random_uuid(),
  assignment_id   uuid not null references public.assignments(id) on delete cascade,
  question_id     uuid not null references public.questions(id) on delete cascade,
  answer_text     text,
  selected_choice int,
  is_correct      boolean,
  score           int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (assignment_id, question_id)
);

-- 17.10 code_feedback (Claude 평가 결과)
create table if not exists public.code_feedback (
  id                     uuid primary key default gen_random_uuid(),
  answer_id              uuid not null references public.answers(id) on delete cascade,
  status                 code_status,
  score                  int,
  strengths              jsonb,
  issues                 jsonb,
  comment                text,
  confidence             numeric,
  raw_response           jsonb,
  admin_override_status  code_status,
  admin_override_score   int,
  admin_override_comment text,
  reviewed_by            uuid references auth.users(id),
  reviewed_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- 17.11 report_exports (성장 분석 Markdown)
create table if not exists public.report_exports (
  id                      uuid primary key default gen_random_uuid(),
  student_id              uuid references public.students(id) on delete set null,
  selected_assignment_ids jsonb,
  export_data             jsonb,
  markdown_content        text,
  exported_at             timestamptz not null default now(),
  exported_by             uuid references auth.users(id)
);

-- ---------- Indexes ----------
create index if not exists idx_students_auth        on public.students(auth_user_id);
create index if not exists idx_qsets_class          on public.question_sets(class_id);
create index if not exists idx_questions_set         on public.questions(question_set_id);
create index if not exists idx_questions_bonusset    on public.questions(bonus_question_set_id);
create index if not exists idx_assignments_student   on public.assignments(student_id);
create index if not exists idx_assignments_class     on public.assignments(class_id);
create index if not exists idx_answers_assignment    on public.answers(assignment_id);
create index if not exists idx_codefb_answer         on public.code_feedback(answer_id);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','students','classes','question_sets','questions',
    'bonus_topics','bonus_question_sets','assignments','answers','code_feedback'
  ] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s;', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s
                    for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ============================================================
-- Helper functions (RLS 용)
-- ============================================================
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.current_student_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.students where auth_user_id = auth.uid();
$$;

grant execute on function public.is_admin()          to authenticated, anon;
grant execute on function public.current_student_id() to authenticated;

-- ============================================================
-- RLS
-- ============================================================
alter table public.profiles            enable row level security;
alter table public.students            enable row level security;
alter table public.classes             enable row level security;
alter table public.question_sets       enable row level security;
alter table public.questions           enable row level security;
alter table public.bonus_topics        enable row level security;
alter table public.bonus_question_sets enable row level security;
alter table public.assignments         enable row level security;
alter table public.answers             enable row level security;
alter table public.code_feedback       enable row level security;
alter table public.report_exports      enable row level security;

-- 재실행 안전: 각 정책을 drop 후 create (create policy 는 if not exists 미지원)

-- profiles: 본인 또는 관리자
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- students: 본인 조회 / 관리자 전체
drop policy if exists students_select on public.students;
create policy students_select on public.students for select to authenticated
  using (auth_user_id = auth.uid() or public.is_admin());
drop policy if exists students_admin_write on public.students;
create policy students_admin_write on public.students for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- classes: 목록(제목/공개여부)은 로그인 사용자 모두 조회 가능 (Locked 카드 표시용).
--   비밀은 questions 뿐이므로 Class 메타데이터는 노출해도 안전.
drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes for select to authenticated
  using (true);
drop policy if exists classes_admin_write on public.classes;
create policy classes_admin_write on public.classes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- question_sets: 활성 + 공개 Class / 관리자 전체
drop policy if exists qsets_select on public.question_sets;
create policy qsets_select on public.question_sets for select to authenticated
  using (
    public.is_admin() or
    (is_active and exists (select 1 from public.classes c where c.id = class_id and c.is_published))
  );
drop policy if exists qsets_admin_write on public.question_sets;
create policy qsets_admin_write on public.question_sets for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- questions: 관리자만 직접 접근 (정답 노출 방지)
--   학생은 아래 get_student_questions() 함수로 '정답 없는 문제'만 받음
drop policy if exists questions_admin_all on public.questions;
create policy questions_admin_all on public.questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- bonus_topics / bonus_question_sets
--   개념 목록도 로그인 사용자 모두 조회 가능 (Locked 표시용)
drop policy if exists btopics_select on public.bonus_topics;
create policy btopics_select on public.bonus_topics for select to authenticated
  using (true);
drop policy if exists btopics_admin_write on public.bonus_topics;
create policy btopics_admin_write on public.bonus_topics for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists bsets_select on public.bonus_question_sets;
create policy bsets_select on public.bonus_question_sets for select to authenticated
  using (public.is_admin() or is_active);
drop policy if exists bsets_admin_write on public.bonus_question_sets;
create policy bsets_admin_write on public.bonus_question_sets for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- assignments: 본인 것만 / 관리자 전체. 학생 insert/update 는 제출 전만.
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments for select to authenticated
  using (student_id = public.current_student_id() or public.is_admin());
drop policy if exists assignments_student_insert on public.assignments;
create policy assignments_student_insert on public.assignments for insert to authenticated
  with check (student_id = public.current_student_id());
drop policy if exists assignments_student_update on public.assignments;
create policy assignments_student_update on public.assignments for update to authenticated
  using (student_id = public.current_student_id() and status in ('not_started','in_progress'))
  with check (student_id = public.current_student_id());
drop policy if exists assignments_admin_all on public.assignments;
create policy assignments_admin_all on public.assignments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- answers: 본인 assignment 것만
drop policy if exists answers_select on public.answers;
create policy answers_select on public.answers for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.assignments a
    where a.id = assignment_id and a.student_id = public.current_student_id()));
drop policy if exists answers_student_write on public.answers;
create policy answers_student_write on public.answers for all to authenticated
  using (exists (
    select 1 from public.assignments a
    where a.id = assignment_id and a.student_id = public.current_student_id()
      and a.status in ('not_started','in_progress')))
  with check (exists (
    select 1 from public.assignments a
    where a.id = assignment_id and a.student_id = public.current_student_id()));
drop policy if exists answers_admin_all on public.answers;
create policy answers_admin_all on public.answers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- code_feedback: 본인 결과 조회만 (쓰기는 service_role/관리자)
drop policy if exists codefb_select on public.code_feedback;
create policy codefb_select on public.code_feedback for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.answers ans
    join public.assignments a on a.id = ans.assignment_id
    where ans.id = answer_id and a.student_id = public.current_student_id()));
drop policy if exists codefb_admin_all on public.code_feedback;
create policy codefb_admin_all on public.code_feedback for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- report_exports: 관리자 전용
drop policy if exists reports_admin_all on public.report_exports;
create policy reports_admin_all on public.report_exports for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 학생용: 정답 없는 문제 조회 함수 (SECURITY DEFINER)
--   프론트에서 supabase.rpc('get_student_questions', { p_question_set_id }) 로 호출
-- ============================================================
create or replace function public.get_student_questions(p_question_set_id uuid)
returns table (
  id              uuid,
  question_number int,
  question_type   question_type,
  question_text   text,
  choices         jsonb,
  concept         text,
  requirements    jsonb,
  max_score       int
) language sql stable security definer set search_path = public as $$
  select q.id, q.question_number, q.question_type, q.question_text,
         q.choices, q.concept, q.requirements, q.max_score
  from public.questions q
  join public.question_sets qs on qs.id = q.question_set_id
  join public.classes c        on c.id = qs.class_id
  where q.question_set_id = p_question_set_id
    and qs.is_active
    and c.is_published
  order by q.question_number;
$$;
grant execute on function public.get_student_questions(uuid) to authenticated;

-- (Bonus 개념 문제용도 동일 패턴으로 별도 함수 추가 예정)

-- ============================================================
-- 끝. 다음 단계:
--   1) 관리자 계정 1개 만든 뒤: update public.profiles set role='admin' where id='<uuid>';
--   2) Class 1~5 / Bonus 개념 시드 (아래 seed.sql 참고 예정)
--   3) 채점 RPC(grade_objective) + Claude 평가 서버리스(/api) 연결
-- ============================================================
