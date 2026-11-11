"""
Build the scroll-scrubbed frame sequence for the website.

  pot video frames -> remove watermark -> cut out the pot (transparent bg)
  -> centre the pot -> website/public/frames/f_XXX.webp (with alpha)

The video backdrop and its shadows are neutral grey; clay, rice and garnish are
not, so a Lab-chroma mask isolates the pot. Where the camera pushes in and the
pot runs off the video frame, the cut edge is feathered so it dissolves.
ponytail: colour-key, not ML matting; switch to rembg if the source bg changes.

Usage:  python scripts/build_web_frames.py <frames_dir>
        (frames_dir = PNGs from: ffmpeg -i pot.mp4 frames/p_%03d.png)
"""
import glob
import os
import sys

import cv2
import numpy as np

OUT_W, OUT_H = 1280, 720
CHROMA_MIN = 16      # Lab chroma: backdrop ~3, shadow < ~20 at the rim, clay 30+
CHROMA_MIN_TOP = 8   # upper half: steam over the rim lowers chroma, no shadows there
WEBP_QUALITY = 82
DST = os.path.join(os.path.dirname(__file__), '..', 'website', 'public', 'frames')


def watermark_mask(first_frame):
    """Static sparkle + 'Veo' mark, bottom-right; found as a local brightness bump."""
    x0, y0 = 1600, 820
    g = cv2.cvtColor(first_frame[y0:, x0:], cv2.COLOR_BGR2GRAY)
    bump = g.astype(np.int16) - cv2.medianBlur(g, 41).astype(np.int16)
    m = np.zeros(first_frame.shape[:2], np.uint8)
    m[y0:, x0:] = (bump > 5).astype(np.uint8) * 255
    return cv2.dilate(m, None, iterations=4)


def chroma(bgr):
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    return np.hypot(lab[..., 1] - 128, lab[..., 2] - 128), lab[..., 0]


def pot_centre(bgr):
    """x from the rice (it sits in the pot opening, unlike the lid), y from the whole pot."""
    c, light = chroma(cv2.resize(bgr, (480, 270)))
    ys, xs = np.nonzero(c > CHROMA_MIN)
    rx = np.nonzero((c > 25) & (light > 165))[1]
    return (rx.mean() if rx.size else xs.mean()) / 480, ys.mean() / 270


def pot_alpha(bgr):
    c, _ = chroma(bgr)
    # Above the pot's middle there are no shadows, only steam over the rim, so a
    # lower threshold there keeps the rim whole; below it, stay strict (shadows).
    ys = np.nonzero(c > CHROMA_MIN)[0]
    mid = int(ys.mean()) if ys.size else c.shape[0] // 2
    thr = np.full(c.shape, CHROMA_MIN, np.float32)
    thr[:mid] = CHROMA_MIN_TOP
    mask = (c > thr).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
    # largest blob = pot + lid; drops specks and the watermark
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask)
    mask = np.where(lab == 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]), 255, 0).astype(np.uint8)
    # fill small holes (white rice grains); the shadowed pot-lid gap stays open
    n, lab, stats, _ = cv2.connectedComponentsWithStats(cv2.bitwise_not(mask))
    limit = 0.01 * mask.size
    small = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] < limit]
    mask[np.isin(lab, small)] = 255
    return cv2.GaussianBlur(cv2.erode(mask, None, iterations=1), (7, 7), 0)


def oval(h, w):
    """0 at the frame border -> 1 inside, so a pot cut off by the frame
    dissolves instead of ending in straight edges."""
    y, x = np.mgrid[0:h, 0:w]
    d = np.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2))
    r = np.clip((1.02 - d) / 0.24, 0, 1)
    return r * r * (3 - 2 * r)


def border_ramp(h, w):
    y, x = np.mgrid[0:h, 0:w]
    r = oval(h, w)
    # the watermark animates (sparkles, then a star) over the bottom-right
    # corner, so that corner is faded out rather than inpainted
    d = np.hypot((x - w * 0.93) / (w * 0.13), (y - h * 0.9) / (h * 0.24))
    c = np.clip(d - 0.6, 0, 1)
    return np.minimum(r, c * c * (3 - 2 * c))


def main(src_dir):
    paths = sorted(glob.glob(os.path.join(src_dir, '*.png')))
    assert paths, f'no PNGs in {src_dir}'
    os.makedirs(DST, exist_ok=True)
    for old in glob.glob(os.path.join(DST, 'f_*.webp')):
        os.remove(old)

    first = cv2.imread(paths[0])
    wm = watermark_mask(first)
    h, w = first.shape[:2]
    ramp = border_ramp(h, w)
    out_oval = oval(OUT_H, OUT_W)

    # Pot centre per frame, smoothed so the recentring never jitters.
    centres = np.array([pot_centre(cv2.imread(p)) for p in paths])
    k = 15
    pad = np.pad(centres, ((k, k), (0, 0)), mode='edge')
    centres = np.array([pad[i:i + 2 * k + 1].mean(0) for i in range(len(paths))])

    for i, p in enumerate(paths):
        bgr = cv2.inpaint(cv2.imread(p), wm, 9, cv2.INPAINT_TELEA)
        bgra = cv2.cvtColor(bgr, cv2.COLOR_BGR2BGRA)
        bgra[..., 3] = (pot_alpha(bgr) * ramp).astype(np.uint8)
        cx, cy = centres[i]
        shift = np.float32([[1, 0, (0.5 - cx) * w], [0, 1, (0.5 - cy) * h]])
        bgra = cv2.warpAffine(bgra, shift, (w, h), borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        bgra = cv2.resize(bgra, (OUT_W, OUT_H), interpolation=cv2.INTER_AREA)
        # again after recentring: the shift can bring cut-off content to the edge
        bgra[..., 3] = (bgra[..., 3] * out_oval).astype(np.uint8)
        cv2.imwrite(os.path.join(DST, f'f_{i:03d}.webp'), bgra, [cv2.IMWRITE_WEBP_QUALITY, WEBP_QUALITY])

    mb = sum(os.path.getsize(f) for f in glob.glob(os.path.join(DST, 'f_*.webp'))) / 2**20
    print(f'{len(paths)} frames -> {DST} ({mb:.1f} MB)')


if __name__ == '__main__':
    main(sys.argv[1])
