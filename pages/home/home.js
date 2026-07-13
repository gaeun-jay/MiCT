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

const DIFFS = ["easy", "medium", "hard"];
const CHECK = `<svg class="asn-diff-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

function conceptList(concepts) {
  if (!concepts.length) return "";
  return `<ul class="asn-concepts">${concepts.map((c) => `<li>${c}</li>`).join("")}</ul>`;
}

// 난이도 상태 판정
function diffState(a) {
  if (!a) return "open";
  if (a.status === "graded" || a.status === "manual_review") return "done";
  if (a.status === "in_progress" || a.status === "submitted") return "progress";
  return "open";
}

function cardHTML(item) {
  // Bonus 카드 (단일 링크)
  if (item.type === "bonus") {
    return `<a class="asn-card glass-card asn-card--bonus" href="../bonus/bonus.html" data-key="bonus">
      <span class="asn-badge asn-badge--todo">${t("badge_todo")}</span>
      <h2 class="asn-title">${t("bonus_challenge_html")}</h2>
    </a>`;
  }

  // 미공개 클래스
  if (!item.published) {
    return `<div class="asn-card glass-card asn-card--locked" data-key="class${item.classNo}">
      <span class="asn-badge asn-badge--locked">${t("badge_locked")}</span>
      <h2 class="asn-title">${t("assignment")} ${item.classNo}</h2>
      ${conceptList(item.concepts)}
    </div>`;
  }

  // 공개 클래스 — 난이도 3개 각각 도전
  const states = DIFFS.map((d) => ({ d, state: diffState(item.byDiff[d]), score: item.byDiff[d]?.total_score }));
  const doneCount = states.filter((s) => s.state === "done").length;
  const startedCount = states.filter((s) => s.state !== "open").length; // 완료 or 진행중
  const allDone = doneCount === DIFFS.length;
  // 하나라도 시작하면 진행중(n/3), 전부 완료면 완료, 아무것도 안 하면 미시작
  const badge = allDone
    ? `<span class="asn-badge asn-badge--done">${t("badge_done")}</span>`
    : startedCount > 0
      ? `<span class="asn-badge asn-badge--progress">${t("badge_progress")}${doneCount > 0 ? ` ${doneCount}/${DIFFS.length}` : ""}</span>`
      : `<span class="asn-badge asn-badge--todo">${t("badge_todo")}</span>`;

  const chips = states.map((s) => {
    const label = t("diff_" + s.d);
    if (s.state === "done") {
      return `<span class="asn-diff asn-diff--done">
        <span class="asn-diff-name">${label}</span>
        <span class="asn-diff-mark">${CHECK}${s.score != null ? ` ${s.score}` : ""}</span></span>`;
    }
    const cls = s.state === "progress" ? "asn-diff--progress" : "asn-diff--open";
    const mark = s.state === "progress" ? t("continue") : "";
    return `<a class="asn-diff ${cls}" href="../assignment/assignment.html?class=${item.classNo}&difficulty=${s.d}">
      <span class="asn-diff-name">${label}</span>
      <span class="asn-diff-mark">${mark}</span></a>`;
  }).join("");

  return `<div class="asn-card glass-card ${allDone ? "asn-card--done" : ""}" data-key="class${item.classNo}">
    ${badge}
    <h2 class="asn-title">${t("assignment")} ${item.classNo}</h2>
    ${conceptList(item.concepts)}
    <div class="asn-diffs">${chips}</div>
  </div>`;
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

  // 이 학생의 assignments → (클래스 × 난이도) 매핑
  const byClassDiff = {};
  if (me) {
    const { data: asgs } = await window.sb
      .from("assignments")
      .select("class_id, difficulty, status, total_score")
      .eq("student_id", me.id);
    (asgs || []).forEach((a) => {
      if (!a.class_id || !a.difficulty) return;
      (byClassDiff[a.class_id] ||= {})[a.difficulty] = a;
    });
  }

  const items = (classes || []).map((c) => ({
    type: "class",
    classNo: c.class_number,
    published: c.is_published,
    concepts: (c.description || "").split(",").map((s) => s.trim()).filter(Boolean),
    byDiff: byClassDiff[c.id] || {},
  }));
  items.push({ type: "bonus" });

  lastCards = items;
  renderCards();
}

let lastCards = [];
function renderCards() {
  grid.innerHTML = lastCards.map(cardHTML).join("");
}
// 언어 전환 시 카드 다시 렌더 (라벨/난이도/제목 갱신)
window.addEventListener("i18n:change", renderCards);

loadHome();
