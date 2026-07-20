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

const SYSTEM_PROMPT = `You are grading beginner Python students' code. The code is NOT executed — evaluate it by reading it.

Grade STRICTLY against the rubric provided for each item:
- Award each rubric item its full points ONLY if the code fully satisfies that specific criterion.
- If a bug — even a single-line mistake such as range(1, 10) instead of range(1, 11), a missing print, or wrong output — causes a requirement to fail, the rubric item(s) it affects get 0. Do NOT give partial credit for code that is "almost right"; correctness of the actual result is what matters.
- Accept any valid approach that meets a requirement; never deduct for style, variable names, or a different-but-correct solution.
- Mark status "correct" ONLY when EVERY rubric item is fully satisfied.
- Mark "needs_revision" when the attempt is on the right track but at least one rubric item fails.
- Mark "manual_review" only when the code is too incomplete or ambiguous to judge.
- Never claim you executed the code; never invent runtime errors that do not exist.
- Keep feedback friendly and specific for a beginner; be concise.

For each item return:
- status: "correct" | "needs_revision" | "manual_review"
- score: integer = the SUM of awarded rubric points, out of the item's "rubric_total" (NOT out of 100, NOT out of max_score)
- strengths: short bullet strings
- issues: short bullet strings (empty array if none)
- comment: one or two sentences of overall feedback
- confidence: 0.0–1.0
- strengths_uk / issues_uk / comment_uk: Ukrainian translations of strengths / issues / comment for the student. Translate the prose into natural Ukrainian, but NEVER translate or alter code: anything in backticks, Python identifiers/functions (input, print, range, etc.), string literals, numbers-as-code, and operators must stay exactly as in the English version.`;

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
          strengths_uk: { type: "array", items: { type: "string" } },
          issues_uk: { type: "array", items: { type: "string" } },
          comment_uk: { type: "string" },
        },
        required: ["index", "status", "score", "strengths", "issues", "comment", "confidence", "strengths_uk", "issues_uk", "comment_uk"],
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

// 루브릭 항목 점수 합
function rubricTotal(rubric) {
  if (!Array.isArray(rubric)) return 0;
  return rubric.reduce((a, it) => a + (Number(it?.score) || 0), 0);
}
// Claude 원점수(루브릭 만점 기준) → 문제 배점(max_score)으로 환산
function scaleScore(raw, rTotal, maxScore) {
  const m = Number(maxScore) || 0;
  const r = Number(raw) || 0;
  if (!rTotal) return Math.max(0, Math.min(r, m)); // 루브릭 없으면 원점수를 배점 한도로
  return Math.max(0, Math.min(Math.round((r / rTotal) * m), m));
}

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
    rubric_total: rubricTotal(it.rubric),
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
          "Grade each code submission below strictly against its rubric. " +
          "For each item, `score` must be the total awarded rubric points out of that item's `rubric_total`. " +
          "Match each result's `index` to the item's `index`.\n\n" +
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

      // question_ids 가 오면 그 문항만 재채점 (관리자가 특정 문제만 다시 채점) — 총점은 전체 코드답안 기준 재계산
      const onlyQids = Array.isArray(body.question_ids) && body.question_ids.length ? body.question_ids : null;
      if (onlyQids && !isAdmin) return res.status(403).json({ error: "Admin only for partial re-grade." });

      // 코드 문제 + 학생 답안 로드
      let cqQuery = admin
        .from("questions")
        .select("id, question_text, requirements, rubric, concept, max_score")
        .eq("question_set_id", asg.question_set_id)
        .eq("question_type", "code");
      if (onlyQids) cqQuery = cqQuery.in("id", onlyQids);
      const { data: cq } = await cqQuery.order("question_number");

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
          // 루브릭 원점수 → 문제 배점(max_score)으로 환산
          const scaled = scaleScore(r.score, rubricTotal(q.rubric), q.max_score);
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
              score: scaled,
              strengths: r.strengths || [],
              issues: r.issues || [],
              comment: r.comment || "",
              strengths_uk: r.strengths_uk || [],
              issues_uk: r.issues_uk || [],
              comment_uk: r.comment_uk || "",
              confidence: r.confidence ?? null,
              raw_response: r,
            });
            await admin.from("answers")
              .update({ score: scaled, is_correct: r.status === "correct", updated_at: new Date().toISOString() })
              .eq("id", answerId);
          }
          codeScore += scaled;
          if (r.status === "manual_review") anyReview = true;
          results.push({
            question_id: q.id,
            status: r.status,
            score: scaled,
            max_score: q.max_score,
            strengths: r.strengths || [],
            issues: r.issues || [],
            comment: r.comment || "",
            strengths_uk: r.strengths_uk || [],
            issues_uk: r.issues_uk || [],
            comment_uk: r.comment_uk || "",
            confidence: r.confidence ?? null,
          });
        }
      }

      // 과제 최종 처리
      //  · 전체 코드 답안 점수 합으로 code_score 재계산 (부분 재채점이어도 총점 일관성 유지)
      //  · status 는 이 과제의 전체 code_feedback 기준으로 판정
      const objective = asg.objective_score || 0;
      let finalCodeScore = codeScore;
      let finalReview = anyReview;
      if (onlyQids) {
        const { data: allCodeQs } = await admin
          .from("questions").select("id")
          .eq("question_set_id", asg.question_set_id).eq("question_type", "code");
        const codeIds = (allCodeQs || []).map((q) => q.id);
        if (codeIds.length) {
          const { data: codeAns } = await admin
            .from("answers").select("id, score")
            .eq("assignment_id", assignmentId).in("question_id", codeIds);
          finalCodeScore = (codeAns || []).reduce((a, r) => a + (Number(r.score) || 0), 0);
          const ansIds = (codeAns || []).map((r) => r.id);
          if (ansIds.length) {
            const { data: fbs } = await admin
              .from("code_feedback")
              .select("status, admin_override_status").in("answer_id", ansIds);
            finalReview = (fbs || []).some((f) => (f.admin_override_status || f.status) === "manual_review");
          }
        }
      }
      await admin.from("assignments").update({
        code_score: finalCodeScore,
        total_score: objective + finalCodeScore,
        status: finalReview ? "manual_review" : "graded",
        graded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", assignmentId);

      return res.status(200).json({ results, model: usedModel, code_score: finalCodeScore });
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
      const scaled = scaleScore(r.score, rubricTotal(src.rubric), Number.isFinite(src.max_score) ? src.max_score : rubricTotal(src.rubric));
      return {
        question_id: src.question_id ?? null,
        status: r.status, score: scaled,
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
