# Verification — 15 October 2026

## Version 0.1.1: English synonyms and readable text

English synonyms now appear above translation/definition in both modes, with 18px text and a 450 × 520 card. The desktop and packaged tests check the computed font size and confirm that all synonyms for the test word fit above the footer without scrolling. Datamuse / WordNet is a dedicated provider, with dictionary/Wiktionary fallback. Legacy cached entries are enriched without re-requesting existing translations/definitions. Unit coverage includes English-only filtering, ordering, provider validation, offline cache, legacy enrichment, fallback and isolated synonym-service failures.

## Executed checks

- `npm run typecheck` — passed with strict TypeScript checks.
- `npm run lint` — passed.
- `npm test` — 46 tests passed. Covers word normalization/rejection, IPC schemas and external source restrictions, structured dictionary/translation parsing, Wiktionary section extraction, transient retry, cache persistence/expiry/eviction, duplicate and offline lookups, partial/complete failures, saved vocabulary, atomic settings persistence and display geometry.
- `npm run build` — C# helper, main/preload bundles and Vite production renderer built successfully.
- `node scripts/live-check.mjs` — real Datamuse English synonyms, Free Dictionary data and Wiktionary Russian translation verified for `consistent`.
- `npm run test:desktop` — applicable checks passed. Actual Electron windows launched, remained above other windows and were non-focusable; English synonyms appeared first at 18px and fit without scrolling; RU/EN switching preserved synonyms; bookmarking/search and restart persistence worked; invalid IPC input was rejected; a real Windows RichTextBox mouse selection produced a lookup; no renderer JavaScript errors were observed. Ctrl+Shift+E and its password-input check were skipped because the user's running previous version occupied the shortcut. These checks passed in version 0.1.0; native selection code is unchanged. The test reports the skip explicitly and still runs the remaining checks.
- `node scripts/yandex-test.mjs` — passed with **default browser accessibility settings** in Yandex Browser 26.8 / Chromium 150. The test used an isolated profile and local HTML page; a native mouse double-click selected `consistent`, and Buddy automatically showed real vocabulary. Existing browser tabs/profile were not used.
- `npm run package` — generated Windows x64 NSIS and portable executables with the original flag icon, without signing.
- `node scripts/packaged-test.mjs` — passed. The packaged Windows executable launched without a dev server, its bundled native helper became ready, Electron sandbox/context isolation were enabled, and real English/Russian vocabulary appeared. This test used a separate local data directory.

## Files to run

- `release/English-Buddy-Portable-0.1.1-x64.exe` — portable launcher.
- `release/English-Buddy-Setup-0.1.1-x64.exe` — installer.
- `release/win-unpacked/English Buddy.exe` — unpacked packaged app, verified directly.

The installer was generated but was not installed into the user's Windows profile during verification. The portable distribution was generated; the unpacked executable is the packaged runtime directly tested by Playwright. No code-signing certificate was used.

## Evidence

- [Desktop results](docs/verification/desktop-test.txt) — executed desktop checks.
- [Yandex results](docs/verification/yandex-test.txt) — browser version and selection result.
- [Packaged runtime results](docs/verification/packaged-test.txt) — packaged checks.
- `artifacts/settings.png`, `flag.png`, `popup-ru.png`, `popup-en.png`, `vocabulary.png` — screenshots from actual app windows with real fetched vocabulary.
- `artifacts/yandex-selection.png` — isolated Yandex test page with the selected word.
- `artifacts/packaged-popup.png` — actual packaged app word card.

Screenshots suitable for publication are preserved in [docs/images](docs/images), including [preferences](docs/images/preferences.png), [Russian popup](docs/images/word-ru.png), [English popup](docs/images/word-en.png), [saved vocabulary](docs/images/vocabulary.png) and the [isolated Yandex page](docs/images/yandex-selection.png). The raw artifacts directory is intentionally not committed.

## Still needs manual verification

ChatGPT for Windows, Word, external PDF readers, Firefox, Edge and Chrome were not individually tested. Website-specific controls and scanned PDFs may not expose selection. Speech output, mixed-DPI physical monitors, Windows startup registration, the installer wizard and SmartScreen interaction require a manual check.

Automatic selection is based on Windows accessibility, not screenshot/OCR recognition. Compatibility is therefore application-specific; the explicit copy fallback is included. See README.md for the concise manual verification checklist and launch instructions.
