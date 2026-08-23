#!/usr/bin/env python3
"""Adapter Sync — 原始碼掃描

釘住的是那種「壞了不會有任何錯誤訊息」的東西。單元測試測得到行為，
測不到這幾件：

  一、字面上的不可見字元寫進原始碼
      看不見、複製不可靠、grep 也找不到。正規表示式裡尤其致命——
      改的人完全不知道那裡有東西。

  二、同一個檔裡兩個同名函式
      JS 不會有任何警告，後面那個安靜地蓋掉前面那個，
      只會在按下去的時候做錯事。

  三、訊息型別對不上
      content script 送 AS_FOO、background 沒接，畫面表現是
      「按了沒反應」，而兩邊的程式看起來都是對的。

  四、manifest 的注入清單與 background 的動態注入清單分岔
      這是最陰的一條：內建站台好好的，使用者自己啟用的出版社站台
      少載一支檔就整個不動，而且錯誤只出現在那個網域上。

用法：python3 tools/check_source.py
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
SRC = EXT / "src"

problems = []


def fail(msg):
    problems.append(msg)


# ── 一、字面上的不可見字元 ────────────────────────────

INVISIBLE = set(
    [0x00AD, 0x034F, 0x00A0, 0xFEFF]
    + list(range(0x200B, 0x2010))
    + list(range(0x2060, 0x2065))
    + list(range(0x206A, 0x2070))
)


def check_invisible():
    targets = list(SRC.glob("*.js")) + list((ROOT / "tests").glob("*.js"))
    targets += list(EXT.glob("*.html")) + list(SRC.glob("*.css"))
    for path in targets:
        text = path.read_text(encoding="utf-8")
        for i, ch in enumerate(text):
            if ord(ch) in INVISIBLE:
                line = text.count("\n", 0, i) + 1
                fail(
                    f"{path.relative_to(ROOT)}:{line} 有字面上的不可見字元 "
                    f"U+{ord(ch):04X}，要改寫成跳脫形式（\\u{ord(ch):04X}）"
                )


# ── 二、同名函式 ──────────────────────────────────────

FUNC = re.compile(r"^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", re.M)


def check_dup_functions():
    for path in SRC.glob("*.js"):
        text = path.read_text(encoding="utf-8")
        seen = {}
        for m in FUNC.finditer(text):
            name = m.group(1)
            line = text.count("\n", 0, m.start()) + 1
            if name in seen:
                fail(
                    f"{path.relative_to(ROOT)}:{line} 函式 {name} 重複定義"
                    f"（前一個在第 {seen[name]} 行）——後面那個會安靜地蓋掉前面那個"
                )
            seen[name] = line


# ── 三、訊息型別 ──────────────────────────────────────

# 不去分辨「送給誰」。訊息可能走 chrome.runtime.sendMessage（給 background）
# 也可能走 chrome.tabs.sendMessage（給 content script），而型別本身還可能是
# 三元運算組出來的（`const type = off ? 'AS_X' : 'AS_Y'`）——想靜態追出
# 送收關係只會做出一支一直誤報的掃描器，而誤報的掃描器沒有人會理它。
#
# 所以只釘住真正會出事的那件事：**兩邊對不上**。
# 有人送、沒有人接（按了沒反應），或有人接、沒有人送（改名漏改一邊）。
LITERAL = re.compile(r"['\"](AS_[A-Z_0-9]+)['\"]")
HANDLED = re.compile(r"msg\.type\s*===\s*['\"](AS_[A-Z_0-9]+)['\"]")


def check_messages():
    files = {p.name: p.read_text(encoding="utf-8") for p in SRC.glob("*.js")}

    handled = {}  # type -> 接它的檔名
    for name, text in files.items():
        for t in HANDLED.findall(text):
            handled[t] = name

    literals = {}  # type -> 提到它的檔名集合
    for name, text in files.items():
        for t in LITERAL.findall(text):
            literals.setdefault(t, set()).add(name)

    for t, where in sorted(literals.items()):
        if t not in handled:
            fail(f"{t}：{'、'.join(sorted(where))} 送出，但沒有任何地方接——症狀是「按了沒反應」")

    for t, owner in sorted(handled.items()):
        senders = literals.get(t, set()) - {owner}
        if not senders:
            fail(f"{t}：{owner} 接了但沒有人送——可能是改名時漏改一邊，留著是死碼")


# ── 四、注入清單一致性 ────────────────────────────────


def check_inject_list():
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    static = manifest["content_scripts"][0]["js"]

    bg = (SRC / "background.js").read_text(encoding="utf-8")
    m = re.search(r"const INJECT_JS = \[(.*?)\];", bg, re.S)
    if not m:
        fail("background.js 找不到 INJECT_JS，無法確認動態注入的清單")
        return
    dynamic = re.findall(r"['\"]([^'\"]+\.js)['\"]", m.group(1))

    if static != dynamic:
        fail(
            "manifest 的 content_scripts.js 與 background.js 的 INJECT_JS 不一致。\n"
            f"    manifest：{static}\n"
            f"    INJECT_JS：{dynamic}\n"
            "    內建站台會正常，使用者自己啟用的出版社站台會安靜地壞掉。"
        )

    css_static = manifest["content_scripts"][0].get("css", [])
    if "src/toast.css" not in css_static:
        fail("manifest 的 content_scripts 沒有帶 toast.css，注入的 UI 會沒有樣式")


# ── 五、預留值沒換掉就別宣稱功能 ───────────────────────


def check_placeholders():
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest.get("oauth2", {}).get("client_id", "")
    if cid.startswith("REPLACE_ME"):
        print(
            "  提醒：oauth2.client_id 還是預留值，Drive 會停用（知識庫不受影響）。\n"
            "        設定步驟見 README 的「OAuth 設定」。"
        )


def main():
    check_invisible()
    check_dup_functions()
    check_messages()
    check_inject_list()
    check_placeholders()

    if problems:
        print(f"\n{len(problems)} 個問題：\n")
        for p in problems:
            print(f"  ✗ {p}")
        return 1
    print("原始碼掃描通過")
    return 0


if __name__ == "__main__":
    sys.exit(main())
