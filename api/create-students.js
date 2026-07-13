// ============================================================
// POST /api/create-students — 학생 계정 일괄/단일 생성 (관리자 전용)
//   · service_role 로 Supabase Auth 유저 생성 + 임시 비밀번호 발급
//   · user_metadata(role/student_code/name/age)로 트리거가 profiles+students 자동 생성
//   · 생성된 임시 비밀번호를 응답으로 돌려줌 (관리자가 배포 — 최초 로그인 시 변경 강제)
//
// 필요한 Vercel 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// 요청:
//   POST /api/create-students
//   Authorization: Bearer <관리자 access token>
//   { "students": [ { "student_code":"Student001", "name":"Іванців Єва", "age":14 }, ... ] }
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { randomInt } from "crypto";

export const config = { maxDuration: 60 };

const EMAIL_DOMAIN = "pythonclass.local";
const PW_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz"; // 혼동 문자 제외
const PW_DIGITS = "23456789";

function genPassword() {
  // 영문+숫자 혼합 10자 (앞뒤로 영문/숫자 보장)
  let mid = "";
  for (let i = 0; i < 6; i++) mid += PW_CHARS[randomInt(PW_CHARS.length)];
  const d1 = PW_DIGITS[randomInt(PW_DIGITS.length)];
  const d2 = PW_DIGITS[randomInt(PW_DIGITS.length)];
  const a = PW_CHARS[randomInt(PW_CHARS.length)].toUpperCase();
  return a + mid + d1 + d2;
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

// 동시성 제한 실행
async function pool(items, size, worker) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const rs = await Promise.all(batch.map(worker));
    out.push(...rs);
  }
  return out;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "create-students" });
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

  // 관리자 확인
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: "Invalid or expired session." });
  const { data: prof } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
  if (!prof || prof.role !== "admin") return res.status(403).json({ error: "Admin only." });

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  const list = Array.isArray(body.students) ? body.students : null;
  if (!list || !list.length) return res.status(400).json({ error: "students[] required." });
  if (list.length > 200) return res.status(400).json({ error: "Too many (max 200 per request)." });

  const results = await pool(list, 10, async (s) => {
    const code = String(s.student_code || "").trim();
    const name = String(s.name || "").trim();
    const ageNum = parseInt(s.age, 10);
    if (!/^student\s*\d+/i.test(code)) {
      return { student_code: code, name, status: "error", error: "invalid student_code" };
    }
    const cleanCode = code.replace(/\s+/g, "");
    const email = `${cleanCode.toLowerCase()}@${EMAIL_DOMAIN}`;
    const password = genPassword();

    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: "student",
        student_code: cleanCode,
        name,
        age: Number.isFinite(ageNum) ? String(ageNum) : "",
      },
    });

    if (error) {
      // 이미 존재하는 계정 → 이름/나이만 갱신
      if (/already/i.test(error.message) || error.status === 422) {
        await admin.from("students")
          .update({ name, age: Number.isFinite(ageNum) ? ageNum : null, updated_at: new Date().toISOString() })
          .eq("student_code", cleanCode);
        return { student_code: cleanCode, name, status: "exists", password: null };
      }
      return { student_code: cleanCode, name, status: "error", error: error.message };
    }
    return { student_code: cleanCode, name, status: "created", password };
  });

  const created = results.filter((r) => r.status === "created").length;
  const existed = results.filter((r) => r.status === "exists").length;
  const errored = results.filter((r) => r.status === "error").length;

  return res.status(200).json({ ok: true, created, existed, errored, results });
}
