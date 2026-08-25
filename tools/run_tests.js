#!/usr/bin/env node
// =====================================================
// Adapter Sync — 在終端機跑抽取層測試
//
// `tests/run.html` 是主要路徑：用瀏覽器直接打開就跑，不需要裝任何東西。
// 這一支是**備援**，給兩種情況用：
//   一、CI，或任何沒有瀏覽器的地方
//   二、開不了瀏覽器的時候（我就遇過整輪都開不了，結果推了一版沒跑過測試的碼）
//
// 跑的是**同一份** extension/src/*.js 與**同一份** tests/run.js。
// 另外寫一套 Node 版測試等於測到別的東西，那比沒有測試更危險。
//
// 用法：
//   npm install jsdom          （或 npm i -g jsdom，或設好 NODE_PATH）
//   node tools/run_tests.js
//
// 離開碼：0 全過｜1 有測試沒過｜2 根本沒跑起來（載入或語法出錯）
// =====================================================

const fs = require('fs');
const path = require('path');

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (_) {
  console.error(
    '找不到 jsdom。這支是備援跑法，需要它；主要路徑不用裝任何東西：\n'
    + '  直接用瀏覽器打開 tests/run.html\n\n'
    + '要用這一支的話：\n'
    + '  npm install jsdom          （裝在這個資料夾）\n'
    + '  npm install -g jsdom       （裝成全域，再設 NODE_PATH=$(npm root -g)）',
  );
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'extension', 'src');
// 順序等同 manifest.json 的 content_scripts.js（少了 content.js，
// 那支碰 chrome.*，不屬於抽取層）
const FILES = ['ids.js', 'citation.js', 'adapters.js', 'extract.js', 'naming.js'];

const dom = new JSDOM(
  '<!doctype html><html><body><div id="out"></div></body></html>',
  { url: 'https://example.org/', runScripts: 'outside-only' },
);
const { window } = dom;

for (const f of FILES) {
  try {
    window.eval(fs.readFileSync(path.join(SRC, f), 'utf8'));
  } catch (e) {
    console.error(`原始碼載入失敗 — ${f}：${e.message}`);
    process.exit(2);
  }
}

try {
  window.eval(fs.readFileSync(path.join(ROOT, 'tests', 'run.js'), 'utf8'));
} catch (e) {
  console.error(`測試檔本身炸了：${e.message}\n${e.stack}`);
  process.exit(2);
}

const out = window.document.getElementById('out');
const cases = [...out.querySelectorAll('.case')];
const bad = cases.filter((c) => c.classList.contains('bad'));

// 一條都沒跑到就不能算通過。沉默的成功是最糟的失敗模式 ——
// 這整個專案抓到的問題，十之八九都是「安靜地什麼都沒做」。
if (!cases.length) {
  console.error('沒有任何測試被執行。測試檔可能在頂層就結束了。');
  process.exit(2);
}

const head = out.querySelector('.head');
console.log(head ? head.textContent : `${cases.length - bad.length}/${cases.length} 通過`);
if (bad.length) {
  console.log('');
  bad.forEach((b) => console.log(b.textContent.trim()));
}
process.exit(bad.length ? 1 : 0);
