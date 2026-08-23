(function () {
  'use strict';

  const btn = document.getElementById('connect');
  const msg = document.getElementById('msg');

  btn.addEventListener('click', () => {
    btn.disabled = true;
    msg.textContent = '等待 Google 授權視窗…';
    msg.className = 'msg';
    chrome.runtime.sendMessage({ type: 'AS_CONNECT' }, (res) => {
      btn.disabled = false;
      if (res && res.ok) {
        msg.textContent = '已連接。現在打開任何一篇 PubMed 文章試試看。';
        msg.className = 'msg ok';
        return;
      }
      // 失敗一定要講原因。只寫「連接失敗」的話，使用者唯一能做的就是再按一次。
      msg.textContent = `連接失敗：${(res && res.error) || '未知錯誤'}`;
      msg.className = 'msg err';
    });
  });
})();
