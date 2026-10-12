# popupart · project brief

**One line:** your webcam, broken into little windows that crowd around you and move with the music.

Lab project for madebysam.dev (category: Play). Vite, vanilla JS, canvas 2D. Inspired by the "segcam" effect (@lo.fi.sci.fi via a dj_dave reel), rebuilt for the browser.

## Decisions
- **Audience:** visitors first (works the moment you allow the camera, good defaults), with a hidden performer mode for house parties on the projector (keyboard shortcuts, full control panel).
- **Audio in:** laptop mic by default; drag in an mp3 for a clean signal and for tuning.
- **Look:** a made-up retro OS in the madebysam brand. Orange title bars, Martian Mono window names (`cam_03.exe`), chunky pixel-sharp ink frames, a fake close box, the odd window in a category colour.
- **Controllable over clever:** every sound drives one or two things, each with its own amount, under one master "reactivity". Freeze key. Tap tempo as a fallback.

## Why audio usually misbehaves, and the rules here
1. **Auto-gain:** each band is measured against its own recent peak, so it reads 0 to 1 at any volume.
2. **Three bands only:** low, mid, high. Never raw FFT bins.
3. **Envelopes:** fast attack, slow release. Smooth, not flickery.
4. **Kick detection:** low band jumping well above its recent average, with a cooldown.
5. **Always visible:** a meter (M) shows what it hears before anything is driven by it.

## Build order
1. **Audio + meter.** Nothing reacts yet; tune it with real music until the kick light is reliable.
2. **Windows.** Retro-OS frames showing crops of the camera, on springs (glide, never snap).
3. **Tracking.** MediaPipe face + hands give the targets the windows crowd around.
4. **Audio to windows.** kick: windows jolt · low: window size · high: glitch.
5. **Controls.** Presets, panel, keyboard; performer mode.
6. **Into the lab.** madebysam lab shell, project page, screenshot.

## Status
- [x] Mirrored, cover-fitted camera feed
- [x] 1. Audio + meter (src/audio.js, src/meter.js). Tested with generated tracks in test-audio/: 120bpm simple 43/42 kicks; 128bpm club mix (held sub bass, snare, room noise, kickless breakdown) median gap 0.468s, no double triggers.
- [x] 2. Windows (src/windows.js): 18 retro-OS frames as camera portals, spring physics, crowd around the mouse for now. 60fps in testing.
- [ ] 3. Tracking (MediaPipe face + hands as targets)
