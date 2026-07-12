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


/* ---------------- Mock 데이터 ---------------- */
const students = [
  { id: "Student001", name: "Іванців Єва", age: 14, mustChange: true,  lastLogin: "2026-07-11 14:20" },
  { id: "Student002", name: "Альошина Оксана Анатоліївна", age: 47, mustChange: false, lastLogin: "2026-07-10 09:12" },
  { id: "Student003", name: "Karpenko Maksym", age: 12, mustChange: false, lastLogin: "-" },
  { id: "Student004", name: "Василевський Ярослав", age: 13, mustChange: true,  lastLogin: "2026-07-11 16:40" },
  { id: "Student005", name: "Гаврилова Камілла", age: 15, mustChange: false, lastLogin: "2026-07-09 21:05" },
  { id: "Student006", name: "Бубельник Нестор", age: 13, mustChange: false, lastLogin: "2026-07-11 11:33" },
  { id: "Student007", name: "Адамішен Данило", age: 15, mustChange: true,  lastLogin: "-" },
  { id: "Student008", name: "Гуржин Ілля", age: 12, mustChange: false, lastLogin: "2026-07-08 13:50" },
];

// 학습 현황 (학생별 제출 데이터) — 성장 리포트에도 재사용
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

function renderStudents() {
  studentTbody.innerHTML = "";
  students.forEach((s, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${s.id}</strong></td>
      <td>
        <input class="name-input" value="${s.name}" data-idx="${idx}" />
      </td>
      <td>${s.age ?? "-"}</td>
      <td>
        <span class="badge ${s.mustChange ? "badge-amber" : "badge-gray"}">
          ${s.mustChange ? "필요" : "완료"}
        </span>
      </td>
      <td class="muted">${s.lastLogin}</td>`;
    studentTbody.appendChild(tr);
  });
}
renderStudents();

// 이름 인라인 수정
studentTbody.addEventListener("change", (e) => {
  if (e.target.classList.contains("name-input")) {
    const idx = +e.target.dataset.idx;
    students[idx].name = e.target.value.trim();
    console.log("[학생 관리] 이름 수정:", students[idx].id, "→", students[idx].name);
  }
});

// 단일 계정 생성 (스텁)
document.getElementById("btnCreateSingle").addEventListener("click", () => {
  const nextNum = String(students.length + 1).padStart(3, "0");
  const newId = "Student" + nextNum;
  const name = prompt(`새 학생 이름을 입력하세요.\n아이디: ${newId}`, "");
  if (name === null) return;
  const ageStr = prompt("나이 (선택, 숫자):", "");
  const ageNum = parseInt(ageStr, 10);
  students.push({
    id: newId, name: name.trim() || "이름미정",
    age: Number.isFinite(ageNum) ? ageNum : null,
    mustChange: true, lastLogin: "-",
  });
  console.log("[학생 관리] 단일 계정 생성:", newId);
  renderStudents();
  alert(`계정이 생성되었습니다.\n아이디: ${newId}`);
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

document.getElementById("csvUpload").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = parseStudentCsv(String(reader.result));
    if (!parsed.length) {
      alert("학생 데이터를 찾지 못했습니다. CSV 형식을 확인하세요.\n(열: Student_Number, Name, Age)");
      e.target.value = "";
      return;
    }
    let added = 0, updated = 0;
    parsed.forEach((p) => {
      const ex = students.find((s) => s.id.toLowerCase() === p.code.toLowerCase());
      if (ex) { ex.name = p.name; ex.age = p.age; updated++; }
      else { students.push({ id: p.code, name: p.name, age: p.age, mustChange: true, lastLogin: "-" }); added++; }
    });
    renderStudents();
    console.log("[학생 관리] 다중 계정 생성 파싱:", file.name, parsed.length + "명");
    alert(
      `"${file.name}" 파싱 완료 · 총 ${parsed.length}명\n` +
      `신규 ${added}명 / 갱신 ${updated}명\n\n` +
      `(로컬 미리보기입니다. 실제 계정 생성과 임시 비밀번호 발급은 배포 후 서버리스(service_role)에서 처리됩니다.)`
    );
    e.target.value = "";
  };
  reader.readAsText(file, "utf-8");
});

// 학생 목록 CSV 다운로드 (실제 구현)
document.getElementById("btnDownloadCsv").addEventListener("click", () => {
  const header = ["학생아이디", "이름", "나이", "비밀번호변경필요", "마지막로그인일시"];
  const rows = students.map((s) => [
    s.id,
    s.name,
    s.age ?? "",
    s.mustChange ? "필요" : "완료",
    s.lastLogin,
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n");
  // BOM 추가 → Excel 한글 깨짐 방지
  downloadFile("﻿" + csv, "students.csv", "text/csv;charset=utf-8;");
  console.log("[학생 관리] 학생 목록 CSV 다운로드 완료");
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

let dbClasses = [];          // DB classes
let bonusTopics = [];        // DB bonus_topics
const parsedByKey = {};      // key -> { filename, count, difficulties, questions } (로컬 MD 미리보기)

async function loadProblemGrid() {
  const [{ data: cls, error: cErr }, { data: bts }] = await Promise.all([
    window.sb.from("classes").select("id, class_number, title, description, is_published").order("class_number"),
    window.sb.from("bonus_topics").select("id, is_published"),
  ]);
  if (cErr) {
    problemGrid.innerHTML = `<p class="muted">클래스를 불러오지 못했습니다. (${cErr.message})</p>`;
    return;
  }
  dbClasses = cls || [];
  bonusTopics = bts || [];
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
    const info = parsed
      ? `문제 <b>${parsed.count}</b>개 · 난이도 ${parsed.difficulties.join(" · ")} · 파일 <b>${escapeHtml(parsed.filename)}</b>`
      : `문제 미등록 (MD 업로드 예정)`;
    return `
      <div class="card problem-item ${pub ? "" : "locked"}">
        <div class="card-body">
          <div class="pi-head"><h3>Class ${c.class_number}</h3>${badge}</div>
          <div class="pi-meta">${escapeHtml(c.title || "")}<br>${info}<br>${pub ? "학생 화면에 노출됨" : "학생 화면에서 <b>Locked</b>"}</div>
          <div class="pi-actions">
            <button class="btn ${pub ? "" : "btn-primary"}" data-toggle="${c.id}" data-pub="${pub}">${pub ? "비공개로" : "공개하기"}</button>
            <label class="btn file-btn">${uploadIcon} MD 미리보기<input type="file" accept=".md,.markdown,.txt" data-parse="${key}" /></label>
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

// MD 미리보기 파싱 (로컬 — DB 저장은 배포 후 서버리스에서)
problemGrid.addEventListener("change", (e) => {
  const input = e.target.closest("input[data-parse]");
  if (!input || !input.files[0]) return;
  const key = input.dataset.parse;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = parseQuestionsMd(String(reader.result));
    if (parsed.count === 0) {
      alert("문제를 찾지 못했습니다. Markdown 형식을 확인하세요.\n(### Question, type:, question: 형식)");
      return;
    }
    parsedByKey[key] = {
      filename: file.name,
      count: parsed.count,
      difficulties: parsed.difficulties.length ? parsed.difficulties : ["-"],
      questions: parsed.questions.slice(0, 20),
    };
    console.log("[문제 관리] MD 파싱:", key, file.name, parsed.count + "문제");
    renderProblemGrid();
    showPreview(key);
    alert(`"${file.name}" 파싱 완료 · ${parsed.count}개 문제\n\n(로컬 미리보기입니다. questions 테이블 저장은 배포 후 서버리스(service_role)에서 처리됩니다.)`);
  };
  reader.readAsText(file);
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
