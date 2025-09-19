# PassingPlates Web

PassingPlates runs entirely in the browser so it can be hosted on GitHub Pages and opened from iOS Safari. The OCR model is
loaded via WebAssembly, all computation stays on-device, and encounter history is persisted locally in the browser.

## Features

- 🔍 **On-device OCR** – [Tesseract.js](https://github.com/naptha/tesseract.js) runs in the browser via WebAssembly; no server is
  required.
- 🎥 **Live camera scanning** – request the rear camera, capture frames every few seconds, and highlight detected plates.
- 🖼 **Still image processing** – upload a photo when camera permissions are unavailable.
- 📊 **Local stats** – encounters are aggregated in `localStorage`, can be exported as CSV, and cleared at any time.
- 🌐 **Static hosting** – the project ships as plain HTML/CSS/JS and loads Tesseract.js from multiple CDNs at runtime so it works on
  GitHub Pages without installing Node packages.

## Getting Started

No build step is required. Serve the `index.html` file over HTTPS so the browser will grant camera access.

### Quick preview

Open the file directly or run a lightweight static server:

```bash
python -m http.server 8000
# then open http://localhost:8000/ in your browser
```

### Development tooling

This repository now includes optional Node-based tooling to help with local development.

```bash
npm install        # install dev dependencies (Vite + Vitest)
npm run dev        # start a local dev server with hot reloading
npm run test:run   # execute the unit test suite once
```

Use `npm test` if you prefer to keep Vitest running in watch mode.

On iOS devices you must access the site over HTTPS (GitHub Pages does this automatically). When testing locally with a phone,
use a tool that provides HTTPS tunnelling (for example, `ngrok`) or host the static files from a service that offers HTTPS.

### Deploying to GitHub Pages

1. Commit the repository contents (including `index.html`, `scripts/`, and `styles/`).
2. Push to GitHub and enable **Pages** → **Deploy from branch** (for example, `main` → `/`).
3. Wait for the GitHub Pages build to finish, then visit `https://<user>.github.io/<repo>/` from your desktop or phone.

The app requests camera access the first time you tap **Start scanning**. If Safari blocks camera access, use the **Process a
still image** workflow.

## Project Structure

```
index.html          # Static entry point referencing all assets
scripts/            # ES module controllers (camera, OCR, state management)
styles/app.css      # Shared styling for the interface
DEV_PLAN.md         # Development notes from the original project
```

## How it works

- `scripts/ocr.js` dynamically loads the Tesseract.js library from multiple CDN mirrors and keeps a single worker alive to process frames.
- `scripts/camera.js` captures frames from `getUserMedia`, throttles recognition, and forwards detections.
- `scripts/store.js` tracks encounter history in `localStorage` and exposes helpers for exporting or clearing data.
- `scripts/main.js` wires the UI, camera controller, store updates, and still image uploads together.

## Browser Support

- Modern Chromium, Firefox, and Safari browsers that support ES modules and `getUserMedia` (iOS 15+).
- Because the OCR model is fairly large, the first load may take a few seconds depending on network speed.

## License

MIT
