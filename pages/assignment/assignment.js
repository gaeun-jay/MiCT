// ============================================================
// Class 문제풀이 — Supabase 연동
//   시작: start_assignment RPC → get_student_questions(정답 없는 문제)
//   제출: 답안 저장 → grade_objective RPC(서버 채점) + /api/grade(코드 채점)
// ============================================================

const API_BASE =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "https://mi-ct.vercel.app"
    : "";
async function getToken() {
  const { data: { session } } = await window.sb.auth.getSession();
  return session?.access_token || null;
}

const params = new URLSearchParams(location.search);
const classNo = params.get("class") || "1";
document.getElementById("psTitle").textContent = `Assignment ${classNo}`;

const TYPE_LABEL = { ox: "OX", multiple_choice: "Multiple Choice", blank: "Fill-in", code: "Code" };

// ---- 상태 ----
let started = false, submitted = false, difficulty = "Easy";
let seconds = 0, timerId = null;
let assignmentId = null, questionSetId = null;
let questions = [];                 // get_student_questions 결과
const questionsById = {};

const qWrap = document.getElementById("questions");
const startBtn = document.getElementById("startBtn");
const submitBtn = document.getElementById("submitBtn");
const timerEl = document.getElementById("timer");
const startHint = document.getElementById("startHint");
const diffWrap = document.getElementById("diffWrap");
const diffBtn = document.getElementById("diffBtn");
const diffMenu = document.getElementById("diffMenu");
const saveNote = document.getElementById("saveNote");
const psCount = document.getElementById("psCount");

// ---- 인증 가드 ----
(async () => {
  const { data: { session } } = await window.sb.auth.getSession();
  if (!session) location.replace("../login/login.html");
})();

// ---- 난이도 드롭다운 ----
diffBtn.addEventListener("click", () => {
  if (started) return;
  const open = !diffMenu.hidden;
  diffMenu.hidden = open;
  diffBtn.setAttribute("aria-expanded", String(!open));
});
diffMenu.addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  difficulty = li.dataset.v;
  diffMenu.querySelectorAll("li").forEach((x) => x.classList.toggle("is-sel", x === li));
  diffBtn.innerHTML = `${difficulty} <span class="caret" aria-hidden="true"></span>`;
  diffMenu.hidden = true;
});
document.addEventListener("click", (e) => {
  if (!diffWrap.contains(e.target)) diffMenu.hidden = true;
});

