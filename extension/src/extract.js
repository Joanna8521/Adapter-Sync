// =====================================================
// Adapter Sync — 抽取層
//
// 從 content.js 抽出來的理由跟 Post Sync 一樣：這是最會壞的地方，
// 而且「收到半篇」不會有任何錯誤訊息。抽成純函式才測得到
// （tests/run.html）。這一層完全不碰 chrome.*、不碰網路。
//
// 但這裡的「壞」跟社群不同。社群是平台改版把選擇器弄空；文獻這邊
// meta 標籤很穩，真正會壞的是三件別的事：
//
//   一、同一篇從不同網址收兩份    → ids.js 的指紋負責
//   二、撤稿的論文安靜地進了知識庫  → integrity 負責
//   三、作者群被壓成單一作者      → citation.js 的 authors() 負責
//
// 三件都是「壞了完全沒有畫面告訴你」的類型，所以三件都有測試釘著。
// =====================================================

(function () {
  'use strict';

  const NS = self.ADAPTER_SYNC;
  const C = self.ADAPTER_SYNC_CITATION;
  const ID = self.ADAPTER_SYNC_IDS;

  // 介面上的按鈕字，不是內容。文獻站台比社群少很多，但摘要區塊裡
  // 常常混著「Copy」「Cite」「Share」「PDF」這一列。
  const CHROME_WORDS = new RegExp(`^(${[
    'Copy', 'Cite', 'Share', 'Save', 'Print', 'Download', 'PDF', 'Full text',
    'Permalink', 'Abstract', 'Keywords', 'MeSH terms', 'MeSH Terms',
    '複製', '引用', '分享', '儲存', '列印', '下載', '全文', '摘要', '關鍵字',
  ].join('|')})\\s*[:：]?$`, 'i');

  // 語言切換器要排除。多語期刊（Cochrane、部分歐洲期刊）會在摘要區塊的
  // 標題列放一個「available in English / Español / …」，混進來就會變成
  // 每一篇 Cochrane 摘要的第一行都是「available in」。
  const EXCLUDE = 'script, style, noscript, svg, button, nav, form,'
    + ' [role="button"], [role="navigation"], [aria-hidden="true"],'
    + ' [class*="language" i], [class*="translation" i],'
    + ' .adaptersync-toast, .adaptersync-btn';

  // 區塊感知的文字抽取。
  //
  // 不能用 innerText：它需要版面資訊，而測試頁裡的 fixture 常常是
  // 沒有掛進 document 的節點，那時候 innerText 會退化成 textContent，
  // 段落全部黏成一行——結構式摘要（Background／Methods／Results）
  // 被壓成一段就失去它最有用的東西，而且測試會看起來是綠的。
  function blockText(root) {
    if (!root) return '';
    const BLOCK = /^(P|DIV|SECTION|ARTICLE|LI|UL|OL|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|TR|DD|DT|FIGCAPTION|TABLE)$/;
    const out = [];
    let buf = '';
    const flush = () => {
      const t = C.clean(buf);
      if (t && !CHROME_WORDS.test(t)) out.push(t);
      buf = '';
    };
    (function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) { buf += child.nodeValue; continue; }
        if (child.nodeType !== 1) continue;
        try {
          if (child.matches(EXCLUDE)) continue;
        } catch (_) { /* 選擇器對這個節點無效就當它沒被排除 */ }
        if (child.tagName === 'BR') { flush(); continue; }
        const isBlock = BLOCK.test(child.tagName);
        if (isBlock) flush();
        walk(child);
        if (isBlock) flush();
      }
    })(root);
    flush();
    return out.join('\n');
  }

  // 摘要的合理上限。真的摘要大概 150～4500 字，Cochrane 的系統性回顧
  // 最長也才 4300 出頭。抓到幾萬字就一定是**抓錯容器**了 ——
  // MDPI 的 `#abstract` 其實是整頁的外層 div（四萬多字，連工具列、
  // 參考文獻、頁尾全在裡面），沒有上限的話會整頁塞進知識庫。
  const ABSTRACT_MAX = 12000;

  // 依序試多個選擇器，回第一個「真的有內容」的。
  // 判準用字數不是「有沒有這個元素」——容器存在但被清空是常見情形
  // （站台改版留下空殼），用存在與否判會安靜地收到一份空的。
  // 上限同理：大得不合理就是抓錯了，換下一個選擇器，不要硬收。
  function firstBlock(doc, selectors, minLen = 20, maxLen = Infinity) {
    for (const sel of (selectors || [])) {
      let nodes;
      try {
        nodes = doc.querySelectorAll(sel);
      } catch (_) {
        continue;
      }
      for (const el of nodes) {
        const t = blockText(el);
        if (t.length >= minLen && t.length <= maxLen) return { text: t, from: sel };
      }
    }
    return { text: '', from: '' };
  }

  // 一個選擇器命中幾顆元素，就是幾個詞。
  //
  // 這條路是為 PubMed 開的，但它比「掃一整塊再切分隔符」通用得多：
  // 只要站台把每一個詞放在自己的元素裡（多數站台都是），就不用去猜
  // 分隔符是逗號還是分號，也不會把詞裡面本來就有的逗號切開。
  function itemTexts(doc, selectors, cap = 60) {
    for (const sel of (selectors || [])) {
      let nodes;
      try {
        nodes = doc.querySelectorAll(sel);
      } catch (_) {
        continue;
      }
      if (!nodes.length) continue;
      const out = [];
      for (const el of nodes) {
        // 不能用 blockText：這裡的元素常常就是 button（被 EXCLUDE 排掉），
        // 而我們要的正是它自己的文字。
        const t = C.clean(el.textContent);
        if (t && t.length <= 80 && !CHROME_WORDS.test(t) && !out.includes(t)) out.push(t);
        if (out.length >= cap) break;
      }
      if (out.length) return { items: out, from: sel };
    }
    return { items: [], from: '' };
  }

  // meta 的 content 屬性裡塞整段 HTML。
  //
  // BMJ 就是這樣：`citation_abstract` 的內容是
  //   `<h3>Abstract</h3> <h3>Objective</h3> <p>To review and appraise…`
  // 不處理的話那些標籤會**原樣**寫進 Doc 與知識庫的切片。而且結構式摘要的
  // 分段正好編碼在那些標籤裡，當成純文字收就變成黏成一整段。
  //
  // DOMParser 解析出來的文件是惰性的（不執行 script、不載入資源），
  // 拿來當 HTML 轉純文字的工具是安全的。
  function metaHtmlToText(s) {
    const v = String(s || '');
    if (!/<\/?(p|h[1-6]|br|div|section|li|ul|ol)\b/i.test(v)) return v;
    try {
      const d = new DOMParser().parseFromString(`<body>${v}</body>`, 'text/html');
      return blockText(d.body);
    } catch (_) {
      // DOMParser 不在（例如將來被搬進 service worker）就退回粗略剝標籤。
      // 剝不乾淨好過把一堆 <h3> 寫進知識庫。
      return v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  // 關鍵字容器裡裝的是「Keywords: a, b, c」這種一整串。
  //
  // 這裡**可以**用逗號切，而 MeSH 那條路不行 —— 差別在於容器裡裝的是
  // 作者自己寫的清單（逗號就是分隔符），而 MeSH 是倒置的控制詞彙
  // （逗號是詞彙的一部分）。兩條路分開，兩邊才都對。
  //
  // 不切的話會發生一件很難發現的事：整串一百多字，被「單一詞不超過 80 字」
  // 的防呆濾掉，於是關鍵字**整批安靜消失**，畫面上什麼都不會說。
  function splitKeywords(text) {
    if (!text) return [];
    return String(text)
      .replace(/^\s*(Keywords?|Key words|Index terms|關鍵字|關鍵詞)\s*[:：]\s*/i, '')
      .split(/\n|\s*[;,]\s*/)
      .map(C.clean)
      .filter((s) => s && s.length <= 80 && !CHROME_WORDS.test(s));
  }

  // ── 撤稿與關切聲明 ────────────────────────────────────
  //
  // 這一段是整支擴充最重要的三十行。
  //
  // 設計上刻意做兩件事：
  //   一、掃描範圍**限縮**在文章前段與聲明區塊。不限縮的話，
  //       「參考文獻裡引用了一篇撤稿論文」會被誤判成「這篇被撤稿」，
  //       而狼來了喊多了就沒有人看警告了。
  //   二、偵測不到時**不宣稱乾淨**。回傳的是 scanned（掃過了嗎）
  //       與 retracted（掃到了嗎），沒有第三個值叫「確認沒問題」。
  //       PubMed 的撤稿標記本來就會落後聲明幾天到幾週，
  //       我們沒有資格說一篇論文沒問題。
  function detectIntegrity(ad, doc, title) {
    const scopes = (ad && ad.alertScope) || [];
    let scanned = false;
    let hay = '';
    for (const sel of scopes) {
      let nodes;
      try {
        nodes = doc.querySelectorAll(sel);
      } catch (_) {
        continue;
      }
      for (const el of nodes) {
        scanned = true;
        // SVG 的 <title> 會被 textContent 算進去（Post Sync 因為這件事
        // 差點幫使用者按到檢舉）。這裡不點東西，但誤判一樣要避免。
        const clone = el.cloneNode(true);
        // svg 的 <title> 會被 textContent 算進去；
        // **下拉選單的 <option> 也會** —— MDPI 的頁首有一個文章類型
        // 篩選器，裡面有一個 `<option>Expression of Concern</option>`，
        // 於是每一篇 MDPI 論文都被標成「期刊已表達關切」。
        // 誤判的代價跟漏判一樣真實：狼來了喊多了就沒有人看警告了。
        clone.querySelectorAll(
          'svg, select, option, datalist, nav, script, style,'
          + ' [role="listbox"], [role="menu"], [role="navigation"]',
        ).forEach((x) => x.remove());
        hay += ` ${clone.textContent || ''}`;
        if (hay.length > 20000) break;
      }
      if (hay.length > 20000) break;
    }

    const t = String(title || '');
    const retracted = NS.RETRACTED.test(hay) || NS.TITLE_RETRACTED.test(t);
    const concern = NS.CONCERN.test(hay);
    // 撤稿聲明本身不是「被撤稿的論文」。把公告標成被撤稿是錯的。
    const notice = NS.IS_NOTICE.test(hay) || /^\s*Retraction:/i.test(t);

    // 命中的那一句要留著給使用者看。只說「這篇被撤稿了」而不給出處，
    // 使用者無從判斷是真的還是我們誤判。
    //
    // 逐條試而不是用整條 alternation 去比對：整條比對取的是「字串裡最早
    // 出現的那一個」，而 PMC 的標題本身就以「RETRACTED:」開頭，
    // 於是引文變成一整條標題加作者單位；同一頁下面明明有乾淨的
    // 「This article has been retracted.」。片語清單由具體到籠統排，
    // 第一個命中的才是最好的那一句。
    const pick = (phrases) => {
      for (const p of phrases) {
        const m = hay.match(new RegExp(`[^.。\\n]{0,120}${p}[^.。\\n]{0,160}`, 'i'));
        if (m) return C.clean(m[0]);
      }
      return '';
    };
    let quote = '';
    // 撤稿比關切嚴重。兩個都命中時（真的會發生：先發關切、後撤稿）
    // 要顯示撤稿那一句，不能讓比較輕的那一句蓋過去。
    if (retracted) quote = pick(NS.RETRACTED_PHRASES);
    if (!quote && concern) quote = pick(NS.CONCERN_PHRASES);

    return { scanned, retracted, concern, notice, quote };
  }

  // ── 訂閱牆：我是不是只看到半篇？ ──────────────────────
  //
  // 擴充讀的是使用者眼睛看到的那一頁。他用機構帳號登入之後，頁面上有
  // 完整摘要、我們就收得到完整摘要 —— 這一段**完全不碰帳密**，
  // 不問、不存、不代填，登入是他自己在瀏覽器裡做的事。
  //
  // 要防的是相反的情形：**忘了登入、或 session 過期**。那時候頁面上
  // 只剩一段招牌文案，而擴充會照收不誤、畫面上不會有任何提示，
  // 三個月後翻知識庫才發現那一篇只有兩行字。
  //
  // 判準刻意很窄，因為誤報的成本很高：
  //   一、只有摘要**短得可疑**才去找。全文在付費牆後面是常態，
  //       而我們本來就只收摘要，那不是問題。
  //   二、只在摘要容器與訂閱牆區塊裡找。「Sign in」幾乎每一家出版社的
  //       頁首都有，拿整頁比對等於每一篇都跳警告，而警告一旦亂喊
  //       就沒有人會再看它。
  const ABSTRACT_SUSPICIOUSLY_SHORT = 350;

  function detectAccess(ad, doc, abstract, abstractSel) {
    const len = String(abstract || '').length;
    if (len >= ABSTRACT_SUSPICIOUSLY_SHORT) {
      return { scanned: true, restricted: false, quote: '' };
    }
    // 只掃**實際採用的**那一個摘要容器，不是全部候選 ——
    // MDPI 的 `#abstract` 是整頁的外層 div，把候選全掃一遍等於拿整頁
    // 去比對「Access options」這種字，每一篇都會誤報。
    // 摘要來自 meta 標籤時沒有容器可掃，那就只剩訂閱牆區塊。
    const used = (ad && ad.abstract && ad.abstract.includes(abstractSel)) ? [abstractSel] : [];
    const scopes = used.concat((ad && ad.paywallScope) || []);
    let scanned = false;
    let hay = '';
    for (const sel of scopes) {
      let nodes;
      try {
        nodes = doc.querySelectorAll(sel);
      } catch (_) {
        continue;
      }
      for (const el of nodes) {
        scanned = true;
        // 跟撤稿掃描同一個教訓：下拉選單的 <option> 會被 textContent
        // 算進去，而出版社的頁面上到處都是「Access options」這種選項。
        const clone = el.cloneNode(true);
        clone.querySelectorAll('svg, select, option, datalist, script, style')
          .forEach((x) => x.remove());
        hay += ` ${clone.textContent || ''}`;
        if (hay.length > 8000) break;
      }
      if (hay.length > 8000) break;
    }
    if (!NS.PAYWALL.test(hay)) return { scanned, restricted: false, quote: '' };

    let quote = '';
    for (const phrase of NS.PAYWALL_PHRASES) {
      const m = hay.match(new RegExp(`[^.。\\n]{0,80}${phrase}[^.。\\n]{0,120}`, 'i'));
      if (m) { quote = C.clean(m[0]); break; }
    }
    return { scanned, restricted: true, quote };
  }

  // ── 識別碼的頁面後備 ──────────────────────────────────
  //
  // meta 沒給的時候從網址與頁面撈。網址是最可靠的後備：
  // PubMed 的 /38712345/ 就是 PMID，arXiv 的 /abs/2401.12345 就是 id。
  function idsFromLocation(loc) {
    const href = String((loc && loc.href) || '');
    const host = String((loc && loc.hostname) || '');
    const path = String((loc && loc.pathname) || '');
    const out = { pmid: '', pmcid: '', arxivId: '', doi: '' };

    if (/pubmed\.ncbi\.nlm\.nih\.gov$/.test(host)) {
      const m = path.match(/^\/(\d{4,})\/?$/);
      if (m) out.pmid = m[1];
    }
    if (/ncbi\.nlm\.nih\.gov$/.test(host)) {
      out.pmcid = ID.normPmcid(path);
    }
    if (/arxiv\.org$/.test(host)) {
      out.arxivId = ID.normArxiv(path.replace(/^\/(abs|pdf)\//, ''));
    }
    // 出版社常把 DOI 直接放在路徑上：/doi/full/10.1056/NEJMoa2401234
    const dm = href.match(/10\.\d{4,9}\/[^\s?#&"']+/);
    if (dm) out.doi = ID.normDoi(dm[0]);
    return out;
  }

  // 頁面上的 doi.org 連結。比在整頁文字裡 regex 撈 DOI 可靠得多——
  // 參考文獻區塊裡有幾十個別人的 DOI，撈到那些就整個張冠李戴。
  function doiFromLinks(doc) {
    let nodes;
    try {
      nodes = doc.querySelectorAll('a[href*="doi.org/10."]');
    } catch (_) {
      return '';
    }
    for (const a of nodes) {
      // 參考文獻裡的 DOI 不是這一篇的
      if (a.closest('.references, #references, .ref-list, ol.references, section.ref-list')) continue;
      const v = ID.normDoi(a.getAttribute('href'));
      if (v) return v;
    }
    return '';
  }

  // ── 主入口 ───────────────────────────────────────────

  function extract(ad, doc, loc) {
    const d = doc || document;
    const l = loc || location;

    const cite = C.readCitation(d);
    const fromUrl = idsFromLocation(l);

    // 摘要：meta 給的常常是截斷版（很多出版社截在 250 字），
    // 頁面上的才是完整的。兩邊都有就取長的那份。
    const pageAbs = firstBlock(d, ad.abstract, 60, ABSTRACT_MAX);
    let abstract = metaHtmlToText(cite.abstract);
    let absFrom = cite.via.abstract;
    if (pageAbs.text.length > abstract.length) {
      abstract = pageAbs.text;
      absFrom = pageAbs.from;
    }
    // 摘要容器裡常常有一顆標籤或標題，而它不是摘要的內容：
    //   arXiv  <span>Abstract:</span> 行內，沒有區塊邊界 → 黏成「Abstract:The…」
    //   PMC    <h2>Summary</h2>       獨立一行（Lancet 系用 Summary 不用 Abstract）
    // 這段文字會一路變成 Doc 的內文與知識庫的切片，去掉才乾淨。
    //
    // 只砍 Abstract／Summary／摘要這三個字。Background、Methods 那些是
    // 結構式摘要的正式段落標籤，砍掉會讓摘要失去結構。
    abstract = abstract
      .replace(/^\s*(Abstract|Summary|摘要)\s*[:：]\s*/i, '')
      .replace(/^\s*(Abstract|Summary|摘要)\s*\n+/i, '');

    // MeSH 與作者關鍵字是**兩份不同的東西**，不能混在同一個欄位：
    // MeSH 是 NLM 指派的控制詞彙（可以拿來精確比對），
    // 作者關鍵字是作者自己寫的（同一個概念十個人十種寫法）。
    // 檢索時的價值差很多，混在一起等於把控制詞彙的優勢丟掉。
    //
    // 兩者的抽取方式也不同，而這正是它們必須分開的實務理由：
    //   MeSH   一詞一顆 <button>，逐顆取，**絕不能用逗號切** ——
    //          「Respiration, Artificial」是倒置形式，逗號是詞彙的一部分
    //   關鍵字 整串放在一個 <p> 裡（「Keywords: a, b, c」），逗號就是分隔符
    const meshGot = itemTexts(d, ad.meshItems);
    // 關鍵字有兩種形狀，逐項優先：
    //   一項一元素  Annals 的一串 <a>（中間沒有空白，整塊掃會黏成一團）
    //   一整串      PMC 的「Keywords: a, b, c」
    let kwGot = itemTexts(d, ad.keywordItems);
    if (!kwGot.items.length) {
      const pageKw = firstBlock(d, ad.keywords, 3);
      kwGot = { items: splitKeywords(pageKw.text), from: pageKw.from };
    }
    const keywords = [...cite.keywords, ...kwGot.items]
      .filter((s, i, arr) => arr.indexOf(s) === i);
    const pubTypes = itemTexts(d, ad.pubTypeItems);

    const title = cite.title;
    const integrity = detectIntegrity(ad, d, title);
    const access = detectAccess(ad, d, abstract, absFrom);

    const authors = cite.authors;
    const doi = ID.normDoi(cite.doi) || fromUrl.doi || doiFromLinks(d);

    const rec = {
      kind: 'paper',
      source: ad.id,
      sourceLabel: ad.label,

      title,
      authors,
      // 第一作者單獨留一份：檔名、frontmatter、去重的後備都只要一個人，
      // 而每個呼叫端各自去取 authors[0] 遲早會有人忘記處理空陣列。
      author: authors[0] || '',
      surname: C.surnameOf(authors[0] || ''),

      journal: cite.journal,
      journalAbbrev: cite.journalAbbrev,
      publisher: cite.publisher,
      year: cite.year,
      date: cite.date,
      volume: cite.volume,
      issue: cite.issue,
      pages: [cite.firstPage, cite.lastPage].filter(Boolean).join('-'),

      doi,
      pmid: ID.normPmid(cite.pmid) || fromUrl.pmid,
      pmcid: ID.normPmcid(cite.pmcid) || fromUrl.pmcid,
      arxivId: ID.normArxiv(cite.arxivId) || fromUrl.arxivId,
      arxivVersion: ID.arxivVersion(l.href || ''),
      issn: cite.issn,

      abstract,
      keywords,
      meshTerms: meshGot.items,
      // 研究設計。臨床評讀第一件事就是問「這是 RCT 還是個案報告」，
      // 而它只存在於頁面上，meta 標籤不給。
      publicationTypes: pubTypes.items,
      pdfUrl: cite.pdfUrl,

      preprint: !!ad.preprint,
      integrity,
      access,

      pageUrl: l.href,
      capturedAt: Date.now(),

      // 診斷用。「這篇怎麼沒有摘要」要能當場回答，不用叫人開 DevTools。
      via: {
        ...cite.via,
        abstract: absFrom,
        mesh: meshGot.from,
        keywords: kwGot.from || (cite.keywords.length ? 'citation_keyword(s)' : ''),
        pubTypes: pubTypes.from,
      },
    };

    rec.permalink = ID.canonicalUrl(rec);
    rec.fingerprint = ID.fingerprint(rec);
    rec.hasStrongId = ID.hasStrongId(rec);

    // 缺什麼要講出來，而且要分「不影響」與「會影響」兩級。
    // 全部混在一起報的話，使用者會學會忽略它。
    rec.missing = [];
    if (!rec.title) rec.missing.push('標題');
    if (!rec.authors.length) rec.missing.push('作者');
    if (!rec.year) rec.missing.push('年份');
    if (!rec.abstract) rec.missing.push('摘要');
    rec.severe = [];
    if (!rec.title) rec.severe.push('標題');
    if (!rec.hasStrongId) rec.severe.push('識別碼（DOI／PMID／arXiv）');

    return rec;
  }

  // 這一頁值不值得收？不值得的話要在按下去**之前**就講清楚。
  // 按下去才說「抓不到」，使用者已經以為收好了。
  function verdict(rec) {
    if (!rec.title) {
      return { ok: false, why: '這一頁沒有書目資料（找不到 citation_title），可能不是文章頁' };
    }
    // 訂閱牆排在識別碼前面：收到半篇摘要比去重不準嚴重得多。
    if (rec.access && rec.access.restricted) {
      return {
        ok: true,
        warn: '這一頁看起來需要登入才看得到完整摘要，收到的可能是截斷版。'
          + '用你的機構帳號登入後重新整理，再收一次就會蓋成完整的。',
      };
    }
    if (!rec.hasStrongId) {
      return {
        ok: true,
        warn: '這一頁沒有 DOI／PMID／arXiv id，去重只能靠標題比對，'
          + '同一篇從別的網址收可能會變成兩份',
      };
    }
    return { ok: true };
  }

  self.ADAPTER_SYNC_EXTRACT = {
    blockText, firstBlock, itemTexts, ABSTRACT_MAX, splitKeywords,
    detectIntegrity, detectAccess, idsFromLocation, doiFromLinks,
    extract, verdict, CHROME_WORDS,
  };
})();
