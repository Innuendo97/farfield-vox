"""Bakes the light on the Farfield ground, inside headless Blender.

Normal use (npm run terrain resolves the Blender path by itself):

    npm run terrain -- --size 1024 --samples 64

Direct invocation:

    blender --background --factory-startup --python tools/terrain/build-terrain.py -- --help

The ground itself is not modelled here. Its vertices are computed by
tools/terrain/build-mesh.mjs from the field in src/world/terrain-field.js and
handed over as plain floats, so that the surface the player walks on and the
surface the light is baked onto cannot drift apart. This script builds that mesh
back, stands the monoliths on it so they drop light off the grass, lights the
scene with the same sky the renderer draws, bakes the irradiance and exports the
geometry.
"""

import argparse
import json
import math
import os
import struct
import sys
import time

import bpy
import mathutils


def parse_args(argv):
    argv = argv[argv.index('--') + 1:] if '--' in argv else []
    parser = argparse.ArgumentParser(
        prog='build-terrain.py',
        description='Ground light bake for Farfield.',
    )
    parser.add_argument('--size', type=int, default=2048,
                        help='square lightmap side, in pixels (default: 2048)')
    parser.add_argument('--samples', type=int, default=384,
                        help='Cycles samples per pixel (default: 384)')
    parser.add_argument('--margin', type=int, default=8,
                        help='bleed margin around the island, in pixels (default: 8)')
    parser.add_argument('--device', default='cpu', choices=['cpu', 'gpu'],
                        help='Cycles compute device (default: cpu)')
    parser.add_argument('--stairs-only', action='store_true',
                        help='skip the ground bake and relight the stair alone')
    # A proof bake is a draft, and a draft must not take the delivery's place.
    parser.add_argument('--out', default=None,
                        help='where to write, instead of assets-src/terrain')
    return parser.parse_args(argv)


def repo_root():
    return os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def log(message):
    print('[terrain] {0}'.format(message), flush=True)


# Blender starts with --factory-startup, so the repository's own modules are not
# on the path until they are put there.
sys.path.insert(0, os.path.join(repo_root(), 'tools', 'lighting'))
import bake_world  # noqa: E402
from sun import sun_angles, sun_disc_angle  # noqa: E402

# THE SUN AND THE SKY ARE NOT DECLARED HERE. Where the sun is, how wide it is
# and what the sky does are one seat each, and tools/lighting/bake_world.py is
# the only thing that stands them in a scene. This file used to carry a sun of
# its own — elevation 52, bearing 61, forty degrees wide — against a sky drawing
# 34 and -9.5, and it is exactly the kind of second declaration that cost this
# project a campaign of shadows pointing the wrong way.

# Bounce colour of the meadow. It is only what the light picks up on its way
# back off the ground, but it is the reason shaded grass goes green rather than
# grey, so it is the painted grass colour and not a guess.
GROUND_BOUNCE = (0.105, 0.205, 0.062, 1.0)

# Bounce colour of the stair. Same reasoning as the meadow above: it is only
# what the light picks up on its way back off a tread, and it is the painted
# stone rather than a guess.
STONE_BOUNCE = (0.196, 0.201, 0.198, 1.0)

to_blender = bake_world.to_blender


def load_mesh(root):
    meta_path = os.path.join(root, 'assets-src', 'terrain', 'field.json')
    bin_path = os.path.join(root, 'assets-src', 'terrain', 'terrain-mesh.bin')
    for path in (meta_path, bin_path):
        if not os.path.isfile(path):
            raise SystemExit('missing {0}: run "node tools/terrain/build-mesh.mjs" first'.format(path))

    with open(meta_path, 'r', encoding='utf-8') as handle:
        meta = json.load(handle)

    n = meta['samples']
    count = n * n
    with open(bin_path, 'rb') as handle:
        raw = handle.read()
    expected = count * 3 * 4 + count * 2 * 4
    if len(raw) != expected:
        raise SystemExit('mesh binary is {0} bytes, expected {1}'.format(len(raw), expected))

    positions = struct.unpack_from('<{0}f'.format(count * 3), raw, 0)
    uvs = struct.unpack_from('<{0}f'.format(count * 2), raw, count * 3 * 4)
    return meta, n, positions, uvs


