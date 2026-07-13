-- ============================================================
-- 10_code_feedback_uk.sql — 코드 문제 AI 피드백 우크라이나어 저장
--   · /api/grade 가 채점 시 영어 + 우크라이나어 피드백을 함께 생성해 저장
--   · 코드/백틱은 번역하지 않음 (프롬프트에서 보존)
-- 재실행 안전.
-- ============================================================

alter table public.code_feedback add column if not exists strengths_uk jsonb;
alter table public.code_feedback add column if not exists issues_uk    jsonb;
alter table public.code_feedback add column if not exists comment_uk   text;
