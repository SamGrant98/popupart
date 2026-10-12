import './style.css'
import { createAudio } from './audio.js'
import { createMeter } from './meter.js'
import { createWindows } from './windows.js'

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

function resize() {
  // Match the drawing size to the size the canvas is actually shown at
  // on the page, so the two can never disagree.
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}

resize();
window.addEventListener('resize', () => { resize(); windows.build(canvas.width, canvas.height); });

// --- Audio ---
// Nothing reacts to it yet (step 1): the meter just shows what it hears.
const audio = createAudio();
const meter = createMeter(audio);

// --- Windows ---
const windows = createWindows();
windows.build(canvas.width, canvas.height);

// Until face tracking (step 3), the windows crowd around the mouse.
// The focus eases after the pointer so even fast flicks look smooth.
const pointer = { x: canvas.width / 2, y: canvas.height / 2 };
const focus = { ...pointer };
addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });

// How dark the full camera feed behind the windows is (0 = off, 1 = black).
const BACKDROP_DIM = 0.78;

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

const start = performance.now();

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

  // Dim the full feed so the windows are what you look at.
  ctx.fillStyle = `rgba(13, 13, 15, ${BACKDROP_DIM})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Windows: ease the focus towards the pointer, spring the windows
  // towards the focus, then draw them as portals onto the camera.
  focus.x += (pointer.x - focus.x) * (1 - Math.exp(-dt / 0.08));
  focus.y += (pointer.y - focus.y) * (1 - Math.exp(-dt / 0.08));
  windows.update(dt, focus, (now - start) / 1000);
  windows.draw(ctx, { video, rect, width: canvas.width });


  // Ask the browser to call render again before the next screen refresh.
  requestAnimationFrame(render);
}

// startCamera() returns a Promise, so .then() waits for it to finish
// before starting the loop.
startCamera().then(() => requestAnimationFrame(render));
