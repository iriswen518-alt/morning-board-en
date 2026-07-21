/* 理財小幫手中英文版：中英對照層
   - 字典比對整個文字節點（避免句中插字），命中就在後面補 <span class="mbe-en">EN</span>
   - MutationObserver 盯著 app.js 每次 innerHTML 重繪，重繪後自動補英文
   - 重要新聞：用 news.json 的 title_en/summary_en 補英文原文＋播放/慢速/跟讀 */
'use strict';
(function () {
  const DICT = (window.MBE_DICT || {});
  const processed = new WeakSet();

  /* ---------- 中英對照：文字節點 ---------- */
  function translateNode(node) {
    if (processed.has(node)) return;
    const v = node.nodeValue;
    if (!v || !/[一-鿿]/.test(v)) return;
    const p = node.parentElement;
    if (!p) return;
    if (p.closest('.mbe-en, .mbe-news, script, style, textarea')) { processed.add(node); return; }
    const t = v.trim();
    let en = DICT[t];
    let tail = '';
    if (!en && t.endsWith('：') && DICT[t.slice(0, -1)]) { en = DICT[t.slice(0, -1)]; tail = '：'; }
    if (!en && t.endsWith('…') && DICT[t.slice(0, -1)]) { en = DICT[t.slice(0, -1)]; tail = '…'; }
    processed.add(node);
    if (!en || en === t) return;
    const span = document.createElement('span');
    span.className = 'mbe-en';
    span.textContent = en + tail.replace('：', '');
    if (node.nextSibling) p.insertBefore(span, node.nextSibling);
    else p.appendChild(span);
  }

  function translateAttrs(root) {
    root.querySelectorAll('[placeholder], [aria-label]').forEach(el => {
      ['placeholder', 'aria-label'].forEach(a => {
        const key = 'mbe' + a.replace(/-/g, '');
        const v = el.getAttribute(a);
        if (!v || !/[一-鿿]/.test(v) || el.dataset[key]) return;
        const en = DICT[v.trim()];
        if (en) el.setAttribute(a, v + ' ' + en);
        el.dataset[key] = '1';
      });
    });
  }

  function translatePage() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const todo = [];
    let n;
    while ((n = walker.nextNode())) if (!processed.has(n)) todo.push(n);
    todo.forEach(translateNode);
    translateAttrs(document);
    enhanceNews();
  }

  /* ---------- TTS ---------- */
  let enVoice = null;
  function scoreVoice(v) {
    if (v.lang.indexOf('en') !== 0) return -1;
    let s = 0;
    if (/premium/i.test(v.name)) s += 50;
    else if (/enhanced/i.test(v.name)) s += 40;
    else if (/natural|neural|online/i.test(v.name)) s += 35;
    else if (/siri/i.test(v.name)) s += 30;
    else if (/^Google US English/i.test(v.name)) s += 25;
    else if (v.name === 'Samantha') s += 10;
    if (/compact|eloquence|novelty|Albert|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Fred|Jester|Junior|Kathy|Organ|Ralph|Superstar|Trinoids|Whisper|Zarvox|Good News|Bad News/i.test(v.name)) s -= 60;
    if (v.lang === 'en-US') s += 5;
    return s;
  }
  function pickVoice() {
    const vs = speechSynthesis.getVoices();
    let best = null, bestS = 0;
    vs.forEach(v => { const s = scoreVoice(v); if (s > bestS) { bestS = s; best = v; } });
    enVoice = best;
  }
  try {
    pickVoice();
    if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = pickVoice;
  } catch (e) {}
  function speak(text, rate) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = rate || 0.95;
      if (enVoice) u.voice = enVoice;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* ---------- 語音辨識（跟讀評分） ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function makeRecognizer(onFinal, onEnd) {
    if (!SR) return null;
    const r = new SR();
    r.lang = 'en-US'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let finalText = '', interimText = '';
    r.onresult = ev => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
        else interim += ev.results[i][0].transcript;
      }
      /* iOS Safari 常整段只給 interim、不標 isFinal */
      if (interim) interimText = interim;
    };
    r.onend = () => {
      if (onEnd) onEnd();
      const text = (finalText.trim() || interimText.trim());
      if (text && onFinal) onFinal(text);
      finalText = ''; interimText = '';
    };
    r.onerror = () => { finalText = ''; interimText = ''; };
    return r;
  }
  function normWords(s) {
    return s.toLowerCase()
      .replace(/(\d),(\d)/g, '$1$2')
      .replace(/%/g, ' percent ')
      .replace(/[^a-z0-9'. ]+/g, ' ')
      .replace(/(\d)\.(\d)/g, '$1 point $2')
      .replace(/\./g, ' ')
      .split(/\s+/).filter(Boolean);
  }
  function lcsMatch(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const hit = new Array(m).fill(false);
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) { hit[i] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
    }
    return hit;
  }

  /* ---------- 重要新聞：英文原文＋播放/慢速/跟讀 ---------- */
  let NEWS_MAP_PROMISE = null;
  function loadNewsMap() {
    /* 用 promise 快取：多次同時呼叫只 fetch 一次 */
    if (!NEWS_MAP_PROMISE) {
      NEWS_MAP_PROMISE = fetch(MBE_DATA_BASE + 'news.json?t=' + Date.now())
        .then(r => r.json())
        .then(d => {
          const m = new Map();
          (d.sections || []).forEach(s => (s.items || []).forEach(it => {
            if (it.title_zh && it.title_en) m.set(it.title_zh.trim(), it);
          }));
          return m;
        })
        .catch(() => new Map());
    }
    return NEWS_MAP_PROMISE;
  }

  function makeShadowBlock(it) {
    const d = document.createElement('div');
    d.className = 'mbe-news';
    d.innerHTML = '<div class="mbe-news-en"></div><div class="mbe-news-sum"></div>' +
      '<div class="mbe-btns">' +
      '<button type="button" class="mbe-btn b-play">播放</button>' +
      '<button type="button" class="mbe-btn b-slow">慢速</button>' +
      '<button type="button" class="mbe-btn b-rec">跟讀</button>' +
      '</div><div class="mbe-result"></div><div class="mbe-heard"></div>';
    d.querySelector('.mbe-news-en').textContent = it.title_en;
    d.querySelector('.mbe-news-sum').textContent = it.summary_en || '';
    const full = it.title_en + '. ' + (it.summary_en || '');
    d.querySelector('.b-play').addEventListener('click', e => { e.stopPropagation(); speak(full, 0.95); });
    d.querySelector('.b-slow').addEventListener('click', e => { e.stopPropagation(); speak(full, 0.65); });
    const target = it.title_en;
    const recBtn = d.querySelector('.b-rec');
    let rec = null, recTimer = null;
    recBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!SR) { alert('此瀏覽器不支援語音辨識，請改用 Chrome 或 Safari'); return; }
      if (rec) { try { rec.stop(); } catch (_) {} return; } /* 再按一次＝唸完，立即評分 */
      speechSynthesis.cancel();
      recBtn.textContent = '完成';
      const r = makeRecognizer(heard => {
        const tw = normWords(target), hw = normWords(heard);
        const hit = lcsMatch(tw, hw);
        const pct = tw.length ? Math.round(hit.filter(Boolean).length / tw.length * 100) : 0;
        const res = d.querySelector('.mbe-result');
        res.style.display = 'block';
        res.innerHTML = '<span class="mbe-score"></span>';
        const sc = res.querySelector('.mbe-score');
        sc.textContent = pct + '分';
        sc.style.color = pct >= 80 ? '#0e7d5b' : (pct >= 50 ? '#c79a00' : '#c94f4f');
        const orig = target.split(/\s+/);
        let wi = 0;
        orig.forEach(w => {
          const span = document.createElement('span');
          span.textContent = w + ' ';
          const toks = normWords(w);
          if (toks.length) {
            let ok = true;
            for (let k = 0; k < toks.length; k++) if (!hit[wi + k]) ok = false;
            wi += toks.length;
            span.className = ok ? 'mbe-hit' : 'mbe-miss';
          }
          res.appendChild(span);
        });
        d.querySelector('.mbe-heard').textContent = '你唸的: ' + heard;
      }, () => { recBtn.textContent = '跟讀'; rec = null; clearTimeout(recTimer); });
      try {
        r.start(); rec = r;
        recTimer = setTimeout(() => { try { if (rec) rec.stop(); } catch (_) {} }, 15000);
      } catch (_) { recBtn.textContent = '跟讀'; rec = null; }
    });
    return d;
  }

  async function enhanceNews() {
    const items = Array.from(document.querySelectorAll('.news-item > details:not([data-mbe])'));
    if (!items.length) return;
    /* 先同步標記再等資料，避免 news.json 下載期間重複插入 */
    items.forEach(det => { det.dataset.mbe = '1'; });
    const map = await loadNewsMap();
    items.forEach(det => {
      if (!det.isConnected || det.querySelector(':scope > .mbe-news')) return;
      const sum = det.querySelector('summary');
      if (!sum || !sum.firstChild || sum.firstChild.nodeType !== 3) return;
      const it = map.get((sum.firstChild.nodeValue || '').trim());
      if (!it) return;
      const block = makeShadowBlock(it);
      sum.insertAdjacentElement('afterend', block);
    });
  }

  /* ---------- 啟動＋盯重繪 ---------- */
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; translatePage(); }, 60);
  }
  const mo = new MutationObserver(schedule);
  function start() {
    translatePage();
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
