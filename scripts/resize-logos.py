#!/usr/bin/env python3
"""
Resize logo.png (transparent background) for different use cases.

Two distinct output categories:
1. packages/web/public/  — assets referenced by <img src> in components
   - logo-24.png (sidebar), logo-80.png (login page)
2. packages/web/src/app/ — Next.js file-based metadata convention
   - icon.png (32x32), apple-icon.png (180x180), favicon.ico (16+32),
     opengraph-image.png (1200x630)
"""

from PIL import Image
from pathlib import Path


def resize_square(img: Image.Image, size: int) -> Image.Image:
    """Resize square image to target size with LANCZOS resampling."""
    return img.resize((size, size), Image.Resampling.LANCZOS)


def create_og_image(logo: Image.Image, bg_color: tuple[int, ...]) -> Image.Image:
    """Create 1200x630 OG image with logo centered at ~40% height."""
    canvas = Image.new("RGB", (1200, 630), bg_color)

    # Scale logo to fit nicely (~250px)
    logo_size = 250
    logo_resized = resize_square(logo, logo_size)

    # Center horizontally, place at ~40% height
    x = (1200 - logo_size) // 2
    y = int(630 * 0.4) - logo_size // 2

    # Paste with alpha mask for transparency
    canvas.paste(logo_resized, (x, y), logo_resized)
    return canvas


def main():
    root = Path(__file__).parent.parent
    public = root / "packages" / "web" / "public"
    app = root / "packages" / "web" / "src" / "app"
    public.mkdir(parents=True, exist_ok=True)
    app.mkdir(parents=True, exist_ok=True)

    # Load single source image (transparent background)
    logo = Image.open(root / "logo.png").convert("RGBA")
    print(f"Source logo: {logo.size}")

    # --- public/ : component-referenced assets only ---

    # Sidebar logo (24x24)
    sidebar = resize_square(logo, 24)
    sidebar.save(public / "logo-24.png")
    print(f"  public/logo-24.png: {sidebar.size}")

    # Login/loading page logo (80x80)
    login = resize_square(logo, 80)
    login.save(public / "logo-80.png")
    print(f"  public/logo-80.png: {login.size}")

    # --- src/app/ : Next.js file-based metadata convention ---

    # icon.png (32x32) — auto-generates <link rel="icon">
    icon = resize_square(logo, 32)
    icon.save(app / "icon.png")
    print(f"  src/app/icon.png: {icon.size}")

    # apple-icon.png (180x180) — auto-generates <link rel="apple-touch-icon">
    apple_icon = resize_square(logo, 180)
    apple_icon.save(app / "apple-icon.png")
    print(f"  src/app/apple-icon.png: {apple_icon.size}")

    # favicon.ico (multi-size 16+32) — auto-generates <link rel="icon">
    favicon_16 = resize_square(logo, 16)
    favicon_32 = resize_square(logo, 32)
    favicon_16.save(
        app / "favicon.ico",
        format="ICO",
        append_images=[favicon_32],
        sizes=[(16, 16), (32, 32)],
    )
    print("  src/app/favicon.ico: 16x16 + 32x32")

    # opengraph-image.png (1200x630) — auto-generates <meta property="og:image">
    # Brand color: hsl(186, 72%, 38%) ≈ #1BA3A6 (Teal/Cyan)
    og = create_og_image(logo, (27, 163, 166))
    og.save(app / "opengraph-image.png")
    print("  src/app/opengraph-image.png: 1200x630")

    print("Done!")


if __name__ == "__main__":
    main()
