import {
  CanvasTexture, ClampToEdgeWrapping, Group, LinearFilter, LinearMipmapLinearFilter,
  Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3,
} from 'three';
import { loadEngravingFont } from './engraving.js';
import { INK_CORE, INK_HALO } from './voxel/masonry.js';

// The panels that stand in front of a monolith once its surface opens.
//
// They are quads in the world, not interface: they are anchored to the face in
// metres of stone, they take the fog and the bloom of the frame like everything
// else, and the walker can turn away from them. What is written on them is
// drawn once into a canvas and handed to the GPU as a texture, exactly as the
// engraving is: laying out type every frame for a scene that has to stay inside
// an integrated GPU's budget is not affordable, and it does not need to be —
// the text only changes when the walker walks to another block.
//
// The list panel is taller than its own frame when a section has many entries.
// Rather than redrawing the canvas on every keypress, the whole list is drawn
// once and the frame samples a window of it: scrolling and the cyan mark on the
// selected entry are two uniforms, so navigating a timeline costs nothing.

const DEG = Math.PI / 180;

// A hand's breadth clear of the face.
const STANDOFF = 0.42;

// And how high on it the stack hangs. It follows the walker's eye rather than
// sitting at a fixed height on the stone: the third block stands on a platform
// with its foot over the head of anybody on the stair below, and a stack pinned
// to the stone would be read from underneath there and at chest height
// everywhere else. The floor keeps it clear of the platform it may be standing
// on, the ceiling keeps it inside the face.
const LIFT = 0.20;
const LIFT_FLOOR = 0.80;
const LIFT_HEAD = 1.10;

// The stack is laid out at this width in metres and then scaled to the face it
// belongs to, so a narrow block gets the same composition rather than a
// different one. The floor keeps the smallest face from shrinking the type past
// reading distance; there is no ceiling above one, because a stack taller than
// the height a standing walker can take in at four metres is a stack with its
// head cut off.
const STACK_WIDTH = 3.6;
const STACK_SCALE = [0.86, 1.0];

const OPEN_SECONDS = 0.38;
const SCROLL_TAU = 0.11;

// Texels per metre of panel. At four metres, with the vertical field of view of
// this scene, one metre of panel covers about three hundred and forty pixels on
// a 1080p screen, so this is a little over one texel per pixel with the walker
// standing right in front of it.
const TEXELS_PER_METRE = 460;
const MAX_TEXELS = 2048;

// Colour of the hologram, in light units. The border and the text sit above one
// so the bloom of the composite catches them the way it catches the engraving;
// the fill is nearly black and carries its weight in the alpha instead. That
// alpha is high: the writing the panels stand in front of is lit at more than
// twice its resting brightness while they are open, and a plate that let a
// quarter of it through would be read against its own stone.
//
// AND THE FOUR OF THEM COME OFF THE ONE SEAT NOW, WHICH IS THIS FILE'S WHOLE
// SHARE OF THE DELIVERY. There are exactly two colours of light in this hub —
// the cyan cut into the stone and the halo around it — and
// src/world/voxel/masonry.js is where they were measured, on both targets, by
// quantile of luminance inside the stone the picture actually draws. This file
// used to declare FOUR MORE triplets of its own, which is the same defect
// src/world/monoliths.js was cured of when the rhombus and the hoop stopped
// carrying their own copy: a panel is the same light as the writing it stands
// in front of, so a fourth answer about that colour is four answers about one
// colour. What is left here is what genuinely belongs to a panel — how BRIGHT
// each of its four registers is — and that is a number a panel may own.
//
// THE LEVELS ARE UNCHANGED, WHICH IS HOW THIS IS CHECKABLE. Each multiplier is
// the ratio of the old triplet's luminance to the seat's, at 0.2126 / 0.7152 /
// 0.0722, so every one of the four is delivered at EXACTLY the luminance it was
// delivered at before: 0.8704 for the type, 0.7823 for the accent, 0.8495 for
// the border, 0.0235 for the fill. Nothing on a panel is brighter or dimmer and
// no composition moved. What moved is the HUE, and it moved a long way, which
// is the point: the type was at blue-over-red 1.42 against the engraving's 4.55
// — a whitish cyan, which is the exact defect the writing on the stone was
// re-anchored out of two deliveries ago and which this file kept.
const INK = INK_CORE.map((v) => v * 0.6297);
const ACCENT = INK_HALO.map((v) => v * 0.9273);
const EDGE = INK_CORE.map((v) => v * 0.6146);
const FILL = INK_CORE.map((v) => v * 0.0170);
const FILL_ALPHA = 0.93;

