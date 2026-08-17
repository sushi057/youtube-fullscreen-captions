#!/usr/bin/env python3
"""Draw the Caption Mode extension icons.

The mark is the reading glyph — four ragged lines of text, the same shape
`extension/glyph.js` draws in the page — sitting inside fullscreen corner
brackets. Text, framed by the screen it takes over.

Black and white only, so it stays legible at 16px in a browser toolbar and
does not fight whatever theme the browser is wearing.

    python3 scripts/make-icons.py

Writes extension/icons/icon48.png and icon128.png. Requires Pillow.
"""

from pathlib import Path

from PIL import Image, ImageDraw

# Drawn large and scaled down, because Pillow does not antialias its shapes.
SCALE = 8
SIZE = 128

BLACK = (0, 0, 0, 255)
WHITE = (255, 255, 255, 255)

# Geometry in 128-unit space.
CORNER_RADIUS = 26  # of the black tile
BRACKET_INSET = 16  # from the tile edge to the outside of a bracket
BRACKET_ARM = 28  # how far each arm runs
BRACKET_WEIGHT = 8

LINE_HEIGHT = 7
LINE_GAP = 8
LINE_X = 36
# Uneven on purpose: even lines read as a list, ragged ones read as prose.
LINE_WIDTHS = (56, 40, 56, 26)

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"


def bar(draw, x0, y0, x1, y1):
    """A white rounded bar, radius half its short side."""
    radius = min(x1 - x0, y1 - y0) / 2
    draw.rounded_rectangle(
        [x * SCALE for x in (x0, y0, x1, y1)], radius=radius * SCALE, fill=WHITE
    )


def draw_icon():
    canvas = SIZE * SCALE
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle(
        [0, 0, canvas - 1, canvas - 1], radius=CORNER_RADIUS * SCALE, fill=BLACK
    )

    # Four corner brackets, each an L of two bars.
    near = BRACKET_INSET
    far = SIZE - BRACKET_INSET
    for x, xdir in ((near, 1), (far, -1)):
        for y, ydir in ((near, 1), (far, -1)):
            # Horizontal arm, then vertical arm, growing inward from the corner.
            hx = sorted((x, x + xdir * BRACKET_ARM))
            hy = sorted((y, y + ydir * BRACKET_WEIGHT))
            bar(draw, hx[0], hy[0], hx[1], hy[1])

            vx = sorted((x, x + xdir * BRACKET_WEIGHT))
            vy = sorted((y, y + ydir * BRACKET_ARM))
            bar(draw, vx[0], vy[0], vx[1], vy[1])

    # The lines of text, centred in the frame.
    block = len(LINE_WIDTHS) * LINE_HEIGHT + (len(LINE_WIDTHS) - 1) * LINE_GAP
    y = (SIZE - block) / 2
    for width in LINE_WIDTHS:
        bar(draw, LINE_X, y, LINE_X + width, y + LINE_HEIGHT)
        y += LINE_HEIGHT + LINE_GAP

    return image


def main():
    icon = draw_icon()
    for size in (48, 128):
        icon.resize((size, size), Image.LANCZOS).save(OUT / f"icon{size}.png")
        print(f"wrote {OUT / f'icon{size}.png'}")


if __name__ == "__main__":
    main()
