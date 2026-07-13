// ============================================================
// Home — 과제 카드 갤러리 (Supabase 연동)
//   classes 를 읽어 6개 카드 렌더. 미공개=Locked.
//   학생 assignments 가 있으면 완료(그린)/진행중 상태 반영.
// ============================================================

// ---- 인증 가드 + 로그아웃 ----
document.getElementById("logoutLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  window.signOutTo("../login/login.html");
});

const grid = document.getElementById("asnGrid");
const chip = document.getElementById("studentChip");

const STATUS_CLS = {
  completed:   "asn-badge--done",
  in_progress: "asn-badge--progress",
  not_started: "asn-badge--todo",
  locked:      "asn-badge--locked",
};
const STATUS_KEY = {
  completed: "badge_done", in_progress: "badge_progress",
  not_started: "badge_todo", locked: "badge_locked",
};
const diffLabel = (d) => (d ? t("diff_" + d) : "-");

function fmtTime(sec) {
  if (sec == null) return "";
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function conceptList(concepts) {
  if (!concepts.length) return "";
  return `<ul class="asn-concepts">${concepts.map((c) => `<li>${c}</li>`).join("")}</ul>`;
}
function metaRow(a) {
  if (a.status === "completed") {
    return `<div class="asn-meta">
      <span><b>${diffLabel(a.difficulty)}</b></span>
      <span><b>${a.score ?? "-"}</b> ${t("pts")}</span>
      <span>${a.time ?? ""}</span>
    </div>`;
  }
  if (a.status === "in_progress") {
    return `<div class="asn-meta"><span><b>${diffLabel(a.difficulty)}</b></span><span>${t("continue")}</span></div>`;
  }
  return "";
}
function hrefFor(a) {
  if (a.bonus) return "../bonus/bonus.html";
  return `../assignment/assignment.html?class=${a.classNo}`;
}
function cardHTML(a) {
  const classes = [
    "asn-card", "glass-card",
    a.bonus ? "asn-card--bonus" : "",
    a.status === "completed" ? "asn-card--done" : "",
    a.status === "locked" ? "asn-card--locked" : "",
  ].filter(Boolean).join(" ");
  const titleHTML = a.bonus ? t("bonus_challenge_html") : `${t("assignment")} ${a.classNo}`;
  const tag = a.status === "locked" ? "div" : "a";
  const hrefAttr = a.status === "locked" ? "" : ` href="${hrefFor(a)}"`;
  return `<${tag} class="${classes}"${hrefAttr} data-key="${a.key}">
    <span class="asn-badge ${STATUS_CLS[a.status]}">${t(STATUS_KEY[a.status])}</span>
    <h2 class="asn-title">${titleHTML}</h2>
    ${conceptList(a.concepts)}
    ${metaRow(a)}
  </${tag}>`;
}

async function loadHome() {
  const { data: { session } } = await window.sb.auth.getSession();
  if (!session) { location.replace("../login/login.html"); return; }

  // 학생 표시명
  const { data: me } = await window.sb
    .from("students").select("id, student_code, name")
    .eq("auth_user_id", session.user.id).maybeSingle();
  if (me) {
    chip.textContent = me.name || me.student_code;
    localStorage.setItem("studentId", me.student_code);
    if (me.name) localStorage.setItem("studentName", me.name);
  }

  // classes
  const { data: classes, error } = await window.sb
    .from("classes")
    .select("id, class_number, title, description, is_published")
    .order("class_number");
  if (error) {
    console.error(error);
    grid.innerHTML = `<p style="color:#fff;grid-column:1/-1">${t("home_load_error")} (${error.message})</p>`;
    return;
  }

  // 이 학생의 assignments (있으면 상태 반영)
  const byClass = {};
  if (me) {
    const { data: asgs } = await window.sb
      .from("assignments")
      .select("class_id, status, difficulty, total_score, total_duration_seconds")
      .eq("student_id", me.id);
    (asgs || []).forEach((a) => { if (a.class_id) byClass[a.class_id] = a; });
  }

  const cards = (classes || []).map((c) => {
    const concepts = (c.description || "").split(",").map((s) => s.trim()).filter(Boolean);
    const asg = byClass[c.id];
    let status = "locked", difficulty = null, score = null, time = null;
    if (c.is_published) {
      if (asg && asg.status === "graded") {
        status = "completed";
        difficulty = asg.difficulty;               // raw (렌더 시 다국어)
        score = asg.total_score;
        time = fmtTime(asg.total_duration_seconds);
      } else if (asg && (asg.status === "in_progress" || asg.status === "submitted")) {
        status = "in_progress";
        difficulty = asg.difficulty;
      } else {
        status = "not_started";
      }
    }
    return {
      key: `class${c.class_number}`, classNo: c.class_number,
      concepts, status, difficulty, score, time,
    };
  });

  // Bonus 카드 (항상 진입 가능)
  cards.push({ key: "bonus", bonus: true, concepts: [], status: "not_started" });

  lastCards = cards;
  renderCards();
}

let lastCards = [];
function renderCards() {
  grid.innerHTML = lastCards.map(cardHTML).join("");
}
// 언어 전환 시 카드 다시 렌더 (라벨/난이도/제목 갱신)
window.addEventListener("i18n:change", renderCards);

loadHome();
