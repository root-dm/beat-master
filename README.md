# Beat Master

Beat Master is a standalone prototype for a future Premiere Pro plugin. It analyzes a music track, learns edit timing from manual taps, and generates repeatable cut markers on beat.

## Current MVP

- Import an audio file in the browser.
- Detect a rough BPM and beat grid from the audio envelope.
- Use automated mode to create markers every 2, 4, 8, or 16 bars.
- Use manual mode to tap a few intended edit points and let the engine repeat the pattern.
- Export markers as JSON or CSV.

## Commands

```bash
npm install
npm run dev
npm test
npm run build
```

## Architecture

```text
packages/beat-core
  Portable TypeScript beat analysis, tap learning, marker generation, exports.

apps/studio
  React/Vite standalone studio for fast iteration before Premiere UXP.
```

The goal is to keep `beat-core` independent from Premiere so a later UXP panel can call the same functions and translate generated markers into Premiere sequence markers.

