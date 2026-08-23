// =====================================================
// Adapter Sync — content script
//
// 比 Post Sync 的同一支短很多，因為文獻頁沒有那些問題：
// 一頁就是一篇（不用從動態牆裡認出哪一塊是貼文、不用濾巢狀留言）、
// 不用點任何按鈕展開全文（所以也沒有「誤按到檢舉」的風險）、
// 沒有輪播要翻。
//
// 剩下的責任只有三件：出一顆按鈕、把抽取結果送出去、把結果講清楚。
// =====================================================

(function () {
  'use strict';

  // 動態注入時同一個分頁可能被注入兩次（使用者按了「在這個站台啟用」，
  // 而這一頁本來就已經有 script）。跑兩份會出現兩顆按鈕。
  if (self.__ADAPTER_SYNC_LOADED__) return;
  self.__ADAPTER_SYNC_LOADED__ = true;

  const NS = self.ADAPTER_SYNC;
  const EX = self.ADAPTER_SYNC_EXTRACT;

  let ad = null;
  let btn = null;
  let busy = false;

  // ── 啟動與換頁 ────────────────────────────────────────
  //
  // 出版社的站台越來越多是 SPA：從搜尋結果點進一篇文章，網址變了、
  // 內容換了，但 content script 不會重新執行。不處理的話使用者會
  // 在文章頁上看不到按鈕，而重新整理就好了——那是最難回報的一種 bug。

  function boot() {
    const next = NS.adapterFor(location, document);
    if (next === ad) return;
    ad = next;
    if (!ad) { hideBtn(); return; }
    ensureBtn();
  }

  let lastHref = location.href;
  function watchNav() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    // SPA 換頁之後 meta 標籤不一定馬上就位，等一拍再判斷
    setTimeout(boot, 400);
    setTimeout(boot, 1500);
  }
  setInterval(watchNav, 700);
  window.addEventListener('popstate', watchNav);

  // ── 浮動按鈕 ─────────────────────────────────────────

  function ensureBtn() {
    if (btn && document.contains(btn)) return btn;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'adaptersync-btn';
    btn.textContent = '📄 收這篇文獻';
    btn.title = `Adapter Sync — 認到的來源：${ad.label}`;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      capture(false);
    });
    document.body.appendChild(btn);
    return btn;
  }

  function hideBtn() {
    if (btn) { btn.remove(); btn = null; }
  }

  // ── 收錄 ─────────────────────────────────────────────

  async function capture(force) {
    if (busy) return;
    if (!ad) {
      toast('❌ 這一頁沒有書目資料，認不出是一篇文獻', null, 6000);
      return;
    }
    busy = true;
    if (btn) btn.disabled = true;
    try {
      const rec = EX.extract(ad, document, location);
      const v = EX.verdict(rec);
      if (!v.ok) {
        toast(`❌ ${v.why}\n\n按擴充圖示的「檢查這一頁」可以看到抓到了什麼。`, null, 10000);
        return;
      }
      await send(rec, force, v.warn);
    } catch (e) {
      toast(`❌ ${(e && e.message) || '未知錯誤'}`, null, 8000);
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  // 重載擴充之後，已經開著的分頁裡跑的還是舊版 content script，
  // 它跟新的背景服務已經斷線（chrome.runtime 直接變成 undefined）。
  // 這件事在開發期間每次按 ⟳ 都會發生，不該讓使用者看到一句 JS 原始錯誤。
  function extAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  const DEAD_MSG = '擴充剛剛更新過，這個分頁還連著舊版。按 Cmd+R（Windows 是 F5）重新整理這一頁就好。';

  function sendOne(data, force) {
    return new Promise((resolve) => {
      if (!extAlive()) return resolve({ ok: false, error: DEAD_MSG });
      // 背景服務可能被瀏覽器休眠而讓回呼永遠不來，不設看門狗就是無盡轉圈
      const wd = setTimeout(
        () => resolve({ ok: false, error: '超過三分鐘沒有回應' }),
        180000,
      );
      chrome.runtime.sendMessage(
        { type: 'AS_CAPTURE', payload: data, force: !!force },
        (res) => {
          clearTimeout(wd);
          if (chrome.runtime.lastError) {
            return resolve({ ok: false, error: chrome.runtime.lastError.message });
          }
          resolve(res || { ok: false, error: '沒有回應' });
        },
      );
    });
  }

  function send(data, force, warn) {
    return new Promise((resolve) => {
      toast(`⏳ 準備寫入…\n${data.title || ''}`, null, 0, true);
      sendOne(data, force).then((res) => {
        if (res && res.dup) {
          dupToast(data, res.prev);
          return resolve();
        }
        if (!res || !res.ok) {
          toast(`❌ 寫入失敗：${(res && res.error) || '未知錯誤'}`, null, 10000);
          return resolve();
        }
        // 訊息由 background 組好，這裡只負責顯示。
        // 警告排在成功訊息**前面**——排在後面的話，使用者看到 ✅ 就關掉了。
        const lines = [];
        (res.alerts || []).forEach((a) => lines.push(a));
        if (warn) lines.push(`⚠️ ${warn}`);
        lines.push('✅ 已收錄');
        (res.bits || []).forEach((b) => lines.push(b));
        // 有警告就不要自動消失。撤稿這種事不能讓它閃一下就不見。
        const sticky = (res.alerts && res.alerts.length) || warn;
        toast(lines.join('\n'), res.drive && res.drive.docUrl, sticky ? 0 : 9000);
        if (sticky) armClose();
        resolve();
      });
    });
  }

  // ── 訊息 ─────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'AS_CONTEXT' || msg.type === 'AS_HOTKEY') {
      capture(false);
      return false;
    }
    if (msg.type === 'AS_PROGRESS') {
      toast(`⏳ ${msg.text}`, null, 0, true);
      return false;
    }
    if (msg.type === 'AS_DIAG') {
      sendResponse(diagnose());
      return false;
    }
    return false;
  });

  // ── 診斷 ─────────────────────────────────────────────
  //
  // 「抓不到」這種症狀，猜三次都不會中——要讓程式自己交出證據。
  // 做成使用者按得到的按鈕，而不是叫人開 DevTools 貼東西回來。
  //
  // 候選錨點**要分站台**數（adapters.js 裡各自帶一份 probes）。
  // 共用一份的話，在 arXiv 上等於量了五個必定是 0 的 PubMed 選擇器。
  function diagnose() {
    const out = {
      url: location.href,
      adapter: ad ? `${ad.label}（${ad.id}）` : '（認不出這一頁是文獻）',
      probes: {},
      record: null,
      verdict: null,
    };
    const probes = (ad && ad.probes) || {
      'citation_title meta': 'meta[name="citation_title" i]',
      'citation_doi meta': 'meta[name="citation_doi" i]',
      'JSON-LD': 'script[type="application/ld+json"]',
    };
    for (const [label, sel] of Object.entries(probes)) {
      try {
        out.probes[label] = document.querySelectorAll(sel).length;
      } catch (_) {
        out.probes[label] = -1; // 選擇器本身壞了，跟「找到 0 個」不是同一件事
      }
    }
    if (ad) {
      try {
        const rec = EX.extract(ad, document, location);
        out.verdict = EX.verdict(rec);
        // 只回摘要級的資訊，不要把整篇摘要塞進 popup
        out.record = {
          title: rec.title,
          authors: rec.authors.length,
          firstAuthor: rec.author,
          year: rec.year,
          journal: rec.journal,
          doi: rec.doi,
          pmid: rec.pmid,
          arxiv: rec.arxivId,
          abstractLen: rec.abstract.length,
          mesh: rec.meshTerms.length,
          fingerprint: rec.fingerprint,
          missing: rec.missing,
          integrity: rec.integrity,
          via: rec.via,
        };
      } catch (e) {
        out.error = (e && e.message) || String(e);
      }
    }
    return out;
  }

  // ── Toast ────────────────────────────────────────────

  let statusEl = null;

  function armClose() {
    if (!statusEl) return;
    const el = statusEl;
    if (el.querySelector('.adaptersync-close')) return;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'adaptersync-close';
    x.textContent = '✕';
    x.addEventListener('click', () => {
      el.remove();
      if (statusEl === el) statusEl = null;
    });
    el.appendChild(x);
  }

  function toast(msg, url, autoHideMs, working) {
    if (statusEl) statusEl.remove();
    const el = document.createElement('div');
    el.className = 'adaptersync-toast';
    statusEl = el;

    const span = document.createElement('span');
    span.className = 'adaptersync-status-text';
    span.textContent = msg;
    el.appendChild(span);

    // 進行中掛一條不定量進度條：不知道還要多久，但看得出它還活著
    if (working) {
      const bar = document.createElement('div');
      bar.className = 'adaptersync-progress';
      bar.appendChild(document.createElement('i'));
      el.appendChild(bar);
    }

    if (url) {
      const a = document.createElement('a');
      a.className = 'adaptersync-link';
      a.textContent = '開啟 Doc ↗';
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      el.appendChild(a);
    }

    let timer = null;
    const close = () => {
      clearTimeout(timer);
      el.remove();
      if (statusEl === el) statusEl = null;
    };

    if (autoHideMs > 0) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'adaptersync-close';
      x.textContent = '✕';
      x.addEventListener('click', close);
      el.appendChild(x);
      // 點卡片上任何一處也能收掉，不用瞄準右上角那個小叉叉
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('a, button')) return;
        close();
      });
      // 滑鼠停在卡片上就不倒數，離開才重新計時——來得及點「開啟 Doc」
      const arm = () => { timer = setTimeout(close, autoHideMs); };
      el.addEventListener('mouseenter', () => clearTimeout(timer));
      el.addEventListener('mouseleave', arm);
      arm();
    }
    document.body.appendChild(el);
  }

  // 同一篇再遇到一次是很正常的行為（從別的搜尋、別的電子報點進來），
  // 所以不是擋掉，是問一聲——而且要講得出上次收的是什麼。
  function dupToast(data, prev) {
    if (statusEl) statusEl.remove();
    const el = document.createElement('div');
    el.className = 'adaptersync-toast';
    statusEl = el;

    const lines = [`這篇已經收過了（${prev && prev.when ? prev.when : '先前'}）`];
    if (prev && prev.title) lines.push(prev.title);
    // arXiv 的 v1／v2 指紋相同，所以會走到這裡。要講清楚版本差異，
    // 不然使用者以為系統認錯了。
    if (prev && prev.version && data.arxivVersion && prev.version !== data.arxivVersion) {
      lines.push(`你上次收的是 ${prev.version}，這一頁是 ${data.arxivVersion}`);
    }

    // 上次是沒登入時收的截斷版、這次登入了 —— 這正是最該重收的情形，
    // 而預設的「已經收過了」訊息會讓人直接按「算了」，把完整版放掉。
    const wasTruncated = !!(prev && prev.restricted);
    const nowFull = !(data.access && data.access.restricted);
    const upgrade = wasTruncated && nowFull;
    if (upgrade) {
      const before = prev.absLen ? `${prev.absLen} 字` : '截斷版';
      lines.push(`上次那份是**沒登入**時收的（摘要 ${before}），`
        + `這一頁看起來是完整的（${data.abstract.length} 字）。建議重收一次蓋掉。`);
    }

    const span = document.createElement('span');
    span.className = 'adaptersync-status-text';
    span.textContent = lines.join('\n');
    el.appendChild(span);

    if (prev && prev.docUrl) {
      const a = document.createElement('a');
      a.className = 'adaptersync-link';
      a.textContent = `開啟已收的那份 ↗`;
      a.href = prev.docUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      el.appendChild(a);
    }

    const row = document.createElement('div');
    row.className = 'adaptersync-actions';

    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'adaptersync-mini adaptersync-mini-primary';
    again.textContent = upgrade ? '重收，蓋成完整版' : '仍要再收一次';
    again.addEventListener('click', () => {
      el.remove();
      statusEl = null;
      send(data, true);
    });

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'adaptersync-mini';
    skip.textContent = '算了';
    skip.addEventListener('click', () => {
      el.remove();
      statusEl = null;
    });

    row.appendChild(again);
    row.appendChild(skip);
    el.appendChild(row);
    document.body.appendChild(el);
    setTimeout(() => {
      if (statusEl === el) { el.remove(); statusEl = null; }
    }, 20000);
  }

  boot();
})();
