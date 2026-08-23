// =====================================================
// Adapter Sync — 引用中繼資料抽取層
//
// 文獻站台跟社群平台最大的差別在這裡：**書目資料是有契約的。**
//
// `<meta name="citation_*">` 是 Highwire Press 標準，Google Scholar 靠它索引。
// 出版社不敢亂改 —— 改了就從 Scholar 上消失，那是真金白銀的損失。
// 所以這一層的穩定度跟臉書那種「class 是亂數、每次發版都變」完全不同等級，
// 這也是文獻類 adapter 值得做的根本原因。
//
// 三層，由準到不準，而且**要記錄是哪一層給的**（provenance）：
//   1. citation_*  Highwire，最準，PubMed／arXiv／幾乎所有出版社都有
//   2. DC.*        Dublin Core，機構典藏與部分歐洲出版社
//   3. JSON-LD     schema.org ScholarlyArticle，近年新平台愛用
//   4. og:*        最後手段，只有標題與一段描述
//
// 沒記 provenance 的話，「這篇怎麼只有標題」永遠查不出是站台沒給、
// 還是我們讀錯地方。
//
// ⚠️ 這一層**不能**沿用 Post Sync 的 readable()。那支走的是
// TreeWalker(SHOW_TEXT) 加「看不見的元素跳過」，而 <meta> 在 <head> 裡、
// 值在 content 屬性上：既不是文字節點，也必定被判定為不可見。
// 硬接的結果是一個字都抽不到，而且看起來像「這個站台沒有 meta」。
// =====================================================

