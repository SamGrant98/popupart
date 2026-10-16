import './style.css'
import { createAudio } from './audio.js'
import { createMeter } from './meter.js'
import { createWindows } from './windows.js'
import { createSegmenter } from './segment.js'
import { createLooks } from './looks.js'

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

// --- Segmentation ---
// Labels every camera pixel (face, hands, hair, clothes, background).
// S shows it tinted over the screen.
const segmenter = createSegmenter();
let showSegment = false;
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 's' && !e.repeat) showSegment = !showSegment;
});

// --- Popups ---
// Open and close over wherever you are, picked from the segmentation.
// Until it has loaded (or when nobody is in view) they crowd the mouse.
// looks: the cam / dots / ASCII layers the popups show.
const looks = createLooks(segmenter);
const windows = createWindows(segmenter, looks);
windows.build(canvas.width, canvas.height);

const pointer = { x: canvas.width / 2, y: canvas.height / 2 };
addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });

// --- Desktop ---
// The background is the made-up OS desktop: ink with the madebysam dot
// grid. The camera only ever appears inside windows. Drawn once into a
// pattern tile and reused every frame.
const GRID = 24;
const tile = document.createElement('canvas');
tile.width = tile.height = GRID;
{
  const t = tile.getContext('2d');
  t.fillStyle = '#0d0d0f';
  t.fillRect(0, 0, GRID, GRID);
  t.fillStyle = '#2a2a30';
  t.beginPath();
  t.arc(0, 0, 1.5, 0, Math.PI * 2); // dot on the corner, so dots sit on multiples of 24
  t.arc(GRID, 0, 1.5, 0, Math.PI * 2);
  t.arc(0, GRID, 1.5, 0, Math.PI * 2);
  t.arc(GRID, GRID, 1.5, 0, Math.PI * 2);
  t.fill();
}
const desktop = ctx.createPattern(tile, 'repeat');

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

  // Desktop background (no camera feed).
  ctx.fillStyle = desktop;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  segmenter.update(video, now);

  // Popups: open/close over you, each a window onto the camera.
  const cam = { video, rect, width: canvas.width };
  looks.update(cam, canvas.width, canvas.height);
  windows.update(dt, cam, pointer);
  windows.draw(ctx, desktop);
  if (showSegment) segmenter.drawDebug(ctx, cam);


  // Ask the browser to call render again before the next screen refresh.
  requestAnimationFrame(render);
}

// startCamera() returns a Promise, so .then() waits for it to finish
// before starting the loop.
startCamera().then(() => {
  requestAnimationFrame(render);
  segmenter.init(); // loads in the background; the mouse works meanwhile
});
