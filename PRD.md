# Product Requirements Document (PRD) — PassingPlates v0.9

*(Codex-ready edition)*

> **One-liner:** "How often do you really cross paths with the same cars?" PassingPlates runs fully on-device, recognises licence plates while you drive, and shows repeat-encounter stats — no cloud, no distraction.

---

## 1 • Problem Statement

Every commuter experiences déjà vu: the same red Golf, the same white van. Today there are only **ALPR enforcement tools** or **manual road-trip games**; neither quantifies those repeats in a privacy-respecting, driver-friendly way. PassingPlates delivers that single metric while purposely *not* acting as surveillance or enforcement.

*Scope* (v1):

* **Region:** UK & EU standard plates (white/yellow reflective plates, ANSI 1366‑1 fonts).
* **Passengers’ privacy:** No face detection; raw frames discarded immediately after inference.

---

## 2 • Goals & Success Metrics

| Goal                      | Metric                                        | Target                                          |
| ------------------------- | --------------------------------------------- | ----------------------------------------------- |
| **Detection performance** | Median detector + OCR latency per frame       | ≤ 45 ms on Pixel 7 / iPhone 13                  |
| **Detection accuracy**    | Plate present → plate string correct          | ≥ 98 % daylight; ≥ 90 % night/rain              |
| **Identity accuracy**     | Same plate counted exactly once per encounter | ≥ 95 % (measured vs GPS‑timestamp ground truth) |
| **Cold start**            | App launch → first detection                  | ≤ 2 s                                           |
| **Battery impact**        | Battery drop per hour with screen on, nav on  | ≤ 8 % on Pixel 7 (4 h drive test)               |
| **Privacy**               | % raw images leaving device                   | 0 %                                             |
| **Accessibility**         | Screen‑reader labels coverage                 | 100 % interactive elements                      |

---

## 3 • Non‑Goals

* Issuing fines, reporting to authorities, real‑time vehicle lookup.
* Continuous cloud video backup.
* Multi‑camera dash‑cam integration (deferred).

---

## 4 • Competitive Landscape (May 2025)

| Product                  | Target user        | Key functions             | Why PassingPlates is different                                    |
| ------------------------ | ------------------ | ------------------------- | ----------------------------------------------------------------- |
| **Mobile LPR** (Android) | Security / parking | Live ALPR, geo‑log CSV    | No friendly stats, enterprise UX, sends data to server by default |
| **Vert ALPR** (iOS)      | Parking enforcers  | History, allow/deny lists | Account required, enforcement UI                                  |
| **OpenALPR Demo** (OSS)  | Dev sample         | Raw detections            | Not packaged, no trip stats                                       |

Opportunity: deliver *consumer* UI, strict local‑only policy, hands‑free UX.

---

## 5 • Personas & Scenarios

1. **Commuter‑Driver Chris** starts car, app auto‑detects motion, records silently, later sees “You passed BJ21 ABC 7 times this week”.
2. **Data‑conscious Dana** enables daily auto‑erase, exports anonymised weekly stats (SHA‑256 plate hash → count) for personal data science.
3. **QA‑Tester Alex** runs scripted dash‑cam clips in the simulator and verifies precision metrics with an included Python notebook.

---

## 6 • User Stories

* *US‑01*: *As a driver* I want detection to auto‑start when speed > 5 mph so I never tap the screen while driving.
* *US‑02*: *As a user* I can open “History” to view per‑trip and per‑day counts of recurring vs unique plates.
* *US‑03*: *As a user* I can purge all data or schedule automatic deletion after N days.
* *US‑04*: *As a user* I can report a false positive; the image crop is stored locally and shown to me only.
* *US‑05*: *As a researcher* I can opt‑in to export anonymised plate‑hash counts as CSV.

---

## 7 • Functional Requirements

| ID        | Requirement                                                                              | Acceptance Test                                |
| --------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **FR‑01** | Camera preview initialises in ≤ 1 s                                                      | Measured via Stopwatch API in dev build        |
| **FR‑02** | On‑device model detects plates & returns OCR string                                      | Unit test passes with synthetic plate images   |
| **FR‑03** | Plates stored in SQLite schema below                                                     | Insert, update, query unit tests               |
| **FR‑04** | Debounce: repeat sighting increments count only if last\_seen > 10 s OR distance > 100 m | Simulated timestamp/GPS test                   |
| **FR‑05** | Background service continues with screen off                                             | Manual test: 30 min drive screen‑off logs data |
| **FR‑06** | UI locks when speed > 0 unless passengerOverride == true                                 | Manual test toggling setting while moving      |
| **FR‑07** | Feedback button stores cropped ROI in `/Feedback/` sandbox dir                           | Check file exists after tap                    |

**SQLite DDL**

```sql
CREATE TABLE plates (
  plate TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  count INTEGER NOT NULL,
  last_lat REAL,
  last_lon REAL
);
```

---

