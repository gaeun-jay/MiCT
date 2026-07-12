// ============================================================
// Bonus — 15개 Python 개념 카드 (MD §10.2)
// ============================================================

const CONCEPTS = [
  { slug: "variables", name: "Variables" },
  { slug: "input", name: "Input" },
  { slug: "output", name: "Output" },
  { slug: "types", name: "Types" },
  { slug: "operators", name: "Operators" },
  { slug: "strings", name: "Strings" },
  { slug: "conditional", name: "Conditional" },
  { slug: "loops", name: "Loops" },
  { slug: "lists", name: "Lists" },
  { slug: "dictionaries", name: "Dictionaries" },
  { slug: "tuples", name: "Tuples" },
  { slug: "sets", name: "Sets" },
  { slug: "functions", name: "Functions" },
  { slug: "exception", name: "Exception Handling" },
  { slug: "classes", name: "Classes" },
];

// 데모: 완료한 개념 (실제로는 assignments 조회)
const done = new Set(["variables", "input"]);

document.getElementById("conceptGrid").innerHTML = CONCEPTS.map((c, i) => `
  <a class="concept-card glass-card ${done.has(c.slug) ? "is-done" : ""}"
     href="../bonus-assignment/bonus-assignment.html?topic=${c.slug}&name=${encodeURIComponent(c.name)}">
    <span class="concept-idx">${String(i + 1).padStart(2, "0")}</span>
    <span class="concept-name">${c.name}</span>
  </a>`).join("");
