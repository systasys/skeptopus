"""SkeptOpus / the pictures the editor extension needs, drawn from the product's own mark.

    python scripts/skeptopus-make-icons.py [full-size octopus.png]

The mark is the O of the name: an eye with a heavy lid and the pupil looking sideways (see .brand i in core/cli.mjs).
It is written three ways from the same few numbers:
  extension/media/skeptopus-icons.woff   one glyph, for the status bar (an editor only takes a font there)
  extension/media/eye.svg                one colour, for the activity bar
  extension/media/icon.png               the octopus himself, for the list of extensions (needs the full-size picture)
Nothing is borrowed: the glyph is arithmetic, the octopus is the product's own picture.
"""
import math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "extension", "media")
os.makedirs(OUT, exist_ok=True)

# The mark, in units of the outer radius. Same proportions as the name's O on the page.
INNER = 0.708  # the white of the eye, inside the ring
LID = 0.33 * INNER  # how far above the centre the lid stops, at the centre
SLOPE = math.tan(math.radians(9))  # the lid rises to the right: he looks at you sideways
PUPIL = (0.61 * INNER, -0.18 * INNER, 0.39 * INNER)  # x, y (up is positive), radius


def circle(cx, cy, r, n=96, clockwise=True):
    step = (-1 if clockwise else 1) * 2 * math.pi / n
    return [(cx + r * math.cos(i * step), cy + r * math.sin(i * step)) for i in range(n)]


def lid(cx, cy, r, up=1, n=64):
    """The part of the disc above the lid's edge, as points going clockwise (when up is +1)."""
    a, s = LID * r / INNER, SLOPE
    rho = r * 1.004  # a hair into the ring, so no seam shows between the two
    k = 1 + s * s
    d = math.sqrt(a * a * s * s - k * (a * a - rho * rho))
    right, left = (-a * s + d) / k, (-a * s - d) / k
    t0 = math.atan2(a + s * left, left)  # the left end of the edge
    t1 = math.atan2(a + s * right, right)  # the right end
    pts = [(cx + rho * math.cos(t0 + (t1 - t0) * i / n), cy + up * rho * math.sin(t0 + (t1 - t0) * i / n)) for i in range(n + 1)]
    return pts


def font(path):
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    upm, cx, cy, R = 1000, 500, 350, 430
    r = R * INNER
    pen = TTGlyphPen(None)

    def contour(points):
        pen.moveTo((round(points[0][0]), round(points[0][1])))
        for x, y in points[1:]:
            pen.lineTo((round(x), round(y)))
        pen.closePath()

    contour(circle(cx, cy, R, clockwise=True))  # the ring: outside
    contour(circle(cx, cy, r, clockwise=False))  # the ring: inside, the other way round, so it is a hole
    contour(lid(cx, cy, r))  # the lid, filled
    contour(circle(cx + PUPIL[0] * R, cy + PUPIL[1] * R, PUPIL[2] * R, clockwise=True))  # the pupil
    empty = TTGlyphPen(None).glyph()
    fb = FontBuilder(upm, isTTF=True)
    fb.setupGlyphOrder([".notdef", "eye"])
    fb.setupCharacterMap({0xE001: "eye"})
    fb.setupGlyf({".notdef": empty, "eye": pen.glyph()})
    fb.setupHorizontalMetrics({".notdef": (upm, 0), "eye": (upm, cx - R)})
    fb.setupHorizontalHeader(ascent=850, descent=-150)
    fb.setupNameTable({"familyName": "SkeptOpus Icons", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=850, sTypoDescender=-150, usWinAscent=850, usWinDescent=150)
    fb.setupPost()
    # The same numbers must give the same file on any day: no clock in it.
    fb.font["head"].created = fb.font["head"].modified = 3877372800  # 2026-11-12, in the font format's own epoch
    fb.font.recalcTimestamp = False
    fb.font.flavor = "woff"
    fb.font.save(path)
    return os.path.getsize(path)


def svg(path):
    cx = cy = 12.0
    R = 10.0
    r = R * INNER
    d = lambda pts: "M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in pts) + " Z"
    # On a screen "up" is towards smaller numbers: the same shapes, flipped.
    ring = d(circle(cx, cy, R)) + " " + d(circle(cx, cy, r, clockwise=False))
    cover = d(lid(cx, cy, r, up=-1))
    pupil = d(circle(cx + PUPIL[0] * R, cy - PUPIL[1] * R, PUPIL[2] * R, n=48))
    body = f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="{ring}"/><path d="{cover}"/><path d="{pupil}"/></svg>\n'
    open(path, "w", encoding="utf-8", newline="\n").write(body)
    return len(body)


def icon(path, source, size=256):
    from PIL import Image, ImageDraw

    top, bottom = (233, 240, 234), (185, 214, 210)  # the page's own sea
    big = size * 4
    sea = Image.new("RGBA", (big, big))
    draw = ImageDraw.Draw(sea)
    for y in range(big):
        t = y / (big - 1)
        draw.line([(0, y), (big, y)], fill=tuple(round(top[c] + (bottom[c] - top[c]) * t) for c in range(3)) + (255,))
    octo = Image.open(source).convert("RGBA")
    # His head and what he holds up: the stamp, the monocle, the coffee, the knot of the tie.
    bust = octo.crop((60, 0, 1040, 980))
    bust = bust.resize((round(big * 0.94), round(big * 0.94)), Image.LANCZOS)
    sea.alpha_composite(bust, ((big - bust.width) // 2, big - bust.height))
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * 0.22), fill=255)
    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    out.paste(sea, (0, 0), mask)
    out.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    return os.path.getsize(path)


if __name__ == "__main__":
    print("skeptopus-icons.woff", font(os.path.join(OUT, "skeptopus-icons.woff")), "bytes")
    print("eye.svg", svg(os.path.join(OUT, "eye.svg")), "bytes")
    if len(sys.argv) > 1:
        print("icon.png", icon(os.path.join(OUT, "icon.png"), sys.argv[1]), "bytes")
    else:
        print("icon.png: left as it is (give the full-size octopus picture to redraw it)")