def load_stairs(root, meta):
    """The stair run, as vertices, texture coordinates and indices.

    Built in src/world/stairs.js and handed over whole, for the same reason the
    ground is: the runtime draws these exact triangles, and a second description
    of them here would be a second staircase.
    """
    spec = meta.get('stairs')
    if not spec:
        return None
    path = os.path.join(root, 'assets-src', 'terrain', 'stairs-mesh.bin')
    if not os.path.isfile(path):
        raise SystemExit('missing {0}: run "node tools/terrain/build-mesh.mjs" first'.format(path))

    count = spec['vertices']
    total = spec['indices']
    with open(path, 'rb') as handle:
        raw = handle.read()
    expected = count * 3 * 4 + count * 2 * 4 + total * 4
    if len(raw) != expected:
        raise SystemExit('stair binary is {0} bytes, expected {1}'.format(len(raw), expected))

    positions = struct.unpack_from('<{0}f'.format(count * 3), raw, 0)
    uvs = struct.unpack_from('<{0}f'.format(count * 2), raw, count * 3 * 4)
    indices = struct.unpack_from('<{0}I'.format(total), raw, count * 3 * 4 + count * 2 * 4)
    return spec, positions, uvs, indices


def build_stairs(spec, positions, uvs, indices):
    verts = []
    for i in range(spec['vertices']):
        verts.append(to_blender(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]))

    faces = []
    for k in range(0, len(indices), 3):
        # Not reversed. The conversion in to_blender is a rotation, determinant
        # plus one, so it carries the winding across unchanged: the triangles
        # that face outward in the runtime face outward here. Turning them round
        # pointed every normal into the solid, and a diffuse bake onto faces
        # that look inward comes back black, which is exactly what the stair
        # came back as.
        faces.append((indices[k], indices[k + 1], indices[k + 2]))

    mesh = bpy.data.meshes.new('stairs')
    mesh.from_pydata(verts, [], faces)
    mesh.validate()

    uv_layer = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        u, v = uvs[loop.vertex_index * 2], uvs[loop.vertex_index * 2 + 1]
        # The atlas is authored top down and Blender reads it bottom up.
        uv_layer.data[loop.index].uv = (u, 1.0 - v)

    obj = bpy.data.objects.new('stairs', mesh)
    bpy.context.scene.collection.objects.link(obj)

    material = bpy.data.materials.new('stair-stone')
    material.use_nodes = True
    bsdf = material.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = STONE_BOUNCE
    bsdf.inputs['Roughness'].default_value = 0.86
    obj.data.materials.append(material)
    return obj, material


def build_ground(n, positions, uvs):
    bpy.ops.wm.read_factory_settings(use_empty=True)

    verts = []
    for i in range(n * n):
        verts.append(to_blender(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]))

    faces = []
    for j in range(n - 1):
        for i in range(n - 1):
            a = j * n + i
            b = a + 1
            c = a + n + 1
            d = a + n
            # Wound so the face normal points up once the axes are converted.
            faces.append((a, d, c, b))

    mesh = bpy.data.meshes.new('terrain')
    mesh.from_pydata(verts, [], faces)
    mesh.validate()

    uv_layer = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        u, v = uvs[loop.vertex_index * 2], uvs[loop.vertex_index * 2 + 1]
        # The same turn the stair has taken since it was written, and the ground
        # never did: the atlas is authored top down (paint-albedo.mjs walks v
        # from the first row) and the runtime samples it with flipY off, while
        # Blender writes a PNG from the bottom up. Without this the light map is
        # mirrored north to south against the albedo it multiplies and against
        # the world it was baked from — measured on the delivery, with the
        # shadows ray cast from the seat and the map read both ways up: under
        # the predicted shadow 0.469 against 0.585 on open meadow read as it
        # was, 0.084 against 0.639 read turned round. tools/terrain/check-ground-light.mjs
        # is that measurement, and it now runs after every bake.
        uv_layer.data[loop.index].uv = (u, 1.0 - v)

    obj = bpy.data.objects.new('terrain', mesh)
    bpy.context.scene.collection.objects.link(obj)

    # Smooth, because the meadow is a smooth surface sampled coarsely: faceting
    # it would draw the grid onto the grass.
    for polygon in mesh.polygons:
        polygon.use_smooth = True

    material = bpy.data.materials.new('terrain-ground')
    material.use_nodes = True
    bsdf = material.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = GROUND_BOUNCE
    bsdf.inputs['Roughness'].default_value = 0.92
    obj.data.materials.append(material)
    return obj, material


def stand_occluders(occluders):
    """The blocks that drop light off the grass. They are never exported."""
    made = []
    for spec in occluders:
        width, height, depth = spec['size']
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        block = bpy.context.active_object
        block.name = spec['name']
        block.scale = (width, depth, height)
        block.location = to_blender(spec['x'], spec['y'] + height / 2.0, spec['z'])
        # Yaw about the runtime's vertical axis is yaw about Blender's Z, with
        # the sign flipped by the handedness of the conversion.
        block.rotation_euler = mathutils.Euler((0.0, 0.0, -math.radians(spec['rotationY'])), 'XYZ')

        stone = bpy.data.materials.new('occluder-{0}'.format(spec['name']))
        stone.use_nodes = True
        stone.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (
            0.052, 0.068, 0.088, 1.0)
        block.data.materials.append(stone)
        made.append(block)
    return made


