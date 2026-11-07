"""Clock widget backdrop (public/widgets/clock-{s,w}.webp): the Clock logo's own ring and face (hands removed,
brand-src/clock-face.png) on the logo's lavender surface, so the widget and the app icon share one colour.
Marks and hands are drawn live in widgets.tsx."""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np, sys
SRC, OUT = sys.argv[1], sys.argv[2]
face = Image.open(SRC).convert("RGBA")
CX, CY, R = 454.75, 458.0, 286.0           # dial in clock-face.png
SIZES = {"s": (521, 514, 0.5167, 0.5163, 0.30), "w": (1028, 514, 0.727, 0.5212, 0.3424)}
arr = np.asarray(face).astype(float)
def tile_color(fx, fy):                      # logo tile colour near the ring, to blend the surface
    return arr[int(fy), int(fx), :3]
for k, (w, h, x, y, r) in SIZES.items():
    W, H = w * 2, h * 2
    cx, cy, ri = x * W, y * H, r * H
    sc = ri / R
    # surface: the tile's own lavender gradient, matched to the logo
    tl, br = tile_color(CX - 0.0, CY - R * 1.44), tile_color(CX + R * 1.3, CY + R * 1.3)
    gx, gy = np.meshgrid(np.linspace(0, 1, W), np.linspace(0, 1, H))
    t = np.clip((gx * 0.45 + gy * 0.55), 0, 1)[..., None]
    c0, c1, c2 = np.array([251, 249, 255.0]), np.array([240, 232, 253.0]), np.array([226, 214, 250.0])
    bg = np.where(t < 0.55, c0 + (c1 - c0) * (t / 0.55), c1 + (c2 - c1) * ((t - 0.55) / 0.45))
    base = Image.fromarray(bg.astype("uint8"), "RGB").convert("RGBA")
    rad = R * 1.34
    crop = face.crop((int(CX - rad), int(CY - rad), int(CX + rad), int(CY + rad)))
    n = int(2 * rad * sc)
    crop = crop.resize((n, n), Image.LANCZOS)
    m = Image.new("L", (n, n), 0); d = ImageDraw.Draw(m)
    m_r = n / 2 * 0.97
    d.ellipse((n / 2 - m_r, n / 2 - m_r, n / 2 + m_r, n / 2 + m_r), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(n * 0.035))
    base.paste(crop, (int(cx - n / 2), int(cy - n / 2)), m)
    base.convert("RGB").save(f"{OUT}/clock-{k}.webp", quality=90, method=6)
    print(k, W, H)
