// The popups: little retro-OS windows that outline you. Nothing travels.
//
// The rule is coverage, not timers:
//   - a popup stays open as long as some of you shows through it
//   - when you move out from under it, it pops out
//   - any bit of you that isn't covered (by two popups, by default, so
//     they crowd and overlap) gets a new popup
// So if you stand still the outline settles and holds; move an arm and
// only the popups along the old position close, while new ones open
// along the new one.
//
// Where new popups open is weighted by body part:
//   face  (face skin, hair, glasses)  most popups
//   body  (bare skin: hands, arms)    a good share
//   torso (clothes: torso, sleeves)   a few, and smaller
//
// Each popup shows you one of three ways (see looks.js): the camera cut
// out with the mask, halftone dots, or ASCII. Its title says which.
//
// Before the segmentation model has loaded there is no body to outline,
// so popups just come and go on timers around the mouse.
//
// Everything is drawn on the canvas (not HTML), so 80+ windows stay smooth.

import { CLASS } from './segment.js';

const BAR = 18; // title bar height
const BORDER = 3; // ink frame thickness
const SHADOW = 6; // hard drop shadow offset

const INK = '#0d0d0f';
const PAPER = '#f3f2ee';
const ORANGE = '#ff6601';
const CATEGORY = ['#a274ff', '#00a456', '#3cc8ff', '#ffd619']; // sound, movement, space, play

const IN_TIME = 0.1; // seconds to pop in
const OUT_TIME = 0.06; // seconds to pop out (closing is snappier than opening)

// Tunable by the controls later.
export const popupSettings = {
  max: 90, // most popups open at once
  cover: 0.9, // stop opening new popups once this much of you is covered...
  layers: 2, // ...by at least this many popups (2 = a crowded, overlapping look)
  closeBelow: 0.12, // close when less than this much of a popup is you...
  grace: 0.1, // ...for this many seconds (so a flicker in the mask doesn't)
  openAbove: 0.25, // a new popup must be at least this much you
  perFrame: 3, // most new popups per frame: fast, but not all at once
  shuffle: 0, // popups per second swapped out at random, even when still (off)
  size: 1, // overall size multiplier
  // Where popups open. Don't need to add up to 1; they're relative.
  weights: { face: 0.45, body: 0.35, torso: 0.2 },
  // How popups show you. Relative, like the weights.
  modes: { cam: 0.5, dots: 0.3, ascii: 0.2 },
  // Mouse fallback (no body yet): this many popups, each open this long.
  fallbackCount: 30,
  fallbackLife: [0.5, 1.4],
};

// Title for each mode: cam_07.exe, dots_12.exe, ascii_03.txt
const TITLE = { cam: ['cam', 'exe'], dots: ['dots', 'exe'], ascii: ['ascii', 'txt'] };

// Per body part: width range (px at an 800px-tall screen).
const PARTS = {
  face: { w: [110, 220] },
  body: { w: [80, 170] },
  torso: { w: [64, 130] },
};
// Which segmentation labels count as which part.
const PART_OF = {
  [CLASS.face]: 'face', [CLASS.hair]: 'face', [CLASS.other]: 'face',
  [CLASS.body]: 'body',
  [CLASS.clothes]: 'torso',
};

const rand = (a, b) => a + Math.random() * (b - a);

// Pick a key from { key: weight, ... } at random, by weight.
function pickWeighted(weights, keys = Object.keys(weights)) {
  let total = 0;
  for (const k of keys) total += weights[k];
  let r = Math.random() * total;
  for (const k of keys) if ((r -= weights[k]) <= 0) return k;
  return keys[keys.length - 1];
}

