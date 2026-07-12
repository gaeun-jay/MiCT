// 관리자 로그인 — Supabase Auth 연동
const form = document.getElementById("loginForm");
const errorBox = document.getElementById("adminError");
const submitBtn = form.querySelector('button[type="submit"]');

function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; }
function clearError() { errorBox.hidden = true; errorBox.textContent = ""; }

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const adminId = document.getElementById("adminId").value.trim();
  const adminPw = document.getElementById("adminPw").value;
  if (!adminId || !adminPw) { showError("아이디와 비밀번호를 입력하세요."); return; }

  const email = window.idToEmail(adminId);
  submitBtn.disabled = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = "로그인 중…";

  try {
    // 1) 로그인
    const { data, error } = await window.sb.auth.signInWithPassword({ email, password: adminPw });
    if (error) {
      console.error("[signIn error]", error);
      showError(`로그인 실패: ${error.message} (${error.status ?? ""})`);
      return;
    }

    // 2) 관리자 권한 확인 (profiles.role === 'admin')
    const { data: profile, error: pErr } = await window.sb
      .from("profiles").select("role").eq("id", data.user.id).single();
    if (pErr || !profile || profile.role !== "admin") {
      await window.sb.auth.signOut();
      showError("관리자 권한이 없는 계정입니다.");
      return;
    }

    // 3) 대시보드로 이동
    window.location.href = "../dashboard/dashboard.html";
  } catch (err) {
    console.error(err);
    showError("로그인 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = original;
  }
});
