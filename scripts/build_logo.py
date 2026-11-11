"""
Cut the Tales of Biryani logo out of the brand artwork as transparent PNGs.

  logo-mark.png      pot + steam (header, favicon)
  logo-wordmark.png  "TALES OF BIRYANI"
  logo-full.png      mark above wordmark (loader, footer)
  favicon.ico, favicon-32.png, apple-touch-icon.png
  og-image.jpg       1200x630 social share card (needs website/public/frames)

The tagline line under the wordmark is deliberately left out. The logo is a
single gold on purple, so alpha = how yellow a pixel is, and the colour is
flattened to the logo gold (clean edges, no purple fringe).

Usage:  python scripts/build_logo.py <artwork.png>
"""
import os
import sys

import cv2
import numpy as np

# Row bands in the 2752x1536 source (found by scanning for gold rows).
MARK_ROWS = (226, 1060)       # steam + pot
WORDMARK_ROWS = (1224, 1387)  # "TALES OF BIRYANI"; tagline starts at 1397
PAD = 8          # < 10: the tagline starts 10 rows below the wordmark
DST = os.path.join(os.path.dirname(__file__), '..', 'website', 'public')


def cut(img, rows):
    band = img[rows[0] - PAD: rows[1] + PAD]
    b, g, r = [band[..., i].astype(np.float32) for i in range(3)]
    yellow = (r + g) / 2 - b                      # purple bg ~ -40, gold ~ +150
    alpha = np.clip((yellow - 20) / 100, 0, 1)
    solid = alpha > 0.95
    gold = np.median(band[solid], axis=0)
    out = np.zeros((*band.shape[:2], 4), np.uint8)
    out[..., :3] = gold
    out[..., 3] = (alpha * 255).astype(np.uint8)
    cols = np.nonzero(out[..., 3].max(0) > 10)[0]
    return out[:, max(cols[0] - PAD, 0): cols[-1] + PAD + 1]


def main(src):
    img = cv2.imread(src)
    assert img is not None and img.shape[:2] == (1536, 2752), 'unexpected artwork size'
    mark, word = cut(img, MARK_ROWS), cut(img, WORDMARK_ROWS)

    # full lockup: mark centred over wordmark
    gap = 60
    w = max(mark.shape[1], word.shape[1])
    full = np.zeros((mark.shape[0] + gap + word.shape[0], w, 4), np.uint8)
    full[:mark.shape[0], (w - mark.shape[1]) // 2:][:, :mark.shape[1]] = mark
    full[mark.shape[0] + gap:, (w - word.shape[1]) // 2:][:, :word.shape[1]] = word

    for name, im in (('logo-mark.png', mark), ('logo-wordmark.png', word), ('logo-full.png', full)):
        cv2.imwrite(os.path.join(DST, name), im)
        print(name, im.shape[1], 'x', im.shape[0])
    icons(mark)
    share_image(full)


def square(mark, size, bg=None, fill=0.86):
    """Mark centred on a square canvas (transparent, or on a solid bg)."""
    h, w = mark.shape[:2]
    s = fill * size / max(h, w)
    m = cv2.resize(mark, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    out = np.zeros((size, size, 4), np.uint8)
    if bg is not None:
        out[...] = (*bg, 255)
    y, x = (size - m.shape[0]) // 2, (size - m.shape[1]) // 2
    a = m[..., 3:4] / 255.0
    region = out[y:y + m.shape[0], x:x + m.shape[1]]
    region[..., :3] = (m[..., :3] * a + region[..., :3] * (1 - a)).astype(np.uint8)
    region[..., 3] = np.maximum(region[..., 3], m[..., 3])
    return out


def icons(mark):
    from PIL import Image
    plum = (25, 0, 25)  # BGR of #190019
    cv2.imwrite(os.path.join(DST, 'favicon-32.png'), square(mark, 32, fill=0.95))
    cv2.imwrite(os.path.join(DST, 'apple-touch-icon.png'), square(mark, 180, bg=plum, fill=0.7))
    big = square(mark, 256, fill=0.95)
    Image.fromarray(cv2.cvtColor(big, cv2.COLOR_BGRA2RGBA)).save(
        os.path.join(DST, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
    old = os.path.join(DST, 'favicon.png')
    if os.path.exists(old):
        os.remove(old)
    print('favicon.ico, favicon-32.png, apple-touch-icon.png')


def share_image(logo):
    """1200x630 social card: plum backdrop, bowl on the right, logo on the left."""
    W, H = 1200, 630
    yy, xx = np.mgrid[0:H, 0:W]
    glow = np.clip(1 - np.hypot((xx - 820) / 520, (yy - 330) / 360), 0, 1)[..., None]
    night, indigo = np.array([25, 0, 25], np.float32), np.array([76, 18, 43], np.float32)  # BGR
    canvas = night + (indigo - night) * glow
    bowl = cv2.imread(os.path.join(DST, 'frames', 'f_000.webp'), cv2.IMREAD_UNCHANGED)
    bowl = cv2.resize(bowl, (880, 495), interpolation=cv2.INTER_AREA)
    canvas = paste(canvas, bowl, 790 - 440, 330 - 247)
    lw = 330
    lg = cv2.resize(logo, (lw, round(logo.shape[0] * lw / logo.shape[1])), interpolation=cv2.INTER_AREA)
    canvas = paste(canvas, lg, 80, (H - lg.shape[0]) // 2)
    cv2.imwrite(os.path.join(DST, 'og-image.jpg'), canvas.astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 88])
    print('og-image.jpg 1200 x 630')


def paste(canvas, img, x, y):
    h, w = img.shape[:2]
    x0, y0 = max(x, 0), max(y, 0)
    x1, y1 = min(x + w, canvas.shape[1]), min(y + h, canvas.shape[0])
    src = img[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32)
    a = src[..., 3:4] / 255
    canvas[y0:y1, x0:x1] = src[..., :3] * a + canvas[y0:y1, x0:x1] * (1 - a)
    return canvas


if __name__ == '__main__':
    main(sys.argv[1])
