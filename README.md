# 📄 Adapter Sync — 文獻收藏器

開源的 Chrome 擴充功能。在 **PubMed / PMC / arXiv / bioRxiv / medRxiv**
與各大出版社頁面上看到一篇該留下來的論文，按一下就存進**你自己的 Google Drive**，
並可同步進 Focus4ai 知識庫：

- **一篇一份 Google Doc**，檔名是 `發表年_第一作者姓_標題`，例如
  `2024_Smith_Effect of early mobilisation on functional outcomes`
- **文件開頭是可以直接貼走的引用格式**（Vancouver，醫學標準）
- **偵測撤稿與關切聲明**，標在檔名、frontmatter 與文件開頭三個地方
- **同一篇從不同網址收只會有一份** —— 用 DOI／PMID／arXiv id 去重，不是用網址
- **最小權限**：Drive 只用 `drive.file` scope；出版社站台要你自己逐站開通

這是 **Post Sync**（社群貼文收藏器）的姊妹專案，共用同一套管線
概念，但**書目資料、去重、撤稿**三塊是文獻專屬的，見下面「跟 Post Sync 的差別」。

## 怎麼用

兩種方式，都是自己按的：

**浮動按鈕** —— 打開一篇文章頁，右下角浮出 **「📄 收這篇文獻」**。

**右鍵** —— 在頁面上按右鍵 →「📄 收這篇文獻」。浮動按鈕因為版面或改版
沒出來的時候，這條路還在。

快速鍵預設**沒有綁**（免得跟慣用的鍵打架）。要的話到
`chrome://extensions/shortcuts` 找 Adapter Sync 自己設一組。

擷取**一律是你自己按的**。沒有任何自動收集，也不會自己開別的頁面。

### 兩個目的地，各自獨立

| | 存什麼 | 給誰用 |
|---|---|---|
| **Google Drive** | 一篇一份 Doc，開頭是引用格式 | 給人看的 |
| **Focus4ai 知識庫** | Markdown＋完整 frontmatter，寫入就切片建索引 | 給檢索用的 |

一邊掛了不影響另一邊。只想用知識庫、不接 Drive 也可以。

## 支援哪些站台

**內建，裝好就能用：**

| 站台 | 網址 | 備註 |
|---|---|---|
| PubMed | `pubmed.ncbi.nlm.nih.gov` | 摘要、MeSH terms、撤稿標記 |
| PubMed Central | `pmc.ncbi.nlm.nih.gov`、舊的 `/pmc/` 網址 | 全文站 |
| arXiv | `arxiv.org/abs/`、`/pdf/` | 自動標記為預印本 |
| bioRxiv / medRxiv | `biorxiv.org`、`medrxiv.org` | 自動標記為預印本 |

**其他出版社要自己啟用一次。** Nature、NEJM、Lancet、JAMA、Elsevier、
Springer、Wiley、Frontiers、MDPI、各國期刊、機構典藏……文獻站台是列不完的，
所以本擴充**沒有**預先要「讀取所有網頁」的權限——那等於宣告
「我可以讀你看的每一個網頁」，對使用者不誠實，商店審查也會直接卡住。

做法：在那個出版社的文章頁上點擴充圖示 →「啟用」，Chrome 會問你要不要給
**那一個網域**的權限。給了之後**重新整理該分頁**，按鈕就會出現。

已在真的文章頁上驗過的：**NEJM、JAMA、BMJ、Annals of Internal Medicine、
Nature／Nature Medicine、Wiley、Oxford Academic、Springer／BMC、
Cochrane Library、PLOS、Frontiers、MDPI**。

> ScienceDirect（Elsevier）**還沒驗過**：自動化瀏覽器會被 Cloudflare 攔下人機驗證，
> 我沒有辦法在那個環境下測。真人自己開的 Chrome 不會遇到那道關卡，預期可用。

通用 adapter 靠 `<meta name="citation_*">` 判斷這一頁是不是一篇文獻，
沒有書目資料的頁面（期刊首頁、搜尋結果）不會出現按鈕。

> **Google Scholar 刻意不支援。** Scholar 的搜尋結果頁**沒有** `citation_*`
> ——那些 meta 是餵給它吃的，不是它吐的，從那裡只拿得到標題和一個連結。
> 正常用法是從 Scholar 點進出版社頁面再收。做這個 adapter 只會收到一堆空殼。

## 安裝

三分鐘，不需要開發環境，也不需要 npm。

**第一步：把檔案拿到手**

放到你放得住的地方（例如「文件」）。
⚠️ 安裝後**不能刪除或搬走它**，擴充是直接從這個資料夾執行的。