const FONT = 'Farfield Sans';

const PANEL_VERTEX = /* glsl */`
  uniform float uOpen;
  uniform float uStandoff;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // The stack grows out of the stone rather than appearing in front of it: at
    // zero every panel is a sliver lying on the face, at one it stands at full
    // size a hand's breadth clear of it. The quad already carries its size and
    // its place in the stack, so scaling it about the group's origin is what
    // makes the three of them converge on the same point of the face.
    vec3 plane = vec3(position.xy * mix(0.62, 1.0, uOpen), uStandoff * uOpen);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(plane, 1.0);
  }
`;

const PANEL_FRAGMENT = /* glsl */`
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D tText;
  uniform vec2 uSize;      // panel, in metres
  uniform vec2 uContent;   // the drawn sheet, in metres; taller than the panel
  uniform float uScroll;   // metres of sheet above the top edge of the panel
  uniform vec2 uSelect;    // top and bottom of the marked entry, in sheet metres
  uniform float uOpen;
  uniform vec3 uInk;
  uniform vec3 uAccent;
  uniform vec3 uEdge;
  uniform vec3 uFill;
  uniform float uFillAlpha;

  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    vec2 gap = uSize * 0.5 - abs(p);
    // One thin line all round. Its width is fixed in metres, so it stays a hair
    // line at every panel size instead of scaling into a frame.
    float border = 1.0 - smoothstep(0.004, 0.011, min(gap.x, gap.y));

    // How far down the drawn sheet this pixel falls.
    float sheet = uScroll + (1.0 - vUv.y) * uSize.y;
    float within = step(0.0, sheet) * step(sheet, uContent.y);
    vec4 text = texture2D(tText, vec2(vUv.x, sheet / uContent.y)) * within;

    float marked = step(uSelect.x, sheet) * step(sheet, uSelect.y) * within;
    // And the bar down the left edge of the marked entry, which is what the eye
    // actually follows while the list scrolls.
    float bar = marked * (1.0 - smoothstep(0.020, 0.026, vUv.x * uSize.x));

    // A scan across the fill, at the very edge of being noticed: enough to say
    // the surface is projected and not painted.
    float scan = 0.5 + 0.5 * sin(p.y * 314.159);

    vec3 colour = uFill;
    float alpha = uFillAlpha * (0.94 + 0.06 * scan);
    colour = mix(colour, uAccent, marked * 0.14);
    alpha = mix(alpha, 1.0, marked * 0.06);

    // Two flags packed into the sheet: green tells ink from accent, blue tells
    // a full tone from a quiet one. The alpha is the coverage of the glyph.
    vec3 ink = mix(uAccent, uInk, text.g) * mix(0.55, 1.0, text.b);
    ink *= 1.0 + 0.70 * marked;
    colour = mix(colour, ink, text.a);
    alpha = mix(alpha, 1.0, text.a);

    colour = mix(colour, uAccent * 1.15, bar);
    alpha = max(alpha, bar);
    colour = mix(colour, uEdge, border);
    alpha = max(alpha, border * 0.92);

    gl_FragColor = vec4(colour, alpha * uOpen);
  }
`;

/**
 * A quad of the right size, already in its place in the stack.
 *
 * The size and the offset are baked into the geometry rather than applied in
 * the shader so that the bounding sphere the renderer culls against describes
 * where the panel actually is: a walker who turns their back on an open stack
 * should not be paying for it, and half a screen of blended fill is the most
 * expensive thing this scene ever draws.
 */
