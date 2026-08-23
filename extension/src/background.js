// =====================================================
// Adapter Sync — Background Service Worker
//
// 收到的文獻往兩個目的地寫，而且兩邊互不影響：
//   Drive      給人看的：一篇一份 Doc，開頭是可以直接貼走的引用格式
//   Focus4ai   給檢索用的：Markdown 進知識庫，當場切片建索引
// 任何一邊成功就算成功。Drive 沒設定不該讓知識庫也寫不進去。
//
// 跟 Post Sync 的差別集中在兩件事：
//   一、去重用識別碼不用網址（見 ids.js 開頭那段）
//   二、撤稿要一路帶到檔名、frontmatter、正文與畫面訊息
// =====================================================

// 指紋、檔名、預設值都跟 content script／測試共用同一份。
// 兩邊各寫一份遲早會分岔：畫面顯示 A、實際寫進 B，而且不會有任何錯誤訊息。
importScripts('ids.js', 'naming.js', 'defaults.js');
const ID = self.ADAPTER_SYNC_IDS;
const NAME = self.ADAPTER_SYNC_NAME;
const DEF = self.ADAPTER_SYNC_DEFAULTS;

const DRIVE = 'https://www.googleapis.com/drive/v3';
const DOCS = 'https://docs.googleapis.com/v1';
const SEEN_CAP = 5000;

const MENU_ID = 'adaptersync-capture';

// 通用出版社 adapter 動態注入用的檔案清單，順序等同 manifest 裡那一份
const INJECT_JS = [
  'src/ids.js', 'src/citation.js', 'src/adapters.js', 'src/extract.js', 'src/content.js',
];

// ── 右鍵選單 ─────────────────────────────────────────

function staticPatterns() {
  const cs = chrome.runtime.getManifest().content_scripts || [];
  return cs.flatMap((c) => c.matches || []);
}

// 使用者自己開通的出版社網域也要能用右鍵，不然「啟用了卻只有浮動按鈕」
// 會讓人以為只開通了一半。
async function allPatterns() {
  const extra = await enabledSites();
  return staticPatterns().concat(extra.map((h) => `https://${h}/*`));
}

async function buildMenu() {
  const patterns = await allPatterns();
  // 重複註冊同一個 id 會丟錯，先清乾淨再建
  await new Promise((r) => chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    r();
  }));
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '📄 收這篇文獻',
    contexts: ['page', 'selection', 'link'],
    documentUrlPatterns: patterns,
  }, () => { void chrome.runtime.lastError; });
}

chrome.runtime.onInstalled.addListener((d) => {
  buildMenu();
  restoreSiteScripts();
  if (d.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});

// service worker 睡醒後選單還在（Chrome 自己持久化），但瀏覽器重開、
// 擴充重載這些時機要重建一次，不然選單會憑空消失
chrome.runtime.onStartup.addListener(() => {
  buildMenu();
  restoreSiteScripts();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || info.menuItemId !== MENU_ID) return;
  chrome.tabs.sendMessage(tab.id, { type: 'AS_CONTEXT' }, () => {
    void chrome.runtime.lastError; // 這個分頁沒有 content script 就算了
  });
});

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd !== 'capture-paper') return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'AS_HOTKEY' }, () => {
      void chrome.runtime.lastError;
    });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'AS_CAPTURE') {
    handleCapture(msg.payload, !!msg.force, sender.tab && sender.tab.id).then(sendResponse);
    return true;
  }
  if (msg.type === 'AS_CONNECT') {
    getToken(true)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: errMsg(e) }));
    return true;
  }
  if (msg.type === 'AS_F4_TEST') {
    testFocus4ai(msg.base).then(sendResponse);
    return true;
  }
  if (msg.type === 'AS_STATUS') {
    if (!clientIdSet()) {
      sendResponse({ connected: false, reason: 'no_client_id' });
      return true;
    }
    getToken(false)
      .then(() => sendResponse({ connected: true }))
      .catch(() => sendResponse({ connected: false }));
    return true;
  }
  if (msg.type === 'AS_SITE_ENABLE') {
    enableSite(msg.host).then(sendResponse).catch((e) => sendResponse({ ok: false, error: errMsg(e) }));
    return true;
  }
  if (msg.type === 'AS_SITE_DISABLE') {
    disableSite(msg.host).then(sendResponse).catch((e) => sendResponse({ ok: false, error: errMsg(e) }));
    return true;
  }
  if (msg.type === 'AS_SITE_LIST') {
    enabledSites().then((sites) => sendResponse({ sites }));
    return true;
  }
  return false;
});

