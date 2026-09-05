#!/usr/bin/env python3
"""
Regenerates `receipt-photo.jpg` — the "client photographed a document with their phone"
fixture.

This is a test fixture and is labelled as one (CLAUDE.md §4). It is checked in rather than
generated at test time so that a run needs no Python, and this script exists so the file is
reproducible rather than a mystery blob.

What makes it a *useful* fixture is that it is a real JPEG with the properties that actually
break document-collection products: a 12-megapixel portrait frame straight off a handset,
4:2:0 chroma subsampling, quality 88, and an EXIF block naming a camera. Gather's upload
pipeline sniffs magic bytes rather than trusting the extension, so a fixture that is a real
JPEG all the way down is the only one that proves anything.

    python3 e2e/fixtures/make-photo.py
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# iPhone 15 main camera, portrait orientation. Deliberately large: a phone photo of a
# document is the biggest thing most clients will ever upload.
WIDTH, HEIGHT = 3024, 4032

OUT = pathlib.Path(__file__).with_name("receipt-photo.jpg")

LINES = [
    ("HANOVER STREET SUPPLIES", 96, "bold"),
    ("41 Hanover Street, Edinburgh EH2 2PJ", 52, None),
    ("VAT 872 4419 06", 52, None),
    (None, 40, None),
    ("Invoice  HS-20261/4471", 60, "bold"),
    ("Date  14 January 2026", 56, None),
    (None, 40, None),
    ("2 x Box files, foolscap            18.40", 56, None),
    ("1 x Archive storage boxes (10)     32.00", 56, None),
    ("1 x Toner cartridge, black         74.99", 56, None),
    ("1 x Recorded delivery postage       8.85", 56, None),
    (None, 30, None),
    ("Subtotal                          134.24", 56, None),
    ("VAT at 20%                         26.85", 56, None),
    ("TOTAL                             161.09", 72, "bold"),
    (None, 40, None),
    ("Paid by card ending 4419", 52, None),
    ("Thank you for your custom", 52, None),
]


def font(size: int, weight: str | None) -> ImageFont.FreeTypeFont:
    candidates = (
        [
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
        ]
        if weight == "bold"
        else [
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
        ]
    )
    for path in candidates:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


def main() -> None:
    # A desk, not a scanner bed: the paper sits on a darker surface and is lit unevenly.
    image = Image.new("RGB", (WIDTH, HEIGHT), (63, 60, 56))
    draw = ImageDraw.Draw(image)

    margin_x, margin_y = 240, 320
    draw.rectangle(
        [margin_x, margin_y, WIDTH - margin_x, HEIGHT - margin_y],
        fill=(246, 244, 238),
    )

    y = margin_y + 180
    for text, size, weight in LINES:
        if text is None:
            y += size
            continue
        face = font(size, weight)
        draw.text((margin_x + 140, y), text, font=face, fill=(28, 26, 24))
        y += size + 26

    # Phone-camera realities: a soft shadow gradient across the frame, and the slight
    # blur of a hand-held shot. Both are what make a photographed document harder to
    # read than a scan, and both are real properties of the bytes.
    shadow = Image.linear_gradient("L").resize((WIDTH, HEIGHT)).rotate(12, fillcolor=128)
    image = Image.composite(image, Image.new("RGB", image.size, (18, 17, 16)), shadow.point(lambda v: 255 - v // 3))
    image = image.filter(ImageFilter.GaussianBlur(1.4))

    exif = Image.Exif()
    exif[0x010F] = "Apple"  # Make
    exif[0x0110] = "iPhone 15"  # Model
    exif[0x0131] = "iOS 18.2"  # Software
    exif[0x0132] = "2026:01:14 18:22:07"  # DateTime
    exif[0x0112] = 1  # Orientation, top-left

    image.save(OUT, "JPEG", quality=88, subsampling="4:2:0", exif=exif, optimize=True)
    print(f"{OUT.name}: {OUT.stat().st_size:,} bytes, {WIDTH}x{HEIGHT}")


if __name__ == "__main__":
    main()
