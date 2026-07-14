// ============================================================
// POST /api/delete-student — 학생 계정 완전 삭제 (관리자 전용)
//   · students 행 삭제 → assignments/answers/code_feedback 도 cascade 삭제
//   · auth 계정 삭제 → profiles 도 cascade 삭제
//   · report_exports 는 student_id 만 null 처리(기록 보존)
//
// 필요한 Vercel 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// 요청:
//   POST /api/delete-student
//   Authorization: Bearer <관리자 access token>
//   { "student_code": "Student001" }
// ============================================================

import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 30 };

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "delete-student" });
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

  // 학생 조회
  const { data: student } = await admin
    .from("students")
    .select("id, auth_user_id, name")
    .eq("student_code", code)
    .single();
  if (!student) return res.status(404).json({ error: "Student not found." });

  // 1) students 행 삭제 (assignments/answers/code_feedback cascade)
  const { error: delErr } = await admin.from("students").delete().eq("id", student.id);
  if (delErr) return res.status(500).json({ error: delErr.message });

  // 2) auth 계정 삭제 (profiles cascade)
  if (student.auth_user_id) {
    const { error: authErr } = await admin.auth.admin.deleteUser(student.auth_user_id);
    if (authErr) {
      // students 는 이미 삭제됨 — auth 삭제만 실패한 경우 경고만
      return res.status(207).json({ ok: true, warning: "student row deleted, but auth delete failed: " + authErr.message, student_code: code });
    }
  }

  return res.status(200).json({ ok: true, student_code: code, name: student.name });
}
