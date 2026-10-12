// The popups: little retro-OS windows that open and close over wherever
// you are. Nothing travels. Each popup is born on a spot that belongs to
// you (picked from the segmentation map), pops in, stays a moment, pops
// out, and a new one opens somewhere else.
//
// Where they open is weighted by body part:
//   face  (face skin, hair, glasses)  most popups
//   body  (bare skin: hands, arms)    a good share
//   torso (clothes: torso, sleeves)   a few, and smaller
//
// There is a fixed number of "slots". Each slot loops forever:
//   wait (a short random gap) -> in -> hold -> out -> wait -> ...
// so the number on screen stays steady, and later the audio can cut the
// waits short to make a burst.
//
// Everything is drawn on the canvas (not HTML), so 50+ windows stay smooth.

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
const LEAVE_GRACE = 0.08; // seconds off you before a popup closes early

// Tunable by the controls later.
export const popupSettings = {
  count: 70, // popups on screen (roughly)
  life: [0.5, 1.4], // how long each one stays open, min..max seconds
  gap: [0, 0.08], // pause before a slot opens its next popup
  leave: true, // close early when you move out from under it
  size: 1, // overall size multiplier
  // Where popups open. Don't need to add up to 1; they're relative.
  weights: { face: 0.45, body: 0.35, torso: 0.2 },
};

// Per body part: width range (px at an 800px-tall screen) and title prefix.
const PARTS = {
  face: { w: [110, 220], name: 'cam' },
  body: { w: [80, 170], name: 'cam' },
  torso: { w: [64, 130], name: 'cam' },
};
// Which segmentation labels count as which part.
const PART_OF = {
  [CLASS.face]: 'face', [CLASS.hair]: 'face', [CLASS.other]: 'face',
  [CLASS.body]: 'body',
  [CLASS.clothes]: 'torso',
};

const rand = (a, b) => a + Math.random() * (b - a);

