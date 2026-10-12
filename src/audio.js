// Audio in, three clean numbers out.
//
// Turns the mic (or a dropped mp3) into:
//   low, mid, high   0..1 each, smoothed, auto-gained
//   kick             true for the one frame a kick is detected
//
// Four rules (see PROJECT-BRIEF.md) are what make this behave:
//   1. Browser "voice" processing off on the mic. Noise suppression and
//      auto gain are built for calls and treat music as noise to remove.
//   2. Three bands, never raw FFT bins.
//   3. Auto-gain: each band is scaled between its own recent quiet and
//      loud levels, so it reads 0..1 at any volume, in any room.
//   4. Envelopes: jump up fast, fall slowly, so values don't flicker.

// Frequency ranges in Hz.
const BANDS = {
  low: [30, 150], // kick drum, bass
  mid: [150, 2000], // vocals, snares, most instruments
  high: [2000, 12000], // hats, cymbals, air
};

// Envelope release times in seconds: how long a band takes to fall
// back after a hit. Attack is near-instant for all of them.
const ATTACK = 0.01;
const RELEASE = { low: 0.18, mid: 0.14, high: 0.08 };

// Auto-gain: the "loud" level falls back over ~PEAK_FALL seconds and the
// "quiet" level creeps up over ~FLOOR_RISE seconds, so both follow the
// music as it changes without reacting to every hit.
const PEAK_FALL = 6;
const FLOOR_RISE = 4;
const MIN_RANGE = 0.04; // below this the input is basically silence

// Smooth a value towards a target. Time-based, so it behaves the same
// at 30fps or 144fps. tau = roughly how long it takes to get there.
const approach = (from, to, tau, dt) => from + (to - from) * (1 - Math.exp(-dt / tau));
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function createAudio() {
  let ctx = null;
  let analyser = null;
  let bins = null;
  let fileEl = null; // the <audio> element when playing a file
  let stream = null; // the mic stream

  // Tunable by the controls later.
  const settings = {
    sensitivity: 0.2, // how far above its recent average the low band must jump to count as a kick
    cooldown: 0.22, // seconds between kicks (0.22s = up to ~270bpm)
  };

  // Everything the rest of the app reads.
  const state = {
    source: 'none', // 'none' | 'mic' | 'file'
    low: 0, mid: 0, high: 0, // smoothed, 0..1
    raw: { low: 0, mid: 0, high: 0 }, // auto-gained but unsmoothed, for the meter
    kick: false,
    sinceKick: Infinity, // seconds since the last kick
  };

  // Per-band auto-gain memory.
  const gain = {};
  for (const b in BANDS) gain[b] = { peak: MIN_RANGE, floor: 0 };
  let lowAvg = 0; // slow average of the low band, for kick detection
  let armed = true; // must fall back after a kick before the next can count

  // Build (once) the context and analyser everything feeds into.
  function ensureContext() {
    if (ctx) return;
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; // 1024 bins, ~23Hz each at 48kHz
    analyser.smoothingTimeConstant = 0; // we do our own smoothing
    bins = new Uint8Array(analyser.frequencyBinCount);
  }

  function stopCurrent() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (fileEl) { fileEl.pause(); URL.revokeObjectURL(fileEl.src); }
    fileEl = null;
  }

  async function startMic() {
    ensureContext();
    stopCurrent();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Rule 1: switch off call processing, or the music gets "cleaned" away.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    ctx.createMediaStreamSource(stream).connect(analyser);
    await ctx.resume();
    state.source = 'mic';
  }

  async function startFile(file) {
    ensureContext();
    stopCurrent();
    fileEl = new Audio(URL.createObjectURL(file));
    fileEl.loop = true;
    const src = ctx.createMediaElementSource(fileEl);
    src.connect(analyser);
    src.connect(ctx.destination); // so you can hear it
    await ctx.resume();
    await fileEl.play();
    state.source = 'file';
  }

  // Average loudness (0..1) of the bins inside a frequency range.
  function bandEnergy([lo, hi]) {
    const hzPerBin = ctx.sampleRate / analyser.fftSize;
    const a = Math.max(1, Math.floor(lo / hzPerBin));
    const b = Math.min(bins.length - 1, Math.ceil(hi / hzPerBin));
    let sum = 0;
    for (let i = a; i <= b; i++) sum += bins[i];
    return sum / ((b - a + 1) * 255);
  }

  // Call once per frame with the time since the last frame, in seconds.
  function update(dt) {
    state.kick = false;
    state.sinceKick += dt;
    if (!analyser || state.source === 'none') return;
    analyser.getByteFrequencyData(bins);

    for (const b in BANDS) {
      const e = bandEnergy(BANDS[b]);
      const g = gain[b];

      // Rule 3, auto-gain: peak jumps up instantly and falls slowly;
      // floor drops instantly and rises slowly.
      g.peak = Math.max(e, approach(g.peak, e, PEAK_FALL, dt), MIN_RANGE);
      g.floor = Math.min(e, approach(g.floor, e, FLOOR_RISE, dt));
      const norm = clamp01((e - g.floor) / Math.max(g.peak - g.floor, MIN_RANGE));
      state.raw[b] = norm;

      // Rule 4, envelope: fast up, slow down.
      const tau = norm > state[b] ? ATTACK : RELEASE[b];
      state[b] = approach(state[b], norm, tau, dt);
    }

    // Kick: the low band jumps well above its own recent average, is
    // loud in absolute terms, and the last kick wasn't too recent.
    // Hysteresis: after a kick the band has to fall back near its average
    // ("re-arm") before another can count, so one long boomy kick drum
    // doesn't fire twice.
    const low = state.raw.low;
    const jump = low - lowAvg;
    if (armed && jump > settings.sensitivity && low > 0.5 && state.sinceKick > settings.cooldown) {
      state.kick = true;
      state.sinceKick = 0;
      armed = false;
    } else if (!armed && jump < settings.sensitivity * 0.4) {
      armed = true;
    }
    lowAvg = approach(lowAvg, low, 0.35, dt);
  }

  return { state, settings, startMic, startFile, update };
}