// ── 通用出版社：使用者自己開通的網域 ─────────────────
//
// 文獻站台是列不完的（Nature、NEJM、Lancet、Elsevier、Springer、Wiley、
// Frontiers、MDPI、各國期刊、機構典藏…）。預先在 manifest 裡要
// https://*/* 的權限，等於宣告「我可以讀你看的每一個網頁」，
// 對使用者不誠實，商店審查也會直接卡住。
//
// 所以改成：使用者在某個出版社頁面上按「在這個站台啟用」，
// 當場向 Chrome 要那一個網域的權限，再動態註冊 content script。
// 權限與注入是**兩件事**，只要權限不註冊的話下次開新分頁就沒有按鈕。

async function enabledSites() {
  const { asSites = [] } = await chrome.storage.local.get(['asSites']);
  return Array.isArray(asSites) ? asSites : [];
}

function scriptIdFor(host) {
  return `as-site-${host.replace(/[^a-z0-9]/gi, '-')}`;
}

async function enableSite(rawHost) {
  const host = String(rawHost || '').toLowerCase().replace(/^www\./, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
    return { ok: false, error: `看不懂這個網域：${rawHost}` };
  }
  // www 與裸網域各站台混用，兩個都要
  const origins = [`https://${host}/*`, `https://www.${host}/*`];
  const granted = await chrome.permissions.request({ origins });
  if (!granted) return { ok: false, error: '你取消了授權，這個站台沒有啟用' };

  await registerSite(host);
  const sites = await enabledSites();
  if (!sites.includes(host)) {
    await chrome.storage.local.set({ asSites: sites.concat([host]) });
  }
  await buildMenu();
  return { ok: true, host };
}

async function registerSite(host) {
  const id = scriptIdFor(host);
  const matches = [`https://${host}/*`, `https://www.${host}/*`];
  // 重複註冊同一個 id 會丟錯，先移除。移除不存在的也會丟錯，所以要吞掉。
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch (_) { /* 本來就沒註冊過 */ }
  await chrome.scripting.registerContentScripts([{
    id,
    matches,
    js: INJECT_JS,
    css: ['src/toast.css'],
    runAt: 'document_idle',
  }]);
}

async function disableSite(rawHost) {
  const host = String(rawHost || '').toLowerCase().replace(/^www\./, '');
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [scriptIdFor(host)] });
  } catch (_) { /* 沒註冊過 */ }
  try {
    await chrome.permissions.remove({
      origins: [`https://${host}/*`, `https://www.${host}/*`],
    });
  } catch (_) { /* 使用者可能已經在 Chrome 設定裡收回了 */ }
  const sites = (await enabledSites()).filter((h) => h !== host);
  await chrome.storage.local.set({ asSites: sites });
  await buildMenu();
  return { ok: true };
}

// 動態註冊的 content script 在擴充更新後會消失，而使用者不會知道
// ——他只會發現「昨天還好好的站台今天沒有按鈕了」。開機補註冊一次。
// 這跟「檔案監看器開機要先補作業，不能假設自己沒漏看過」是同一件事。
async function restoreSiteScripts() {
  const sites = await enabledSites();
  for (const host of sites) {
    // 使用者可能在 Chrome 的設定裡收回了權限。沒權限還註冊會丟錯，
    // 而且會讓後面的站台整批不註冊。
    let has = false;
    try {
      has = await chrome.permissions.contains({ origins: [`https://${host}/*`] });
    } catch (_) { has = false; }
    if (!has) continue;
    try {
      await registerSite(host);
    } catch (_) { /* 這個站台失敗不能拖垮其他站台 */ }
  }
}

