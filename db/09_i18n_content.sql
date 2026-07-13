-- ============================================================
-- 09_i18n_content.sql — 문제/오답설명 우크라이나어 번역 저장 & 제공
--   · questions 에 *_uk 컬럼 추가 (업로드 시 Claude 번역이 채움, 없으면 영어 폴백)
--   · 학생 조회/채점 RPC 가 uk 필드도 함께 반환 → 프론트에서 언어 토글로 스왑
--   · 코드/백틱은 번역하지 않음 (번역은 서버리스 /api/translate 담당)
-- schema.sql / 05_grading.sql / 07_bonus.sql 이후 실행. 재실행 안전.
-- ============================================================

alter table public.questions add column if not exists question_text_uk text;
alter table public.questions add column if not exists wrong_comment_uk text;
alter table public.questions add column if not exists choices_uk jsonb;   -- 객관식 보기 / matching left·right 번역

-- ------------------------------------------------------------
-- 학생용: 정답 없는 문제 (uk 포함)
--   반환 컬럼이 바뀌므로 create or replace 불가 → 먼저 DROP
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
  concept          text,
  requirements     jsonb,
  max_score        int
) language sql stable security definer set search_path = public as $$
  select q.id, q.question_number, q.question_type, q.question_text, q.question_text_uk,
         q.choices, q.choices_uk, q.concept, q.requirements, q.max_score
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
-- 보너스용: 정답 없는 문제 (uk 포함)
--   반환 컬럼이 바뀌므로 create or replace 불가 → 먼저 DROP
-- ------------------------------------------------------------
drop function if exists public.get_bonus_questions(uuid);
create or replace function public.get_bonus_questions(p_bonus_question_set_id uuid)
returns table (
  id               uuid,
  question_number  int,
  question_type    question_type,
  question_text    text,
  question_text_uk text,
  choices          jsonb,
  choices_uk       jsonb,
  concept          text,
  max_score        int
) language sql stable security definer set search_path = public as $$
  select q.id, q.question_number, q.question_type, q.question_text, q.question_text_uk,
         q.choices, q.choices_uk, q.concept, q.max_score
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
-- grade_objective: 결과에 wrong_comment_uk 추가
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
begin
  select a.student_id, a.question_set_id into v_student, v_set
   from public.assignments a
   join public.students s on s.id = a.student_id
   where a.id = p_assignment_id and s.auth_user_id = auth.uid();
  if v_student is null then raise exception 'not your assignment'; end if;

  for r in
    select q.id as question_id, q.question_number, q.question_type,
           q.correct_answers, q.wrong_comment, q.wrong_comment_uk, q.choices, q.max_score,
           ans.id as answer_id, ans.answer_text, ans.selected_choice
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

-- ------------------------------------------------------------
-- grade_bonus: 결과에 wrong_comment_uk 추가
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
           q.correct_answers, q.wrong_comment, q.wrong_comment_uk, q.choices, q.max_score,
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
      'wrong_comment', r.wrong_comment,
      'wrong_comment_uk', r.wrong_comment_uk
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
