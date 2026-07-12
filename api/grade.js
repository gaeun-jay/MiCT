// ============================================================
// POST /api/grade — 코드 문제 Claude 평가 (Vercel Serverless)
// 스펙 §12: 학생 코드는 실행하지 않고 Claude API로 평가.
//
// 두 가지 모드:
//   1) { assignment_id }  → DB에서 코드문제/답안/루브릭 로드 → 채점 → code_feedback 저장
//                           → 과제 code_score/total_score/status='graded' 확정
//   2) { items:[...] }     → stateless 채점 (테스트/직접 채점)
//
// 필요한 Vercel 환경변수: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const MODEL = "claude-opus-4-8";

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
- score: integer from 0 to the item's max_score
- strengths: short bullet strings
- issues: short bullet strings (empty array if none)
- comment: one or two sentences of overall feedback
- confidence: 0.0–1.0`;

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
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

// items → Claude 평가 → [{index,status,score,strengths,issues,comment,confidence}]
async function gradeItems(anthropic, items) {
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

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema: RESULT_SCHEMA } },
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
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No structured output returned.");
  return { parsed: JSON.parse(textBlock.text).results || [], model: message.model };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "grade" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Server not configured (missing env vars)." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Missing bearer token." });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: "Invalid or expired session." });
  const userId = userData.user.id;

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  try {
    // ---------------- 모드 1: assignment_id (DB 연동) ----------------
    if (body.assignment_id) {
      const assignmentId = body.assignment_id;

      // 소유 확인 (학생 본인 or 관리자)
      const { data: asg } = await admin
        .from("assignments")
        .select("id, student_id, question_set_id, objective_score, students(auth_user_id)")
        .eq("id", assignmentId).single();
      if (!asg) return res.status(404).json({ error: "Assignment not found." });

      const { data: prof } = await admin.from("profiles").select("role").eq("id", userId).single();
      const isAdmin = prof?.role === "admin";
      const isOwner = asg.students?.auth_user_id === userId;
      if (!isOwner && !isAdmin) return res.status(403).json({ error: "Not your assignment." });

      // 코드 문제 + 학생 답안 로드
      const { data: cq } = await admin
        .from("questions")
        .select("id, question_text, requirements, rubric, concept, max_score")
        .eq("question_set_id", asg.question_set_id)
        .eq("question_type", "code")
        .order("question_number");

      const codeQs = cq || [];
      const { data: ansRows } = await admin
        .from("answers")
        .select("id, question_id, answer_text")
        .eq("assignment_id", assignmentId)
        .in("question_id", codeQs.map((q) => q.id).length ? codeQs.map((q) => q.id) : ["00000000-0000-0000-0000-000000000000"]);
      const ansByQ = {};
      (ansRows || []).forEach((a) => { ansByQ[a.question_id] = a; });

      let results = [];
      let usedModel = MODEL;
      let codeScore = 0;
      let anyReview = false;

      if (codeQs.length > 0) {
        const items = codeQs.map((q) => ({
          question_id: q.id,
          question: q.question_text,
          student_code: ansByQ[q.id]?.answer_text || "",
          requirements: q.requirements || [],
          rubric: q.rubric || [],
          concepts_taught: q.concept ? [q.concept] : [],
          max_score: q.max_score || 10,
        }));

        const graded = await gradeItems(anthropic, items);
        usedModel = graded.model;

        for (const r of graded.parsed) {
          const q = codeQs[r.index];
          if (!q) continue;
          // 답안 행 확보
          let answerId = ansByQ[q.id]?.id;
          if (!answerId) {
            const { data: newAns } = await admin
              .from("answers")
              .insert({ assignment_id: assignmentId, question_id: q.id, answer_text: "" })
              .select("id").single();
            answerId = newAns?.id;
          }
          // code_feedback 재작성
          if (answerId) {
            await admin.from("code_feedback").delete().eq("answer_id", answerId);
            await admin.from("code_feedback").insert({
              answer_id: answerId,
              status: r.status,
              score: r.score,
              strengths: r.strengths || [],
              issues: r.issues || [],
              comment: r.comment || "",
              confidence: r.confidence ?? null,
              raw_response: r,
            });
            await admin.from("answers")
              .update({ score: r.score, is_correct: r.status === "correct", updated_at: new Date().toISOString() })
              .eq("id", answerId);
          }
          codeScore += Number(r.score) || 0;
          if (r.status === "manual_review") anyReview = true;
          results.push({
            question_id: q.id,
            status: r.status,
            score: r.score,
            strengths: r.strengths || [],
            issues: r.issues || [],
            comment: r.comment || "",
            confidence: r.confidence ?? null,
          });
        }
      }

      // 과제 최종 처리
      const objective = asg.objective_score || 0;
      await admin.from("assignments").update({
        code_score: codeScore,
        total_score: objective + codeScore,
        status: anyReview ? "manual_review" : "graded",
        graded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", assignmentId);

      return res.status(200).json({ results, model: usedModel, code_score: codeScore });
    }

    // ---------------- 모드 2: stateless items (테스트) ----------------
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Provide assignment_id or a non-empty items[]." });
    }
    if (items.length > 4) return res.status(400).json({ error: "Too many items (max 4)." });

    const graded = await gradeItems(anthropic, items);
    const results = graded.parsed.map((r) => {
      const src = items[r.index] || {};
      return {
        question_id: src.question_id ?? null,
        status: r.status, score: r.score,
        strengths: r.strengths || [], issues: r.issues || [],
        comment: r.comment || "", confidence: r.confidence ?? null,
      };
    });
    return res.status(200).json({ results, model: graded.model });
  } catch (err) {
    console.error("[grade] error", err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    return res.status(status).json({ error: err?.message || "Grading failed." });
  }
}
