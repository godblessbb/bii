"""Regenerates the synthetic test photo used by _dev/sticker_flow_check.py.

    python3 _dev/sticker/fixtures/make_fixtures.py

pet-on-plain-background.jpg: 2400 x 3000 JPEG (bigger than the 1600 px the browser shrinks photos to),
a cartoon "pet" (head, ears, eyes, body) on a warm grey wall with a soft gradient and light noise, so the
browser's mock cutout has a real subject to find. Deterministic (fixed seed). Nobody's likeness is in it.
"""
from pathlib import Path
import random

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent


def pet(w: int = 2400, h: int = 3000) -> Image.Image:
    rnd = random.Random(29)
    im = Image.new('RGB', (w, h))
    px = im.load()
    for y in range(h):
        g = 222 - int(18 * y / h)
        for x in range(0, w):
            px[x, y] = (g, g - 5, g - 12)
    d = ImageDraw.Draw(im)
    cx = w // 2
    # body
    d.ellipse([cx - 620, 1500, cx + 620, 2750], fill=(196, 104, 44))
    d.ellipse([cx - 380, 1800, cx + 380, 2700], fill=(244, 222, 190))
    # ears
    d.polygon([(cx - 640, 900), (cx - 520, 260), (cx - 160, 640)], fill=(170, 86, 34))
    d.polygon([(cx + 640, 900), (cx + 520, 260), (cx + 160, 640)], fill=(170, 86, 34))
    # head
    d.ellipse([cx - 700, 420, cx + 700, 1720], fill=(214, 120, 52))
    d.ellipse([cx - 420, 1020, cx + 420, 1640], fill=(246, 226, 196))
    # eyes, nose, mouth
    for ex in (cx - 300, cx + 300):
        d.ellipse([ex - 110, 860, ex + 110, 1080], fill=(32, 28, 26))
        d.ellipse([ex - 40, 890, ex + 10, 940], fill=(250, 250, 250))
    d.polygon([(cx - 90, 1180), (cx + 90, 1180), (cx, 1290)], fill=(60, 36, 30))
    d.arc([cx - 200, 1220, cx, 1420], 20, 160, fill=(60, 36, 30), width=18)
    d.arc([cx, 1220, cx + 200, 1420], 20, 160, fill=(60, 36, 30), width=18)
    # collar with a tag
    d.rounded_rectangle([cx - 480, 1640, cx + 480, 1740], radius=40, fill=(46, 107, 74))
    d.ellipse([cx - 90, 1700, cx + 90, 1880], fill=(232, 190, 70))
    im = im.filter(ImageFilter.GaussianBlur(2))
    # light sensor-like noise so it isn't a flat vector image
    px = im.load()
    for _ in range(140000):
        x, y = rnd.randrange(w), rnd.randrange(h)
        r, g, b = px[x, y]
        n = rnd.randint(-10, 10)
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return im


if __name__ == '__main__':
    out = HERE / 'pet-on-plain-background.jpg'
    pet().save(out, quality=86, optimize=True)
    print(out, out.stat().st_size, 'bytes')
