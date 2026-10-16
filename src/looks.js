// The three ways a popup can show you:
//   cam    the real camera, cut out with the mask (background becomes desktop)
//   dots   a halftone: one dot per 8px cell, bigger where you're brighter
//   ascii  characters from a density ramp, denser where you're brighter
//
// All three are built once per frame for the WHOLE screen, then each popup
// just shows its own patch. Because every popup reads the same layer, and
// the dot/character grid is pinned to the screen (not to the popup), two
// popups side by side line up like windows onto one continuous picture.
//
// Per frame (update):
//   1. the camera is shrunk to one pixel per 8px cell -> brightness grid
//   2. the segmentation map is read at each cell -> "is this you?" grid
//   3. the camera is drawn full size and cut out with the mask -> cutout
//   4. brightness is stretched across your own range, so dots and ASCII
//      use the full scale whatever the lighting
//
// The brightness grid reads the video straight into a tiny canvas, rather
// than shrinking the full-size cutout: reading a big GPU canvas back to
// the CPU every frame is slow, reading 160 x 90 pixels is not.

import { CLASS } from './segment.js';

const CELL = 8; // dot grid, px (a third of the site's 24px grid)
const DOT_MAX = CELL / 2 - 0.9; // biggest dot radius
const CHAR_W = 8; // ascii cell, px
const CHAR_H = 12;
const RAMP = ' .:-=+*#%@'; // dark -> bright (light text on a dark window)
const INK = '#0d0d0f';
const PAPER = '#f3f2ee';

