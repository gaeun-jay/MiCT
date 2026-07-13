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
// 홈에서 특정 난이도로 진입 시 미리 선택 (?difficulty=easy|medium|hard)
const preDiff = ({ easy: "Easy", medium: "Medium", hard: "Hard" })[(params.get("difficulty") || "").toLowerCase()] || null;

const TYPE_KEY = { ox: "type_ox", multiple_choice: "type_mc", blank: "type_blank", code: "type_code" };
const DIFF_KEY = { Easy: "diff_easy", Medium: "diff_medium", Hard: "diff_hard" };
const diffLabelOf = (v) => t(DIFF_KEY[v] || "diff_easy");

// 콘텐츠 다국어: uk 선택 시 번역본, 없으면 영어 폴백 (코드는 항상 원문)
const isUk = () => window.I18N && window.I18N.getLang() === "uk";
const qText = (q) => (isUk() && q.question_text_uk) ? q.question_text_uk : (q.question_text || "");
const qChoices = (q) => (isUk() && Array.isArray(q.choices_uk)) ? q.choices_uk : (Array.isArray(q.choices) ? q.choices : []);
const wcText = (r) => (isUk() && r.wrong_comment_uk) ? r.wrong_comment_uk : (r.wrong_comment || "");

// ---- 상태 ----
let started = false, submitted = false, difficulty = preDiff || "Easy";
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
const psTitle = document.getElementById("psTitle");

let qCount = 0;
function updateTimer() { timerEl.textContent = `${t("time_prefix")} ${fmt(seconds)}`; }

// 언어 전환 시 정적 UI(제목/버튼/난이도/타이머/문제수) 갱신
function refreshChrome() {
  psTitle.textContent = `${t("assignment")} ${classNo}`;
  updateTimer();
  if (started) {
    psCount.textContent = t("questions_count", { n: qCount });
    startBtn.textContent = t("in_progress");
  } else {
    startBtn.textContent = t("start");
    diffBtn.innerHTML = `${diffLabelOf(difficulty)} <span class="caret" aria-hidden="true"></span>`;
  }
  submitBtn.textContent = submitted ? t("submitted") : t("submit");
}
window.addEventListener("i18n:change", refreshChrome);

// 언어 전환 시 이미 렌더된 문제의 텍스트/보기를 스왑 (답안 선택은 유지)
function applyQuestionLang() {
  document.querySelectorAll("#questions .q").forEach((qEl) => {
    const q = questionsById[qEl.dataset.qid];
    if (!q) return;
    const numEl = qEl.querySelector(".q-num");
    if (numEl) numEl.textContent = `${t("question_single")} ${q.question_number ?? ""}`.trim();
    const tEl = qEl.querySelector(".q-text");
    if (tEl) tEl.textContent = qText(q);
    if (q.question_type === "multiple_choice") {
      const chs = qChoices(q);
      qEl.querySelectorAll(".mc-opt").forEach((btn, ci) => {
        const span = btn.querySelector("span:last-child");
        if (span && chs[ci] != null) span.textContent = chs[ci];
      });
    }
  });
}
window.addEventListener("i18n:change", applyQuestionLang);

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
  diffBtn.innerHTML = `${diffLabelOf(difficulty)} <span class="caret" aria-hidden="true"></span>`;
  diffMenu.hidden = true;
});
document.addEventListener("click", (e) => {
  if (!diffWrap.contains(e.target)) diffMenu.hidden = true;
});

// ---- 타이머 ----
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// URL 로 지정된 난이도를 드롭다운에 반영
if (preDiff) diffMenu.querySelectorAll("li").forEach((x) => x.classList.toggle("is-sel", x.dataset.v === preDiff));
refreshChrome();  // 초기 언어로 제목/버튼/난이도/타이머 표기

// ---- 문제 렌더 ----
function renderQuestion(q, i) {
  const n = q.question_number ?? i + 1;
  let body = "";
  if (q.question_type === "ox") {
    body = `<div class="ox-opts">
      <button type="button" class="ox-btn" data-v="O">O</button>
      <button type="button" class="ox-btn" data-v="X">X</button></div>`;
  } else if (q.question_type === "multiple_choice") {
    const choices = qChoices(q);
    body = `<div class="mc-opts">${choices.map((c, ci) =>
      `<button type="button" class="mc-opt" data-v="${ci + 1}">
         <span class="mc-num">${ci + 1}</span><span>${escapeHtml(c)}</span></button>`).join("")}</div>`;
  } else if (q.question_type === "blank") {
    body = `<input type="text" class="blank-input" placeholder="${t("answer_placeholder")}" autocomplete="off" spellcheck="false">`;
  } else if (q.question_type === "code") {
    body = `<textarea class="code-input" spellcheck="false" placeholder="# Write your code here\n"></textarea>`;
  }
  return `<article class="q" data-qid="${q.id}" data-type="${q.question_type}">
    <div class="q-head"><span class="q-num">${t("question_single")} ${n}</span><span class="q-type">${t(TYPE_KEY[q.question_type]) || q.question_type}</span></div>
    <p class="q-text">${escapeHtml(qText(q))}</p>
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
      const msg = /no questions/i.test(sErr.message) ? t("err_no_questions_diff")
        : /already submitted/i.test(sErr.message) ? t("err_already_submitted")
        : /not available/i.test(sErr.message) ? t("err_not_published")
        : `${sErr.message}`;
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
      startHint.innerHTML = `<p style="color:#b3352c">${t("err_load_questions")}</p>`;
      startBtn.disabled = false; startBtn.textContent = orig;
      return;
    }

    questions = qs;
    qCount = qs.length;
    qs.forEach((q) => { questionsById[q.id] = q; });
    qWrap.innerHTML = qs.map(renderQuestion).join("");
    psCount.textContent = t("questions_count", { n: qCount });

    started = true;
    qWrap.classList.remove("is-locked");
    qWrap.setAttribute("aria-hidden", "false");
    startHint.style.display = "none";
    diffWrap.classList.add("is-disabled");
    startBtn.textContent = t("in_progress");
    submitBtn.disabled = false;
    timerId = setInterval(() => { seconds++; updateTimer(); }, 1000);
    saveNote.textContent = t("in_progress");
  } catch (err) {
    console.error(err);
    startHint.innerHTML = `<p style="color:#b3352c">${t("err_generic")}</p>`;
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
  if (!confirm(t("confirm_submit"))) return;

  submitted = true;
  clearInterval(timerId);
  submitBtn.disabled = true;
  submitBtn.textContent = t("grading");
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
    submitBtn.textContent = t("submitted");
    saveNote.textContent = t("submitted");
  } catch (err) {
    console.error(err);
    submitBtn.textContent = t("submit_failed");
    alert(t("err_submit") + " " + (err.message || err));
  }
});

// ---- 결과 렌더 ----
// 상태 아이콘 (이모지 대신 인라인 SVG)
const ICON = {
  ok: `<svg class="r-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
  wrong: `<svg class="r-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  pending: `<svg class="r-ico r-ico--spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>`,
};

