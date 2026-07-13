// ============================================================
// Bonus — Python 개념 카드 (Supabase 연동)
//   공개된 bonus_topics 만 표시, 학생의 완료(graded) 여부를 카드에 반영
// ============================================================

const grid = document.getElementById("conceptGrid");

// 인증 가드
(async () => {
  const { data: { session } } = await window.sb.auth.getSession();
  if (!session) { location.replace("../login/login.html"); return; }
  loadBonus();
})();

async function loadBonus() {
  const [{ data: topics, error: tErr }, { data: asg }] = await Promise.all([
    window.sb.from("bonus_topics")
      .select("id, slug, title, display_order")
      .eq("is_published", true)
      .order("display_order"),
    window.sb.from("assignments")
      .select("bonus_topic_id, status")
      .not("bonus_topic_id", "is", null),
  ]);

  if (tErr) {
    grid.innerHTML = `<p class="bonus-empty">${t("bonus_load_error")} (${tErr.message})</p>`;
    return;
  }
  if (!topics || !topics.length) {
    grid.innerHTML = `<p class="bonus-empty">${t("bonus_empty")}</p>`;
    return;
  }

  const doneByTopic = new Set(
    (asg || [])
      .filter((a) => a.status === "graded")
      .map((a) => a.bonus_topic_id)
  );

  grid.innerHTML = topics
    .map((t, i) => {
      const done = doneByTopic.has(t.id);
      return `
      <a class="concept-card glass-card ${done ? "is-done" : ""}"
         href="../bonus-assignment/bonus-assignment.html?topic=${encodeURIComponent(t.slug)}&name=${encodeURIComponent(t.title || t.slug)}">
        <span class="concept-idx">${String(i + 1).padStart(2, "0")}</span>
        <span class="concept-name">${escapeHtml(t.title || t.slug)}</span>
      </a>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
