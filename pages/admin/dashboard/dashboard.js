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

// 학습 현황 (학생별 제출 데이터) — 성장 리포트에도 재사용 (아직 mock)
const learning = [
  {
    id: "Student001", name: "김민준", difficulty: "중", done: true,
    score: 92, time: "18분", submittedAt: "2026-07-11 14:20",
    class: "Class 1", strengths: "반복문 활용, 조건 분기 처리",
    weaknesses: "함수 분리 미흡", topics: ["for/while", "if-else", "리스트"],
  },
  {
    id: "Student002", name: "이서연", difficulty: "상", done: true,
    score: 88, time: "25분", submittedAt: "2026-07-11 15:02",
    class: "Class 1", strengths: "알고리즘 설계, 예외 처리",
    weaknesses: "시간 복잡도 최적화", topics: ["딕셔너리", "재귀", "정렬"],
  },
  {
    id: "Student003", name: "박도윤", difficulty: "하", done: false,
    score: null, time: "-", submittedAt: "-",
    class: "Class 2", strengths: "기본 문법 이해",
    weaknesses: "문제 완주율, 디버깅", topics: ["변수", "입출력"],
  },
  {
    id: "Student004", name: "최지우", difficulty: "중", done: true,
    score: 76, time: "31분", submittedAt: "2026-07-11 13:45",
    class: "Class 2", strengths: "문자열 처리",
    weaknesses: "인덱싱 오류, 경계 조건", topics: ["문자열", "슬라이싱"],
  },
  {
    id: "Student005", name: "정하은", difficulty: "상", done: true,
    score: 95, time: "22분", submittedAt: "2026-07-11 16:10",
    class: "Class 3", strengths: "논리적 문제 분해, 코드 가독성",
    weaknesses: "주석 부족", topics: ["클래스", "예외", "파일 I/O"],
  },
  {
    id: "Student006", name: "David Kim", difficulty: "중", done: false,
    score: null, time: "-", submittedAt: "-",
    class: "Class 3", strengths: "빠른 시도",
    weaknesses: "미제출 과제 다수", topics: ["함수", "리스트"],
  },
];

/* 반별 통계 (Mock) */
const classStats = {
  "Class 1": { total: 24, started: 21, done: 18, avgScore: 84, avgTime: "21분", review: 2, difficulty: [6, 12, 6], scores: [1, 2, 4, 8, 9] },
  "Class 2": { total: 22, started: 17, done: 13, avgScore: 78, avgTime: "27분", review: 4, difficulty: [9, 9, 4], scores: [2, 3, 6, 7, 4] },
  "Class 3": { total: 25, started: 23, done: 20, avgScore: 88, avgTime: "19분", review: 1, difficulty: [4, 11, 10], scores: [0, 1, 3, 9, 12] },
  "Class 4": { total: 20, started: 15, done: 11, avgScore: 73, avgTime: "30분", review: 5, difficulty: [10, 7, 3], scores: [3, 4, 5, 5, 3] },
  "Class 5": { total: 23, started: 20, done: 16, avgScore: 81, avgTime: "24분", review: 3, difficulty: [7, 10, 6], scores: [1, 3, 5, 7, 7] },
  "Bonus":   { total: 12, started: 8,  done: 5,  avgScore: 90, avgTime: "35분", review: 1, difficulty: [1, 4, 7], scores: [0, 0, 1, 4, 7] },
};

