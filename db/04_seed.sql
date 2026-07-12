-- ============================================================
-- Class 1~5 + Bonus 개념 15개 시드
-- schema.sql 이후 SQL Editor 에서 실행. 재실행 안전(upsert).
--
-- 처음엔 모두 is_published=false → 학생 홈에서 전부 Locked.
-- 관리자 문제 관리에서 공개하거나, 아래처럼 수동으로 켤 수 있음:
--   update public.classes set is_published=true where class_number=1;
--
-- description : 홈 카드의 개념 불릿용 (쉼표로 구분)
-- ============================================================

-- ---------- Classes ----------
insert into public.classes (class_number, title, description, is_published) values
  (1, 'Variables, Data Types & I/O',       'Variables,Input&Output,Types',              false),
  (2, 'Operators & Strings',               'Operators,Strings',                         false),
  (3, 'Conditionals & Loops',              'Conditionals,Loops',                        false),
  (4, 'Lists, Dicts, Tuples & Sets',       'Lists & Dictionaries,Tuple & Sets',         false),
  (5, 'Functions, Exceptions & Classes',   'Functions,Exception Handling,Class',        false)
on conflict (class_number) do update
  set title = excluded.title,
      description = excluded.description;

-- ---------- Bonus topics (15 concepts) ----------
insert into public.bonus_topics (slug, title, display_order, is_published) values
  ('variables',   'Variables',           1,  false),
  ('input',       'Input',               2,  false),
  ('output',      'Output',              3,  false),
  ('types',       'Types',               4,  false),
  ('operators',   'Operators',           5,  false),
  ('strings',     'Strings',             6,  false),
  ('conditional', 'Conditional',         7,  false),
  ('loops',       'Loops',               8,  false),
  ('lists',       'Lists',               9,  false),
  ('dictionaries','Dictionaries',        10, false),
  ('tuples',      'Tuples',              11, false),
  ('sets',        'Sets',                12, false),
  ('functions',   'Functions',           13, false),
  ('exception',   'Exception Handling',  14, false),
  ('classes',     'Classes',             15, false)
on conflict (slug) do update
  set title = excluded.title,
      display_order = excluded.display_order;

-- ---------- 확인 ----------
-- select class_number, title, is_published from public.classes order by class_number;
-- select display_order, slug, title, is_published from public.bonus_topics order by display_order;
