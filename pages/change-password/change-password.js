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

// 로그인한 학생 이름/아이디로 인사말 채우기
const who = localStorage.getItem("studentName") || localStorage.getItem("studentId") || "MiCT";
helloEl.textContent = `Hello, ${who} !`;

pwToggle.addEventListener("click", () => {
  const shown = pwInput.type === "text";
  pwInput.type = shown ? "password" : "text";
  pwToggle.setAttribute("aria-pressed", String(!shown));
  pwToggle.setAttribute("aria-label", shown ? "Show password" : "Hide password");
  pwInput.focus({ preventScroll: true });
});

function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; }
function clearError() { errorBox.hidden = true; errorBox.textContent = ""; }
pwInput.addEventListener("input", clearError);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  const pw = pwInput.value;

  if (pw.length < 8) { showError("Password must be at least 8 characters."); pwInput.focus(); return; }
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    showError("Password must include both letters and numbers."); pwInput.focus(); return;
  }

  cpBtn.disabled = true;
  const original = cpBtn.textContent;
  cpBtn.textContent = "Changing…";

  try {
    // 1) 비밀번호 변경
    const { error: upErr } = await window.sb.auth.updateUser({ password: pw });
    if (upErr) {
      showError(`Failed to change password: ${upErr.message}`);
      cpBtn.disabled = false; cpBtn.textContent = original;
      return;
    }

    // 2) must_change_password = false (RPC)
    const { error: rpcErr } = await window.sb.rpc("mark_password_changed");
    if (rpcErr) {
      console.error("[mark_password_changed]", rpcErr);
      // 원인을 바로 볼 수 있게 표시 (디버깅용)
      alert(
        "비밀번호는 변경됐지만 상태 갱신(RPC)에 실패했습니다:\n\n" +
        `message: ${rpcErr.message}\n` +
        `code: ${rpcErr.code || "-"}\n` +
        `hint: ${rpcErr.hint || "-"}`
      );
    }

    // 3) 홈으로
    window.location.href = "../home/home.html";
  } catch (err) {
    console.error(err);
    showError("Failed to change password. Please try again.");
    cpBtn.disabled = false;
    cpBtn.textContent = original;
  }
});
