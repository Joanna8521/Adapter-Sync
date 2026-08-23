// =====================================================
// Adapter Sync — 站台轉接器
//
// 跟 Post Sync 的 adapter 比，這裡的職責小很多，因為書目資料由
// citation.js 統一從 `<meta name="citation_*">` 讀走了。
// 一個站台的 adapter 只需要補三件 meta 標籤給不了的東西：
//
//   abstract    meta 裡的摘要常常是截斷版或根本沒有，全文在頁面上
//   meshItems   MeSH（NLM 的控制詞彙）只存在於 PubMed 的頁面上
//   keywordItems / keywords  作者關鍵字，一項一元素或一整串兩種形狀
//   pubTypeItems 研究設計（RCT／Meta-Analysis…），臨床評讀第一個看的
//   alerts      撤稿與關切聲明 —— 這是文獻類獨有、而且必做的一件事
//
// 每個 adapter 的欄位：
//   id / label     識別字與顯示名
//   hosts          比對 location.hostname
//   pathTest       只有「單篇文章頁」才啟用。搜尋結果頁、期刊首頁上
//                  出現一顆按了會收到垃圾的按鈕，比沒有按鈕更糟
//   preprint       預印本站台。這個旗標會一路帶到知識庫的 frontmatter
//   abstract       摘要容器（選擇器，可多個，取第一個有內容的）
//   meshItems      MeSH，一詞一元素
//   keywordItems   關鍵字，一項一元素（優先）
//   keywords       關鍵字容器，整串再切分隔符（逐項落空時的後備）
//   alertScope     掃描撤稿聲明的範圍（不給就掃 body 前段）
//   probes         站台改版時要數的候選錨點
// =====================================================

