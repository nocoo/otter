#!/usr/bin/env python3
"""Generate web brand assets, or the inset macOS app icon with --macos."""

import argparse
from pathlib import Path
import subprocess
import tempfile

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "apps/web/public"


def macos_icon(rounded):
    # macOS does not inset the artwork: match the 824/1024 tile used by Lyre/Showtime.
    native = Image.new("RGBA", (1024, 1024))
    native.alpha_composite(rounded.resize((824, 824), Image.Resampling.LANCZOS), (100, 100))
    output = ROOT / "apps/macos/Otter/Resources/Otter.icns"
    with tempfile.TemporaryDirectory(prefix="otter-icon-") as temporary:
        iconset = Path(temporary) / "Otter.iconset"
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                name = f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"
                native.resize((size * scale, size * scale), Image.Resampling.LANCZOS).save(iconset / name)
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(output)], check=True)
    print("Generated macOS icon: 824 px tile, 100 px transparent margins, 10 representations.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--macos", action="store_true", help="Generate only the native app icon (requires macOS).")
    options = parser.parse_args()
    rounded = Image.open(ROOT / "assets/brand/icon-rounded.png").convert("RGBA")
    if options.macos:
        macos_icon(rounded)
        return
    PUBLIC.mkdir(parents=True, exist_ok=True)
    foreground = Image.open(ROOT / "logo.png").convert("RGBA")
    square = Image.open(ROOT / "assets/brand/icon.png").convert("RGBA")
    for size, name in [(24, "logo-24.png"), (80, "logo-80.png"), (32, "favicon.png")]:
        foreground.resize((size, size), Image.Resampling.LANCZOS).save(PUBLIC / name)
    foreground.save(PUBLIC / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    square.resize((180, 180), Image.Resampling.LANCZOS).convert("RGB").save(PUBLIC / "apple-touch-icon.png")
    social = Image.new("RGB", (1200, 630), (24, 24, 27))
    mark = rounded.resize((252, 252), Image.Resampling.LANCZOS)
    social.paste(mark, (474, 189), mark)
    social.save(PUBLIC / "opengraph-image.png")

    print("Generated transparent app/browser marks and touch/social presentations.")


if __name__ == "__main__":
    main()
