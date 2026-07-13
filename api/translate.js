// ============================================================
// POST /api/translate — 문제/설명 텍스트를 우크라이나어로 번역 (관리자 전용)
//   · 코드(백틱 안, input()/print() 등 파이썬 식별자·리터럴·연산자)는 절대 번역/변형하지 않음
//   · 자연어 설명만 번역
//   · 업로드 시 dashboard.js 가 호출해 *_uk 필드를 채움
//
// 필요한 Vercel 환경변수: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// 요청: { "items": [ { "key":"q0.t", "text":"A variable is ..." }, ... ], "target":"uk" }
// 응답: { "translations": [ { "key":"q0.t", "text":"Змінна — це ..." }, ... ] }
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 120 };

const MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = `You translate a Python learning app's text from English to Ukrainian for beginner students.

STRICT RULES:
- Translate ONLY natural-language prose.
- NEVER translate, transliterate, or alter anything that is code:
  * anything inside backticks (\`...\`) — keep the backticks and their contents byte-for-byte
  * Python keywords, built-in functions and identifiers (input, print, int, str, float, range, len, type, if, else, for, while, def, return, True, False, None, etc.)
  * string literals, numbers used as code, operators (=, ==, %, //, +, etc.), and any variable/function names
- Keep all formatting, punctuation, capitalization of code, and backticks exactly as in the source.
- Natural, friendly, correct Ukrainian suitable for children/beginners.
- Return one translation per input item, matched by its "key". Preserve the key exactly.
- If an item is purely code (nothing to translate), return it unchanged.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { key: { type: "string" }, text: { type: "string" } },
        required: ["key", "text"],
      },
    },
  },
  required: ["translations"],
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
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "translate" });
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
  const items = Array.isArray(body.items) ? body.items.filter((it) => it && it.key && typeof it.text === "string") : null;
  if (!items || !items.length) return res.status(400).json({ error: "items[] required." });
  if (items.length > 400) return res.status(400).json({ error: "Too many items (max 400)." });

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            "Translate each item's `text` from English to Ukrainian following the rules. " +
            "Return a translation for every item, matched by its `key`.\n\n" +
            JSON.stringify({ items }, null, 2),
        },
      ],
    });
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock) throw new Error("No structured output returned.");
    const parsed = JSON.parse(textBlock.text);
    return res.status(200).json({ translations: parsed.translations || [], model: message.model });
  } catch (err) {
    console.error("[translate] error", err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    return res.status(status).json({ error: err?.message || "Translation failed." });
  }
}
