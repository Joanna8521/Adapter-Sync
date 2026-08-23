#!/usr/bin/env python3
"""Adapter Sync — 產生擴充圖示

三個尺寸都從同一份幾何畫出來，不要用縮圖：16px 的縮圖會糊成一團色塊，
而那正是使用者在工具列上唯一看得到的那一個。

用法：python3 tools/make_icons.py
"""

import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "extension" / "icons"

BG = (16, 36, 29, 255)        # 深綠，跟 popup 的 header 同一個色
PAPER = (240, 253, 248, 255)  # 紙白
LINE = (52, 211, 153, 255)    # 亮綠

SIZES = [16, 48, 128]


def draw(size):
    # 4 倍超取樣再縮，邊緣才不會鋸齒
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    r = int(s * 0.22)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=BG)

    # 一張紙：左上到右下留白，右上角折角
    m = s * 0.24
    w = s - 2 * m
    fold = w * 0.32
    d.polygon(
        [
            (m, m),
            (m + w - fold, m),
            (m + w, m + fold),
            (m + w, s - m),
            (m, s - m),
        ],
        fill=PAPER,
    )
    # 折角的陰影，不然看起來只是個圓角矩形
    d.polygon(
        [(m + w - fold, m), (m + w, m + fold), (m + w - fold, m + fold)],
        fill=(203, 232, 220, 255),
    )

    # 內文的三條線。16px 時只畫兩條——三條會黏在一起變成一塊。
    lines = 2 if size <= 16 else 3
    top = m + fold + w * 0.16
    gap = w * 0.22
    th = max(1, int(s * 0.035))
    for i in range(lines):
        y = top + i * gap
        x2 = m + w * (0.62 if i == lines - 1 else 0.78)
        d.rounded_rectangle(
            [m + w * 0.16, y, x2, y + th], radius=th / 2, fill=LINE
        )

    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT / f"icon{size}.png"
        draw(size).save(path)
        print(f"  {path.relative_to(ROOT)}")
    print("圖示已產生")


if __name__ == "__main__":
    main()
