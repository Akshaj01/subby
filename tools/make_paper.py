"""Make the panel's crumpled paper background: premiere-panel/assets/paper.jpg.

The crumples are a height field made of short V-shaped creases (sharp on the crease line,
flattening out sideways, fading at both ends), lit from the top left. Pure Python for the
shading, then ffmpeg (Homebrew) to upscale, add paper grain, tint it cream and save the JPEG.

Usage: python3 tools/make_paper.py [SEED]    (takes about 10 seconds)
"""
import math
import os
import random
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "premiere-panel", "assets", "paper.jpg")
W, H = 450, 800          # shading resolution; the JPEG is twice this (900 x 1600)
LIGHT = (-0.5, -0.6, 0.62)
BRIGHTNESS = 238          # paper grey level before the cream tint
CONTRAST = 0.5            # how strongly the crumples show


def creases(rnd):
    diag = math.hypot(W, H)
    out = []
    # (count, length, reach, depth) as fractions of the diagonal: big folds, creases, small wrinkles
    for count, length, reach, depth in ((10, 0.45, 0.10, 0.10), (45, 0.18, 0.04, 0.07), (90, 0.07, 0.015, 0.05)):
        for _ in range(count):
            ang = rnd.uniform(0, math.pi)
            out.append((
                rnd.uniform(-0.1, 1.1) * W, rnd.uniform(-0.1, 1.1) * H,
                math.cos(ang), math.sin(ang),
                length * rnd.uniform(0.5, 1.2) * diag,
                reach * rnd.uniform(0.6, 1.4) * diag,
                depth * rnd.uniform(0.5, 1.0) * (1 if rnd.random() < 0.5 else -1),
            ))
    return out


def height_field(rnd):
    h = [[0.0] * W for _ in range(H)]
    for cx, cy, ux, uy, half, r, a in creases(rnd):
        ext = half + 7 * r
        x0, x1 = max(0, int(cx - ext)), min(W, int(cx + ext) + 1)
        y0, y1 = max(0, int(cy - ext)), min(H, int(cy + ext) + 1)
        inv_half2 = 1.0 / (half * half)
        for y in range(y0, y1):
            row = h[y]
            dy = y - cy
            for x in range(x0, x1):
                dx = x - cx
                t = dx * ux + dy * uy
                f = 1.0 - t * t * inv_half2
                if f <= 0:
                    continue
                s = abs(dy * ux - dx * uy)
                if s > 7 * r:
                    continue
                row[x] += a * f * f * s * math.exp(-s / r)  # V at the crease, back to 0 sideways
    return h


def shade(h):
    n = math.sqrt(sum(c * c for c in LIGHT))
    lx, ly, lz = (c / n for c in LIGHT)
    data = bytearray()
    for y in range(H):
        above, below, row = h[max(0, y - 1)], h[min(H - 1, y + 1)], h[y]
        for x in range(W):
            gx = (row[min(W - 1, x + 1)] - row[max(0, x - 1)]) * 0.5
            gy = (below[x] - above[x]) * 0.5
            lit = (-gx * lx - gy * ly + lz) / math.sqrt(gx * gx + gy * gy + 1.0)
            data.append(max(0, min(255, int(128 + (lit - lz) * 600))))
    return bytes(data)


def main():
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    pixels = shade(height_field(random.Random(seed)))
    with tempfile.TemporaryDirectory() as tmp:
        pgm = os.path.join(tmp, "height.pgm")
        with open(pgm, "wb") as f:
            f.write(b"P5\n%d %d\n255\n" % (W, H) + pixels)
        look = (
            f"scale={W * 2}:{H * 2}:flags=bicubic,format=gray,"
            f"geq=lum='clip({BRIGHTNESS}+(p(X,Y)-128)*{CONTRAST},0,255)',"
            "noise=alls=6:allf=t,format=rgb24,colorchannelmixer=rr=1.0:gg=0.975:bb=0.92"
        )
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", pgm, "-vf", look, "-q:v", "3", OUT], check=True)
    print("wrote", os.path.normpath(OUT), os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
