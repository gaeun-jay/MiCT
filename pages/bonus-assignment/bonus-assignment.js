// ============================================================
// Bonus 문제풀이 — Supabase 연동 (난이도 없음, OX / Fill-in / Matching)
//   시작: start_bonus_assignment RPC → get_bonus_questions(정답 없는 문제)
//   제출: 답안 저장 → grade_bonus RPC(서버 채점) — 코드/AI 없음
// ============================================================

const params = new URLSearchParams(location.search);
const topicSlug = params.get("topic") || "";
const topicName = params.get("name") || "Bonus";
document.getElementById("psTitle").textContent = topicName;

const TYPE_KEY = { ox: "type_ox", blank: "type_blank", matching: "type_matching" };

// 상태
let started = false, submitted = false, seconds = 0, timerId = null;
let assignmentId = null, bonusSetId = null;
let questions = [];
const questionsById = {};

const qWrap = document.getElementById("questions");
const startBtn = document.getElementById("startBtn");
const submitBtn = document.getElementById("submitBtn");
const timerEl = document.getElementById("timer");
const startHint = document.getElementById("startHint");
const saveNote = document.getElementById("saveNote");
const psCount = document.getElementById("psCount");

// 상태 아이콘 (이모지 대신 인라인 SVG)
const ICON = {
  ok: `<svg class="r-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
  wrong: `<svg class="r-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

// 인증 가드
(async () => {
  const { data: { session } } = await window.sb.auth.getSession();
  if (!session) location.replace("../login/login.html");
})();

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// 콘텐츠 다국어: uk 선택 시 번역본, 없으면 영어 폴백 (코드는 항상 원문)
const isUk = () => window.I18N && window.I18N.getLang() === "uk";
const qText = (q) => (isUk() && q.question_text_uk) ? q.question_text_uk : (q.question_text || "");
const qCh = (q) => (isUk() && q.choices_uk) ? q.choices_uk : (q.choices || {});
const wcText = (r) => (isUk() && r.wrong_comment_uk) ? r.wrong_comment_uk : (r.wrong_comment || "");

let qCount = 0;
function updateTimer() { timerEl.textContent = `${t("time_prefix")} ${fmt(seconds)}`; }
function refreshChrome() {
  updateTimer();
  if (started) {
    psCount.textContent = t("questions_count", { n: qCount });
    startBtn.textContent = t("in_progress");
  } else {
    startBtn.textContent = t("start");
  }
  submitBtn.textContent = submitted ? t("submitted") : t("submit");
}
window.addEventListener("i18n:change", refreshChrome);
refreshChrome();

// 언어 전환 시 렌더된 문제 텍스트/선긋기 항목 스왑 (선택은 유지)
function applyQuestionLang() {
  document.querySelectorAll("#questions .q").forEach((qEl) => {
    const q = questionsById[qEl.dataset.qid];
    if (!q) return;
    const tEl = qEl.querySelector(".q-text");
    if (tEl) tEl.textContent = qText(q);
    if (q.question_type === "matching") {
      const ch = qCh(q);
      const left = Array.isArray(ch.left) ? ch.left : [];
      const right = Array.isArray(ch.right) ? ch.right : [];
      qEl.querySelectorAll(".match-row").forEach((row) => {
        const lItem = left.find((x) => x.id === row.dataset.left);
        const term = row.querySelector(".match-term");
        if (term && lItem) term.textContent = lItem.text;
        row.querySelectorAll(".match-select option").forEach((opt) => {
          if (!opt.value) { opt.textContent = t("select_a_match"); return; }
          const rItem = right.find((x) => x.id === opt.value);
          if (rItem) opt.textContent = rItem.text;
        });
      });
    }
  });
}
window.addEventListener("i18n:change", applyQuestionLang);

// ---- 문제 렌더 ----
function renderQuestion(q, i) {
  const n = q.question_number ?? i + 1;
  let body = "";
  if (q.question_type === "ox") {
    body = `<div class="ox-opts">
      <button type="button" class="ox-btn" data-v="O">O</button>
      <button type="button" class="ox-btn" data-v="X">X</button></div>`;
  } else if (q.question_type === "blank") {
    body = `<input type="text" class="blank-input" placeholder="${t("answer_placeholder")}" autocomplete="off" spellcheck="false">`;
  } else if (q.question_type === "matching") {
    const ch = qCh(q);
    const left = Array.isArray(ch.left) ? ch.left : [];
    const right = Array.isArray(ch.right) ? ch.right : [];
    const opts = right.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.text)}</option>`).join("");
    body = `<div class="match-grid">${left.map((term) => `
      <div class="match-row" data-left="${escapeHtml(term.id)}">
        <div class="match-term">${escapeHtml(term.text)}</div>
        <div class="match-link">—</div>
        <select class="match-select"><option value="" selected disabled>${t("select_a_match")}</option>${opts}</select>
      </div>`).join("")}</div>`;
  }
  return `<article class="q" data-qid="${q.id}" data-type="${q.question_type}">
    <div class="q-head"><span class="q-num">Question ${n}</span><span class="q-type">${t(TYPE_KEY[q.question_type]) || q.question_type}</span></div>
    <p class="q-text">${escapeHtml(qText(q))}</p>
    <div class="q-body">${body}</div>
    <div class="q-result" id="result-${q.id}"></div>
  </article>`;
}

// 선택 인터랙션 (OX)
qWrap.addEventListener("click", (e) => {
  const ox = e.target.closest(".ox-btn");
  if (ox) { ox.parentElement.querySelectorAll(".ox-btn").forEach((b) => b.classList.remove("is-sel")); ox.classList.add("is-sel"); }
});

// ---- 시작 ----
startBtn.addEventListener("click", async () => {
  if (started) return;
  startBtn.disabled = true;
  const orig = startBtn.textContent;
  startBtn.textContent = "…";
  try {
    const { data: sd, error: sErr } = await window.sb.rpc("start_bonus_assignment", { p_topic_slug: topicSlug });
    if (sErr) {
      const msg = /no questions/i.test(sErr.message) ? t("err_no_questions_topic")
        : /not available/i.test(sErr.message) ? t("err_topic_not_published")
        : `${sErr.message}`;
      startHint.innerHTML = `<p style="color:#b3352c">${msg}</p>`;
      startBtn.disabled = false; startBtn.textContent = orig;
      return;
    }
    assignmentId = sd.assignment_id;
    bonusSetId = sd.bonus_question_set_id;

    const { data: qs, error: qErr } = await window.sb.rpc("get_bonus_questions", { p_bonus_question_set_id: bonusSetId });
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
    startBtn.textContent = t("in_progress");
    submitBtn.disabled = false;
    timerId = setInterval(() => { seconds++; updateTimer(); }, 1000);
    saveNote.textContent = t("in_progress");
  } catch (err) {
    console.error(err);
    startHint.innerHTML = `<p style="color:#b3352c">Error: ${err.message}</p>`;
    startBtn.disabled = false; startBtn.textContent = orig;
  }
});

// ---- 답안 수집 ----
function collectAnswers() {
  const rows = [];
  document.querySelectorAll(".q").forEach((qEl) => {
    const qid = qEl.dataset.qid;
    const type = qEl.dataset.type;
    const row = { assignment_id: assignmentId, question_id: qid, answer_text: null, selected_choice: null };
    if (type === "ox") {
      const sel = qEl.querySelector(".ox-btn.is-sel");
      row.answer_text = sel ? sel.dataset.v : null;
    } else if (type === "blank") {
      row.answer_text = qEl.querySelector(".blank-input")?.value?.trim() || null;
    } else if (type === "matching") {
      const map = {};
      qEl.querySelectorAll(".match-row").forEach((r) => {
        const leftId = r.dataset.left;
        const v = r.querySelector(".match-select")?.value || "";
        if (v) map[leftId] = v;
      });
      row.answer_text = Object.keys(map).length ? JSON.stringify(map) : null;
    }
    rows.push(row);
  });
  return rows;
}

// ---- 제출 + 채점 ----
submitBtn.addEventListener("click", async () => {
  if (!started || submitted) return;
  if (!confirm(t("confirm_submit"))) return;

  submitted = true;
  clearInterval(timerId);
  submitBtn.disabled = true;
  submitBtn.textContent = t("grading");
  document.querySelectorAll(".q button, .q input, .q select").forEach((el) => (el.disabled = true));

  try {
    const rows = collectAnswers();
    const { error: upErr } = await window.sb.from("answers")
      .upsert(rows, { onConflict: "assignment_id,question_id" });
    if (upErr) throw upErr;

    const { data: res, error: gErr } = await window.sb.rpc("grade_bonus", {
      p_assignment_id: assignmentId, p_duration: seconds,
    });
    if (gErr) throw gErr;

    renderResults(res);
    showSummary(res);
    submitBtn.textContent = t("submitted");
    saveNote.textContent = t("submitted");
  } catch (err) {
    console.error(err);
    submitBtn.textContent = t("submit_failed");
    alert("Error during submit/grading: " + (err.message || err));
  }
});

// ---- 결과 렌더 ----
function pairText(q, leftId, rightId) {
  const ch = qCh(q);
  const l = (ch.left || []).find((x) => x.id === leftId);
  const r = (ch.right || []).find((x) => x.id === rightId);
  return `${escapeHtml(l?.text ?? leftId)} → ${escapeHtml(r?.text ?? rightId)}`;
}

function renderResults(res) {
  (res.results || []).forEach((r) => {
    const el = document.getElementById(`result-${r.question_id}`);
    if (!el) return;
    const qEl = el.closest(".q");
    const q = questionsById[r.question_id] || {};

    if (r.is_correct) {
      el.className = "q-result show q-result--ok";
      qEl?.classList.add("graded-ok");
      el.innerHTML = `<p class="r-title">${ICON.ok} ${t("res_correct")}</p>`;
      return;
    }

    el.className = "q-result show q-result--wrong";
    qEl?.classList.add("graded-wrong");

    let detail = "";
    if (r.type === "ox") {
      detail = `${t("res_answer")}: <b>${escapeHtml(String(r.correct ?? ""))}</b>. ${escapeHtml(wcText(r))}`;
    } else if (r.type === "blank") {
      const acc = Array.isArray(r.correct) ? r.correct[0] : r.correct;
      detail = `${t("res_accepted")}: <b>${escapeHtml(String(acc ?? ""))}</b>. ${escapeHtml(wcText(r))}`;
    } else if (r.type === "matching") {
      // 학생 선택과 정답 비교로 각 줄 표시
      const pairs = Array.isArray(r.correct) ? r.correct : [];
      if (qEl) {
        qEl.querySelectorAll(".match-row").forEach((row) => {
          const leftId = row.dataset.left;
          const chosen = row.querySelector(".match-select")?.value || "";
          const correctPair = pairs.find((p) => p.left === leftId);
          const rowOk = correctPair && chosen === correctPair.right;
          row.classList.add(rowOk ? "row-ok" : "row-wrong");
        });
      }
      const list = pairs.map((p) => `<li>${pairText(q, p.left, p.right)}</li>`).join("");
      detail = `${escapeHtml(wcText(r))}` +
        (list ? `<br><b>${t("res_correct_matches")}</b><ul>${list}</ul>` : "");
    }
    el.innerHTML = `<p class="r-title">${ICON.wrong} ${t("res_incorrect")}</p><p class="r-comment">${detail}</p>`;
  });
}

function showSummary(res) {
  const total = res.objective_total ?? 0;
  const correct = res.objective_correct ?? 0;
  const pct = res.total_score ?? (total ? Math.round((correct / total) * 100) : 0);
  const banner = document.createElement("div");
  banner.className = "ps-summary";
  banner.innerHTML = `<h3>${t("results")}</h3>
    <p><span class="s-score">${correct} / ${total}</span> ${t("correct_word")} (${pct}%) · ${t("time_prefix")} ${fmt(seconds)}</p>
    <p>${t("bonus_autograde_note")}</p>`;
  qWrap.prepend(banner);
  qWrap.scrollIntoView({ behavior: "smooth" });
}
