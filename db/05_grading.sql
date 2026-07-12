-- ============================================================
-- 학생 과제 시작 + 서버 자동채점 RPC
-- schema.sql 이후 SQL Editor 에서 실행. 재실행 안전.
--
-- 정답(correct_answers)은 학생 브라우저에 절대 내려가지 않고,
-- 채점은 이 SECURITY DEFINER 함수(서버)에서만 수행합니다.
-- ============================================================

-- ------------------------------------------------------------
-- start_assignment: 공개된 Class + 난이도로 과제 시작(또는 재시작)
--   · 난이도에 해당하는 active question_set 을 찾아 연결
--   · 기존 시도가 있으면 초기화(재시작)
--   · assignment_id, question_set_id 반환
-- ------------------------------------------------------------
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

  select id into v_assignment from public.assignments
   where student_id = v_student and class_id = v_class limit 1;

  if v_assignment is not null then
    delete from public.answers where assignment_id = v_assignment;
    update public.assignments set
      difficulty = v_diff, question_set_id = v_set, status = 'in_progress',
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

-- ------------------------------------------------------------
-- grade_objective: OX/객관식/빈칸 서버 채점
--   · 코드 문제는 건드리지 않음 (Vercel 서버리스가 Claude 로 평가)
--   · 각 문제 채점 결과(정답/오답 + 정답값 + 코멘트) 반환 → 결과 화면 표시용
-- ------------------------------------------------------------
create or replace function public.grade_objective(p_assignment_id uuid, p_duration int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid;
  v_set uuid;
  r record;
  v_correct boolean;
  v_obj_total int := 0;
  v_obj_correct int := 0;
  v_obj_points int := 0;   -- 획득 점수
  v_obj_max int := 0;      -- 객관식 만점 합
  v_pts int;
  v_has_code boolean;
  v_results jsonb := '[]'::jsonb;
begin
  -- 소유 확인
  select a.student_id, a.question_set_id into v_student, v_set
   from public.assignments a
   join public.students s on s.id = a.student_id
   where a.id = p_assignment_id and s.auth_user_id = auth.uid();
  if v_student is null then raise exception 'not your assignment'; end if;

  for r in
    select q.id as question_id, q.question_number, q.question_type,
           q.correct_answers, q.wrong_comment, q.choices, q.max_score,
           ans.id as answer_id, ans.answer_text, ans.selected_choice
    from public.questions q
    left join public.answers ans
      on ans.question_id = q.id and ans.assignment_id = p_assignment_id
    where q.question_set_id = v_set
    order by q.question_number
  loop
    if r.question_type = 'code' then
      continue;  -- 코드 문제는 서버리스에서
    end if;

    v_obj_total := v_obj_total + 1;
    v_correct := false;

    if r.question_type = 'ox' then
      v_correct := upper(coalesce(r.answer_text, '')) = upper(coalesce(r.correct_answers #>> '{}', ''));
    elsif r.question_type = 'multiple_choice' then
      v_correct := r.selected_choice is not null
                   and r.selected_choice = nullif(r.correct_answers #>> '{}', '')::int;
    elsif r.question_type = 'blank' then
      v_correct := coalesce(r.answer_text, '') <> '' and exists (
        select 1 from jsonb_array_elements_text(r.correct_answers) e
        where lower(trim(e)) = lower(trim(r.answer_text))
      );
    end if;

    v_obj_max := v_obj_max + coalesce(r.max_score, 1);
    v_pts := case when v_correct then coalesce(r.max_score, 1) else 0 end;
    if v_correct then
      v_obj_correct := v_obj_correct + 1;
      v_obj_points := v_obj_points + v_pts;
    end if;

    if r.answer_id is not null then
      update public.answers
        set is_correct = v_correct, score = v_pts, updated_at = now()
       where id = r.answer_id;
    else
      insert into public.answers (assignment_id, question_id, is_correct, score)
       values (p_assignment_id, r.question_id, v_correct, v_pts);
    end if;

    v_results := v_results || jsonb_build_object(
      'question_id', r.question_id,
      'question_number', r.question_number,
      'type', r.question_type,
      'is_correct', v_correct,
      'correct', r.correct_answers,
      'wrong_comment', r.wrong_comment
    );
  end loop;

  -- 코드 문제가 있으면 'submitted'(코드 AI 채점 대기), 없으면 바로 'graded'
  select exists (
    select 1 from public.questions
    where question_set_id = v_set and question_type = 'code'
  ) into v_has_code;

  update public.assignments
    set status = (case when v_has_code then 'submitted' else 'graded' end)::assignment_status,
        submitted_at = now(),
        objective_score = v_obj_points,
        total_score = case when v_has_code then total_score else v_obj_points end,
        graded_at = case when v_has_code then graded_at else now() end,
        total_duration_seconds = coalesce(p_duration, total_duration_seconds),
        updated_at = now()
   where id = p_assignment_id;

  return jsonb_build_object(
    'objective_total', v_obj_total,
    'objective_correct', v_obj_correct,
    'objective_points', v_obj_points,
    'objective_max', v_obj_max,
    'results', v_results
  );
end $$;
grant execute on function public.grade_objective(uuid, int) to authenticated;