function correctText(r) {
  const q = questionsById[r.question_id] || {};
  const c = r.correct;
  if (r.type === "ox") return `<b>${c}</b>`;
  if (r.type === "multiple_choice") {
    const choices = qChoices(q);
    const n = Number(c);
    return `<b>#${n}</b>${choices[n - 1] ? ` (${escapeHtml(choices[n - 1])})` : ""}`;
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
      el.innerHTML = `<p class="r-title">${ICON.ok} ${t("res_correct")}</p>`;
    } else {
      el.className = "q-result show q-result--wrong";
      qEl?.classList.add("graded-wrong");
      el.innerHTML = `<p class="r-title">${ICON.wrong} ${t("res_incorrect")}</p><p class="r-comment">${t("res_answer")}: ${correctText(r)}. ${escapeHtml(wcText(r))}</p>`;
    }
  });
}
function markCodePending() {
  questions.filter((q) => q.question_type === "code").forEach((q) => {
    const el = document.getElementById(`result-${q.id}`);
    if (el) { el.className = "q-result show q-result--review"; el.innerHTML = `<p class="r-title">${ICON.pending} ${t("res_grading_ai")}</p>`; }
  });
}
function markCodeError(msg) {
  questions.filter((q) => q.question_type === "code").forEach((q) => {
    const el = document.getElementById(`result-${q.id}`);
    if (el) el.innerHTML = `<p class="r-title">${t("res_code_error")}</p><p class="r-comment">${escapeHtml(msg)}</p>`;
  });
}
function renderCodeResults(results) {
  const STATUS = { correct: t("res_correct"), needs_revision: t("res_needs_revision"), manual_review: t("res_manual_review") };
  const CLS = { correct: "q-result--ok", needs_revision: "q-result--revise", manual_review: "q-result--review" };
  const STATUS_ICON = { correct: ICON.ok, needs_revision: ICON.wrong, manual_review: ICON.pending };
  results.forEach((r) => {
    const el = document.getElementById(`result-${r.question_id}`);
    if (!el) return;
    el.className = `q-result show ${CLS[r.status] || "q-result--review"}`;
    // 우크라이나어 선택 시 uk 피드백 (없으면 영어 폴백)
    const useUk = isUk();
    const sArr = (useUk && Array.isArray(r.strengths_uk) && r.strengths_uk.length) ? r.strengths_uk : (r.strengths || []);
    const iArr = (useUk && Array.isArray(r.issues_uk) && r.issues_uk.length) ? r.issues_uk : (r.issues || []);
    const cmt = (useUk && r.comment_uk) ? r.comment_uk : (r.comment || "");
    const strengths = sArr.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
    const issues = iArr.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
    el.innerHTML =
      `<p class="r-title">${STATUS_ICON[r.status] || ICON.pending} ${STATUS[r.status] || r.status} · ${r.score}${r.max_score ? ` / ${r.max_score}` : ""} ${t("pts")}</p>
       <p class="r-comment">${escapeHtml(cmt)}</p>
       ${strengths ? `<div class="r-comment"><b>${t("res_strengths")}</b><ul>${strengths}</ul></div>` : ""}
       ${issues ? `<div class="r-comment"><b>${t("res_tofix")}</b><ul>${issues}</ul></div>` : ""}`;
  });
}
function showSummary(obj) {
  const banner = document.createElement("div");
  banner.className = "ps-summary";
  const codePts = obj.objective_max != null ? 100 - obj.objective_max : 50;
  banner.innerHTML = `<h3>${t("results")}</h3>
    <p>${t("auto_graded")}: <span class="s-score">${obj.objective_correct} / ${obj.objective_total}</span> ${t("correct_word")} · ${t("objective")} <b>${obj.objective_points ?? 0}</b> / ${obj.objective_max ?? 0} ${t("pts")} · ${t("time_prefix")} ${fmt(seconds)}</p>
    <p>${t("code_ai_note", { n: codePts })}</p>`;
  qWrap.prepend(banner);
  qWrap.scrollIntoView({ behavior: "smooth" });
}