## 8 • Non‑Functional Requirements

* **Performance:** Maintain ≥ 25 FPS preview even during inference.
* **Battery:** ≤ 8 %/h Pixel 7, ≤ 10 %/h iPhone 13 on 4 h loop.
* **Accessibility:** VoiceOver/TalkBack labels, high‑contrast mode tested.
* **Offline‑first:** All core flows work in airplane mode.
* **Privacy:** DPIA on file; raw frames discarded; export uses SHA‑256 hashes.

---

## 9 • Technical Approach

### 9.1 Stack

* **Flutter 3.22+** (null‑safe Dart 3.x) cross‑platform.
* Plugins: `camera`, `flutter_isolate`, `sqflite`, `geolocator`, `riverpod`, `crypto`.
* **FastALPR** ONNX models → TFLite (Android, NNAPI), Core ML (iOS, BNNS). Input size 640×384.
* Hardware acceleration delegates configured via `tflite_flutter_delegate` and `coreml` backend.

### 9.2 Processing Flow

```mermaid
graph LR
A[CameraX/AVCapture 640p] -->|2 fps| B[YOLOv9‑lite detector]
B -->|Crop| C[ViT‑mobile OCR]
C --> D[Debounce & dedup (10 s/100 m)]
D --> E[SQLite upsert]
E --> F[Stats Stream → UI]
```

### 9.3 Testing & Validation

| Layer   | Tool                                     | Goal                                  |
| ------- | ---------------------------------------- | ------------------------------------- |
| Model   | Python notebook + OpenCV                 | Precision/recall on labelled clip set |
| App     | Flutter integration tests                | Cold‑start latency, DB ops            |
| Battery | Android Batterystats / Xcode instruments | Verify drain threshold                |

---

## 10 • Risks & Mitigations

| Risk                              | Impact        | Likelihood | Mitigation                                          |
| --------------------------------- | ------------- | ---------- | --------------------------------------------------- |
| **False positives at night**      | Stats skew    | Med        | Low‑light finetune, confidence filter               |
| **Regulatory scrutiny**           | Legal         | Low        | Publish DPIA, privacy‑first design                  |
| **Model drift** (new fonts)       | Accuracy drop | Low        | Quarterly data refresh & retrain pipeline           |
| **Battery drain on older phones** | UX            | Med        | “Eco” mode (1 fps) prompt for devices < A12 / SD845 |

---

## 11 • Roadmap & Timeline

| Phase                    | Length | Key Deliverables                                             |
| ------------------------ | ------ | ------------------------------------------------------------ |
| **Prototype**            | 2 wks  | Desktop FastALPR PoC, detection metrics report               |
| **MVP**                  | 4 wks  | Flutter app, on‑device inference, local DB, basic stats view |
| **Validation & Testing** | 2 wks  | Closed beta, TestFlight & Play internal                      |
| **Open Beta**            | 2 wks  | Public TestFlight/Play, telemetry (opt‑in)                   |
| **v1.0 GA**              | 2 wks  | Store launch, marketing site, privacy audit                  |

---

## 12 • Open Questions

1. Need CarPlay/Android Auto projection? (affects UI constraints)
2. Should we gamify (e.g., share streak of encountering same plate)?
3. Multi‑region plate formats roadmap (US, AU, etc.).

---

## 13 • Cursor / Codex Rules (`.cursor/rules/passingplates.mdc`)

```md
# Cursor Rules — PassingPlates

## Tech
- Flutter (Dart) only. Target minSdk 33 (Android 13) & iOS 15.
- Mandatory packages: camera, flutter_isolate, sqflite, geolocator, riverpod, crypto.

## Architecture
- Clean Architecture layers: Presentation → Domain → Data.
- ViewModels expose `AsyncValue<T>` via Riverpod.
- Use Freezed for immutable domain models.

## Code Style
- Use `dart format` defaults.
- Doc comments (`///`) on all public classes & methods.
- TODOs in `// TODO(username): …` format.
- Unit test files named `*_test.dart`; coverage ≥ 80 % for Data layer.

## Performance Guidelines
- Downscale input to max 640 px long edge.
- Process ≤ 2 frames per second by default; adjustable in settings.
- Offload inference to separate Isolate; never block UI thread.

## Privacy & Safety
- Never persist raw JPEGs. Plate strings only in SQLite.
- Hash with `sha256` before any voluntary export.
- Lock UI when speed > 0 km/h unless `passengerOverride` is enabled.
```

---

## 14 • Dev Onboarding (Codex-friendly snippet)

```bash
# Clone & run
flutter pub get
flutter run -d ios
# Run tests
flutter test --coverage
```

Codex prompts live in `/prompts/*.md` and follow pattern:

```md
## Intent
Short imperative – e.g. “Add debouncer to ALPRService”.
## Context
Links to PRD section + current file path.
## Constraints
Rules excerpt.
```

---

**End of PRD v0.9**
