import './style.css'
import { createAudio } from './audio.js'
import { createMeter } from './meter.js'

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

function resize() {
  // Match the drawing size to the size the canvas is actually shown at
  // on the page, so the two can never disagree.
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}

resize();
window.addEventListener('resize', resize);

// --- Audio ---
// Nothing reacts to it yet (step 1): the meter just shows what it hears.
const audio = createAudio();
const meter = createMeter(audio);

// --- Camera ---

// A video element that lives only in JS. We never add it to the page;
// we just read its frames and draw them onto the canvas.
const video = document.createElement('video');
video.muted = true;
video.playsInline = true;

async function startCamera() {
  // Asks for permission, then waits until the camera is streaming.
  const stream = await navigator.mediaDevices.getUserMedia({
    // "ideal" is a preference: the browser picks the closest mode the
    // camera supports. We always read the real size from videoWidth/Height.
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  video.srcObject = stream;
  await video.play();
  console.log('camera:', video.videoWidth, video.videoHeight);
}

// --- Layout ---

// Works out where to draw the video so it fills the canvas without
// stretching (like CSS object-fit: cover). Any overhang is cropped.
function getCoverRect() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;

  // How much we'd need to scale to match each dimension.
  const scaleX = canvas.width / vw;
  const scaleY = canvas.height / vh;

  // Cover uses the larger scale, so both sides are at least filled.
  const scale = Math.max(scaleX, scaleY);

  const w = vw * scale;
  const h = vh * scale;

  // Centre it. One of these ends up negative, pushing the overhang
  // off the edges of the canvas.
  const x = (canvas.width - w) / 2;
  const y = (canvas.height - h) / 2;

  return { x, y, w, h };
}

// --- Render loop ---

let last = performance.now();

function render(now) {
  // Seconds since the last frame (capped, so a background tab doesn't
  // make everything jump when you come back).
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  audio.update(dt);
  meter.draw(dt);

  const rect = getCoverRect();

  // Mirror the video feed
  ctx.save()

  ctx.translate(canvas.width, 0)
  ctx.scale(-1, 1) // flips x axis

  // Draw the current camera frame, cover-fitted to the canvas.
  ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h);

  ctx.restore()


  // Ask the browser to call render again before the next screen refresh.
  requestAnimationFrame(render);
}

// startCamera() returns a Promise, so .then() waits for it to finish
// before starting the loop.
startCamera().then(() => requestAnimationFrame(render));
