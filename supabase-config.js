// ============================================================
// Supabase 공유 클라이언트 설정
// 이 파일은 CDN의 supabase-js(<script>) 다음에 로드되어야 합니다.
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="<상대경로>/supabase-config.js"></script>
//
// 여기 값은 '공개(publishable)' 값이라 브라우저에 넣어도 안전합니다.
// RLS 가 접근을 통제합니다. service_role/secret 키는 절대 여기 넣지 마세요.
// ============================================================

const SUPABASE_URL = "https://bvegpjmpxbtcxxxbwobf.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9Ne8l0S6d4jwvERyf3TbWw_4yfzEOvV";

// 전역 클라이언트
window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// 학생/관리자 아이디 → 가상 이메일 (스펙 §4.3)
//   "Student001" -> "student001@pythonclass.local"
//   "admin"      -> "admin@pythonclass.local"
//   이미 이메일이면(@ 포함) 그대로 사용
window.idToEmail = (id) => {
  const v = String(id || "").trim();
  return v.includes("@") ? v.toLowerCase() : `${v.toLowerCase()}@pythonclass.local`;
};

// 로그아웃 헬퍼
window.signOutTo = async (redirect) => {
  try { await window.sb.auth.signOut(); } catch (e) { console.error(e); }
  window.location.href = redirect;
};
