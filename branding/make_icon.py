#!/usr/bin/env python3
"""Generates the NYX logo. Run manually, results are stored in branding/generated.

Needs Pillow. build.sh only uses the finished files, so it does not need Pillow.
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = Path(__file__).parent / "generated"
BASE = 2048  # working canvas, downsampled for smooth edges
K = BASE / 1024

# Everything is drawn on a 1024 grid, like the macOS icon template.
BODY = (100, 100, 924, 924)
RADIUS = 186
N_SHAPE = [(292, 716), (292, 308), (382, 308), (642, 590), (642, 400), (732, 400),
           (732, 716), (642, 716), (382, 434), (382, 716)]
SPARK_C = (687, 312)
SPARK_R = 58
SPARK_W = 11


def scaled(points):
    return [(x * K, y * K) for x, y in points]


def spark_points(cx, cy, r, w):
    return [(cx, cy - r), (cx + w, cy - w), (cx + r, cy), (cx + w, cy + w),
            (cx, cy + r), (cx - w, cy + w), (cx - r, cy), (cx - w, cy - w)]


def vertical_gradient(size, stops):
    """stops: list of (position 0..1, (r, g, b))."""
    w, h = size
    column = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(h - 1, 1)
        for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
            if p0 <= t <= p1:
                f = (t - p0) / (p1 - p0)
                column.putpixel((0, y), tuple(round(a + (b - a) * f) for a, b in zip(c0, c1)))
                break
    return column.resize((w, h))


def mark_mask(size):
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(scaled(N_SHAPE), fill=255)
    draw.polygon(scaled(spark_points(*SPARK_C, SPARK_R, SPARK_W)), fill=255)
    return mask


def render_icon():
    size = (BASE, BASE)
    body = Image.new("L", size, 0)
    ImageDraw.Draw(body).rounded_rectangle([v * K for v in BODY], RADIUS * K, fill=255)

    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    bg = vertical_gradient(size, [(0, (38, 39, 45)), (0.5, (15, 15, 18)), (1, (5, 5, 7))])
    canvas.paste(bg, (0, 0), body)

    # Thin silver rim, like a machined edge.
    inner = Image.new("L", size, 0)
    inset = 5
    ImageDraw.Draw(inner).rounded_rectangle(
        [(BODY[0] + inset) * K, (BODY[1] + inset) * K, (BODY[2] - inset) * K, (BODY[3] - inset) * K],
        (RADIUS - inset) * K, fill=255)
    rim = ImageChops.subtract(body, inner).point(lambda v: v * 0.55)
    rim_color = vertical_gradient(size, [(0, (205, 208, 214)), (1, (70, 72, 78))])
    canvas.paste(rim_color, (0, 0), rim)

    # Soft silver glow behind the mark.
    mask = mark_mask(size)
    glow = mask.filter(ImageFilter.GaussianBlur(26 * K)).point(lambda v: v * 0.32)
    canvas.paste(Image.new("RGB", size, (190, 196, 208)), (0, 0), ImageChops.multiply(glow, body))

    silver = vertical_gradient(size, [(0, (255, 255, 255)), (0.22, (232, 234, 238)), (0.34, (232, 234, 238)),
                                      (0.5, (150, 153, 161)), (0.56, (205, 208, 214)), (0.72, (168, 171, 179)),
                                      (1, (112, 115, 123))])
    canvas.paste(silver, (0, 0), mask)
    return canvas


def write_svg(path):
    n = " ".join(f"{x},{y}" for x, y in N_SHAPE)
    spark = " ".join(f"{x},{y}" for x, y in spark_points(*SPARK_C, SPARK_R, SPARK_W))
    path.write_text(f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#26272d"/><stop offset=".5" stop-color="#0f0f12"/><stop offset="1" stop-color="#050507"/>
    </linearGradient>
    <linearGradient id="silver" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#c4c6cc"/><stop offset="1" stop-color="#70737b"/>
    </linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)"/>
  <polygon points="{n}" fill="url(#silver)"/>
  <polygon points="{spark}" fill="url(#silver)"/>
</svg>
""")


def main():
    iconset = OUT / "nyx.iconset"
    iconset.mkdir(parents=True, exist_ok=True)
    master = render_icon()
    for pts in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            px = pts * scale
            suffix = "@2x" if scale == 2 else ""
            master.resize((px, px), Image.LANCZOS).save(iconset / f"icon_{pts}x{pts}{suffix}.png")
    for px in (16, 32, 48, 64, 128, 210, 420, 1024):
        master.resize((px, px), Image.LANCZOS).save(OUT / f"logo{px}.png")
    master.resize((256, 256), Image.LANCZOS).save(
        OUT / "document.ico", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
    write_svg(OUT / "logo.svg")


if __name__ == "__main__":
    main()
