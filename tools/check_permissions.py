#!/usr/bin/env python3
"""Adapter Sync — 權限涵蓋度

match pattern 寫錯**不會有任何錯誤訊息**：Chrome 只是安靜地不注入
content script、或安靜地擋掉 background 的 fetch，而症狀看起來完全像
別的問題（「這個站台沒反應」「知識庫寫不進去」）。

所以這支自己實作一遍 Chrome 的比對規則，拿真實的網址形狀去對。
改過 manifest.json 之後跑一次。

用法：python3 tools/check_permissions.py
"""

import json
import pathlib
import re
import sys
from urllib.parse import urlsplit

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "extension" / "manifest.json"

problems = []


def fail(msg):
    problems.append(msg)


# ── Chrome 的 match pattern 比對 ─────────────────────


def pattern_to_regex(pattern):
    """<scheme>://<host><path>，照 Chrome 的規則轉成 regex。"""
    if pattern == "<all_urls>":
        return re.compile(r".*")
    m = re.match(r"^(\*|https?|file|ftp)://([^/]*)(/.*)$", pattern)
    if not m:
        raise ValueError(f"看不懂的 match pattern：{pattern}")
    scheme, host, path = m.groups()

    scheme_re = "https?" if scheme == "*" else re.escape(scheme)

    if host == "*":
        host_re = r"[^/]+"
    elif host.startswith("*."):
        # *.example.com 要同時涵蓋 example.com 本身
        base = re.escape(host[2:])
        host_re = rf"(?:[^/]+\.)?{base}"
    else:
        host_re = re.escape(host)

    path_re = "".join(".*" if c == "*" else re.escape(c) for c in path)
    return re.compile(rf"^{scheme_re}://{host_re}{path_re}$")


def covered(url, patterns):
    for p in patterns:
        if pattern_to_regex(p).match(url):
            return p
    return None


# ── 真實的網址形狀 ───────────────────────────────────
#
# 這些不是編出來的，是使用者實際會停在的那幾種頁面。
# 光看 manifest 是看不出「PMC 有兩個網域」這種事的。

CONTENT_URLS = [
    ("PubMed 單篇", "https://pubmed.ncbi.nlm.nih.gov/38712345/"),
    ("PubMed 單篇（帶參數）", "https://pubmed.ncbi.nlm.nih.gov/38712345/?from_term=covid"),
    ("PMC 新網域", "https://pmc.ncbi.nlm.nih.gov/articles/PMC11002233/"),
    ("PMC 舊網域", "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11002233/"),
    ("arXiv 摘要頁", "https://arxiv.org/abs/2401.12345"),
    ("arXiv 帶版本", "https://arxiv.org/abs/2401.12345v2"),
    ("arXiv PDF", "https://arxiv.org/pdf/2401.12345"),
    ("bioRxiv", "https://www.biorxiv.org/content/10.1101/2024.01.01.573000v1"),
    ("medRxiv", "https://www.medrxiv.org/content/10.1101/2024.01.01.24300000v1"),
]

# 這幾種**不該**注入。注入了的話使用者會在列表頁上看到一顆按了收到殼的按鈕，
# 而 adapters.js 的 pathTest 是第二道防線，不是第一道。
HOST_ONLY_URLS = [
    ("Google Drive API", "https://www.googleapis.com/drive/v3/files"),
    ("Google Docs API", "https://docs.googleapis.com/v1/documents/abc:batchUpdate"),
]


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    cs = manifest.get("content_scripts", [])
    if not cs:
        fail("manifest 沒有 content_scripts，擴充不會在任何頁面上啟動")
        return report()

    matches = cs[0].get("matches", [])
    hosts = manifest.get("host_permissions", [])

    # 一、content script 有沒有涵蓋每一種文章頁
    for label, url in CONTENT_URLS:
        if not covered(url, matches):
            fail(f"content script 沒有涵蓋「{label}」：{url}")

    # 二、content script 跑得到的網域，host_permissions 也要有——
    #     少了的話 background 對那個網域的 fetch 會被安靜地擋掉
    for label, url in CONTENT_URLS:
        host = urlsplit(url).netloc
        if not covered(f"https://{host}/", hosts):
            fail(f"host_permissions 少了 {host}（「{label}」用得到）")

    # 三、Google API 的權限
    for label, url in HOST_ONLY_URLS:
        if not covered(url, hosts):
            fail(f"host_permissions 沒有涵蓋「{label}」：{url}")

    # 四、反過來：宣告了卻沒有任何程式會用到的權限只會拖慢商店審查，
    #     而且對使用者是不誠實的（要了用不到的東西）
    src = "\n".join(
        p.read_text(encoding="utf-8")
        for p in (ROOT / "extension" / "src").glob("*.js")
    )
    for h in hosts:
        host = re.sub(r"^https?://", "", h).split("/")[0].replace("*.", "")
        if host.startswith("*"):
            continue
        base = host.split(".")[-2] if host.count(".") >= 1 else host
        if base not in src and host not in src:
            fail(
                f"host_permissions 宣告了 {h}，但 src/ 裡找不到任何地方用到它。"
                "用不到就拿掉——多要的權限只會拖慢審查。"
            )

    # 五、popup 要讀得到目前分頁的網域，才能提供「在這個站台啟用」。
    #     出版社的網域我們正好沒有權限（那才是要開通的東西），所以
    #     tabs[0].url 會是 undefined —— 症狀是按鈕永遠顯示「不是 https 網頁」，
    #     而程式看起來完全正確。activeTab 就是為這種情境設計的：
    #     使用者點開擴充圖示的那一下，就臨時給了目前分頁的權限。
    perms = manifest.get("permissions", [])
    if "activeTab" not in perms:
        fail(
            "permissions 少了 activeTab。popup 讀不到目前分頁的網址，"
            "「在這個站台啟用」會永遠顯示成「不是 https 網頁」。"
        )

    # 六、通用出版社走的是選用權限，不能預先要
    opt = manifest.get("optional_host_permissions", [])
    if "https://*/*" not in opt:
        fail("optional_host_permissions 少了 https://*/*，使用者無法自己啟用出版社站台")
    if "https://*/*" in hosts or "<all_urls>" in hosts:
        fail(
            "host_permissions 裡有 https://*/* 或 <all_urls>。"
            "這等於預先宣告「我可以讀你看的每一個網頁」——出版社站台要走"
            "optional_host_permissions ＋ 使用者逐站授權。"
        )

    return report()


def report():
    if problems:
        print(f"\n{len(problems)} 個問題：\n")
        for p in problems:
            print(f"  ✗ {p}")
        return 1
    print("權限涵蓋度通過")
    return 0


if __name__ == "__main__":
    sys.exit(main())