**第二步：載入 Chrome**

1. 網址列輸入 `chrome://extensions`，**右上角把「開發人員模式」打開**。
2. 按左上角**「載入未封裝項目」**，選 **`extension`** 這個資料夾
   （選到裡面看得到 `manifest.json` 的那一層），按「選取」。
3. 裝好會自動打開設定導覽頁。
4. 打開任何一篇 PubMed 文章，右下角會浮出「📄 收這篇文獻」。

manifest 內含固定的 `key`（公鑰），所以每個人載入後的擴充 ID 都相同：
`anblhjpgfijnmjjfehhknpoigmenhhch`，共用同一個 OAuth client 才會成立。

### 常見問題

- **選了資料夾卻說「資訊清單檔案遺失」**
  選錯層了。要選到裡面有 `manifest.json` 的那一層。

- **按了沒反應／看不到浮動按鈕**
  回到那個分頁按 `Cmd+R`（Windows 是 `F5`）重新整理。
  擴充需要頁面重新載入才會生效。還是不行就點擴充圖示按
  **「檢查這一頁」**，它會直接告訴你抓到了什麼、缺什麼。

- **出版社站台啟用了還是沒按鈕**
  啟用之後**要重新整理那個分頁**。Chrome 的動態註冊只對之後載入的頁面生效。

## OAuth 設定（要用 Drive 才需要）

`manifest.json` 裡的 `oauth2.client_id` 目前是 `REPLACE_ME...` 預留值，
**Drive 會停用，但 Focus4ai 知識庫不受影響**，可以先只用知識庫。

要開 Drive 的話自己建一組：

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建一個專案，
   啟用 **Google Drive API** 與 **Google Docs API**：

   ```bash
   gcloud projects create <你的專案 ID> --name="Adapter Sync"
   ```

   ```bash
   gcloud services enable drive.googleapis.com docs.googleapis.com --project=<你的專案 ID>
   ```

2. 「Google 驗證平台」→「開始使用」（Google 在 2025 年把「OAuth 同意畫面」
   搬進這裡，選單位置跟舊教學不一樣）：
   <https://console.cloud.google.com/auth/overview>
   應用程式名稱自訂、目標對象選「外部」。

3. 「資料存取權」→ 新增範圍 `.../auth/drive.file`。
   這是**非敏感** scope，不需要 Google 審查，也沒有測試使用者 100 人上限。

4. 「目標對象」→「**發布應用程式**」。留在測試中的話只有名單裡的帳號能用，
   而且 **refresh token 七天就過期** —— 症狀是「上禮拜還好好的，今天按了就失敗」，
   錯誤訊息完全不會提到七天這件事。

5. 「用戶端」→「建立用戶端」→ 應用程式類型選「**Chrome 擴充功能**」，
   項目 ID 填 `anblhjpgfijnmjjfehhknpoigmenhhch`，
   把拿到的 client ID 填進 `extension/manifest.json` 的 `oauth2.client_id`。

> ⚠️ **同意畫面的「應用程式標誌」不要上傳。** 一旦上傳 logo，這個 app 就會被歸入
> 需要 Google **品牌驗證**的流程，而 `drive.file` 本來完全不需要審查。
> 為了一張圖換來幾天到幾週的等待，不划算。

`manifest.json` 的 `key`（公鑰）決定擴充 ID，而 Console 裡填的項目 ID 必須跟它一致，
不然會一路授權失敗、**而且錯誤訊息不會告訴你原因**。改動 `key` 之後用這段對一次：

```bash
python3 -c "import json,base64,hashlib;d=base64.b64decode(json.load(open('extension/manifest.json'))['key']);print(''.join(chr(ord('a')+int(c,16)) for c in hashlib.sha256(d).hexdigest()[:32]))"
```

## 機構訂閱與登入

**擴充從頭到尾不碰你的帳號密碼。** 不問、不存、不代填，也沒有任何登入畫面。

它是 content script，跑在你自己的瀏覽器、你自己的分頁裡，讀的就是**你眼睛
看到的那一頁**。所以做法就是你平常的做法：

1. 用機構帳號（或圖書館 proxy）在同一個瀏覽器裡正常登入
2. 打開那篇論文，確認頁面上看得到完整摘要
3. 按「📄 收這篇文獻」

頁面上有什麼，收進來的就是什麼。

### 走圖書館 proxy 的話

機構訂閱多半要走 EZproxy 之類的代理，網址會變成這種樣子：

```
https://www-nejm-org.ezproxy.lib.example.edu.tw/doi/full/10.1056/NEJMoa2401234
```