function panelGeometry(size, offset, standoff) {
  const geometry = new PlaneGeometry(size[0], size[1]);
  geometry.translate(offset[0], offset[1], 0);
  geometry.computeBoundingSphere();
  // The quad travels out along its normal as it opens, which the sphere of a
  // flat plane does not know about.
  geometry.boundingSphere.radius += standoff;
  return geometry;
}

// ---------------------------------------------------------------- the sheets

// The four tones the shader can read back, written as canvas colours: green
// separates ink from accent, blue separates a full tone from a quiet one.
const TONE = {
  ink: '255,255,255',
  inkSoft: '255,255,0',
  accent: '255,0,255',
  accentSoft: '255,0,0',
};

function makeSheet(widthMetres, heightMetres) {
  const density = Math.min(
    TEXELS_PER_METRE,
    MAX_TEXELS / Math.max(widthMetres, heightMetres),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.round(widthMetres * density));
  canvas.height = Math.max(4, Math.round(heightMetres * density));
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  return { canvas, ctx, density };
}

/**
 * Sets the face for one line and returns the tracking that goes with it.
 *
 * Sized on the cap height rather than the em, like the engraving, so a heading
 * and a caption can be placed against the same baseline grid.
 */
function useFont(ctx, capMetres, density, weight, track) {
  ctx.font = `${weight} ${(capMetres * density / 0.727).toFixed(2)}px ${FONT}, sans-serif`;
  return track ? capMetres * density * track : 0;
}

function drawRun(ctx, text, x, y, track) {
  if (!track) {
    ctx.fillText(text, x, y);
    return x + ctx.measureText(text).width;
  }
  let cursor = x;
  for (const glyph of text) {
    ctx.fillText(glyph, cursor, y);
    cursor += ctx.measureText(glyph).width + track;
  }
  return cursor - track;
}