// ── 逾時與錯誤 ───────────────────────────────────────
// 每一個等待都要有盡頭。沒有逾時的等待，使用者看到的是永遠轉圈，
// 而轉圈不帶任何資訊，他只能猜「是慢還是壞了」。

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what}逾時（${Math.round(ms / 1000)} 秒沒有回應）`)), ms);
    }),
  ]);
}

async function fetchT(url, opts = {}, ms = 45000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`連線逾時（${Math.round(ms / 1000)} 秒）：${new URL(url).host}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 有些例外的 str() 就是空字串，畫面上只剩「失敗：」，等於沒有訊息
function errMsg(e) {
  return (e && e.message) || (e && e.constructor && e.constructor.name) || '未知錯誤';
}

// ── OAuth ────────────────────────────────────────────

function clientIdSet() {
  const m = chrome.runtime.getManifest();
  const id = (m.oauth2 && m.oauth2.client_id) || '';
  return !!id && !id.startsWith('REPLACE_ME');
}

function getToken(interactive) {
  if (!clientIdSet()) {
    return Promise.reject(new Error(
      '尚未設定 Google OAuth client_id。照 README 的「OAuth 設定」做一次，'
      + '把 client_id 填進 manifest.json；或先關掉 Drive、只用 Focus4ai 知識庫。'
    ));
  }
  const p = new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(
          (chrome.runtime.lastError && chrome.runtime.lastError.message) || '尚未連接 Google'
        ));
      } else {
        resolve(token);
      }
    });
  });
  // 授權視窗開了沒人理，callback 就永遠不會回來
  return interactive ? withTimeout(p, 120000, 'Google 授權') : p;
}

async function withAuthRetry(fn) {
  let token = await getToken(true);
  try {
    return await fn(token);
  } catch (e) {
    if (!e.auth) throw e;
    await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
    token = await getToken(true);
    return fn(token);
  }
}

// 非 2xx 一律丟錯並帶上後端原因。共用層把錯誤吞掉的話，
// 每個呼叫端都得自己記得檢查，而那種事一定會漏。
async function api(token, method, url, body) {
  const res = await fetchT(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    const e = new Error('AUTH_EXPIRED');
    e.auth = true;
    throw e;
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = (j.error && j.error.message) || '';
    } catch (_) { /* 非 JSON 錯誤內文 */ }
    throw new Error(`Google API ${res.status}：${detail || res.statusText || '未知錯誤'}`);
  }
  return res.status === 204 ? null : res.json();
}

// ── 去重 ─────────────────────────────────────────────
// 指紋算在 ids.js 裡，跟 content script 與測試共用同一份。

async function checkSeen(key) {
  if (!key) return null;
  const { asSeen = {} } = await chrome.storage.local.get(['asSeen']);
  return asSeen[key] || null;
}

async function markSeen(key, entry) {
  if (!key) return;
  const { asSeen = {} } = await chrome.storage.local.get(['asSeen']);
  asSeen[key] = entry;
  // 無限長大的 map 遲早把 storage 塞爆，砍掉最舊的那批
  const keys = Object.keys(asSeen);
  if (keys.length > SEEN_CAP) {
    keys.sort((a, b) => (asSeen[a].t || 0) - (asSeen[b].t || 0));
    keys.slice(0, keys.length - SEEN_CAP).forEach((k) => delete asSeen[k]);
  }
  await chrome.storage.local.set({ asSeen });
}

// ── 主流程 ───────────────────────────────────────────

function progress(tabId, text) {
  if (tabId == null) return;
  try {
    chrome.tabs.sendMessage(tabId, { type: 'AS_PROGRESS', text }, () => {
      void chrome.runtime.lastError; // 分頁關了就算了
    });
  } catch (_) { /* 分頁不在了 */ }
}