兩件事會自動處理好：

- **一次啟用、整個 proxy 通吃。** 那是一個網域，在上面按一次「啟用」，
  之後**所有**經過同一個 proxy 的期刊都有按鈕，不用一家一家開。
- **存下來的是原始網址。** 指紋與連結都會把 proxy 還原成出版社的網域，
  所以同一篇「直接連」和「走 proxy」不會變成兩份，
  而寫進知識庫的連結換一台電腦也打得開（不是只有你機構打得開的死連結）。

### 忘了登入的話

沒登入時很多期刊只會顯示一段招牌文案，而擴充照樣收得下去——這正是那種
**壞了不會有任何畫面告訴你**的情形。所以收錄時會偵測：摘要短得可疑、
而且頁面上有訂閱牆的字樣時，會在畫面上、檔案裡、frontmatter 與摘要標題
四個地方都標「可能是截斷版」，並告訴你登入後重收一次就會蓋掉。

再收一次的時候，畫面會直接說「上次那份是沒登入時收的（摘要 N 字），
這一頁看起來是完整的（M 字）」，按鈕也會變成「重收，蓋成完整版」——
不用自己記得哪幾篇當初沒登入。

> 判準刻意很窄：**全文**在付費牆後面是常態，而我們本來就只收摘要，
> 那不算問題。只有**摘要本身**看起來被截斷才會警告。

## 撤稿偵測

這是整個專案唯一會造成**真實傷害**的失敗模式：一篇被撤稿的研究安靜地進了
知識庫、被切片、被檢索出來，然後拿去回答臨床問題。

偵測到的時候會標在**四個地方**，因為每一個地方都有人只看得到它：

1. **檔名**加 `【撤稿】` 前綴 —— Drive 與知識庫的清單頁只看得到檔名
2. **frontmatter** 的 `retracted: true` 與 `tags: [..., 已撤稿]` —— 給程式篩
3. **正文開頭**的警告區塊，附上偵測到的原文 —— 給人看
4. **摘要的標題**寫成「摘要（⚠️ 本文已撤稿）」—— 知識庫是切片檢索的，
   第一片以外的片段拿不到開頭那個警告，而標題通常會跟著切片一起走

判準刻意**不猜 class name**。`Retracted Publication` 是 NLM 的正式
Publication Type、十幾年沒變過，比任何選擇器都穩；出版社那邊則吃標題前綴
（Elsevier 的 `RETRACTED:`、Nature／Springer 的 `Retracted Article:`）。

同時處理三種容易搞混的情形：

- **撤稿公告本身**（`Retraction of: ...`）不會被標成「這篇被撤稿了」——
  它是那份公告，不是被撤的論文
- **關切聲明**（Expression of Concern）單獨標，不跟撤稿混為一談
- **參考文獻裡引用了撤稿論文**不會誤判 —— 掃描範圍限縮在文章前段與聲明區塊，
  狼來了喊多了就沒有人看警告了

> ### ⚠️ 沒有標記**不等於**這篇沒問題
>
> 我們只看得到頁面上寫出來的東西，而 PubMed 的撤稿標記本身就會落後聲明
> 幾天到幾週。所以 frontmatter 裡**只有偵測到才會寫** `retracted: true`，
> 沒有一個叫「已確認乾淨」的欄位——那種欄位我們沒有資格寫。
> 臨床決策請自己再確認一次。

## 為什麼去重要用 DOI 而不是網址

**同一篇論文有很多個網址：**

```
https://pubmed.ncbi.nlm.nih.gov/38712345/
https://doi.org/10.1056/NEJMoa2401234
https://www.nejm.org/doi/full/10.1056/NEJMoa2401234
https://pmc.ncbi.nlm.nih.gov/articles/PMC11002233/
```

從 Google Scholar 點進去、從 PubMed 點進去、從期刊電子報點進去，拿到的是
四個不同的網址、同一篇論文。Post Sync 那套「permalink 當指紋」在這裡會安靜地
存成四份——而重複收錄不會有任何錯誤訊息，是三個月後翻資料夾才會發現的那種壞法。

所以指紋的優先序是 **DOI → PMID → arXiv id → PMCID → 洗過的網址 → 標題＋第一作者**，
而且**指紋裡不摻來源站台**。社群那邊放平台是對的（同一段話發在 FB 和 LinkedIn
是兩則貼文）；文獻這邊放了就等於自廢武功。

順帶幾件同類的事：

- DOI 一律小寫、剝掉 `https://doi.org/` 與句尾標點（DOI 規範明定比對不分大小寫）
- arXiv 的 `v1` 與 `v2` **算同一篇**，但版本記著；再收一次時會說
  「你上次收的是 v1，這一頁是 v2」，要不要收你自己決定
