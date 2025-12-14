# PassingPlates Web

PassingPlates runs entirely in the browser so it can be hosted on GitHub Pages and opened from iOS Safari. The FastALPR stack
is loaded via WebAssembly, all computation stays on-device, and encounter history is persisted locally in the browser.

## Features

- 🔍 **On-device ALPR** – a FastALPR pipeline (YOLOv9-lite detector + MobileViT OCR via `onnxruntime-web`) runs entirely in the
  browser; no server is required.
- 🎥 **Live camera scanning** – request the rear camera, capture frames every few seconds, and highlight detected plates.
- 🖼 **Still image processing** – upload a photo when camera permissions are unavailable.
- 📊 **Local stats** – encounters are aggregated in `localStorage`, can be exported as CSV, and cleared at any time.
- 🌐 **Static hosting** – the project ships as plain HTML/CSS/JS with the OCR engine bundled locally and optional CDN fallbacks, so
  it works on GitHub Pages without installing Node packages.

## Getting Started

No build step is required. Serve the `index.html` file over HTTPS so the browser will grant camera access.

### Running from GitHub on iPhone

You can use the app entirely from GitHub without a local laptop:

- **GitHub Pages (simplest):** fork the repo, enable Pages to serve from the repository root, then open the GitHub Pages URL (HTTPS) in Safari on iOS.
- **Codespaces in mobile Safari:** create a Codespace for the repo, start the dev server with `npm run dev -- --host --port 4173`, and use the forwarded HTTPS port shown in the Ports panel. Open that forwarded URL in a new Safari tab on your iPhone to grant camera access.
- **Direct HTML preview:** even without Node, tap `index.html` in the repository, choose **Raw**, and share the URL to yourself. Opening it directly in Safari works for uploads; live camera access still requires HTTPS hosting (Pages/Codespaces/ngrok).

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
npm run test       # execute the unit test suite once
npm run test:watch # keep Vitest running in watch mode
```

Running `npm install` also copies the Tesseract runtime, English language data,
and ONNX Runtime binaries into the `public/vendor` folder so the app can load
them without relying on third-party CDNs. The FastALPR ONNX models are not
committed to git; provide them manually or configure the download helpers before
running `npm run prepare:alpr`. If you ever need to refresh the local assets
manually, run `npm run prepare:ocr` and `npm run prepare:alpr`.

### FastALPR asset setup

The FastALPR detector and OCR models are several megabytes each, so they are not
stored in the repository. Use one of the following approaches before serving the
app:

1. **Automatic download during install** – set either
   `FASTALPR_ASSET_BASE_URL=https://example.com/fastalpr/` or the individual
   `FASTALPR_DETECTOR_URL` / `FASTALPR_OCR_URL` environment variables, then run
   `npm run prepare:alpr`. The script saves the models into
   `public/vendor/fastalpr/` and copies the ONNX Runtime Web binaries from
   `node_modules`.
2. **Manual placement** – download
   `yolo-v9-t-384-license-plates-end2end.onnx` and
   `global_mobile_vit_v2_ocr.onnx` yourself and place them in
   `public/vendor/fastalpr/` alongside the provided YAML config.
3. **CDN hosting** – host the models externally and expose them via
   `window.fastAlprAssetConfig` before the app scripts load:

   ```html
   <script>
     window.fastAlprAssetConfig = {
       modelBaseUrl: 'https://cdn.example.com/fastalpr/',
       onnxRuntimeBaseUrls: [
         'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
       ],
   };
   </script>
   ```

   You can also provide explicit `detectorModelUrls`, `ocrModelUrls`, or
   `onnxRuntimeScriptUrls` arrays if the models or runtime live at different
   locations. The loader will try each entry in order and fall back to the
   bundled paths if available. When no local ONNX Runtime assets are present,
   the app automatically falls back to the jsDelivr or unpkg CDNs.

The loader reads `public/vendor/fastalpr/manifest.json` and
`public/vendor/onnxruntime/manifest.json` to decide whether bundled assets are
available. Running `npm run prepare:alpr` refreshes those manifests with the
current file metadata; if you publish models elsewhere you can edit the
manifests or set `window.fastAlprAssetConfig` to point at your CDN locations.

On iOS devices you must access the site over HTTPS (GitHub Pages does this automatically). When testing locally with a phone,
use a tool that provides HTTPS tunnelling (for example, `ngrok`) or host the static files from a service that offers HTTPS.

### Deploying to GitHub Pages

1. Commit the repository contents (including `index.html`, `scripts/`, and `styles/`).
2. Push to GitHub and enable **Pages** → **Deploy from branch** (for example, `main` → `/`).
3. Wait for the GitHub Pages build to finish, then visit `https://<user>.github.io/<repo>/` from your desktop or phone.

If you see 404s like `vendor/onnxruntime/manifest.json` or `vendor/fastalpr/*.onnx` in the in-app debug log when running from Pages:

- Make sure you ran `npm run prepare:alpr` locally so `public/vendor/onnxruntime/*` and the manifests exist before pushing.
- Host the FastALPR detector/OCR models somewhere reachable (for example, attach them to a GitHub Release or another HTTPS bucket) because they are not committed to the repo.
- Point the app at those hosted files by defining `window.fastAlprAssetConfig` **before** loading the scripts (you can add this directly in `index.html`):

  ```html
  <script>
    window.fastAlprAssetConfig = {
      // Base URL where you host the FastALPR .onnx models + YAML config
      modelBaseUrl: 'https://cdn.example.com/fastalpr/',
      // Optional: prefer your own ONNX Runtime build if you host it
      onnxRuntimeBaseUrls: ['https://cdn.example.com/onnxruntime/'],
    };
  </script>
  ```

When no FastALPR models are reachable, the app falls back to the bundled Tesseract OCR only (slower and less accurate), so supplying working model URLs is essential for plate detection.

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

- `scripts/fastalpr-engine.js` loads the ONNX detector + OCR models, performs preprocessing/postprocessing, and returns high-confidence UK plate candidates.
- `scripts/recognition-engine.js` orchestrates FastALPR and falls back to the legacy Tesseract worker if the models fail to load.
- `scripts/camera.js` captures frames from `getUserMedia`, throttles recognition, and forwards detections.
- `scripts/store.js` tracks encounter history in `localStorage` and exposes helpers for exporting or clearing data.
- `scripts/main.js` wires the UI, camera controller, store updates, and still image uploads together.

## Browser Support

- Modern Chromium, Firefox, and Safari browsers that support ES modules and `getUserMedia` (iOS 15+).
- Because the ONNX models are several megabytes, the first load may take a few seconds depending on network speed.

## License

MIT
