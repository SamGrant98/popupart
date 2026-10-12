// The audio meter: what the app is hearing, at a glance.
// Styled as the first window of the made-up retro OS ("audio.exe").
// Toggle with M. Click "mic" to listen, or drop an mp3 anywhere.
//
// Each band shows:
//   a solid bar   the smoothed value (what visuals will use)
//   a thin tick   the raw auto-gained value (jumpy, for comparison)
// The light at the right flashes orange on every detected kick.

export function createMeter(audio) {
  const el = document.createElement('section');
  el.className = 'win meter';
  el.innerHTML = `
    <header class="win__bar">
      <span class="win__title">audio.exe</span>
      <button class="win__close" type="button" aria-label="Hide meter (M)">×</button>
    </header>
    <div class="meter__body">
      <canvas width="220" height="96"></canvas>
      <div class="meter__row">
        <button class="win__btn" type="button" data-mic>mic</button>
        <span class="meter__hint">or drop an mp3 · <kbd>M</kbd> hide</span>
      </div>
      <p class="meter__status" aria-live="polite">no input</p>
    </div>`;
  document.body.append(el);

  const canvas = el.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const status = el.querySelector('.meter__status');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = 220 * dpr;
  canvas.height = 96 * dpr;
  canvas.style.width = '220px';
  canvas.style.height = '96px';

  // ---- Input ----
  el.querySelector('[data-mic]').addEventListener('click', () => {
    audio.startMic().then(() => (status.textContent = 'listening: mic'))
      .catch((e) => (status.textContent = `mic blocked: ${e.name}`));
  });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('audio/'));
    if (!file) return;
    audio.startFile(file).then(() => (status.textContent = `playing: ${file.name}`));
  });

  // ---- Show / hide ----
  const toggle = () => el.toggleAttribute('hidden');
  el.querySelector('.win__close').addEventListener('click', toggle);
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm' && !e.repeat) toggle();
  });

  // ---- Drawing ----
  const COLORS = { low: '#A274FF', mid: '#00A456', high: '#3CC8FF' }; // sound, movement, space
  let flash = 0; // kick light brightness, 0..1

  function draw(dt) {
    if (el.hidden) return;
    const s = audio.state;
    const w = 220, h = 96;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Three bars.
    const barW = 44, gap = 16, x0 = 8;
    ['low', 'mid', 'high'].forEach((b, i) => {
      const x = x0 + i * (barW + gap);
      ctx.fillStyle = '#26262b';
      ctx.fillRect(x, 8, barW, h - 28);
      const v = s[b] * (h - 28);
      ctx.fillStyle = COLORS[b];
      ctx.fillRect(x, 8 + (h - 28) - v, barW, v);
      // raw value tick
      const r = 8 + (h - 28) - s.raw[b] * (h - 28);
      ctx.fillStyle = '#f3f2ee';
      ctx.fillRect(x, r, barW, 1.5);
      // label
      ctx.fillStyle = '#9c9b97';
      ctx.font = '10px "Martian Mono", ui-monospace, monospace';
      ctx.fillText(b, x, h - 6);
    });

    // Kick light: full on a kick, fades over ~0.25s.
    if (s.kick) flash = 1;
    flash = Math.max(0, flash - dt * 4);
    const lx = x0 + 3 * (barW + gap) - 4, ly = 30;
    ctx.beginPath();
    ctx.arc(lx, ly, 9, 0, Math.PI * 2);
    ctx.fillStyle = flash > 0.01 ? `rgba(255,102,1,${0.25 + 0.75 * flash})` : '#26262b';
    ctx.fill();
    ctx.fillStyle = '#9c9b97';
    ctx.fillText('kick', lx - 13, h - 6);
  }

  return { draw };
}
