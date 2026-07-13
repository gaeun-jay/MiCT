// ============================================================
// Register — 학생 셀프 회원가입
//   first/last name, 나이대(age_group), 아이디, 비밀번호(문자+숫자 8자 이상)
//   Supabase Auth signUp → 트리거가 profiles + students 자동 생성
//   (Supabase Authentication 설정에서 'Confirm email'을 꺼야 가상 이메일로 바로 로그인됨)
// ============================================================

const form = document.getElementById("regForm");
const firstEl = document.getElementById("firstName");
const lastEl = document.getElementById("lastName");
const ageEl = document.getElementById("ageGroup");
const idEl = document.getElementById("regId");
const pwEl = document.getElementById("regPw");
const pwToggle = document.getElementById("pwToggle");
const regBtn = document.getElementById("regBtn");
const errorBox = document.getElementById("regError");

// 이미 로그인돼 있으면 홈으로
(async () => {
  const { data: { session } } = await window.sb.auth.getSession();
  if (session) location.replace("../home/home.html");
})();

pwToggle.addEventListener("click", () => {
  const shown = pwEl.type === "text";
  pwEl.type = shown ? "password" : "text";
  pwToggle.setAttribute("aria-pressed", String(!shown));
  pwToggle.setAttribute("aria-label", shown ? t("hide_password") : t("show_password"));
  pwEl.focus({ preventScroll: true });
});

function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; }
function clearError() { errorBox.hidden = true; errorBox.textContent = ""; }
[firstEl, lastEl, ageEl, idEl, pwEl].forEach((el) => el.addEventListener("input", clearError));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const first = firstEl.value.trim();
  const last = lastEl.value.trim();
  const ageGroup = ageEl.value;
  const id = idEl.value.trim();
  const pw = pwEl.value;

  if (!first || !last) { showError(t("reg_err_name")); firstEl.focus(); return; }
  if (!ageGroup) { showError(t("reg_err_age")); ageEl.focus(); return; }
  if (!/^[A-Za-z0-9_]{3,}$/.test(id)) { showError(t("reg_err_id")); idEl.focus(); return; }
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) { showError(t("reg_err_pw")); pwEl.focus(); return; }

  regBtn.disabled = true;
  const original = regBtn.textContent;
  regBtn.textContent = t("reg_creating");

  try {
    const email = window.idToEmail(id);
    const { error: upErr } = await window.sb.auth.signUp({
      email,
      password: pw,
      options: { data: { role: "student", student_code: id, name: `${first} ${last}`, age_group: ageGroup } },
    });
    if (upErr) {
      if (/already|registered|exists/i.test(upErr.message)) showError(t("reg_err_taken"));
      else { console.error(upErr); showError(t("reg_err_generic")); }
      regBtn.disabled = false; regBtn.textContent = original;
      return;
    }

    // 세션 확보 (Confirm email 이 꺼져 있으면 바로 로그인됨)
    const { data: sd, error: siErr } = await window.sb.auth.signInWithPassword({ email, password: pw });
    if (siErr || !sd?.session) {
      console.warn("signIn after signUp failed:", siErr?.message);
      showError(t("reg_err_generic"));
      regBtn.disabled = false; regBtn.textContent = original;
      return;
    }

    localStorage.setItem("studentId", id);
    localStorage.setItem("studentName", `${first} ${last}`);
    regBtn.textContent = t("reg_done");
    window.location.href = "../home/home.html";
  } catch (err) {
    console.error(err);
    showError(t("reg_err_generic"));
    regBtn.disabled = false;
    regBtn.textContent = original;
  }
});
