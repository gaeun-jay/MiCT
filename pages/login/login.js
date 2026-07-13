// ============================================================
// Login — Python Coding Practice
// Password visibility toggle + form submit stub.
// (Supabase Auth 연동은 이후 단계에서 붙입니다.)
// ============================================================

const form = document.getElementById("loginForm");
const idInput = document.getElementById("studentId");
const pwInput = document.getElementById("password");
const pwToggle = document.getElementById("pwToggle");
const loginBtn = document.getElementById("loginBtn");
const errorBox = document.getElementById("loginError");

// ---- Password show / hide ----
pwToggle.addEventListener("click", () => {
  const shown = pwInput.type === "text";
  pwInput.type = shown ? "password" : "text";
  pwToggle.setAttribute("aria-pressed", String(!shown));
  pwToggle.setAttribute("aria-label", shown ? t("show_password") : t("hide_password"));
  pwInput.focus({ preventScroll: true });
});

// ---- Helpers ----
function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}
function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

[idInput, pwInput].forEach((el) => el.addEventListener("input", clearError));

// ---- Submit (stub) ----
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const studentId = idInput.value.trim();
  const password = pwInput.value;

  if (!studentId) {
    showError(t("login_err_id"));
    idInput.focus();
    return;
  }
  if (!password) {
    showError(t("login_err_pw"));
    pwInput.focus();
    return;
  }

  loginBtn.disabled = true;
  const original = loginBtn.textContent;
  loginBtn.textContent = "…";

  try {
    // 1) Student001 -> student001@pythonclass.local
    const email = window.idToEmail(studentId);

    // 2) Supabase Auth 로그인
    const { data, error } = await window.sb.auth.signInWithPassword({ email, password });
    if (error) {
      showError(t("login_err_fail"));
      loginBtn.disabled = false;
      loginBtn.textContent = original;
      return;
    }

    // 3) 학생 정보 조회 (본인 행만 RLS 허용) → 이름/비번변경 여부
    const { data: student } = await window.sb
      .from("students")
      .select("student_code, name, must_change_password, is_active")
      .eq("auth_user_id", data.user.id)
      .single();

    if (student && student.is_active === false) {
      await window.sb.auth.signOut();
      showError(t("login_err_deactivated"));
      loginBtn.disabled = false;
      loginBtn.textContent = original;
      return;
    }

    // 마지막 로그인 일시 기록 (관리자 대시보드 표시용)
    // 반드시 await — 아래 페이지 이동(location.href) 전에 완료해야 요청이 취소되지 않음.
    // 실패해도 로그인 흐름은 막지 않음.
    try {
      const { error: loginErr } = await window.sb.rpc("record_login");
      if (loginErr) console.warn("record_login failed:", loginErr.message);
    } catch (e) {
      console.warn("record_login error:", e);
    }

    // 표시용 정보 저장
    localStorage.setItem("studentId", student?.student_code || studentId);
    if (student?.name) localStorage.setItem("studentName", student.name);

    // 4) 첫 로그인이면 비밀번호 변경, 아니면 홈
    window.location.href = student?.must_change_password
      ? "../change-password/change-password.html"
      : "../home/home.html";
  } catch (err) {
    console.error(err);
    showError(t("login_err_generic"));
    loginBtn.disabled = false;
    loginBtn.textContent = original;
  }
});
