// =====================================================
// Adapter Sync — popup
//
// 設定畫面。這裡最容易出的錯不是功能，是「畫面說一套、實際做一套」：
// 顯示的預設值跟 background 實際寫入時用的 fallback 不同，
// 而那種錯不會有任何錯誤訊息。所以預設值一律從 defaults.js 來。
// =====================================================

(function () {
  'use strict';

  const DEF = self.ADAPTER_SYNC_DEFAULTS;
  const $ = (id) => document.getElementById(id);

  function show(el, text, ok) {
    el.textContent = text;
    el.className = `msg ${ok ? 'ok' : 'err'}`;
  }

  // ── Google 連線狀態 ──────────────────────────────────

  function refreshConn() {
    chrome.runtime.sendMessage({ type: 'AS_STATUS' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        $('connText').textContent = '背景服務沒有回應';
        return;
      }
      if (res.reason === 'no_client_id') {
        $('dot').classList.remove('on');
        $('connText').textContent = '尚未設定 OAuth client_id（Drive 無法使用）';
        $('connect').disabled = true;
        $('connect').title = '照 README 的「OAuth 設定」做一次';
        return;
      }
      $('dot').classList.toggle('on', !!res.connected);
      $('connText').textContent = res.connected ? '已連接 Google' : '尚未連接 Google';
    });
  }

  $('connect').addEventListener('click', () => {
    $('connect').disabled = true;
    chrome.runtime.sendMessage({ type: 'AS_CONNECT' }, (res) => {
      $('connect').disabled = false;
      if (!res || !res.ok) show($('msg'), `連接失敗：${(res && res.error) || '未知錯誤'}`, false);
      refreshConn();
    });
  });

  // ── 設定的讀寫 ───────────────────────────────────────

  const KEYS = ['driveEnabled', 'driveFolder', 'f4Enabled', 'f4Base', 'f4Folder', 'f4Private'];

  function load() {
    chrome.storage.sync.get(KEYS, (s) => {
      // driveEnabled 預設是「開」，所以要判 !== false 而不是 !!s.driveEnabled，
      // 不然第一次打開 popup 會顯示成關閉，跟實際行為相反。
      $('driveEnabled').checked = s.driveEnabled !== false;
      $('driveFolder').value = s.driveFolder || '';
      $('f4Enabled').checked = !!s.f4Enabled;
      $('f4Base').value = s.f4Base || '';
      $('f4Folder').value = s.f4Folder || '';
      $('f4Private').checked = !!s.f4Private;
    });
  }

  $('save').addEventListener('click', () => {
    const base = $('f4Base').value.trim().replace(/\/+$/, '');
    if ($('f4Enabled').checked && !base) {
      return show($('msg'), '要同步知識庫的話，網址不能空著', false);
    }
    if (base && /^https?:\/\/(www\.)?focus4ai\.com/i.test(base)) {
      return show($('msg'),
        'focus4ai.com 是官網、沒有 API。線上站台請填 https://app.focus4ai.com', false);
    }
    chrome.storage.sync.set({
      driveEnabled: $('driveEnabled').checked,
      driveFolder: $('driveFolder').value.trim() || DEF.driveFolder,
      f4Enabled: $('f4Enabled').checked,
      f4Base: base || DEF.f4Base,
      f4Folder: $('f4Folder').value.trim() || DEF.f4Folder,
      f4Private: $('f4Private').checked,
    }, () => {
      show($('msg'), '已儲存', true);
      load();
    });
    return undefined;
  });

  $('f4Test').addEventListener('click', () => {
    const base = $('f4Base').value.trim().replace(/\/+$/, '') || DEF.f4Base;
    show($('f4Msg'), '測試中…', true);
    chrome.runtime.sendMessage({ type: 'AS_F4_TEST', base }, (res) => {
      if (!res) return show($('f4Msg'), '背景服務沒有回應', false);
      return show($('f4Msg'), res.ok ? '連線正常' : `連不上：${res.error}`, !!res.ok);
    });
  });

  // ── 出版社站台的逐站授權 ─────────────────────────────

  let currentHost = '';

  function hostOf(url) {
    try {
      const u = new URL(url);
      if (!/^https:$/.test(u.protocol)) return '';
      return u.hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  }

  const BUILTIN = /^(pubmed\.ncbi\.nlm\.nih\.gov|pmc\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|arxiv\.org|biorxiv\.org|medrxiv\.org)$/;

  function refreshSites() {
    chrome.runtime.sendMessage({ type: 'AS_SITE_LIST' }, (res) => {
      const sites = (res && res.sites) || [];
      const box = $('siteList');
      box.textContent = '';
      if (!sites.length) {
        box.textContent = '（還沒有自己啟用的站台）';
      }
      sites.forEach((h) => {
        const row = document.createElement('div');
        row.textContent = h;
        const b = document.createElement('button');
        b.textContent = '停用';
        b.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'AS_SITE_DISABLE', host: h }, () => {
            refreshSites();
            refreshHost();
          });
        });
        row.appendChild(b);
        box.appendChild(row);
      });
      // 目前分頁的按鈕文字要跟著清單走
      const t = $('siteToggle');
      if (currentHost && sites.includes(currentHost)) {
        t.textContent = '停用';
        t.dataset.mode = 'off';
      } else {
        t.textContent = '啟用';
        t.dataset.mode = 'on';
      }
    });
  }

  function refreshHost() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = (tabs[0] && tabs[0].url) || '';
      currentHost = hostOf(url);
      const t = $('siteToggle');
      if (!currentHost) {
        $('hostText').textContent = '目前分頁：（不是 https 網頁）';
        t.disabled = true;
        return;
      }
      if (BUILTIN.test(currentHost)) {
        $('hostText').textContent = `目前分頁：${currentHost}（內建，已支援）`;
        t.disabled = true;
        return;
      }
      $('hostText').textContent = `目前分頁：${currentHost}`;
      t.disabled = false;
      refreshSites();
    });
  }

  $('siteToggle').addEventListener('click', () => {
    if (!currentHost) return;
    const off = $('siteToggle').dataset.mode === 'off';
    const type = off ? 'AS_SITE_DISABLE' : 'AS_SITE_ENABLE';
    // 權限對話框由 Chrome 自己彈。使用者按取消時 background 會回
    // ok:false，這裡照實顯示，不要謊報成功。
    chrome.runtime.sendMessage({ type, host: currentHost }, (res) => {
      if (!res || !res.ok) {
        return show($('siteMsg'), (res && res.error) || '沒有回應', false);
      }
      show($('siteMsg'), off
        ? `已停用 ${currentHost}`
        : `已啟用 ${currentHost}。請重新整理那個分頁，按鈕才會出現。`, true);
      refreshSites();
      refreshHost();
      return undefined;
    });
  });

  // ── 診斷 ─────────────────────────────────────────────
  //
  // 「這一頁抓不到」猜三次都不會中，要讓程式自己交出證據。
  // 使用者按得到的按鈕，比叫人開 DevTools 貼東西回來實際得多。

  function fmtDiag(d) {
    const lines = [];
    lines.push(`來源：${d.adapter}`);
    if (d.error) lines.push(`抽取時出錯：${d.error}`);
    const probes = Object.entries(d.probes || {})
      .map(([k, v]) => `  ${k}：${v < 0 ? '選擇器壞了' : v}`);
    if (probes.length) lines.push('錨點數量：', ...probes);
    const r = d.record;
    if (r) {
      lines.push('');
      lines.push(`標題：${r.title || '（無）'}`);
      lines.push(`作者：${r.authors} 位${r.firstAuthor ? `（第一位 ${r.firstAuthor}）` : ''}`);
      lines.push(`年份：${r.year || '（無）'}・期刊：${r.journal || '（無）'}`);
      lines.push(`DOI：${r.doi || '（無）'}・PMID：${r.pmid || '（無）'}${r.arxiv ? `・arXiv：${r.arxiv}` : ''}`);
      lines.push(`摘要：${r.abstractLen} 字・MeSH：${r.mesh} 個`);
      lines.push(`指紋：${r.fingerprint || '（算不出來）'}`);
      if (r.missing && r.missing.length) lines.push(`缺：${r.missing.join('、')}`);
      const ig = r.integrity || {};
      lines.push(`撤稿掃描：${ig.scanned ? '已掃' : '沒有可掃的區塊'}`
        + `${ig.retracted ? '・偵測到撤稿' : ''}${ig.concern ? '・偵測到關切聲明' : ''}`
        + `${ig.notice ? '・這一頁本身是撤稿公告' : ''}`);
      // 欄位是誰給的。「怎麼沒有摘要」要能當場回答是站台沒給、還是我們讀錯地方。
      const via = Object.entries(r.via || {}).filter(([, v]) => v)
        .map(([k, v]) => `${k}←${v}`);
      if (via.length) lines.push(`來源標籤：${via.join('・')}`);
    }
    if (d.verdict && d.verdict.warn) lines.push(`\n⚠️ ${d.verdict.warn}`);
    if (d.verdict && !d.verdict.ok) lines.push(`\n❌ ${d.verdict.why}`);
    return lines.join('\n');
  }

  $('diag').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'AS_DIAG' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          // 「沒有回應」在這裡幾乎一定是同一個原因，直接講出來，
          // 不要丟一句 Could not establish connection 讓人去查。
          return show($('msg'),
            '這一頁沒有載入 Adapter Sync。可能是：\n'
            + '（1）不是支援的站台——出版社頁面要先在上面「啟用」\n'
            + '（2）剛啟用或剛重載擴充，這個分頁還沒重新整理（按 Cmd+R）', false);
        }
        return show($('msg'), fmtDiag(res), true);
      });
    });
  });

  $('clearSeen').addEventListener('click', () => {
    chrome.storage.local.set({ asSeen: {} }, () => {
      show($('msg'), '去重紀錄已清除（之後收過的會再問一次）', true);
    });
  });

  // ── 寫入紀錄 ─────────────────────────────────────────

  function refreshLog() {
    chrome.storage.local.get(['asLog'], (s) => {
      const log = s.asLog || [];
      const box = $('log');
      box.textContent = '';
      if (!log.length) {
        box.textContent = '（還沒有紀錄）';
        return;
      }
      log.forEach((e) => {
        const div = document.createElement('div');
        div.className = `log-item ${e.ok ? '' : 'bad'}`;
        const t = document.createElement('span');
        t.className = 't';
        const d = new Date(e.time || Date.now());
        t.textContent = `${String(d.getMonth() + 1).padStart(2, '0')}/`
          + `${String(d.getDate()).padStart(2, '0')} `
          + `${String(d.getHours()).padStart(2, '0')}:`
          + `${String(d.getMinutes()).padStart(2, '0')}  `;
        div.appendChild(t);
        div.appendChild(document.createTextNode(e.msg || ''));
        if (e.docUrl) {
          const a = document.createElement('a');
          a.href = e.docUrl;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = ' ↗';
          div.appendChild(a);
        }
        box.appendChild(div);
      });
    });
  }

  load();
  refreshConn();
  refreshHost();
  refreshLog();
})();
