from pathlib import Path
from fontTools.ttLib import TTCollection, TTFont
from fontTools.pens.svgPathPen import SVGPathPen


OUT_FILE = Path(r"C:\Users\vickie\Desktop\查詢商品\義珍香烘培坊_名片_正面_文字外框.svg")


def load_font():
    candidates = [
        (r"C:\Windows\Fonts\msjh.ttc", 0),
        (r"C:\Windows\Fonts\msjhbd.ttc", 0),
        (r"C:\Windows\Fonts\msyh.ttc", 0),
        (r"C:\Windows\Fonts\arial.ttf", None),
    ]
    for p, idx in candidates:
        path = Path(p)
        if not path.exists():
            continue
        if path.suffix.lower() == ".ttc":
            coll = TTCollection(str(path))
            return coll.fonts[idx or 0]
        return TTFont(str(path))
    raise FileNotFoundError("No usable font file found in C:\\Windows\\Fonts")


FONT = load_font()
GLYPH_SET = FONT.getGlyphSet()
CMAP = FONT.getBestCmap()
UNITS_PER_EM = FONT["head"].unitsPerEm
HMTX = FONT["hmtx"]


def glyph_path(char):
    codepoint = ord(char)
    glyph_name = CMAP.get(codepoint) or ".notdef"
    pen = SVGPathPen(GLYPH_SET)
    GLYPH_SET[glyph_name].draw(pen)
    d = pen.getCommands()
    advance_width, _ = HMTX[glyph_name]
    return d, advance_width


def text_paths(text, x, y, size, fill="#111111", letter_spacing=0):
    elements = []
    cursor = x
    scale = size / UNITS_PER_EM
    for ch in text:
        if ch == " ":
            cursor += size * 0.35 + letter_spacing
            continue
        d, aw = glyph_path(ch)
        if d:
            # Flip glyph Y-axis for SVG baseline positioning
            transform = f"translate({cursor:.2f},{y:.2f}) scale({scale:.6f},{-scale:.6f})"
            elements.append(f'<path d="{d}" fill="{fill}" transform="{transform}"/>')
        cursor += aw * scale + letter_spacing
    return elements


def text_width(text, size, letter_spacing=0):
    scale = size / UNITS_PER_EM
    width = 0.0
    for ch in text:
        if ch == " ":
            width += size * 0.35 + letter_spacing
            continue
        _, aw = glyph_path(ch)
        width += aw * scale + letter_spacing
    return max(width - letter_spacing, 0.0)


def text_paths_center(text, center_x, y, size, fill="#111111", letter_spacing=0):
    start_x = center_x - (text_width(text, size, letter_spacing) / 2.0)
    return text_paths(text, start_x, y, size, fill, letter_spacing)


def build_svg():
    lines = []
    lines.append('<?xml version="1.0" encoding="UTF-8"?>')
    lines.append('<svg xmlns="http://www.w3.org/2000/svg" width="90mm" height="60mm" viewBox="0 0 900 600">')
    lines.append('  <rect x="0" y="0" width="900" height="600" fill="#f8f6f2"/>')
    lines.append('  <g transform="translate(255,20)">')
    lines.append('    <path fill="#b44736" d="M190,0 C300,0 380,65 390,170 C400,285 335,360 240,358 C218,357 202,349 190,340 C178,349 162,357 140,358 C45,360 -20,285 -10,170 C0,65 80,0 190,0 Z"/>')
    lines.append('    <g fill="#ffffff" transform="translate(187,140)">')
    lines.append('      <ellipse cx="0" cy="-26" rx="10" ry="23"/>')
    lines.append('      <ellipse cx="26" cy="0" rx="23" ry="10"/>')
    lines.append('      <ellipse cx="0" cy="26" rx="10" ry="23"/>')
    lines.append('      <ellipse cx="-26" cy="0" rx="23" ry="10"/>')
    lines.append('      <circle cx="0" cy="0" r="7"/>')
    lines.append('    </g>')
    lines.append('  </g>')

    # Text content converted to outlines
    text_specs = [
        ("義珍香烘培坊", 450, 350, 52, "#111111", 3),
        ("Boulangerie • Patisserie", 450, 398, 24, "#111111", 1),
        ("每日現烤・天然酵母", 450, 434, 22, "#111111", 0),
        ("電話：0226814403", 450, 502, 26, "#111111", 0),
        ("地址：新北市樹林區保安二街25號", 450, 540, 24, "#111111", 0),
        ("統一編號：33327386", 450, 574, 22, "#111111", 0),
    ]

    for txt, cx, y, sz, fill, ls in text_specs:
        lines.extend(text_paths_center(txt, cx, y, sz, fill, ls))

    lines.append('  <line x1="260" y1="458" x2="640" y2="458" stroke="#d9d1c5" stroke-width="2"/>')
    lines.append('</svg>')
    return "\n".join(lines)


if __name__ == "__main__":
    OUT_FILE.write_text(build_svg(), encoding="utf-8")
    print(f"Written: {OUT_FILE}")

