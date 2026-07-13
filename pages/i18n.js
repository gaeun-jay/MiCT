// ============================================================
// i18n.js — 학생 화면 EN / УКР (우크라이나어) 전환
//   · 정적 UI 문구만 담당 (문제/피드백 콘텐츠 번역은 별도 단계)
//   · 코드/코드입력은 절대 번역하지 않음
//   · 사용법:
//       HTML: data-i18n="key"(textContent), data-i18n-html="key"(innerHTML),
//             data-i18n-ph="key"(placeholder), data-i18n-aria="key"(aria-label)
//       토글: <div data-lang-toggle></div> 를 두면 자동 마운트
//       JS:   window.t("key", { name:"..." }) 로 문자열 사용
//       변경 감지: window.addEventListener("i18n:change", () => rerender())
// ============================================================
(function () {
  const DICT = {
    en: {
      // 공통
      logout: "Logout",
      home_back: "← Home",
      back_to_bonus: "← Back to Bonus",
      // 로그인
      login_id_label: "ID",
      login_pw_label: "PW",
      login_pw_ph: "Password",
      login_btn: "Login",
      login_err_id: "Please enter your ID.",
      login_err_pw: "Please enter your password.",
      login_err_fail: "Login failed. Check your ID and password.",
      login_err_deactivated: "This account is deactivated. Please contact your administrator.",
      login_err_generic: "Login failed. Please try again.",
      show_password: "Show password",
      hide_password: "Hide password",
      // 비밀번호 변경
      cp_hello: "Hello, {name} !",
      cp_sub: "Please Enter Your<br>New Password",
      cp_pw_label: "PW",
      cp_pw_ph: "New password (8+ chars, letters & numbers)",
      cp_btn: "Change the password",
      cp_btn_saving: "Saving…",
      cp_err_short: "Password must be at least 8 characters with letters and numbers.",
      cp_err_fail: "Could not change password. Please try again.",
      cp_done: "Password changed. Redirecting…",
      // 홈
      badge_done: "Done",
      badge_progress: "In progress",
      badge_todo: "Not started",
      badge_locked: "Locked",
      pts: "pts",
      continue: "Continue",
      assignment: "Assignment",
      bonus_challenge_html: "Bonus<br>Challenge",
      home_load_error: "Could not load assignments.",
      // 과제(클래스)
      time_prefix: "Time",
      questions_word: "Questions",
      questions_count: "{n} Questions",
      start: "Start",
      in_progress: "In progress",
      submit: "Submit",
      submitted: "Submitted",
      grading: "Grading…",
      submit_failed: "Submit failed",
      diff_easy: "Easy",
      diff_medium: "Medium",
      diff_hard: "Hard",
      start_hint_1: "Press <b>Start</b> to begin the timer and unlock the questions.",
      start_hint_2: "You can change the difficulty (Easy · Medium · Hard) before starting. It's locked once you start.",
      confirm_submit: "Submit your answers? You won't be able to edit them afterwards.",
      res_correct: "Correct",
      res_incorrect: "Incorrect",
      res_answer: "Answer",
      res_strengths: "Strengths",
      res_tofix: "To fix",
      res_needs_revision: "Needs revision",
      res_manual_review: "Manual review",
      res_grading_ai: "Grading with AI…",
      res_code_error: "Code grading error",
      results: "Results",
      auto_graded: "Auto-graded",
      correct_word: "correct",
      objective: "Objective",
      code_ai_note: "Code questions are evaluated by AI (worth {n} pts total) — results appear under each question.",
      err_no_questions_diff: "No questions have been uploaded for this difficulty yet.",
      err_not_published: "This assignment is not published yet.",
      err_already_submitted: "You've already submitted this difficulty. Pick another one.",
      err_load_questions: "Could not load questions.",
      answer_placeholder: "Your answer",
      // 보너스
      bonus_title: "Bonus Challenge",
      bonus_empty: "No bonus concepts are available yet. Please check back later.",
      bonus_load_error: "Could not load topics.",
      bonus_start_hint_2: "Bonus assignments have no difficulty selection. 15 questions per concept (OX · Fill-in · Matching).",
      type_ox: "OX",
      type_mc: "Multiple Choice",
      type_code: "Code",
      type_blank: "Fill-in",
      type_matching: "Matching",
      select_a_match: "Select a match",
      res_accepted: "Accepted answer",
      res_correct_matches: "Correct matches",
      bonus_autograde_note: "Bonus assignments are fully auto-graded.",
      err_no_questions_topic: "No questions have been uploaded for this concept yet.",
      err_topic_not_published: "This concept is not published yet.",
    },
    uk: {
      logout: "Вихід",
      home_back: "← Головна",
      back_to_bonus: "← До бонусів",
      login_id_label: "ID",
      login_pw_label: "Пароль",
      login_pw_ph: "Пароль",
      login_btn: "Увійти",
      login_err_id: "Будь ласка, введіть свій ID.",
      login_err_pw: "Будь ласка, введіть пароль.",
      login_err_fail: "Не вдалося увійти. Перевірте ID і пароль.",
      login_err_deactivated: "Цей обліковий запис деактивовано. Зверніться до адміністратора.",
      login_err_generic: "Не вдалося увійти. Спробуйте ще раз.",
      show_password: "Показати пароль",
      hide_password: "Приховати пароль",
      cp_hello: "Привіт, {name} !",
      cp_sub: "Будь ласка, введіть<br>новий пароль",
      cp_pw_label: "Пароль",
      cp_pw_ph: "Новий пароль (8+ символів, літери й цифри)",
      cp_btn: "Змінити пароль",
      cp_btn_saving: "Збереження…",
      cp_err_short: "Пароль має містити щонайменше 8 символів із літерами та цифрами.",
      cp_err_fail: "Не вдалося змінити пароль. Спробуйте ще раз.",
      cp_done: "Пароль змінено. Перенаправлення…",
      badge_done: "Готово",
      badge_progress: "У процесі",
      badge_todo: "Не розпочато",
      badge_locked: "Заблоковано",
      pts: "балів",
      continue: "Продовжити",
      assignment: "Завдання",
      bonus_challenge_html: "Бонусний<br>виклик",
      home_load_error: "Не вдалося завантажити завдання.",
      time_prefix: "Час",
      questions_word: "Питання",
      questions_count: "{n} питань",
      start: "Почати",
      in_progress: "У процесі",
      submit: "Надіслати",
      submitted: "Надіслано",
      grading: "Оцінювання…",
      submit_failed: "Помилка надсилання",
      diff_easy: "Легкий",
      diff_medium: "Середній",
      diff_hard: "Складний",
      start_hint_1: "Натисніть <b>Почати</b>, щоб запустити таймер і відкрити питання.",
      start_hint_2: "Ви можете змінити складність (Легкий · Середній · Складний) перед початком. Після старту вона блокується.",
      confirm_submit: "Надіслати відповіді? Після цього змінити їх не можна.",
      res_correct: "Правильно",
      res_incorrect: "Неправильно",
      res_answer: "Відповідь",
      res_strengths: "Сильні сторони",
      res_tofix: "Що виправити",
      res_needs_revision: "Потребує доопрацювання",
      res_manual_review: "Ручна перевірка",
      res_grading_ai: "Оцінювання ШІ…",
      res_code_error: "Помилка оцінювання коду",
      results: "Результати",
      auto_graded: "Автооцінено",
      correct_word: "правильних",
      objective: "Об'єктивні",
      code_ai_note: "Питання з кодом оцінює ШІ (усього {n} балів) — результати показані під кожним питанням.",
      err_no_questions_diff: "Для цієї складності ще не завантажено питань.",
      err_not_published: "Це завдання ще не опубліковано.",
      err_already_submitted: "Ви вже здали цю складність. Виберіть іншу.",
      err_load_questions: "Не вдалося завантажити питання.",
      answer_placeholder: "Ваша відповідь",
      bonus_title: "Бонусний виклик",
      bonus_empty: "Бонусних тем поки немає. Завітайте пізніше.",
      bonus_load_error: "Не вдалося завантажити теми.",
      bonus_start_hint_2: "Бонусні завдання не мають вибору складності. 15 питань на тему (OX · Заповнення · Відповідність).",
      type_ox: "OX",
      type_mc: "Множинний вибір",
      type_code: "Код",
      type_blank: "Заповнення",
      type_matching: "Відповідність",
      select_a_match: "Виберіть відповідність",
      res_accepted: "Прийнятна відповідь",
      res_correct_matches: "Правильні відповідності",
      bonus_autograde_note: "Бонусні завдання оцінюються повністю автоматично.",
      err_no_questions_topic: "Для цієї теми ще не завантажено питань.",
      err_topic_not_published: "Цю тему ще не опубліковано.",
    },
  };

  let lang = localStorage.getItem("lang") === "uk" ? "uk" : "en";

  function t(key, params) {
    let s = (DICT[lang] && DICT[lang][key]) ?? DICT.en[key] ?? key;
    if (params) for (const k in params) s = s.replaceAll("{" + k + "}", params[k]);
    return s;
  }

  function apply(root) {
    const r = root || document;
    r.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
    r.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.getAttribute("data-i18n-html")); });
    r.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
    r.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria"))); });
  }

  function setLang(l) {
    lang = l === "uk" ? "uk" : "en";
    localStorage.setItem("lang", lang);
    document.documentElement.lang = lang;
    document.querySelectorAll(".lang-toggle").forEach((el) => { el.dataset.lang = lang; });
    apply();
    window.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang } }));
  }

  function buildToggle(el) {
    el.classList.add("lang-toggle");
    el.dataset.lang = lang;
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Language");
    el.innerHTML =
      `<span class="lang-knob" aria-hidden="true"></span>
       <button type="button" class="lang-seg" data-l="en">EN</button>
       <button type="button" class="lang-seg" data-l="uk">УКР</button>`;
    el.addEventListener("click", (e) => {
      const seg = e.target.closest(".lang-seg");
      if (seg) setLang(seg.dataset.l);
    });
  }

  function init() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-lang-toggle]").forEach(buildToggle);
    apply();
  }

  window.I18N = { t, apply, getLang: () => lang, setLang };
  window.t = t;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