async function handleCapture(p, force, tabId) {
  const key = ID.fingerprint(p);
  if (!force) {
    const prev = await checkSeen(key);
    if (prev) return { ok: false, dup: true, prev };
  }

  const s = await chrome.storage.sync.get(['driveEnabled', 'f4Enabled', 'f4Base']);
  const wantDrive = s.driveEnabled !== false && clientIdSet();
  const wantF4 = !!s.f4Enabled && !!s.f4Base;

  if (!wantDrive && !wantF4) {
    const m = 'Drive 與 Focus4ai 都沒有啟用，沒有地方可以寫。請點擴充圖示設定其中一個。';
    await logEntry({ ok: false, msg: m, time: Date.now() });
    badge(false);
    return { ok: false, error: m };
  }

  // 兩個目的地各自獨立：一邊掛了不能把另一邊也拖下水
  let drive = null;
  let driveError = '';
  if (wantDrive) {
    try {
      progress(tabId, '確認 Google 授權…');
      drive = await withAuthRetry((token) => writeDrive(token, p, tabId));
    } catch (e) {
      driveError = errMsg(e);
    }
  }

  let f4 = null;
  let f4Error = '';
  if (wantF4) {
    try {
      progress(tabId, '同步到知識庫…');
      f4 = await syncToFocus4ai(p, key);
    } catch (e) {
      f4Error = errMsg(e);
    }
  }

  const ok = !!(drive || f4);
  if (ok) {
    await markSeen(key, {
      t: Date.now(),
      when: dateTimeStr(),
      docName: drive ? drive.docName : NAME.docStem(p),
      docUrl: drive ? drive.docUrl : '',
      // 同一篇再遇到時要講得出「你上次收的是哪個版本」
      version: p.arxivVersion || '',
      title: (p.title || '').slice(0, 120),
      // 記著上次收到的是不是截斷版。使用者登入後再收一次時，
      // 畫面才講得出「上次那份是沒登入拿到的，這次是完整的」。
      restricted: !!(p.access && p.access.restricted),
      absLen: (p.abstract || '').length,
    });
  }

  // 「沒提到」會被當成「有做」。沒啟用的目的地也要明講，
  // 不然使用者以為兩邊都寫了，過很久才發現知識庫是空的。
  const bits = [];
  if (drive) bits.push(`Drive「${drive.docName}」`);
  else if (driveError) bits.push(`Drive 失敗：${driveError}`);
  else bits.push('Drive 未啟用');

  if (f4) bits.push(`知識庫 ${f4.chunks} 片`);
  else if (f4Error) bits.push(`知識庫失敗：${f4Error}`);
  else bits.push('知識庫未啟用');

  // 撤稿要放在最前面。訊息是使用者唯一會看的地方，
  // 埋在第三行等於沒說。
  const alerts = [];
  if (p.integrity && p.integrity.retracted && !p.integrity.notice) alerts.push('⚠️ 這篇已撤稿');
  if (p.integrity && p.integrity.concern) alerts.push('⚠️ 期刊已對這篇表達關切');
  if (p.preprint) alerts.push('預印本・未經同儕審查');
  // 沒登入拿到的截斷版是「安靜地少收」，一定要講。而且要講出怎麼補救，
  // 只說「可能是截斷版」等於把問題丟回去給使用者自己想。
  if (p.access && p.access.restricted) {
    alerts.push('⚠️ 摘要可能是截斷版（這一頁看起來需要登入）'
      + '；登入後重新整理再收一次會蓋成完整版');
  }
  if (!p.hasStrongId) alerts.push('沒有 DOI／PMID，去重只能靠標題');

  await logEntry({
    ok,
    msg: `${NAME.docStem(p)}：${bits.join('・')}`,
    docUrl: drive ? drive.docUrl : '',
    time: Date.now(),
  });
  badge(ok);

  // 訊息在這裡組好，content script 只負責顯示。
  // 兩邊各拼一份的話，畫面說的跟紀錄寫的遲早會不一樣。
  if (!ok) return { ok: false, error: bits.join('・'), alerts };
  return { ok: true, bits, alerts, drive, driveError, f4, f4Error };
}

// ── Drive：一篇一份 Doc ───────────────────────────────

async function writeDrive(token, p, tabId) {
  progress(tabId, '確認 Drive 資料夾…');
  const folderId = await ensureFolder(token);
  progress(tabId, '建立這篇的 Doc…');
  const doc = await createPaperDoc(token, folderId, p);
  return {
    docName: doc.name,
    docUrl: `https://docs.google.com/document/d/${doc.docId}/edit`,
  };
}

async function ensureFolder(token) {
  const s = await chrome.storage.sync.get(['driveFolder']);
  const { asFolders = {} } = await chrome.storage.local.get(['asFolders']);
  const name = String(s.driveFolder || DEF.driveFolder).trim() || DEF.driveFolder;

  const cached = asFolders[name];
  if (cached) {
    try {
      const f = await api(token, 'GET', `${DRIVE}/files/${cached}?fields=id,trashed`);
      if (f && !f.trashed) return cached;
    } catch (e) {
      if (e.auth) throw e; // 其他錯誤 → 資料夾不見了，往下重建
    }
  }
  const f = await api(token, 'POST', `${DRIVE}/files?fields=id`, {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  });
  asFolders[name] = f.id;
  await chrome.storage.local.set({ asFolders });
  return f.id;
}

