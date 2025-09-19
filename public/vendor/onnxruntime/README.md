# ONNX Runtime Web assets

The ONNX Runtime Web bundles (`ort.all.min.js` and associated WebAssembly
binaries) are copied into this directory during development via
`npm run prepare:alpr`. They are not committed to git to keep the repository
lightweight. If you are deploying a static build, make sure these files are
present in your published assets or configure the app to load ONNX Runtime from
a CDN as described in the README.
