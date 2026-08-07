/* 理財小幫手中英文版：中英對照層
   - 字典比對整個文字節點（避免句中插字），命中就在後面補 <span class="mbe-en">EN</span>
   - MutationObserver 盯著 app.js 每次 innerHTML 重繪，重繪後自動補英文
   - 重要新聞：用 news.json 的 title_en/summary_en 補英文原文＋播放/慢速/跟讀 */
'use strict';
(function () {
  const DICT = (window.MBE_DICT || {});
  const processed = new WeakSet();

  /* ---------- 語言模式：both=中英對照 / en=全英文 / zh=純中文 ---------- */
  const MODE = (function () {
    /* 2026-08-06 起預設全英文：沒設定過就是 'en'，存過 'both'/'zh' 才是對照或純中文 */
    try {
      const m = localStorage.getItem('mbe_mode');
      return (m === 'both' || m === 'zh') ? m : 'en';
    } catch (e) { return 'both'; }
  })();
  const EN_ONLY = MODE === 'en';
  const ZH_ONLY = MODE === 'zh';
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
  if (ZH_ONLY) document.documentElement.setAttribute('data-mbe-mode', 'zh');

  /* ---------- 換語言保留展開狀態 ----------
     切語言＝location.reload()，重繪後所有 details 折疊區會回到預設收合。
     reload 前先把每個 details 的開合快照進 sessionStorage（一次性），
     重繪後用 interval 輪詢還原（app.js 各分頁是非同步渲染，元素會陸續出現）。
     鍵的設計要跨語言穩定：不能用標題文字（中英模式文字不同），
     改用 data-key / data-asec-acc / 所屬容器內序號。 */
  const SNAP_KEY = 'mbe_open_snap';
  function detailsSnapKey(d, gi) {
    if (d.dataset.asecAcc) return 'acc:' + d.dataset.asecAcc;
    if (d.dataset.key) return 'key:' + d.dataset.key;
    const anc = d.parentElement && d.parentElement.closest('details[data-key], details[data-asec-acc]');
    if (anc) {
      const ak = anc.dataset.key || ('acc:' + anc.dataset.asecAcc);
      const idx = Array.prototype.indexOf.call(anc.querySelectorAll('details'), d);
      return 'in:' + ak + ':' + idx;
    }
    return 'gi:' + gi;
  }
  function snapshotOpenState() {
    try {
      const snap = {};
      document.querySelectorAll('details').forEach((d, gi) => {
        snap[detailsSnapKey(d, gi)] = d.open ? 1 : 0;
      });
      sessionStorage.setItem(SNAP_KEY, JSON.stringify(snap));
    } catch (e) {}
  }
  function restoreOpenState() {
    let snap = null;
    try {
      snap = JSON.parse(sessionStorage.getItem(SNAP_KEY) || 'null');
      sessionStorage.removeItem(SNAP_KEY);
    } catch (e) {}
    if (!snap) return;
    const keys = Object.keys(snap);
    if (!keys.length) return;
    const done = new Set();
    const deadline = Date.now() + 10000;
    let timer = null;
    function apply() {
      const all = document.querySelectorAll('details');
      for (let gi = 0; gi < all.length; gi++) {
        const d = all[gi];
        const k = detailsSnapKey(d, gi);
        if (done.has(k) || !(k in snap)) continue;
        const want = !!snap[k];
        if (k.indexOf('acc:') === 0 && want && !d.open) {
          /* 資產配置折疊區：內容要透過 summary 點擊才會渲染（rerenderAlloc），
             直接設 open 只會開出空殼。點擊會同步重繪整個分頁，剩下的下一輪再處理 */
          const s = d.querySelector('summary');
          done.add(k);
          if (s) { s.click(); return; }
          continue;
        }
        if (d.open !== want) d.open = want;
        done.add(k);
      }
      if (done.size >= keys.length || Date.now() > deadline) clearInterval(timer);
    }
    timer = setInterval(apply, 300);
    apply();
  }

  /* ---------- 右下角浮動鈕：純英文 ↔ 純中文 ----------
     位置沿用原「理財聊聊」FAB；顯示的是「按下去會切到」的語言。
     中英對照模式按下先進純英文；切回對照仍走右上角切換鈕。 */
  function setMode(next) {
    snapshotOpenState();
    try { localStorage.setItem('mbe_mode', next); } catch (e) {}
    const toast = document.createElement('div');
    toast.className = 'mbe-mode-toast';
    toast.textContent = next === 'zh' ? '切換純中文' : 'English Only';
    document.body.appendChild(toast);
    setTimeout(() => location.reload(), 450);
  }
  function mountLangFab() {
    if (document.getElementById('mbe-lang-fab')) return;
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'mbe-lang-fab';
    fab.className = 'mbe-lang-fab';
    fab.textContent = EN_ONLY ? '中' : 'EN';
    fab.setAttribute('aria-label', EN_ONLY ? '切換純中文版' : 'Switch to English');
    fab.addEventListener('click', () => setMode(EN_ONLY ? 'zh' : 'en'));
    document.body.appendChild(fab);
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

  /* ---------- 點單字朗讀：點頁面上任何英文單字就唸給你聽 ---------- */
  const WORD_CH = /[A-Za-z'’-]/;
  function wordFromPoint(x, y, target) {
    let node = null, offset = 0;
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (!r) return null;
      node = r.startContainer; offset = r.startOffset;
    } else if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      node = p.offsetNode; offset = p.offset;
    }
    if (!node || node.nodeType !== 3) return null;
    /* caretRangeFromPoint 會吸附到最近的文字：確認命中的節點真的在點擊目標裡 */
    if (target && node.parentElement && !target.contains(node.parentElement) && !node.parentElement.contains(target)) return null;
    const text = node.nodeValue || '';
    if (!WORD_CH.test(text[offset] || '') && !WORD_CH.test(text[offset - 1] || '')) return null;
    let s = offset, e = offset;
    while (s > 0 && WORD_CH.test(text[s - 1])) s--;
    while (e < text.length && WORD_CH.test(text[e])) e++;
    /* 再驗一次：點擊座標要真的落在這個單字的框裡（容差 3px），避免點空白處誤唸鄰近字 */
    try {
      const rg = document.createRange();
      rg.setStart(node, s); rg.setEnd(node, e);
      let inside = false;
      const rects = rg.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const rc = rects[i];
        if (x >= rc.left - 3 && x <= rc.right + 3 && y >= rc.top - 3 && y <= rc.bottom + 3) { inside = true; break; }
      }
      if (!inside) return null;
    } catch (err) { return null; }
    const w = text.slice(s, e).replace(/^['’-]+|['’-]+$/g, '');
    if (!/[A-Za-z]/.test(w) || w.length > 30) return null;
    return w;
  }

  /* 單字中譯：Google 免費端點＋localStorage 快取（無金鑰、離線時氣泡只顯示單字） */
  const WCACHE_KEY = 'mbe_word_zh';
  let wcache = {};
  try { wcache = JSON.parse(localStorage.getItem(WCACHE_KEY) || '{}'); } catch (e) { wcache = {}; }
  function saveWordCache() {
    try {
      const ks = Object.keys(wcache);
      if (ks.length > 800) ks.slice(0, ks.length - 800).forEach(k => delete wcache[k]);
      localStorage.setItem(WCACHE_KEY, JSON.stringify(wcache));
    } catch (e) {}
  }
  function translateWord(word) {
    const key = word.toLowerCase();
    if (wcache[key]) return Promise.resolve(wcache[key]);
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=' + encodeURIComponent(word);
    return fetch(url)
      .then(r => r.json())
      .then(d => {
        const zh = d && d[0] && d[0][0] && d[0][0][0] ? String(d[0][0][0]).trim() : '';
        if (zh && zh.toLowerCase() !== key) { wcache[key] = zh; saveWordCache(); return zh; }
        return '';
      })
      .catch(() => '');
  }

  let wordBubble = null, wordBubbleTimer = null;
  function fadeBubble(b, delay) {
    clearTimeout(wordBubbleTimer);
    wordBubbleTimer = setTimeout(() => {
      b.classList.add('fade');
      setTimeout(() => { if (wordBubble === b) { b.remove(); wordBubble = null; } }, 350);
    }, delay);
  }
  function showWordBubble(word, x, y) {
    if (wordBubble) wordBubble.remove();
    clearTimeout(wordBubbleTimer);
    const b = document.createElement('div');
    b.className = 'mbe-word-bubble';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18.5 5.5a9 9 0 0 1 0 13"></path></svg><span class="mbe-word-w"></span><span class="mbe-word-zh"></span>';
    b.querySelector('.mbe-word-w').textContent = word;
    b.style.left = Math.min(Math.max(x, 50), window.innerWidth - 50) + 'px';
    b.style.top = Math.max(y, 44) + 'px';
    /* 點氣泡＝再唸一次 */
    b.addEventListener('click', e => { e.stopPropagation(); speak(word, 0.8); });
    document.body.appendChild(b);
    wordBubble = b;
    fadeBubble(b, 2000);
    translateWord(word).then(zh => {
      if (!zh || wordBubble !== b) return;
      b.querySelector('.mbe-word-zh').textContent = zh;
      b.classList.remove('fade');
      fadeBubble(b, 2600); /* 翻譯到了，多留一點時間看 */
    });
  }

  document.addEventListener('click', ev => {
    const t = ev.target;
    if (!t || !t.closest) return;
    if (t.closest('button, a, input, select, textarea, label, .mbe-lang-toggle, .mbe-word-bubble')) return;
    const sel = window.getSelection();
    if (sel && sel.type === 'Range') return; /* 使用者在選取文字，不搶 */
    const w = wordFromPoint(ev.clientX, ev.clientY, t);
    if (!w) return;
    speak(w, 0.8);
    showWordBubble(w, ev.clientX, ev.clientY);
  });

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
      snapshotOpenState();
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
    mountLangFab();
    restoreOpenState(); /* 換語言 reload 後還原展開狀態（三種模式都要） */
    if (ZH_ONLY) return; /* 純中文＝原站原樣，不補英文、不加新聞英文區塊 */
    translatePage();
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