async function createPaperDoc(token, folderId, p) {
  const docName = NAME.docStem(p);
  const created = await api(token, 'POST', `${DRIVE}/files?fields=id`, {
    name: docName,
    mimeType: 'application/vnd.google-apps.document',
    parents: [folderId],
  });

  const title = `${p.title || '未命名文獻'}\n`;

  // 警告放在標題正下方。放在文件末尾等於沒放——沒有人會捲到最後
  // 才發現這篇被撤稿了。
  let warn = '';
  if (p.integrity && p.integrity.retracted && !p.integrity.notice) {
    warn += '⚠️ 這篇論文已被撤稿，不應作為臨床決策依據。\n';
    if (p.integrity.quote) warn += `偵測到的原文：${p.integrity.quote}\n`;
  }
  if (p.integrity && p.integrity.concern) {
    warn += '⚠️ 期刊已對這篇發出關切聲明（Expression of Concern）。\n';
  }
  if (p.preprint) {
    warn += '⚠️ 這是預印本，未經同儕審查。\n';
  }
  if (p.access && p.access.restricted) {
    warn += '⚠️ 這份摘要可能是截斷版：收錄當下該頁面看起來需要登入。'
      + '用機構帳號登入後重新整理，再收一次即可取得完整摘要。\n';
  }
  if (warn) warn += '\n';

  const cite = `${NAME.citation(p)}\n\n`;
  const link = `${p.permalink || p.pageUrl}\n\n`;

  const parts = [];
  // 研究設計排在摘要**前面**。臨床評讀第一件事就是問「這是 RCT 還是
  // 個案報告」，排在後面等於要人先讀完摘要才知道要不要認真讀。
  if (p.publicationTypes && p.publicationTypes.length) {
    parts.push(`研究設計\n${p.publicationTypes.join('、')}\n`);
  }
  if (p.abstract) parts.push(`摘要\n${p.abstract}\n`);
  if (p.meshTerms && p.meshTerms.length) parts.push(`MeSH terms\n${p.meshTerms.join('、')}\n`);
  if (p.keywords && p.keywords.length) parts.push(`關鍵字\n${p.keywords.join('、')}\n`);
  if (!p.abstract) {
    parts.push('（這一頁抓不到摘要。可能是站台沒有提供，或需要登入才看得到。）\n');
  }
  parts.push(`\n收錄於 ${dateTimeStr()}・來源 ${p.sourceLabel}\n`);

  const text = title + warn + cite + link + parts.join('\n');
  const linkStart = 1 + title.length + warn.length + cite.length;

  const requests = [
    { insertText: { location: { index: 1 }, text } },
    {
      updateParagraphStyle: {
        range: { startIndex: 1, endIndex: 1 + title.length },
        paragraphStyle: { namedStyleType: 'TITLE' },
        fields: 'namedStyleType',
      },
    },
  ];
  const target = p.permalink || p.pageUrl;
  if (target) {
    requests.push({
      updateTextStyle: {
        range: { startIndex: linkStart, endIndex: linkStart + target.length },
        textStyle: { link: { url: target } },
        fields: 'link',
      },
    });
  }
  await api(token, 'POST', `${DOCS}/documents/${created.id}:batchUpdate`, { requests });
  return { docId: created.id, name: docName };
}

// ── Focus4ai 知識庫 ──────────────────────────────────

function isJson(res) {
  return /application\/json/i.test(res.headers.get('content-type') || '');
}

function mdEscape(s) {
  return String(s || '').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

function yamlList(arr) {
  return `[${(arr || []).map((s) => `"${mdEscape(s)}"`).join(', ')}]`;
}

// 沒有 host 權限的話瀏覽器只會丟一句 Failed to fetch，
// 那句話對使用者完全沒有資訊。先問清楚再說。
async function ensureOrigin(base) {
  let origin;
  try {
    origin = new URL(base).origin;
  } catch (_) {
    throw new Error(`知識庫網址看不懂：${base}`);
  }
  const has = await chrome.permissions.contains({ origins: [`${origin}/*`] });
  if (has) return;
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) throw new Error(`沒有 ${origin} 的存取權限，無法寫入知識庫`);
}