// Overshoot ease: grows a touch past full size, then settles. Gives the
// "pop" without a bouncy spring.
function easeOutBack(t) {
  const c = 2.6;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

export function createWindows(segmenter) {
  let slots = [];
  let screen = { w: 1, h: 1 };
  let order = 0; // increases with every popup, so newer ones draw on top

  // Lists of map cells for each body part, rebuilt when the map changes.
  const pools = { face: [], body: [], torso: [] };
  let poolVersion = -1;

  function build(w, h) {
    screen = { w, h };
    // Fresh slots, all waiting a random bit so they don't all open at once.
    slots = Array.from({ length: popupSettings.count }, () => ({
      phase: 'wait', t: 0, wait: rand(0, 1.5), popup: null,
    }));
  }

  function refreshPools() {
    const s = segmenter.state;
    if (!s.map || s.version === poolVersion) return;
    poolVersion = s.version;
    pools.face.length = pools.body.length = pools.torso.length = 0;
    for (let i = 0; i < s.map.length; i++) {
      const part = PART_OF[s.map[i]];
      if (part) pools[part].push(i);
    }
  }

  // Pick a body part by weight, skipping any that aren't in view.
  function pickPart() {
    const { weights } = popupSettings;
    const live = Object.keys(pools).filter((p) => pools[p].length > 0);
    if (!live.length) return null;
    let total = 0;
    for (const p of live) total += weights[p];
    let r = Math.random() * total;
    for (const p of live) if ((r -= weights[p]) <= 0) return p;
    return live[live.length - 1];
  }

  // Where to open the next popup, in screen pixels, and which part it's on.
  // cam: { rect, width } (the camera's cover-fitted, mirrored placement).
  // fallback: a screen point to crowd around when nobody is in view
  // (the mouse), so the page is never empty while the model loads.
  function pickSpot(cam, fallback) {
    const part = pickPart();
    if (!part) {
      const unit = Math.min(screen.w, screen.h);
      const a = Math.random() * Math.PI * 2;
      const d = Math.pow(Math.random(), 1.5) * unit * 0.3;
      return { x: fallback.x + Math.cos(a) * d, y: fallback.y + Math.sin(a) * d * 0.8, part: 'face', free: true };
    }
    const s = segmenter.state;
    const pool = pools[part];
    const cell = pool[Math.floor(Math.random() * pool.length)];
    // Somewhere inside that cell, as a 0..1 fraction of the camera image...
    const u = ((cell % s.w) + Math.random()) / s.w;
    const v = (Math.floor(cell / s.w) + Math.random()) / s.h;
    // ...then onto the screen. The camera is mirrored, hence width - x.
    const { rect, width } = cam;
    return { x: width - (rect.x + u * rect.w), y: rect.y + v * rect.h, part };
  }

  function spawn(cam, fallback) {
    const { x, y, part, free } = pickSpot(cam, fallback);
    const spec = PARTS[part];
    const unit = Math.min(screen.w, screen.h) / 800;
    const big = Math.random() < 0.1; // the odd big one
    const base = rand(spec.w[0], spec.w[1]) * (big ? 1.6 : 1) * unit * popupSettings.size;
    // Snapped to 8px so edges stay crisp.
    const w = Math.max(56, Math.round(base / 8) * 8);
    const h = Math.max(40, Math.round((w * rand(0.55, 1)) / 8) * 8) + BAR;
    return {
      x, y, w, h, part,
      free: !!free, // mouse popups don't check whether you're under them
      away: 0, // how long you've been gone from under it
      life: rand(popupSettings.life[0], popupSettings.life[1]),
      order: order++,
      name: `${spec.name}_${String(Math.floor(rand(1, 100))).padStart(2, '0')}.exe`,
      // about 1 in 6 get a category colour title bar
      bar: Math.random() < 0.17 ? CATEGORY[Math.floor(Math.random() * 4)] : ORANGE,
    };
  }

  // Is the screen point x, y still on you? (Background = no.)
  function onYou(x, y, cam) {
    const { rect, width } = cam;
    const u = (width - x - rect.x) / rect.w; // undo the mirror
    const v = (y - rect.y) / rect.h;
    if (u < 0 || u > 1 || v < 0 || v > 1) return false;
    return segmenter.labelAt(u, v) !== CLASS.background;
  }

  // Step every slot through its loop. cam as in pickSpot.
  function update(dt, cam, fallback) {
    refreshPools();
    for (const slot of slots) {
      slot.t += dt;
      // You moved away from under this popup: close it early, so the slot
      // is free to open again where you are now.
      const p = slot.popup;
      if (popupSettings.leave && p && !p.free && (slot.phase === 'in' || slot.phase === 'hold')) {
        p.away = onYou(p.x, p.y, cam) ? 0 : p.away + dt;
        if (p.away > LEAVE_GRACE) {
          slot.phase = 'out';
          slot.t = 0;
          continue;
        }
      }
      if (slot.phase === 'wait' && slot.t >= slot.wait) {
        slot.popup = spawn(cam, fallback);
        slot.phase = 'in';
        slot.t = 0;
      } else if (slot.phase === 'in' && slot.t >= IN_TIME) {
        slot.phase = 'hold';
        slot.t = 0;
      } else if (slot.phase === 'hold' && slot.t >= slot.popup.life) {
        slot.phase = 'out';
        slot.t = 0;
      } else if (slot.phase === 'out' && slot.t >= OUT_TIME) {
        slot.phase = 'wait';
        slot.t = 0;
        slot.popup = null;
        slot.wait = rand(popupSettings.gap[0], popupSettings.gap[1]);
      }
    }
  }

  // How open a slot's popup is: 0 (closed) to 1 (open), a bit over 1
  // while it pops.
  function openness(slot) {
    if (slot.phase === 'in') return easeOutBack(Math.min(1, slot.t / IN_TIME));
    if (slot.phase === 'out') return 1 - Math.min(1, slot.t / OUT_TIME);
    return slot.phase === 'hold' ? 1 : 0;
  }

  // Draw all open popups, oldest first so new ones land on top.
  // cam: { video, rect, width } for the camera crop inside each one.
  function draw(ctx, cam) {
    const open = slots.filter((s) => s.popup).sort((a, b) => a.popup.order - b.popup.order);
    ctx.font = '10px "Martian Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';

    for (const slot of open) {
      const k = openness(slot);
      if (k < 0.05) continue;
      const p = slot.popup;
      // Scale around the popup's centre. The frame is what grows; the
      // camera inside always shows exactly what's behind it, so you stay
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

      // Content: the camera pixels behind this popup.
      drawCameraCrop(ctx, cam, x + BORDER, y + BAR + 1, w - BORDER * 2, h - BAR - 1 - BORDER);
    }
  }

  return { build, update, draw, get slots() { return slots; } };
}

// Draw the part of the (mirrored, cover-fitted) camera that sits under the
// screen rectangle cx,cy,cw,ch, into that same rectangle.
function drawCameraCrop(ctx, { video, rect, width }, cx, cy, cw, ch) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || cw <= 0 || ch <= 0) return;
  // The camera is mirrored, so screen x maps to (width - x) before the flip.
  const sx = ((width - cx - cw - rect.x) / rect.w) * vw;
  const sy = ((cy - rect.y) / rect.h) * vh;
  const sw = (cw / rect.w) * vw;
  const sh = (ch / rect.h) * vh;
  ctx.save();
  ctx.translate(cx + cw, cy);
  ctx.scale(-1, 1);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
  ctx.restore();
}
