// The windows: little retro-OS popups, each a portal onto the camera.
//
// Each window:
//   - belongs to a group: your face (most windows) or one of your hands
//   - has a home spot near its group's anchor (an offset, so they crowd
//     around you instead of stacking on one point)
//   - is pulled to that spot by a spring, so it glides, overshoots a
//     little and settles, instead of snapping
//   - shows the bit of the camera that is directly behind it, so as
//     windows move, the picture inside them stays lined up with you
//
// Everything is drawn on the canvas (not HTML), so 20+ windows stay smooth.

const BAR = 18; // title bar height
const BORDER = 3; // ink frame thickness
const SHADOW = 6; // hard drop shadow offset

const INK = '#0d0d0f';
const ORANGE = '#ff6601';
const CATEGORY = ['#a274ff', '#00a456', '#3cc8ff', '#ffd619']; // sound, movement, space, play

// Tunable by the controls later.
export const windowSettings = {
  count: 18,
  stiffness: 60, // spring strength: higher = snappier
  damping: 9, // spring friction: lower = more wobble and overshoot
  spread: 1, // how far windows sit from the focus point
};

// A seeded random so the same windows come back on every reload.
function seeded(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

export function createWindows() {
  let list = [];

  function build(w, h) {
    const rand = seeded(7);
    const unit = Math.min(w, h); // so the layout scales with the screen
    list = Array.from({ length: windowSettings.count }, (_, i) => {
      // Home offset: random angle, distance biased towards the middle, so
      // there's a dense core and a few strays further out.
      const angle = rand() * Math.PI * 2;
      const dist = Math.pow(rand(), 1.6) * unit * 0.32;
      // Size: mostly small, the odd big one. Snapped to 8px for crisp edges.
      const big = rand() < 0.2;
      const ww = Math.round((big ? 180 + rand() * 120 : 90 + rand() * 90) * (unit / 800) / 8) * 8;
      const hh = Math.round(ww * (0.55 + rand() * 0.45) / 8) * 8 + BAR;
      return {
        ox: Math.cos(angle) * dist,
        oy: Math.sin(angle) * dist * 0.8,
        w: Math.max(64, ww),
        h: Math.max(48 + BAR, hh),
        // start at the centre so they burst out on load
        x: w / 2, y: h / 2, vx: 0, vy: 0,
        // a little slow wander per window so the cluster breathes
        phase: rand() * Math.PI * 2,
        speed: 0.3 + rand() * 0.5,
        name: `cam_${String(i + 1).padStart(2, '0')}.exe`,
        // 0 = face, 1 = first hand, 2 = second hand (about 60 / 20 / 20)
        group: (() => { const r = rand(); return r < 0.6 ? 0 : r < 0.8 ? 1 : 2; })(),
        // about 1 in 6 windows get a category colour title bar
        bar: rand() < 0.17 ? CATEGORY[Math.floor(rand() * 4)] : ORANGE,
      };
    });
  }

  // Move every window one step towards its spot.
  // anchors: { face: {x, y, scale}, hands: [{x, y, scale}, ...] } in screen
  // pixels (see tracking.js); t: seconds since start.
  function update(dt, anchors, t) {
    const { stiffness: k, damping: c, spread } = windowSettings;
    for (const win of list) {
      // Hand windows go to their hand if it's visible, otherwise they
      // join the face. Hand clusters are tighter than the face's.
      const hand = win.group > 0 ? anchors.hands[win.group - 1] : null;
      const a = hand ?? anchors.face;
      const s = (hand ? 0.45 : 1) * a.scale * spread;

      // Where this window wants to be: its anchor, plus its offset,
      // plus a slow wobble. Positions are window centres.
      const wobX = Math.sin(t * win.speed + win.phase) * 12;
      const wobY = Math.cos(t * win.speed * 0.8 + win.phase) * 9;
      const tx = a.x + win.ox * s + wobX;
      const ty = a.y + win.oy * s + wobY;

      // Spring: accelerate towards the target, slowed by friction.
      // (Semi-implicit Euler: update velocity, then position. Stable
      // at any frame rate as long as dt stays small, which main.js caps.)
      win.vx += (k * (tx - win.x) - c * win.vx) * dt;
      win.vy += (k * (ty - win.y) - c * win.vy) * dt;
      win.x += win.vx * dt;
      win.y += win.vy * dt;
      win.dist = Math.hypot(tx - win.x, ty - win.y);
    }
  }

  // Draw all windows. cam: { video, rect, width } describes how the
  // camera is drawn underneath (cover-fitted and mirrored), so each
  // window can cut out exactly the part that is behind it.
  function draw(ctx, cam) {
    // Furthest-from-home first, so the settled ones end up on top.
    const order = [...list].sort((a, b) => b.dist - a.dist);
    ctx.font = '10px "Martian Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';

    for (const win of order) {
      const x = Math.round(win.x - win.w / 2);
      const y = Math.round(win.y - win.h / 2);
      const { w, h } = win;

      // Hard shadow, then the ink frame.
      ctx.fillStyle = INK;
      ctx.fillRect(x + SHADOW, y + SHADOW, w, h);
      ctx.fillRect(x, y, w, h);

      // Title bar, name, close box.
      ctx.fillStyle = win.bar;
      ctx.fillRect(x + BORDER, y + BORDER, w - BORDER * 2, BAR - BORDER);
      ctx.fillStyle = INK;
      ctx.fillText(win.name, x + BORDER + 5, y + BORDER + (BAR - BORDER) / 2 + 1);
      const cb = BAR - BORDER - 6;
      ctx.fillStyle = '#f3f2ee';
      ctx.fillRect(x + w - BORDER - cb - 3, y + BORDER + 3, cb, cb);

      // Content: the camera pixels behind this window.
      const cx = x + BORDER, cy = y + BAR + 1;
      const cw = w - BORDER * 2, ch = h - BAR - 1 - BORDER;
      drawCameraCrop(ctx, cam, cx, cy, cw, ch);
    }
  }

  return { build, update, draw, get list() { return list; } };
}

// Draw the part of the (mirrored, cover-fitted) camera that sits under the
// screen rectangle cx,cy,cw,ch, into that same rectangle.
function drawCameraCrop(ctx, { video, rect, width }, cx, cy, cw, ch) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return;
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
