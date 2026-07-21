/* =========================================================
   관리자 대시보드 로직
   ========================================================= */

/* ---- 인증 가드 + 로그아웃 (Supabase) ---- */
(async () => {
  const { data: { session } } = await window.sb.auth.getSession();
  if (!session) { location.replace("../login/login.html"); return; }
  const { data: profile } = await window.sb
    .from("profiles").select("role, display_name").eq("id", session.user.id).single();
  if (!profile || profile.role !== "admin") {
    await window.sb.auth.signOut();
    location.replace("../login/login.html");
    return;
  }
  const nameEl = document.getElementById("adminName");
  if (nameEl && profile.display_name) nameEl.textContent = profile.display_name;
})();
document.getElementById("logoutBtn")?.addEventListener("click", () =>
  window.signOutTo("../login/login.html")
);


/* ---------------- 학생 목록 (DB에서 로드) ---------------- */
let students = [];   // students 테이블 rows

/* ---------------- 학습 현황 / 성장 리포트 (DB 실데이터) ----------------
   assignments + students + classes 를 로드해 수업별 통계/차트/리포트에 재사용 */
let anClasses = [];        // [{id, class_number, title}]
let anAssignments = [];    // 모든 assignments rows
let anStudents = [];       // 모든 students (id, student_code, name)
let anStuById = {};        // id -> student
let currentClassId = null; // 선택된 class uuid, 또는 "bonus"

const DIFF_KO = { easy: "하", medium: "중", hard: "상" };
const DIFF_BADGE = { easy: "badge-green", medium: "badge-blue", hard: "badge-amber" };

function escHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtMin(sec) {
  if (!sec || sec <= 0) return "-";
  return `${Math.round(sec / 60)}분`;
}
function fmtDateTime(ts) {
  return ts ? new Date(ts).toLocaleString("ko-KR") : "-";
}

// 특정 class(또는 "bonus")의 assignments
function assignmentsForClass(classId) {
  if (classId === "bonus") return anAssignments.filter((a) => a.bonus_topic_id);
  return anAssignments.filter((a) => a.class_id === classId);
}
function classLabel(classId) {
  if (classId === "bonus") return "Bonus";
  const c = anClasses.find((x) => x.id === classId);
  return c ? `Class ${c.class_number}` : "-";
}

async function loadAnalytics() {
  const [{ data: cls }, { data: asg }, { data: stu }] = await Promise.all([
    window.sb.from("classes").select("id, class_number, title").order("class_number"),
    window.sb.from("assignments").select(
      "id, student_id, class_id, bonus_topic_id, difficulty, status, submitted_at, graded_at, total_duration_seconds, total_score, objective_score, code_score"
    ),
    window.sb.from("students").select("id, student_code, name").order("student_code"),
  ]);
  anClasses = cls || [];
  anAssignments = asg || [];
  anStudents = stu || [];
  anStuById = {};
  anStudents.forEach((s) => { anStuById[s.id] = s; });
  if (!currentClassId) currentClassId = anClasses[0]?.id || "bonus";

  renderClassTabs();
  renderStats();
  renderStatusTable();
  renderReportList();
  if (chartsBuilt) updateCharts();
}
loadAnalytics();

// 수업별 통계 집계 (실데이터)
function computeClassStats(classId) {
  const rows = assignmentsForClass(classId);
  const total = anStudents.length;
  const startedStu = new Set(rows.filter((r) => r.status && r.status !== "not_started").map((r) => r.student_id));
  const doneRows = rows.filter((r) => r.status === "graded" || r.status === "manual_review");
  const doneStu = new Set(doneRows.map((r) => r.student_id));
  const reviewRows = rows.filter((r) => r.status === "manual_review" || r.status === "submitted");

  const scored = doneRows.filter((r) => Number.isFinite(r.total_score));
  const avgScore = scored.length ? Math.round(scored.reduce((a, r) => a + r.total_score, 0) / scored.length) : 0;
  const durRows = doneRows.filter((r) => Number.isFinite(r.total_duration_seconds) && r.total_duration_seconds > 0);
  const avgSec = durRows.length ? Math.round(durRows.reduce((a, r) => a + r.total_duration_seconds, 0) / durRows.length) : 0;

  const difficulty = ["easy", "medium", "hard"].map(
    (d) => new Set(rows.filter((r) => r.difficulty === d).map((r) => r.student_id)).size
  );
  const scores = [0, 0, 0, 0, 0];
  scored.forEach((r) => {
    const s = r.total_score;
    const i = s < 60 ? 0 : s < 70 ? 1 : s < 80 ? 2 : s < 90 ? 3 : 4;
    scores[i]++;
  });

  return {
    total, started: startedStu.size, done: doneStu.size, review: reviewRows.length,
    avgScore, avgTime: fmtMin(avgSec), difficulty, scores,
  };
}

// 최근 7일 제출 추이 (실데이터)
function computeTrend(classId) {
  const rows = assignmentsForClass(classId).filter((r) => r.submitted_at);
  const labels = [], counts = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    counts.push(rows.filter((r) => { const t = new Date(r.submitted_at); return t >= d && t < next; }).length);
  }
  return { labels, counts };
}

function renderClassTabs() {
  const el = document.getElementById("classTabs");
  const tabs = anClasses.map(
    (c) => `<button class="pill-tab ${c.id === currentClassId ? "active" : ""}" data-class-id="${c.id}">Class ${c.class_number}</button>`
  );
  tabs.push(`<button class="pill-tab ${currentClassId === "bonus" ? "active" : ""}" data-class-id="bonus">Bonus</button>`);
  el.innerHTML = tabs.join("");
}

/* =========================================================
   탭 전환
   ========================================================= */
const tabTitles = {
  students: "학생 관리",
  problems: "문제 관리",
  status: "학생 학습 현황",
  report: "성장 분석 리포트",
};
let chartsBuilt = false;

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document
      .querySelectorAll(".nav-item")
      .forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.classList.toggle("active", p.id === "tab-" + tab);
    });
    document.getElementById("pageTitle").textContent = tabTitles[tab];
    closeSidebar();
    if (tab === "status" && !chartsBuilt) {
      buildCharts();
      chartsBuilt = true;
    }
  });
});

// URL 해시로 초기 탭 지정 (예: dashboard.html#problems)
(function initTabFromHash() {
  const tab = (location.hash || "").replace("#", "");
  if (tab && tabTitles[tab]) {
    const btn = document.querySelector(`.nav-item[data-tab="${tab}"]`);
    if (btn) btn.click();
  }
})();

/* 모바일 사이드바 */
const sidebar = document.getElementById("sidebar");
const backdrop = document.getElementById("backdrop");
function closeSidebar() {
  sidebar.classList.remove("open");
  backdrop.classList.remove("show");
}
document.getElementById("navToggle").addEventListener("click", () => {
  sidebar.classList.add("open");
  backdrop.classList.add("show");
});
backdrop.addEventListener("click", closeSidebar);

/* =========================================================
   (A) 학생 관리 테이블
   ========================================================= */
const studentTbody = document.getElementById("studentTbody");

