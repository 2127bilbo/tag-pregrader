# TAG Pre-Grader v2.0

Mobile web app for pre-grading Pokémon/TCG cards using TAG's grading methodology.

DINGS-based scoring engine calibrated against 6 real TAG DIG reports (grades 5 through Gem Mint 10).

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to vercel.com → Import Project → select your repo
3. Vercel auto-detects Vite — click Deploy
4. Get your `https://your-project.vercel.app` URL
5. Open on any phone — camera, level, everything works over HTTPS

## Local Development

```bash
npm install
npm run dev
```

## Features

- **DINGS-Based Scoring** — Same defect classification TAG uses (Surface/Play Wear, Corner Wear, Edge Wear, Centering)
- **Calibrated Grade Mapping** — Weighted scoring from real TAG DIG data across grades 5-10
- **Live Camera Viewfinder** — Bubble level + card framing guide (requires HTTPS)
- **Surface Vision Modes** — Emboss, Hi-Pass, Edge Detection with transparency slider
- **DINGS Map Schematic** — Card outline with defect markers and Fray/Fill/Angle scores
- **Auto-Crop Defect Previews** — Normal + enhanced side-by-side for every detected DING
- **Post-Capture Validation** — Card detection, fill ratio, aspect ratio check
- **PWA Ready** — Add to home screen for app-like experience

## Architecture

100% client-side — all image processing runs in the browser. No server, no backend, no data leaves the phone. Zero hosting costs on Vercel's free tier.
