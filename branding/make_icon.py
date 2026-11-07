#!/usr/bin/env python3
"""Generates the NYX logo: a planet of dots, the internet, with the N lit up in it.
Run manually, results are stored in branding/generated.

The logo is drawn as SVG (generated/logo.svg is the real vector). PNG sizes are rendered from it
by headless Google Chrome, then scaled with Pillow. build.sh only uses the finished files.
The continents come from branding/land-mask.png, rasterized from Natural Earth's 110m land
(public domain, naturalearthdata.com).
"""
import math
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
OUT = HERE / "generated"
LAND = HERE / "land-mask.png"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

C = 512  # 1024 grid, like the macOS icon template
R = 300
VIEW_LON = -20  # the Atlantic in the middle: the Americas left, Europe and Africa right
VIEW_LAT = 10
LIGHT = (-0.45, 0.5, 0.74)  # from the upper left, towards the viewer
N_SHAPE = [(372, 692), (372, 332), (440, 332), (584, 560), (584, 332), (652, 332), (652, 692), (584, 692),
           (440, 464), (440, 692)]
CITIES = [(40.7, -74), (51.5, 0), (-23.5, -46.6), (6.5, 3.4), (55.7, 37.6), (19.4, -99.1)]
LINKS = ((5, 0), (0, 2), (1, 4), (3, 2))

SILVER = "#eef0f4"
INK = "#0a0a0d"

# Up to this size the full planet turns to mush: bigger dots, a solid N, no links.
SMALL_MAX = 32


def project(lat, lon):
    """Orthographic view: screen x, y on the 1024 grid, z (> 0 faces the viewer) and the normal."""
    la, lo, la0 = math.radians(lat), math.radians(lon - VIEW_LON), math.radians(VIEW_LAT)
    x = math.cos(la) * math.sin(lo)
    y = math.cos(la0) * math.sin(la) - math.sin(la0) * math.cos(la) * math.cos(lo)
    z = math.sin(la0) * math.sin(la) + math.cos(la0) * math.cos(la) * math.cos(lo)
    return C + R * x, C - R * y, z, (x, y, z)


def lit(normal):
    n = math.sqrt(sum(v * v for v in LIGHT))
    return max(0.0, sum(a * b for a, b in zip(normal, LIGHT)) / n)


def in_n(px, py):
    hit = False
    for (x1, y1), (x2, y2) in zip(N_SHAPE, N_SHAPE[1:] + N_SHAPE[:1]):
        if (y1 > py) != (y2 > py) and px < (x2 - x1) * (py - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def gray(level):
    v = round(level)
    return f"#{v:02x}{v:02x}{min(255, v + 6):02x}"


def cell(lat, lon, half):
    corners = [project(lat + a, lon + b) for a, b in ((half, -half), (half, half), (-half, half), (-half, -half))]
    return " ".join(f"{x:.0f},{y:.0f}" for x, y, *_ in corners)


def planet(step, fill, small):
    land = Image.open(LAND).convert("L")
    half = step * fill / 2
    parts = []
    lat = -90 + step / 2
    while lat < 90:
        lon = -180 + step / 2
        while lon < 180:
            x, y, z, normal = project(lat, lon)
            if z > 0.04:
                is_land = land.getpixel((int((lon + 180) / 360 * land.width) % land.width,
                                         min(int((90 - lat) / 180 * land.height), land.height - 1))) > 0
                if not small and in_n(x, y):
                    # The N: every cell of the grid lit, land or sea, brightest of all.
                    parts.append(f'<polygon points="{cell(lat, lon, half * 1.3)}" fill="{SILVER}"/>')
                elif is_land:
                    parts.append(f'<polygon points="{cell(lat, lon, half)}" fill="{gray(52 + 120 * lit(normal) ** 0.8)}"/>')
            lon += step
        lat += step
    return "".join(parts)


def links():
    """A few links between cities, arcing above the surface."""
    pts = [project(a, b) for a, b in CITIES]
    parts = []
    for i, j in LINKS:
        (x1, y1, *_), (x2, y2, *_) = pts[i], pts[j]
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        dx, dy = mx - C, my - C
        length = math.hypot(dx, dy) or 1
        lift = 0.35 * math.hypot(x2 - x1, y2 - y1)
        parts.append(f'<path d="M{x1:.0f},{y1:.0f} Q{mx + dx / length * lift:.0f},{my + dy / length * lift:.0f} {x2:.0f},{y2:.0f}" '
                     f'fill="none" stroke="{SILVER}" stroke-width="4" stroke-dasharray="2 9" stroke-linecap="round"/>')
    parts += [f'<circle cx="{x:.0f}" cy="{y:.0f}" r="9" fill="{INK}" stroke="{SILVER}" stroke-width="5"/>'
              for x, y, z, _ in pts if z > 0]
    return "".join(parts)


def svg(small=False):
    if small:
        n = " ".join(f"{x},{y}" for x, y in N_SHAPE)
        inner = planet(step=7.5, fill=0.7, small=True)
        inner += f'<polygon points="{n}" fill="{SILVER}" stroke="{INK}" stroke-width="22" paint-order="stroke"/>'
    else:
        inner = planet(step=3.2, fill=0.66, small=False) + links()
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1c21"/><stop offset="1" stop-color="#060608"/></linearGradient>
<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a9ea8"/><stop offset="1" stop-color="#2a2c31"/></linearGradient>
</defs>
<rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)"/>
<circle cx="{C}" cy="{C}" r="{R + 4}" fill="none" stroke="#24262c" stroke-width="3"/>
{inner}
<rect x="103" y="103" width="818" height="818" rx="183" fill="none" stroke="url(#rim)" stroke-width="6"/>
</svg>
"""


def rasterize(source, work):
    """1024 px PNG with a transparent background, rendered by headless Chrome."""
    path = work / f"{source.stem}.png"
    subprocess.run([CHROME, "--headless=new", f"--user-data-dir={work / 'chrome'}", "--disable-gpu", "--hide-scrollbars",
                    "--default-background-color=00000000", "--window-size=1024,1024", f"--screenshot={path}",
                    source.as_uri()], check=True, capture_output=True)
    return Image.open(path).convert("RGBA")


def main():
    OUT.mkdir(exist_ok=True)
    (OUT / "logo.svg").write_text(svg())
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "small.svg").write_text(svg(small=True))
        master = rasterize(OUT / "logo.svg", work)
        small = rasterize(work / "small.svg", work)

    def pick(size):
        return (small if size <= SMALL_MAX else master).resize((size, size), Image.LANCZOS)

    iconset = OUT / "nyx.iconset"
    iconset.mkdir(exist_ok=True)
    for pts in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            suffix = "@2x" if scale == 2 else ""
            pick(pts * scale).save(iconset / f"icon_{pts}x{pts}{suffix}.png")
    for size in (16, 32, 48, 64, 128, 210, 420, 1024):
        pick(size).save(OUT / f"logo{size}.png")
    # .ico files: each size gets its own picture, so 16 and 32 use the simple one.
    sizes = (16, 24, 32, 48, 64, 128, 256)
    frames = [pick(s) for s in sizes]
    frames[-1].save(OUT / "document.ico", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)], append_images=frames[:-1])
    frames[-1].save(OUT / "nyx.ico", sizes=[(s, s) for s in sizes], append_images=frames[:-1])


if __name__ == "__main__":
    main()