// ---- 타이머 ----
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// ---- 문제 렌더 ----
function renderQuestion(q, i) {
  const n = q.question_number ?? i + 1;
  let body = "";
  if (q.question_type === "ox") {
    body = `<div class="ox-opts">
      <button type="button" class="ox-btn" data-v="O">O</button>
      <button type="button" class="ox-btn" data-v="X">X</button></div>`;
  } else if (q.question_type === "multiple_choice") {
    const choices = Array.isArray(q.choices) ? q.choices : [];
    body = `<div class="mc-opts">${choices.map((c, ci) =>
      `<button type="button" class="mc-opt" data-v="${ci + 1}">
         <span class="mc-num">${ci + 1}</span><span>${escapeHtml(c)}</span></button>`).join("")}</div>`;
  } else if (q.question_type === "blank") {
    body = `<input type="text" class="blank-input" placeholder="Your answer" autocomplete="off" spellcheck="false">`;
  } else if (q.question_type === "code") {
    body = `<textarea class="code-input" spellcheck="false" placeholder="# Write your code here\n"></textarea>`;
  }
  return `<article class="q" data-qid="${q.id}" data-type="${q.question_type}">
    <div class="q-head"><span class="q-num">Question ${n}</span><span class="q-type">${TYPE_LABEL[q.question_type] || q.question_type}</span></div>
    <p class="q-text">${escapeHtml(q.question_text || "")}</p>
    <div class="q-body">${body}</div>
    <div class="q-result" id="result-${q.id}"></div>
  </article>`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// 선택 인터랙션
qWrap.addEventListener("click", (e) => {
  const ox = e.target.closest(".ox-btn");
  if (ox) { ox.parentElement.querySelectorAll(".ox-btn").forEach((b) => b.classList.remove("is-sel")); ox.classList.add("is-sel"); }
  const mc = e.target.closest(".mc-opt");
  if (mc) { mc.parentElement.querySelectorAll(".mc-opt").forEach((b) => b.classList.remove("is-sel")); mc.classList.add("is-sel"); }
});

// ============================================================
// 시작
// ============================================================
startBtn.addEventListener("click", async () => {
  if (started) return;
  startBtn.disabled = true;
  const orig = startBtn.textContent;
  startBtn.textContent = "…";

  try {
    const { data: sd, error: sErr } = await window.sb.rpc("start_assignment", {
      p_class_number: Number(classNo),
      p_difficulty: difficulty.toLowerCase(),
    });
    if (sErr) {
      const msg = /no questions/i.test(sErr.message) ? "이 난이도의 문제가 아직 등록되지 않았어요."
        : /not available/i.test(sErr.message) ? "이 과제는 아직 공개되지 않았어요."
        : `시작 실패: ${sErr.message}`;
      startHint.innerHTML = `<p style="color:#b3352c">${msg}</p>`;
      startBtn.disabled = false; startBtn.textContent = orig;
      return;
    }
    assignmentId = sd.assignment_id;
    questionSetId = sd.question_set_id;

    const { data: qs, error: qErr } = await window.sb.rpc("get_student_questions", {
      p_question_set_id: questionSetId,
    });
    if (qErr || !qs || !qs.length) {
      startHint.innerHTML = `<p style="color:#b3352c">문제를 불러오지 못했습니다.</p>`;
      startBtn.disabled = false; startBtn.textContent = orig;
      return;
    }

    questions = qs;
    qs.forEach((q) => { questionsById[q.id] = q; });
    qWrap.innerHTML = qs.map(renderQuestion).join("");
    psCount.textContent = `${qs.length} Questions`;

    started = true;
    qWrap.classList.remove("is-locked");
    qWrap.setAttribute("aria-hidden", "false");
    startHint.style.display = "none";
    diffWrap.classList.add("is-disabled");
    startBtn.textContent = "In progress";
    submitBtn.disabled = false;
    timerId = setInterval(() => { seconds++; timerEl.textContent = `Time ${fmt(seconds)}`; }, 1000);
    saveNote.textContent = "진행 중";
  } catch (err) {
    console.error(err);
    startHint.innerHTML = `<p style="color:#b3352c">오류: ${err.message}</p>`;
    startBtn.disabled = false; startBtn.textContent = orig;
  }
});

// ============================================================
// 답안 수집
// ============================================================
function collectAnswers() {
  const rows = [];
  document.querySelectorAll(".q").forEach((qEl) => {
    const qid = qEl.dataset.qid;
    const type = qEl.dataset.type;
    const row = { assignment_id: assignmentId, question_id: qid, answer_text: null, selected_choice: null };
    if (type === "ox") {
      const sel = qEl.querySelector(".ox-btn.is-sel");
      row.answer_text = sel ? sel.dataset.v : null;
    } else if (type === "multiple_choice") {
      const sel = qEl.querySelector(".mc-opt.is-sel");
      row.selected_choice = sel ? Number(sel.dataset.v) : null;
    } else if (type === "blank") {
      row.answer_text = qEl.querySelector(".blank-input")?.value?.trim() || null;
    } else if (type === "code") {
      row.answer_text = qEl.querySelector(".code-input")?.value || null;
    }
    rows.push(row);
  });
  return rows;
}

// ============================================================
// 제출 + 채점
// ============================================================
submitBtn.addEventListener("click", async () => {
  if (!started || submitted) return;
  if (!confirm("Submit your answers? You won't be able to edit them afterwards.")) return;

  submitted = true;
  clearInterval(timerId);
  submitBtn.disabled = true;
  submitBtn.textContent = "채점 중…";
  // 입력 잠금
  document.querySelectorAll(".q button, .q input, .q textarea").forEach((el) => (el.disabled = true));

  try {
    // 1) 답안 저장
    const rows = collectAnswers();
    const { error: upErr } = await window.sb.from("answers")
      .upsert(rows, { onConflict: "assignment_id,question_id" });
    if (upErr) throw upErr;

    // 2) 서버 자동채점 (OX/객관식/빈칸)
    const { data: obj, error: gErr } = await window.sb.rpc("grade_objective", {
      p_assignment_id: assignmentId, p_duration: seconds,
    });
    if (gErr) throw gErr;
    renderObjectiveResults(obj);

    // 3) 코드 문제 Claude 채점 (서버리스)
    const hasCode = questions.some((q) => q.question_type === "code");
    if (hasCode) {
      markCodePending();
      const token = await getToken();
      const resp = await fetch(`${API_BASE}/api/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assignment_id: assignmentId }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) renderCodeResults(data.results || []);
      else markCodeError(data.error || `HTTP ${resp.status}`);
    }

    showSummary(obj);
    submitBtn.textContent = "제출 완료";
    saveNote.textContent = "제출 완료";
  } catch (err) {
    console.error(err);
    submitBtn.textContent = "제출 실패";
    alert("제출/채점 중 오류: " + (err.message || err));
  }
});

// ---- 결과 렌더 ----
function correctText(r) {
  const q = questionsById[r.question_id] || {};
  const c = r.correct;
  if (r.type === "ox") return `<b>${c}</b>`;
  if (r.type === "multiple_choice") {
    const choices = Array.isArray(q.choices) ? q.choices : [];
    const n = Number(c);
    return `<b>${n}번</b>${choices[n - 1] ? ` (${escapeHtml(choices[n - 1])})` : ""}`;
  }
  if (r.type === "blank") return `<b>${escapeHtml(Array.isArray(c) ? c[0] : c)}</b>`;
  return "-";
}
function renderObjectiveResults(obj) {
  (obj.results || []).forEach((r) => {
    const el = document.getElementById(`result-${r.question_id}`);
    if (!el) return;
    const qEl = el.closest(".q");
    if (r.is_correct) {
      el.className = "q-result show q-result--ok";
      qEl?.classList.add("graded-ok");
      el.innerHTML = `<p class="r-title">✓ Correct</p>`;
    } else {
      el.className = "q-result show q-result--wrong";
      qEl?.classList.add("graded-wrong");
      el.innerHTML = `<p class="r-title">✗ Incorrect</p><p class="r-comment">정답: ${correctText(r)}. ${escapeHtml(r.wrong_comment || "")}</p>`;
    }
  });
}
function markCodePending() {
  questions.filter((q) => q.question_type === "code").forEach((q) => {
    const el = document.getElementById(`result-${q.id}`);
    if (el) { el.className = "q-result show q-result--review"; el.innerHTML = `<p class="r-title">⏳ AI 채점 중…</p>`; }
  });
}
function markCodeError(msg) {
  questions.filter((q) => q.question_type === "code").forEach((q) => {
    const el = document.getElementById(`result-${q.id}`);
    if (el) el.innerHTML = `<p class="r-title">코드 채점 오류</p><p class="r-comment">${escapeHtml(msg)}</p>`;
  });
}
function renderCodeResults(results) {
  const STATUS = { correct: "정답으로 판단", needs_revision: "수정 필요", manual_review: "관리자 검토 필요" };
  const CLS = { correct: "q-result--ok", needs_revision: "q-result--revise", manual_review: "q-result--review" };
  results.forEach((r) => {
    const el = document.getElementById(`result-${r.question_id}`);
    if (!el) return;
    el.className = `q-result show ${CLS[r.status] || "q-result--review"}`;
    const strengths = (r.strengths || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
    const issues = (r.issues || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
    el.innerHTML =
      `<p class="r-title">${STATUS[r.status] || r.status} · ${r.score}점</p>
       <p class="r-comment">${escapeHtml(r.comment || "")}</p>
       ${strengths ? `<p class="r-comment"><b>잘한 점</b><ul>${strengths}</ul></p>` : ""}
       ${issues ? `<p class="r-comment"><b>수정할 점</b><ul>${issues}</ul></p>` : ""}`;
  });
}
function showSummary(obj) {
  const banner = document.createElement("div");
  banner.className = "ps-summary";
  const pct = obj.objective_total ? Math.round((obj.objective_correct / obj.objective_total) * 100) : 0;
  banner.innerHTML = `<h3>채점 결과</h3>
    <p>자동 채점 <span class="s-score">${obj.objective_correct} / ${obj.objective_total}</span> 정답 (${pct}%) · 풀이 시간 ${fmt(seconds)}</p>
    <p>코드 문제는 AI 평가 결과가 각 문제 아래에 표시됩니다.</p>`;
  qWrap.prepend(banner);
  qWrap.scrollIntoView({ behavior: "smooth" });
}
