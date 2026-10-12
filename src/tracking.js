// Face + hand tracking with MediaPipe, turned into screen-space targets
// for the windows.
//
// Output (all in screen pixels, already mirrored to match the camera):
//   anchors.face    { x, y, scale }  middle of the biggest face
//   anchors.hands   [{ x, y, scale }, ...]  palm centres, up to 2
// scale grows as you get closer to the camera, so the cluster of windows
// grows with you.
//
// Models live in public/models/ and the MediaPipe engine (wasm) is copied
// into public/mediapipe/ on npm install, so nothing loads from a CDN.
// If any of that is missing, status becomes 'off' and the app carries on
// following the mouse.
import { FilesetResolver, FaceDetector, HandLandmarker } from '@mediapipe/tasks-vision';

const SMOOTH = 0.06; // seconds: how quickly targets follow detections
const HOLD = 0.6; // seconds a target survives after it was last seen

const approach = (from, to, tau, dt) => from + (to - from) * (1 - Math.exp(-dt / tau));

export function createTracking() {
  let faceDetector = null;
  let handLandmarker = null;
  let lastVideoTime = -1;

  const state = {
    status: 'loading', // 'loading' | 'ready' | 'no models' | 'off'
    face: null, // { x, y, scale, seen } smoothed
    hands: {}, // keyed by 'Left' / 'Right' so windows don't swap hands
  };

  const MODELS = ['/models/blaze_face_short_range.tflite', '/models/hand_landmarker.task'];

  async function init() {
    // Check the model files are really there first. (A missing file comes
    // back as the dev server's web page, which MediaPipe reports as a
    // confusing "not a valid Flatbuffer" error.)
    const missing = [];
    for (const path of MODELS) {
      const r = await fetch(path, { method: 'HEAD' }).catch(() => null);
      if (!r || !r.ok || (r.headers.get('content-type') || '').includes('text/html')) missing.push(path);
    }
    if (missing.length) {
      state.status = 'no models';
      console.warn('[tracking] model files missing, following the mouse instead. Add:', missing.map((m) => 'public' + m));
      return;
    }
    try {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe');
      const base = (path) => ({ modelAssetPath: path, delegate: 'GPU' });
      [faceDetector, handLandmarker] = await Promise.all([
        FaceDetector.createFromOptions(vision, {
          baseOptions: base(MODELS[0]),
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.5,
        }),
        HandLandmarker.createFromOptions(vision, {
          baseOptions: base(MODELS[1]),
          runningMode: 'VIDEO',
          numHands: 2,
        }),
      ]);
      state.status = 'ready';
    } catch (err) {
      state.status = 'off';
      console.warn('[tracking] off, following the mouse instead:', err);
    }
  }

  // Blend a fresh detection into a smoothed target (or start one).
  function blend(prev, next, dt, now) {
    if (!prev) return { ...next, seen: now };
    return {
      x: approach(prev.x, next.x, SMOOTH, dt),
      y: approach(prev.y, next.y, SMOOTH, dt),
      scale: approach(prev.scale, next.scale, SMOOTH * 3, dt),
      seen: now,
    };
  }

  // cam: { video, rect, width } (how the camera is drawn: cover-fitted
  // and mirrored). unit: a size to measure faces and hands against.
  function update(cam, unit, now, dt) {
    const { video, rect, width } = cam;
    const t = now / 1000;

    // Video fraction (0..1) to screen pixels, mirrored like the drawing.
    const toScreen = (u, v) => ({ x: width - (rect.x + u * rect.w), y: rect.y + v * rect.h });

    // Only run the models when the camera has a new frame.
    if (state.status === 'ready' && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const vw = video.videoWidth, vh = video.videoHeight;

      // Face: take the biggest one (the person closest to the camera).
      const faces = faceDetector.detectForVideo(video, now).detections;
      let best = null;
      for (const f of faces) {
        const b = f.boundingBox;
        if (!best || b.width > best.width) best = b;
      }
      if (best) {
        const p = toScreen((best.originX + best.width / 2) / vw, (best.originY + best.height / 2) / vh);
        const size = (best.width / vw) * rect.w; // face width on screen
        state.face = blend(state.face, { ...p, scale: size / (unit * 0.3) }, dt, t);
      }

      // Hands: palm centre (landmark 9, base of the middle finger), sized by
      // the wrist-to-palm distance.
      const res = handLandmarker.detectForVideo(video, now);
      res.landmarks.forEach((lm, i) => {
        const side = res.handedness[i]?.[0]?.categoryName ?? `hand${i}`;
        const p = toScreen(lm[9].x, lm[9].y);
        const w0 = toScreen(lm[0].x, lm[0].y);
        const size = Math.hypot(p.x - w0.x, p.y - w0.y);
        state.hands[side] = blend(state.hands[side], { ...p, scale: size / (unit * 0.12) }, dt, t);
      });
    }

    // Forget anything not seen recently.
    if (state.face && t - state.face.seen > HOLD) state.face = null;
    for (const k in state.hands) if (t - state.hands[k].seen > HOLD) delete state.hands[k];
  }

  // The targets the windows use. fallback: { x, y } (the mouse) for when
  // there's no face.
  function anchors(fallback) {
    const clampScale = (s, lo, hi) => Math.min(hi, Math.max(lo, s));
    const face = state.face
      ? { x: state.face.x, y: state.face.y, scale: clampScale(state.face.scale, 0.5, 1.8) }
      : { x: fallback.x, y: fallback.y, scale: 1 };
    // Fixed slots, so each hand keeps its own windows: [Left, Right].
    // A missing hand is null and its windows join the face.
    const hands = ['Left', 'Right'].map((k) => state.hands[k]
      ? { x: state.hands[k].x, y: state.hands[k].y, scale: clampScale(state.hands[k].scale, 0.3, 1) }
      : null);
    return { face, hands, tracked: !!state.face };
  }

  // Debug overlay (T): crosshairs on what it's tracking, plus a status line.
  function drawDebug(ctx) {
    ctx.save();
    ctx.lineWidth = 2;
    const cross = (p, color, r) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y);
      ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r);
      ctx.stroke();
    };
    if (state.face) cross(state.face, '#ff6601', 18);
    for (const k in state.hands) cross(state.hands[k], '#3cc8ff', 12);
    ctx.fillStyle = '#f3f2ee';
    ctx.font = '11px "Martian Mono", ui-monospace, monospace';
    const n = Object.keys(state.hands).length;
    const what = state.status !== 'ready' ? state.status
      : `${state.face ? 'face' : 'no face'} · ${n} hand${n === 1 ? '' : 's'}`;
    ctx.fillText(`tracking: ${what}`, 24, 32);
    ctx.restore();
  }

  return { init, update, anchors, drawDebug, state };
}
