// =====================================================
// Adapter Sync — 預設值
//
// popup 顯示的預設、background 實際寫入時的 fallback，必須是同一份。
// 兩邊各寫一份的話，畫面上顯示 A、實際寫進 B，而且不會有任何錯誤訊息。
// =====================================================

(function () {
  'use strict';

  self.ADAPTER_SYNC_DEFAULTS = {
    // 線上站台。注意 focus4ai.com 是官網、沒有 API，popup 會擋掉那個網址。
    f4Base: 'https://app.focus4ai.com',
    // 跟 post-sync 分開放：兩種來源的可信度完全不同，混在同一個資料夾裡
    // 之後想只檢索文獻就辦不到了。
    f4Folder: '00_inbox/papers',
    driveFolder: 'Adapter Sync 文獻收藏',
  };
})();
