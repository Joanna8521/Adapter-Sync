// =====================================================
// Adapter Sync — 命名與引用格式
//
// 檔名錯了不會有任何錯誤訊息，只會在三個月後翻資料夾的時候發現
// 一整排「未命名_未署名」。Post Sync 就是因為這個才把命名獨立成一支。
//
// 但文獻的命名跟社群完全不同，不能沿用：
//
//   社群：日期_主題_發文者      日期是**收錄日**，主題靠猜內文第一行
//   文獻：年份_第一作者姓_標題   年份是**發表年**，標題是站台明講的
//
// 收錄日對文獻幾乎沒有意義（今天收一篇 2003 年的經典，檔名寫 2026
// 只會讓人找不到）。而標題不用猜——citation_title 就是它。
//
// 純函式，不碰 DOM 也不碰 chrome.*：service worker 用 importScripts
// 載得動，測試頁也載得動。
// =====================================================

(function () {
  'use strict';

  function sanitizeName(s) {
    return String(s || '')
      .replace(/[\/\\:*?"<>|\r\n]/g, ' ') // 檔名不能有的字元
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 標題要留得夠長才認得出是哪一篇，但不能長到整個檔名被 Drive 截掉。
  // 醫學論文的標題動輒一百多字，砍在句子中間比砍在標點好認。
  function shortTitle(raw, cap = 60) {
    let s = sanitizeName(raw);
    if (!s) return '';
    // 副標題通常可以砍掉，主標題已經夠識別
    const cut = s.search(/\s*[:：]\s/);
    if (cut > 12 && cut < cap) s = s.slice(0, cut);
    if (s.length <= cap) return s;
    const head = s.slice(0, cap);
    const sp = head.lastIndexOf(' ');
    return (sp > cap * 0.6 ? head.slice(0, sp) : head).trim();
  }

  // 沒有年份就寫 n.d.（no date），這是引用格式的標準寫法。
  // 寫成收錄年份會讓人以為那是發表年，那是更糟的錯。
  function yearOf(p) {
    const y = String((p && p.year) || '').trim();
    return /^\d{4}$/.test(y) ? y : 'n.d.';
  }

  function surnameOf(p) {
    const s = sanitizeName((p && p.surname) || '');
    if (s) return s.slice(0, 24);
    const a = sanitizeName((p && p.author) || '');
    return a ? a.slice(0, 24) : 'Anon';
  }

  // 檔名主體。Drive 的 Doc 名稱與知識庫的 .md 檔名共用同一份——
  // 兩邊各拼一份的話遲早會分岔，而分岔了也不會有人發現。
  //
  // 撤稿的論文在檔名最前面加一個記號。理由是知識庫與 Drive 的清單頁
  // 只看得到檔名，而「這篇被撤稿了」是那種**不能只寫在內文裡**的事。
  function docStem(p) {
    const flag = (p && p.integrity && p.integrity.retracted && !p.integrity.notice)
      ? '【撤稿】' : '';
    const t = shortTitle((p && p.title) || '') || '未命名文獻';
    return `${flag}${yearOf(p)}_${surnameOf(p)}_${t}`;
  }

  // ── 引用格式 ─────────────────────────────────────────

  // 作者列。Vancouver（醫學標準）的規則是：六位以內全列，超過列前六位
  // 再加 et al。這裡照做，因為使用者多半是醫療工作者。
  //
  // 名字**一定要先正規化**再串。站台給什麼就串什麼的話，Nature 那種
  // 「Jumper, John」會接成「Jumper, John, Evans, Richard, …」——
  // 逗號同時當姓名分隔與作者分隔，人眼完全解不開。
  //
  // 正規化在 citation.js（那裡才有姓氏判斷）。service worker 也載得到，
  // 但測試頁可能只載了 naming.js，所以拿不到就退回原字串，不能整個炸掉。
  function vancouver(name) {
    const C = self.ADAPTER_SYNC_CITATION;
    return (C && C.vancouverName) ? C.vancouverName(name) : String(name || '');
  }

  function authorsLine(p) {
    const list = (p && Array.isArray(p.authors) ? p.authors : [])
      .filter(Boolean)
      .map(vancouver)
      .filter(Boolean);
    if (!list.length) return '';
    if (list.length <= 6) return list.join(', ');
    return `${list.slice(0, 6).join(', ')}, et al`;
  }

  // 一整行的引用。貼進論文、貼進 email、丟給同事都直接可用。
  //
  //   Smith J, Chen ML, et al. Title of the paper. N Engl J Med. 2024;390(3):201-210.
  //   doi:10.1056/NEJMoa2401234. PMID: 38712345.
  function citation(p) {
    const bits = [];
    const who = authorsLine(p);
    if (who) bits.push(`${who}.`);
    if (p && p.title) bits.push(`${String(p.title).replace(/\s*\.\s*$/, '')}.`);

    // 刊名縮寫本身常常就以句點結尾（「Front. Immunol.」「N Engl J Med」），
    // 無條件補一個就變成「Front. Immunol..」。
    const venue = (p && (p.journalAbbrev || p.journal)) || '';
    if (venue) bits.push(/\.$/.test(venue) ? venue : `${venue}.`);

    // 年份;卷(期):頁 —— 少哪一段就跳過哪一段，不要留下空的標點
    let loc = '';
    if (p && p.year) loc += p.year;
    if (p && p.volume) loc += `;${p.volume}`;
    if (p && p.issue) loc += `(${p.issue})`;
    if (p && p.pages) loc += `:${p.pages}`;
    if (loc) bits.push(`${loc}.`);

    if (p && p.doi) bits.push(`doi:${p.doi}.`);
    if (p && p.pmid) bits.push(`PMID: ${p.pmid}.`);
    if (p && p.arxivId) bits.push(`arXiv:${p.arxivId}${p.arxivVersion || ''}.`);
    return bits.join(' ').replace(/\s+/g, ' ').trim();
  }

  // 給知識庫檢索用的一行摘要標頭。切片之後每一片都會帶著它，
  // 檢索回來才知道這段話出自哪一篇、是不是預印本、有沒有被撤稿。
  function provenanceLine(p) {
    const bits = [];
    if (p && p.integrity && p.integrity.retracted && !p.integrity.notice) {
      bits.push('⚠️ 已撤稿');
    }
    if (p && p.integrity && p.integrity.concern) bits.push('⚠️ 期刊已表達關切');
    if (p && p.preprint) bits.push('預印本・未經同儕審查');
    const venue = (p && (p.journal || p.journalAbbrev)) || '';
    if (venue) bits.push(venue);
    if (p && p.year) bits.push(p.year);
    return bits.join('・');
  }

  self.ADAPTER_SYNC_NAME = {
    sanitizeName, shortTitle, yearOf, surnameOf, docStem,
    authorsLine, citation, provenanceLine,
  };
})();
