// ============================================================
// Bonus assignment (MD §10.2) — no difficulty, OX / Fill-in / Matching
// ============================================================

const params = new URLSearchParams(location.search);
const topicName = params.get("name") || "Variables";
document.getElementById("psTitle").textContent = topicName;

// ---- mock questions (OX / blank / matching) ----
const QUESTIONS = [
  { type: "ox", question: "A variable acts as a name tag for a value.", answer: "O",
    wrong_comment: "A variable is a name that refers to a stored value." },
  { type: "ox", question: "In Python you must declare a variable's type explicitly.", answer: "X",
    wrong_comment: "Python infers the type automatically (dynamic typing)." },
  { type: "ox", question: "<code>x = 5</code> assigns 5 to the variable x.", answer: "O",
    wrong_comment: "= is the assignment operator." },

  { type: "blank", question: "The symbol used to assign a value to a variable is <code>_____</code>.",
    answers: ["=", "assignment"], wrong_comment: "Assignment uses the = symbol." },
  { type: "blank", question: "The name of the type that holds whole numbers is <code>_____</code>.",
    answers: ["int", "integer"], wrong_comment: "The integer type is int." },

  { type: "matching", question: "Match each function with its role.",
    left: ["print()", "input()", "type()", "len()"],
    right: ["Displays a value", "Reads user input", "Checks the type", "Returns the length"],
    answer: [0, 1, 2, 3],
    wrong_comment: "print=display, input=read, type=type, len=length" },
  { type: "matching", question: "Match each type with an example value.",
    left: ["int", "float", "str", "bool"],
    right: ["3.14", '"hi"', "True", "10"],
    answer: [3, 0, 1, 2],
    wrong_comment: "int=10, float=3.14, str=\"hi\", bool=True" },
];

const TYPE_LABEL = { ox: "OX", blank: "Fill-in", matching: "Matching" };

const qWrap = document.getElementById("questions");
qWrap.innerHTML = QUESTIONS.map((q, i) => renderQuestion(q, i)).join("");
document.getElementById("psCount").textContent = `${QUESTIONS.length} Questions`;

function renderQuestion(q, i) {
  const n = i + 1;
  let body = "";
  if (q.type === "ox") {
    body = `<div class="ox-opts"><button type="button" class="ox-btn" data-v="O">O</button><button type="button" class="ox-btn" data-v="X">X</button></div>`;
  } else if (q.type === "blank") {
    body = `<input type="text" class="blank-input" placeholder="Your answer" autocomplete="off" spellcheck="false">`;
  } else if (q.type === "matching") {
    const opts = q.right.map((r, ri) => `<option value="${ri}">${r}</option>`).join("");
    body = `<div class="match-grid">${q.left.map((term, li) => `
      <div class="match-row" data-li="${li}">
        <div class="match-term">${term}</div>
        <div class="match-link">—</div>
        <select class="match-select"><option value="" selected disabled>Select a match</option>${opts}</select>
      </div>`).join("")}</div>`;
  }
  return `<article class="q" data-idx="${i}" data-type="${q.type}">
    <div class="q-head"><span class="q-num">Question ${n}</span><span class="q-type">${TYPE_LABEL[q.type]}</span></div>
    <p class="q-text">${q.question}</p>
    <div class="q-body">${body}</div>
    <div class="q-result" id="result-${i}"></div>
  </article>`;
}

qWrap.addEventListener("click", (e) => {
  const ox = e.target.closest(".ox-btn");
  if (ox) { ox.parentElement.querySelectorAll(".ox-btn").forEach((b) => b.classList.remove("is-sel")); ox.classList.add("is-sel"); }
});

// ---- state / timer / start / submit ----
let started = false, submitted = false, seconds = 0, timerId = null;
const startBtn = document.getElementById("startBtn");
const submitBtn = document.getElementById("submitBtn");
const timerEl = document.getElementById("timer");
const startHint = document.getElementById("startHint");
const saveNote = document.getElementById("saveNote");

const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

startBtn.addEventListener("click", () => {
  if (started) return;
  started = true;
  qWrap.classList.remove("is-locked");
  qWrap.setAttribute("aria-hidden", "false");
  startHint.style.display = "none";
  startBtn.disabled = true; startBtn.textContent = "In progress";
  submitBtn.disabled = false;
  timerId = setInterval(() => { seconds++; timerEl.textContent = `Time ${fmt(seconds)}`; }, 1000);
  saveNote.textContent = "Auto-saved";
});

submitBtn.addEventListener("click", () => {
  if (!started || submitted) return;
  if (!confirm("Submit your answers? You won't be able to edit them afterwards.")) return;
  submitted = true;
  clearInterval(timerId);
  submitBtn.disabled = true; submitBtn.textContent = "Submitted";

  let correct = 0, total = 0;
  document.querySelectorAll(".q").forEach((qEl) => {
    const idx = Number(qEl.dataset.idx);
    const q = QUESTIONS[idx];
    const resultEl = document.getElementById(`result-${idx}`);

    if (q.type === "ox") {
      total++;
      const sel = qEl.querySelector(".ox-btn.is-sel");
      const ok = sel && sel.dataset.v === q.answer;
      if (ok) correct++;
      showResult(resultEl, qEl, ok, ok ? "Correct" : `Incorrect — the answer is <b>${q.answer}</b>. ${q.wrong_comment}`);
      qEl.querySelectorAll(".ox-btn").forEach((b) => b.disabled = true);
    }
    else if (q.type === "blank") {
      total++;
      const input = qEl.querySelector(".blank-input");
      const val = (input.value || "").trim().toLowerCase();
      const ok = q.answers.some((a) => a.toLowerCase() === val);
      if (ok) correct++;
      showResult(resultEl, qEl, ok, ok ? "Correct" : `Incorrect — accepted answer: <b>${q.answers[0]}</b>. ${q.wrong_comment}`);
      input.disabled = true;
    }
    else if (q.type === "matching") {
      total++;
      const rows = qEl.querySelectorAll(".match-row");
      let allOk = true;
      rows.forEach((row) => {
        const li = Number(row.dataset.li);
        const sel = row.querySelector(".match-select");
        const chosen = sel.value === "" ? null : Number(sel.value);
        const rowOk = chosen === q.answer[li];
        row.classList.add(rowOk ? "row-ok" : "row-wrong");
        if (!rowOk) allOk = false;
        sel.disabled = true;
      });
      if (allOk) correct++;
      showResult(resultEl, qEl, allOk, allOk ? "Correct — all pairs matched."
        : `Some pairs are wrong — ${q.wrong_comment}`);
    }
  });

  const pct = total ? Math.round((correct/total)*100) : 0;
  const banner = document.createElement("div");
  banner.className = "ps-summary";
  banner.innerHTML = `<h3>Results</h3>
    <p><span class="s-score">${correct} / ${total}</span> correct (${pct}%) · Time ${fmt(seconds)}</p>
    <p>Bonus assignments are fully auto-graded.</p>`;
  qWrap.prepend(banner);
  qWrap.scrollIntoView({ behavior: "smooth" });
  saveNote.textContent = "Submitted";
});

function showResult(el, qEl, ok, html) {
  el.className = `q-result show ${ok ? "q-result--ok" : "q-result--wrong"}`;
  qEl.classList.add(ok ? "graded-ok" : "graded-wrong");
  el.innerHTML = `<p class="r-title">${ok ? "✓ Correct" : "✗ Incorrect"}</p><p class="r-comment">${html}</p>`;
}
