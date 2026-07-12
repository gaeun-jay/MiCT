# Python Coding Practice

우크라이나 학생 대상 Python 과제 관리 웹앱.
관리자가 문제(Markdown)를 올리고 학생이 로그인해 과제를 풀면, 일반 문제는 자동 채점,
코드 문제는 Claude API로 평가합니다.

## 스택
- 프론트엔드: 바닐라 HTML / CSS / JS (정적)
- 인증·DB: Supabase (Auth + PostgreSQL + RLS)
- 서버리스: Vercel Functions (`/api`) — Claude 채점 등 `service_role`/API 키가 필요한 작업
- 배포: Vercel

## 구조
```
index.html                 진입 (학생/관리자 선택)
supabase-config.js         공유 Supabase 클라이언트 (publishable 키 — 공개 안전)
pages/
  login/                   학생 로그인
  change-password/         첫 로그인 비번 변경
  home/                    과제 카드 (홈)
  assignment/              Class 문제 풀이
  bonus/ · bonus-assignment/  Bonus 개념/풀이
  admin/                   관리자 (로그인 + 대시보드)
db/                        Supabase 스키마·RLS·트리거·시드 SQL
api/                       Vercel 서버리스 함수 (배포 후 추가)
```

## DB 세팅 (Supabase SQL Editor 순서대로 실행)
1. `db/schema.sql` — 테이블 + RLS + 함수
2. `db/02_auth_trigger.sql` — 가입 시 profiles/students 자동 생성
3. `db/03_password_changed.sql` — 첫 비번변경 플래그 RPC
4. `db/04_seed.sql` — Class 1~5 + Bonus 개념 15개

## 환경변수 (Vercel — 절대 프론트에 노출 금지)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`  (secret)
- `ANTHROPIC_API_KEY`          (secret)
