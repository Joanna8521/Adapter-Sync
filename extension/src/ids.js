// =====================================================
// Adapter Sync — 識別碼與指紋
//
// 這一支存在的理由只有一個：**同一篇論文有很多個網址。**
//
//   https://pubmed.ncbi.nlm.nih.gov/38712345/
//   https://doi.org/10.1056/NEJMoa2401234
//   https://www.nejm.org/doi/full/10.1056/NEJMoa2401234
//   https://pmc.ncbi.nlm.nih.gov/articles/PMC11002233/
//
// 從 Google Scholar 點進去、從 PubMed 點進去、從期刊電子報點進去，
// 拿到的是四個不同的網址、同一篇論文。Post Sync 那套「permalink 當指紋」
// 在這裡會安靜地存成四份 —— 而重複收錄不會有任何錯誤訊息，
// 是三個月後翻資料夾才會發現的那種壞法。
//
// 所以指紋一律以**識別碼**為準，網址是最後手段。
//
// 純函式，不碰 DOM 也不碰 chrome.*：service worker 用 importScripts 載得動，
// 測試頁也載得動，兩邊跑的是同一份邏輯。
// =====================================================

(function () {
  'use strict';

  // 從網址、DOI 欄位、meta 標籤裡撈出來的字串什麼形狀都有：
  //   "https://doi.org/10.1000/xyz"  "doi:10.1000/xyz"  "DOI: 10.1000/xyz"
  //   "10.1000/xyz."（句尾的句點是文案的，不是 DOI 的一部分）
  // 全部收斂成一種：小寫、無前綴、無尾綴標點。
  //
  // 小寫化是安全的：DOI 規範明定比對時不分大小寫。反過來如果不小寫化，
  // 同一篇從兩個站台收就會因為 10.1056/NEJMoa 與 10.1056/nejmoa 變成兩份。
  function normDoi(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    s = s.replace(/^(doi|DOI)\s*[:：]\s*/i, '');
    s = s.replace(/^info:doi\//i, '');
    s = s.trim().toLowerCase();
    // 句尾標點：出版社常把 DOI 直接印在句子裡
    s = s.replace(/[.,;)\]}>'"]+$/, '');
    // 形狀不對就不要當 DOI 用。硬收一個壞值進指紋，
    // 會讓兩篇不相干的論文因為同一個壞值被判成重複。
    return /^10\.\d{4,9}\/\S+$/.test(s) ? s : '';
  }

  // PMID 是純數字。頁面上常寫成「PMID: 38712345」，網址是 /38712345/。
  function normPmid(raw) {
    const m = String(raw || '').match(/\b(\d{1,9})\b/);
    if (!m) return '';
    const v = m[1].replace(/^0+/, '');
    // 一位數、兩位數的 PMID 理論上存在（1950 年代的老文獻），但實務上
    // 更常是從別的數字誤撈進來的。太短的一律不收。
    return v.length >= 4 ? v : '';
  }

  function normPmcid(raw) {
    const m = String(raw || '').toUpperCase().match(/PMC(\d{4,})/);
    return m ? `PMC${m[1]}` : '';
  }

  // arXiv 有新舊兩種格式：
  //   新（2007-04 之後）2401.12345  或帶版本 2401.12345v2
  //   舊              math.GT/0309136
  //
  // **版本要剝掉。** v1 與 v2 是同一篇論文的兩個版本，不是兩篇論文。
  // 不剝的話，作者更新一版你就多收一份，而那兩份在資料夾裡長得一模一樣。
  // 剝掉之後想收新版還是收得到 —— 去重是「問一聲」不是「擋掉」，
  // 畫面會說「這篇收過了（v1）」並讓你按「仍要再收一次」。
  function normArxiv(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    s = s.replace(/^https?:\/\/(www\.)?arxiv\.org\/(abs|pdf)\//i, '');
    s = s.replace(/^arxiv\s*[:：]\s*/i, '');
    s = s.replace(/\.pdf$/i, '');
    const mNew = s.match(/^(\d{4}\.\d{4,5})(v\d+)?$/);
    if (mNew) return mNew[1];
    const mOld = s.match(/^([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?$/i);
    if (mOld) return mOld[1].toLowerCase();
    return '';
  }

  // 版本本身要留著顯示（「你收的是 v1，這頁是 v2」），只是不進指紋
  function arxivVersion(raw) {
    const m = String(raw || '').match(/(?:\d{4}\.\d{4,5}|\/\d{7})(v\d+)\b/);
    return m ? m[1] : '';
  }

  // 網址退到最後一步才用，而且要洗乾淨：
  // 追蹤參數不洗掉的話，同一篇每次點進來的網址都不一樣，去重整個失效。
  const JUNK_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'source', 'via',
    // NCBI 自己的追蹤與版面參數
    'otool', 'myncbishare', 'holding', 'term', 'from_term', 'from_pos',
    'from_page', 'from_exact_term', 'format', 'report', 'sort',
  ];

  // 機構代理伺服器（EZproxy／OpenAthens／OCLC）會把網域整個換掉：
  //
  //   直接連    https://www.nejm.org/doi/full/10.1056/NEJMoa2401234
  //   走 proxy  https://www.nejm.org.eproxy.lib.hku.hk/doi/full/10.1056/...
  //   連字號式  https://www-nejm-org.ezproxy.lib.ntu.edu.tw/doi/full/10.1056/...
  //
  // 對醫療工作者來說走 proxy 才是常態（機構訂閱都這樣進），而三個網址是
  // 同一篇論文。不還原的話：指紋的網址後備會把它們算成不同篇，而且存進
  // 知識庫的連結是**只有那個機構、那個 session 才打得開**的位址，
  // 換一台電腦點下去就是死連結。
  //
  // 有 DOI 的時候這件事不影響（指紋與連結都走 DOI），但沒有 DOI 的
  // 會議摘要、機構典藏就全靠這一段。
  // 只列「名字裡沒有 proxy 兩個字」的那幾家；其餘由下面的 /proxy/i 通則涵蓋。
  // 刻意**不**收 sp／login／secure 這類太常見的字 —— 它們出現在正常網域裡的
  // 機率比出現在代理網域裡高，收了會把好好的網址改壞，而改壞的症狀是
  // 「連結點下去是 404」，比漏還原難查。
  const PROXY_MARKERS = /^(remotexs|openathens|idm)$/i;

  function deProxy(hostname) {
    const host = String(hostname || '').toLowerCase();
    const labels = host.split('.');
    // 從第二段開始找代理標記；找到就把它與後面的機構網域整段砍掉。
    // 從第二段開始是刻意的 —— 第一段砍掉就什麼都不剩了。
    for (let i = 1; i < labels.length; i++) {
      if (!PROXY_MARKERS.test(labels[i]) && !/proxy/i.test(labels[i])) continue;
      const head = labels.slice(0, i);
      // 連字號式：`www-nejm-org.ezproxy.…` 的第一段是把點換成連字號。
      // 還原的判準是「換回點之後長得像一個網域」，不是看有沒有連字號
      // ——真的有出版社網域自己就帶連字號（sci-hub 那種不算，但
      // `bmj-open` 這類是有的），亂換會把好好的網域改壞。
      if (head.length === 1 && head[0].includes('-')) {
        const restored = head[0].replace(/-/g, '.');
        if (/^([a-z0-9]+\.)+[a-z]{2,}$/.test(restored)) return restored.replace(/^www\./, '');
      }
      if (head.length >= 2) return head.join('.').replace(/^www\./, '');
      break;
    }
    return host.replace(/^www\./, '');
  }

  function normUrl(raw) {
    try {
      const u = new URL(String(raw));
      if (!/^https?:$/.test(u.protocol)) return '';
      JUNK_PARAMS.forEach((k) => u.searchParams.delete(k));
      u.hash = '';
      u.hostname = deProxy(u.hostname);
      // 尾斜線有無不該算兩篇
      u.pathname = u.pathname.replace(/\/+$/, '') || '/';
      return u.toString();
    } catch (_) {
      return '';
    }
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h.toString(36);
  }

  // 指紋。優先序就是「哪一個最能代表『同一篇論文』」的排序。
  //
  // **刻意跟 Post Sync 不一樣的地方：指紋裡不放來源站台。**
  // 社群那邊放平台是對的（同一段話發在 FB 和 LinkedIn 是兩則貼文）；
  // 文獻這邊放了就等於自廢武功 —— 從 PubMed 收和從 NEJM 收會變成兩份，
  // 而那正是這支檔案要解決的問題。
  function fingerprint(p) {
    const doi = normDoi(p && p.doi);
    if (doi) return `doi:${doi}`;

    const pmid = normPmid(p && p.pmid);
    if (pmid) return `pmid:${pmid}`;

    const ax = normArxiv(p && p.arxivId);
    if (ax) return `arxiv:${ax}`;

    const pmc = normPmcid(p && p.pmcid);
    if (pmc) return `pmcid:${pmc}`;

    const url = normUrl((p && p.permalink) || (p && p.pageUrl) || '');
    if (url) return `url:${hashStr(url)}`;

    // 什麼識別碼都沒有的頁面（少見，但會發生：會議摘要、機構典藏）。
    // 標題＋第一作者比純標題可靠 —— 同名標題在文獻裡是真的會出現的。
    const title = String((p && p.title) || '').toLowerCase().replace(/\s+/g, '');
    const who = String((p && p.author) || '').toLowerCase().replace(/\s+/g, '');
    if (title.length >= 8) return `t:${hashStr(`${title}|${who}`)}`;
    return '';
  }

  // 這篇有沒有一個「拿得出去」的識別碼？沒有的話下游要講清楚，
  // 因為那代表去重只能靠標題，可靠度差一個等級。
  function hasStrongId(p) {
    return !!(normDoi(p && p.doi) || normPmid(p && p.pmid)
      || normArxiv(p && p.arxivId) || normPmcid(p && p.pmcid));
  }

  // 給人點的連結。DOI 是唯一保證長期有效的 —— 期刊改版、換平台、
  // 甚至被別家買走，doi.org 都還會轉到對的地方。
  function canonicalUrl(p) {
    const doi = normDoi(p && p.doi);
    if (doi) return `https://doi.org/${doi}`;
    const pmid = normPmid(p && p.pmid);
    if (pmid) return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
    const ax = normArxiv(p && p.arxivId);
    if (ax) return `https://arxiv.org/abs/${ax}`;
    const pmc = normPmcid(p && p.pmcid);
    if (pmc) return `https://pmc.ncbi.nlm.nih.gov/articles/${pmc}/`;
    return normUrl((p && p.permalink) || (p && p.pageUrl) || '');
  }

  self.ADAPTER_SYNC_IDS = {
    normDoi, normPmid, normPmcid, normArxiv, arxivVersion, normUrl, deProxy,
    hashStr, fingerprint, hasStrongId, canonicalUrl, JUNK_PARAMS,
  };
})();