export function createLooks(segmenter) {
  // 1. brightness grid
  const small = document.createElement('canvas');
  const smallCtx = small.getContext('2d', { willReadFrequently: true });
  let lum = new Float32Array(0); // 0..1 per cell, stretched
  let on = new Uint8Array(0); // 1 where the cell is you
  let cols = 0, rows = 0;

  // 3. cutout layer and the mask that cuts it
  const cutout = document.createElement('canvas');
  const cutCtx = cutout.getContext('2d');
  const mask = document.createElement('canvas');
  const maskCtx = mask.getContext('2d');
  let maskVersion = -1;

  // brightness histogram, for the stretch
  const BINS = 64;
  const hist = new Uint32Array(BINS);
  function percentile(p, count) {
    let target = p * count;
    for (let b = 0; b < BINS; b++) if ((target -= hist[b]) <= 0) return b / BINS;
    return 1;
  }

  // ASCII glyphs, pre-drawn once into a strip, so drawing a character is
  // a cheap image copy instead of text layout.
  const glyphs = document.createElement('canvas');
  function buildGlyphs() {
    glyphs.width = CHAR_W * RAMP.length;
    glyphs.height = CHAR_H;
    const g = glyphs.getContext('2d');
    g.clearRect(0, 0, glyphs.width, glyphs.height);
    g.fillStyle = PAPER;
    g.font = '11px "Martian Mono", ui-monospace, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < RAMP.length; i++) g.fillText(RAMP[i], i * CHAR_W + CHAR_W / 2, CHAR_H / 2 + 1);
  }
  buildGlyphs();
  // Rebuild once the web font has arrived (the first build may have used
  // the fallback font).
  document.fonts?.ready.then(buildGlyphs);

  // Rebuild the alpha mask from the label map: opaque where you are.
  function refreshMask() {
    const s = segmenter.state;
    if (!s.map || s.version === maskVersion) return;
    maskVersion = s.version;
    if (mask.width !== s.w || mask.height !== s.h) {
      mask.width = s.w;
      mask.height = s.h;
    }
    const img = maskCtx.createImageData(s.w, s.h);
    for (let i = 0; i < s.map.length; i++) img.data[i * 4 + 3] = s.map[i] === CLASS.background ? 0 : 255;
    maskCtx.putImageData(img, 0, 0);
  }

  // Draw something camera-shaped (video or mask) mirrored and cover-fitted
  // onto a canvas that is `scale` times the screen size.
  function drawMirrored(c, source, cam, scale) {
    const { rect, width } = cam;
    c.save();
    c.scale(scale, scale);
    c.translate(width, 0);
    c.scale(-1, 1);
    c.drawImage(source, rect.x, rect.y, rect.w, rect.h);
    c.restore();
  }

  function update(cam, W, H) {
    const { video } = cam;
    if (!video.videoWidth) return;
    const hasMap = !!segmenter.state.map;

    // 1. Brightness grid: one pixel per cell.
    const c = Math.ceil(W / CELL), r = Math.ceil(H / CELL);
    if (c !== cols || r !== rows) {
      cols = c; rows = r;
      small.width = cols; small.height = rows;
      lum = new Float32Array(cols * rows);
      on = new Uint8Array(cols * rows);
    }
    smallCtx.imageSmoothingQuality = 'high';
    drawMirrored(smallCtx, video, cam, 1 / CELL);
    const px = smallCtx.getImageData(0, 0, cols, rows).data;

    // 2 + 4. "Is this you?" per cell, and a histogram of your brightness.
    const { rect, width } = cam;
    hist.fill(0);
    let count = 0;
    for (let j = 0; j < rows; j++) {
      const v = ((j + 0.5) * CELL - rect.y) / rect.h;
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const u = (width - (i + 0.5) * CELL - rect.x) / rect.w; // undo the mirror
        const you = !hasMap || segmenter.labelAt(u, v) !== CLASS.background;
        on[k] = you ? 1 : 0;
        // Perceived brightness (Rec. 601 weights).
        const L = (px[k * 4] * 0.299 + px[k * 4 + 1] * 0.587 + px[k * 4 + 2] * 0.114) / 255;
        lum[k] = L;
        if (you) { hist[Math.min(BINS - 1, Math.floor(L * BINS))]++; count++; }
      }
    }
    // Stretch your range to 0..1. Uses the 4th and 96th percentiles, not
    // the darkest and brightest cell, so one shiny spot can't flatten the
    // rest. (The floor stops a flat image blowing up into noise.)
    const lo = percentile(0.04, count), hi = percentile(0.96, count);
    const span = Math.max(0.15, hi - lo);
    for (let k = 0; k < lum.length; k++) lum[k] = Math.min(1, Math.max(0, (lum[k] - lo) / span));

    // 3. Cutout: the camera, kept only where the mask says you are.
    if (cutout.width !== W || cutout.height !== H) { cutout.width = W; cutout.height = H; }
    cutCtx.globalCompositeOperation = 'source-over';
    cutCtx.clearRect(0, 0, W, H);
    drawMirrored(cutCtx, video, cam, 1);
    if (hasMap) {
      refreshMask();
      cutCtx.globalCompositeOperation = 'destination-in';
      cutCtx.imageSmoothingEnabled = true; // soft edge from the chunky mask
      drawMirrored(cutCtx, mask, cam, 1);
      cutCtx.globalCompositeOperation = 'source-over';
    }
  }

  // --- Drawing a popup's patch. x, y, w, h: the popup's content area. ---

  // Background behind you: the desktop itself, so the window reads as a
  // pane of glass with only you on it.
  function drawCam(ctx, x, y, w, h, desktop) {
    ctx.fillStyle = desktop;
    ctx.fillRect(x, y, w, h);
    ctx.drawImage(cutout, x, y, w, h, x, y, w, h);
  }

  function drawDots(ctx, x, y, w, h, color) {
    ctx.fillStyle = INK;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.beginPath();
    const i0 = Math.max(0, Math.floor(x / CELL)), i1 = Math.min(cols - 1, Math.floor((x + w) / CELL));
    const j0 = Math.max(0, Math.floor(y / CELL)), j1 = Math.min(rows - 1, Math.floor((y + h) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i;
        if (!on[k]) continue;
        // Never quite touching, so bright areas stay dots and don't merge
        // into a blob. The power curve keeps detail in the mid tones.
        const rad = DOT_MAX * lum[k] ** 1.3;
        if (rad < 0.7) continue;
        const cx = i * CELL + CELL / 2, cy = j * CELL + CELL / 2;
        ctx.moveTo(cx + rad, cy);
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function drawAscii(ctx, x, y, w, h) {
    ctx.fillStyle = INK;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const top = RAMP.length - 1;
    const i0 = Math.floor(x / CHAR_W), i1 = Math.floor((x + w) / CHAR_W);
    const j0 = Math.floor(y / CHAR_H), j1 = Math.floor((y + h) / CHAR_H);
    for (let j = j0; j <= j1; j++) {
      // Sample the brightness grid at the character's centre.
      const gj = Math.floor(((j + 0.5) * CHAR_H) / CELL);
      if (gj < 0 || gj >= rows) continue;
      for (let i = i0; i <= i1; i++) {
        const gi = Math.floor(((i + 0.5) * CHAR_W) / CELL);
        if (gi < 0 || gi >= cols) continue;
        const k = gj * cols + gi;
        if (!on[k]) continue;
        const g = Math.round(lum[k] * top);
        if (g === 0) continue; // a space: nothing to draw
        ctx.drawImage(glyphs, g * CHAR_W, 0, CHAR_W, CHAR_H, i * CHAR_W, j * CHAR_H, CHAR_W, CHAR_H);
      }
    }
    ctx.restore();
  }

  return { update, drawCam, drawDots, drawAscii };
}