(function () {
  'use strict';

  // 反爬用的不可見字元在文獻站台罕見，但 PDF 轉出來的標題常帶軟連字號
  // 與零寬字元。留著會一路變成檔名與指紋的一部分。
  // 一定要寫跳脫形式 —— 字面上的不可見字元寫進原始碼，看不見、
  // 複製不可靠、grep 也找不到。
  const INVISIBLE = /[\u00AD\u034F\u200B-\u200F\u2060-\u2064\u206A-\u206F\uFEFF]/g;

  function clean(s) {
    return String(s == null ? '' : s)
      .replace(INVISIBLE, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 摘要要保留段落，不能像標題那樣把換行壓掉 ——
  // 結構式摘要（Background / Methods / Results / Conclusions）壓成一段
  // 就失去它最有用的東西。
  function cleanBlock(s) {
    return String(s == null ? '' : s)
      .replace(INVISIBLE, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // meta 的 name 大小寫在各站台完全不統一：
  //   DC.Title / dc.title / DC.title 三種都遇得到。
  // CSS 的屬性值比對預設分大小寫，所以一定要帶 `i` 旗標，
  // 否則 Dublin Core 那一層會在某些站台安靜地整層落空。
  function metaAll(doc, name) {
    const esc = String(name).replace(/"/g, '\\"');
    const out = [];
    const sel = `meta[name="${esc}" i], meta[property="${esc}" i]`;
    let nodes;
    try {
      nodes = doc.querySelectorAll(sel);
    } catch (_) {
      return out; // 選擇器組壞了不能讓整層抽取死掉
    }
    for (const m of nodes) {
      const v = clean(m.getAttribute('content'));
      if (v) out.push(v);
    }
    return out;
  }

  function meta(doc, name) {
    return metaAll(doc, name)[0] || '';
  }

  // 依序試多個名稱，回第一個有值的，並回報是誰給的
  function metaFirst(doc, names) {
    for (const n of names) {
      const v = meta(doc, n);
      if (v) return { value: v, from: n };
    }
    return { value: '', from: '' };
  }

  // ── 作者 ─────────────────────────────────────────────

  // citation_author 是**重複出現**的標籤，一位作者一個。querySelector 只拿
  // 第一個，就會把一篇二十人的論文變成單一作者。這是把社群那套
  // 「author 是一個字串」直接套過來最容易踩的坑。
  //
  // 少數站台改用 citation_authors，一個標籤塞全部、分號或分號加空白隔開。
  //
  // **PubMed 走的正是後者**：它只給一個 citation_authors，內容像
  // 「Mehra MR;Desai SS;Ruschitzka F;Patel AN;」（分號隔開、而且結尾還有
  // 一個分號）。只認 citation_author 的話，在 PubMed 上作者會全空。
  function authorsWithSource(doc) {
    let list = metaAll(doc, 'citation_author');
    let from = list.length ? 'citation_author' : '';
    if (!list.length) {
      const lumped = meta(doc, 'citation_authors');
      if (lumped) { list = lumped.split(/\s*;\s*/); from = 'citation_authors'; }
    }
    if (!list.length) {
      list = metaAll(doc, 'DC.Creator');
      if (list.length) from = 'DC.Creator';
    }
    if (!list.length) {
      list = metaAll(doc, 'dc.creator');
      if (list.length) from = 'dc.creator';
    }
    return { list, from };
  }

  function authors(doc) {
    return authorsWithSource(doc).list
      .map((s) => clean(s).replace(/[,;]\s*$/, ''))
      .filter((s) => s && s.length <= 120)
      // 同一個名字重複出現是常態（有些站台每個單位掛一次）
      .filter((s, i, arr) => arr.indexOf(s) === i);
  }

  // 姓氏。引用格式的檔名要「第一作者的姓」，而各站台寫法不統一：
  //   "Smith, John A"      逗號前是姓
  //   "John A Smith"       最後一段是姓
  //   "van der Berg, Anna" 逗號前整段都是姓
  //   "Chen M-L"           PubMed 的縮寫格式，第一段就是姓
  //
  // 猜錯的代價是整個資料夾的檔名都用名字排序，翻起來完全找不到人。
  function surnameOf(name) {
    const s = clean(name);
    if (!s) return '';
    if (s.includes(',')) return clean(s.split(',')[0]);
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0];
    const last = parts[parts.length - 1];
    // PubMed 格式「Chen ML」：最後一段是全大寫的縮寫，姓在前面
    if (/^[A-Z]{1,3}$/.test(last) || /^([A-Z]\.){1,3}$/.test(last)) {
      return parts.slice(0, -1).join(' ');
    }
    // 「van der Berg」這種前綴要跟著姓一起帶。
    // 荷語系的前綴會**疊兩層**（van der／van den／van de），所以
    // der／den／de 這些第二層的也要列進來，只列 van 的話會切成「Berg」。
    const PREFIX = new RegExp(`^(${[
      'van', 'von', 'der', 'den', 'de', 'del', 'della', 'delle', 'degli',
      'di', 'da', 'das', 'dos', 'do', 'du', 'dal', 'la', 'le', 'el', 'al',
      'ten', 'ter', 'te', 'zu', 'bin', 'ibn', 'mac', 'mc', 'st',
    ].join('|')})$`, 'i');
    let i = parts.length - 1;
    while (i > 0 && PREFIX.test(parts[i - 1])) i--;
    return parts.slice(i).join(' ');
  }

  // 正規化成 Vancouver 的「姓 縮寫」（Jumper J、Smith JA、van der Berg A）。
  //
  // 這件事非做不可，因為各站台給的形狀不同，而**逗號格式直接串起來會
  // 變成無法閱讀的東西**：Nature 給的是「Jumper, John」，三十四位作者
  // 用逗號接起來就是
  //   「Jumper, John, Evans, Richard, Pritzel, Alexander, …」
  // 完全分不出哪個是姓、哪個是名、到哪裡換人。而那一行是要拿去貼進
  // 論文和 email 的。
  function vancouverName(name) {
    const s = clean(name);
    if (!s) return '';
    const surname = surnameOf(s);
    if (!surname) return s;

    let given = '';
    if (s.includes(',')) given = s.slice(s.indexOf(',') + 1);
    else if (s.startsWith(surname)) given = s.slice(surname.length);
    else given = s.slice(0, s.length - surname.length);

    const initials = clean(given)
      .split(/[\s.\-]+/)
      .filter(Boolean)
      // 已經是縮寫的（PubMed 的「ML」）整段留著；全名的才取第一個字母。
      // 不分辨的話「Chen ML」會被縮成「Chen M」，少掉一個字母。
      .map((w) => (/^[A-Z]{1,3}$/.test(w) ? w : w[0].toUpperCase()))
      .join('');
    return initials ? `${surname} ${initials}` : surname;
  }

  // ── 日期 ─────────────────────────────────────────────

  // citation_publication_date 的格式各家不同：
  //   2024/05/12   2024-05-12   2024-05   2024   2024/5/3
  // 只取得到年份也完全夠用（引用格式只要年），所以寧可退到年份，
  // 也不要硬湊一個假的完整日期。
  function parseDate(raw) {
    const s = clean(raw);
    if (!s) return { year: '', date: '' };

    // PubMed 的 citation_date 是**美式的 MM/DD/YYYY**（例如 05/22/2020），
    // 年份在最後面。用「找第一個四位數」的通則掃它，年份剛好還是對的，
    // 但月日會整個掉；而 PubMed 是主力站台，值得單獨認一次。
    const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (us) {
      const yi = parseInt(us[3], 10);
      if (yi < 1500 || yi > new Date().getFullYear() + 2) return { year: '', date: '' };
      const p = (v) => String(v).padStart(2, '0');
      return { year: us[3], date: `${us[3]}-${p(us[1])}-${p(us[2])}` };
    }

    // PMC 的 citation_publication_date 是「2020 May 22」——月份是英文縮寫。
    // 用通則掃它年份還是對的，但月日會整個掉，而 PMC 是內建站台之一。
    // 「22 May 2020」的歐式寫法也一起認掉，成本一樣。
    const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
    const monIndex = (w) => MONTHS.indexOf(String(w).slice(0, 3).toLowerCase()) + 1;
    const named = s.match(/^(\d{4})\s+([A-Za-z]{3,9})\.?(?:\s+(\d{1,2}))?$/)
      || s.match(/^(?:(\d{1,2})\s+)?([A-Za-z]{3,9})\.?\s+(\d{4})$/);
    if (named) {
      // 兩種寫法的年與日在不同的捕獲組上，靠「哪一組是四位數」分辨
      const isYearFirst = /^\d{4}$/.test(named[1] || '');
      const y2 = isYearFirst ? named[1] : named[3];
      const d2 = isYearFirst ? named[3] : named[1];
      const mi = monIndex(named[2]);
      const yi2 = parseInt(y2, 10);
      if (mi > 0 && yi2 >= 1500 && yi2 <= new Date().getFullYear() + 2) {
        const p = (v) => String(v).padStart(2, '0');
        let out = `${y2}-${p(mi)}`;
        if (d2) out += `-${p(d2)}`;
        return { year: y2, date: out };
      }
    }

    const m = s.match(/(\d{4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?/);
    if (!m) return { year: '', date: '' };
    const y = m[1];
    // 未來太遠或太古老的年份多半是抓錯欄位（ISSN、電話、館藏號）
    const yi = parseInt(y, 10);
    if (yi < 1500 || yi > new Date().getFullYear() + 2) return { year: '', date: '' };
    const pad = (v) => String(v).padStart(2, '0');
    let date = y;
    if (m[2]) date += `-${pad(m[2])}`;
    if (m[2] && m[3]) date += `-${pad(m[3])}`;
    return { year: y, date };
  }

  function firstDate(doc) {
    const names = [
      'citation_publication_date',
      'citation_date',
      'citation_online_date',
      'citation_cover_date',
      'prism.publicationDate',
      'DC.Date',
      'article:published_time',
    ];
    for (const n of names) {
      const got = parseDate(meta(doc, n));
      if (got.year) return { ...got, from: n };
    }
    const y = clean(meta(doc, 'citation_year'));
    if (/^\d{4}$/.test(y)) return { year: y, date: y, from: 'citation_year' };
    return { year: '', date: '', from: '' };
  }

  // ── JSON-LD ──────────────────────────────────────────
  //
  // 第三層。近年的平台（Frontiers、MDPI、部分 Elsevier 頁面）把書目
  // 放在 schema.org 的 JSON-LD 裡，而不是 meta 標籤。
  //
  // JSON.parse 一定要包起來：頁面上的 JSON-LD 壞掉是常態（尾逗號、
  // 被模板引擎截斷），一個壞區塊不能讓整層抽取死掉。
  function jsonLd(doc) {
    const out = [];
    let nodes;
    try {
      nodes = doc.querySelectorAll('script[type="application/ld+json"]');
    } catch (_) {
      return out;
    }
    for (const s of nodes) {
      let data;
      try {
        data = JSON.parse(s.textContent || '');
      } catch (_) {
        continue;
      }
      // @graph 包一層、或整個就是一個陣列，兩種都遇得到
      const items = Array.isArray(data) ? data
        : (Array.isArray(data['@graph']) ? data['@graph'] : [data]);
      for (const it of items) {
        if (it && typeof it === 'object') out.push(it);
      }
    }
    return out;
  }

  const SCHOLARLY = /^(ScholarlyArticle|Article|MedicalScholarlyArticle|Report|Dataset)$/i;

  function fromJsonLd(doc) {
    const got = { title: '', authors: [], doi: '', abstract: '', journal: '', date: '' };
    for (const it of jsonLd(doc)) {
      const t = it['@type'];
      const types = Array.isArray(t) ? t : [t];
      if (!types.some((x) => SCHOLARLY.test(String(x || '')))) continue;

      if (!got.title && it.headline) got.title = clean(it.headline);
      if (!got.title && it.name) got.title = clean(it.name);
      if (!got.abstract && it.abstract) got.abstract = cleanBlock(it.abstract);
      if (!got.date && it.datePublished) got.date = clean(it.datePublished);

      if (!got.authors.length && it.author) {
        const list = Array.isArray(it.author) ? it.author : [it.author];
        got.authors = list
          .map((a) => clean(typeof a === 'string' ? a : (a && a.name) || ''))
          .filter(Boolean);
      }
      if (!got.journal && it.isPartOf) {
        const p = it.isPartOf;
        got.journal = clean((p && (p.name || (p.isPartOf && p.isPartOf.name))) || '');
      }
      if (!got.doi) {
        const ident = it.identifier || it.sameAs || '';
        const list = Array.isArray(ident) ? ident : [ident];
        for (const v of list) {
          const s = clean(typeof v === 'string' ? v : (v && v.value) || '');
          if (/10\.\d{4,9}\//.test(s)) { got.doi = s; break; }
        }
      }
    }
    return got;
  }

  // ── 主入口 ───────────────────────────────────────────
  //
  // 回傳的東西刻意保留 `missing` 與 `via`：
  // 「這篇怎麼沒有摘要」要能當場回答是站台沒給、還是我們沒讀到。
  function readCitation(doc) {
    const d = doc || document;

    const titleGot = metaFirst(d, [
      'citation_title', 'DC.Title', 'dc.title', 'prism.title', 'og:title',
    ]);
    const authorsGot = authorsWithSource(d);
    const list = authors(d);
    const dateGot = firstDate(d);

    // **不要拿 og:site_name 當期刊名。** 它是網站名不是刊名，
    // 在 arXiv 上會變成「arXiv.org」、在出版社上會變成「Nature Portfolio」，
    // 然後一路寫進引用格式的期刊欄位——產出一個看起來很正常、其實是錯的引用。
    // 抓不到刊名就留空，讓引用少一段，比多一段假的好。
    const journalGot = metaFirst(d, [
      'citation_journal_title', 'citation_conference_title',
      'citation_technical_report_institution', 'citation_dissertation_institution',
      'prism.publicationName', 'DC.Source',
    ]);

    const abstractGot = metaFirst(d, [
      'citation_abstract', 'dcterms.abstract', 'DC.Description',
      'description', 'og:description',
    ]);

    const out = {
      title: titleGot.value,
      authors: list,
      journal: journalGot.value,
      journalAbbrev: meta(d, 'citation_journal_abbrev'),
      publisher: meta(d, 'citation_publisher') || meta(d, 'DC.Publisher'),
      year: dateGot.year,
      date: dateGot.date,
      volume: meta(d, 'citation_volume'),
      issue: meta(d, 'citation_issue'),
      firstPage: meta(d, 'citation_firstpage'),
      lastPage: meta(d, 'citation_lastpage'),
      doi: meta(d, 'citation_doi') || meta(d, 'DC.Identifier') || meta(d, 'dc.identifier'),
      pmid: meta(d, 'citation_pmid'),
      pmcid: meta(d, 'citation_pmcid'),
      arxivId: meta(d, 'citation_arxiv_id'),
      issn: meta(d, 'citation_issn'),
      pdfUrl: meta(d, 'citation_pdf_url') || meta(d, 'citation_fulltext_html_url'),
      abstract: abstractGot.value,
      // 複數與單數兩種都要收：JAMA 用的是 **citation_keyword（單數）**、
      // 一個關鍵字一個標籤，只認複數的話 JAMA 的關鍵字會全空。
      keywords: metaAll(d, 'citation_keywords').concat(metaAll(d, 'citation_keyword'))
        .flatMap((v) => v.split(/\s*[;,]\s*/))
        .map(clean)
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i),
      via: {
        title: titleGot.from,
        journal: journalGot.from,
        date: dateGot.from,
        abstract: abstractGot.from,
        authors: list.length ? authorsGot.from : '',
      },
    };

    // 第三層：meta 落空的欄位才問 JSON-LD。有 meta 就不要覆蓋——
    // JSON-LD 的品質普遍比 Highwire 差（常常整段 HTML 塞在 abstract 裡）。
    const needsJsonLd = !out.title || !out.authors.length || !out.doi || !out.abstract;
    if (needsJsonLd) {
      const j = fromJsonLd(d);
      if (!out.title && j.title) { out.title = j.title; out.via.title = 'json-ld'; }
      if (!out.authors.length && j.authors.length) {
        out.authors = j.authors;
        out.via.authors = 'json-ld';
      }
      if (!out.doi && j.doi) out.doi = j.doi;
      if (!out.abstract && j.abstract) { out.abstract = j.abstract; out.via.abstract = 'json-ld'; }
      if (!out.journal && j.journal) { out.journal = j.journal; out.via.journal = 'json-ld'; }
      if (!out.year && j.date) {
        const p = parseDate(j.date);
        out.year = p.year;
        out.date = p.date;
        out.via.date = 'json-ld';
      }
    }

    // `og:description` 常常是行銷文案而不是摘要（「Read the latest research
    // from ...」）。太短的一律不當摘要用，寧可留空讓下游去頁面上找。
    if (out.abstract && /^(og:description|description)$/.test(out.via.abstract)
      && out.abstract.length < 200) {
      out.abstract = '';
      out.via.abstract = '';
    }

    out.missing = ['title', 'authors', 'year', 'doi', 'abstract']
      .filter((k) => (Array.isArray(out[k]) ? !out[k].length : !out[k]));

    return out;
  }

  // 這一頁到底是不是一篇文獻？通用 adapter 靠它決定要不要出現按鈕。
  // 判準要保守：認錯的話使用者會在一堆列表頁上看到一顆按了收到垃圾的按鈕。
  function looksLikePaper(doc) {
    const d = doc || document;
    if (meta(d, 'citation_title')) return true;
    if (meta(d, 'citation_doi')) return true;
    if (meta(d, 'DC.Title') && meta(d, 'DC.Creator')) return true;
    const j = fromJsonLd(d);
    return !!(j.title && (j.doi || j.authors.length));
  }

  self.ADAPTER_SYNC_CITATION = {
    clean, cleanBlock, meta, metaAll, metaFirst, authors, authorsWithSource, surnameOf, vancouverName,
    parseDate, firstDate, jsonLd, fromJsonLd, readCitation, looksLikePaper,
    INVISIBLE,
  };
})();
