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

const STATUS_LABEL = {
  completed:   { text: "Done",        cls: "asn-badge--done" },
  in_progress: { text: "In progress", cls: "asn-badge--progress" },
  not_started: { text: "Not started", cls: "asn-badge--todo" },
  locked:      { text: "Locked",      cls: "asn-badge--locked" },
};
const DIFF_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" };

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
      <span><b>${a.difficulty ?? "-"}</b></span>
      <span><b>${a.score ?? "-"}</b> pts</span>
      <span>${a.time ?? ""}</span>
    </div>`;
  }
  if (a.status === "in_progress") {
    return `<div class="asn-meta"><span><b>${a.difficulty ?? "-"}</b></span><span>Continue</span></div>`;
  }
  return "";
}
function hrefFor(a) {
  if (a.bonus) return "../bonus/bonus.html";
  return `../assignment/assignment.html?class=${a.classNo}`;
}
function cardHTML(a) {
  const badge = STATUS_LABEL[a.status];
  const classes = [
    "asn-card", "glass-card",
    a.bonus ? "asn-card--bonus" : "",
    a.status === "completed" ? "asn-card--done" : "",
    a.status === "locked" ? "asn-card--locked" : "",
  ].filter(Boolean).join(" ");
  const titleHTML = a.title.replace(/\n/g, "<br>");
  const tag = a.status === "locked" ? "div" : "a";
  const hrefAttr = a.status === "locked" ? "" : ` href="${hrefFor(a)}"`;
  return `<${tag} class="${classes}"${hrefAttr} data-key="${a.key}">
    <span class="asn-badge ${badge.cls}">${badge.text}</span>
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
    grid.innerHTML = `<p style="color:#fff;grid-column:1/-1">과제를 불러오지 못했습니다. (${error.message})</p>`;
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
        difficulty = DIFF_LABEL[asg.difficulty] || asg.difficulty;
        score = asg.total_score;
        time = fmtTime(asg.total_duration_seconds);
      } else if (asg && (asg.status === "in_progress" || asg.status === "submitted")) {
        status = "in_progress";
        difficulty = DIFF_LABEL[asg.difficulty] || asg.difficulty;
      } else {
        status = "not_started";
      }
    }
    return {
      key: `class${c.class_number}`, classNo: c.class_number,
      title: `Assignment ${c.class_number}`, concepts, status, difficulty, score, time,
    };
  });

  // Bonus 카드 (항상 진입 가능)
  cards.push({ key: "bonus", bonus: true, title: "Bonus\nChallenge", concepts: [], status: "not_started" });

  grid.innerHTML = cards.map(cardHTML).join("");
}

loadHome();
