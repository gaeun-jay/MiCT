// ============================================================
// POST /api/upload-questions — 관리자가 파싱한 문제를 DB에 저장
//   · 관리자만 (Supabase 토큰 + profiles.role='admin' 확인)
//   · service_role 로 question_sets / questions 저장 (RLS 우회)
//   · 난이도별로 question_set 을 만들고 해당 문제들을 insert
//   · 같은 Class+난이도 세트가 이미 있으면 문제를 교체(재업로드 지원)
//
// 필요한 Vercel 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// 요청:
//   POST /api/upload-questions
//   Authorization: Bearer <관리자 access token>
//   {
//     "class_id": "<uuid>",
//     "filename": "Class_1_Assignment.md",
//     "questions": [ { num, difficulty, type, question, choices, answer|answers,
//                      wrong_comment, concept|concepts, requirements, rubric, max_score }, ... ]
//   }
// ============================================================

import { createClient } from "@supabase/supabase-js";

const DIFF_MAP = { easy: "easy", medium: "medium", hard: "hard" };
const ALLOWED_TYPES = new Set(["ox", "multiple_choice", "blank", "code", "matching"]);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function normalizeDifficulty(d) {
  return DIFF_MAP[String(d || "").trim().toLowerCase()] || null;
}

function correctAnswers(q) {
  switch (q.type) {
    case "ox": return q.answer ?? null;
    case "multiple_choice": {
      const n = parseInt(q.answer, 10);
      return Number.isFinite(n) ? n : (q.answer ?? null);
    }
    case "blank": return Array.isArray(q.answers) ? q.answers : (q.answers ? [q.answers] : null);
    case "matching": return q.answer ?? null;    // 정답 쌍 (Bonus)
    case "code": return null;                     // AI 평가
    default: return q.answer ?? null;
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "upload-questions" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Server not configured (missing env vars)." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Missing bearer token." });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---- 관리자 확인 ----
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: "Invalid or expired session." });
  const { data: profile } = await admin
    .from("profiles").select("role").eq("id", userData.user.id).single();
  if (!profile || profile.role !== "admin") {
    return res.status(403).json({ error: "Admin only." });
  }

  // ---- 입력 ----
  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  const classId = body.class_id;
  const filename = body.filename || null;
  const questions = Array.isArray(body.questions) ? body.questions : null;
  if (!classId) return res.status(400).json({ error: "class_id required." });
  if (!questions || !questions.length) return res.status(400).json({ error: "questions[] required." });

  // Class 존재 확인
  const { data: cls, error: cErr } = await admin
    .from("classes").select("id, class_number").eq("id", classId).single();
  if (cErr || !cls) return res.status(404).json({ error: "Class not found." });

  // ---- 난이도별로 그룹핑 ----
  const byDiff = {};
  for (const q of questions) {
    const diff = normalizeDifficulty(q.difficulty);
    const type = String(q.type || "");
    if (!diff || !ALLOWED_TYPES.has(type)) continue;
    (byDiff[diff] ||= []).push(q);
  }
  if (!Object.keys(byDiff).length) {
    return res.status(400).json({ error: "No valid questions (check difficulty / type)." });
  }

  const summary = {};
  try {
    for (const [diff, qs] of Object.entries(byDiff)) {
      // 기존 활성 세트 찾기 → 있으면 문제 교체, 없으면 새로 생성
      const { data: existing } = await admin
        .from("question_sets").select("id")
        .eq("class_id", classId).eq("difficulty", diff).eq("is_active", true).limit(1);

      let setId;
      if (existing && existing.length) {
        setId = existing[0].id;
        await admin.from("questions").delete().eq("question_set_id", setId);
        await admin.from("question_sets")
          .update({ source_filename: filename, updated_at: new Date().toISOString() })
          .eq("id", setId);
      } else {
        const { data: ins, error: insErr } = await admin
          .from("question_sets")
          .insert({ class_id: classId, difficulty: diff, source_filename: filename, version: 1, is_active: true })
          .select("id").single();
        if (insErr) throw insErr;
        setId = ins.id;
      }

      const rows = qs.map((q, i) => ({
        question_set_id: setId,
        question_number: parseInt(q.num, 10) || i + 1,
        question_type: q.type,
        question_text: String(q.question || ""),
        choices: q.choices ?? null,
        correct_answers: correctAnswers(q),
        wrong_comment: q.wrong_comment ?? null,
        concept: q.concept ?? (Array.isArray(q.concepts) ? q.concepts.join(",") : null),
        requirements: q.requirements ?? null,
        rubric: q.rubric ?? null,
        max_score: q.type === "code" ? (parseInt(q.max_score, 10) || 10) : 1,
      }));

      const { error: qErr } = await admin.from("questions").insert(rows);
      if (qErr) throw qErr;
      summary[diff] = rows.length;
    }

    return res.status(200).json({
      ok: true,
      class_number: cls.class_number,
      counts: summary,
      total: Object.values(summary).reduce((a, b) => a + b, 0),
    });
  } catch (err) {
    console.error("[upload-questions] error", err);
    return res.status(500).json({ error: err?.message || "Upload failed." });
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
