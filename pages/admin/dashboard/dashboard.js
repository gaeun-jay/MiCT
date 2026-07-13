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
        <button class="btn btn-sm reissue-btn" data-code="${s.student_code}" data-name="${escAttr(s.name)}">재발급</button>
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

function renderStatusTable() {
  const tbody = document.getElementById("statusTbody");
  const rows = assignmentsForClass(currentClassId);
  const byStu = {};
  rows.forEach((r) => { byStu[r.student_id] = r; }); // (학생×수업) 대체로 1건

  if (!anStudents.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">데이터를 불러오는 중이거나 학생이 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = anStudents
    .map((s) => {
      const a = byStu[s.id];
      const done = a && (a.status === "graded" || a.status === "manual_review");
      const inProgress = a && !done && a.status && a.status !== "not_started";
      const diff = a?.difficulty;
      const statusBadge = done ? "badge-green" : inProgress ? "badge-amber" : "badge-gray";
      const statusText = done ? "완료" : inProgress ? "진행중" : "미시작";
      return `
      <tr>
        <td><strong>${s.student_code}</strong></td>
        <td>${escHtml(s.name)}</td>
        <td>${diff ? `<span class="badge ${DIFF_BADGE[diff]}">${DIFF_KO[diff]}</span>` : "-"}</td>
        <td><span class="badge ${statusBadge}">${statusText}</span></td>
        <td>${done && Number.isFinite(a.total_score) ? a.total_score : "-"}</td>
        <td>${a ? fmtMin(a.total_duration_seconds) : "-"}</td>
        <td class="muted">${fmtDateTime(a?.submitted_at)}</td>
      </tr>`;
    })
    .join("");
}

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
