# popupart · project brief

**One line:** an empty desktop where retro popups keep opening over wherever you are, each one showing a bit of you (camera, dots or ASCII), in time with the music.

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
1. **Audio + meter.** Nothing reacts yet; tune it with real music until the kick light is reliable. (done)
2. **Windows v1.** Spring windows on camera crops. (done, being replaced)
3. **Tracking v1.** Face detector + hand landmarker. (done, being replaced by segmentation)

### Redesign (agreed after the first pass)
The main screen is the desktop, never the full camera feed. You only exist inside the popups.
- **R1. Segmentation.** MediaPipe multiclass selfie segmenter: background, hair, body skin (hands), face, clothes. (done)
- **R4. Desktop.** madebysam dark dot grid as the background. (done)
- **R2. Pop in / pop out.** 40 to 60 windows that open and close over where you are (no travelling). Spawn points picked from the mask: face, hands and arms, and a little torso. Sleeved arms count as clothes; if they need their own share, add MediaPipe pose later. Scale in, live a while, scale out.
- **R3. Render modes.** Each window shows you as camera cutout (via the mask), halftone dots or ASCII. Roughly 50 / 30 / 20. Name follows mode: `cam_07.exe`, `dots_12.exe`, `ascii_03.txt`.
- **R5. Audio to popups.** Kick: burst of new windows. Low: window size. High: glitch / ASCII flicker. One master reactivity, F to freeze, an enable-sound prompt.
- **R6. Controls.** Presets, panel, keyboard; performer mode.
- **R7. Into the lab.** madebysam lab shell, project page, screenshot.

## Setup notes
- `npm install` also copies the MediaPipe engine into `public/mediapipe/` (postinstall, gitignored).
- Model file goes in `public/models/` (committed): `selfie_multiclass_256x256.tflite`.
- Debug keys: M audio meter, S segmentation.

## Status
- [x] Mirrored, cover-fitted camera feed
- [x] 1. Audio + meter (src/audio.js, src/meter.js). Tested with generated tracks in test-audio/: 120bpm simple 43/42 kicks; 128bpm club mix (held sub bass, snare, room noise, kickless breakdown) median gap 0.468s, no double triggers.
- [x] 2. Windows (src/windows.js): 18 retro-OS frames as camera portals, spring physics, crowd around the mouse for now. 60fps in testing.
- [x] 3. Tracking (src/tracking.js): MediaPipe face detector + hand landmarker, ~60% windows on the face, ~20% per hand, hands fall back to the face, mouse fallback. Logic tested with simulated detections; needs a real-camera test once the model files are in public/models/.
- [x] R1. Segmentation (src/segment.js): label map at 160px wide, S shows it tinted over the desktop. Needs the model file.
- [x] R4. Desktop background (24px dot grid), camera feed no longer drawn full screen.
- [x] R2. Pop in / pop out (src/windows.js): 70 slots loop wait > in > hold > out (life 0.5 to 1.4s, pop in 0.1s). A popup closes early once you've left the spot under it for 0.08s; after a big move the crowd catches up in about 0.3s. Spots picked from the segmentation map, weighted face 45 / hands and bare arms 35 / torso and sleeves 20 (torso popups smaller). Mouse fallback until the model loads. Springs and the face/hand tracker removed. 60fps in testing.
- [ ] R3. Render modes
- [ ] R5. Audio to popups