/** Breaks a string to a measured width, in canvas pixels. */
function wrap(ctx, text, limit) {
  const out = [];
  for (const source of String(text).split('\n')) {
    let line = '';
    for (const word of source.split(/\s+/)) {
      if (!word) continue;
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > limit) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function sheetTexture(canvas) {
  const texture = new CanvasTexture(canvas);
  // The sheet is addressed in metres from its top edge, because that is how a
  // list is read and how it scrolls. Leaving the usual flip on would put the
  // first row of the canvas at the bottom of the panel.
  texture.flipY = false;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

// ------------------------------------------------------------- compositions

const PAD = 0.082;

// The three panels, in metres, laid out around the point where the stack meets
// the stone. The whole composition is a metre and seventy on purpose: at three
// metres, in the field of view of this scene, that is what a standing walker
// takes in without moving their head, and the walker cannot always stand
// further back — the third block has a platform in the way.
//
// The panel that carries the name of the section and what it is about.
const SUMMARY = { size: [1.50, 1.24], offset: [-1.02, 0.23] };
// The list of entries, which is the panel the walker actually works in.
const TIMELINE = { size: [1.96, 1.70], offset: [0.72, 0] };
// And the line of keys under the first one.
const HINT = { size: [1.50, 0.22], offset: [-1.02, -0.58] };

/**
 * The summary sheet: number, title, rule, and whatever the section says about
 * itself. Nothing here is composed — every string comes out of the section file
 * and the panel simply stops when it runs out of room.
 */
function drawSummary(section) {
  const [width, height] = SUMMARY.size;
  const { canvas, ctx, density } = makeSheet(width, height);
  const left = PAD * density;
  const limit = (width - PAD * 2) * density;
  let y = 0.155 * density;

  ctx.fillStyle = `rgba(${TONE.accent},1)`;
  let track = useFont(ctx, 0.058, density, 400, 0.05);
  drawRun(ctx, section.id, left, y, track);

  y += 0.128 * density;
  ctx.fillStyle = `rgba(${TONE.ink},1)`;
  track = useFont(ctx, 0.086, density, 300, 0.045);
  drawRun(ctx, String(section.titolo || '').toUpperCase(), left, y, track);

  y += 0.062 * density;
  ctx.fillStyle = `rgba(${TONE.accentSoft},1)`;
  ctx.fillRect(left, y, limit * 0.82, Math.max(1, 0.004 * density));

  const body = summaryText(section);
  if (body) {
    y += 0.098 * density;
    ctx.fillStyle = `rgba(${TONE.inkSoft},1)`;
    useFont(ctx, 0.040, density, 320, 0);
    const pitch = 0.066 * density;
    const floor = (height - PAD) * density;
    const lines = wrap(ctx, body, limit);
    for (let i = 0; i < lines.length; i++) {
      if (y > floor) {
        ctx.fillText('…', left, y - pitch + 0.02 * density);
        break;
      }
      ctx.fillText(lines[i], left, y);
      y += pitch;
    }
  }

  return { canvas, contentHeight: height };
}

/**
 * What the section says about itself, in the order the files actually carry it.
 *
 * There is no fallback that writes anything: a section with none of these
 * fields gets a panel with its name on it and nothing under the rule.
 */
function summaryText(section) {
  if (section.profilo?.sintesi) return section.profilo.sintesi;
  if (section.chiSono?.paragrafi?.[0]?.testo) return section.chiSono.paragrafi[0].testo;
  const words = section.incisione?.parolechiave;
  if (Array.isArray(words) && words.length) return words.join(' · ');
  return null;
}

const PENDING_BADGE = 'in aggiornamento';

/**
 * The list sheet, and the metre band each entry occupies on it.
 *
 * The bands are what the frame uses to mark the selected entry and to decide
 * how far the sheet has to scroll, so they are measured here, where the type is
 * actually set, rather than assumed from a fixed row height: an entry with a
 * title on two lines is taller than one with a title on one.
 */
function drawTimeline(entries, pending) {
  const [width] = TIMELINE.size;
  // Measured on a throwaway context first: the sheet cannot be allocated until
  // its height is known, and its height depends on how the titles break.
  const probe = makeSheet(width, 1);
  const rows = measureRows(probe.ctx, entries, width, probe.density, pending);
  const height = Math.max(TIMELINE.size[1], rows.total);

  const { canvas, ctx, density } = makeSheet(width, height);
  const left = PAD * density;
  const limit = (width - PAD * 2) * density;

  for (const row of rows.list) {
    let y = row.top * density;
    y += 0.060 * density;

    ctx.fillStyle = `rgba(${TONE.ink},1)`;
    let track = useFont(ctx, 0.060, density, 340, 0.02);
    for (const line of row.title) {
      drawRun(ctx, line, left, y, track);
      y += 0.086 * density;
    }

    if (row.badge) {
      ctx.fillStyle = `rgba(${TONE.accent},1)`;
      useFont(ctx, 0.032, density, 340, 0);
      const text = PENDING_BADGE;
      const at = left + limit - ctx.measureText(text).width;
      ctx.fillText(text, at, row.top * density + 0.060 * density);
    }

    if (row.periodo) {
      ctx.fillStyle = `rgba(${TONE.accent},1)`;
      track = useFont(ctx, 0.040, density, 340, 0.03);
      drawRun(ctx, row.periodo, left, y, track);
      y += 0.064 * density;
    }

    ctx.fillStyle = `rgba(${TONE.inkSoft},1)`;
    useFont(ctx, 0.038, density, 320, 0);
    for (const line of row.subtitle) {
      ctx.fillText(line, left, y);
      y += 0.058 * density;
    }

    ctx.fillStyle = `rgba(${TONE.accentSoft},1)`;
    ctx.fillRect(
      left, (row.top + row.height) * density - Math.max(1, 0.003 * density),
      limit, Math.max(1, 0.003 * density),
    );
  }

  return { canvas, contentHeight: height, rows: rows.list };
}

function measureRows(ctx, entries, width, density, pending) {
  const limit = (width - PAD * 2) * density;
  const list = [];
  let top = 0.03;

  for (const entry of entries) {
    useFont(ctx, 0.060, density, 340, 0);
    const badge = pending(entry);
    // The badge sits on the title line, so the first line of the title has to
    // give up the room it takes.
    const title = wrap(ctx, entry.titolo || '', badge ? limit * 0.66 : limit);
    useFont(ctx, 0.038, density, 320, 0);
    const subtitle = entry.sottotitolo ? wrap(ctx, entry.sottotitolo, limit).slice(0, 2) : [];

    let height = 0.060 + title.length * 0.086;
    if (entry.periodo) height += 0.064;
    height += subtitle.length * 0.058;
    height += 0.046;

    list.push({ top, height, title, subtitle, periodo: entry.periodo || null, badge });
    top += height;
  }

  return { list, total: top + 0.03 };
}

const HINT_RUN = [
  ['W/S', 'accent'], [' scorri · ', 'inkSoft'],
  ['E', 'accent'], [' apri · ', 'inkSoft'],
  ['Esc', 'accent'], [' chiudi', 'inkSoft'],
];

function drawHint(run = HINT_RUN) {
  const [width, height] = HINT.size;
  const { canvas, ctx, density } = makeSheet(width, height);
  useFont(ctx, 0.038, density, 340, 0);
  let total = 0;
  for (const [text] of run) total += ctx.measureText(text).width;
  let x = (width * density - total) / 2;
  const y = height * density * 0.66;
  for (const [text, tone] of run) {
    ctx.fillStyle = `rgba(${TONE[tone]},1)`;
    ctx.fillText(text, x, y);
    x += ctx.measureText(text).width;
  }
  return { canvas, contentHeight: height };
}

// A plate rather than a full panel: there is nothing to read on it, and a sheet
// the size of a timeline with two lines on it reads as something broken.
const FAILURE = { size: [TIMELINE.size[0], 0.78], offset: [0, 0.12] };

/** The panel shown when the written material could not be fetched. */
function drawFailure(message) {
  const [width, height] = FAILURE.size;
  const { canvas, ctx, density } = makeSheet(width, height);
  const left = PAD * density;
  let y = 0.24 * density;
  ctx.fillStyle = `rgba(${TONE.ink},1)`;
  const track = useFont(ctx, 0.062, density, 340, 0.03);
  drawRun(ctx, 'Contenuto non raggiungibile', left, y, track);
  y += 0.130 * density;
  ctx.fillStyle = `rgba(${TONE.inkSoft},1)`;
  useFont(ctx, 0.040, density, 320, 0);
  for (const line of wrap(ctx, message, (width - PAD * 2) * density)) {
    ctx.fillText(line, left, y);
    y += 0.066 * density;
  }
  return { canvas, contentHeight: height };
}

// ------------------------------------------------------------------- panels

function makePanel({ size, offset, sheet, standoff }) {
  const material = new ShaderMaterial({
    uniforms: {
      tText: { value: sheetTexture(sheet.canvas) },
      uSize: { value: new Vector2(size[0], size[1]) },
      uContent: { value: new Vector2(size[0], sheet.contentHeight) },
      uScroll: { value: 0 },
      uSelect: { value: new Vector2(1, -1) },
      uOpen: { value: 0 },
      uInk: { value: new Vector3(...INK) },
      uAccent: { value: new Vector3(...ACCENT) },
      uEdge: { value: new Vector3(...EDGE) },
      uFill: { value: new Vector3(...FILL) },
      uFillAlpha: { value: FILL_ALPHA },
      uStandoff: { value: standoff },
    },
    vertexShader: PANEL_VERTEX,
    fragmentShader: PANEL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: false,
  });

  const mesh = new Mesh(panelGeometry(size, offset, standoff), material);
  mesh.renderOrder = 4;
  return { mesh, material };
}

/**
 * Puts the group on the face: on the plane of the stone, turned with it, and
 * scaled to how wide it is.
 */
function anchorGroup(group, monolith) {
  const angle = monolith.rotationY * DEG;
  const front = new Vector3(Math.sin(angle), 0, Math.cos(angle));
  group.position.set(
    monolith.position.x + front.x * monolith.size[2] / 2,
    monolith.baseY + LIFT_FLOOR,
    monolith.position.z + front.z * monolith.size[2] / 2,
  );
  // A rotation about the vertical by the block's own angle maps the local +Z
  // onto the face normal and the local +X onto the face's right, which is the
  // frame the panels are laid out in.
  group.rotation.y = angle;
  const scale = Math.min(
    STACK_SCALE[1], Math.max(STACK_SCALE[0], monolith.size[0] / STACK_WIDTH),
  );
  group.scale.setScalar(scale);
  return { front, scale };
}

/** Sets the height of an already anchored stack from where the reader's eye is. */
function settle(stack, eyeY) {
  const { monolith } = stack;
  const height = Math.max(
    monolith.baseY + LIFT_FLOOR,
    Math.min(eyeY + LIFT, monolith.baseY + monolith.size[1] - LIFT_HEAD),
  );
  stack.group.position.y = height;
  stack.anchor.y = height;
}

/**
 * Builds the stack for one section and hangs it in front of its block.
 *
 * @param {object} section  a parsed content/*.json
 * @param {object} monolith the entry from src/world/layout.js
 * @param {function} pending tells whether an entry is still waiting on its owner
 */
function buildStack(section, monolith, pending) {
  const entries = Array.isArray(section.timeline) ? section.timeline : [];
  const group = new Group();
  group.name = `panels-${monolith.id}`;

  const { front, scale } = anchorGroup(group, monolith);

  const timeline = drawTimeline(entries, pending);
  const panels = [
    makePanel({ ...SUMMARY, sheet: drawSummary(section), standoff: STANDOFF }),
    makePanel({ ...TIMELINE, sheet: timeline, standoff: STANDOFF }),
    makePanel({ ...HINT, sheet: drawHint(), standoff: STANDOFF }),
  ];
  for (const panel of panels) group.add(panel.mesh);

  return {
    group, panels, entries, monolith,
    rows: timeline.rows,
    list: panels[1],
    window: TIMELINE.size[1],
    content: timeline.contentHeight,
    anchor: new Vector3(
      group.position.x + front.x * STANDOFF * scale,
      group.position.y,
      group.position.z + front.z * STANDOFF * scale,
    ),
  };
}

function buildFailure(monolith, message) {
  const group = new Group();
  group.name = `panels-${monolith.id}-fallback`;
  const { front, scale } = anchorGroup(group, monolith);

  const panels = [
    makePanel({ ...FAILURE, sheet: drawFailure(message), standoff: STANDOFF }),
    makePanel({
      size: HINT.size, offset: [0, -0.44], standoff: STANDOFF,
      sheet: drawHint([['E', 'accent'], [' riprova · ', 'inkSoft'], ['Esc', 'accent'], [' chiudi', 'inkSoft']]),
    }),
  ];
  for (const panel of panels) group.add(panel.mesh);

  return {
    group, panels, entries: [], rows: [], list: null, monolith,
    window: TIMELINE.size[1], content: TIMELINE.size[1],
    anchor: new Vector3(
      group.position.x + front.x * STANDOFF * scale,
      group.position.y,
      group.position.z + front.z * STANDOFF * scale,
    ),
  };
}

/**
 * The one stack in the world.
 *
 * Only one monolith can be open at a time, so there is one group on the scene
 * and it is re-pointed at whichever block the walker addressed. What has been
 * built is kept: walking back to a block already visited costs no type setting.
 */
export function createPanels({ scene, pending = () => false }) {
  const built = new Map();
  let current = null;
  let open = 0;
  let target = 0;
  let selected = 0;
  let scroll = 0;
  let scrollTarget = 0;

  // The face is loaded once for the whole run and the promise is shared with the
  // engraving; asking for it again here only guards the case of a walker who
  // reaches a block before it has arrived.
  const font = loadEngravingFont();

  function place(stack) {
    if (current && current !== stack) scene.remove(current.group);
    current = stack;
    scene.add(stack.group);
  }

  function markSelection() {
    if (!current || !current.list) return;
    const row = current.rows[selected];
    const select = current.list.material.uniforms.uSelect.value;
    if (!row) {
      select.set(1, -1);
      return;
    }
    select.set(row.top, row.top + row.height);
    // Enough scroll that the whole of the marked entry is inside the frame, and
    // no more: the list should never move when it does not have to.
    const low = row.top + row.height - current.window;
    scrollTarget = Math.max(0, Math.min(
      Math.max(0, current.content - current.window),
      Math.max(low, Math.min(scrollTarget, row.top)),
    ));
  }

  return {
    get isOpen() { return target > 0; },
    get selected() { return selected; },
    get count() { return current ? current.entries.length : 0; },
    get entries() { return current ? current.entries : []; },
    get anchor() { return current ? current.anchor : null; },

    /** Opens the stack of one section, building it the first time it is asked for. */
    show(section, monolith, index = 0, eyeY = monolith.baseY + LIFT_FLOOR) {
      const key = `${monolith.id}:${section === null ? 'fallback' : 'ok'}`;
      let stack = built.get(key);
      if (!stack) {
        stack = section
          ? buildStack(section, monolith, pending)
          : buildFailure(monolith, 'Il testo di questa sezione non è stato caricato. Riprova fra un momento.');
        built.set(key, stack);
        // A walker who arrives before the face has loaded would get the fallback
        // metrics baked into the sheets, so they are drawn again once it lands.
        // Only when it actually lands: otherwise the rebuilt stack would ask the
        // same question again and the two would trade rebuilds forever.
        if (typeof document !== 'undefined' && document.fonts
          && !document.fonts.check(`16px "${FONT}"`)) {
          font.then((arrived) => {
            if (!arrived) return;
            built.delete(key);
            if (current === stack && target > 0) this.show(section, monolith, selected, eyeY);
          });
        }
      }
      settle(stack, eyeY);
      place(stack);
      selected = Math.max(0, Math.min(index, Math.max(0, stack.entries.length - 1)));
      scroll = 0;
      scrollTarget = 0;
      markSelection();
      target = 1;
      return this;
    },

    hide() {
      target = 0;
      return this;
    },

    /** Moves the mark by one entry and returns whether anything moved. */
    step(delta) {
      if (!current || !current.entries.length) return false;
      const next = Math.max(0, Math.min(current.entries.length - 1, selected + delta));
      if (next === selected) return false;
      selected = next;
      markSelection();
      return true;
    },

    select(index) {
      if (!current || !current.entries.length) return;
      selected = Math.max(0, Math.min(current.entries.length - 1, index));
      markSelection();
    },

    update(dt) {
      if (!current) return;
      if (open !== target) {
        const step = dt / OPEN_SECONDS;
        open = target > open ? Math.min(target, open + step) : Math.max(target, open - step);
        // Eased on the way out of the stone rather than linear, so the last
        // third of the movement settles instead of stopping.
        const eased = 1 - (1 - open) * (1 - open);
        for (const panel of current.panels) panel.material.uniforms.uOpen.value = eased;
        if (open === 0) {
          scene.remove(current.group);
          current = null;
          return;
        }
      }
      if (current.list && Math.abs(scroll - scrollTarget) > 1e-4) {
        scroll += (scrollTarget - scroll) * (1 - Math.exp(-dt / SCROLL_TAU));
        current.list.material.uniforms.uScroll.value = scroll;
      }
    },

    /** How much of the opening has played, for whoever drives the camera. */
    get openness() { return open; },
  };
}
