# Draws the app icon (assets/icon.ico, assets/icon.png) and the README banner
# (docs/banner.png) for Doorman Trainer. Usage: python make_art.py <repo root>
import math
import os
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

root = sys.argv[1]
os.makedirs(os.path.join(root, 'assets'), exist_ok=True)
os.makedirs(os.path.join(root, 'docs'), exist_ok=True)

BG = (21, 21, 26)
BG2 = (34, 30, 28)
AMBER = (239, 159, 39)
AMBER_TEXT = (250, 199, 117)
TEXT = (241, 239, 232)
MUTED = (168, 166, 158)
FONTS = 'C:/Windows/Fonts/'


def font(name, size):
    return ImageFont.truetype(FONTS + name, size)


def arch_path(cx, bottom, w, h, steps=48):
    """Points of an arched doorway: straight sides and a round top."""
    r = w / 2
    top_y = bottom - h + r
    pts = [(cx - r, bottom), (cx - r, top_y)]
    for i in range(steps + 1):
        a = math.pi + math.pi * i / steps
        pts.append((cx + r * math.cos(a), top_y + r * math.sin(a)))
    pts.append((cx + r, bottom))
    return pts


def door(size, cx, bottom, w, h, line):
    """A glowing portal in an amber frame, drawn on its own transparent layer."""
    layer = Image.new('RGBA', size, (0, 0, 0, 0))
    # Glow behind the frame.
    glow = Image.new('RGBA', size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).polygon(arch_path(cx, bottom, w * 1.05, h * 1.03), fill=AMBER + (150,))
    glow = glow.filter(ImageFilter.GaussianBlur(w * 0.18))
    layer.alpha_composite(glow)
    # The portal: warm at the bottom, deep at the top.
    portal = Image.new('RGBA', size, (0, 0, 0, 0))
    grad = Image.new('RGBA', size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    top = bottom - h
    for y in range(int(top), int(bottom) + 1):
        t = (y - top) / max(1, h)
        c = tuple(int(a + (b - a) * t) for a, b in zip((60, 32, 14), (250, 190, 90)))
        gd.line([(0, y), (size[0], y)], fill=c + (255,))
    mask = Image.new('L', size, 0)
    ImageDraw.Draw(mask).polygon(arch_path(cx, bottom, w, h), fill=255)
    portal.paste(grad, (0, 0), mask)
    layer.alpha_composite(portal)
    # Frame.
    ImageDraw.Draw(layer).line(arch_path(cx, bottom, w, h) , fill=AMBER + (255,), width=max(1, int(line)), joint='curve')
    return layer


# ---- icon ----
S = 1024
icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
base = Image.new('RGBA', (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(base)
bd.rounded_rectangle([40, 40, S - 40, S - 40], radius=200, fill=BG + (255,))
# A faint warm wash from below.
wash = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(wash).ellipse([S * 0.15, S * 0.55, S * 0.85, S * 1.2], fill=AMBER + (70,))
wash = wash.filter(ImageFilter.GaussianBlur(120))
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([40, 40, S - 40, S - 40], radius=200, fill=255)
base.alpha_composite(Image.composite(wash, Image.new('RGBA', (S, S), (0, 0, 0, 0)), mask))
icon.alpha_composite(base)
icon.alpha_composite(door((S, S), S / 2, S * 0.82, S * 0.44, S * 0.62, S * 0.045))
# Floor line under the door.
ImageDraw.Draw(icon).line([(S * 0.24, S * 0.82), (S * 0.76, S * 0.82)], fill=AMBER + (255,), width=int(S * 0.03))
icon.save(os.path.join(root, 'assets', 'icon.png'))
icon.resize((256, 256), Image.LANCZOS).save(
    os.path.join(root, 'assets', 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# ---- banner ----
W, H = 2560, 840
ban = Image.new('RGBA', (W, H), BG + (255,))
bd = ImageDraw.Draw(ban)
for y in range(H):
    t = y / H
    c = tuple(int(a + (b - a) * t) for a, b in zip(BG, BG2))
    bd.line([(0, y), (W, y)], fill=c + (255,))
# Two doors on the right, with the cart's path between them.
d1 = (W * 0.66, H * 0.80)
d2 = (W * 0.88, H * 0.80)
ban.alpha_composite(door((W, H), d1[0], d1[1], 230, 380, 12))
ban.alpha_composite(door((W, H), d2[0], d2[1], 230, 380, 12))
path = Image.new('RGBA', (W, H), (0, 0, 0, 0))
pd = ImageDraw.Draw(path)
x0, x1 = d1[0] + 150, d2[0] - 150
LIFT = 150


def pt(t):
    return (x0 + (x1 - x0) * t, H * 0.62 - math.sin(math.pi * t) * LIFT)


# Dashes from door 2 (t = 1) back toward door 1, stopping short of the
# arrowhead so it sits on the end of the curve.
T_END = 0.1
DASHES = 12
for i in range(DASHES):
    a = T_END + (1 - T_END) * i / DASHES
    b = T_END + (1 - T_END) * (i + 0.55) / DASHES
    pd.line([pt(a), pt(b)], fill=AMBER_TEXT + (220,), width=10)
# Arrowhead at door 1 (in through door 2, out at door 1), pointing along the
# curve's direction of travel: toward smaller t.
end = pt(T_END * 0.35)
dx, dy = -(x1 - x0), math.pi * LIFT * math.cos(math.pi * T_END * 0.35)
n = math.hypot(dx, dy)
ux, uy = dx / n, dy / n  # travel direction
px, py = -uy, ux  # perpendicular
tip = (end[0] + ux * 40, end[1] + uy * 40)
back = (tip[0] - ux * 70, tip[1] - uy * 70)
pd.polygon([tip, (back[0] + px * 21, back[1] + py * 21), (back[0] - px * 21, back[1] - py * 21)], fill=AMBER_TEXT + (230,))
ban.alpha_composite(path)
fl = ImageDraw.Draw(ban)
fl.line([(W * 0.56, H * 0.80), (W * 0.98, H * 0.80)], fill=AMBER + (160,), width=6)
lab = font('segoeuib.ttf', 40)
for (x, y), t in ((d1, '1'), (d2, '2')):
    fl.text((x, y + 30), t, font=lab, fill=MUTED, anchor='mt')
# Title and tagline.
fl.text((150, 250), 'Doorman Trainer', font=font('segoeuiz.ttf', 168), fill=TEXT, anchor='ls')
fl.text((156, 400), 'Practise the kidnap: door, door, cart, gone.', font=font('segoeui.ttf', 64), fill=AMBER_TEXT, anchor='ls')
fl.text((156, 500), 'A custom game mode for Deadlock', font=font('segoeui.ttf', 50), fill=MUTED, anchor='ls')
# The icon beside the text, small, bottom left.
small = icon.resize((150, 150), Image.LANCZOS)
ban.alpha_composite(small, (150, 600))
fl.text((330, 690), 'Ladder · Endless · Mid-Boss · Practice', font=font('segoeuib.ttf', 46), fill=TEXT, anchor='ls')
ban.convert('RGB').save(os.path.join(root, 'docs', 'banner.png'), optimize=True)
print('ok')