def main():
    args = parse_args(sys.argv)
    root = repo_root()
    out_dir = os.path.abspath(args.out) if args.out else os.path.join(root, 'assets-src', 'terrain')
    os.makedirs(out_dir, exist_ok=True)
    started = time.time()

    meta, n, positions, uvs = load_mesh(root)
    log('ground {0}x{0}, {1} vertices, reach {2} m'.format(n, n * n, meta['half']))

    ground, material = build_ground(n, positions, uvs)
    occluders = stand_occluders(meta.get('occluders', []))
    log('{0} occluders standing'.format(len(occluders)))
    background = bake_world.build_world(root, 'terrain')
    sun = bake_world.build_sun(root, 'terrain')

    scene = bpy.context.scene
    bake_world.configure(scene, args.samples, args.margin, args.device)

    # What an open level patch gets in each term, so both maps come out as
    # fractions of it and the runtime turns them back into light with two
    # colours instead of a number baked into every texel.
    facts = bake_world.scene_light(root)['day']
    divisors = {'sun': [1.0, 1.0, 1.0], 'sky': facts['skyIrradiance']}

    ground_terms = None
    if args.stairs_only:
        log('ground bake skipped')
    else:
        log('baking {0}x{0} at {1} samples on {2}'.format(
            args.size, args.samples, scene.cycles.device))
        ground_terms = bake_world.bake_terms(
            'terrain', [(ground, material)], 'terrain-light', args.size,
            os.path.join(out_dir, 'terrain-light'), sun, background, divisors)

    # ------------------------------------------------------------- the stair
    #
    # Baked into the scene the ground was baked in. The cubes that stood in for
    # the run while the meadow was lit come out first: from here on the real
    # mesh is both what receives the light and what casts it, and leaving the
    # cubes in would have the stair shadowing itself twice. The monoliths stay,
    # because the tall one drops its shadow straight across the platform.
    stair_terms = None
    loaded = load_stairs(root, meta)
    if loaded is not None:
        spec, s_positions, s_uvs, s_indices = loaded
        for block in list(occluders):
            if block.name.startswith('step-') or block.name == 'platform':
                bpy.data.objects.remove(block, do_unlink=True)
                occluders.remove(block)

        stairs, stair_material = build_stairs(spec, s_positions, s_uvs, s_indices)
        atlas = int(spec['atlas'])
        log('baking the stair {0}x{0} at {1} samples'.format(atlas, args.samples))
        # The stair takes the same two terms and no weather at all. It used to
        # take none of either: tools/terrain/shade-light.mjs copied its map
        # across untouched while the meadow around it was multiplied down to a
        # tenth, which is why its riser stood twenty-one levels above the
        # reference in a field the weather had put into shade.
        stair_terms = bake_world.bake_terms(
            'terrain', [(stairs, stair_material)], 'stairs-light', atlas,
            os.path.join(out_dir, 'stairs-light'), sun, background, divisors)

    # Written last, so it can only ever describe a bake that finished. A stair
    # only run leaves it alone: it has nothing to say about the ground.
    if args.stairs_only:
        log('total {0:.1f} s'.format(time.time() - started))
        return

    elevation, bearing = sun_angles(root)
    with open(os.path.join(out_dir, 'terrain.json'), 'w', encoding='utf-8') as handle:
        json.dump({
            'lightScale': bake_world.TERM_SCALE,
            'lightSize': args.size,
            'samples': args.samples,
            'terms': {
                'ground': ground_terms and {k: v['peak'] for k, v in ground_terms.items()},
                'groundColourGivenUp': ground_terms and {
                    k: v['spread'] for k, v in ground_terms.items()},
                'stair': stair_terms and {k: v['peak'] for k, v in stair_terms.items()},
            },
            'stairAtlas': int(meta['stairs']['atlas']) if stair_terms else 0,
            'sun': {
                'elevation': elevation,
                'bearing': bearing,
                'energy': bake_world.SUN_ENERGY,
                'angle': round(sun_disc_angle(root), 6),
            },
        }, handle, indent=2)
        handle.write('\n')

    log('total {0:.1f} s'.format(time.time() - started))


if __name__ == '__main__':
    # Blender prints a traceback and still leaves with a status of zero, so a
    # bake that died halfway looks to the chain exactly like one that finished.
    # It is not a theoretical worry: this script raised on its first line of
    # work, the chain carried on, and tools/lighting/pack-light.mjs packed the
    # RAW TERMS OF THE PREVIOUS BAKE into a delivery with a fresh timestamp on
    # it. Nothing downstream can tell that apart from a bake. So the status is
    # set here, where the failure is known.
    try:
        main()
    except SystemExit as stop:
        code = stop.code
        if code not in (None, 0):
            log(str(code))
            sys.stdout.flush()
            os._exit(1)
    except BaseException:
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)