(function () {
  'use strict';

  const C = self.ADAPTER_SYNC_CITATION;

  // ── 撤稿與關切聲明 ────────────────────────────────────
  //
  // 這是整個專案唯一會造成真實傷害的失敗模式。這批資料會進知識庫、
  // 被切片、被檢索，然後拿來回答臨床問題。一篇撤稿的研究混在證據裡
  // 而沒有標記，就是拿已經被推翻的東西當答案。
  //
  // 判準刻意**不猜 class name**。PubMed 的 .publication-alert 這種東西
  // 改版就沒了，而 NLM 的用語是標準化詞彙（Retracted Publication 是
  // 正式的 Publication Type），十幾年沒變過，比任何選擇器都穩。
  //
  // 出版社那邊也有一個跨家通用的訊號：標題前綴。
  // Nature／Springer 是「Retracted Article: ...」，Elsevier 是
  // 「RETRACTED: ...」，這比找橫幅可靠得多。
  //
  // 順序有意義：這份清單同時用來**挑要給使用者看的那一句**，
  // 而挑到哪一句差很多。PMC 的頁面上「RETRACTED:」出現在標題裡，
  // 照字串順序取第一個命中，引文會變成整條標題加一長串作者與單位；
  // 而同一頁下面明明有一句乾淨的「This article has been retracted.」。
  // 所以由具體到籠統排，逐條試，第一個命中的就是引文。
  const RETRACTED_PHRASES = [
    'This article has been retracted',
    'has been retracted',
    'Retracted Publication',          // NLM Publication Type
    'Retraction in',                  // PubMed：指向撤稿聲明
    'RETRACTED ARTICLE',
    'Retracted Article',
    '本文已撤稿', '已撤回', '撤稿聲明',
  ];
  const RETRACTED = new RegExp(RETRACTED_PHRASES.join('|'), 'i');

  // 撤稿聲明本身（不是被撤的那篇）。要分開，因為把撤稿聲明標成
  // 「這篇被撤稿了」是錯的 —— 它是那份公告。
  const IS_NOTICE = /Retraction of|Retraction Notice|^Retraction:/i;

  // 關切聲明：還沒撤，但期刊已經公開表示有疑慮。臨床上同樣要知道。
  const CONCERN_PHRASES = [
    'An expression of concern has been published',
    'Expression of Concern',
    '表達關切',
  ];
  const CONCERN = new RegExp(CONCERN_PHRASES.join('|'), 'i');

  // ── 訂閱牆 ───────────────────────────────────────────
  //
  // 使用者沒登入（或機構 session 過期）的時候，頁面上的摘要會變成
  // 一段招牌文案，而擴充會照收不誤、畫面上不會有任何提示 ——
  // 又是一個「安靜地少收」。
  //
  // 但判準要**很窄**：全文在付費牆後面是常態，而我們本來就只收摘要，
  // 那不是問題。「Sign in」這種字幾乎每一家出版社的頁首都有，
  // 拿整頁去比對等於每一篇都跳警告。
  //
  // 所以只有在「摘要短得可疑」的時候才去找這些字，而且只在摘要容器
  // 與訂閱牆區塊裡找。
  const PAYWALL_PHRASES = [
    'Sign in to continue', 'Sign in to read', 'Sign in or create an account',
    'Subscribe to continue', 'Subscribe to read', 'Already a subscriber',
    'Purchase access', 'Purchase this article', 'Buy this article',
    'Rent this article', 'Get full access', 'Get access to this article',
    'Access options', 'Institutional access', 'institutional login',
    'available to subscribers', 'To view the full text',
    'Log in to view', 'Continue reading with',
    '訂閱後閱讀', '登入以檢視', '購買本文',
  ];
  const PAYWALL = new RegExp(PAYWALL_PHRASES.join('|'), 'i');

  // 標題前綴。命中就直接算數，不用再找橫幅。
  const TITLE_RETRACTED = /^\s*(RETRACTED[: ]|Retracted Article\s*:|\[?Retracted\]?[: ])/i;

  self.ADAPTER_SYNC = {
    RETRACTED,
    RETRACTED_PHRASES,
    IS_NOTICE,
    CONCERN,
    CONCERN_PHRASES,
    PAYWALL,
    PAYWALL_PHRASES,
    TITLE_RETRACTED,

    ADAPTERS: [
      {
        id: 'pubmed',
        label: 'PubMed',
        hosts: /^pubmed\.ncbi\.nlm\.nih\.gov$/,
        // 單篇是 /38712345/，搜尋結果是 /?term=...
        pathTest: (path, search) => /^\/\d{4,}\/?$/.test(path) && !search.includes('term='),
        // PubMed 的 meta 只給截斷的摘要，全文在 #abstract 裡。
        // 而且是結構式的（Background/Methods/Results），段落要留住。
        abstract: ['#abstract .abstract-content', '#abstract', 'div.abstract-content'],
        // MeSH 的每一個詞是一顆 <button class="keyword-actions-trigger">，
        // 按下去展開「Search in PubMed／Search in MeSH／Add to Search」的選單。
        //
        // 所以**不能**整塊掃文字：掃到的會是
        // 「MeSH terms Adolescent Actions Search in PubMed Search in MeSH
        //   Add to Search Adult Actions Search in PubMed…」
        // 而抽取層為了別的理由排除了 button，結果會是一個詞都拿不到、
        // 只剩下拉選單的雜訊。逐顆按鈕取自己的文字才對。
        meshItems: ['#mesh-terms .keyword-actions-trigger'],
        // **刻意留空。** PubMed 沒有獨立的作者關鍵字區塊（有的話是
        // 混在摘要段落裡的一行 `Keywords: …`，會跟著摘要一起收）。
        // 這裡若退回掃 #mesh-terms，MeSH 會被逗號切開再灌進關鍵字欄位，
        // 於是「Respiration, Artificial」變成兩個不存在的詞、
        // 而且同一批東西在兩個欄位裡各存一份。
        keywords: [],
        // 出版型別（Randomized Controlled Trial、Meta-Analysis、Review…）
        // 是臨床評讀最先看的一欄，值得單獨收。結構跟 MeSH 一樣。
        pubTypeItems: ['#publication-types .keyword-actions-trigger'],
        // 撤稿資訊在這幾個區塊裡。掃描範圍縮小是為了不要把
        // 「參考文獻裡引用了一篇撤稿論文」誤判成「這篇被撤稿」。
        alertScope: [
          '#article-alerts', '.publication-alert', '#publication-types',
          'div.linked-comments', '#linked-comments', 'div.comments-and-similar',
          'header.heading', 'h1.heading-title',
        ],
        probes: {
          '標題 h1.heading-title': 'h1.heading-title',
          '摘要 #abstract': '#abstract',
          'MeSH #mesh-terms': '#mesh-terms',
          '出版型別 #publication-types': '#publication-types',
          'citation_title meta': 'meta[name="citation_title" i]',
          'citation_author meta': 'meta[name="citation_author" i]',
        },
      },
      {
        id: 'pmc',
        label: 'PubMed Central',
        hosts: /^(pmc\.ncbi\.nlm\.nih\.gov|www\.ncbi\.nlm\.nih\.gov)$/,
        pathTest: (path) => /\/articles\/PMC\d+/i.test(path) || /^\/pmc\/articles\//i.test(path),
        // PMC 是全文站，摘要在 abstract 區塊；正文太長，預設不整篇收
        // （見 README「為什麼預設不收全文」）。
        abstract: ['section.abstract', 'div.abstract', '#abstract', '.tsec.abstract'],
        keywords: ['.kwd-group', 'section.kwd-group'],
        alertScope: [
          '.retraction', '.pmc-alert', '.alert', '.article-notice',
          '.fm-panel', 'section.front-matter', 'h1',
        ],
        probes: {
          '摘要 section.abstract': 'section.abstract',
          '關鍵字 .kwd-group': '.kwd-group',
          '全文段落 section.body': 'section.body',
          'citation_title meta': 'meta[name="citation_title" i]',
          'citation_pmcid meta': 'meta[name="citation_pmcid" i]',
        },
      },
      {
        id: 'arxiv',
        label: 'arXiv',
        hosts: /^(www\.)?arxiv\.org$/,
        pathTest: (path) => /^\/(abs|pdf)\//.test(path),
        preprint: true,
        abstract: ['blockquote.abstract', '#abs blockquote'],
        keywords: ['.subjects', 'td.subjects'],
        alertScope: ['.withdrawn', '#abs h1'],
        probes: {
          '摘要 blockquote.abstract': 'blockquote.abstract',
          '標題 h1.title': 'h1.title',
          '作者 div.authors': 'div.authors',
          'citation_arxiv_id meta': 'meta[name="citation_arxiv_id" i]',
        },
      },
      {
        id: 'biorxiv',
        label: 'bioRxiv / medRxiv',
        hosts: /^(www\.)?(bio|med)rxiv\.org$/,
        pathTest: (path) => /^\/content\//.test(path),
        preprint: true,
        abstract: ['#abstract-1', 'div.section.abstract', '.abstract'],
        keywords: ['.highwire-keywords', '.kwd-group'],
        alertScope: ['.pane-highwire-article-status', '.published-in', 'h1.highwire-cite-title'],
        probes: {
          '摘要 #abstract-1': '#abstract-1',
          '標題 h1.highwire-cite-title': 'h1.highwire-cite-title',
          'citation_doi meta': 'meta[name="citation_doi" i]',
        },
      },
      {
        // 通用出版社。這一個才是主力 —— 文獻站台是無窮多的，
        // Nature／NEJM／Lancet／JAMA／Elsevier／Springer／Wiley／Frontiers／MDPI
        // 全部靠它，不用一家一家寫。
        //
        // 它不在靜態 content_scripts 裡，走 optional_host_permissions ＋
        // chrome.scripting.registerContentScripts，由使用者在 popup 上
        // 對目前這個網域按「啟用」才注入。理由有二：
        //   一、預先要 https://*/* 的權限，商店審查會直接卡住，而且
        //       那等於宣告「我可以讀你看的每一個網頁」，對使用者不誠實
        //   二、文獻站台清單永遠列不完，讓使用者自己開反而涵蓋得更廣
        id: 'generic',
        label: '出版社頁面',
        hosts: /.*/,
        // 靠 meta 判斷，不靠網址。有 citation_title 就是一篇文獻，
        // 沒有就整個不啟動（連按鈕都不出現）。
        pathTest: () => true,
        pageTest: (doc) => C.looksLikePaper(doc || document),
        // 由具體到籠統。firstBlock 取「第一個真的有內容的」，所以順序就是
        // 優先序；把籠統的放前面會在某些站台撈到導覽列的錨點。
        //
        // `section[id*="abstract" i]` 是為 NEJM 開的：它的摘要在
        // `<section id="abstracts">`，而且**整個站台沒有任何 citation_* 標籤**
        // （只有 citation_journal_title），書目全靠 Dublin Core。
        abstract: [
          // MDPI 專屬的兩個排前面：它的 `#abstract` 其實是整頁的外層 div，
          // 排在後面的話會先被那個吃掉（有 ABSTRACT_MAX 擋，但多繞一圈）。
          'div.art-abstract', 'section.html-abstract',
          'section.abstract', 'div.abstract', '#abstract', '.article-abstract',
          'section[id*="abstract" i]',
          'section[aria-labelledby*="abstract" i]',
          '[id*="abstract" i]',
          '[class*="abstract"] p',
          '[class*="abstract"]',
        ],
        // **逐項取優先。** Annals（ACP）把關鍵字放成一串 <a>，彼此之間
        // 沒有任何空白或標點，整塊掃文字會黏成
        // 「Allergy and immunologyCOVID-19DisclosureEpidemiology…」——
        // 一個關鍵字都認不出來，而且看起來像是有抓到東西。
        keywordItems: [
          '.keywords a', '.kwd-group a', '[class*="keyword"] a',
          '.keywords li', '.kwd-group li', '[class*="keyword"] li',
        ],
        // 逐項落空才退回整塊掃描：PMC 的「Keywords: a, b, c」（逗號）、
        // MDPI 的 `#html-keywords`「Keywords: a; b; c」（分號）。
        // 兩種分隔符 splitKeywords 都吃。
        keywords: ['#html-keywords', '.keywords', '.kwd-group', '[class*="keyword"]', '[id*="keyword" i]'],
        alertScope: ['h1', '.article-header', 'header', '[class*="retract" i]', '[class*="notice" i]'],
        // 訂閱牆的區塊。跟 alertScope 分開，因為兩者要問的問題不同：
        // 一個問「這篇有沒有問題」，一個問「我是不是只看到半篇」。
        paywallScope: [
          '[class*="paywall" i]', '[id*="paywall" i]',
          '[class*="subscri" i]', '.access-options', '.article-access-options',
          '[data-testid*="paywall" i]', '.login-prompt',
        ],
        probes: {
          'citation_title meta': 'meta[name="citation_title" i]',
          'citation_doi meta': 'meta[name="citation_doi" i]',
          'citation_author meta': 'meta[name="citation_author" i]',
          'JSON-LD': 'script[type="application/ld+json"]',
          '摘要候選': '[class*="abstract"]',
        },
      },
    ],

    // 找出這個網址用哪一組。
    //
    // 跟 Post Sync 不一樣的是這裡多比對了路徑：文獻站台的搜尋結果頁、
    // 期刊首頁、作者頁跟文章頁在同一個網域下，全部啟用的話，使用者會在
    // 搜尋結果頁看到一顆浮動按鈕，按下去收到一份沒有內容的殼。
    //
    // generic 永遠排最後，而且只有在前面都不match 時才輪到它。
    adapterFor(loc, doc) {
      const host = (loc && loc.hostname) || '';
      const path = (loc && loc.pathname) || '';
      const search = (loc && loc.search) || '';
      for (const a of self.ADAPTER_SYNC.ADAPTERS) {
        if (a.id === 'generic') continue;
        if (!a.hosts.test(host)) continue;
        if (a.pathTest && !a.pathTest(path, search)) return null; // 認得站台但這頁不是文章
        return a;
      }
      const g = self.ADAPTER_SYNC.ADAPTERS.find((a) => a.id === 'generic');
      if (g && g.pageTest(doc || document)) return g;
      return null;
    },
  };
})();
