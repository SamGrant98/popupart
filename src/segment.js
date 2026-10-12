// Person segmentation: which pixels are you, and which bit of you.
//
// MediaPipe's multiclass selfie segmenter labels every camera pixel:
//   0 background · 1 hair · 2 body skin (hands, arms, neck)
//   3 face skin · 4 clothes · 5 other (glasses, hats...)
// From that we keep one small "label map" per frame, which everything
// else reads: the popups pick where to open from it (stage 2) and cut the
// camera out with it (stage 3).
//
// The map is downsized to MAP_W wide (keeping the camera's shape), which
// is plenty for picking spots and making masks, and cheap to read.
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

export const CLASS = { background: 0, hair: 1, body: 2, face: 3, clothes: 4, other: 5 };
const MODEL = '/models/selfie_multiclass_256x256.tflite';
const MAP_W = 160;

export function createSegmenter() {
  let segmenter = null;
  let lastVideoTime = -1;

  const state = {
    status: 'loading', // 'loading' | 'ready' | 'no model' | 'off'
    map: null, // Uint8Array of labels, w x h, in CAMERA space (not mirrored)
    w: 0,
    h: 0,
  };

  async function init() {
    const r = await fetch(MODEL, { method: 'HEAD' }).catch(() => null);
    if (!r || !r.ok || (r.headers.get('content-type') || '').includes('text/html')) {
      state.status = 'no model';
      console.warn('[segment] model missing. Add: public' + MODEL);
      return;
    }
    try {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe');
      segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
      state.status = 'ready';
    } catch (err) {
      state.status = 'off';
      console.warn('[segment] off:', err);
    }
  }

  // Run the model on new camera frames and shrink its answer into the map.
  function update(video, now) {
    if (state.status !== 'ready' || video.readyState < 2 || video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    segmenter.segmentForVideo(video, now, (result) => {
      const mask = result.categoryMask;
      if (!mask) return;
      const src = mask.getAsUint8Array();
      const sw = mask.width, sh = mask.height;
      const w = MAP_W, h = Math.round((MAP_W * sh) / sw);
      if (!state.map || state.w !== w || state.h !== h) {
        state.map = new Uint8Array(w * h);
        state.w = w;
        state.h = h;
      }
      // Nearest-neighbour shrink: labels can't be averaged.
      for (let y = 0; y < h; y++) {
        const row = Math.floor((y * sh) / h) * sw;
        for (let x = 0; x < w; x++) state.map[y * w + x] = src[row + Math.floor((x * sw) / w)];
      }
      mask.close(); // free the GPU/wasm memory
    });
  }

  // Label at a camera-space fraction (u, v in 0..1). 0 if no map yet.
  function labelAt(u, v) {
    if (!state.map) return 0;
    const x = Math.min(state.w - 1, Math.max(0, Math.floor(u * state.w)));
    const y = Math.min(state.h - 1, Math.max(0, Math.floor(v * state.h)));
    return state.map[y * state.w + x];
  }

  // Debug view (S): the label map tinted on screen, lined up with the
  // camera (cover-fitted and mirrored like everything else).
  const COLORS = {
    [CLASS.hair]: [162, 116, 255], // purple
    [CLASS.body]: [60, 200, 255], // blue: hands, arms
    [CLASS.face]: [255, 102, 1], // orange
    [CLASS.clothes]: [0, 164, 86], // green
    [CLASS.other]: [255, 214, 25], // yellow
  };
  const debugCanvas = document.createElement('canvas');
  const debugCtx = debugCanvas.getContext('2d');

  function drawDebug(ctx, cam) {
    if (state.map) {
      if (debugCanvas.width !== state.w || debugCanvas.height !== state.h) {
        debugCanvas.width = state.w;
        debugCanvas.height = state.h;
      }
      const img = debugCtx.createImageData(state.w, state.h);
      for (let i = 0; i < state.map.length; i++) {
        const c = COLORS[state.map[i]];
        if (!c) continue;
        img.data.set([c[0], c[1], c[2], 150], i * 4);
      }
      debugCtx.putImageData(img, 0, 0);
      const { rect, width } = cam;
      ctx.save();
      ctx.imageSmoothingEnabled = false; // chunky pixels: honest about the resolution
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(debugCanvas, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = '#f3f2ee';
    ctx.font = '11px "Martian Mono", ui-monospace, monospace';
    ctx.fillText(`segment: ${state.status}`, 24, 52);
    ctx.restore();
  }

  return { init, update, labelAt, drawDebug, state };
}