const trendData = {
  labels: ["월", "화", "수", "목", "금"],
  submissions: [8, 14, 11, 19, 23],
};

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
    studentTbody.innerHTML = `<tr><td colspan="5" class="muted">등록된 학생이 없습니다. CSV 업로드 또는 단일 생성으로 계정을 만드세요.</td></tr>`;
    return;
  }
  students.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${s.student_code}</strong></td>
      <td>
        <input class="name-input" value="${escAttr(s.name)}" data-id="${s.id}" />
      </td>
      <td>${s.age ?? "-"}</td>
      <td>
        <span class="badge ${s.must_change_password ? "badge-amber" : "badge-gray"}">
          ${s.must_change_password ? "필요" : "완료"}
        </span>
      </td>
      <td class="muted">${s.last_login_at ? new Date(s.last_login_at).toLocaleString("ko-KR") : "-"}</td>`;
    studentTbody.appendChild(tr);
  });
}

// DB에서 학생 목록 로드
async function loadStudents() {
  studentTbody.innerHTML = `<tr><td colspan="5" class="muted">불러오는 중…</td></tr>`;
  const { data, error } = await window.sb
    .from("students")
    .select("id, student_code, name, age, must_change_password, last_login_at")
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

// service_role 서버리스로 계정 생성 (공통)
async function createAccounts(payload) {
  const token = await getToken();
  if (!token) { alert("세션이 만료되었습니다. 다시 로그인해 주세요."); return null; }
  const resp = await fetch(`${API_BASE}/api/create-students`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ students: payload }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) { alert("생성 실패: " + (data.error || resp.status)); return null; }
  return data;
}

// 다음 학생 번호 계산 (StudentNNN)
function nextStudentCode() {
  const nums = students
    .map((s) => parseInt(String(s.student_code || "").replace(/\D/g, ""), 10))
    .filter(Number.isFinite);
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return "Student" + String(n).padStart(3, "0");
}

// 단일 계정 생성
document.getElementById("btnCreateSingle").addEventListener("click", async () => {
  const newId = nextStudentCode();
  const name = prompt(`새 학생 이름을 입력하세요.\n아이디: ${newId}`, "");
  if (name === null) return;
  const ageStr = prompt("나이 (선택, 숫자):", "");
  const ageNum = parseInt(ageStr, 10);
  const data = await createAccounts([
    { student_code: newId, name: name.trim(), age: Number.isFinite(ageNum) ? ageNum : null },
  ]);
  if (!data) return;
  const r = data.results[0];
  if (r.status === "created") {
    alert(`계정이 생성되었습니다.\n아이디: ${newId}\n임시 비밀번호: ${r.password}\n\n이 비밀번호를 학생에게 전달하세요. (첫 로그인 시 변경됩니다.)`);
  } else if (r.status === "exists") {
    alert(`이미 존재하는 계정입니다: ${newId}\n(이름/나이만 갱신했습니다.)`);
  } else {
    alert(`생성 실패: ${r.error || "알 수 없는 오류"}`);
  }
  await loadStudents();
});

// 다중 계정 생성 — 학생 CSV 업로드 → 파싱 (Student_Number, Name, Age)
//   · 맨 위 "Table 1" 타이틀 / 헤더 / 빈 줄 / 뒤쪽 빈 컬럼 자동 스킵
//   · 이름 앞뒤 공백 제거
function parseStudentCsv(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split(",");
    const code = (cols[0] || "").trim();
    if (!/^student\s*\d+/i.test(code)) continue; // 데이터 행만 (타이틀/헤더 자동 제외)
    const name = (cols[1] || "").trim();
    const ageNum = parseInt((cols[2] || "").trim(), 10);
    out.push({
      code: code.replace(/\s+/g, ""),
      name,
      age: Number.isFinite(ageNum) ? ageNum : null,
    });
  }
  return out;
}

document.getElementById("csvUpload").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const parsed = parseStudentCsv(text);
  e.target.value = "";
  if (!parsed.length) {
    alert("학생 데이터를 찾지 못했습니다. CSV 형식을 확인하세요.\n(열: Student_Number, Name, Age)");
    return;
  }
  if (!confirm(
    `"${file.name}" · 총 ${parsed.length}명의 계정을 생성합니다.\n` +
    `임시 비밀번호가 발급되며, 완료 후 비밀번호 CSV가 자동 다운로드됩니다.\n\n계속할까요?`
  )) return;

  const data = await createAccounts(
    parsed.map((p) => ({ student_code: p.code, name: p.name, age: p.age }))
  );
  if (!data) return;

  // 신규 생성된 계정의 임시 비밀번호를 CSV로 다운로드
  const createdRows = (data.results || []).filter((r) => r.status === "created");
  if (createdRows.length) {
    const header = ["학생아이디", "이름", "임시비밀번호"];
    const rows = createdRows.map((r) => [r.student_code, r.name, r.password]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    downloadFile("﻿" + csv, "student_passwords.csv", "text/csv;charset=utf-8;");
  }
  alert(
    `완료 · 신규 ${data.created}명 / 기존 ${data.existed}명 / 오류 ${data.errored}명\n\n` +
    (createdRows.length
      ? "신규 계정의 임시 비밀번호가 CSV로 다운로드되었습니다.\n학생들에게 전달하세요. (첫 로그인 시 변경됩니다.)"
      : "신규 생성된 계정이 없습니다.")
  );
  await loadStudents();
});

// 학생 목록 CSV 다운로드 (임시 비밀번호 제외 — DB에 평문 비번 없음)
document.getElementById("btnDownloadCsv").addEventListener("click", () => {
  const header = ["학생아이디", "이름", "나이", "비밀번호변경필요", "마지막로그인일시"];
  const rows = students.map((s) => [
    s.student_code,
    s.name,
    s.age ?? "",
    s.must_change_password ? "필요" : "완료",
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
const parsedByKey = {};      // key -> { filename, count, difficulties, questions } (로컬 MD 미리보기)

async function loadProblemGrid() {
  const [{ data: cls, error: cErr }, { data: bts }, { data: sets }] = await Promise.all([
    window.sb.from("classes").select("id, class_number, title, description, is_published").order("class_number"),
    window.sb.from("bonus_topics").select("id, is_published"),
    window.sb.from("question_sets").select("class_id, difficulty, questions(count)").eq("is_active", true),
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
  const allPub = totalB > 0 && pubB === totalB;
  const someB = pubB > 0;
  const bBadge = allPub
    ? `<span class="badge badge-green">전체 공개</span>`
    : someB ? `<span class="badge badge-amber">일부 공개</span>` : `<span class="badge badge-gray">비공개</span>`;
  const bonusCard = `
    <div class="card problem-item ${someB ? "" : "locked"}">
      <div class="card-body">
        <div class="pi-head"><h3>Bonus</h3>${bBadge}</div>
        <div class="pi-meta">Python 개념 ${totalB}개<br><b>${pubB}</b>개 공개됨</div>
        <div class="pi-actions">
          <button class="btn ${allPub ? "" : "btn-primary"}" data-bonus-toggle="${allPub ? "off" : "on"}">${allPub ? "전체 비공개" : "전체 공개"}</button>
        </div>
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

