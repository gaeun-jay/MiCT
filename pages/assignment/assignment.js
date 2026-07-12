// ============================================================
// Class assignment logic (Figma 1:61 / MD §10.1, §11, §12, §13)
// - Questions blurred until Start
// - Start -> timer runs + questions unlock
// - Submit -> auto-grade (OX / multiple choice / fill-in),
//   code questions go to AI-review placeholder (mock)
// Real grading / code evaluation will move to Supabase +
// a Vercel serverless function calling the Claude API.
// ============================================================

const params = new URLSearchParams(location.search);
const classNo = params.get("class") || "1";
document.getElementById("psTitle").textContent = `Assignment ${classNo}`;

// ---- mock question bank (Easy) ----
// type: ox | multiple_choice | blank | code
const QUESTIONS = [
  { type: "ox", question: "Python variable names are case-sensitive.", answer: "O",
    wrong_comment: "Python treats uppercase and lowercase letters in a name as different." },
  { type: "ox", question: "<code>print()</code> displays a value on the screen.", answer: "O",
    wrong_comment: "print() is the standard output function." },
  { type: "ox", question: "The integer <code>3</code> and the float <code>3.0</code> are exactly the same type.", answer: "X",
    wrong_comment: "3 is an int and 3.0 is a float — different types." },
  { type: "ox", question: "A line starting with <code>#</code> is a comment and is not executed.", answer: "O",
    wrong_comment: "Everything after # on the line is a comment." },
  { type: "ox", question: "Strings can be joined together using the <code>+</code> operator.", answer: "O",
    wrong_comment: "Using + between strings concatenates them." },

  { type: "multiple_choice", question: "Which of the following is a string (str)?",
    choices: ["10", "3.14", '"hello"', "True"], answer: 3,
    wrong_comment: "A value wrapped in quotes is a string." },
  { type: "multiple_choice", question: "Which function reads input from the user?",
    choices: ["print()", "input()", "len()", "type()"], answer: 2,
    wrong_comment: "User input is read with the input() function." },
  { type: "multiple_choice", question: "What does <code>type(10)</code> return?",
    choices: ["str", "float", "int", "bool"], answer: 3,
    wrong_comment: "The type of the integer 10 is int." },

  { type: "blank", question: "The function that reads user input is <code>_____</code>.",
    answers: ["input", "input()"], wrong_comment: "Use the input() function to read user input." },
  { type: "blank", question: "The function that returns the length of a string is <code>_____</code>.",
    answers: ["len", "len()"], wrong_comment: "Length is obtained with the len() function." },

  { type: "code",
    question: "Write code that prints the sum of the numbers from 1 to 10.",
    placeholder: "# Write your code here\n",
    max_score: 10 },
  { type: "code",
    question: "Write code that reads a name from the user and prints \"Hello, <name>\".",
    placeholder: "# Write your code here\n",
    max_score: 10 },
];

const TYPE_LABEL = { ox: "OX", multiple_choice: "Multiple Choice", blank: "Fill-in", code: "Code" };

const qWrap = document.getElementById("questions");
qWrap.innerHTML = QUESTIONS.map((q, i) => renderQuestion(q, i)).join("");
document.getElementById("psCount").textContent = `${QUESTIONS.length} Questions`;

function renderQuestion(q, i) {
  const n = i + 1;
  let body = "";
  if (q.type === "ox") {
    body = `<div class="ox-opts" data-role="ox">
      <button type="button" class="ox-btn" data-v="O">O</button>
      <button type="button" class="ox-btn" data-v="X">X</button>
    </div>`;
  } else if (q.type === "multiple_choice") {
    body = `<div class="mc-opts" data-role="mc">${q.choices.map((c, ci) =>
      `<button type="button" class="mc-opt" data-v="${ci + 1}">
         <span class="mc-num">${ci + 1}</span><span>${c}</span>
       </button>`).join("")}</div>`;
  } else if (q.type === "blank") {
    body = `<input type="text" class="blank-input" data-role="blank" placeholder="Your answer" autocomplete="off" spellcheck="false">`;
  } else if (q.type === "code") {
    body = `<textarea class="code-input" data-role="code" spellcheck="false" placeholder="${q.placeholder || ""}"></textarea>`;
  }
  return `<article class="q" data-idx="${i}" data-type="${q.type}">
    <div class="q-head"><span class="q-num">Question ${n}</span><span class="q-type">${TYPE_LABEL[q.type]}</span></div>
    <p class="q-text">${q.question}</p>
    <div class="q-body">${body}</div>
    <div class="q-result" id="result-${i}"></div>
  </article>`;
}

// ---- selection (OX / multiple choice) ----
qWrap.addEventListener("click", (e) => {
  const ox = e.target.closest(".ox-btn");
  if (ox) {
    ox.parentElement.querySelectorAll(".ox-btn").forEach((b) => b.classList.remove("is-sel"));
    ox.classList.add("is-sel");
  }
  const mc = e.target.closest(".mc-opt");
  if (mc) {
    mc.parentElement.querySelectorAll(".mc-opt").forEach((b) => b.classList.remove("is-sel"));
    mc.classList.add("is-sel");
  }
});

// ============================================================
// State: difficulty / start / timer / submit
// ============================================================
let started = false;
let submitted = false;
let difficulty = "Easy";
let seconds = 0;
let timerId = null;

