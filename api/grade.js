// ============================================================
// POST /api/grade — 코드 문제 Claude 평가 (Vercel Serverless)
// 스펙 §12: 학생 코드는 실행하지 않고 Claude API로 평가.
//   · 코드 문제 여러 개를 한 번의 요청으로 평가 (§12.6 호출 최소화)
//   · 구조화 출력으로 §12.5 JSON 스키마 강제
//   · 로그인한 사용자만 호출 가능 (Supabase 토큰 검증)
//
// 필요한 Vercel 환경변수:
//   ANTHROPIC_API_KEY           (secret)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (secret — RLS 우회, 서버에서만)
//
// 요청 예시:
//   POST /api/grade
//   Authorization: Bearer <학생 supabase access token>
//   { "items": [ { "question": "...", "student_code": "...",
//                  "concepts_taught": ["for","range"],
//                  "requirements": ["..."], "rubric": [{item,score}], "max_score": 10 } ] }
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const MODEL = "claude-opus-4-8";

// §12.3 Claude 평가 원칙
const SYSTEM_PROMPT = `You are grading beginner Python students' code for a class assignment.
The student's code is NOT executed — evaluate it by reading it.

Rules:
- Never claim you executed or ran the code.
- Do not deduct points only because the solution differs from a model answer; accept multiple valid approaches.
- Judge primarily by whether the code meets the stated requirements.
- Check the student stayed within the concepts they have been taught.
- If you are not confident, classify as "manual_review".
- Do not invent runtime errors that do not exist.
- Keep feedback friendly and easy for a beginner to understand; avoid harsh or verbose wording.
- Be specific about what was done well and what to fix.

For each item return:
- status: "correct" | "needs_revision" | "manual_review"
- score: integer from 0 to the item's max_score (use max_score's midpoint and set manual_review if unsure; for manual_review still give a best-guess score)
- strengths: short bullet strings
- issues: short bullet strings (empty array if none)
- comment: one or two sentences of overall feedback
- confidence: 0.0–1.0`;

// §12.5 응답 스키마 (구조화 출력)
const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer" },
          status: { type: "string", enum: ["correct", "needs_revision", "manual_review"] },
          score: { type: "integer" },
          strengths: { type: "array", items: { type: "string" } },
          issues: { type: "array", items: { type: "string" } },
          comment: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["index", "status", "score", "strengths", "issues", "comment", "confidence"],
      },
    },
  },
  required: ["results"],
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "grade" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ---- env 확인 ----
  const { ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Server not configured (missing env vars)." });
  }

  // ---- 인증: 로그인한 사용자만 ----
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Missing bearer token." });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: "Invalid or expired session." });
  }

  // ---- 입력 검증 ----
  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: "Body must include a non-empty 'items' array." });
  }
  if (items.length > 4) {
    return res.status(400).json({ error: "Too many items (max 4 per request)." });
  }

  // ---- Claude 요청 구성 (모든 코드 문제 한 번에) ----
  const payload = items.map((it, i) => ({
    index: i,
    question: String(it.question || ""),
    student_code: String(it.student_code || ""),
    concepts_taught: it.concepts_taught || it.concepts || [],
    allowed_concepts: it.allowed_concepts || [],
    requirements: it.requirements || [],
    rubric: it.rubric || [],
    max_score: Number.isFinite(it.max_score) ? it.max_score : 10,
  }));

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: RESULT_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            "Grade each code submission below. Return one result per item, " +
            "matching each result's `index` to the item's `index`.\n\n" +
            JSON.stringify({ items: payload }, null, 2),
        },
      ],
    });

    // 구조화 출력 → 첫 text 블록이 JSON
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock) {
      return res.status(502).json({ error: "No structured output returned." });
    }
    const parsed = JSON.parse(textBlock.text);

    // index 로 원래 question_id 등을 다시 붙여서 반환
    const results = (parsed.results || []).map((r) => {
      const src = items[r.index] || {};
      return {
        question_id: src.question_id ?? null,
        status: r.status,
        score: r.score,
        strengths: r.strengths || [],
        issues: r.issues || [],
        comment: r.comment || "",
        confidence: r.confidence ?? null,
      };
    });

    return res.status(200).json({ results, model: message.model });
    // TODO(다음 단계): assignment_id 를 받아 answers/code_feedback 에 service_role 로 저장
  } catch (err) {
    console.error("[grade] error", err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    return res.status(status).json({ error: err?.message || "Grading failed." });
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