// MD 업로드 — 파싱 후 서버리스로 DB(questions) 저장
problemGrid.addEventListener("change", async (e) => {
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
    alert(`"${file.name}" 업로드 완료 🎉\nDB에 ${data.total}개 문제 등록 (${detail})`);
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
});

/* =========================================================
   (B) 학습 현황 — 통계 카드 / 진행률 / 테이블
   ========================================================= */
let currentClass = "Class 1";

function renderStats() {
  const st = classStats[currentClass];
  const notStarted = st.total - st.started;
  const completion = Math.round((st.done / st.total) * 100);

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
  document.getElementById("statusClassLabel").textContent = currentClass;
}

function renderStatusTable() {
  const tbody = document.getElementById("statusTbody");
  const diffBadge = { 하: "badge-green", 중: "badge-blue", 상: "badge-amber" };
  tbody.innerHTML = learning
    .map(
      (r) => `
      <tr>
        <td><strong>${r.id}</strong></td>
        <td>${r.name}</td>
        <td><span class="badge ${diffBadge[r.difficulty]}">${r.difficulty}</span></td>
        <td><span class="badge ${r.done ? "badge-green" : "badge-gray"}">${r.done ? "완료" : "미완료"}</span></td>
        <td>${r.score ?? "-"}</td>
        <td>${r.time}</td>
        <td class="muted">${r.submittedAt}</td>
      </tr>`
    )
    .join("");
}

