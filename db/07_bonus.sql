-- ============================================================
-- 07_bonus.sql — 보너스(개념) 과제: 서버 채점 RPC
--   · 보너스는 코드 문제가 없음 → OX / 빈칸 / 선긋기(matching) 만 서버 채점
--   · 정답(correct_answers)은 학생 브라우저에 내려가지 않음
--       - get_bonus_questions: 정답 없는 문제 (matching 은 choices={left,right} 만)
--       - grade_bonus: 서버(SECURITY DEFINER)에서만 채점
--   · questions 테이블을 재사용 (bonus_question_set_id 로 연결)
--       - matching:  choices = {left:[{id,text}], right:[{id,text}]},
--                    correct_answers = [{left,right}, ...]  (정답 쌍)
--       - 학생 답(answers.answer_text): matching 은 JSON {"L1":"R2",...}
-- schema.sql 이후 SQL Editor 에서 실행. 재실행 안전.
-- ============================================================

-- ------------------------------------------------------------
-- get_bonus_questions: 정답 없는 보너스 문제 (published 토픽만)
-- ------------------------------------------------------------
create or replace function public.get_bonus_questions(p_bonus_question_set_id uuid)
returns table (
  id              uuid,
  question_number int,
  question_type   question_type,
  question_text   text,
  choices         jsonb,
  concept         text,
  max_score       int
) language sql stable security definer set search_path = public as $$
  select q.id, q.question_number, q.question_type, q.question_text,
         q.choices, q.concept, q.max_score
  from public.questions q
  join public.bonus_question_sets bs on bs.id = q.bonus_question_set_id
  join public.bonus_topics bt        on bt.id = bs.bonus_topic_id
  where q.bonus_question_set_id = p_bonus_question_set_id
    and bs.is_active
    and bt.is_published
  order by q.question_number;
$$;
grant execute on function public.get_bonus_questions(uuid) to authenticated;

-- ------------------------------------------------------------
-- start_bonus_assignment: 공개된 개념(slug)로 보너스 과제 시작/재시작
-- ------------------------------------------------------------
create or replace function public.start_bonus_assignment(p_topic_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid;
  v_topic uuid;
  v_set uuid;
  v_assignment uuid;
begin
  select id into v_student from public.students where auth_user_id = auth.uid();
  if v_student is null then raise exception 'not a student'; end if;

  select id into v_topic from public.bonus_topics
   where slug = p_topic_slug and is_published;
  if v_topic is null then raise exception 'topic not available'; end if;

  select id into v_set from public.bonus_question_sets
   where bonus_topic_id = v_topic and is_active
   order by version desc limit 1;
  if v_set is null then raise exception 'no questions uploaded for this topic'; end if;

  select id into v_assignment from public.assignments
   where student_id = v_student and bonus_topic_id = v_topic limit 1;

  if v_assignment is not null then
    delete from public.answers where assignment_id = v_assignment;
    update public.assignments set
      status = 'in_progress', started_at = now(), last_saved_at = now(),
      submitted_at = null, graded_at = null, total_duration_seconds = null,
      objective_score = null, code_score = null, total_score = null, updated_at = now()
     where id = v_assignment;
  else
    insert into public.assignments
      (student_id, bonus_topic_id, status, started_at, last_saved_at)
      values (v_student, v_topic, 'in_progress', now(), now())
      returning id into v_assignment;
  end if;

  return jsonb_build_object('assignment_id', v_assignment, 'bonus_question_set_id', v_set);
end $$;
grant execute on function public.start_bonus_assignment(text) to authenticated;

-- ------------------------------------------------------------
-- grade_bonus: OX / 빈칸 / 선긋기 서버 채점 (문제당 1점, 총점은 백분율)
-- ------------------------------------------------------------
create or replace function public.grade_bonus(p_assignment_id uuid, p_duration int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid;
  v_topic uuid;
  v_set uuid;
  r record;
  v_correct boolean;
  v_total int := 0;
  v_ok int := 0;
  v_score int := 0;
  v_results jsonb := '[]'::jsonb;
begin
  -- 소유 확인
  select a.student_id, a.bonus_topic_id into v_student, v_topic
   from public.assignments a
   join public.students s on s.id = a.student_id
   where a.id = p_assignment_id and s.auth_user_id = auth.uid();
  if v_student is null then raise exception 'not your assignment'; end if;

  select id into v_set from public.bonus_question_sets
   where bonus_topic_id = v_topic and is_active
   order by version desc limit 1;

  for r in
    select q.id as question_id, q.question_number, q.question_type,
           q.correct_answers, q.wrong_comment, q.choices, q.max_score,
           ans.id as answer_id, ans.answer_text, ans.selected_choice
    from public.questions q
    left join public.answers ans
      on ans.question_id = q.id and ans.assignment_id = p_assignment_id
    where q.bonus_question_set_id = v_set
    order by q.question_number
  loop
    v_total := v_total + 1;
    v_correct := false;

    if r.question_type = 'ox' then
      v_correct := upper(coalesce(r.answer_text, '')) = upper(coalesce(r.correct_answers #>> '{}', ''));
    elsif r.question_type = 'blank' then
      v_correct := coalesce(r.answer_text, '') <> '' and exists (
        select 1 from jsonb_array_elements_text(r.correct_answers) e
        where lower(trim(e)) = lower(trim(r.answer_text))
      );
    elsif r.question_type = 'matching' then
      -- 학생 답: JSON 객체 {"L1":"R2", ...}. 정답 쌍이 모두 일치해야 정답.
      if coalesce(r.answer_text, '') <> '' and r.answer_text ~ '^\s*\{' then
        v_correct := not exists (
          select 1 from jsonb_array_elements(r.correct_answers) p
          where (r.answer_text::jsonb ->> (p->>'left')) is distinct from (p->>'right')
        );
      end if;
    end if;

    if v_correct then v_ok := v_ok + 1; end if;

    if r.answer_id is not null then
      update public.answers
        set is_correct = v_correct, score = case when v_correct then 1 else 0 end, updated_at = now()
       where id = r.answer_id;
    else
      insert into public.answers (assignment_id, question_id, is_correct, score)
       values (p_assignment_id, r.question_id, v_correct, case when v_correct then 1 else 0 end);
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

  v_score := case when v_total > 0 then round(v_ok::numeric / v_total * 100)::int else 0 end;

  update public.assignments
    set status = 'graded',
        submitted_at = now(),
        graded_at = now(),
        objective_score = v_ok,
        code_score = null,
        total_score = v_score,
        total_duration_seconds = coalesce(p_duration, total_duration_seconds),
        updated_at = now()
   where id = p_assignment_id;

  return jsonb_build_object(
    'objective_total', v_total,
    'objective_correct', v_ok,
    'total_score', v_score,
    'results', v_results
  );
end $$;
grant execute on function public.grade_bonus(uuid, int) to authenticated;