async function readDoc(base, path) {
  const url = `${base}/api/doc?path=${encodeURIComponent(path)}`;
  try {
    const res = await fetchT(url, { credentials: 'include' }, 20000);
    if (!res.ok || !isJson(res)) return null;
    const j = await res.json();
    return (j && j.content) || null;
  } catch (_) {
    return null;
  }
}

async function testFocus4ai(rawBase) {
  const base = String(rawBase || '').trim().replace(/\/+$/, '');
  if (!base) return { ok: false, error: '請先填知識庫網址' };
  if (/^https?:\/\/(www\.)?focus4ai\.com/i.test(base)) {
    return {
      ok: false,
      error: 'focus4ai.com 是官網、沒有 API。請填站台位址，線上站台是 https://app.focus4ai.com',
    };
  }
  try {
    await ensureOrigin(base);
    const res = await fetchT(`${base}/api/doc?path=${encodeURIComponent('__adaptersync_probe__.md')}`, {
      credentials: 'include',
    }, 20000);
    // 被導到登入頁時會拿到 200 + HTML。不擋的話會謊報連線成功。
    if (!isJson(res)) {
      return { ok: false, error: '回應不是 JSON，通常代表被導到登入頁；請先在瀏覽器登入該站台再試' };
    }
    // 404 是對的：探測用的檔案本來就不存在，能回 404 就代表 API 通了
    if (res.ok || res.status === 404) return { ok: true };
    return { ok: false, error: `站台回 ${res.status}` };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

async function syncToFocus4ai(p, key) {
  const s = await chrome.storage.sync.get(['f4Base', 'f4Folder', 'f4Private']);
  const base = String(s.f4Base).replace(/\/+$/, '');
  await ensureOrigin(base);
  const folder = String(s.f4Folder || DEF.f4Folder).replace(/^\/+|\/+$/g, '');
  const stem = NAME.docStem(p);

  let path = `${folder}/${stem}.md`;
  const existing = await readDoc(base, path);
  // 同名不同篇（同年同姓同標題前綴，在文獻裡真的會發生）要另開一個檔，
  // 不能直接覆蓋掉別人的那一份。
  if (existing && p.permalink && !existing.includes(p.permalink)) {
    path = `${folder}/${stem}_${String(key).slice(-4)}.md`;
  }
  const url = `${base}/api/doc?path=${encodeURIComponent(path)}`;

  const stamp = dateTimeStr();
  const retracted = !!(p.integrity && p.integrity.retracted && !p.integrity.notice);
  const concern = !!(p.integrity && p.integrity.concern);

  const tags = ['adapter-sync', '文獻'];
  if (retracted) tags.push('已撤稿');
  if (concern) tags.push('關切聲明');
  if (p.preprint) tags.push('預印本');
  if (p.access && p.access.restricted) tags.push('摘要待補');

  const fm = [
    '---',
    `title: "${mdEscape(p.title || '未命名文獻')}"`,
    `authors: ${yamlList(p.authors)}`,
    ...(p.year ? [`year: ${p.year}`] : []),
    ...(p.journal ? [`journal: "${mdEscape(p.journal)}"`] : []),
    ...(p.doi ? [`doi: "${p.doi}"`] : []),
    ...(p.pmid ? [`pmid: "${p.pmid}"`] : []),
    ...(p.pmcid ? [`pmcid: "${p.pmcid}"`] : []),
    ...(p.arxivId ? [`arxiv: "${p.arxivId}${p.arxivVersion || ''}"`] : []),
    ...(p.publicationTypes && p.publicationTypes.length
      ? [`publication_types: ${yamlList(p.publicationTypes)}`] : []),
    `source: "${p.permalink || p.pageUrl}"`,
    `adapter: ${p.source}`,
    `captured: ${stamp}`,
    ...(p.preprint ? ['preprint: true'] : []),
    // 只在**偵測到**的時候寫。沒寫 ≠ 這篇沒問題——
    // 撤稿標記本來就會落後聲明幾天到幾週，我們沒有資格宣稱一篇論文乾淨。
    ...(retracted ? ['retracted: true'] : []),
    ...(concern ? ['concern: true'] : []),
    // 只在偵測到的時候寫。跟撤稿同一個原則：沒寫 ≠ 保證完整。
    ...(p.access && p.access.restricted ? ['abstract_truncated: true'] : []),
    ...(p.integrity && p.integrity.scanned ? [`integrity_scanned: ${p.source}`] : []),
    ...(s.f4Private ? ['privacy: local_only'] : []),
    `tags: [${tags.join(', ')}]`,
    '---',
    '',
  ];

  const body = [];
  const banner = [];
  if (retracted) {
    banner.push('> ⚠️ **這篇論文已被撤稿，不應作為臨床決策依據。**');
    if (p.integrity.quote) banner.push(`> 偵測到的原文：${p.integrity.quote}`);
  }
  if (concern) banner.push('> ⚠️ **期刊已對這篇發出關切聲明（Expression of Concern）。**');
  if (p.preprint) banner.push('> ⚠️ **這是預印本，未經同儕審查。**');
  if (p.access && p.access.restricted) {
    banner.push('> ⚠️ **這份摘要可能是截斷版**：收錄當下該頁面看起來需要登入。'
      + '登入後重新整理再收一次即可蓋成完整版。');
  }

  body.push(`# ${retracted ? '⚠️ 已撤稿：' : ''}${p.title || '未命名文獻'}`, '');
  if (banner.length) body.push(...banner, '');
  body.push(NAME.provenanceLine(p), '');
  body.push(`**引用**：${NAME.citation(p)}`, '');
  body.push(`- 原文：${p.permalink || p.pageUrl}`);
  if (p.pdfUrl) body.push(`- 全文 PDF：${p.pdfUrl}`);
  body.push(`- 收錄：${stamp}・來源 ${p.sourceLabel}`, '');
  if (p.publicationTypes && p.publicationTypes.length) {
    body.push(`**研究設計**：${p.publicationTypes.join('、')}`, '');
  }

  if (p.abstract) {
    // 標題裡也帶一次警告。知識庫是切片檢索的，第一片以外的片段
    // 拿不到上面那個 banner，而標題通常會跟著切片一起走。
    const absFlags = [
      retracted ? '⚠️ 本文已撤稿' : '',
      p.access && p.access.restricted ? '⚠️ 可能是截斷版' : '',
    ].filter(Boolean);
    body.push(`## 摘要${absFlags.length ? `（${absFlags.join('・')}）` : ''}`, '', p.abstract, '');
  } else {
    body.push('## 摘要', '', '（這一頁抓不到摘要，可能是站台沒有提供，或需要登入才看得到。）', '');
  }
  if (p.meshTerms && p.meshTerms.length) {
    body.push('## MeSH terms', '', p.meshTerms.join('、'), '');
  }
  if (p.keywords && p.keywords.length) {
    body.push('## 關鍵字', '', p.keywords.join('、'), '');
  }

  const out = fm.concat(body).join('\n');

  const res = await fetchT(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // 站台有登入牆時要帶著使用者自己的 session
    body: JSON.stringify({ content: out }),
  }, 30000);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch (_) { /* 非 JSON */ }
    throw new Error(`Focus4ai ${res.status}：${detail || res.statusText || '寫入失敗'}`);
  }
  // 被導到登入頁時會拿到 200 + HTML。不擋的話會謊報成功，
  // 而使用者要過很久才發現知識庫裡什麼都沒有。
  if (!isJson(res)) {
    throw new Error('回應不是 JSON，通常代表被導到登入頁；請先在瀏覽器登入該站台再試');
  }
  const j = await res.json();
  return { path, chunks: j.chunks };
}

// ── 工具 ─────────────────────────────────────────────

function two(n) { return String(n).padStart(2, '0'); }

function dateTimeStr(d = new Date()) {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} `
    + `${two(d.getHours())}:${two(d.getMinutes())}`;
}

function badge(ok) {
  try {
    chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
    chrome.action.setBadgeBackgroundColor({ color: ok ? '#10704a' : '#dc2626' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
  } catch (_) { /* 沒有 action 就算了 */ }
}

async function logEntry(entry) {
  const { asLog = [] } = await chrome.storage.local.get(['asLog']);
  asLog.unshift(entry);
  await chrome.storage.local.set({ asLog: asLog.slice(0, 40) });
}