// 반 선택 탭
document.getElementById("classTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".pill-tab");
  if (!btn) return;
  currentClass = btn.dataset.class;
  document
    .querySelectorAll("#classTabs .pill-tab")
    .forEach((b) => b.classList.toggle("active", b === btn));
  renderStats();
  updateCharts();
});

renderStats();
renderStatusTable();

/* ---------------- Chart.js ---------------- */
let charts = {};

function buildCharts() {
  const st = classStats[currentClass];
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
      labels: trendData.labels,
      datasets: [
        {
          label: "제출 건수",
          data: trendData.submissions,
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
  const st = classStats[currentClass];
  charts.difficulty.data.datasets[0].data = st.difficulty;
  charts.difficulty.update();
  charts.scores.data.datasets[0].data = st.scores;
  charts.scores.update();
  // 추이는 반별 편차를 주기 위해 completion 기반 스케일 적용
  const factor = st.done / 18;
  charts.trend.data.datasets[0].data = trendData.submissions.map((v) =>
    Math.round(v * factor)
  );
  charts.trend.update();
}

/* =========================================================
   (C) 성장 분석 리포트 — Markdown 생성 & 다운로드
   ========================================================= */
const reportList = document.getElementById("reportList");
reportList.innerHTML = learning
  .map(
    (s, i) => `
    <label class="select-row">
      <input type="checkbox" class="report-cb" data-idx="${i}" />
      <div>
        <strong>${s.id}</strong> · ${s.name}
      </div>
      <span class="meta">${s.class} · ${s.done ? "점수 " + s.score : "미제출"}</span>
    </label>`
  )
  .join("");

document.getElementById("selectAll").addEventListener("change", (e) => {
  document
    .querySelectorAll(".report-cb")
    .forEach((cb) => (cb.checked = e.target.checked));
});

document.getElementById("btnGenerateMd").addEventListener("click", () => {
  const selected = [...document.querySelectorAll(".report-cb:checked")].map(
    (cb) => learning[+cb.dataset.idx]
  );
  if (selected.length === 0) {
    alert("리포트를 생성할 학생을 한 명 이상 선택하세요.");
    return;
  }
  const md = buildMarkdown(selected);
  document.getElementById("mdPreview").value = md;
  const fname =
    selected.length === 1
      ? `growth_report_${selected[0].id}.md`
      : `growth_report_${selected.length}_students.md`;
  downloadFile(md, fname, "text/markdown;charset=utf-8;");
  console.log("[성장 리포트] Markdown 생성:", selected.map((s) => s.id));
});

function buildMarkdown(list) {
  const today = "2026-07-12";
  let md = `# 학생 성장 분석 리포트\n\n`;
  md += `- 생성일: ${today}\n`;
  md += `- 대상 학생 수: ${list.length}명\n`;
  md += `- 생성 방식: 제출 데이터 자동 수집 (AI 분석 미포함)\n\n`;
  md += `> 본 문서는 학생 학습 데이터를 Markdown으로 정리한 것으로, AI 분석 결과가 아닙니다.\n`;
  md += `> 필요 시 이 문서를 외부 AI 분석 도구의 입력으로 활용할 수 있습니다.\n\n`;
  md += `---\n\n`;

  list.forEach((s, i) => {
    md += `## ${i + 1}. ${s.name} (${s.id})\n\n`;
    md += `| 항목 | 값 |\n|------|------|\n`;
    md += `| 반 | ${s.class} |\n`;
    md += `| 선택 난이도 | ${s.difficulty} |\n`;
    md += `| 완료 여부 | ${s.done ? "완료" : "미완료"} |\n`;
    md += `| 점수 | ${s.score ?? "-"} |\n`;
    md += `| 풀이 시간 | ${s.time} |\n`;
    md += `| 제출 시간 | ${s.submittedAt} |\n\n`;
    md += `**주요 학습 주제:** ${s.topics.join(", ")}\n\n`;
    md += `**강점:** ${s.strengths}\n\n`;
    md += `**보완 필요:** ${s.weaknesses}\n\n`;
    md += `---\n\n`;
  });

  md += `_Python 과제 관리 시스템 · 관리자 콘솔에서 자동 생성됨_\n`;
  return md;
}
