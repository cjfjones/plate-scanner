# Development Plan

This document outlines the next steps for progressively building the React Native version of PassingPlates and how we will test each piece.

## 1. Project Bootstrapping
1. Initialize a React Native project with TypeScript:
   ```bash
   npx react-native init PassingPlates --template react-native-template-typescript
   ```
2. Configure Prettier and ESLint.
3. Set up GitHub Actions to run `npm test` and `detox test`.

## 2. Core Features
1. **Camera & Inference**
   - Integrate `react-native-vision-camera` for preview and frame capture.
   - Use native modules to run the FastALPR models via TFLite/Core ML.
   - Write Jest tests for the detection pipeline using sample frames.
2. **Data Storage**
   - Create the SQLite schema defined in `PRD.md` using `react-native-sqlite-storage`.
   - Add repository functions for inserting and querying plates.
   - Cover with Jest unit tests targeting 80% coverage.
3. **Location & Speed**
   - Use `@react-native-community/geolocation` to fetch GPS coordinates.
   - Debounce repeated sightings based on time and distance.
   - Write unit tests for the debouncer logic.
4. **Background Recording**
   - Implement a background service to continue detection with the screen off.
   - Validate on both Android and iOS using manual tests.

## 3. User Interface
1. Basic navigation: camera view, history list, settings.
2. Lock interactions when speed > 0 unless `passengerOverride` is true.
3. Add accessibility labels for all interactive elements.
4. Create Detox end-to-end tests for common user flows.

## 4. Data Export & Privacy
1. Provide an option to export anonymised stats (SHA-256 of plate string -> count) as CSV.
2. Allow users to purge all data or schedule automatic deletion.
3. Add Jest tests for the export format and deletion scheduler.

## 5. Continuous Integration
1. Configure CI to run Jest unit tests and Detox tests on pull requests.
2. Ensure code coverage thresholds are enforced (80% for data layer).

---

These steps should help us iteratively deliver the app while maintaining quality through automated tests.
