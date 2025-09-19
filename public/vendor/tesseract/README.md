# Local OCR assets

This directory is populated at install time by `npm run prepare:ocr`, which copies the
Tesseract.js browser bundle, worker, WASM core, and English language data from the
project's npm dependencies into `public/vendor/tesseract`.

The generated files are intentionally ignored by Git to avoid storing large binary
artifacts in the repository. Run `npm install` (or execute the script manually) to
regenerate them whenever dependencies are updated.

Licensing for these assets follows their upstream packages:

- [`tesseract.js`](https://github.com/naptha/tesseract.js) (Apache-2.0)
- [`tesseract.js-core`](https://github.com/naptha/tesseract.js-core) (Apache-2.0)
- [`@tesseract.js-data/eng`](https://github.com/naptha/tesseract.js/tree/master/docs/tessdata) (Apache-2.0)

Refer to the respective `LICENSE` files within `node_modules` for the complete terms.
