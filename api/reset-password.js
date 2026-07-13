// ============================================================
// POST /api/reset-password — 학생 비밀번호 재발급 (관리자 전용)
//   · service_role 로 해당 학생 Auth 유저의 비밀번호를 새 임시 비밀번호로 교체
//   · students.must_change_password = true 로 설정 (다음 로그인 시 변경 강제)
//   · 새 임시 비밀번호를 응답으로 돌려줌 (관리자가 학생에게 전달)
//
// 필요한 Vercel 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// 요청:
//   POST /api/reset-password
//   Authorization: Bearer <관리자 access token>
//   { "student_code": "Student001" }
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { randomInt } from "crypto";

export const config = { maxDuration: 30 };

const PW_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz"; // 혼동 문자 제외
const PW_DIGITS = "23456789";

function genPassword() {
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

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "reset-password" });
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
  const code = String(body.student_code || "").trim().replace(/\s+/g, "");
  if (!code) return res.status(400).json({ error: "student_code required." });

  // 학생 → auth_user_id 확인
  const { data: student } = await admin
    .from("students")
    .select("id, auth_user_id, name")
    .eq("student_code", code)
    .single();
  if (!student) return res.status(404).json({ error: "Student not found." });
  if (!student.auth_user_id) return res.status(409).json({ error: "This student has no linked account yet." });

  const password = genPassword();

  // Auth 비밀번호 교체
  const { error: updErr } = await admin.auth.admin.updateUserById(student.auth_user_id, { password });
  if (updErr) return res.status(500).json({ error: updErr.message });

  // 다음 로그인 시 변경 강제
  await admin.from("students")
    .update({ must_change_password: true, updated_at: new Date().toISOString() })
    .eq("id", student.id);

  return res.status(200).json({ ok: true, student_code: code, name: student.name, password });
}