// Overshoot ease: grows a touch past full size, then settles. Gives the
// "pop" without a bouncy spring.
function easeOutBack(t) {
  const c = 2.6;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

export function createWindows(segmenter, looks) {
  let list = []; // open popups (including ones popping in or out)
  let screen = { w: 1, h: 1 };
  let order = 0; // increases with every popup, so newer ones draw on top

  // How many popups cover each map cell. Same grid as the segmentation
  // map (camera space), rebuilt every frame.
  let cover = new Uint16Array(0);

  // Uncovered cells of you, per body part (filled each frame).
  const gaps = { face: [], body: [], torso: [] };

  function build(w, h) {
    screen = { w, h };
    list = [];
  }

  // --- Screen <-> map ---
  // The map is in camera space; the screen shows the camera mirrored and
  // cover-fitted (cam.rect). These turn a screen rectangle into the range
  // of map cells under it, and a map cell into a screen point.

  function cellsUnder(p, cam) {
    const s = segmenter.state, { rect, width } = cam;
    const x = p.x - p.w / 2, y = p.y - p.h / 2;
    // Mirrored: the screen's right edge is the camera's left.
    const i0 = Math.max(0, Math.floor(((width - x - p.w - rect.x) / rect.w) * s.w));
    const i1 = Math.min(s.w - 1, Math.floor(((width - x - rect.x) / rect.w) * s.w));
    const j0 = Math.max(0, Math.floor(((y - rect.y) / rect.h) * s.h));
    const j1 = Math.min(s.h - 1, Math.floor(((y + p.h - rect.y) / rect.h) * s.h));
    return { i0, i1, j0, j1 };
  }

  function cellToScreen(cell, cam) {
    const s = segmenter.state, { rect, width } = cam;
    const u = ((cell % s.w) + Math.random()) / s.w;
    const v = (Math.floor(cell / s.w) + Math.random()) / s.h;
    return { x: width - (rect.x + u * rect.w), y: rect.y + v * rect.h };
  }

  // How much of a popup's area is you (0..1). With mark, also counts it
  // into the coverage grid.
  function measure(p, cam, mark) {
    const s = segmenter.state;
    const { i0, i1, j0, j1 } = cellsUnder(p, cam);
    let you = 0, all = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * s.w + i;
        all++;
        if (s.map[k] !== CLASS.background) you++;
        if (mark) cover[k]++;
      }
    }
    // Any part hanging off the edge of the camera counts as not you.
    const full = (p.w / cam.rect.w) * s.w * (p.h / cam.rect.h) * s.h;
    return you / Math.max(1, all, full);
  }

  // --- Making a popup ---

  function makePopup(x, y, part, free) {
    const spec = PARTS[part];
    const unit = Math.min(screen.w, screen.h) / 800;
    const big = Math.random() < 0.1; // the odd big one
    const base = rand(spec.w[0], spec.w[1]) * (big ? 1.6 : 1) * unit * popupSettings.size;
    // Snapped to 8px so edges stay crisp.
    const w = Math.max(56, Math.round(base / 8) * 8);
    const h = Math.max(40, Math.round((w * rand(0.55, 1)) / 8) * 8) + BAR;
    const mode = pickWeighted(popupSettings.modes);
    const [stem, ext] = TITLE[mode];
    return {
      x, y, w, h, part, mode,
      phase: 'in', t: 0,
      free, // mouse popups: on a timer, not tied to you
      life: free ? rand(...popupSettings.fallbackLife) : Infinity,
      away: 0, // how long it's been (nearly) empty of you
      order: order++,
      name: `${stem}_${String(Math.floor(rand(1, 100))).padStart(2, '0')}.${ext}`,
      // about 1 in 6 get a category colour title bar
      bar: Math.random() < 0.17 ? CATEGORY[Math.floor(Math.random() * 4)] : ORANGE,
    };
  }

  function close(p) {
    if (p.phase === 'out') return;
    p.phase = 'out';
    p.t = 0;
  }

  // --- Each frame ---

  // cam: { rect, width } (the camera's cover-fitted, mirrored placement).
  // fallback: a screen point (the mouse) for when there's no body yet.
  function update(dt, cam, fallback) {
    const S = popupSettings;
    const s = segmenter.state;

    // Animate, and drop popups that have finished closing.
    for (const p of list) {
      p.t += dt;
      if (p.phase === 'in' && p.t >= IN_TIME) { p.phase = 'hold'; p.t = 0; }
      if (p.phase === 'hold' && p.t >= p.life) close(p);
    }
    list = list.filter((p) => !(p.phase === 'out' && p.t >= OUT_TIME));

    if (!s.map) return fallbackUpdate(fallback);

    // 1. Close popups you've left, and count what the rest cover.
    if (cover.length !== s.map.length) cover = new Uint16Array(s.map.length);
    cover.fill(0);
    for (const p of list) {
      if (p.phase === 'out' || p.free) continue;
      const frac = measure(p, cam, true);
      p.away = frac < S.closeBelow ? p.away + dt : 0;
      if (p.away > S.grace) close(p);
    }

    // Optional shuffle: swap out the odd still popup, so a still pose
    // keeps a little life. (The gap it leaves gets refilled below.)
    if (S.shuffle > 0 && Math.random() < S.shuffle * dt) {
      const held = list.filter((p) => p.phase === 'hold' && !p.free);
      if (held.length) close(held[Math.floor(Math.random() * held.length)]);
    }

    // 2. Find the bits of you that aren't covered enough.
    gaps.face.length = gaps.body.length = gaps.torso.length = 0;
    let youCells = 0, covered = 0;
    for (let k = 0; k < s.map.length; k++) {
      const part = PART_OF[s.map[k]];
      if (!part) continue;
      youCells++;
      if (cover[k] >= S.layers) covered++;
      else gaps[part].push(k);
    }
    if (!youCells) return; // nobody in view: the outline just empties out

    // 3. Open popups on the gaps until you're covered enough.
    let live = list.filter((p) => p.phase !== 'out').length;
    let made = 0, tries = 0;
    while (made < S.perFrame && tries < S.perFrame * 4 && covered / youCells < S.cover && live < S.max) {
      tries++;
      const parts = Object.keys(gaps).filter((g) => gaps[g].length > 0);
      if (!parts.length) break;
      const part = pickWeighted(S.weights, parts);
      const pool = gaps[part];
      const { x, y } = cellToScreen(pool[Math.floor(Math.random() * pool.length)], cam);
      const p = makePopup(x, y, part, false);
      // Hardly any of you in it (a stray edge pixel): try somewhere else.
      if (measure(p, cam, false) < S.openAbove) continue;
      // Mark what it covers, so the next one goes somewhere new.
      const { i0, i1, j0, j1 } = cellsUnder(p, cam);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * s.w + i;
          cover[k]++;
          if (cover[k] === S.layers && PART_OF[s.map[k]]) covered++;
        }
      }
      for (const g of parts) gaps[g] = gaps[g].filter((k) => cover[k] < S.layers);
      list.push(p);
      live++;
      made++;
    }
  }

  // No body yet: popups come and go on timers around the mouse.
  function fallbackUpdate(fallback) {
    const S = popupSettings;
    let live = list.filter((p) => p.phase !== 'out').length;
    for (let made = 0; live < S.fallbackCount && made < S.perFrame; made++, live++) {
      const unit = Math.min(screen.w, screen.h);
      const a = Math.random() * Math.PI * 2;
      const d = Math.pow(Math.random(), 1.5) * unit * 0.3;
      list.push(makePopup(fallback.x + Math.cos(a) * d, fallback.y + Math.sin(a) * d * 0.8, 'face', true));
    }
  }

  // How open a popup is: 0 (closed) to 1 (open), a bit over 1 while it pops.
  function openness(p) {
    if (p.phase === 'in') return easeOutBack(Math.min(1, p.t / IN_TIME));
    if (p.phase === 'out') return 1 - Math.min(1, p.t / OUT_TIME);
    return 1;
  }

  // Draw all open popups, oldest first so new ones land on top.
  // desktop: the desktop fill, shown behind you in cam popups.
  function draw(ctx, desktop) {
    const open = [...list].sort((a, b) => a.order - b.order);
    ctx.font = '10px "Martian Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';

    for (const p of open) {
      const k = openness(p);
      if (k < 0.05) continue;
      // Scale around the popup's centre. The frame is what grows; the
      // picture inside always shows exactly what's behind it, so you stay
      // lined up even mid-pop.
      const w = Math.round(p.w * k);
      const h = Math.round(p.h * k);
      const x = Math.round(p.x - w / 2);
      const y = Math.round(p.y - h / 2);
      if (w < BORDER * 2 + 8 || h < BAR + 6) continue;

      // Hard shadow, then the ink frame.
      ctx.fillStyle = INK;
      ctx.fillRect(x + SHADOW, y + SHADOW, w, h);
      ctx.fillRect(x, y, w, h);

      // Title bar, name (clipped to the bar), close box.
      ctx.fillStyle = p.bar;
      ctx.fillRect(x + BORDER, y + BORDER, w - BORDER * 2, BAR - BORDER);
      const cb = BAR - BORDER - 6;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + BORDER, y + BORDER, w - BORDER * 2 - cb - 8, BAR - BORDER);
      ctx.clip();
      ctx.fillStyle = INK;
      ctx.fillText(p.name, x + BORDER + 5, y + BORDER + (BAR - BORDER) / 2 + 1);
      ctx.restore();
      ctx.fillStyle = PAPER;
      ctx.fillRect(x + w - BORDER - cb - 3, y + BORDER + 3, cb, cb);

      // Content: you, in this popup's mode. Dots take the title bar's
      // colour, so the odd category popup has category dots.
      const cx = x + BORDER, cy = y + BAR + 1;
      const cw = w - BORDER * 2, ch = h - BAR - 1 - BORDER;
      if (p.mode === 'cam') looks.drawCam(ctx, cx, cy, cw, ch, desktop);
      else if (p.mode === 'dots') looks.drawDots(ctx, cx, cy, cw, ch, p.bar);
      else looks.drawAscii(ctx, cx, cy, cw, ch);
    }
  }

  return { build, update, draw, get list() { return list; } };
}
