#!/usr/bin/env python3
"""Build every app icon from the Reach logo.

The logo is gold line art on a near-white ground (#FEFEFE, not pure white),
so the knockout threshold has to sit below that or the ground survives as a
pale square. The icons are transparent: the hands sit on whatever is behind
them, which is what the owner asked for. The maroon is still the manifest's
theme and background, so the PWA splash and browser chrome match the app.

    pip3 install --user Pillow
    python3 scripts/make_icons.py [path-to-reference-folder]

The references live outside the repo (~/Desktop/OG APP REF by default): they
are 5MB of screenshots and only this script reads them.
"""
import os
import sys
from PIL import Image

# Sampled from REF6's page background. Kept for the manifest and the splash
# even though the icons themselves are transparent: the owner asked for the
# hands to sit on whatever is behind them.
MAROON = (44, 14, 24)  # #2C0E18
# Transparent icons everywhere. Two platforms do not honour that and there is
# no file that changes it:
#   iOS composites apple-touch-icon onto BLACK.
#   Android fills a maskable icon's transparency itself, usually white.
# Both are the platform's choice, not ours, and are called out in the report.
TRANSPARENT = (0, 0, 0, 0)
DEFAULT_SRC = os.path.expanduser("~/Desktop/OG APP REF")
OUT = "public"
# The ground is #FEFEFE and the palest gold stroke is far below this.
WHITE_THRESH = 235


def load_logo(src_dir):
    for name in sorted(os.listdir(src_dir)):
        if name.upper().startswith("LOGO"):
            return Image.open(os.path.join(src_dir, name)).convert("RGBA")
    raise SystemExit(f"LOGO not found in {src_dir!r}")


def knock_out_white(img, thresh=WHITE_THRESH):
    """Make the near-white ground transparent, feathering the edge.

    A hard threshold leaves a pale fringe around every stroke — the pixels
    between the ground and the gold. Alpha is ramped across that range
    instead, so the line keeps its shape without a halo on the maroon.
    """
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            light = min(r, g, b)
            if light > thresh:
                px[x, y] = (r, g, b, 0)
            elif light > thresh - 40:
                # Partly transparent across the transition, proportionally.
                fade = int(255 * (thresh - light) / 40)
                px[x, y] = (r, g, b, min(a, fade))
    return img


def trim(img):
    """Crop to the art, so 78% means 78% of the icon is hands, not margin."""
    box = img.getbbox()
    return img.crop(box) if box else img


def fit(art, size, scale):
    """The art at `scale` of `size`, keeping its aspect ratio."""
    copy = art.copy()
    copy.thumbnail((int(size * scale), int(size * scale)), Image.LANCZOS)
    return copy


def make_icon(art, size, scale, bg, name, opaque=False):
    """bg of None means a transparent canvas."""
    mode = "RGB" if opaque else "RGBA"
    canvas = Image.new("RGBA", (size, size), TRANSPARENT if bg is None else bg + (255,))
    a = fit(art, size, scale)
    canvas.alpha_composite(a, ((size - a.width) // 2, (size - a.height) // 2))
    if opaque:
        canvas = canvas.convert("RGB")
    path = os.path.join(OUT, name)
    canvas.save(path)
    print(f"  {name:32s} {size}x{size}  art {int(scale*100)}%  {mode}")
    return canvas


def main():
    src_dir = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.isdir(src_dir):
        raise SystemExit(f"reference folder not found: {src_dir!r}")
    os.makedirs(OUT, exist_ok=True)

    art = trim(knock_out_white(load_logo(src_dir)))
    print(f"logo: {src_dir} → art {art.width}x{art.height} after knockout and trim")

    # The hands on transparent, for the header circle and the purpose card.
    mark = art.copy()
    mark.thumbnail((512, 512), Image.LANCZOS)
    mark.save(os.path.join(OUT, "logo-mark.png"))
    print(f"  {'logo-mark.png':32s} {mark.width}x{mark.height}  transparent")

    make_icon(art, 192, 0.78, None, "icon-192.png")
    make_icon(art, 512, 0.78, None, "icon-512.png")
    # Maskable icons are cropped to a circle by the launcher, so the art sits
    # well inside the safe area.
    make_icon(art, 512, 0.58, None, "icon-512-maskable.png")

    # iOS asks for the precomposed name on older devices and renders a black
    # square when it is missing, so both are written. Transparency here is
    # composited onto black by iOS itself.
    for name in ("apple-touch-icon.png", "apple-touch-icon-precomposed.png"):
        make_icon(art, 180, 0.78, None, name)

    ico = Image.new("RGBA", (48, 48), TRANSPARENT)
    a = fit(art, 48, 0.80)
    ico.alpha_composite(a, ((48 - a.width) // 2, (48 - a.height) // 2))
    ico.save(os.path.join(OUT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
    ico.save(os.path.join(OUT, "favicon.png"))
    print(f"  {'favicon.ico':32s} 16/32/48")
    print(f"  {'favicon.png':32s} 48x48")

    preview = make_icon(art, 512, 0.78, None, "icon-preview.png")

    # A halo would show as near-opaque greyish pixels around the strokes.
    # On a transparent canvas they are the ones that survived the knockout.
    halo = sum(
        1 for p in preview.getdata()
        if p[3] > 200 and max(p[:3]) - min(p[:3]) < 25 and sum(p[:3]) > 500
    )
    total = preview.width * preview.height
    print(f"\nhalo check: {halo} grey-ish pixels of {total} ({100*halo/total:.3f}%)"
          f" — {'clean' if halo < total * 0.001 else 'FRINGING, raise the threshold'}")
    print("\ndone — copy public/icon-preview.png to ~/Desktop for the owner")


if __name__ == "__main__":
    main()
