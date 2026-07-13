-- ============================================================
-- 08_multi_difficulty.sql — 클래스 과제를 난이도별로 각각 도전 가능하게
--   · 기존: (학생 × 클래스) 1건 → 난이도 바꾸면 덮어써짐(도전 이력 소실)
--   · 변경: (학생 × 클래스 × 난이도) 각각 별도 과제
--       - 이미 제출/채점된 난이도 → 'already submitted' (재도전 차단, 결과 보존)
--       - 진행중/미시작 → 재시작(리셋)
--       - 없으면 새로 생성
-- schema.sql / 05_grading.sql 이후 실행. 재실행 안전.
-- ============================================================

-- 무결성: (학생, 클래스, 난이도) / (학생, 보너스토픽) 중복 방지
create unique index if not exists uq_assignments_class_diff
  on public.assignments (student_id, class_id, difficulty)
  where class_id is not null;
create unique index if not exists uq_assignments_bonus
  on public.assignments (student_id, bonus_topic_id)
  where bonus_topic_id is not null;

create or replace function public.start_assignment(p_class_number int, p_difficulty text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid;
  v_class uuid;
  v_set uuid;
  v_diff difficulty;
  v_assignment uuid;
  v_status assignment_status;
begin
  select id into v_student from public.students where auth_user_id = auth.uid();
  if v_student is null then raise exception 'not a student'; end if;

  v_diff := lower(p_difficulty)::difficulty;

  select id into v_class from public.classes
   where class_number = p_class_number and is_published;
  if v_class is null then raise exception 'class not available'; end if;

  select id into v_set from public.question_sets
   where class_id = v_class and difficulty = v_diff and is_active
   order by version desc limit 1;
  if v_set is null then raise exception 'no questions uploaded for this difficulty'; end if;

  -- 이 (학생 × 클래스 × 난이도) 과제 조회
  select id, status into v_assignment, v_status from public.assignments
   where student_id = v_student and class_id = v_class and difficulty = v_diff
   limit 1;

  if v_assignment is not null then
    if v_status in ('submitted', 'graded', 'manual_review') then
      raise exception 'already submitted';   -- 이미 제출한 난이도 (재도전 차단)
    end if;
    -- 진행중/미시작 → 재시작(리셋)
    delete from public.answers where assignment_id = v_assignment;
    update public.assignments set
      question_set_id = v_set, status = 'in_progress',
      started_at = now(), last_saved_at = now(),
      submitted_at = null, graded_at = null, total_duration_seconds = null,
      objective_score = null, code_score = null, total_score = null, updated_at = now()
     where id = v_assignment;
  else
    insert into public.assignments
      (student_id, class_id, question_set_id, difficulty, status, started_at, last_saved_at)
      values (v_student, v_class, v_set, v_diff, 'in_progress', now(), now())
      returning id into v_assignment;
  end if;

  return jsonb_build_object('assignment_id', v_assignment, 'question_set_id', v_set);
end $$;
grant execute on function public.start_assignment(int, text) to authenticated;