- 沒有任何識別碼的頁面（會議摘要、機構典藏）照樣可以收，但畫面上會明講
  「去重只能靠標題比對」

## 專案結構

```
extension/
├── manifest.json        # MV3，含固定 key（公鑰）與 oauth2 設定
├── popup.html           # 連線狀態、Drive／知識庫設定、逐站開通、診斷、寫入紀錄
├── onboarding.html      # 安裝後自動打開的設定導覽
├── icons/
└── src/
    ├── ids.js           # DOI／PMID／arXiv 正規化與指紋（純函式，可測）
    ├── citation.js      # meta → 書目資料，三層 fallback（純函式，可測）
    ├── adapters.js      # 各站台的錨點（唯一需要跟著站台改版調的地方）
    ├── extract.js       # DOM → 紀錄，含撤稿偵測（純函式，可測）
    ├── naming.js        # 檔名與引用格式（純函式，可測）
    ├── content.js       # 浮動按鈕、右鍵、toast、診斷
    ├── background.js    # OAuth、Drive、Focus4ai、去重、逐站註冊
    ├── defaults.js
    ├── popup.js
    ├── onboarding.js
    └── toast.css
tests/
└── run.html             # 抽取層：用瀏覽器直接打開就跑
tools/
├── check_source.py      # 原始碼掃描
├── check_permissions.py # 權限涵蓋度
└── make_icons.py
```

`key.pem`（專案根目錄、不進 git）：打包 .crx 時才需要的私鑰。
載入未封裝不需要它。

## 測試

三支，全綠才算過。

**`tests/run.html`** —— 用瀏覽器直接打開。釘住的**全部**是那種
壞了不會有任何畫面告訴你的事：

- 同一篇從 PubMed 與從出版社收，指紋不一樣 → 資料夾裡默默多出重複的論文
- 撤稿沒被標到 → 已被推翻的研究進了知識庫
- 撤稿公告被標成「這篇被撤稿了」→ 狼來了
- 參考文獻裡的撤稿字樣被誤判 → 警告變成雜訊，之後沒有人看
- 二十人的論文被壓成一位作者（`citation_author` 是重複標籤，`querySelector` 只拿第一個）
- 結構式摘要被壓成一段 → 失去 Background／Methods／Results 的結構
- MeSH terms 被逗號切開 →「Respiration, Artificial」變成兩個不存在的詞
- 關鍵字整串太長被防呆濾掉 → 整批安靜消失
- 關鍵字是一串沒有分隔的連結 → 黏成「Allergy and immunologyCOVID-19Disclosure…」
- MeSH 與作者關鍵字混進同一個欄位 → 控制詞彙的精確比對優勢丟掉
- 三個站台三種日期格式（`2024/05/12`、`05/12/2024`、`2020 May 22`）只認得一種 → 月日全掉
- `citation_abstract` 裡塞的是 HTML → `<h3>` 原樣寫進知識庫、結構式摘要黏成一段
- 摘要選擇器抓到整頁的外層容器 → 四萬字連工具列一起塞進知識庫
- 撤稿與關切聲明同時存在時，警告只顯示比較輕的那一句
- **下拉選單裡的 `<option>Expression of Concern</option>` 被當成真的關切聲明**
  → 整個出版社的每一篇都被誤標，警告從此失去意義
- 沒登入時收到截斷版而沒有任何提示 → 三個月後翻知識庫才發現那篇只有兩行
- 反過來：摘要明明完整，卻因為頁首有「Sign in」就亂喊警告
- 走 proxy 與直接連被算成兩篇，而且存下只有該機構打得開的死連結
- 搜尋結果頁冒出一顆按了收到空殼的按鈕
- 檔名用收錄日而不是發表年 → 一整排 2026 的經典老論文
- 不可見字元進了標題 → 一路變成檔名與指紋的一部分

```bash
python3 -m http.server 8931
```

然後開 <http://127.0.0.1:8931/tests/run.html>。
（直接用 `file://` 開會被 CORS 擋住 `DOMParser` 以外的東西，起個小伺服器最省事。
頁面本身每次載入都會給每支 .js 掛時間戳，所以**不用**清快取。）

**`python3 tools/check_source.py`** —— 原始碼掃描。測試測得到行為，
測不到這四件：

