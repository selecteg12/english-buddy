# Verification — 15 October 2026

## Version 0.1.2: Progressive lookups and VPN/proxy routing

Each field is displayed when ready. English definitions use a real Wiktionary fallback, and translations use an early MyMemory fallback. Each endpoint has a four-second total deadline; fallback requests begin after 350 ms if needed. Requests use Electron's Chromium networking with Windows proxy support. Healthy cached fields survive provider failures, and later lookups retry missing fields. The 18px synonyms and 450 × 520 card remain.

## Executed checks

- `npm run typecheck` — passed with strict TypeScript checks.
- `npm run lint` — passed.
- `npm test` — 60 tests passed. Covers word validation, IPC, providers, HTML-to-text definition parsing, deadlines, early fallbacks, progressive updates, duplicate subscriptions, partial cache repair, offline lookups, settings, saved vocabulary and display geometry.
- `npm run build` — C# helper, main/preload bundles and Vite production renderer built successfully.
- `node scripts/live-check.mjs` — real English definitions with fallback, Datamuse synonyms and Russian translations are checked for `consistent`.
- `node scripts/resilience-test.mjs` — passed. In an isolated Electron session, the primary dictionary was deliberately blocked, the English fallback was delayed by 1,800 ms, and real HTTPS requests were tunneled through an HTTP CONNECT proxy with normal certificate verification. The Russian translation appeared after 739 ms while the English definition was still loading; the real Wiktionary definition appeared after 2,083 ms. Switching to EN during loading showed a field-specific loading state and then the actual definition. These measurements apply to this test run, not every VPN configuration.
- `npm run test:desktop` — applicable checks passed. Actual Electron windows launched, remained above other windows and were non-focusable; English synonyms appeared first at 18px and fit without scrolling; RU/EN switching preserved synonyms; bookmarking/search and restart persistence worked; invalid IPC input was rejected; a real Windows RichTextBox mouse selection produced a lookup; no renderer JavaScript errors were observed. Ctrl+Shift+E and its password-input check were skipped because another running application instance occupied the shortcut. The test reports the skip explicitly and still runs the remaining checks.
- `node scripts/yandex-test.mjs` — passed with **default browser accessibility settings** in Yandex Browser 26.8 / Chromium 150. The test used an isolated profile and local HTML page; a native mouse double-click selected `consistent`, and Buddy automatically showed real vocabulary. Existing browser tabs/profile were not used.
- `npm run package` — generated Windows x64 NSIS and portable executables with the original flag icon, without signing.
- `node scripts/packaged-test.mjs` — passed. The packaged Windows executable launched without a dev server, its bundled native helper became ready, Electron sandbox/context isolation were enabled, and real English/Russian vocabulary appeared. This test used a separate local data directory.
- `node scripts/resilience-test.mjs --packaged` — passed with the actual packaged runtime. Through the isolated HTTP CONNECT proxy, Russian translation was visible after 1,112 ms while the English definition was still pending. The deliberately delayed, real Wiktionary definition appeared after 2,361 ms with the primary dictionary blocked.

## Files to run

- `release/English-Buddy-Portable-0.1.2-x64.exe` — portable launcher.
- `release/English-Buddy-Setup-0.1.2-x64.exe` — installer.
- `release/win-unpacked/English Buddy.exe` — unpacked packaged app, verified directly.

The installer was generated but was not installed into the user's Windows profile during verification. The portable distribution was generated; the unpacked executable is the packaged runtime directly tested by Playwright. No code-signing certificate was used.

## Evidence

- [Desktop results](docs/verification/desktop-test.txt) — executed desktop checks.
- [Yandex results](docs/verification/yandex-test.txt) — browser version and selection result.
- [Packaged runtime results](docs/verification/packaged-test.txt) — packaged checks.
- [Resilience and proxy results](docs/verification/resilience-test.txt) — blocked dictionary, early translation, English fallback and proxy checks.
- [Packaged resilience results](docs/verification/packaged-resilience-test.txt) — the same checks against the actual packaged runtime.
- `artifacts/settings.png`, `flag.png`, `popup-ru.png`, `popup-en.png`, `vocabulary.png` — screenshots from actual app windows with real fetched vocabulary.
- `artifacts/yandex-selection.png` — isolated Yandex test page with the selected word.
- `artifacts/packaged-popup.png` — actual packaged app word card.

Screenshots suitable for publication are preserved in [docs/images](docs/images), including [preferences](docs/images/preferences.png), [Russian popup](docs/images/word-ru.png), [English popup](docs/images/word-en.png), [saved vocabulary](docs/images/vocabulary.png) and the [isolated Yandex page](docs/images/yandex-selection.png). The raw artifacts directory is intentionally not committed.

## Still needs manual verification

ChatGPT for Windows, Word, external PDF readers, Firefox, Edge and Chrome were not individually tested. Website-specific controls and scanned PDFs may not expose selection. Speech output, mixed-DPI physical monitors, Windows startup registration, the installer wizard and SmartScreen interaction require a manual check.

The automated proxy check verifies routing through a local HTTP CONNECT proxy. It does not switch, configure or certify a specific VLESS/Hysteria client or the user's routing rules.

Automatic selection is based on Windows accessibility, not screenshot/OCR recognition. Compatibility is therefore application-specific; the explicit copy fallback is included. See README.md for the concise manual verification checklist and launch instructions.
