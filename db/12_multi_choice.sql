-- ============================================================
-- 12_multi_choice.sql — 객관식 복수 정답 지원
--   · questions.multi_select : 이 객관식이 복수 정답인지 (학생 UI 다중선택 스위치)
--   · questions.correct_answers : 복수면 배열 [1,3], 단일이면 기존처럼 스칼라 int
--   · answers.selected_choices : 학생이 고른 번호 배열 (jsonb) — 단일 문항은 기존 selected_choice 사용
--   · 채점(exact match): 선택 집합 == 정답 집합 이어야 정답 (부분 점수 없음, OX·빈칸과 동일)
--   · 정답은 학생에게 내려가지 않으므로 multi_select 플래그만 get_student_questions 로 노출
-- schema.sql / 05_grading.sql / 09_i18n_content.sql 이후 실행. 재실행 안전.
-- ============================================================

alter table public.questions add column if not exists multi_select boolean not null default false;
alter table public.answers   add column if not exists selected_choices jsonb;

-- ------------------------------------------------------------
-- 학생용: 정답 없는 문제 (multi_select 포함)
--   반환 컬럼이 바뀌므로 먼저 DROP
-- ------------------------------------------------------------
drop function if exists public.get_student_questions(uuid);
create or replace function public.get_student_questions(p_question_set_id uuid)
returns table (
  id               uuid,
  question_number  int,
  question_type    question_type,
  question_text    text,
  question_text_uk text,
  choices          jsonb,
  choices_uk       jsonb,
  multi_select     boolean,
  concept          text,
  requirements     jsonb,
  max_score        int
) language sql stable security definer set search_path = public as $$
  select q.id, q.question_number, q.question_type, q.question_text, q.question_text_uk,
         q.choices, q.choices_uk, coalesce(q.multi_select, false), q.concept, q.requirements, q.max_score
  from public.questions q
  join public.question_sets qs on qs.id = q.question_set_id
  join public.classes c        on c.id = qs.class_id
  where q.question_set_id = p_question_set_id
    and qs.is_active
    and c.is_published
  order by q.question_number;
$$;
grant execute on function public.get_student_questions(uuid) to authenticated;

-- ------------------------------------------------------------
-- grade_objective: 객관식 복수 정답(exact match) 채점
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
  v_obj_points int := 0;
  v_obj_max int := 0;
  v_pts int;
  v_has_code boolean;
  v_results jsonb := '[]'::jsonb;
  v_correct_set int[];
  v_sel_set int[];
begin
  select a.student_id, a.question_set_id into v_student, v_set
   from public.assignments a
   join public.students s on s.id = a.student_id
   where a.id = p_assignment_id and s.auth_user_id = auth.uid();
  if v_student is null then raise exception 'not your assignment'; end if;

  for r in
    select q.id as question_id, q.question_number, q.question_type,
           q.correct_answers, q.wrong_comment, q.wrong_comment_uk, q.choices, q.max_score,
           coalesce(q.multi_select, false) as multi_select,
           ans.id as answer_id, ans.answer_text, ans.selected_choice, ans.selected_choices
    from public.questions q
    left join public.answers ans
      on ans.question_id = q.id and ans.assignment_id = p_assignment_id
    where q.question_set_id = v_set
    order by q.question_number
  loop
    if r.question_type = 'code' then
      continue;
    end if;

    v_obj_total := v_obj_total + 1;
    v_correct := false;

    if r.question_type = 'ox' then
      v_correct := upper(coalesce(r.answer_text, '')) = upper(coalesce(r.correct_answers #>> '{}', ''));
    elsif r.question_type = 'multiple_choice' then
      if r.multi_select then
        -- 정답 집합 (배열 또는 스칼라 모두 허용)
        select array_agg(t.x::int order by t.x::int) into v_correct_set
        from jsonb_array_elements_text(
               case when jsonb_typeof(r.correct_answers) = 'array'
                    then r.correct_answers
                    else jsonb_build_array(r.correct_answers) end) as t(x);
        -- 학생 선택 집합
        select array_agg(s.x::int order by s.x::int) into v_sel_set
        from jsonb_array_elements_text(coalesce(r.selected_choices, '[]'::jsonb)) as s(x);
        v_correct := v_correct_set is not null
                     and coalesce(v_sel_set, '{}') = coalesce(v_correct_set, '{}');
      else
        v_correct := r.selected_choice is not null
                     and r.selected_choice = nullif(r.correct_answers #>> '{}', '')::int;
      end if;
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
      'wrong_comment', r.wrong_comment,
      'wrong_comment_uk', r.wrong_comment_uk
    );
  end loop;

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