- **字面上的不可見字元**寫進原始碼（看不見、複製不可靠、grep 也找不到）
- **同一個檔裡兩個同名函式**（JS 不會警告，後面那個安靜地蓋掉前面那個）
- **訊息型別對不上**（送了沒人接＝「按了沒反應」；接了沒人送＝改名漏改一邊）
- **manifest 的注入清單與 background 的 `INJECT_JS` 分岔** ——
  最陰的一條：內建站台好好的，使用者自己啟用的出版社站台少載一支檔就整個不動

**`python3 tools/check_permissions.py`** —— 權限涵蓋度。改過 `manifest.json`
之後跑一次。match pattern 寫錯**不會有任何錯誤訊息**：Chrome 只是安靜地不注入
content script、或安靜地擋掉 fetch，而症狀看起來完全像別的問題。所以這支自己
實作一遍 Chrome 的比對規則，拿真實的網址形狀去對（PMC 的新舊兩個網域、
arXiv 帶版本的網址、bioRxiv 的 `/content/` 路徑…），並且反過來檢查有沒有**多要**權限。

## 跟 Post Sync 的差別

共用的：擴充的骨架、OAuth／Drive 寫入、Focus4ai 同步、toast 與去重的 UX、
「訊息由 background 組好、content script 只負責顯示」、
「兩個目的地各自獨立，一邊掛了不影響另一邊」。

**不共用、而且不能照抄的四件事：**

| | Post Sync（社群） | Adapter Sync（文獻） |
|---|---|---|
| 抽取 | TreeWalker 走可見文字，要對抗反爬 | 讀 `<meta>` 屬性 —— **走 Post Sync 的 `readable()` 會一個字都抽不到**，因為 meta 在 `<head>` 裡、必定被判定為不可見 |
| 作者 | 一個字串 | 陣列。`citation_author` 是**重複標籤** |
| 去重 | permalink | DOI／PMID／arXiv id，且不摻來源站台 |
| 檔名 | `收錄日_主題_發文者`，主題靠猜內文第一行 | `發表年_第一作者姓_標題`，標題是站台明講的 |

外加一件 Post Sync 完全沒有的：**撤稿**。

## 已知限制

- **不嵌入圖片。** Post Sync 會把社群貼文的圖真的嵌進 Doc；這裡沒做。
  論文的 figure 多半在 PDF 或付費牆後面，而 PMC 的 OA figure 值得做但還沒做。
  目前收的是書目＋摘要＋MeSH，那才是文獻檢索真正用得到的部分。
- **不收全文。** PMC 有全文，但整篇塞進 RAG 不但沒用還有害——檢索會一直撈到
  半截的表格與方法段落。要全文的話應該走專門的切片流程，不是這條管線。
- **DOI 一律轉小寫。** DOI 規範明定比對不分大小寫、doi.org 也照樣解析得到，
  但貼進論文時跟出版社印的大小寫會不一樣（`10.1016/S0140-...` → `10.1016/s0140-...`）。
  去重正確性優先。
- **摘要要登入才看得到的站台**：登入後就收得到（見上面「機構訂閱與登入」）。
  沒登入時會照實標「可能是截斷版」，不會假裝收好了。
- **訂閱牆偵測沒實測過。** 邏輯與測試都寫了，但我手上沒有機構訂閱帳號，
  沒辦法在真的付費牆頁面上驗證。第一次遇到時請看一下警告有沒有正確出現。
- **手機上沒有浮動按鈕。** iOS／Android 都不允許在瀏覽器 App 裡注入 UI。
- **站台改版可能讓抓取失準。** 但比社群穩定得多——`citation_*` 是 Google Scholar
  索引用的標準，出版社改了就從 Scholar 上消失。錨點集中在 `src/adapters.js`。
- **驗收範圍。** 抽取層已在真的 PubMed（含一篇真的撤稿論文）、PMC、arXiv
  與十二家主要醫療期刊的文章頁上跑過（見上）；ScienceDirect、付費牆頁面、
  以及走 proxy 的機構訂閱都還沒實測。Drive 寫入與 Focus4ai 同步還沒在真的
  擴充環境裡跑過（需要先設好 OAuth）。
- **沒有摘要的文章是正常的。** 社論、Letter to the Editor、Correspondence
  本來就沒有摘要，會照實寫「抓不到摘要」，不會假裝收好了。

## 隱私

- 擷取動作**全部由使用者手動觸發**，不會自動上傳任何內容。
- 資料只寫進使用者自己的 Google Drive 與自己指定的 Focus4ai 站台；
  本擴充沒有任何自己的伺服器。
- `drive.file` scope 之下，擴充只能看到、修改它自己建立的資料夾與文件。
- 出版社站台**逐站授權**，沒開通的網域一律讀不到。

## License

MIT
