// ============================================================
// Change Password — 첫 로그인 시 비밀번호 변경 (Figma 1:117)
// ============================================================

const form = document.getElementById("cpForm");
const pwInput = document.getElementById("newPw");
const pwToggle = document.getElementById("pwToggle");
const cpBtn = document.getElementById("cpBtn");
const errorBox = document.getElementById("cpError");
const helloEl = document.getElementById("cpHello");

// 로그인 안 했으면 로그인 화면으로
(async () => {
  const { data: { session } } = await window.sb.auth.getSession();
  if (!session) location.replace("../login/login.html");
})();

// 로그인한 학생 이름/아이디로 인사말 채우기 (언어 전환 시에도 갱신)
const who = localStorage.getItem("studentName") || localStorage.getItem("studentId") || "MiCT";
function updateHello() { helloEl.textContent = t("cp_hello", { name: who }); }
updateHello();
window.addEventListener("i18n:change", updateHello);

pwToggle.addEventListener("click", () => {
  const shown = pwInput.type === "text";
  pwInput.type = shown ? "password" : "text";
  pwToggle.setAttribute("aria-pressed", String(!shown));
  pwToggle.setAttribute("aria-label", shown ? t("hide_password") : t("show_password"));
  pwInput.focus({ preventScroll: true });
});

function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; }
function clearError() { errorBox.hidden = true; errorBox.textContent = ""; }
pwInput.addEventListener("input", clearError);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  const pw = pwInput.value;

  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    showError(t("cp_err_short")); pwInput.focus(); return;
  }

  cpBtn.disabled = true;
  const original = cpBtn.textContent;
  cpBtn.textContent = t("cp_btn_saving");

  try {
    // 1) 비밀번호 변경
    const { error: upErr } = await window.sb.auth.updateUser({ password: pw });
    if (upErr) {
      showError(t("cp_err_fail"));
      cpBtn.disabled = false; cpBtn.textContent = original;
      return;
    }

    // 2) must_change_password = false (RPC) — 실패해도 비번은 바뀌었으므로 홈으로 진행
    const { error: rpcErr } = await window.sb.rpc("mark_password_changed");
    if (rpcErr) console.error("[mark_password_changed]", rpcErr);

    // 3) 홈으로
    window.location.href = "../home/home.html";
  } catch (err) {
    console.error(err);
    showError(t("cp_err_fail"));
    cpBtn.disabled = false;
    cpBtn.textContent = original;
  }
});
