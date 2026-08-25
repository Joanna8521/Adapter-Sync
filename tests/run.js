// =====================================================
// Adapter Sync — 抽取層測試
//
// 用瀏覽器直接打開 tests/run.html 就跑，不需要 npm、不需要 build。
//
// 這裡釘住的**全部**是那種壞了不會有任何畫面告訴你的事：
//
//   一、同一篇從不同網址收會不會變成兩份
//   二、撤稿有沒有被標到；沒撤稿的有沒有被誤標
//   三、二十人的論文會不會被壓成一位作者
//   四、結構式摘要會不會被壓成一段
//   五、搜尋結果頁會不會冒出一顆按了收到垃圾的按鈕
//
// 這五件事都不會丟例外、不會變紅字，只會安靜地把錯的東西存起來。
// =====================================================

(function () {
  'use strict';

  const NS = self.ADAPTER_SYNC;
  const C = self.ADAPTER_SYNC_CITATION;
  const ID = self.ADAPTER_SYNC_IDS;
  const EX = self.ADAPTER_SYNC_EXTRACT;
  const NAME = self.ADAPTER_SYNC_NAME;

  const results = [];
  let group = '';

  function describe(name) { group = name; }

  function it(name, fn) {
    try {
      fn();
      results.push({ group, name, ok: true });
    } catch (e) {
      results.push({ group, name, ok: false, msg: (e && e.message) || String(e) });
    }
  }

  function eq(actual, expected, what) {
    if (actual !== expected) {
      throw new Error(`${what || ''} 期望 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
    }
  }
  function ok(v, what) {
    if (!v) throw new Error(`${what || ''} 期望為真，實際 ${JSON.stringify(v)}`);
  }
  function no(v, what) {
    if (v) throw new Error(`${what || ''} 期望為假，實際 ${JSON.stringify(v)}`);
  }

  function doc(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function loc(href) {
    const u = new URL(href);
    return {
      href, hostname: u.hostname, pathname: u.pathname, search: u.search, origin: u.origin,
    };
  }

  function adapterById(id) {
    return NS.ADAPTERS.find((a) => a.id === id);
  }

  // ── fixture ──────────────────────────────────────────

  const LONG_ABS_BG = 'Early mobilisation of critically ill adults has been proposed to reduce '
    + 'intensive care unit acquired weakness, but randomised evidence remains limited and '
    + 'previous trials have reported conflicting results across different case mixes.';
  const LONG_ABS_ME = 'We randomly assigned 750 adults receiving invasive mechanical ventilation '
    + 'to either an early mobilisation protocol or usual care, and followed them for 180 days.';

  // 這份 fixture 是照**真的 PubMed 頁面**寫的，不是照我原本以為的樣子。
  // 拿真站台驗過之後改了三個地方，每一個原本都會讓真站台安靜地壞掉：
  //
  //   一、作者是單一個 citation_authors（分號隔開、結尾還多一個分號），
  //       **不是**重複的 citation_author —— 原本在 PubMed 上作者會全空
  //   二、日期是美式 citation_date「05/22/2020」，年份在最後面
  //   三、MeSH 與出版型別的每一個詞是一顆 <button>，後面跟著一塊
  //       「Actions / Search in PubMed / …」的下拉選單 —— 整塊掃文字
  //       會抽到滿滿的選單雜訊，而抽取層排除 button 之後會一個詞都不剩
  function keywordItem(section, term, i) {
    return `<li><div class="keyword-actions dropdown-block">
      <button class="keyword-actions-trigger trigger keyword-link">
      ${term}
    </button><div id="keyword-actions-${section}-${i}" class="keyword-actions-dropdown">
      <div class="title">Actions</div>
      <div class="content"><ul class="keyword-actions-links">
        <li><a class="search-in-pubmed-link">Search in PubMed</a></li>
        <li><a class="search-in-mesh-link">Search in MeSH</a></li>
        <li><a class="add-to-search-link">Add to Search</a></li>
      </ul></div></div></div></li>`;
  }

  function keywordBlock(id, section, heading, terms) {
    return `<div id="${id}"><h3>${heading}</h3><ul>`
      + terms.map((t, i) => keywordItem(section, t, i)).join('')
      + '</ul></div>';
  }

  function pubmedHtml(opts = {}) {
    const o = Object.assign({
      title: 'Effect of early mobilisation on functional outcomes in critically ill adults',
      doi: '10.1016/S0140-6736(24)00123-4',
      pmid: '38712345',
      // 「Respiration, Artificial」是真的 MeSH 標目（倒置形式），
      // 逗號是詞彙本身的一部分，切開就變成兩個不存在的詞。
      mesh: ['Humans', 'Critical Care', 'Early Ambulation', 'Respiration, Artificial'],
      pubTypes: ['Randomized Controlled Trial', 'Multicenter Study'],
      alerts: '',
      refs: '',
      extraMeta: '',
    }, opts);
    return `<!doctype html><html><head>
      <meta name="citation_title" content="${o.title}">
      <meta name="citation_authors" content="Smith JA;Chen ML;van der Berg A;">
      <meta name="citation_journal_title" content="The Lancet">
      <meta name="citation_date" content="05/12/2024">
      <meta name="citation_doi" content="${o.doi}">
      <meta name="citation_pmid" content="${o.pmid}">
      ${o.extraMeta}
      </head><body>
      <h1 class="heading-title">${o.title}</h1>
      ${o.alerts}
      <div id="abstract"><div class="abstract-content">
        <p><strong class="sub-title">Background: </strong>${LONG_ABS_BG}</p>
        <p><strong class="sub-title">Methods: </strong>${LONG_ABS_ME}</p>
      </div></div>
      ${keywordBlock('publication-types', 'publication-types', 'Publication types', o.pubTypes)}
      ${keywordBlock('mesh-terms', 'mesh-terms', 'MeSH terms', o.mesh)}
      ${o.refs}
      </body></html>`;
  }

  const PUBMED_URL = 'https://pubmed.ncbi.nlm.nih.gov/38712345/';

  function extractPubmed(opts, url) {
    return EX.extract(adapterById('pubmed'), doc(pubmedHtml(opts)), loc(url || PUBMED_URL));
  }

  // 出版社自己的頁面走的是另一種形狀：重複的 citation_author、
  // 完整的卷期頁。兩種形狀都要有 fixture —— 只測 PubMed 的話，
  // 「重複標籤只拿到第一個」這個坑會完全測不到。
  const PUBLISHER_URL = 'https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(24)00123-4/fulltext';

  function publisherHtml(opts = {}) {
    const o = Object.assign({
      title: 'Effect of early mobilisation on functional outcomes in critically ill adults',
      doi: '10.1016/S0140-6736(24)00123-4',
      authors: ['Smith, John A', 'Chen ML', 'van der Berg, Anna'],
      extra: '',
    }, opts);
    return `<!doctype html><html><head>
      <meta name="citation_title" content="${o.title}">
      ${o.authors.map((a) => `<meta name="citation_author" content="${a}">`).join('\n')}
      <meta name="citation_journal_title" content="The Lancet">
      <meta name="citation_journal_abbrev" content="Lancet">
      <meta name="citation_publication_date" content="2024/05/12">
      <meta name="citation_volume" content="403">
      <meta name="citation_issue" content="10440">
      <meta name="citation_firstpage" content="1801">
      <meta name="citation_lastpage" content="1812">
      <meta name="citation_doi" content="${o.doi}">
      ${o.extra}
      </head><body><h1>${o.title}</h1></body></html>`;
  }

  function extractPublisher(opts, url) {
    return EX.extract(adapterById('generic'), doc(publisherHtml(opts)), loc(url || PUBLISHER_URL));
  }

  // ── 一、去重：同一篇不能變成兩份 ──────────────────────
  //
  // 這是把 Post Sync 的管線搬過來最容易漏的一條。社群那邊
  // permalink 就是身分，文獻這邊 permalink 有四五個。

  describe('去重（同一篇不能變兩份）');

  it('DOI 的前綴、大小寫、句尾標點都要正規化到同一個值', () => {
    const want = '10.1016/s0140-6736(24)00123-4';
    eq(ID.normDoi('10.1016/S0140-6736(24)00123-4'), want, '原樣');
    eq(ID.normDoi('https://doi.org/10.1016/S0140-6736(24)00123-4'), want, 'doi.org 前綴');
    eq(ID.normDoi('http://dx.doi.org/10.1016/S0140-6736(24)00123-4'), want, 'dx.doi.org');
    eq(ID.normDoi('doi:10.1016/S0140-6736(24)00123-4'), want, 'doi: 前綴');
    eq(ID.normDoi('DOI: 10.1016/S0140-6736(24)00123-4.'), want, '句尾句點');
  });

  it('形狀不對的東西不能被當成 DOI（否則兩篇不相干的會撞成同一份）', () => {
    eq(ID.normDoi('not-a-doi'), '');
    eq(ID.normDoi('10.1016'), '', '沒有後綴');
    // registrant code 至少四碼。少於四碼是打錯或抓錯欄位，
    // 收進來會讓兩篇不相干的論文因為同一個壞值被判成重複。
    eq(ID.normDoi('10.1/x'), '', 'registrant 太短');
    eq(ID.normDoi(''), '');
    eq(ID.normDoi(null), '');
  });

  it('同一篇從 PubMed 收、從出版社頁面收，指紋必須相同', () => {
    const fromPubmed = extractPubmed();
    const fromPublisher = extractPublisher({
      doi: 'https://doi.org/10.1016/S0140-6736(24)00123-4',
    });
    ok(fromPubmed.fingerprint, 'PubMed 這邊算得出指紋');
    eq(fromPublisher.fingerprint, fromPubmed.fingerprint, '兩邊指紋');
  });

  it('指紋裡不能摻來源站台（摻了就等於自廢武功）', () => {
    const a = ID.fingerprint({ doi: '10.1016/j.example.2024.01.001', source: 'pubmed' });
    const b = ID.fingerprint({ doi: '10.1016/j.example.2024.01.001', source: 'generic' });
    // 先確認真的走到 DOI 那條。兩邊都退到「算不出指紋」時 eq 也會過，
    // 那種綠色比紅色更危險。
    ok(a.startsWith('doi:'), `走的是 DOI 那條，實際 ${a}`);
    eq(a, b, '同一個 DOI 不同來源');
  });

  it('arXiv 的 v1 與 v2 是同一篇，但版本要記得住', () => {
    eq(ID.normArxiv('2401.12345v2'), '2401.12345');
    eq(ID.normArxiv('https://arxiv.org/abs/2401.12345v1'), '2401.12345');
    eq(ID.normArxiv('math.GT/0309136v3'), 'math.gt/0309136');
    eq(ID.arxivVersion('https://arxiv.org/abs/2401.12345v2'), 'v2');
    eq(
      ID.fingerprint({ arxivId: '2401.12345v1' }),
      ID.fingerprint({ arxivId: '2401.12345v2' }),
      'v1 與 v2 的指紋',
    );
  });

  it('追蹤參數不能讓同一頁算成兩篇', () => {
    const a = ID.normUrl('https://example.org/article/1?utm_source=x&ref=y');
    const b = ID.normUrl('https://www.example.org/article/1/#section');
    eq(a, b, '洗過的網址');
  });

  it('PMID 太短的不收（多半是從別的數字誤撈進來的）', () => {
    eq(ID.normPmid('PMID: 38712345'), '38712345');
    eq(ID.normPmid('/38712345/'), '38712345');
    eq(ID.normPmid('12'), '');
  });

  it('沒有任何識別碼時，指紋要退到標題＋第一作者，不能是空的', () => {
    const fp = ID.fingerprint({ title: 'A study of something specific', author: 'Smith J' });
    ok(fp, '算得出指紋');
    ok(fp.startsWith('t:'), '走的是標題那條');
  });

  // ── 二、撤稿：標到 vs 誤標 ────────────────────────────
  //
  // 這是整個專案唯一會造成真實傷害的失敗模式：撤稿的研究混進知識庫、
  // 被檢索出來當證據。所以「標到」與「不誤標」兩邊都要有測試。

  describe('撤稿與關切聲明');

  it('PubMed 的 Retracted Publication 要被標到', () => {
    const r = extractPubmed({
      pubTypes: ['Randomized Controlled Trial', 'Retracted Publication'],
    });
    ok(r.integrity.scanned, '有掃');
    ok(r.integrity.retracted, '標到撤稿');
    no(r.integrity.notice, '這不是撤稿公告本身');
    ok(r.integrity.quote, '要留下命中的原文給人判斷');
  });

  it('出版社的標題前綴（RETRACTED:）要被標到', () => {
    const r = extractPubmed({ title: 'RETRACTED: Ivermectin for treatment of severe disease' });
    ok(r.integrity.retracted, '標題前綴');
  });

  it('Nature／Springer 的 Retracted Article: 前綴也要被標到', () => {
    const r = extractPubmed({ title: 'Retracted Article: Gut microbiota and outcome' });
    ok(r.integrity.retracted, '標題前綴');
  });

  it('撤稿公告本身不能被標成「這篇被撤稿了」', () => {
    const r = extractPubmed({
      title: 'Retraction: Effect of early mobilisation on functional outcomes',
      pubTypes: ['Retraction of Publication'],
      alerts: '<div class="linked-comments">Retraction of: Smith J, et al. Lancet. 2024.</div>',
    });
    ok(r.integrity.notice, '認出這是公告');
    no(r.integrity.retracted, '不能標成被撤稿');
  });

  it('參考文獻裡引用了撤稿論文，不能誤判成「這篇被撤稿」', () => {
    const r = extractPubmed({
      refs: '<div class="references"><ol><li>Jones A. This article has been retracted. '
        + 'BMJ. 2019.</li></ol></div>',
    });
    no(r.integrity.retracted, '狼來了喊多了就沒人看警告了');
  });

  it('同時有關切聲明與撤稿時，要顯示撤稿那一句（比較嚴重的）', () => {
    // PMC 的真實情形：先發關切聲明、後撤稿，兩句都留在頁面上，
    // 而關切那句排在前面。取「字串裡最早命中的」會顯示比較輕的那一句。
    const r = extractPubmed({
      alerts: '<div class="linked-comments">'
        + 'An expression of concern has been published for this article. '
        + 'This article has been retracted.</div>',
    });
    ok(r.integrity.retracted, '撤稿');
    ok(r.integrity.concern, '關切');
    ok(/retracted/i.test(r.integrity.quote), `引文是「${r.integrity.quote}」`);
  });

  it('標題以 RETRACTED: 開頭時，引文不能變成整條標題加作者', () => {
    // PMC 的標題本身就是「RETRACTED: …」，而頁面下方另有一句乾淨的
    // 「This article has been retracted.」。片語清單由具體到籠統排就是為了這個。
    const r = extractPubmed({
      title: 'RETRACTED: Hydroxychloroquine or chloroquine for treatment of COVID-19',
      alerts: '<div class="linked-comments">This article has been retracted.</div>',
    });
    ok(r.integrity.quote.length < 80, `引文是「${r.integrity.quote}」`);
    ok(/This article has been retracted/i.test(r.integrity.quote));
  });

  it('關切聲明（Expression of Concern）要單獨標，不能跟撤稿混為一談', () => {
    const r = extractPubmed({
      alerts: '<div class="linked-comments">Expression of Concern in: Lancet. 2025.</div>',
    });
    ok(r.integrity.concern, '標到關切聲明');
    no(r.integrity.retracted, '關切不等於撤稿');
  });

  it('沒偵測到時只說「掃過了」，不能宣稱這篇乾淨', () => {
    const r = extractPubmed();
    ok(r.integrity.scanned, '有掃');
    no(r.integrity.retracted);
    no(r.integrity.concern);
    // 回傳物件裡不該有任何「已確認無問題」語意的欄位
    eq(Object.prototype.hasOwnProperty.call(r.integrity, 'clean'), false, '不能有 clean 欄位');
  });

  it('撤稿要一路帶到檔名（清單頁只看得到檔名）', () => {
    const r = extractPubmed({ title: 'RETRACTED: Something' });
    ok(NAME.docStem(r).startsWith('【撤稿】'), `檔名是 ${NAME.docStem(r)}`);
  });

  it('撤稿公告的檔名不加【撤稿】前綴', () => {
    const r = extractPubmed({
      title: 'Retraction: Something',
      pubTypes: ['Retraction of Publication'],
      alerts: '<div class="linked-comments">Retraction of: Smith J.</div>',
    });
    no(NAME.docStem(r).startsWith('【撤稿】'), `檔名是 ${NAME.docStem(r)}`);
  });

  // ── 三、作者群不能被壓成一位 ──────────────────────────

  describe('作者');

  it('重複出現的 citation_author 要全部收（不是只收第一個）', () => {
    const r = extractPublisher();
    eq(r.authors.length, 3, '作者人數');
    eq(r.author, 'Smith, John A', '第一作者');
    eq(r.via.authors, 'citation_author', '來源標籤');
  });

  it('PubMed 只給一個 citation_authors（分號串），一樣要拆開', () => {
    // 真站台驗過的形狀：`Mehra MR;Desai SS;Ruschitzka F;Patel AN;`
    // 只認 citation_author 的話，PubMed 上作者會全空——而且不會有任何錯誤。
    const r = extractPubmed();
    eq(r.authors.length, 3, `作者是 ${JSON.stringify(r.authors)}`);
    eq(r.author, 'Smith JA', '第一作者');
    eq(r.surname, 'Smith', '姓');
    eq(r.via.authors, 'citation_authors', '來源標籤要指出走的是哪一條');
  });

  it('分號版的 citation_authors 也要拆開', () => {
    const d = doc(`<head><meta name="citation_title" content="T">
      <meta name="citation_authors" content="Smith J; Chen ML; Berg A"></head><body></body>`);
    eq(C.authors(d).length, 3);
  });

  it('姓氏要認得出各種寫法（猜錯的話整個資料夾都用名字排序）', () => {
    eq(C.surnameOf('Smith, John A'), 'Smith', '逗號格式');
    eq(C.surnameOf('John A Smith'), 'Smith', '名在前');
    eq(C.surnameOf('Chen ML'), 'Chen', 'PubMed 縮寫格式');
    eq(C.surnameOf('van der Berg, Anna'), 'van der Berg', '逗號＋前綴');
    eq(C.surnameOf('Anna van der Berg'), 'van der Berg', '前綴要跟著姓');
    eq(C.surnameOf('Madonna'), 'Madonna', '單名');
    eq(C.surnameOf(''), '', '空字串');
  });

  it('作者名要正規化成 Vancouver 格式（不然逗號格式串起來人眼解不開）', () => {
    eq(C.vancouverName('Jumper, John'), 'Jumper J', 'Nature 的 Last, First');
    eq(C.vancouverName('Smith, John A'), 'Smith JA');
    eq(C.vancouverName('John A Smith'), 'Smith JA', '名在前');
    eq(C.vancouverName('Chen ML'), 'Chen ML', '已經是縮寫的不能再縮成 Chen M');
    eq(C.vancouverName('van der Berg, Anna'), 'van der Berg A');
    eq(C.vancouverName('Madonna'), 'Madonna', '單名');
  });

  it('三十四位「Last, First」作者串起來要分得出誰是誰', () => {
    // 真的在 Nature 上踩到的：串出來是
    // 「Jumper, John, Evans, Richard, Pritzel, Alexander, …」
    const line = NAME.authorsLine({ authors: ['Jumper, John', 'Evans, Richard', 'Pritzel, Alexander'] });
    eq(line, 'Jumper J, Evans R, Pritzel A');
  });

  it('Vancouver 的 et al 規則：超過六位才縮', () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'];
    no(NAME.authorsLine({ authors: six }).includes('et al'), '六位不縮');
    ok(NAME.authorsLine({ authors: six.concat(['G']) }).includes('et al'), '七位要縮');
  });

  // ── 四、摘要 ─────────────────────────────────────────

  describe('摘要');

  it('meta 在 <head> 裡、值在屬性上，一樣要讀得到', () => {
    const d = doc('<head><meta name="citation_title" content="Hidden in head"></head><body></body>');
    eq(C.readCitation(d).title, 'Hidden in head');
  });

  it('結構式摘要的段落要留住（壓成一段就失去它最有用的東西）', () => {
    const r = extractPubmed();
    const lines = r.abstract.split('\n').filter(Boolean);
    ok(lines.length >= 2, `段落數是 ${lines.length}`);
    ok(lines[0].startsWith('Background:'), `第一段是「${lines[0].slice(0, 30)}」`);
  });

  it('meta 給截斷版、頁面上有完整版時，要取完整的那份', () => {
    const truncated = `${LONG_ABS_BG.slice(0, 210)}…`;
    const r = extractPubmed({
      extraMeta: `<meta name="description" content="${truncated}">`,
    });
    ok(r.abstract.length > truncated.length, `meta ${truncated.length} 字 vs 實際 ${r.abstract.length} 字`);
  });

  it('og:description 是行銷文案的時候不能當摘要用', () => {
    const d = doc(`<head><meta name="citation_title" content="T">
      <meta name="og:description" content="Read the latest research from our journal."></head><body></body>`);
    eq(C.readCitation(d).abstract, '', '太短的 description 一律不當摘要');
  });

  it('按鈕字（Copy／Cite／Share）不能混進摘要', () => {
    const d = doc(`<body><div id="abstract"><div class="abstract-content">
      <p>Copy</p><p>${LONG_ABS_BG}</p><button>Share</button></div></div></body>`);
    const t = EX.firstBlock(d, ['#abstract .abstract-content'], 20).text;
    no(t.includes('Copy'), '按鈕字');
    no(t.includes('Share'), 'button 元素');
    ok(t.includes('Early mobilisation'), '正文要在');
  });

  it('meta 裡塞整段 HTML 的要轉成純文字（BMJ 就是這樣）', () => {
    // BMJ 的 citation_abstract 內容長這樣，不處理的話那些標籤會原樣
    // 寫進 Doc 與知識庫的切片，而且結構式摘要的分段正好編碼在標籤裡。
    const html = '&lt;h3&gt;Abstract&lt;/h3&gt; &lt;h3&gt;Objective&lt;/h3&gt; '
      + `&lt;p&gt;${LONG_ABS_BG}&lt;/p&gt; &lt;h3&gt;Design&lt;/h3&gt; &lt;p&gt;${LONG_ABS_ME}&lt;/p&gt;`;
    const d = doc(`<head><meta name="citation_title" content="T">
      <meta name="citation_abstract" content="${html}"></head><body></body>`);
    const r = EX.extract(adapterById('generic'), d, loc('https://www.bmj.com/content/369/bmj.m1328'));
    no(/<\/?h3|<\/?p\b/i.test(r.abstract), `殘留標籤：${r.abstract.slice(0, 60)}`);
    ok(r.abstract.split('\n').length >= 3, `標籤裡的分段要還原成換行，實際 ${r.abstract.split('\n').length} 段`);
    ok(r.abstract.startsWith('Objective'), `「Abstract」那行要拿掉，實際「${r.abstract.slice(0, 30)}」`);
  });

  it('刊名縮寫本身有句點時不能再補一個（Front. Immunol..）', () => {
    const c = NAME.citation({ journalAbbrev: 'Front. Immunol.', title: 'T', year: '2020' });
    no(c.includes('..'), c);
    ok(c.includes('Front. Immunol. 2020'), c);
  });

  it('容器裡的「Abstract:」標籤要去掉（arXiv 會黏成 Abstract:The dominant…）', () => {
    const d = doc(`<body><blockquote class="abstract">
      <span class="descriptor">Abstract:</span>${LONG_ABS_BG}</blockquote></body>`);
    const r = EX.extract(adapterById('arxiv'), d, loc('https://arxiv.org/abs/1706.03762'));
    ok(r.abstract.startsWith('Early mobilisation'), `實際開頭：${r.abstract.slice(0, 40)}`);
  });

  it('抓到幾萬字就是抓錯容器了，要換下一個選擇器', () => {
    // MDPI 的 `#abstract` 其實是整頁的外層 div（四萬多字，工具列、
    // 參考文獻、頁尾全在裡面）。沒有上限的話會把整頁塞進知識庫，
    // 而且「摘要有東西」看起來完全正常。
    const junk = 'Download PDF settings Order Article Reprints '.repeat(400);
    const d = doc(`<body>
      <div id="abstract" class="abstract_div">${junk}</div>
      <div class="art-abstract">${LONG_ABS_BG}</div>
      </body>`);
    const r = EX.extract(adapterById('generic'), d, loc('https://www.mdpi.com/2077-0383/9/2/575'));
    ok(r.abstract.length < EX.ABSTRACT_MAX, `實際 ${r.abstract.length} 字`);
    ok(r.abstract.startsWith('Early mobilisation'), r.abstract.slice(0, 40));
  });

  it('下拉選單裡的「Expression of Concern」不能被當成真的關切聲明', () => {
    // MDPI 的頁首有一個文章類型篩選器，裡面有
    // <option>Expression of Concern</option>，於是**每一篇** MDPI 論文
    // 都被標成「期刊已表達關切」。誤判的代價跟漏判一樣真實。
    const d = doc(`<head><meta name="citation_title" content="T"></head><body>
      <header><select class="chosen-select">
        <option>Article</option><option>Expression of Concern</option>
        <option>Retraction</option></select></header>
      <h1>A perfectly normal paper</h1></body>`);
    const r = EX.extract(adapterById('generic'), d, loc('https://www.mdpi.com/2077-0383/9/2/575'));
    ok(r.integrity.scanned, '有掃');
    no(r.integrity.concern, '不能誤判成關切聲明');
    no(r.integrity.retracted, '也不能誤判成撤稿');
  });

  it('多語期刊的語言切換器不能混進摘要（Cochrane 每篇開頭都會中）', () => {
    const d = doc(`<body><section class="abstract">
      <div class="section-header">Abstract <span class="section-languages-legend">available in</span></div>
      <div class="abstract full_abstract"><p>${LONG_ABS_BG}</p></div>
      </section></body>`);
    const r = EX.extract(adapterById('generic'), d, loc('https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD013574/full'));
    no(/available in/i.test(r.abstract), `實際開頭：${r.abstract.slice(0, 40)}`);
    ok(r.abstract.startsWith('Early mobilisation'), r.abstract.slice(0, 40));
  });

  it('PMC 的 <h2>Summary</h2> 標題不能被當成摘要內容', () => {
    // Lancet 系在 PMC 上用 Summary 不用 Abstract，而且是獨立一行的 h2，
    // 不像 arXiv 那樣帶冒號 —— 兩種都要砍掉。
    const d = doc(`<body><section class="abstract"><h2>Summary</h2>
      <section><p>Background</p><p>${LONG_ABS_BG}</p></section></section></body>`);
    const r = EX.extract(adapterById('pmc'), d, loc('https://pmc.ncbi.nlm.nih.gov/articles/PMC7255293/'));
    no(/^Summary/.test(r.abstract), `實際開頭：${r.abstract.slice(0, 40)}`);
    ok(r.abstract.startsWith('Background'), '結構式標籤要留著');
  });

  it('PMC 沒給 citation_pmcid，要從網址撈', () => {
    const d = doc('<head><meta name="citation_title" content="T"></head><body></body>');
    const r = EX.extract(adapterById('pmc'), d, loc('https://pmc.ncbi.nlm.nih.gov/articles/PMC7255293/'));
    eq(r.pmcid, 'PMC7255293');
    eq(r.fingerprint, 'pmcid:PMC7255293', '沒有 DOI 時指紋要退到 PMCID');
  });

  it('og:site_name 不能當期刊名（會產出看起來正常但錯的引用）', () => {
    const d = doc(`<head><meta name="citation_title" content="T">
      <meta property="og:site_name" content="arXiv.org"></head><body></body>`);
    eq(C.readCitation(d).journal, '', '刊名抓不到就該留空');
  });

  it('不可見字元要清掉（否則會一路變成檔名與指紋的一部分）', () => {
    const dirty = `A\u200Bstudy\u00ADof\uFEFFthings`;
    const d = doc(`<head><meta name="citation_title" content="${dirty}"></head><body></body>`);
    eq(C.readCitation(d).title, 'Astudyofthings');
  });

  // ── 四之二、MeSH 與出版型別 ──────────────────────────
  //
  // 這一組全部是拿真的 PubMed 頁面驗過之後補的。原本的 fixture 用一個
  // 純 div 裝分號串，測起來是綠的，但真站台會一個詞都抽不到——
  // 「單元測試全綠不代表活得下來」的教科書案例。

  describe('MeSH 與出版型別');

  it('MeSH 的每一個詞是一顆 button，要逐顆取（整塊掃會全是選單雜訊）', () => {
    const r = extractPubmed();
    eq(r.meshTerms.length, 4, `抓到 ${JSON.stringify(r.meshTerms)}`);
    eq(r.meshTerms[0], 'Humans');
  });

  it('下拉選單的「Actions／Search in PubMed」不能混進 MeSH', () => {
    const r = extractPubmed();
    const joined = r.meshTerms.join('|');
    no(/Actions|Search in PubMed|Add to Search/.test(joined), `抓到 ${joined}`);
  });

  it('MeSH 的倒置形式不能被逗號切開', () => {
    const r = extractPubmed();
    ok(
      r.meshTerms.includes('Respiration, Artificial'),
      `「Respiration, Artificial」切開就變成兩個不存在的詞，實際 ${JSON.stringify(r.meshTerms)}`,
    );
  });

  it('出版型別要收（臨床評讀第一個問的就是研究設計）', () => {
    const r = extractPubmed();
    ok(r.publicationTypes.includes('Randomized Controlled Trial'), JSON.stringify(r.publicationTypes));
    eq(r.publicationTypes.length, 2);
  });

  it('PMC 的「Keywords: a, b, c」要切開，而且不能整批消失', () => {
    // 真站台上踩到的：整串一百多字被「單一詞不超過 80 字」的防呆濾掉，
    // 於是關鍵字整批安靜消失，畫面上什麼都不會說。
    const d = doc(`<body><section class="kwd-group"><p><strong>Keywords:</strong>
      Coronavirus disease 2019, Severe acute respiratory syndrome coronavirus 2,
      Novel coronavirus pneumonia, Hydroxychloroquine, Treatment outcome, Safety,
      Randomized controlled trial</p></section></body>`);
    const r = EX.extract(adapterById('pmc'), d, loc('https://pmc.ncbi.nlm.nih.gov/articles/PMC8800713/'));
    eq(r.keywords.length, 7, `抓到 ${JSON.stringify(r.keywords)}`);
    eq(r.keywords[0], 'Coronavirus disease 2019');
    no(r.keywords.some((k) => /^Keywords/i.test(k)), '「Keywords:」標籤不是關鍵字');
  });

  it('JAMA 用單數的 citation_keyword，一樣要收', () => {
    // 真站台驗出來的：JAMA 一個關鍵字一個 <meta name="citation_keyword">，
    // 只認複數的 citation_keywords 會全空。
    const d = doc(`<head><meta name="citation_title" content="T">
      <meta name="citation_keyword" content="Coronavirus">
      <meta name="citation_keyword" content="Pneumonia">
      <meta name="citation_keyword" content="Critical Care"></head><body></body>`);
    eq(C.readCitation(d).keywords.length, 3, JSON.stringify(C.readCitation(d).keywords));
  });

  it('關鍵字是一串沒有分隔的連結時要逐項取（Annals 就是這樣）', () => {
    // 真站台驗出來的：<a> 之間沒有任何空白或標點，整塊掃文字會黏成
    // 「Allergy and immunologyCOVID-19Disclosure…」，一個都認不出來，
    // 而且看起來像有抓到東西。
    const d = doc(`<head><meta name="citation_title" content="T"></head><body>
      <div class="keywords"><ol><li><a>Allergy and immunology</a></li>
      <li><a>COVID-19</a></li><li><a>Epidemiology</a></li></ol></div></body>`);
    const r = EX.extract(adapterById('generic'), d, loc('https://www.acpjournals.org/doi/10.7326/M20-0504'));
    eq(r.keywords.length, 3, `抓到 ${JSON.stringify(r.keywords)}`);
    eq(r.keywords[0], 'Allergy and immunology');
  });

  it('作者關鍵字與 MeSH 要分開存（控制詞彙的優勢不能丟掉）', () => {
    // PubMed：只有 MeSH，沒有作者關鍵字
    const pm = extractPubmed();
    eq(pm.meshTerms.length, 4, 'PubMed 的 MeSH');
    eq(pm.keywords.length, 0, 'PubMed 沒有作者關鍵字');
    // PMC：只有作者關鍵字，沒有 MeSH
    const d = doc('<body><section class="kwd-group"><p>Keywords: alpha, beta</p></section></body>');
    const pmc = EX.extract(adapterById('pmc'), d, loc('https://pmc.ncbi.nlm.nih.gov/articles/PMC1/'));
    eq(pmc.meshTerms.length, 0, 'PMC 沒有 MeSH');
    eq(pmc.keywords.length, 2, 'PMC 的作者關鍵字');
  });

  it('沒有 MeSH 的頁面不能因此壞掉（撤稿的論文常常沒有）', () => {
    const r = extractPubmed({ mesh: [] });
    eq(r.meshTerms.length, 0);
    ok(r.title, '其他欄位照樣要抽得到');
  });

  // ── 四之三、機構訂閱與登入 ───────────────────────────
  //
  // 擴充讀的是使用者眼睛看到的那一頁，登入是他自己在瀏覽器裡做的事，
  // 程式從頭到尾不碰帳密。這一組釘的是**沒登入時**的行為。

  describe('機構訂閱與登入');

  it('沒登入拿到截斷版時要警告，不能安靜地收下去', () => {
    const d = doc(`<head><meta name="citation_title" content="T">
      <meta name="citation_doi" content="10.1056/NEJMoa2401234"></head><body>
      <section class="abstract"><p>Severe acute respiratory syndrome is a condition that.</p></section>
      <div class="paywall-message">Sign in to continue reading this article.</div>
      </body>`);
    const r = EX.extract(adapterById('generic'), d, loc('https://www.nejm.org/doi/full/10.1056/NEJMoa2401234'));
    ok(r.access.restricted, '要標成受限');
    ok(r.access.quote, '要留下命中的原文給人判斷');
    const v = EX.verdict(r);
    ok(v.ok, '還是可以收');
    ok(/登入/.test(v.warn || ''), `警告是「${v.warn}」`);
  });

  it('摘要完整時不能因為頁面上有「Sign in」就亂喊', () => {
    // 「Sign in」幾乎每一家出版社的頁首都有；全文在付費牆後面也是常態。
    // 我們只收摘要，摘要拿到了就不是問題 —— 亂喊會讓警告失去意義。
    // fixture 要給 DOI。少了它 verdict 會回「沒有識別碼」的警告，
    // 而那是另一條規則 —— 混在一起的話，這條測試就分不出
    // 「訂閱牆誤報」和「缺識別碼」，等於沒測到要測的東西。
    const d = doc(`<head><meta name="citation_title" content="T">
      <meta name="citation_doi" content="10.1056/NEJMoa2401234"></head><body>
      <header><a>Sign in to continue</a></header>
      <section class="abstract"><p>${LONG_ABS_BG}</p><p>${LONG_ABS_ME}</p></section>
      <div class="paywall">Purchase access to read the full text.</div>
      </body>`);
    const r = EX.extract(adapterById('generic'), d, loc('https://www.example.org/a'));
    no(r.access.restricted, '摘要完整就不該警告');
    no(EX.verdict(r).warn, `不該有任何警告，實際「${EX.verdict(r).warn}」`);
  });

  it('沒有摘要也沒有訂閱牆（社論、Letter）不能被誤標成受限', () => {
    const d = doc(`<head><meta name="citation_title" content="An editorial">
      <meta name="citation_doi" content="10.1161/CIRCULATIONAHA.120.047008"></head><body>
      <h1>An editorial</h1></body>`);
    const r = EX.extract(adapterById('generic'), d, loc('https://www.ahajournals.org/doi/10.1161/x'));
    no(r.access.restricted, '沒有訂閱牆就不是受限，只是這篇沒有摘要');
    ok(r.missing.includes('摘要'), '但要照實說缺摘要');
  });

  it('機構代理伺服器的網址要還原成出版社原網域', () => {
    // 醫療工作者多半走圖書館 proxy 進機構訂閱，網址整個被換掉。
    // 不還原的話：同一篇算成兩份，而且存進知識庫的是只有那個機構
    // 打得開的死連結。
    const direct = ID.normUrl('https://www.nejm.org/doi/full/10.1056/NEJMoa2401234');
    eq(ID.normUrl('https://www.nejm.org.eproxy.lib.hku.hk/doi/full/10.1056/NEJMoa2401234'),
      direct, '後綴式 proxy');
    eq(ID.normUrl('https://www-nejm-org.ezproxy.lib.ntu.edu.tw/doi/full/10.1056/NEJMoa2401234'),
      direct, '連字號式 proxy');
    eq(ID.normUrl('https://www-nejm-org.idm.oclc.org/doi/full/10.1056/NEJMoa2401234'),
      direct, 'OCLC 代管');
  });

  it('正常網域不能被 deProxy 改壞（改壞了會變成 404 連結）', () => {
    eq(ID.deProxy('www.nature.com'), 'nature.com');
    eq(ID.deProxy('pubmed.ncbi.nlm.nih.gov'), 'pubmed.ncbi.nlm.nih.gov');
    eq(ID.deProxy('journals.plos.org'), 'journals.plos.org');
    eq(ID.deProxy('link.springer.com'), 'link.springer.com');
    eq(ID.deProxy('bmjopen.bmj.com'), 'bmjopen.bmj.com');
    eq(ID.deProxy('secure.jbs.elsevierhealth.com'), 'secure.jbs.elsevierhealth.com',
      '第一段是 secure 不算代理');
  });

  it('走 proxy 收的論文，指紋要跟直接連的一樣', () => {
    const viaProxy = {
      title: 'A conference abstract with no DOI at all',
      author: 'Smith J',
      pageUrl: 'https://www.example-journal.org.ezproxy.lib.ntu.edu.tw/abs/123',
    };
    const direct = {
      title: 'A conference abstract with no DOI at all',
      author: 'Smith J',
      pageUrl: 'https://www.example-journal.org/abs/123',
    };
    eq(ID.fingerprint(viaProxy), ID.fingerprint(direct));
  });

  // ── 五、adapter 的啟用範圍 ───────────────────────────
  //
  // 在搜尋結果頁上出現一顆按了會收到殼的按鈕，比沒有按鈕更糟。

  describe('adapter 啟用範圍');

  it('PubMed 的單篇文章頁要啟用', () => {
    const a = NS.adapterFor(loc(PUBMED_URL), doc('<html></html>'));
    ok(a, '認得出來');
    eq(a.id, 'pubmed');
  });

  it('PubMed 的搜尋結果頁不能啟用', () => {
    const a = NS.adapterFor(loc('https://pubmed.ncbi.nlm.nih.gov/?term=covid'), doc('<html></html>'));
    eq(a, null);
  });

  it('arXiv 的 /abs/ 要啟用，首頁不要', () => {
    ok(NS.adapterFor(loc('https://arxiv.org/abs/2401.12345'), doc('<html></html>')), '/abs/');
    eq(NS.adapterFor(loc('https://arxiv.org/'), doc('<html></html>')), null, '首頁');
  });

  it('出版社頁面有 citation_title 才啟用', () => {
    const paper = doc('<head><meta name="citation_title" content="T"></head><body></body>');
    const notPaper = doc('<head><title>Journal home</title></head><body></body>');
    const url = loc('https://www.nature.com/articles/s41586-024-01234-5');
    const a = NS.adapterFor(url, paper);
    ok(a, '有 citation_title');
    eq(a.id, 'generic');
    eq(NS.adapterFor(url, notPaper), null, '沒有書目資料的頁面');
  });

  it('沒有書目資料時 verdict 要擋下來，不能讓它寫進去', () => {
    const r = EX.extract(adapterById('generic'), doc('<body><p>hi</p></body>'), loc('https://x.org/a'));
    no(EX.verdict(r).ok, '要擋');
  });

  it('沒有 DOI／PMID 時要警告（去重只能靠標題）', () => {
    const d = doc('<head><meta name="citation_title" content="A local conference abstract"></head><body></body>');
    const r = EX.extract(adapterById('generic'), d, loc('https://repo.example.edu/item/42'));
    ok(EX.verdict(r).ok, '還是可以收');
    ok(EX.verdict(r).warn, '但要講清楚');
    no(r.hasStrongId);
  });

  // ── 六、識別碼的頁面後備 ─────────────────────────────

  describe('識別碼後備');

  it('meta 沒給 PMID 時要從網址撈', () => {
    const d = doc('<head><meta name="citation_title" content="T"></head><body></body>');
    const r = EX.extract(adapterById('pubmed'), d, loc(PUBMED_URL));
    eq(r.pmid, '38712345');
  });

  it('DOI 只能從本文的連結撈，不能從參考文獻撈（會張冠李戴）', () => {
    const d = doc(`<body>
      <div class="ref-list"><a href="https://doi.org/10.1111/other-paper">ref</a></div>
      </body>`);
    eq(EX.doiFromLinks(d), '', '參考文獻裡的不算');

    const d2 = doc('<body><a href="https://doi.org/10.1016/mine">this</a></body>');
    eq(EX.doiFromLinks(d2), '10.1016/mine', '本文的算');
  });

  it('canonicalUrl 要優先給 DOI（期刊換平台它還會轉對）', () => {
    eq(
      ID.canonicalUrl({ doi: '10.1016/j.example.2024.01.001', pmid: '123456' }),
      'https://doi.org/10.1016/j.example.2024.01.001',
    );
    eq(ID.canonicalUrl({ pmid: '123456' }), 'https://pubmed.ncbi.nlm.nih.gov/123456/');
  });

  // ── 七、命名與引用 ───────────────────────────────────

  describe('命名與引用');

  it('檔名是「發表年_第一作者姓_標題」，不是收錄日', () => {
    const r = extractPubmed();
    const stem = NAME.docStem(r);
    ok(stem.startsWith('2024_Smith_'), `檔名是 ${stem}`);
    no(/[\\/:*?"<>|]/.test(stem), '不能有檔名禁用字元');
  });

  it('沒有年份要寫 n.d.，不能拿收錄年份頂替', () => {
    const y = String(new Date().getFullYear());
    const stem = NAME.docStem({ title: 'X', surname: 'Smith', year: '' });
    ok(stem.startsWith('n.d._Smith_'), `檔名是 ${stem}`);
    no(stem.includes(y), '不能出現今年');
  });

  it('引用格式該有的都要在，缺的段落不能留下空標點', () => {
    const r = extractPublisher();
    const c = NAME.citation(r);
    ok(c.includes('Lancet'), '期刊');
    ok(c.includes('2024;403(10440):1801-1812'), `年卷期頁：${c}`);
    no(/;\s*\(/.test(c), '沒有卷號時不能留下「;(」');
    no(/\s\.\s/.test(c), '不能有孤立的句點');
  });

  it('預印本一定要標在來源行上', () => {
    ok(NAME.provenanceLine({ preprint: true }).includes('未經同儕審查'));
  });

  it('年份看起來不像年份就不要收（ISSN、館藏號會誤撈）', () => {
    eq(C.parseDate('0018-9235').year, '', 'ISSN 不是年份');
    eq(C.parseDate('2024/05/12').year, '2024');
    eq(C.parseDate('2024-05').date, '2024-05');
    eq(C.parseDate('3099').year, '', '太遠的未來');
  });

  it('三個站台三種日期格式都要認得出月日，不能只剩年份', () => {
    // 每一種都是拿真站台驗出來的，一開始三種我只寫對一種。
    eq(C.parseDate('2024/05/12').date, '2024-05-12', '出版社：年在前');
    eq(C.parseDate('05/12/2024').date, '2024-05-12', 'PubMed：美式 MM/DD/YYYY');
    eq(C.parseDate('2020 May 22').date, '2020-05-22', 'PMC：月份是英文名');
    eq(C.parseDate('2020 May').date, '2020-05', 'PMC：只到月');
    eq(C.parseDate('22 May 2020').date, '2020-05-22', '歐式：日在前');
    // 月份看不懂時退回「只有年份」是對的：年份仍然可靠，
    // 不可靠的是月日，那就不要編出來。
    eq(C.parseDate('2020 Foo 22').year, '2020', '年份還是留著');
    eq(C.parseDate('2020 Foo 22').date, '2020', '但不能編出月日');
  });

  // ── 八、抽出來的東西要能一路走到底 ───────────────────

  describe('端到端');

  it('PubMed 的一篇要能抽出完整紀錄', () => {
    const r = extractPubmed();
    eq(r.kind, 'paper');
    eq(r.source, 'pubmed');
    eq(r.journal, 'The Lancet');
    eq(r.year, '2024');
    eq(r.date, '2024-05-12', '美式 MM/DD/YYYY 要認得出月日');
    eq(r.doi, '10.1016/s0140-6736(24)00123-4');
    eq(r.pmid, '38712345');
    eq(r.meshTerms.length, 4, `MeSH 是 ${JSON.stringify(r.meshTerms)}`);
    ok(r.hasStrongId);
    eq(r.missing.length, 0, `缺 ${r.missing.join('、')}`);
    eq(r.permalink, 'https://doi.org/10.1016/s0140-6736(24)00123-4');
  });

  it('欄位是哪一層給的要記下來（不然「怎麼沒有摘要」永遠查不出來）', () => {
    const r = extractPubmed();
    eq(r.via.title, 'citation_title');
    eq(r.via.date, 'citation_date');
    ok(r.via.abstract, '摘要的來源選擇器要記下來');
  });

  // ── 輸出 ─────────────────────────────────────────────

  const box = document.getElementById('out');
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;

  const head = document.createElement('div');
  head.className = `head ${fail ? 'bad' : 'good'}`;
  head.textContent = fail
    ? `${fail} 個沒過（共 ${results.length}）`
    : `全部 ${results.length} 個通過`;
  box.appendChild(head);

  let last = '';
  results.forEach((r) => {
    if (r.group !== last) {
      last = r.group;
      const h = document.createElement('h2');
      h.textContent = r.group;
      box.appendChild(h);
    }
    const d = document.createElement('div');
    d.className = `case ${r.ok ? 'ok' : 'bad'}`;
    d.textContent = `${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `\n    ${r.msg}`}`;
    box.appendChild(d);
  });
})();
