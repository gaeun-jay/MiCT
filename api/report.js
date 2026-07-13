// ============================================================
// POST /api/report — 학생 성장 분석 서술 생성 (관리자 전용)
//   · 대시보드에서 계산한 통계(stats)를 받아 Claude가 서술형 분석을 작성
//   · 언어: ko | en | uk (레포트 언어와 일치)
//   · 데이터에 없는 내용은 지어내지 않음
//
// 필요한 Vercel 환경변수: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// 요청: { "students": [ { "code","name","stats":{...} } ], "language":"ko" }
// 응답: { "analyses": [ { "code","summary","strengths":[],"weaknesses":[],"recommendations":[] } ] }
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 120 };

const MODEL = "claude-opus-4-8";
const LANG_NAME = { ko: "Korean", en: "English", uk: "Ukrainian" };

const SYSTEM_PROMPT = `You are an experienced, encouraging Python teacher writing a growth report for a beginner student, based only on their practice data.

Rules:
- Write in {LANG}. Every string you output must be in {LANG}.
- Base everything ONLY on the provided stats. Never invent numbers, concepts, or events not present in the data.
- Be concrete and specific: cite the actual concepts, difficulties, and accuracy the data shows.
- Be warm and motivating, appropriate for a child/beginner, but honest about what needs work.
- "strengths": concepts/skills the data shows the student does well (high accuracy). Empty array if the data is too sparse.
- "weaknesses": concepts/skills with low accuracy that need more practice.
- "recommendations": 2-4 concrete next steps (which concepts to review, trying a higher difficulty, etc.).
- "summary": 2-3 sentences on overall progress and engagement.
- Match each analysis to the student by their "code".`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    analyses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: { type: "string" },
          summary: { type: "string" },
          strengths: { type: "array", items: { type: "string" } },
          weaknesses: { type: "array", items: { type: "string" } },
          recommendations: { type: "array", items: { type: "string" } },
        },
        required: ["code", "summary", "strengths", "weaknesses", "recommendations"],
      },
    },
  },
  required: ["analyses"],
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "report" });
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
  const { data: prof } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
  if (!prof || prof.role !== "admin") return res.status(403).json({ error: "Admin only." });

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  const students = Array.isArray(body.students) ? body.students : null;
  const language = ["ko", "en", "uk"].includes(body.language) ? body.language : "ko";
  if (!students || !students.length) return res.status(400).json({ error: "students[] required." });
  if (students.length > 30) return res.status(400).json({ error: "Too many students (max 30 per request)." });

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM_PROMPT.replaceAll("{LANG}", LANG_NAME[language]),
      messages: [
        {
          role: "user",
          content:
            `Write a growth analysis for each student below, in ${LANG_NAME[language]}, based only on their stats. ` +
            "Match each result to the student by `code`.\n\n" +
            JSON.stringify({ students }, null, 2),
        },
      ],
    });
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock) throw new Error("No structured output returned.");
    const parsed = JSON.parse(textBlock.text);
    return res.status(200).json({ analyses: parsed.analyses || [], model: message.model });
  } catch (err) {
    console.error("[report] error", err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    return res.status(status).json({ error: err?.message || "Report generation failed." });
  }
}
