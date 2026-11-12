#!/usr/bin/env python3
"""比较板：改前 + 各方案并排，浅色/深色两行，标注方案名与一句说明。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
import textwrap

SINGLES = Path("/workspace/ui-variants/singles")
OUT = Path("/workspace/ui-variants/boards")
OUT.mkdir(parents=True, exist_ok=True)
FONT_R = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
FONT_B = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
SC = 2  # Noto Sans CJK SC index

def font(bold, size):
    return ImageFont.truetype(FONT_B if bold else FONT_R, size, index=SC)

BG = (244, 245, 247)
INK = (22, 26, 33)
MUTED = (90, 96, 108)
FAINT = (130, 136, 148)
ACCENT = (59, 91, 176)
WHITE = (255, 255, 255)
CARD = (255, 255, 255)
LINE = (220, 223, 228)
REC_BG = (59, 91, 176)

def shadow(base, img, xy, blur=18, alpha=60, dy=6):
    """Drop a soft shadow under img at xy on base."""
    x, y = xy
    w, h = img.size
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    sh = Image.new("RGBA", (w + blur * 4, h + blur * 4), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle((blur * 2, blur * 2, blur * 2 + w, blur * 2 + h), 8, fill=(0, 0, 0, alpha))
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    layer.paste(sh, (x - blur * 2, y - blur * 2 + dy), sh)
    out = Image.alpha_composite(base.convert("RGBA"), layer)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    out.paste(img, (x, y), img)
    return out.convert("RGB")

def fit(im, max_w, max_h):
    w, h = im.size
    s = min(max_w / w, max_h / h)
    nw, nh = int(w * s), int(h * s)
    return im.resize((nw, nh), Image.Resampling.LANCZOS)

def measure(draw, text, f):
    b = draw.textbbox((0, 0), text, font=f)
    return b[2] - b[0], b[3] - b[1]

def wrap(text, f, max_w, draw):
    # greedy wrap by character for CJK + words
    lines, cur = [], ""
    for ch in text:
        trial = cur + ch
        w, _ = measure(draw, trial, f)
        if w <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines

SURFACES = {
    "quick": {
        "title": "快速窗",
        "subtitle": "搜索「报告」· 霜靛主题 · 2× 像素密度 · 真实前端渲染",
        "variants": [
            ("current", "改前（现行）", "与产品结构一致：输入框、扁平列表、快捷键占满底栏。无匹配高亮、无分组。", False, "results"),
            ("glass", "镜面", "亚克力材质、按类型分组、匹配字高亮、左侧强调条；脚注只留必要动作。", True, "results"),
            ("rail", "轨道", "更高密度。「最佳匹配」置顶，选中行露出行内动作与左侧轨道。", False, "results"),
            ("peek", "侧览", "左列表、右预览。标签、路径与打开按钮在预览栏一次看清。", False, "results"),
        ],
    },
    "collect": {
        "title": "收纳页",
        "subtitle": "从资源管理器收下 3 个文件 · 霜靛主题 · 2× 像素密度",
        "variants": [
            ("current", "改前（现行）", "文件列表加三个等权按钮，动作没有主次，也没有预览。", False, "home"),
            ("actions", "先选动作", "先选怎么收。「打标签」作为推荐主路径，文件以芯片列出。", True, "home"),
            ("inbox", "收件箱", "左列表右预览，底部固定动作条；主按钮是「打标签并收纳」。", False, "home"),
            ("steps", "三步", "向导第二步同时选标签与文件柜，可跳过仅导入。路径更长。", False, "home"),
        ],
    },
    "pin": {
        "title": "钉住浮动窗",
        "subtitle": "标签「工作」· 霜靛主题 · 2× 像素密度",
        "variants": [
            ("current", "改前（现行）", "与快速窗同构的清单加筛选框，作为桌面小组件偏宽、偏像对话框。", False, "home"),
            ("dock", "码头", "更窄的小组件：标签色顶栏，去掉路径与扩展名，用色块区分文件。", True, "home"),
            ("cards", "卡片", "两列缩略图（现为类型色块），适合以图为主的标签；需要真实预览才更有说服力。", False, "home"),
            ("strip", "清单预览", "保留清单，底部预览条给出选中项的路径与打开按钮。", False, "home"),
        ],
    },
}

HANDLE = {
    "title": "边缘把手",
    "subtitle": "合成在 1920×1080 真实任务栏桌面上（CSS 视觉模拟，非 Win32 原生绘制）· 2× 像素密度",
    "variants": [
        ("current", "改前（现行 8px）", "全高 8px 轨道加 56px 胶囊，在 1920 全屏下几乎看不见。", False),
        ("tab", "标签页", "静止即露出标签名、数量与标签色；悬停展开；记住纵向位置。", True),
        ("jewel", "光点", "细轨道加带白环的发光圆点，悬停出工具提示。克制，但在深色壁纸上仍要足够对比。", False),
        ("peek", "探头", "静止就露出名称与前几项预告，悬停加宽。一直占用约 68px。", False),
    ],
}


def header(canvas, draw, title, subtitle, W, pad):
    tfont = font(True, 42)
    sfont = font(False, 20)
    draw.text((pad, 36), f"{title}  ·  方案比较", font=tfont, fill=INK)
    draw.text((pad, 96), subtitle, font=sfont, fill=MUTED)
    # right meta
    meta = "仅设计探索  ·  不合入产品"
    mw, _ = measure(draw, meta, sfont)
    draw.text((W - pad - mw, 48), meta, font=sfont, fill=FAINT)
    rec = "推荐方案标有蓝标"
    rw, _ = measure(draw, rec, sfont)
    draw.text((W - pad - rw, 96), rec, font=sfont, fill=ACCENT)


def caption_block(draw, x, y, w, name, blurb, recommended):
    nfont = font(True, 24)
    bfont = font(False, 17)
    draw.text((x, y), name, font=nfont, fill=INK)
    nw, nh = measure(draw, name, nfont)
    if recommended:
        badge = "推荐"
        bf = font(True, 13)
        bw, bh = measure(draw, badge, bf)
        bx = x + nw + 12
        by = y + 4
        draw.rounded_rectangle((bx, by, bx + bw + 14, by + bh + 8), 10, fill=REC_BG)
        draw.text((bx + 7, by + 2), badge, font=bf, fill=WHITE)
    lines = wrap(blurb, bfont, w, draw)
    yy = y + 36
    for ln in lines[:3]:
        draw.text((x, yy), ln, font=bfont, fill=MUTED)
        yy += 26
    return yy


def row_label(draw, x, y, text):
    f = font(True, 18)
    draw.text((x, y), text, font=f, fill=ACCENT)


def make_panel_board(key, cfg):
    variants = cfg["variants"]
    n = len(variants)
    # load light + dark hero (standard font)
    lights, darks = [], []
    for vid, *_rest, state in variants:
        lp = SINGLES / f"{key}-{vid}-light-f1-{state}.png"
        dp = SINGLES / f"{key}-{vid}-dark-f1-{state}.png"
        lights.append(Image.open(lp).convert("RGBA"))
        darks.append(Image.open(dp).convert("RGBA"))

    # slot size: unify height
    # pin is tall-narrow, others are wide. Use max_h 820, max_w depends.
    if key == "pin":
        max_h, max_w = 900, 520
        gap = 40
        pad = 56
    elif key == "collect":
        max_h, max_w = 780, 1000
        gap = 36
        pad = 56
    else:
        max_h, max_w = 800, 980
        gap = 36
        pad = 56

    lights_f = [fit(im, max_w, max_h) for im in lights]
    darks_f = [fit(im, max_w, max_h) for im in darks]
    slot_w = max(im.width for im in lights_f + darks_f)
    slot_h = max(im.height for im in lights_f + darks_f)

    cap_h = 130
    section_h = 44
    header_h = 150
    footer_h = 72
    W = pad * 2 + n * slot_w + (n - 1) * gap
    H = header_h + section_h + slot_h + cap_h + 24 + section_h + slot_h + cap_h + footer_h

    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)
    header(canvas, draw, cfg["title"], cfg["subtitle"], W, pad)

    def place_row(imgs, y0, section, states_note=None):
        row_label(draw, pad, y0, section)
        y = y0 + section_h
        xs = []
        for i, im in enumerate(imgs):
            x = pad + i * (slot_w + gap)
            # center in slot
            ix = x + (slot_w - im.width) // 2
            canvas2 = shadow(canvas, im, (ix, y), blur=16, alpha=50, dy=8)
            canvas.paste(canvas2)
            xs.append(x)
        # captions under
        cy = y + slot_h + 18
        for i, v in enumerate(variants):
            _, name, blurb, rec, _ = v
            caption_block(draw, xs[i], cy, slot_w, name, blurb, rec)
        return cy + cap_h

    y = header_h
    y = place_row(lights_f, y, "浅色  ·  标准字号")
    y = place_row(darks_f, y + 8, "深色  ·  标准字号")

    # footer
    ff = font(False, 16)
    foot = "特大字号（1.25）与空状态见 singles/ 目录。分支 cursor/ui-variants-8f3b，?variant= 开关，演示后端，未合入产品，未改 PR 66。"
    draw.text((pad, H - 44), foot, font=ff, fill=FAINT)

    dest = OUT / f"{key}-compare.png"
    canvas.save(dest, "PNG", optimize=True)
    print("board", dest, canvas.size, dest.stat().st_size // 1024, "k")
    return dest


def make_handle_board():
    cfg = HANDLE
    variants = cfg["variants"]
    n = 4
    # rest + hover, scale desktops to 960×540
    def load(vid, state):
        p = SINGLES / f"handle-{vid}-light-f1-{state}.png"
        return Image.open(p).convert("RGBA").resize((960, 540), Image.Resampling.LANCZOS)

    rests = [load(v[0], "rest") for v in variants]
    hovers = [load(v[0], "hover") for v in variants]
    drawer = Image.open(SINGLES / "handle-tab-light-f1-drawer.png").convert("RGBA")
    drawer = drawer.resize((1920, 1080), Image.Resampling.LANCZOS)

    pad = 56
    gap = 28
    slot_w, slot_h = 960, 540
    cap_h = 128
    section_h = 44
    header_h = 150
    drawer_label = 48
    W = pad * 2 + n * slot_w + (n - 1) * gap
    # 2 rows of desktops + drawer (centered, 1920)
    H = header_h + section_h + slot_h + cap_h + section_h + slot_h + cap_h + drawer_label + 1080 + 80

    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)
    header(canvas, draw, cfg["title"], cfg["subtitle"], W, pad)

    def place(imgs, y0, section, with_caption):
        row_label(draw, pad, y0, section)
        y = y0 + section_h
        for i, im in enumerate(imgs):
            x = pad + i * (slot_w + gap)
            c2 = shadow(canvas, im, (x, y), blur=14, alpha=45, dy=6)
            canvas.paste(c2)
        if with_caption:
            cy = y + slot_h + 16
            for i, v in enumerate(variants):
                x = pad + i * (slot_w + gap)
                caption_block(draw, x, cy, slot_w - 8, v[1], v[2], v[3])
            return cy + cap_h
        return y + slot_h + 16

    y = header_h
    y = place(rests, y, "静止（rest）— 可发现性", True)
    y = place(hovers, y + 4, "悬停（hover）— 反馈与信息", False)

    # drawer
    row_label(draw, pad, y, "抽屉展开（标签页方案，240ms 滑出）")
    y += drawer_label
    dx = (W - drawer.width) // 2
    c2 = shadow(canvas, drawer, (dx, y), blur=18, alpha=50, dy=8)
    canvas.paste(c2)
    y += drawer.height + 24
    ff = font(False, 16)
    foot = "把手为 CSS 视觉模拟，产品里是 Win32 原生绘制。位置记忆以 top: 420px 示意用户上次停放处。分支 cursor/ui-variants-8f3b，未合入产品，未改 PR 66。"
    draw.text((pad, H - 44), foot, font=ff, fill=FAINT)

    dest = OUT / "handle-compare.png"
    canvas.save(dest, "PNG", optimize=True)
    print("board", dest, canvas.size, dest.stat().st_size // 1024, "k")
    return dest


if __name__ == "__main__":
    for k, cfg in SURFACES.items():
        make_panel_board(k, cfg)
    make_handle_board()
    print("all boards done")
