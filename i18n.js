/* 理財小幫手中英文版：中英對照層
   - 字典比對整個文字節點（避免句中插字），命中就在後面補 <span class="mbe-en">EN</span>
   - MutationObserver 盯著 app.js 每次 innerHTML 重繪，重繪後自動補英文
   - 重要新聞：用 news.json 的 title_en/summary_en 補英文原文＋播放/慢速/跟讀 */
'use strict';
(function () {
  const DICT = (window.MBE_DICT || {});
  const processed = new WeakSet();

  /* ---------- 語言模式：both=中英對照 / en=全英文 ---------- */
  const MODE = (function () {
    /* 2026-08-06 起預設全英文：沒設定過就是 'en'，按過切換鈕存 'both' 才回中英對照 */
    try { return localStorage.getItem('mbe_mode') === 'both' ? 'both' : 'en'; }
    catch (e) { return 'both'; }
  })();
  const EN_ONLY = MODE === 'en';
  /* 全英文專用：標籤+數值黏在同一文字節點（字典無法整段命中）時，改用前綴替換 */
  const EN_PREFIX = [
    ['上次更新：', 'Last Updated: '],
    ['上次更新', 'Last Updated'],
    ['資料時間 ', 'As of '],
    ['資料時間', 'As of '],
    ['台灣 ', 'Taiwan '],
    ['台灣', 'Taiwan']
  ];
  if (EN_ONLY) {
    document.documentElement.lang = 'en';
    document.documentElement.setAttribute('data-mbe-mode', 'en');
  }

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
    if ((!en || en === t) && EN_ONLY) {
      /* 字典整段沒命中：試前綴替換（標籤黏數值的情況，如「上次更新：xxx」） */
      for (const [zh, enp] of EN_PREFIX) {
        if (t.startsWith(zh)) { node.nodeValue = v.replace(t, enp + t.slice(zh.length)); return; }
      }
      return;
    }
    if (!en || en === t) return;
    if (EN_ONLY) {
      /* 全英文：直接把中文文字節點換成英文（保留原本前後空白），字體全尺寸 */
      node.nodeValue = v.replace(t, en + tail);
      return;
    }
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
        if (en) el.setAttribute(a, EN_ONLY ? en : (v + ' ' + en));
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

  const L = (zh, en) => (EN_ONLY ? en : zh);

  function makeShadowBlock(it) {
    const d = document.createElement('div');
    d.className = 'mbe-news';
    d.innerHTML = '<div class="mbe-news-en"></div><div class="mbe-news-sum"></div>' +
      '<div class="mbe-btns">' +
      '<button type="button" class="mbe-btn b-play">' + L('播放', 'Play') + '</button>' +
      '<button type="button" class="mbe-btn b-slow">' + L('慢速', 'Slow') + '</button>' +
      '<button type="button" class="mbe-btn b-rec">' + L('跟讀', 'Read Aloud') + '</button>' +
      '</div><div class="mbe-result"></div><div class="mbe-heard"></div>';
    if (EN_ONLY) d.querySelector('.mbe-news-en').style.display = 'none';
    else d.querySelector('.mbe-news-en').textContent = it.title_en;
    d.querySelector('.mbe-news-sum').textContent = it.summary_en || '';
    const full = it.title_en + '. ' + (it.summary_en || '');
    d.querySelector('.b-play').addEventListener('click', e => { e.stopPropagation(); speak(full, 0.95); });
    d.querySelector('.b-slow').addEventListener('click', e => { e.stopPropagation(); speak(full, 0.65); });
    const target = it.title_en;
    const recBtn = d.querySelector('.b-rec');
    let rec = null, recTimer = null;
    recBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!SR) { alert(L('此瀏覽器不支援語音辨識，請改用 Chrome 或 Safari', 'Speech recognition is not supported in this browser; please use Chrome or Safari')); return; }
      if (rec) { try { rec.stop(); } catch (_) {} return; } /* 再按一次＝唸完，立即評分 */
      speechSynthesis.cancel();
      recBtn.textContent = L('完成', 'Done');
      const r = makeRecognizer(heard => {
        const tw = normWords(target), hw = normWords(heard);
        const hit = lcsMatch(tw, hw);
        const pct = tw.length ? Math.round(hit.filter(Boolean).length / tw.length * 100) : 0;
        const res = d.querySelector('.mbe-result');
        res.style.display = 'block';
        res.innerHTML = '<span class="mbe-score"></span>';
        const sc = res.querySelector('.mbe-score');
        sc.textContent = EN_ONLY ? (pct + '%') : (pct + '分');
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
        d.querySelector('.mbe-heard').textContent = L('你唸的: ', 'You said: ') + heard;
      }, () => { recBtn.textContent = L('跟讀', 'Read Aloud'); rec = null; clearTimeout(recTimer); });
      try {
        r.start(); rec = r;
        recTimer = setTimeout(() => { try { if (rec) rec.stop(); } catch (_) {} }, 15000);
      } catch (_) { recBtn.textContent = L('跟讀', 'Read Aloud'); rec = null; }
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
      /* 全英文：把中文標題換成英文原標題（全尺寸） */
      if (EN_ONLY && it.title_en) sum.firstChild.nodeValue = it.title_en;
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

  /* ---------- 語言切換鈕 ---------- */
  function mountToggle() {
    if (document.getElementById('mbe-lang-toggle')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'mbe-lang-toggle';
    btn.className = 'mbe-lang-toggle';
    var globe = '<svg class="mbe-globe" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><line x1="3" y1="12" x2="21" y2="12"></line><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"></path></svg>';
    btn.innerHTML = globe + '<span>' + (EN_ONLY ? 'Bilingual' : 'English') + '</span>';
    btn.setAttribute('aria-label', EN_ONLY ? 'Switch to bilingual view' : '切換全英文版');
    btn.addEventListener('click', () => {
      try { localStorage.setItem('mbe_mode', EN_ONLY ? 'both' : 'en'); } catch (e) {}
      location.reload();
    });
    const row = document.querySelector('.topbar-title-row') || document.querySelector('.topbar');
    if (row) row.appendChild(btn);
    /* 全英文：標題徽章顯示 English，並更新分頁標題 */
    if (EN_ONLY) {
      const badge = document.querySelector('.test-badge');
      if (badge) badge.textContent = 'English';
      document.title = 'Morning Board (English) — for testing only';
    }
  }

  function start() {
    mountToggle();
    translatePage();
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