const startBtn = document.getElementById("startBtn");
const submitBtn = document.getElementById("submitBtn");
const timerEl = document.getElementById("timer");
const startHint = document.getElementById("startHint");
const diffWrap = document.getElementById("diffWrap");
const diffBtn = document.getElementById("diffBtn");
const diffMenu = document.getElementById("diffMenu");
const saveNote = document.getElementById("saveNote");

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
  diffBtn.setAttribute("aria-expanded", "false");
});
document.addEventListener("click", (e) => {
  if (!diffWrap.contains(e.target)) { diffMenu.hidden = true; diffBtn.setAttribute("aria-expanded", "false"); }
});

function fmt(s) {
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${m}:${sec}`;
}
function tick() { seconds++; timerEl.textContent = `Time ${fmt(seconds)}`; }

startBtn.addEventListener("click", () => {
  if (started) return;
  started = true;
  qWrap.classList.remove("is-locked");
  qWrap.setAttribute("aria-hidden", "false");
  startHint.style.display = "none";
  diffWrap.classList.add("is-disabled");
  startBtn.disabled = true;
  startBtn.textContent = "In progress";
  submitBtn.disabled = false;
  timerId = setInterval(tick, 1000);
  saveNote.textContent = "Auto-saved";
  // TODO: record assignments.started_at, lock difficulty
  console.log("[assignment] started", { classNo, difficulty });
});

// ============================================================
// Submit + grading
// ============================================================
submitBtn.addEventListener("click", () => {
  if (!started || submitted) return;
  if (!confirm("Submit your answers? You won't be able to edit them afterwards.")) return;

  submitted = true;
  clearInterval(timerId);
  submitBtn.disabled = true;
  submitBtn.textContent = "Submitted";

  let correct = 0, objectiveTotal = 0;

  document.querySelectorAll(".q").forEach((qEl) => {
    const idx = Number(qEl.dataset.idx);
    const q = QUESTIONS[idx];
    const resultEl = document.getElementById(`result-${idx}`);

    if (q.type === "ox") {
      objectiveTotal++;
      const sel = qEl.querySelector(".ox-btn.is-sel");
      const val = sel ? sel.dataset.v : null;
      const ok = val === q.answer;
      if (ok) correct++;
      showResult(resultEl, qEl, ok, ok ? "Correct" : `Incorrect — the answer is <b>${q.answer}</b>. ${q.wrong_comment}`);
    }
    else if (q.type === "multiple_choice") {
      objectiveTotal++;
      const sel = qEl.querySelector(".mc-opt.is-sel");
      const val = sel ? Number(sel.dataset.v) : null;
      const ok = val === q.answer;
      if (ok) correct++;
      showResult(resultEl, qEl, ok, ok ? "Correct"
        : `Incorrect — the answer is <b>#${q.answer}</b> (${q.choices[q.answer - 1]}). ${q.wrong_comment}`);
    }
    else if (q.type === "blank") {
      objectiveTotal++;
      const input = qEl.querySelector(".blank-input");
      const val = (input.value || "").trim().toLowerCase();
      const ok = q.answers.some((a) => a.toLowerCase() === val);
      if (ok) correct++;
      showResult(resultEl, qEl, ok, ok ? "Correct"
        : `Incorrect — accepted answer: <b>${q.answers[0]}</b>. ${q.wrong_comment}`);
      input.disabled = true;
    }
    else if (q.type === "code") {
      // Code is not executed; it is evaluated by the Claude API -> pending (mock)
      const ta = qEl.querySelector(".code-input");
      ta.disabled = true;
      const hasCode = ta.value.trim().length > 0;
      resultEl.className = "q-result show q-result--review";
      resultEl.innerHTML = hasCode
        ? `<p class="r-title">⏳ Awaiting code evaluation</p>
           <p class="r-comment">Code questions are evaluated by Claude AI after submission (integration pending). The score and comment will appear here once evaluated.</p>`
        : `<p class="r-title">Not answered</p><p class="r-comment">No code was written, so it can't be evaluated.</p>`;
    }

    qEl.querySelectorAll("button, input, textarea").forEach((el) => {
      if (el.dataset.role || el.classList.contains("ox-btn") || el.classList.contains("mc-opt")) el.disabled = true;
    });
  });

  const pct = objectiveTotal ? Math.round((correct / objectiveTotal) * 100) : 0;
  const banner = document.createElement("div");
  banner.className = "ps-summary";
  banner.innerHTML = `<h3>Results</h3>
    <p>Auto-graded (OX · Multiple Choice · Fill-in): <span class="s-score">${correct} / ${objectiveTotal}</span> correct (${pct}%) · Time ${fmt(seconds)}</p>
    <p>The 2 code questions will be added to your final score after AI evaluation.</p>`;
  qWrap.prepend(banner);
  qWrap.scrollIntoView({ behavior: "smooth" });
  saveNote.textContent = "Submitted";

  // TODO: save answers/score/duration to Supabase; request Claude evaluation for code questions
  console.log("[assignment] submitted", { correct, objectiveTotal, seconds });
});

function showResult(el, qEl, ok, html) {
  el.className = `q-result show ${ok ? "q-result--ok" : "q-result--wrong"}`;
  qEl.classList.add(ok ? "graded-ok" : "graded-wrong");
  el.innerHTML = `<p class="r-title">${ok ? "✓ Correct" : "✗ Incorrect"}</p><p class="r-comment">${html}</p>`;
}