function escAttr(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

function renderStudents() {
  studentTbody.innerHTML = "";
  if (!students.length) {
    studentTbody.innerHTML = `<tr><td colspan="5" class="muted">등록된 학생이 없습니다. 학생이 회원가입 페이지에서 직접 계정을 만듭니다.</td></tr>`;
    return;
  }
  students.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${s.student_code}</strong></td>
      <td>
        <input class="name-input" value="${escAttr(s.name)}" data-id="${s.id}" />
      </td>
      <td>${s.age_group || "-"}</td>
      <td class="muted">${s.last_login_at ? new Date(s.last_login_at).toLocaleString("ko-KR") : "-"}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-sm reissue-btn" data-code="${s.student_code}" data-name="${escAttr(s.name)}">재발급</button>
          <button class="btn btn-sm delete-btn" data-code="${s.student_code}" data-name="${escAttr(s.name)}">삭제</button>
        </div>
      </td>`;
    studentTbody.appendChild(tr);
  });
}

// DB에서 학생 목록 로드
async function loadStudents() {
  studentTbody.innerHTML = `<tr><td colspan="5" class="muted">불러오는 중…</td></tr>`;
  const { data, error } = await window.sb
    .from("students")
    .select("id, student_code, name, age_group, last_login_at")
    .order("student_code");
  if (error) {
    studentTbody.innerHTML = `<tr><td colspan="5" class="muted">불러오기 실패: ${error.message}</td></tr>`;
    return;
  }
  students = data || [];
  renderStudents();
}
loadStudents();

// 이름 인라인 수정 → DB 반영
studentTbody.addEventListener("change", async (e) => {
  if (!e.target.classList.contains("name-input")) return;
  const id = e.target.dataset.id;
  const name = e.target.value.trim();
  const { error } = await window.sb.from("students").update({ name }).eq("id", id);
  if (error) { alert("이름 수정 실패: " + error.message); return; }
  const row = students.find((s) => s.id === id);
  if (row) row.name = name;
});

// 비밀번호 재발급 → /api/reset-password
studentTbody.addEventListener("click", async (e) => {
  const btn = e.target.closest(".reissue-btn");
  if (!btn) return;
  const code = btn.dataset.code;
  const name = btn.dataset.name || "";
  if (!confirm(`${code} (${name})\n\n새 임시 비밀번호를 발급합니다. 기존 비밀번호는 즉시 무효화되고,\n다음 로그인 시 학생이 비밀번호를 변경해야 합니다.\n\n계속할까요?`)) return;

  const token = await getToken();
  if (!token) { alert("세션이 만료되었습니다. 다시 로그인해 주세요."); return; }
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "…";
  try {
    const resp = await fetch(`${API_BASE}/api/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ student_code: code }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { alert("재발급 실패: " + (data.error || resp.status)); return; }
    alert(`비밀번호 재발급 완료\n아이디: ${code}\n새 임시 비밀번호: ${data.password}\n\n이 비밀번호를 학생에게 전달하세요. (첫 로그인 시 변경됩니다.)`);
    await loadStudents();
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

// 학생 삭제 → /api/delete-student (계정 + 학습 데이터 영구 삭제)
studentTbody.addEventListener("click", async (e) => {
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;
  const code = btn.dataset.code;
  const name = btn.dataset.name || "";
  if (!confirm(`${code} (${name})\n\n이 학생 계정과 모든 학습 데이터(과제·답안·채점)를 영구 삭제합니다.\n되돌릴 수 없습니다. 삭제할까요?`)) return;

  const token = await getToken();
  if (!token) { alert("세션이 만료되었습니다. 다시 로그인해 주세요."); return; }
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "…";
  try {
    const resp = await fetch(`${API_BASE}/api/delete-student`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ student_code: code }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { alert("삭제 실패: " + (data.error || resp.status)); return; }
    if (data.warning) alert("삭제 처리됨(경고): " + data.warning);
    await loadStudents();
    if (typeof loadAnalytics === "function") await loadAnalytics();  // 학습현황/리포트 갱신
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

// 학생 목록 CSV 다운로드 (학생은 회원가입 페이지에서 직접 계정 생성)
document.getElementById("btnDownloadCsv").addEventListener("click", () => {
  const header = ["학생아이디", "이름", "나이대", "마지막로그인일시"];
  const rows = students.map((s) => [
    s.student_code,
    s.name,
    s.age_group || "",
    s.last_login_at ? new Date(s.last_login_at).toLocaleString("ko-KR") : "-",
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n");
  // BOM 추가 → Excel 한글 깨짐 방지
  downloadFile("﻿" + csv, "students.csv", "text/csv;charset=utf-8;");
});

function csvCell(val) {
  const s = String(val ?? "");
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* 공통 다운로드 헬퍼 */
function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* =========================================================
   (A-2) 문제 관리 — Class별 MD 업로드 / 파싱 / 미리보기
   ========================================================= */
const TYPE_LABEL_KO = { ox: "OX", multiple_choice: "객관식", blank: "빈칸", code: "코드", matching: "선긋기" };
const uploadIcon = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

const problemGrid = document.getElementById("problemGrid");

// 로컬(localhost)에서 열면 배포된 서버리스를 호출 (Vercel 배포 시엔 상대경로)
const API_BASE =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "https://mi-ct.vercel.app"
    : "";

async function getToken() {
  const { data: { session } } = await window.sb.auth.getSession();
  return session?.access_token || null;
}
const DIFF_CAP = { easy: "Easy", medium: "Medium", hard: "Hard" };

let dbClasses = [];          // DB classes
let bonusTopics = [];        // DB bonus_topics
let dbCounts = {};           // classId -> { total, diffs:Set } (DB 등록 문제수)
let bonusCounts = {};        // bonus_topic_id -> 등록 문제수
const parsedByKey = {};      // key -> { filename, count, difficulties, questions } (로컬 MD 미리보기)

async function loadProblemGrid() {
  const [{ data: cls, error: cErr }, { data: bts }, { data: sets }, { data: bsets }] = await Promise.all([
    window.sb.from("classes").select("id, class_number, title, description, is_published").order("class_number"),
    window.sb.from("bonus_topics").select("id, slug, title, is_published, display_order").order("display_order"),
    window.sb.from("question_sets").select("class_id, difficulty, questions(count)").eq("is_active", true),
    window.sb.from("bonus_question_sets").select("bonus_topic_id, questions(count)").eq("is_active", true),
  ]);
  if (cErr) {
    problemGrid.innerHTML = `<p class="muted">클래스를 불러오지 못했습니다. (${cErr.message})</p>`;
    return;
  }
  dbClasses = cls || [];
  bonusTopics = bts || [];

  // DB 등록 문제수 집계 (Class별 총 문제수 + 난이도)
  dbCounts = {};
  (sets || []).forEach((s) => {
    if (!s.class_id) return;
    const n = Array.isArray(s.questions) ? (s.questions[0]?.count || 0) : 0;
    const e = (dbCounts[s.class_id] ||= { total: 0, diffs: new Set() });
    e.total += n;
    if (n > 0) e.diffs.add(s.difficulty);
  });

  // Bonus 토픽별 등록 문제수
  bonusCounts = {};
  (bsets || []).forEach((s) => {
    if (!s.bonus_topic_id) return;
    const n = Array.isArray(s.questions) ? (s.questions[0]?.count || 0) : 0;
    bonusCounts[s.bonus_topic_id] = (bonusCounts[s.bonus_topic_id] || 0) + n;
  });

  renderProblemGrid();
}

function renderProblemGrid() {
  const classCards = dbClasses.map((c) => {
    const key = `class-${c.id}`;
    const pub = c.is_published;
    const parsed = parsedByKey[key];
    const badge = pub
      ? `<span class="badge badge-green">공개</span>`
      : `<span class="badge badge-gray">비공개</span>`;
    const cnt = dbCounts[c.id];
    const info = cnt && cnt.total
      ? `등록 문제 <b>${cnt.total}</b>개 · 난이도 ${[...cnt.diffs].map((d) => DIFF_CAP[d] || d).join(" · ")}`
      : `문제 미등록 (MD 업로드 필요)`;
    return `
      <div class="card problem-item ${pub ? "" : "locked"}">
        <div class="card-body">
          <div class="pi-head"><h3>Class ${c.class_number}</h3>${badge}</div>
          <div class="pi-meta">${escapeHtml(c.title || "")}<br>${info}<br>${pub ? "학생 화면에 노출됨" : "학생 화면에서 <b>Locked</b>"}</div>
          <div class="pi-actions">
            <button class="btn ${pub ? "" : "btn-primary"}" data-toggle="${c.id}" data-pub="${pub}">${pub ? "비공개로" : "공개하기"}</button>
            <label class="btn file-btn">${uploadIcon} MD 업로드<input type="file" accept=".md,.markdown,.txt" data-parse="${key}" /></label>
            ${cnt && cnt.total ? `<button class="btn" data-edit-class="${c.id}" data-class-no="${c.class_number}">문제 편집</button>` : ""}
            ${parsed ? `<button class="btn" data-preview="${key}">미리보기</button>` : ""}
          </div>
        </div>
      </div>`;
  }).join("");

  const totalB = bonusTopics.length;
  const pubB = bonusTopics.filter((b) => b.is_published).length;
  const withQB = bonusTopics.filter((b) => bonusCounts[b.id]).length;
  const allPub = totalB > 0 && pubB === totalB;
  const someB = pubB > 0;
  const bBadge = allPub
    ? `<span class="badge badge-green">전체 공개</span>`
    : someB ? `<span class="badge badge-amber">일부 공개</span>` : `<span class="badge badge-gray">비공개</span>`;

  const topicRows = bonusTopics.map((t) => {
    const n = bonusCounts[t.id] || 0;
    return `
      <div class="bt-row">
        <span class="bt-name">${escapeHtml(t.title || t.slug)}</span>
        <span class="badge ${n ? "badge-green" : "badge-gray"}">${n}문제</span>
        <button class="btn btn-sm" data-bonus-topic-toggle="${t.id}" data-pub="${t.is_published}">${t.is_published ? "비공개로" : "공개"}</button>
      </div>`;
  }).join("");

  const bonusCard = `
    <div class="card problem-item bonus-card ${someB ? "" : "locked"}">
      <div class="card-body">
        <div class="pi-head"><h3>Bonus</h3>${bBadge}</div>
        <div class="pi-meta">Python 개념 ${totalB}개 · 문제 등록 <b>${withQB}</b>개 · 공개 <b>${pubB}</b>개</div>
        <div class="pi-actions">
          <button class="btn ${allPub ? "" : "btn-primary"}" data-bonus-toggle="${allPub ? "off" : "on"}">${allPub ? "전체 비공개" : "전체 공개"}</button>
          <label class="btn file-btn">${uploadIcon} MD 업로드<input type="file" accept=".md,.markdown,.txt" data-parse-bonus="1" /></label>
        </div>
        <div class="bt-list">${topicRows}</div>
        <p class="bt-hint muted">업로드하는 MD의 <code>topic_id</code>로 개념이 자동 매칭됩니다.</p>
      </div>
    </div>`;

  problemGrid.innerHTML = classCards + bonusCard;
}
loadProblemGrid();

// MD 파서 — 실제 Class MD 포맷 지원
//  · YAML 프론트매터(---) 무시
//  · `## Difficulty: Easy/Medium/Hard` 로 난이도 구분
//  · `### Question N` 단위 블록 파싱
//  · 들여쓴 리스트(choices/answers/requirements/rubric)
//  · 여러 줄 블록 스칼라(`question: |`)
//  · 감싼 따옴표 제거
const stripQuotes = (s) => String(s ?? "").trim().replace(/^["']|["']$/g, "");
const indentOf = (l) => (l.match(/^(\s*)/)[1] || "").length;

function parseBlock(lines) {
  const q = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([a-zA-Z_]+):\s?(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    const val = m[2];

    // 블록 스칼라 (| 또는 >)
    if (/^[|>][-+]?$/.test(val.trim())) {
      i++;
      const body = [];
      let base = null;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === "") { body.push(""); i++; continue; }
        const ind = indentOf(l);
        if (base === null) { if (ind === 0) break; base = ind; }
        if (ind < base) break;
        body.push(l.slice(base));
        i++;
      }
      while (body.length && body[body.length - 1] === "") body.pop();
      q[key] = body.join("\n");
      continue;
    }

    // 리스트 / 중첩 (빈 값)
    if (val.trim() === "") {
      i++;
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === "") { i++; continue; }
        if (indentOf(l) === 0) break; // 상위 키로 복귀
        const t = l.trim();
        const dash = t.match(/^-\s+(.*)$/);
        if (dash) {
          const inner = dash[1];
          const obj = inner.match(/^([a-zA-Z_]+):\s?(.*)$/);
          if (obj) items.push({ [obj[1]]: stripQuotes(obj[2]) });
          else items.push(stripQuotes(inner));
          i++;
        } else {
          const km = t.match(/^([a-zA-Z_]+):\s?(.*)$/);
          if (km && items.length && typeof items[items.length - 1] === "object") {
            items[items.length - 1][km[1]] = stripQuotes(km[2]);
            i++;
          } else break;
        }
      }
      q[key] = items;
      continue;
    }

    // 단순 스칼라
    q[key] = stripQuotes(val);
    i++;
  }
  return q;
}

function parseQuestionsMd(text) {
  const lines = text.split(/\r?\n/);
  const questions = [];
  const difficulties = new Set();
  let curDifficulty = null;
  let block = null;
  let curNum = null;

  const flush = () => {
    if (block) {
      const q = parseBlock(block);
      q.num = curNum;
      q.difficulty = curDifficulty;
      questions.push(q);
      block = null;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const diff = line.match(/^##\s*Difficulty:\s*(.+)$/i);
    if (diff) { flush(); curDifficulty = diff[1].trim(); difficulties.add(curDifficulty); continue; }
    const qm = line.match(/^###\s*Question\s*(.+)$/i);
    if (qm) { flush(); block = []; curNum = qm[1].trim(); continue; }
    if (block) block.push(line);
  }
  flush();
  return { questions, difficulties: [...difficulties], count: questions.length };
}

function answerText(q) {
  switch (q.type) {
    case "ox": return q.answer ?? "-";
    case "multiple_choice": return q.answer ? q.answer + "번" : "-";
    case "blank": return Array.isArray(q.answers) ? q.answers[0] : (q.answers ?? "-");
    case "code": return "AI 평가";
    case "matching": return "연결";
    default: return q.answer ?? "-";
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function showPreview(key) {
  const p = parsedByKey[key];
  if (!p) return;
  const qs = p.questions || [];
  document.getElementById("previewTitle").textContent = `문제 미리보기`;
  document.getElementById("previewSub").textContent =
    `${p.filename} · 총 ${p.count}개 (미리보기 ${qs.length}개)`;
  document.getElementById("previewTbody").innerHTML = qs.map((q) => `
    <tr>
      <td><strong>${escapeHtml(q.num)}</strong></td>
      <td>${escapeHtml(q.difficulty || "-")}</td>
      <td><span class="badge badge-gray">${TYPE_LABEL_KO[q.type] || q.type || "-"}</span></td>
      <td>${escapeHtml((q.question || "").replace(/\s*\n\s*/g, " ")).slice(0, 90)}</td>
      <td>${escapeHtml(answerText(q))}</td>
    </tr>`).join("");
  const card = document.getElementById("previewCard");
  card.style.display = "";
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---- Bonus MD → DB (관리자 RLS 로 클라이언트에서 직접 저장, 서버리스 불필요) ----
function parseBonusMeta(text) {
  const idM = text.match(/^\s*topic_id:\s*(.+)$/m);
  const titleM = text.match(/^\s*topic_title:\s*(.+)$/m);
  return { slug: idM ? stripQuotes(idM[1]) : null, title: titleM ? stripQuotes(titleM[1]) : null };
}
function bonusCorrect(q) {
  if (q.type === "ox") return q.answer ?? null;
  if (q.type === "blank") return Array.isArray(q.answers) ? q.answers : (q.answers ? [q.answers] : null);
  if (q.type === "matching") return Array.isArray(q.answer_pairs) ? q.answer_pairs : null;
  return null;
}
function bonusChoices(q) {
  if (q.type === "matching") return { left: q.left_items || [], right: q.right_items || [] };
  return q.choices ?? null;
}

// 문제 텍스트를 우크라이나어로 번역해 각 문제에 *_uk 필드를 붙임 (코드/백틱 보존)
// 실패해도 업로드는 진행됨 (uk 없이 = 영어 폴백)
async function translateQuestions(questions) {
  const items = [];
  questions.forEach((q, i) => {
    if (q.question) items.push({ key: `q${i}.t`, text: String(q.question) });
    if (q.wrong_comment) items.push({ key: `q${i}.w`, text: String(q.wrong_comment) });
    if (q.type === "multiple_choice" && Array.isArray(q.choices)) {
      q.choices.forEach((c, ci) => items.push({ key: `q${i}.c${ci}`, text: String(c) }));
    }
    if (q.type === "matching") {
      (q.left_items || []).forEach((it, li) => items.push({ key: `q${i}.l${li}`, text: String(it.text) }));
      (q.right_items || []).forEach((it, ri) => items.push({ key: `q${i}.r${ri}`, text: String(it.text) }));
    }
  });
  if (!items.length) return;

  const token = await getToken();
  if (!token) return { ok: false, count: 0, error: "no token" };
  let map = {};
  try {
    const resp = await fetch(`${API_BASE}/api/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ items, target: "uk" }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { console.warn("[translate] 실패:", data.error || resp.status); return { ok: false, count: 0, error: data.error || resp.status }; }
    (data.translations || []).forEach((t) => { map[t.key] = t.text; });
  } catch (e) {
    console.warn("[translate] 오류:", e);
    return { ok: false, count: 0, error: String(e) };
  }

  let count = 0;
  questions.forEach((q, i) => {
    if (map[`q${i}.t`]) { q.question_text_uk = map[`q${i}.t`]; count++; }
    if (map[`q${i}.w`]) q.wrong_comment_uk = map[`q${i}.w`];
    if (q.type === "multiple_choice" && Array.isArray(q.choices)) {
      q.choices_uk = q.choices.map((c, ci) => map[`q${i}.c${ci}`] ?? String(c));
    }
    if (q.type === "matching") {
      q.choices_uk = {
        left: (q.left_items || []).map((it, li) => ({ id: it.id, text: map[`q${i}.l${li}`] ?? it.text })),
        right: (q.right_items || []).map((it, ri) => ({ id: it.id, text: map[`q${i}.r${ri}`] ?? it.text })),
      };
    }
  });
  return { ok: true, count };
}

async function uploadBonusMd(file) {
  const text = await file.text();
  const meta = parseBonusMeta(text);
  if (!meta.slug) { alert("MD에서 topic_id를 찾지 못했습니다. (frontmatter의 topic_id 확인)"); return; }

  const parsed = parseQuestionsMd(text);
  const qs = (parsed.questions || []).filter((q) => ["ox", "blank", "matching"].includes(q.type));
  if (!qs.length) { alert("보너스 문제를 찾지 못했습니다. (### Question, type: ox|blank|matching)"); return; }

  // 우크라이나어 번역 (코드 보존) — 실패해도 진행
  const tr = await translateQuestions(qs);

  // 1) bonus_topic 확보 (slug 기준, seed 에 이미 있으면 재사용)
  let { data: topic } = await window.sb.from("bonus_topics").select("id, title").eq("slug", meta.slug).maybeSingle();
  if (!topic) {
    const { data: nt, error } = await window.sb.from("bonus_topics")
      .insert({ slug: meta.slug, title: meta.title || meta.slug, is_published: false })
      .select("id, title").single();
    if (error) { alert("토픽 생성 실패: " + error.message); return; }
    topic = nt;
  } else if (meta.title && meta.title !== topic.title) {
    await window.sb.from("bonus_topics").update({ title: meta.title }).eq("id", topic.id);
  }

  // 2) active bonus_question_set 확보 (있으면 문제 교체 = 재업로드)
  const { data: sets } = await window.sb.from("bonus_question_sets")
    .select("id").eq("bonus_topic_id", topic.id).eq("is_active", true).limit(1);
  let setId;
  if (sets && sets.length) {
    setId = sets[0].id;
    await window.sb.from("questions").delete().eq("bonus_question_set_id", setId);
    await window.sb.from("bonus_question_sets")
      .update({ source_filename: file.name, updated_at: new Date().toISOString() }).eq("id", setId);
  } else {
    const { data: ns, error } = await window.sb.from("bonus_question_sets")
      .insert({ bonus_topic_id: topic.id, source_filename: file.name, version: 1, is_active: true })
      .select("id").single();
    if (error) { alert("세트 생성 실패: " + error.message); return; }
    setId = ns.id;
  }

  // 3) questions insert (문제당 1점)
  const rows = qs.map((q, i) => ({
    bonus_question_set_id: setId,
    question_number: parseInt(q.num, 10) || i + 1,
    question_type: q.type,
    question_text: String(q.question || ""),
    question_text_uk: q.question_text_uk ?? null,
    choices: bonusChoices(q),
    choices_uk: q.choices_uk ?? null,
    correct_answers: bonusCorrect(q),
    wrong_comment: q.wrong_comment ?? null,
    wrong_comment_uk: q.wrong_comment_uk ?? null,
    concept: q.concept ?? meta.slug,
    max_score: 1,
  }));
  const { error: qErr } = await window.sb.from("questions").insert(rows);
  if (qErr) { alert("문제 저장 실패: " + qErr.message); return; }

  const trNote = tr && tr.ok ? `\n우크라이나어 번역: ${tr.count}개` : `\n⚠ 우크라이나어 번역 실패 (${tr?.error || "?"}) — 영어로 표시됩니다`;
  alert(`"${file.name}" 업로드 완료\n${meta.title || meta.slug} · ${rows.length}개 문제 등록${trNote}`);
  await loadProblemGrid();
}

// MD 업로드 — 파싱 후 서버리스로 DB(questions) 저장
problemGrid.addEventListener("change", async (e) => {
  const bonusInput = e.target.closest("input[data-parse-bonus]");
  if (bonusInput && bonusInput.files[0]) {
    const f = bonusInput.files[0];
    try { await uploadBonusMd(f); }
    catch (err) { console.error(err); alert("보너스 업로드 오류: " + err.message); }
    finally { bonusInput.value = ""; }
    return;
  }
  const input = e.target.closest("input[data-parse]");
  if (!input || !input.files[0]) return;
  const key = input.dataset.parse;
  const classId = key.replace(/^class-/, "");
  const file = input.files[0];

  let text;
  try { text = await file.text(); } catch { alert("파일을 읽지 못했습니다."); input.value = ""; return; }

  const parsed = parseQuestionsMd(text);
  if (parsed.count === 0) {
    alert("문제를 찾지 못했습니다. Markdown 형식을 확인하세요.\n(### Question, type:, question: 형식)");
    input.value = "";
    return;
  }

  // 미리보기용 저장 (앞 20개)
  parsedByKey[key] = {
    filename: file.name,
    count: parsed.count,
    difficulties: parsed.difficulties.length ? parsed.difficulties : ["-"],
    questions: parsed.questions.slice(0, 20),
  };

  // DB 업로드 (관리자 토큰)
  const token = await getToken();
  if (!token) { alert("로그인이 만료되었습니다. 다시 로그인해 주세요."); return; }

  // 우크라이나어 번역 (코드 보존) — 실패해도 진행
  const tr = await translateQuestions(parsed.questions);

  try {
    const resp = await fetch(`${API_BASE}/api/upload-questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ class_id: classId, filename: file.name, questions: parsed.questions }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      alert(`업로드 실패: ${data.error || resp.status}`);
      return;
    }
    const detail = Object.entries(data.counts || {}).map(([d, n]) => `${d} ${n}`).join(", ");
    console.log("[문제 관리] DB 업로드:", file.name, data.total + "문제");
    const trNote = tr && tr.ok ? `\n우크라이나어 번역: ${tr.count}개` : `\n⚠ 우크라이나어 번역 실패 (${tr?.error || "?"}) — 영어로 표시됩니다`;
    alert(`"${file.name}" 업로드 완료\nDB에 ${data.total}개 문제 등록 (${detail})${trNote}`);
    await loadProblemGrid(); // 등록 문제수 갱신
    showPreview(key);
  } catch (err) {
    console.error(err);
    alert("업로드 오류: " + err.message);
  } finally {
    input.value = "";
  }
});

// 공개 토글(DB) / 미리보기 / Bonus 전체 토글(DB)
problemGrid.addEventListener("click", async (e) => {
  const tg = e.target.closest("button[data-toggle]");
  if (tg) {
    const id = tg.dataset.toggle;
    const cur = tg.dataset.pub === "true";
    tg.disabled = true;
    const { error } = await window.sb.from("classes").update({ is_published: !cur }).eq("id", id);
    if (error) { alert("변경 실패: " + error.message); tg.disabled = false; return; }
    await loadProblemGrid();
    return;
  }
  const pv = e.target.closest("button[data-preview]");
  if (pv) { showPreview(pv.dataset.preview); return; }

  const ed = e.target.closest("button[data-edit-class]");
  if (ed) { openProblemEditor(ed.dataset.editClass, ed.dataset.classNo); return; }

  const bt = e.target.closest("button[data-bonus-toggle]");
  if (bt) {
    const on = bt.dataset.bonusToggle === "on";
    bt.disabled = true;
    const ids = bonusTopics.map((b) => b.id);
    if (!ids.length) { bt.disabled = false; return; }
    const { error } = await window.sb.from("bonus_topics").update({ is_published: on }).in("id", ids);
    if (error) { alert("변경 실패: " + error.message); bt.disabled = false; return; }
    await loadProblemGrid();
    return;
  }

  // 개념별 공개/비공개 토글
  const btt = e.target.closest("button[data-bonus-topic-toggle]");
  if (btt) {
    const id = btt.dataset.bonusTopicToggle;
    const cur = btt.dataset.pub === "true";
    btt.disabled = true;
    const { error } = await window.sb.from("bonus_topics").update({ is_published: !cur }).eq("id", id);
    if (error) { alert("변경 실패: " + error.message); btt.disabled = false; return; }
    await loadProblemGrid();
    return;
  }
});

/* =========================================================
   (B) 학습 현황 — 통계 카드 / 진행률 / 테이블
   ========================================================= */
function renderStats() {
  const st = computeClassStats(currentClassId);
  const notStarted = Math.max(0, st.total - st.started);
  const completion = st.total ? Math.round((st.done / st.total) * 100) : 0;

  const tiles = [
    { label: "전체 학생 수", value: st.total, cls: "" },
    { label: "시작", value: st.started, cls: "" },
    { label: "완료", value: st.done, cls: "accent" },
    { label: "미시작", value: notStarted, cls: "" },
    { label: "평균 점수", value: st.avgScore, cls: "accent" },
    { label: "평균 풀이 시간", value: st.avgTime, cls: "" },
    { label: "완료율", value: completion + "%", cls: "accent" },
    { label: "검토 필요 건수", value: st.review, cls: "warn" },
  ];

  document.getElementById("statGrid").innerHTML = tiles
    .map(
      (t) => `
      <div class="stat ${t.cls}">
        <div class="label">${t.label}</div>
        <div class="value">${t.value}</div>
      </div>`
    )
    .join("");

  const bar = document.getElementById("progressBar");
  bar.style.width = completion + "%";
  bar.textContent = completion + "%";
  document.getElementById("progressLabel").textContent =
    `${st.done} / ${st.total}명 완료`;
  document.getElementById("statusClassLabel").textContent = classLabel(currentClassId);
}

const DIFF_ORDER = { easy: 0, medium: 1, hard: 2 };

function renderStatusTable() {
  const tbody = document.getElementById("statusTbody");
  const rows = assignmentsForClass(currentClassId);

  if (!anStudents.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">데이터를 불러오는 중이거나 학생이 없습니다.</td></tr>`;
    return;
  }

  // 학생별 시도 묶기 — (학생 × 난이도)로 각각 별도 행. 하·상 둘 다 풀면 둘 다 표시.
  const byStu = {};
  rows.forEach((r) => { (byStu[r.student_id] ||= []).push(r); });

  const html = anStudents.map((s) => {
    const attempts = (byStu[s.id] || []).slice().sort(
      (a, b) => (DIFF_ORDER[a.difficulty] ?? 9) - (DIFF_ORDER[b.difficulty] ?? 9)
    );
    if (!attempts.length) {
      // 미시작
      return `
      <tr>
        <td><strong>${s.student_code}</strong></td>
        <td>${escHtml(s.name)}</td>
        <td>-</td>
        <td><span class="badge badge-gray">미시작</span></td>
        <td>-</td><td>-</td><td class="muted">-</td>
      </tr>`;
    }
    return attempts.map((a) => {
      const done = a.status === "graded" || a.status === "manual_review";
      const inProgress = !done && a.status && a.status !== "not_started";
      const diff = a.difficulty;
      const statusBadge = a.status === "manual_review" ? "badge-amber"
        : done ? "badge-green" : inProgress ? "badge-amber" : "badge-gray";
      const statusText = a.status === "manual_review" ? "검토필요"
        : done ? "완료" : inProgress ? "진행중" : "미시작";
      const canView = a.status && a.status !== "not_started";
      return `
      <tr class="${canView ? "row-click" : ""}" ${canView ? `data-asg-id="${a.id}"` : ""}>
        <td>${canView ? `<span class="cell-link">${s.student_code}</span>` : `<strong>${s.student_code}</strong>`}</td>
        <td>${escHtml(s.name)}</td>
        <td>${diff ? `<span class="badge ${DIFF_BADGE[diff]}">${DIFF_KO[diff]}</span>` : "-"}</td>
        <td><span class="badge ${statusBadge}">${statusText}</span></td>
        <td>${done && Number.isFinite(a.total_score) ? a.total_score : "-"}</td>
        <td>${fmtMin(a.total_duration_seconds)}</td>
        <td class="muted">${fmtDateTime(a.submitted_at)}</td>
      </tr>`;
    }).join("");
  }).join("");

  tbody.innerHTML = html;
}

// 제출현황 행 클릭 → 풀이 열람 모달
document.getElementById("statusTbody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr.row-click");
  if (!tr || !tr.dataset.asgId) return;
  openSolutionViewer(tr.dataset.asgId);
});

// 수업 선택 탭
document.getElementById("classTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".pill-tab");
  if (!btn) return;
  currentClassId = btn.dataset.classId;
  document
    .querySelectorAll("#classTabs .pill-tab")
    .forEach((b) => b.classList.toggle("active", b === btn));
  renderStats();
  updateCharts();
});

/* ---------------- Chart.js ---------------- */
let charts = {};

function buildCharts() {
  const st = computeClassStats(currentClassId);
  const tr = computeTrend(currentClassId);
  Chart.defaults.font.family = "'Noto Sans KR', sans-serif";
  Chart.defaults.color = "#6b7280";

  charts.difficulty = new Chart(document.getElementById("chartDifficulty"), {
    type: "doughnut",
    data: {
      labels: ["하", "중", "상"],
      datasets: [
        {
          data: st.difficulty,
          backgroundColor: ["#111827", "#9ca3af", "#d1d5db"],
          borderWidth: 2,
          borderColor: "#fff",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
    },
  });

  charts.scores = new Chart(document.getElementById("chartScores"), {
    type: "bar",
    data: {
      labels: ["0-59", "60-69", "70-79", "80-89", "90-100"],
      datasets: [
        {
          label: "학생 수",
          data: st.scores,
          backgroundColor: "#111827",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });

  charts.trend = new Chart(document.getElementById("chartTrend"), {
    type: "line",
    data: {
      labels: tr.labels,
      datasets: [
        {
          label: "제출 건수",
          data: tr.counts,
          borderColor: "#111827",
          backgroundColor: "rgba(17,24,39,0.10)",
          fill: true,
          tension: 0.35,
          pointBackgroundColor: "#111827",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function updateCharts() {
  if (!chartsBuilt) return;
  const st = computeClassStats(currentClassId);
  const tr = computeTrend(currentClassId);
  charts.difficulty.data.datasets[0].data = st.difficulty;
  charts.difficulty.update();
  charts.scores.data.datasets[0].data = st.scores;
  charts.scores.update();
  charts.trend.data.labels = tr.labels;
  charts.trend.data.datasets[0].data = tr.counts;
  charts.trend.update();
}

/* =========================================================
   (C) 성장 분석 리포트 — Markdown 생성 & 다운로드 (실데이터)
   ========================================================= */
const STATUS_KO = {
  not_started: "미시작", in_progress: "진행중", submitted: "제출(채점중)",
  graded: "완료", manual_review: "검토필요",
};

// 레포트 다국어 라벨 (한/영/우크)
const REPORT_L10N = {
  ko: {
    title: "학생 성장 리포트", generated: "생성일", students: "대상 학생", count: "명",
    note: "제출 데이터·AI 코드 피드백을 취합하고, 통계 기반 AI 성장 분석을 포함합니다.",
    summary: "요약", participation: "참여 현황",
    lessons_done: "수업 완료", lessons_started: "수업 시작", diff_attempts: "난이도 도전(횟수)",
    avg_time: "평균 풀이 시간", bonus: "보너스", min: "분",
    scores: "점수", avg_score: "평균 점수", by_difficulty: "난이도별 평균", obj_code: "객관식 / 코드 평균",
    trend: "점수 추이", concept_acc: "개념별 정확도", type_acc: "유형별 정확도",
    ai_strengths: "강점", ai_weak: "보완 필요", ai_reco: "권장 학습",
    detail: "과제 상세", none: "데이터 없음",
    col_lesson: "수업", col_diff: "난이도", col_status: "상태", col_total: "총점", col_obj: "객관식", col_code: "코드", col_time: "시간", col_sub: "제출",
    col_concept: "개념", col_correct: "정답", col_rate: "정확도", col_type: "유형", col_score: "점수",
    diff: { easy: "하", medium: "중", hard: "상" },
    status: { not_started: "미시작", in_progress: "진행중", submitted: "채점중", graded: "완료", manual_review: "검토필요" },
    footer: "Python 과제 관리 시스템 · 관리자 콘솔에서 자동 생성됨",
  },
  en: {
    title: "Student Growth Report", generated: "Generated", students: "Students", count: "",
    note: "Aggregates submission data and AI code feedback, with an AI-written growth analysis based on the statistics.",
    summary: "Summary", participation: "Participation",
    lessons_done: "Lessons completed", lessons_started: "Lessons started", diff_attempts: "Difficulty attempts",
    avg_time: "Avg. solving time", bonus: "Bonus", min: "min",
    scores: "Scores", avg_score: "Average score", by_difficulty: "By difficulty", obj_code: "Objective / Code avg",
    trend: "Score trend", concept_acc: "Concept accuracy", type_acc: "Accuracy by type",
    ai_strengths: "Strengths", ai_weak: "To improve", ai_reco: "Recommendations",
    detail: "Assignment detail", none: "No data",
    col_lesson: "Lesson", col_diff: "Difficulty", col_status: "Status", col_total: "Total", col_obj: "Objective", col_code: "Code", col_time: "Time", col_sub: "Submitted",
    col_concept: "Concept", col_correct: "Correct", col_rate: "Accuracy", col_type: "Type", col_score: "Score",
    diff: { easy: "Easy", medium: "Medium", hard: "Hard" },
    status: { not_started: "Not started", in_progress: "In progress", submitted: "Grading", graded: "Done", manual_review: "Review" },
    footer: "Python Practice System · auto-generated in the admin console",
  },
  uk: {
    title: "Звіт про прогрес учня", generated: "Дата", students: "Учнів", count: "",
    note: "Узагальнює дані здач та відгуки ШІ щодо коду, містить аналіз прогресу від ШІ на основі статистики.",
    summary: "Підсумок", participation: "Участь",
    lessons_done: "Уроків завершено", lessons_started: "Уроків розпочато", diff_attempts: "Спроби за складністю",
    avg_time: "Середній час", bonus: "Бонус", min: "хв",
    scores: "Бали", avg_score: "Середній бал", by_difficulty: "За складністю", obj_code: "Об'єктивні / Код",
    trend: "Динаміка балів", concept_acc: "Точність за темами", type_acc: "Точність за типом",
    ai_strengths: "Сильні сторони", ai_weak: "Що покращити", ai_reco: "Рекомендації",
    detail: "Деталі завдань", none: "Немає даних",
    col_lesson: "Урок", col_diff: "Складність", col_status: "Статус", col_total: "Разом", col_obj: "Об'єктивні", col_code: "Код", col_time: "Час", col_sub: "Здано",
    col_concept: "Тема", col_correct: "Правильно", col_rate: "Точність", col_type: "Тип", col_score: "Бал",
    diff: { easy: "Легкий", medium: "Середній", hard: "Складний" },
    status: { not_started: "Не розпочато", in_progress: "У процесі", submitted: "Оцінювання", graded: "Завершено", manual_review: "Перевірка" },
    footer: "Система практики Python · автоматично згенеровано в консолі адміністратора",
  },
};

const mean = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
const bar10 = (rate) => { const n = Math.max(0, Math.min(10, Math.round(rate / 10))); return "█".repeat(n) + "░".repeat(10 - n); };
function chunkArr(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

function renderReportList() {
  const el = document.getElementById("reportList");
  if (!anStudents.length) {
    el.innerHTML = `<p class="muted" style="padding:8px">학생 데이터를 불러오는 중이거나 학생이 없습니다.</p>`;
    return;
  }
  el.innerHTML = anStudents
    .map((s) => {
      const done = anAssignments.filter(
        (a) => a.student_id === s.id &&
          (a.status === "graded" || a.status === "manual_review") &&
          Number.isFinite(a.total_score)
      );
      const avg = done.length ? Math.round(done.reduce((x, a) => x + a.total_score, 0) / done.length) : null;
      return `
      <label class="select-row">
        <input type="checkbox" class="report-cb" data-sid="${s.id}" />
        <div><strong>${s.student_code}</strong> · ${escHtml(s.name)}</div>
        <span class="meta">${done.length ? `완료 ${done.length}건 · 평균 ${avg}점` : "제출 없음"}</span>
      </label>`;
    })
    .join("");
}

document.getElementById("selectAll").addEventListener("change", (e) => {
  document.querySelectorAll(".report-cb").forEach((cb) => (cb.checked = e.target.checked));
});

document.getElementById("btnGenerateMd").addEventListener("click", async (ev) => {
  const ids = [...document.querySelectorAll(".report-cb:checked")].map((cb) => cb.dataset.sid);
  if (ids.length === 0) {
    alert("리포트를 생성할 학생을 한 명 이상 선택하세요.");
    return;
  }
  const lang = document.getElementById("reportLang")?.value || "ko";
  const btn = ev.currentTarget;
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.textContent = "생성 중… (AI 분석)";
  try {
    const data = await gatherReportData(ids);
    const metricsByStu = {};
    ids.forEach((sid) => { metricsByStu[sid] = computeMetrics(sid, data); });

    // AI 서술 분석 (실패해도 통계 리포트는 생성)
    const analyses = {};
    const token = await getToken();
    if (token) {
      try {
        const resp = await fetch(`${API_BASE}/api/report`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({
            language: lang,
            students: ids.map((sid) => ({ code: anStuById[sid]?.student_code, name: anStuById[sid]?.name, stats: metricsByStu[sid] })),
          }),
        });
        const d = await resp.json().catch(() => ({}));
        if (resp.ok) (d.analyses || []).forEach((a) => { analyses[a.code] = a; });
        else console.warn("[report] AI 분석 실패:", d.error || resp.status);
      } catch (e) { console.warn("[report] AI 분석 오류:", e); }
    }

    const md = buildReport(ids, metricsByStu, analyses, lang, data);
    document.getElementById("mdPreview").value = md;
    const fname = ids.length === 1
      ? `growth_report_${anStuById[ids[0]]?.student_code || ids[0]}_${lang}.md`
      : `growth_report_${ids.length}students_${lang}.md`;
    downloadFile(md, fname, "text/markdown;charset=utf-8;");

    // report_exports 에 기록 (실패해도 다운로드는 완료됨)
    const { data: { user } } = await window.sb.auth.getUser();
    const { error: repErr } = await window.sb.from("report_exports").insert({
      student_id: ids.length === 1 ? ids[0] : null,
      selected_assignment_ids: data.asgIds,
      export_data: { language: lang, metrics: metricsByStu },
      markdown_content: md,
      exported_by: user?.id || null,
    });
    if (repErr) console.warn("report_exports insert 실패:", repErr.message);
  } catch (err) {
    console.error(err);
    alert("리포트 생성 중 오류: " + (err?.message || err));
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
});

// 선택 학생들의 answers / questions / code_feedback 로드 (관리자 RLS)
async function gatherReportData(studentIds) {
  const asg = anAssignments.filter((a) => studentIds.includes(a.student_id));
  const asgToStu = {}; asg.forEach((a) => { asgToStu[a.id] = a.student_id; });
  const asgIds = asg.map((a) => a.id);
  const answers = [], qMap = {}, fbByAns = {};
  if (asgIds.length) {
    for (const c of chunkArr(asgIds, 150)) {
      const { data } = await window.sb.from("answers")
        .select("id, assignment_id, question_id, is_correct, score").in("assignment_id", c);
      answers.push(...(data || []));
    }
    const qIds = [...new Set(answers.map((a) => a.question_id))];
    for (const c of chunkArr(qIds, 150)) {
      const { data } = await window.sb.from("questions")
        .select("id, concept, question_type, max_score").in("id", c);
      (data || []).forEach((q) => { qMap[q.id] = q; });
    }
    const ansIds = answers.map((a) => a.id);
    for (const c of chunkArr(ansIds, 150)) {
      const { data } = await window.sb.from("code_feedback")
        .select("answer_id, strengths, issues").in("answer_id", c);
      (data || []).forEach((f) => { fbByAns[f.answer_id] = f; });
    }
  }
  const ansByStu = {};
  answers.forEach((a) => { const sid = asgToStu[a.assignment_id]; if (sid) (ansByStu[sid] ||= []).push(a); });
  return { asg, asgIds, ansByStu, qMap, fbByAns };
}

// 학생 1명의 지표 계산 (AI 입력 + Markdown 양쪽에 사용)
function computeMetrics(sid, data) {
  const mine = anAssignments.filter((a) => a.student_id === sid);
  const classAsg = mine.filter((a) => a.class_id);
  const bonusAsg = mine.filter((a) => a.bonus_topic_id);
  const isDone = (a) => a.status === "graded" || a.status === "manual_review";
  const started = (a) => a.status && a.status !== "not_started";

  const classesTotal = anClasses.length;
  const classesStarted = new Set(classAsg.filter(started).map((a) => a.class_id)).size;
  const classesDone = new Set(classAsg.filter(isDone).map((a) => a.class_id)).size;
  const diffAttempts = { easy: 0, medium: 0, hard: 0 };
  classAsg.filter(started).forEach((a) => { if (diffAttempts[a.difficulty] != null) diffAttempts[a.difficulty]++; });

  const gradedClass = classAsg.filter(isDone);
  const scored = gradedClass.filter((a) => Number.isFinite(a.total_score));
  const avgTotal = mean(scored.map((a) => a.total_score));
  const byDifficulty = {};
  ["easy", "medium", "hard"].forEach((d) => {
    const g = scored.filter((a) => a.difficulty === d);
    byDifficulty[d] = g.length ? { avg: mean(g.map((a) => a.total_score)), count: g.length } : null;
  });
  const objAvg = mean(gradedClass.map((a) => a.objective_score).filter(Number.isFinite));
  const codeAvg = mean(gradedClass.map((a) => a.code_score).filter(Number.isFinite));
  const trend = scored.slice()
    .sort((a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0))
    .map((a) => ({ label: `${classLabel(a.class_id)} ${a.difficulty || ""}`.trim(), score: a.total_score }));
  const timeVals = gradedClass.map((a) => a.total_duration_seconds).filter((v) => Number.isFinite(v) && v > 0);
  const avgTimeMin = timeVals.length ? Math.round(mean(timeVals) / 60) : null;

  // 개념/유형 정확도 + 코드 피드백
  const ans = data.ansByStu[sid] || [];
  const cAgg = {}, tAgg = {};
  const strengths = new Set(), issues = new Set();
  ans.forEach((a) => {
    const f = data.fbByAns[a.id];
    if (f) { (f.strengths || []).forEach((x) => strengths.add(String(x))); (f.issues || []).forEach((x) => issues.add(String(x))); }
    const q = data.qMap[a.question_id];
    if (!q || a.is_correct == null) return;
    const c = q.concept || "general";
    (cAgg[c] ||= { correct: 0, total: 0 }); cAgg[c].total++; if (a.is_correct) cAgg[c].correct++;
    (tAgg[q.question_type] ||= { correct: 0, total: 0 }); tAgg[q.question_type].total++; if (a.is_correct) tAgg[q.question_type].correct++;
  });
  const concepts = Object.entries(cAgg)
    .map(([concept, v]) => ({ concept, correct: v.correct, total: v.total, rate: Math.round((v.correct / v.total) * 100) }))
    .sort((a, b) => b.rate - a.rate);
  const types = Object.entries(tAgg)
    .map(([type, v]) => ({ type, correct: v.correct, total: v.total, rate: Math.round((v.correct / v.total) * 100) }));

  return {
    participation: { classesTotal, classesStarted, classesDone, diffAttempts, bonusStarted: bonusAsg.filter(started).length, bonusDone: bonusAsg.filter(isDone).length, avgTimeMin },
    scores: { avgTotal, byDifficulty, objAvg, codeAvg, trend },
    concepts, types,
    codeFeedback: { strengths: [...strengths], issues: [...issues] },
    assignmentsCount: mine.length,
  };
}

// 지표 + AI 서술을 합쳐 (선택 언어) Markdown 생성
function buildReport(studentIds, metricsByStu, analyses, lang, data) {
  const L = REPORT_L10N[lang] || REPORT_L10N.ko;
  const locale = lang === "ko" ? "ko-KR" : lang === "uk" ? "uk-UA" : "en-US";
  const today = new Date().toLocaleDateString(locale);
  let md = `# ${L.title}\n\n`;
  md += `- ${L.generated}: ${today}\n`;
  md += `- ${L.students}: ${studentIds.length}${L.count}\n`;
  md += `\n> ${L.note}\n\n---\n\n`;

  studentIds.forEach((sid, i) => {
    const s = anStuById[sid];
    const m = metricsByStu[sid];
    const an = analyses[s?.student_code] || null;
    md += `## ${i + 1}. ${s?.name || "?"} (${s?.student_code || sid})\n\n`;

    if (an?.summary) md += `${an.summary}\n\n`;

    // 참여 현황
    const p = m.participation;
    md += `### ${L.participation}\n`;
    md += `- ${L.lessons_done}: **${p.classesDone}** / ${p.classesTotal} · ${L.lessons_started}: ${p.classesStarted}\n`;
    md += `- ${L.diff_attempts}: ${L.diff.easy} ${p.diffAttempts.easy} · ${L.diff.medium} ${p.diffAttempts.medium} · ${L.diff.hard} ${p.diffAttempts.hard}\n`;
    md += `- ${L.bonus}: ${p.bonusDone} / ${p.bonusStarted}\n`;
    if (p.avgTimeMin != null) md += `- ${L.avg_time}: ${p.avgTimeMin}${L.min}\n`;
    md += `\n`;

    // 점수
    const sc = m.scores;
    md += `### ${L.scores}\n`;
    md += `- ${L.avg_score}: **${sc.avgTotal ?? "-"}**\n`;
    const bd = ["easy", "medium", "hard"]
      .map((d) => (sc.byDifficulty[d] ? `${L.diff[d]} ${sc.byDifficulty[d].avg}(${sc.byDifficulty[d].count})` : null))
      .filter(Boolean).join(" · ");
    if (bd) md += `- ${L.by_difficulty}: ${bd}\n`;
    if (sc.objAvg != null || sc.codeAvg != null) md += `- ${L.obj_code}: ${sc.objAvg ?? "-"} / ${sc.codeAvg ?? "-"}\n`;
    md += `\n`;
    if (sc.trend.length) {
      md += `**${L.trend}**\n\n` + sc.trend.map((t) => `- ${t.label}: ${t.score}`).join("\n") + "\n\n";
    }

    // 개념별 정확도
    if (m.concepts.length) {
      md += `### ${L.concept_acc}\n\n`;
      md += `| ${L.col_concept} | ${L.col_rate} | ${L.col_correct} |\n|---|---|---|\n`;
      m.concepts.forEach((c) => { md += `| ${c.concept} | \`${bar10(c.rate)}\` ${c.rate}% | ${c.correct}/${c.total} |\n`; });
      md += `\n`;
    }

    // 유형별 정확도
    if (m.types.length) {
      md += `### ${L.type_acc}\n` + m.types.map((t) => `- ${t.type}: ${t.rate}% (${t.correct}/${t.total})`).join("\n") + "\n\n";
    }

    // AI 강점/보완/권장
    if (an) {
      if (an.strengths?.length) md += `### ${L.ai_strengths}\n` + an.strengths.map((x) => `- ${x}`).join("\n") + "\n\n";
      if (an.weaknesses?.length) md += `### ${L.ai_weak}\n` + an.weaknesses.map((x) => `- ${x}`).join("\n") + "\n\n";
      if (an.recommendations?.length) md += `### ${L.ai_reco}\n` + an.recommendations.map((x) => `- ${x}`).join("\n") + "\n\n";
    }

    // 과제 상세
    const mine = anAssignments.filter((a) => a.student_id === sid)
      .sort((a, b) => (a.class_id || "z").localeCompare(b.class_id || "z"));
    if (mine.length) {
      md += `### ${L.detail}\n\n`;
      md += `| ${L.col_lesson} | ${L.col_diff} | ${L.col_status} | ${L.col_total} | ${L.col_obj} | ${L.col_code} | ${L.col_time} | ${L.col_sub} |\n|---|---|---|---|---|---|---|---|\n`;
      mine.forEach((a) => {
        const cls = a.class_id ? classLabel(a.class_id) : a.bonus_topic_id ? L.bonus : "-";
        const tm = a.total_duration_seconds ? Math.round(a.total_duration_seconds / 60) + L.min : "-";
        md += `| ${cls} | ${a.difficulty ? L.diff[a.difficulty] : "-"} | ${L.status[a.status] || a.status || "-"} | ${Number.isFinite(a.total_score) ? a.total_score : "-"} | ${a.objective_score ?? "-"} | ${a.code_score ?? "-"} | ${tm} | ${a.submitted_at ? fmtDateTime(a.submitted_at) : "-"} |\n`;
      });
      md += `\n`;
    }

    md += `---\n\n`;
  });

  md += `_${L.footer}_\n`;
  return md;
}

/* =========================================================
   (D) 학생 풀이 열람 + 점수 수정 / 문제 편집 + 문항별 재채점
   ========================================================= */
const OBJ_TYPES = new Set(["ox", "multiple_choice", "blank"]);
const TYPE_LABEL2 = { ox: "OX", multiple_choice: "객관식", blank: "빈칸", code: "코드", matching: "선긋기" };
const CODE_STATUS_KO = { correct: "정답", needs_revision: "수정 필요", manual_review: "검토 필요", pending_ai_review: "AI 채점 대기" };

// 객관식/OX/빈칸 정오 판정 (DB grade_objective 로직과 동일). code/matching → null
function isObjectiveCorrect(q, ans) {
  const ca = q.correct_answers;
  if (!ans) return false;
  if (q.question_type === "ox") {
    return String(ans.answer_text ?? "").toUpperCase() === String(ca ?? "").toUpperCase();
  }
  if (q.question_type === "multiple_choice") {
    if (q.multi_select || Array.isArray(ca)) {
      const correctSet = (Array.isArray(ca) ? ca : [ca]).map(Number).sort((a, b) => a - b);
      let selSet;
      if (Array.isArray(ans.selected_choices)) selSet = ans.selected_choices.map(Number).sort((a, b) => a - b);
      else if (ans.selected_choice != null) selSet = [Number(ans.selected_choice)];
      else selSet = [];
      return correctSet.length > 0 && correctSet.length === selSet.length
        && correctSet.every((v, i) => v === selSet[i]);
    }
    return ans.selected_choice != null && Number(ans.selected_choice) === Number(ca);
  }
  if (q.question_type === "blank") {
    const arr = Array.isArray(ca) ? ca : (ca != null ? [ca] : []);
    const t = String(ans.answer_text ?? "").trim().toLowerCase();
    return t !== "" && arr.some((e) => String(e).trim().toLowerCase() === t);
  }
  return null;
}

// 과제 총점 재계산 (answers.score 합계 기준). 채점 문항만 바뀌어도 총점 일관성 유지.
async function recomputeAssignmentTotals(assignmentId) {
  const { data: asg } = await window.sb.from("assignments")
    .select("id, bonus_topic_id").eq("id", assignmentId).single();
  if (!asg) return;
  const { data: ans } = await window.sb.from("answers")
    .select("question_id, score, is_correct").eq("assignment_id", assignmentId);
  const rows = ans || [];
  const qids = rows.map((a) => a.question_id);
  const typeById = {};
  if (qids.length) {
    const { data: qs } = await window.sb.from("questions")
      .select("id, question_type").in("id", qids);
    (qs || []).forEach((q) => { typeById[q.id] = q.question_type; });
  }
  if (asg.bonus_topic_id) {
    const total = rows.length;
    const ok = rows.filter((a) => a.is_correct).length;
    const score = total ? Math.round((ok / total) * 100) : 0;
    await window.sb.from("assignments")
      .update({ objective_score: ok, total_score: score, updated_at: new Date().toISOString() })
      .eq("id", assignmentId);
  } else {
    let obj = 0, code = 0;
    rows.forEach((a) => {
      const s = Number(a.score) || 0;
      if (typeById[a.question_id] === "code") code += s; else obj += s;
    });
    await window.sb.from("assignments")
      .update({ objective_score: obj, code_score: code, total_score: obj + code, updated_at: new Date().toISOString() })
      .eq("id", assignmentId);
  }
}

// 특정 필드들을 우크라이나어로 번역 (실패해도 조용히 빈 map 반환)
async function translateFields(items) {
  if (!items.length) return {};
  const token = await getToken();
  if (!token) return {};
  try {
    const resp = await fetch(`${API_BASE}/api/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ items, target: "uk" }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return {};
    const map = {};
    (data.translations || []).forEach((t) => { map[t.key] = t.text; });
    return map;
  } catch { return {}; }
}

/* ---------------- 모달 공통 ---------------- */
function openModal(id) { document.getElementById(id).hidden = false; document.body.style.overflow = "hidden"; }
function closeModal(id) { document.getElementById(id).hidden = true; document.body.style.overflow = ""; }
["viewerBackdrop", "editorBackdrop"].forEach((id) => {
  const bd = document.getElementById(id);
  bd.addEventListener("click", (e) => { if (e.target === bd) closeModal(id); });
});
document.getElementById("viewerClose").addEventListener("click", () => closeModal("viewerBackdrop"));
document.getElementById("viewerCancel").addEventListener("click", () => closeModal("viewerBackdrop"));
document.getElementById("editorClose").addEventListener("click", () => closeModal("editorBackdrop"));
document.getElementById("editorCloseBtn").addEventListener("click", () => closeModal("editorBackdrop"));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!document.getElementById("viewerBackdrop").hidden) closeModal("viewerBackdrop");
  else if (!document.getElementById("editorBackdrop").hidden) closeModal("editorBackdrop");
});

/* =========================================================
   풀이 열람 뷰어
   ========================================================= */
let viewerState = null;

async function openSolutionViewer(assignmentId) {
  const body = document.getElementById("viewerBody");
  document.getElementById("viewerNote").textContent = "";
  body.innerHTML = `<p class="muted">불러오는 중…</p>`;
  openModal("viewerBackdrop");

  try {
    const { data: asg, error: aErr } = await window.sb.from("assignments")
      .select("id, student_id, class_id, bonus_topic_id, question_set_id, difficulty, status, objective_score, code_score, total_score, total_duration_seconds, submitted_at")
      .eq("id", assignmentId).single();
    if (aErr || !asg) throw new Error(aErr?.message || "과제를 찾지 못했습니다.");

    let questions = [];
    if (asg.bonus_topic_id) {
      const { data: bset } = await window.sb.from("bonus_question_sets")
        .select("id").eq("bonus_topic_id", asg.bonus_topic_id).eq("is_active", true).limit(1);
      const bsetId = bset?.[0]?.id;
      if (bsetId) {
        const { data: qs } = await window.sb.from("questions").select("*")
          .eq("bonus_question_set_id", bsetId).order("question_number");
        questions = qs || [];
      }
    } else if (asg.question_set_id) {
      const { data: qs } = await window.sb.from("questions").select("*")
        .eq("question_set_id", asg.question_set_id).order("question_number");
      questions = qs || [];
    }

    const { data: answers } = await window.sb.from("answers").select("*").eq("assignment_id", assignmentId);
    const ansByQid = {};
    (answers || []).forEach((a) => { ansByQid[a.question_id] = a; });
    const ansIds = (answers || []).map((a) => a.id);
    const fbByAns = {};
    if (ansIds.length) {
      const { data: fbs } = await window.sb.from("code_feedback").select("*").in("answer_id", ansIds);
      (fbs || []).forEach((f) => { fbByAns[f.answer_id] = f; });
    }

    viewerState = { assignmentId, assignment: asg, questions, ansByQid, fbByAns, isBonus: !!asg.bonus_topic_id };
    renderViewer();
  } catch (err) {
    body.innerHTML = `<p class="muted">불러오기 실패: ${escHtml(err.message)}</p>`;
  }
}

function studentAnsDisplay(q, a) {
  if (!a) return `<span class="muted">(무응답)</span>`;
  if (q.question_type === "ox") return `<b>${escHtml(a.answer_text || "")}</b>` || "-";
  if (q.question_type === "multiple_choice") {
    const picks = Array.isArray(a.selected_choices) && a.selected_choices.length
      ? a.selected_choices
      : (a.selected_choice != null ? [a.selected_choice] : []);
    if (!picks.length) return `<span class="muted">(무응답)</span>`;
    return picks.map((v) => {
      const ch = Array.isArray(q.choices) ? q.choices[v - 1] : null;
      return `<b>#${escHtml(String(v))}</b>${ch ? ` ${escHtml(ch)}` : ""}`;
    }).join(", ");
  }
  if (q.question_type === "blank") return a.answer_text ? `<b>${escHtml(a.answer_text)}</b>` : `<span class="muted">(무응답)</span>`;
  if (q.question_type === "code") return a.answer_text ? `<pre class="sv-code">${escHtml(a.answer_text)}</pre>` : `<span class="muted">(무응답)</span>`;
  if (q.question_type === "matching") return `<code>${escHtml(a.answer_text || "")}</code>`;
  return escHtml(a.answer_text || "");
}
function correctAnsDisplay(q) {
  const ca = q.correct_answers;
  if (q.question_type === "ox") return `<b>${escHtml(String(ca ?? ""))}</b>`;
  if (q.question_type === "multiple_choice") {
    const arr = Array.isArray(ca) ? ca : (ca != null ? [ca] : []);
    return arr.map((v) => {
      const ch = Array.isArray(q.choices) ? q.choices[Number(v) - 1] : null;
      return `<b>#${escHtml(String(v))}</b>${ch ? ` ${escHtml(ch)}` : ""}`;
    }).join(", ") || "-";
  }
  if (q.question_type === "blank") return `<b>${escHtml(Array.isArray(ca) ? ca.join(", ") : String(ca ?? ""))}</b>`;
  if (q.question_type === "code") return `<span class="muted">AI 평가 (루브릭)</span>`;
  if (q.question_type === "matching") return `<code>${escHtml(JSON.stringify(ca ?? ""))}</code>`;
  return "-";
}

function renderViewer() {
  const { assignment: asg, questions, ansByQid, fbByAns } = viewerState;
  const s = anStuById[asg.student_id] || {};
  const clsLabel = asg.bonus_topic_id ? "Bonus" : classLabel(asg.class_id);
  const diffLabel = asg.difficulty ? DIFF_KO[asg.difficulty] : "-";
  document.getElementById("viewerTitle").textContent = `${s.student_code || ""} · ${s.name || ""}`.trim();
  document.getElementById("viewerSub").textContent =
    `${clsLabel} · 난이도 ${diffLabel} · 상태 ${STATUS_KO[asg.status] || asg.status || "-"} · 제출 ${fmtDateTime(asg.submitted_at)}`;

  const totals = `
    <div class="sv-totals">
      <div>총점 <b>${Number.isFinite(asg.total_score) ? asg.total_score : "-"}</b></div>
      <div>객관식 <b>${Number.isFinite(asg.objective_score) ? asg.objective_score : "-"}</b></div>
      <div>코드 <b>${Number.isFinite(asg.code_score) ? asg.code_score : "-"}</b></div>
      <div>풀이시간 <b>${fmtMin(asg.total_duration_seconds)}</b></div>
    </div>`;

  const qHtml = questions.map((q) => {
    const a = ansByQid[q.id];
    const fb = a ? fbByAns[a.id] : null;
    const correct = a?.is_correct;
    const cls = correct === true ? "ok" : correct === false ? "wrong" : "";
    const maxS = q.max_score ?? 1;

    let scoreControls;
    if (q.question_type === "code") {
      const curScore = fb?.admin_override_score ?? a?.score ?? fb?.score ?? 0;
      const curStatus = fb?.admin_override_status ?? fb?.status ?? "manual_review";
      const cmt = fb?.admin_override_comment ?? "";
      const aiInfo = fb ? `<div class="sv-fb"><b>AI 채점:</b> ${CODE_STATUS_KO[fb.status] || fb.status || "-"} · ${fb.score ?? "-"}점 ${fb.comment ? `· ${escHtml(fb.comment)}` : ""}
        ${Array.isArray(fb.issues) && fb.issues.length ? `<ul>${fb.issues.map((x) => `<li>${escHtml(String(x))}</li>`).join("")}</ul>` : ""}</div>` : `<div class="sv-fb muted">AI 채점 결과 없음</div>`;
      scoreControls = `${aiInfo}
        <div class="sv-score" data-qid="${q.id}" data-type="code" data-answer-id="${a?.id || ""}">
          <span class="muted">수동 점수</span>
          <input type="number" class="score-in" min="0" max="${maxS}" step="1" value="${curScore}" />
          <span class="muted">/ ${maxS}</span>
          <select class="ov-status">
            ${["correct", "needs_revision", "manual_review"].map((v) => `<option value="${v}" ${v === curStatus ? "selected" : ""}>${CODE_STATUS_KO[v]}</option>`).join("")}
          </select>
          <button class="btn btn-sm" data-regrade-code="${q.id}">AI 다시 채점</button>
          <textarea class="sv-override-cmt" placeholder="관리자 코멘트 (선택)">${escHtml(cmt)}</textarea>
        </div>`;
    } else if (OBJ_TYPES.has(q.question_type)) {
      const curScore = a?.score ?? 0;
      scoreControls = `
        <div class="sv-score" data-qid="${q.id}" data-type="${q.question_type}" data-answer-id="${a?.id || ""}" data-max="${maxS}">
          <span class="muted">점수</span>
          <input type="number" class="score-in" min="0" max="${maxS}" step="1" value="${curScore}" />
          <span class="muted">/ ${maxS}</span>
          <span class="muted">${correct === true ? "· 정답" : correct === false ? "· 오답" : ""}</span>
        </div>`;
    } else {
      scoreControls = "";
    }

    return `
      <div class="sv-q ${cls}">
        <div class="sv-q-head">
          <span class="q-no">Q${q.question_number}</span>
          <span class="badge badge-gray">${TYPE_LABEL2[q.question_type] || q.question_type}</span>
        </div>
        <p class="sv-q-text">${escHtml(q.question_text || "")}</p>
        <div class="sv-row"><span class="lbl">학생 답</span><span class="val">${studentAnsDisplay(q, a)}</span></div>
        ${q.question_type === "code" ? "" : `<div class="sv-row"><span class="lbl">정답</span><span class="val">${correctAnsDisplay(q)}</span></div>`}
        ${scoreControls}
      </div>`;
  }).join("");

  document.getElementById("viewerBody").innerHTML = totals + (qHtml || `<p class="muted">문항이 없습니다.</p>`);
}

// 코드 문항 "AI 다시 채점"
document.getElementById("viewerBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-regrade-code]");
  if (!btn) return;
  const qid = btn.dataset.regradeCode;
  if (!confirm("이 코드 문항만 AI로 다시 채점합니다. 계속할까요?")) return;
  const token = await getToken();
  if (!token) { alert("세션이 만료되었습니다. 다시 로그인해 주세요."); return; }
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "…";
  try {
    const resp = await fetch(`${API_BASE}/api/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ assignment_id: viewerState.assignmentId, question_ids: [qid] }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { alert("재채점 실패: " + (data.error || resp.status)); return; }
    await openSolutionViewer(viewerState.assignmentId); // 새로고침
    await loadAnalytics();
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

// 점수 저장
document.getElementById("viewerSave").addEventListener("click", async (ev) => {
  if (!viewerState) return;
  const note = document.getElementById("viewerNote");
  const btn = ev.currentTarget;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "저장 중…";
  note.textContent = "";
  try {
    const { data: { user } } = await window.sb.auth.getUser();
    const rows = [...document.querySelectorAll("#viewerBody .sv-score")];
    for (const el of rows) {
      const qid = el.dataset.qid;
      const type = el.dataset.type;
      let answerId = el.dataset.answerId || null;
      const scoreInput = el.querySelector(".score-in");
      const score = Math.max(0, Math.round(Number(scoreInput.value) || 0));

      // 답안 행이 없으면 생성 (수동 채점 대상)
      if (!answerId) {
        const { data: ins } = await window.sb.from("answers")
          .insert({ assignment_id: viewerState.assignmentId, question_id: qid })
          .select("id").single();
        answerId = ins?.id;
        if (!answerId) continue;
      }

      if (type === "code") {
        const status = el.querySelector(".ov-status")?.value || "manual_review";
        const cmt = el.querySelector(".sv-override-cmt")?.value?.trim() || null;
        // code_feedback override (있으면 update, 없으면 insert)
        const { data: existing } = await window.sb.from("code_feedback")
          .select("id").eq("answer_id", answerId).limit(1);
        const payload = {
          admin_override_score: score, admin_override_status: status, admin_override_comment: cmt,
          reviewed_by: user?.id || null, reviewed_at: new Date().toISOString(),
        };
        if (existing && existing.length) {
          await window.sb.from("code_feedback").update(payload).eq("id", existing[0].id);
        } else {
          await window.sb.from("code_feedback").insert({ answer_id: answerId, status, score, ...payload });
        }
        await window.sb.from("answers")
          .update({ score, is_correct: status === "correct", updated_at: new Date().toISOString() })
          .eq("id", answerId);
      } else {
        const maxS = Number(el.dataset.max) || 1;
        await window.sb.from("answers")
          .update({ score, is_correct: score >= maxS, updated_at: new Date().toISOString() })
          .eq("id", answerId);
      }
    }

    await recomputeAssignmentTotals(viewerState.assignmentId);
    await loadAnalytics();
    note.textContent = "저장되었습니다.";
    await openSolutionViewer(viewerState.assignmentId); // 갱신된 총점 반영
  } catch (err) {
    note.textContent = "저장 실패: " + (err.message || err);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

/* =========================================================
   문제 편집기
   ========================================================= */
let editorState = null;

async function openProblemEditor(classId, classNo) {
  const body = document.getElementById("editorBody");
  document.getElementById("editorTitle").textContent = `Class ${classNo} 문제 편집`;
  document.getElementById("editorSub").textContent = "정답·문제·해설·루브릭을 수정하고 저장하면 다음 풀이부터 즉시 반영됩니다.";
  body.innerHTML = `<p class="muted">불러오는 중…</p>`;
  openModal("editorBackdrop");

  try {
    const { data: sets } = await window.sb.from("question_sets")
      .select("id, difficulty").eq("class_id", classId).eq("is_active", true);
    const setByDiff = {};
    (sets || []).forEach((s) => { setByDiff[s.difficulty] = s.id; });
    const setIds = (sets || []).map((s) => s.id);
    let questions = [];
    if (setIds.length) {
      const { data: qs } = await window.sb.from("questions").select("*")
        .in("question_set_id", setIds).order("question_number");
      questions = qs || [];
    }
    const diffOfSet = {};
    (sets || []).forEach((s) => { diffOfSet[s.id] = s.difficulty; });
    editorState = { classId, classNo, setByDiff, diffOfSet, questions };
    renderEditor();
  } catch (err) {
    body.innerHTML = `<p class="muted">불러오기 실패: ${escHtml(err.message)}</p>`;
  }
}

const EDIT_DIFFS = ["easy", "medium", "hard"];
function renderEditor() {
  const { questions, setByDiff, diffOfSet } = editorState;
  const parts = [];
  EDIT_DIFFS.forEach((d) => {
    const setId = setByDiff[d];
    if (!setId) return;
    const qs = questions.filter((q) => q.question_set_id === setId);
    parts.push(`<div class="pe-diff-title">${DIFF_KO[d]} 난이도 <span class="badge badge-gray">${qs.length}문항</span></div>`);
    parts.push(qs.map((q) => peQuestionHtml(q)).join(""));
    parts.push(`<div class="pe-add-wrap"><button class="btn btn-sm" data-pe-add="${setId}">+ ${DIFF_KO[d]} 문제 추가</button></div>`);
  });
  document.getElementById("editorBody").innerHTML = parts.join("") || `<p class="muted">등록된 문제가 없습니다. MD 업로드로 먼저 등록하세요.</p>`;
}

function textOfLines(arr, mapper) {
  if (!Array.isArray(arr)) return "";
  return arr.map(mapper || ((x) => (typeof x === "string" ? x : JSON.stringify(x)))).join("\n");
}
function rubricToText(r) {
  if (!Array.isArray(r)) return "";
  return r.map((it) => {
    const desc = it.criterion ?? it.item ?? it.description ?? Object.entries(it).find(([k]) => k !== "score")?.[1] ?? "";
    return `${desc} | ${it.score ?? it.points ?? ""}`;
  }).join("\n");
}

function peQuestionHtml(q) {
  const type = q.question_type;
  return `
    <div class="pe-q" data-qid="${q.id || ""}" data-set-id="${q.question_set_id}">
      <div class="pe-q-head">
        <span class="q-no">Q<input type="number" class="qnum" value="${q.question_number ?? ""}" style="width:56px" /></span>
        <div class="row-actions">
          <button class="btn btn-sm btn-primary" data-pe-save>저장</button>
          <button class="btn btn-sm delete-btn" data-pe-del>삭제</button>
        </div>
      </div>
      <div class="pe-grid2">
        <div class="pe-field">
          <label>유형</label>
          <select class="qtype">
            ${["ox", "multiple_choice", "blank", "code", "matching"].map((t) => `<option value="${t}" ${t === type ? "selected" : ""}>${TYPE_LABEL2[t]}</option>`).join("")}
          </select>
        </div>
        <div class="pe-field">
          <label>배점 (max_score)</label>
          <input type="number" class="qmax" value="${q.max_score ?? 1}" min="0" />
        </div>
      </div>
      <div class="pe-field">
        <label>문제 <span class="hint">(저장 시 우크라이나어 자동 재번역)</span></label>
        <textarea class="qtext">${escHtml(q.question_text || "")}</textarea>
      </div>
      <div class="pe-typed">${peTypedFieldsHtml(q)}</div>
      <div class="pe-field">
        <label>오답 설명 (wrong_comment)</label>
        <textarea class="qwc">${escHtml(q.wrong_comment || "")}</textarea>
      </div>
      <div class="pe-field">
        <label>개념 (concept)</label>
        <input type="text" class="qconcept" value="${escAttr(q.concept || "")}" />
      </div>
    </div>`;
}

// 유형별 정답/보기/루브릭 필드
function peTypedFieldsHtml(q) {
  const type = q.question_type;
  if (type === "ox") {
    const v = String(q.correct_answers ?? "").toUpperCase();
    return `<div class="pe-field"><label>정답</label>
      <select class="qans-ox"><option value="O" ${v === "O" ? "selected" : ""}>O</option><option value="X" ${v === "X" ? "selected" : ""}>X</option></select></div>`;
  }
  if (type === "multiple_choice") {
    const multi = !!q.multi_select || Array.isArray(q.correct_answers);
    const ansStr = Array.isArray(q.correct_answers) ? q.correct_answers.join(", ") : String(q.correct_answers ?? "");
    return `<div class="pe-grid2">
      <div class="pe-field"><label>보기 <span class="hint">(한 줄에 하나)</span></label>
        <textarea class="qchoices mono">${escHtml(textOfLines(q.choices))}</textarea></div>
      <div class="pe-field">
        <label>정답 번호 <span class="hint">(1부터 · 복수면 쉼표, 예: 1, 3)</span></label>
        <input type="text" class="qans-mc" value="${escAttr(ansStr)}" />
        <label class="hint" style="display:flex;align-items:center;gap:6px;margin-top:8px;font-weight:600">
          <input type="checkbox" class="qmulti" ${multi ? "checked" : ""} /> 복수 정답 허용 (모두 골라야 정답)
        </label>
      </div>
    </div>`;
  }
  if (type === "blank") {
    return `<div class="pe-field"><label>정답 <span class="hint">(허용 답, 한 줄에 하나 — 대소문자·공백 무시)</span></label>
      <textarea class="qans-blank mono">${escHtml(textOfLines(Array.isArray(q.correct_answers) ? q.correct_answers : (q.correct_answers != null ? [q.correct_answers] : [])))}</textarea></div>`;
  }
  if (type === "code") {
    return `<div class="pe-field"><label>요구사항 <span class="hint">(한 줄에 하나)</span></label>
        <textarea class="qreq mono">${escHtml(textOfLines(q.requirements))}</textarea></div>
      <div class="pe-field"><label>루브릭 <span class="hint">(한 줄에 "기준 | 점수")</span></label>
        <textarea class="qrubric mono">${escHtml(rubricToText(q.rubric))}</textarea></div>`;
  }
  if (type === "matching") {
    return `<div class="pe-field"><label>정답 쌍 (JSON)</label>
      <textarea class="qans-json mono">${escHtml(q.correct_answers != null ? JSON.stringify(q.correct_answers) : "")}</textarea></div>
      <div class="pe-field"><label>보기 (choices JSON)</label>
      <textarea class="qchoices-json mono">${escHtml(q.choices != null ? JSON.stringify(q.choices) : "")}</textarea></div>`;
  }
  return "";
}

// 유형 변경 시 정답 필드 영역 재렌더
document.getElementById("editorBody").addEventListener("change", (e) => {
  const sel = e.target.closest(".qtype");
  if (!sel) return;
  const qEl = sel.closest(".pe-q");
  const typed = qEl.querySelector(".pe-typed");
  typed.innerHTML = peTypedFieldsHtml({ question_type: sel.value });
  qEl.classList.add("dirty");
});
document.getElementById("editorBody").addEventListener("input", (e) => {
  const qEl = e.target.closest(".pe-q");
  if (qEl) qEl.classList.add("dirty");
});

function linesToArray(text) {
  return String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
function parseRubric(text) {
  return linesToArray(text).map((line) => {
    const i = line.lastIndexOf("|");
    if (i < 0) return { criterion: line.trim(), score: 0 };
    return { criterion: line.slice(0, i).trim(), score: Math.round(Number(line.slice(i + 1).trim()) || 0) };
  });
}

// 폼 → question 객체
function readPEQuestion(qEl) {
  const type = qEl.querySelector(".qtype").value;
  const q = {
    id: qEl.dataset.qid || null,
    question_set_id: qEl.dataset.setId,
    question_number: parseInt(qEl.querySelector(".qnum").value, 10) || 1,
    question_type: type,
    max_score: parseInt(qEl.querySelector(".qmax").value, 10) || 1,
    question_text: qEl.querySelector(".qtext").value.trim(),
    wrong_comment: qEl.querySelector(".qwc").value.trim() || null,
    concept: qEl.querySelector(".qconcept").value.trim() || null,
    choices: null, correct_answers: null, requirements: null, rubric: null, multi_select: false,
  };
  if (type === "ox") {
    q.correct_answers = qEl.querySelector(".qans-ox").value;
  } else if (type === "multiple_choice") {
    q.choices = linesToArray(qEl.querySelector(".qchoices").value);
    const multi = !!qEl.querySelector(".qmulti")?.checked;
    const nums = String(qEl.querySelector(".qans-mc").value || "")
      .split(/[,\s]+/).map((x) => parseInt(x, 10)).filter(Number.isFinite);
    if (multi) { q.multi_select = true; q.correct_answers = nums; }
    else { q.correct_answers = nums.length ? nums[0] : null; }
  } else if (type === "blank") {
    q.correct_answers = linesToArray(qEl.querySelector(".qans-blank").value);
  } else if (type === "code") {
    q.requirements = linesToArray(qEl.querySelector(".qreq").value);
    q.rubric = parseRubric(qEl.querySelector(".qrubric").value);
  } else if (type === "matching") {
    try { q.correct_answers = JSON.parse(qEl.querySelector(".qans-json").value || "null"); } catch { throw new Error("정답 쌍 JSON 형식 오류"); }
    try { q.choices = JSON.parse(qEl.querySelector(".qchoices-json").value || "null"); } catch { throw new Error("보기 JSON 형식 오류"); }
  }
  return q;
}

// 저장 / 삭제 / 추가
document.getElementById("editorBody").addEventListener("click", async (e) => {
  const saveBtn = e.target.closest("button[data-pe-save]");
  const delBtn = e.target.closest("button[data-pe-del]");
  const addBtn = e.target.closest("button[data-pe-add]");

  if (addBtn) {
    const setId = addBtn.dataset.peAdd;
    const nums = editorState.questions.filter((q) => q.question_set_id === setId).map((q) => q.question_number || 0);
    const nextNum = (nums.length ? Math.max(...nums) : 0) + 1;
    const blank = { id: null, question_set_id: setId, question_number: nextNum, question_type: "ox", max_score: 1, question_text: "", correct_answers: "O" };
    const wrap = document.createElement("div");
    wrap.innerHTML = peQuestionHtml(blank);
    addBtn.closest(".pe-add-wrap").insertAdjacentElement("beforebegin", wrap.firstElementChild);
    return;
  }

  if (delBtn) {
    const qEl = delBtn.closest(".pe-q");
    const qid = qEl.dataset.qid;
    if (!qid) { qEl.remove(); return; }  // 저장 안 된 새 문제
    if (!confirm("이 문제를 삭제합니다. 되돌릴 수 없습니다.\n(이미 제출한 학생의 답안 기록도 함께 사라질 수 있습니다.)")) return;
    delBtn.disabled = true;
    const { error } = await window.sb.from("questions").delete().eq("id", qid);
    if (error) { alert("삭제 실패: " + error.message); delBtn.disabled = false; return; }
    editorState.questions = editorState.questions.filter((q) => q.id !== qid);
    qEl.remove();
    await loadProblemGrid();
    return;
  }

  if (saveBtn) {
    const qEl = saveBtn.closest(".pe-q");
    saveBtn.disabled = true;
    const orig = saveBtn.textContent;
    saveBtn.textContent = "저장 중…";
    try {
      let q;
      try { q = readPEQuestion(qEl); } catch (pe) { alert(pe.message); return; }
      if (!q.question_text) { alert("문제 텍스트를 입력하세요."); return; }

      // 이전 정답(재채점 필요 판단용)
      const prev = editorState.questions.find((x) => x.id === q.id);
      const answerKeyChanged = !prev
        || JSON.stringify(prev.correct_answers) !== JSON.stringify(q.correct_answers)
        || prev.question_type !== q.question_type
        || !!prev.multi_select !== !!q.multi_select
        || JSON.stringify(prev.rubric) !== JSON.stringify(q.rubric)
        || (prev.max_score ?? 1) !== (q.max_score ?? 1);

      // 우크라이나어 재번역
      const items = [{ key: "t", text: q.question_text }];
      if (q.wrong_comment) items.push({ key: "w", text: q.wrong_comment });
      if (q.question_type === "multiple_choice" && Array.isArray(q.choices)) {
        q.choices.forEach((c, i) => items.push({ key: `c${i}`, text: String(c) }));
      }
      const tr = await translateFields(items);
      const row = {
        question_set_id: q.question_set_id,
        question_number: q.question_number,
        question_type: q.question_type,
        question_text: q.question_text,
        question_text_uk: tr.t ?? null,
        choices: q.choices,
        choices_uk: (q.question_type === "multiple_choice" && Array.isArray(q.choices))
          ? q.choices.map((c, i) => tr[`c${i}`] ?? String(c)) : null,
        correct_answers: q.correct_answers,
        multi_select: !!q.multi_select,
        wrong_comment: q.wrong_comment,
        wrong_comment_uk: q.wrong_comment ? (tr.w ?? null) : null,
        concept: q.concept,
        requirements: q.requirements,
        rubric: q.rubric,
        max_score: q.max_score,
      };

      if (q.id) {
        const { error } = await window.sb.from("questions").update(row).eq("id", q.id);
        if (error) throw error;
      } else {
        const { data: ins, error } = await window.sb.from("questions").insert(row).select("id").single();
        if (error) throw error;
        q.id = ins.id;
        qEl.dataset.qid = q.id;
      }

      // editorState 갱신
      const full = { ...row, id: q.id };
      const idx = editorState.questions.findIndex((x) => x.id === q.id);
      if (idx >= 0) editorState.questions[idx] = full; else editorState.questions.push(full);

      qEl.classList.remove("dirty");

      // 재채점 안내 (수정한 문항만)
      if (answerKeyChanged && prev) {
        await maybeRegradeQuestion(full);
      }
      await loadProblemGrid();
      saveBtn.textContent = "저장됨 ✓";
      setTimeout(() => { saveBtn.textContent = orig; }, 1500);
    } catch (err) {
      alert("저장 실패: " + (err.message || err));
      saveBtn.textContent = orig;
    } finally {
      saveBtn.disabled = false;
    }
  }
});

// 수정한 문항만 재채점 (제출·채점된 과제 대상)
async function maybeRegradeQuestion(q) {
  const { data: ans } = await window.sb.from("answers").select("assignment_id").eq("question_id", q.id);
  const asgIds = [...new Set((ans || []).map((a) => a.assignment_id))];
  if (!asgIds.length) return;
  const { data: asgs } = await window.sb.from("assignments").select("id, status").in("id", asgIds);
  const targets = (asgs || []).filter((a) => ["submitted", "graded", "manual_review"].includes(a.status)).map((a) => a.id);
  if (!targets.length) return;

  if (q.question_type === "code") {
    if (!confirm(`이 코드 문항을 이미 제출한 학생 ${targets.length}명에 대해 AI로 다시 채점할까요?\n(수정한 이 문제만 재채점됩니다.)`)) return;
    const token = await getToken();
    if (!token) { alert("세션 만료 — 다시 로그인해 주세요."); return; }
    let ok = 0;
    for (const id of targets) {
      const resp = await fetch(`${API_BASE}/api/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ assignment_id: id, question_ids: [q.id] }),
      });
      if (resp.ok) ok++;
    }
    await loadAnalytics();
    alert(`재채점 완료: ${ok}/${targets.length}명`);
  } else if (OBJ_TYPES.has(q.question_type)) {
    if (!confirm(`정답이 바뀌었습니다. 이미 제출한 학생 ${targets.length}명의 이 문제를 다시 채점할까요?\n(수정한 이 문제만 재채점되고 총점이 갱신됩니다.)`)) return;
    const { data: rows } = await window.sb.from("answers")
      .select("id, assignment_id, answer_text, selected_choice, selected_choices").eq("question_id", q.id);
    const targetSet = new Set(targets);
    const affected = new Set();
    for (const a of (rows || [])) {
      if (!targetSet.has(a.assignment_id)) continue;
      const correct = isObjectiveCorrect(q, a);
      if (correct === null) continue;
      const score = correct ? (Number(q.max_score) || 1) : 0;
      await window.sb.from("answers").update({ is_correct: correct, score, updated_at: new Date().toISOString() }).eq("id", a.id);
      affected.add(a.assignment_id);
    }
    for (const id of affected) await recomputeAssignmentTotals(id);
    await loadAnalytics();
    alert(`재채점 완료: ${affected.size}명의 점수를 갱신했습니다.`);
  }
}
