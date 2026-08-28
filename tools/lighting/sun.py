"""Where the sun is, for the bake scripts that run inside Blender.

The seat is assets-src/sky/sky.json, field `day.sun` — the same preset the
renderer hands to the dome in src/core/sky.js. tools/lighting/sun.mjs is the
door to it for everything written in JavaScript; this is the door for Python.
Neither holds a number of its own.

Read tools/lighting/sun.mjs for why the seat exists: the world used to be baked
under a second sun fifty-two degrees away from the one the sky draws.

Blender runs these scripts with --factory-startup, so the caller adds this
directory to sys.path before importing.
"""

import json
import math
import os

SUN_SEAT = os.path.join('assets-src', 'sky', 'sky.json')
SUN_SEAT_FIELD = 'day.sun'


def sun_angles(root):
    """Elevation and bearing of the sun, in degrees, out of the one seat.

    Bearing is `azimuth` in the seat: the two names are the same convention,
    measured from north turning east.
    """
    path = os.path.join(root, SUN_SEAT)
    with open(path, 'r', encoding='utf-8') as handle:
        sky = json.load(handle)
    day = sky.get('day') or {}
    sun = day.get('sun')
    if not sun:
        raise SystemExit('{0} carries no {1}'.format(SUN_SEAT, SUN_SEAT_FIELD))
    return float(sun['elevation']), float(sun['azimuth'])


def sun_disc_angle(root):
    """Angular DIAMETER of the sun, in radians, out of the same seat.

    `day.disc.radiusDeg` is what the dome draws the disc with and what
    tools/grade/check-dome.mjs measures on the running page, so it is the one
    statement of the sun's size in this repository that is checked rather than
    chosen. The bakes used to declare 0.7 radians of their own — forty degrees,
    a sun the width of a hand held at arm's length twenty times over — and it
    was that, not the wrong direction, that kept the two suns hidden: a shadow
    with no edge has no direction to read.

    The reference shows no cast shadow of the blocks on its meadow at all
    (measured: row matched, the ground inside the seat sun's hard shadow is
    1.347 times as bright as the ground outside it, not darker), so no width
    can be fitted from it. What carries that absence is the sun's WEIGHT, which
    is a runtime uniform, and the dome's own measured aureole, which lives in
    the environment map and softens every boundary without anybody widening a
    sun to make it so.
    """
    path = os.path.join(root, SUN_SEAT)
    with open(path, 'r', encoding='utf-8') as handle:
        sky = json.load(handle)
    disc = (sky.get('day') or {}).get('disc')
    if not disc:
        raise SystemExit('{0} carries no day.disc'.format(SUN_SEAT))
    return math.radians(2.0 * float(disc['radiusDeg']))


def sun_direction(elevation, bearing):
    """Direction to the sun in runtime axes: Y up, north is -Z, bearing from
    north turning east. The same arithmetic as sunVector in
    tools/lighting/sun.mjs, and checked against it by
    tools/lighting/check-suns.mjs."""
    e = math.radians(elevation)
    b = math.radians(bearing)
    return (
        math.cos(e) * math.sin(b),
        math.sin(e),
        -math.cos(e) * math.cos(b),
    )
