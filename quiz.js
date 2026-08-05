/* =========================================================
   每日測驗 Daily Quiz — 中英文版獨立分頁層（不動 app.js / style.css）
   - 資料：data/quiz.json（本 repo GitHub Actions 每日由中文版 news.json 產生）
   - 規則：答對永不重複（當日內）、答錯同題重試直到答對
   - 架構：自行注入 nav 按鈕＋monkey-patch switchTab；樣式內嵌，
     上游中文版改版重 copy app.js/style.css 不影響本層
   ========================================================= */
(function () {
  "use strict";

  var QUIZ_TAB = "quiz";
  var LS_KEY = "mbe_quiz_state_v1";
  var QZ = { data: null, error: false, cur: null, wrongThisQ: false };

  /* ---------- state ---------- */
  function loadState(date) {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (_) {}
    if (!s || s.date !== date) s = { date: date, done: {}, firstTry: 0 };
    return s;
  }
  function saveState(s) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (_) {}
  }

  /* ---------- styles ---------- */
  var css = "" +
    ".qz-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:2px 0 14px}" +
    ".qz-title{font-size:20px;font-weight:700;color:var(--brand-deep,#123a6b)}" +
    ".qz-date{font-size:13px;color:var(--text-mute,#77839a)}" +
    ".qz-progress{display:flex;align-items:center;gap:10px;margin:0 0 16px;font-size:14px;color:var(--text-mute,#77839a)}" +
    ".qz-bar{flex:1;height:6px;border-radius:3px;background:#e6ecf5;overflow:hidden}" +
    ".qz-bar>i{display:block;height:100%;border-radius:3px;background:var(--brand-deep,#123a6b);transition:width .25s}" +
    ".qz-meta{display:flex;gap:8px;align-items:center;margin:0 0 10px;flex-wrap:wrap}" +
    ".qz-type{font-size:12px;padding:2px 10px;border-radius:999px;background:#eef3fa;color:var(--brand-deep,#123a6b);font-weight:600}" +
    ".qz-src{font-size:12.5px;color:var(--text-mute,#77839a)}" +
    ".qz-q{font-size:17px;line-height:1.55;font-weight:600;margin:0 0 14px}" +
    ".qz-opts{display:flex;flex-direction:column;gap:8px;margin:0 0 16px}" +
    ".qz-opt{text-align:left;font-size:15.5px;line-height:1.45;padding:11px 14px;border:1px solid #d7dfeb;border-radius:8px;background:var(--card-bg);cursor:pointer;color:inherit;font-family:inherit}" +
    ".qz-opt:hover{border-color:var(--brand-deep,#123a6b)}" +
    ".qz-opt.qz-wrong{background:var(--up-soft);border-color:#e08a8a;color:#a33;cursor:not-allowed;opacity:.85}" +
    ".qz-opt.qz-right{background:#e8f6ec;border-color:#5cab74;color:#1d6b36;font-weight:600}" +
    ".qz-opt[disabled]{cursor:not-allowed}" +
    ".qz-verdict{font-size:15px;font-weight:700;margin:0 0 8px}" +
    ".qz-verdict.ok{color:#1d6b36}.qz-verdict.no{color:#a33}" +
    ".qz-explain{border-top:1px solid #e6ecf5;padding-top:12px;margin-top:4px;font-size:14.5px;line-height:1.6}" +
    ".qz-explain b{display:block;margin-bottom:4px;color:var(--brand-deep,#123a6b)}" +
    ".qz-explain .en{color:#333;margin:0 0 8px}.qz-explain .zh{color:#555}" +
    ".qz-actions{display:flex;gap:10px;margin-top:16px}" +
    ".qz-actions button{flex:1;font-size:15px;font-weight:600;padding:11px 0;border-radius:8px;border:1px solid var(--brand-deep,#123a6b);cursor:pointer;font-family:inherit}" +
    ".qz-actions .qz-primary{background:var(--brand-deep,#123a6b);color:#fff}" +
    ".qz-actions .qz-ghost{background:var(--card-bg);color:var(--brand-deep,#123a6b)}" +
    ".qz-done{ text-align:center;padding:26px 0}" +
    ".qz-done .qz-score{font-size:34px;font-weight:700;color:var(--brand-deep,#123a6b);margin:10px 0 4px}" +
    ".qz-note{background:var(--warn-soft);border:1px solid #ffb74d;border-radius:6px;padding:10px 14px;margin:0 0 14px;color:#5a3a00;font-size:14.5px;line-height:1.5}";
  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ---------- nav injection ---------- */
  function injectNav() {
    var nav = document.getElementById("main-nav");
    if (!nav || nav.querySelector('.main-tab[data-tab="quiz"]')) return;
    var btn = document.createElement("button");
    btn.className = "main-tab";
    btn.dataset.tab = QUIZ_TAB;
    btn.innerHTML =
      '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2"/><path d="m9 14 2 2 4-4"/></svg>' +
      "<span>每日測驗</span>";
    var academy = document.getElementById("academy-link");
    if (academy) nav.insertBefore(btn, academy); else nav.appendChild(btn);
    btn.addEventListener("click", function () {
      var c = document.getElementById("content");
      if (!c || c.dataset.section !== QUIZ_TAB) window.switchTab(QUIZ_TAB);
    });
  }

  /* ---------- switchTab patch ---------- */
  function patchSwitchTab() {
    if (typeof window.switchTab !== "function" || window.switchTab.__qzPatched) return;
    var orig = window.switchTab;
    var patched = function (name) {
      orig(name);
      if (name === QUIZ_TAB) renderQuiz();
    };
    patched.__qzPatched = true;
    window.switchTab = patched;
  }

  /* ---------- data ---------- */
  function fetchQuiz() {
    if (QZ.data || QZ.error) return Promise.resolve();
    return fetch("data/quiz.json?t=" + Date.now())
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        if (!j || !Array.isArray(j.questions) || !j.questions.length) throw new Error("empty");
        QZ.data = j;
      })
      .catch(function () { QZ.error = true; });
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function remaining(state) {
    return QZ.data.questions.filter(function (q) { return !state.done[q.id]; });
  }
  function typeLabel(t) { return t === "vocab" ? "字彙題" : "理解題"; }

  /* ---------- render ---------- */
  function renderQuiz() {
    var body = document.getElementById("content");
    if (!body) return;
    if (!QZ.data && !QZ.error) {
      body.innerHTML = '<div class="qz-head"><span class="qz-title">每日測驗</span></div><p style="color:var(--text-mute,#77839a)">載入中…</p>';
      fetchQuiz().then(function () {
        var c = document.getElementById("content");
        if (c && c.dataset.section === QUIZ_TAB) renderQuiz();
      });
      return;
    }
    if (QZ.error) {
      body.innerHTML = '<div class="qz-head"><span class="qz-title">每日測驗</span></div>' +
        '<div class="qz-note"><strong>今日測驗尚未產生</strong>　系統每日 08:20 依當日新聞自動出題，請稍後再回來。</div>';
      return;
    }

    var d = QZ.data;
    var state = loadState(d.date);
    var todayLocal = (function () {
      var n = new Date();
      return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
    })();
    var stale = d.date < todayLocal
      ? '<div class="qz-note"><strong>今日測驗尚未產生</strong>　目前顯示 ' + esc(d.date) + ' 題目，通常 08:30 前更新完成。</div>'
      : "";

    var total = d.questions.length;
    var doneN = total - remaining(state).length;
    var head =
      '<div class="qz-head"><span class="qz-title">每日測驗</span><span class="qz-date">' + esc(d.date) + "</span></div>" + stale +
      '<div class="qz-progress"><span>今日進度</span><div class="qz-bar"><i style="width:' +
      Math.round((doneN / total) * 100) + '%"></i></div><span>' + doneN + " / " + total + "</span></div>";

    var rest = remaining(state);
    if (!rest.length) {
      var pct = total ? Math.round((state.firstTry / total) * 100) : 0;
      body.innerHTML = head +
        '<div class="qz-done"><div>今日完成</div><div class="qz-score">' + pct + "%</div>" +
        '<div style="color:var(--text-mute,#77839a);font-size:14px">一次答對 ' + state.firstTry + " / " + total + ' 題，明日新聞產生後會有新題目。</div>' +
        '<div class="qz-actions" style="max-width:340px;margin:22px auto 0"><button class="qz-ghost" id="qz-reset">重新練習</button></div></div>';
      var rb = document.getElementById("qz-reset");
      if (rb) rb.addEventListener("click", function () {
        saveState({ date: d.date, done: {}, firstTry: 0 });
        QZ.cur = null; renderQuiz();
      });
      return;
    }

    if (!QZ.cur || state.done[QZ.cur.id] || QZ.cur.__date !== d.date) {
      QZ.cur = rest[0];
      QZ.cur.__date = d.date;
      QZ.wrongThisQ = false;
    }
    var q = QZ.cur;

    body.innerHTML = head +
      '<div class="qz-meta"><span class="qz-type">' + typeLabel(q.type) + '</span>' +
      '<span class="qz-src">' + esc(q.news_title_en || "") + "</span></div>" +
      '<p class="qz-q">' + esc(q.question) + "</p>" +
      '<div class="qz-opts">' + q.options.map(function (o, i) {
        return '<button class="qz-opt" data-i="' + i + '">' + esc(o) + "</button>";
      }).join("") + "</div>" +
      '<div id="qz-fb"></div>';

    body.querySelectorAll(".qz-opt").forEach(function (btn) {
      btn.addEventListener("click", function () { answer(q, parseInt(btn.dataset.i, 10), btn, state); });
    });
  }

  function answer(q, i, btn, state) {
    var fb = document.getElementById("qz-fb");
    if (i !== q.answer) {
      QZ.wrongThisQ = true;
      btn.classList.add("qz-wrong");
      btn.disabled = true;
      if (fb) fb.innerHTML = '<p class="qz-verdict no">再試一次　Not quite — try again.</p>';
      return;
    }
    btn.classList.add("qz-right");
    document.querySelectorAll(".qz-opt").forEach(function (b) { b.disabled = true; });
    state.done[q.id] = true;
    if (!QZ.wrongThisQ) state.firstTry += 1;
    saveState(state);
    if (fb) fb.innerHTML =
      '<p class="qz-verdict ok">答對了　Correct!</p>' +
      '<div class="qz-explain"><b>本題解說</b>' +
      '<p class="en">' + esc(q.explain_en || "") + "</p>" +
      '<p class="zh">' + esc(q.explain_zh || "") + "</p></div>" +
      '<div class="qz-actions"><button class="qz-primary" id="qz-next">繼續作答</button></div>';
    var nx = document.getElementById("qz-next");
    if (nx) nx.addEventListener("click", function () { QZ.cur = null; renderQuiz(); });
    var bar = document.querySelector(".qz-bar>i"), cnt = document.querySelector(".qz-progress span:last-child");
    if (bar && QZ.data) {
      var total = QZ.data.questions.length;
      var doneN = total - remaining(state).length;
      bar.style.width = Math.round((doneN / total) * 100) + "%";
      if (cnt) cnt.textContent = doneN + " / " + total;
    }
  }

  /* ---------- boot ---------- */
  function boot() {
    injectNav();
    patchSwitchTab();
    fetchQuiz();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
