# English Buddy

[Download Windows builds](https://github.com/selecteg12/english-buddy/releases/tag/v0.1.1) · [Verification report](VERIFICATION.md) · [License](LICENSE)

Windows 10/11 x64 desktop companion for learning English while reading other apps. Electron + React + TypeScript, with a separate C# UI Automation helper. Current release: **0.1.1**. Interface language: English.

**English synonyms appear first whenever you select a word, in both RU and EN modes.** Translation or definition follows below. See [CHANGELOG.md](CHANGELOG.md) for version 0.1.1.

Synonyms use larger 18 px text and stronger contrast. The popup is 450 × 520, with larger labels, meanings, controls and preferences text.

## Use the app

Download the [portable executable](https://github.com/selecteg12/english-buddy/releases/download/v0.1.1/English-Buddy-Portable-0.1.1-x64.exe) or [installer](https://github.com/selecteg12/english-buddy/releases/download/v0.1.1/English-Buddy-Setup-0.1.1-x64.exe) from GitHub Releases. No Node.js installation is needed to use a packaged build. On first launch, click **Start learning**.

![English definition](docs/images/word-en.png)

![Preferences](docs/images/preferences.png)

1. Highlight one English word in an accessible Windows app; release the mouse button.
2. A vocabulary card appears beside the floating Union Jack. **RU** shows translations, **EN** shows a dictionary definition. The sound button uses a Windows speech voice.
3. Bookmark a word to keep it locally. Open **My vocabulary** from the flag menu or tray to search and remove saved words.
4. Drag the flag to move it. Click it for preferences; right-click for the menu. The tray menu can pause, hide, show, or quit Buddy.

If automatic selection is unavailable, use **Ctrl+Shift+E** to ask UI Automation for the selection. If that also fails, copy one word yourself with Ctrl+C and click **Use copied word** in the popup, preferences, or flag menu. Buddy never generates Ctrl+C, replaces clipboard contents, or reads the clipboard automatically.

The assistant and popup stay above normal windows and appear without requesting keyboard focus. Opening preferences is an explicit user action and brings that window to the foreground. Fullscreen exclusive apps and elevated processes can behave differently.

## Build and develop

Development requires Node.js 24+, npm, Windows x64 and the .NET Framework 4.x C# compiler included with Windows. Runtime helper uses .NET Framework 4.x; .NET SDK installation is unnecessary. Windows 10/11 normally include .NET Framework 4.8.

```powershell
npm ci
node node_modules/electron/install.js
npm run dev
```

Recent Electron npm packages install the JavaScript package separately from the Electron binary, so the explicit install command above is included. Development mode watches renderer/main source; restart the dev command after changing main-process behavior. Native changes require restarting the dev command.

```powershell
npm run check           # TypeScript, ESLint, unit tests
npm run build           # C# helper + production renderer/main/preload
npm start               # Run production source build
npm run test:desktop    # Electron, real network APIs, own Windows test fixture
node scripts/live-check.mjs
node scripts/yandex-test.mjs  # Installed Yandex, isolated test profile
npm run package         # Windows x64 NSIS installer and portable exe
```

Tests may briefly show isolated windows to verify native selections. Yandex testing uses a new profile under `artifacts`; it does not use existing tabs, cookies or account sessions. Test artifacts and screenshots are also under `artifacts`. The optional native diagnostic script reads only service metadata and validated single words; it is not part of normal startup.

## Architecture

- `src/main`: Electron lifecycle, three isolated windows, tray, shortcut, validated IPC, helper supervision. No renderer receives Node or unrestricted IPC access.
- `src/preload`: explicit application actions and removable state subscriptions.
- `src/renderer`: animated original SVG flag, word card, English preferences, saved vocabulary.
- `src/native/windows/SelectionHelper.cs`: low-level mouse-release event, 180 ms debounce, UI Automation TextPattern on an MTA worker, protected input checks, explicit shortcut requests and local speech.
- `src/services`: provider interfaces, structured response validation, timeout/retry, per-word concurrent deduplication, 20 new lookups/minute, at most 3 concurrent vocabulary lookups, 500-word cache with 7-day expiry.
- `src/storage`: validated local settings and saved words, atomic replacement writes, preservation of damaged data files.
- `src/shared`: schemas, single-word validation, screen geometry.
- `tests`: validation, providers, cache, errors, settings and saved vocabulary.

The native helper reads selection after a mouse drag or double-click; it does not poll screen text or re-read after ordinary single clicks. A stuck accessibility call causes the separate helper process to restart, with at most 3 failures per minute. Exiting Buddy terminates the helper. There is no telemetry, account, cloud vocabulary sync, screenshot monitoring, or OCR.

## Data and privacy

Legacy cached entries are enriched with English synonyms on their next online lookup. Existing definitions/translations are reused, and saved vocabulary is preserved. Close the old version through the tray before opening the new executable; use the same `--buddy-data` directory if one was specified.

Normal app data is in `%APPDATA%\english-buddy`: `buddy.json` (preferences and saved vocabulary) and `cache.json` (lookup cache). To use another data directory, including with a portable build, launch with `--buddy-data="C:\path\to\data"`. Data is local JSON, without encryption. Saved vocabulary remains available in the list without a network connection. Cached complete lookups work with **Online vocabulary** disabled. Clearing the lookup cache leaves saved words intact.

The online services receive only a word validated as 1–64 ASCII letters, optionally separated by apostrophes or hyphens. Phrases, email addresses, numbers, non-English selections and password fields identified by UI Automation are ignored. No selected text is logged by the normal application. Providers naturally receive the network IP address.

Autostart is off by default and can be enabled in a packaged build. Hiding Buddy also pauses automatic selection reading until it is shown again. Exit from the tray to stop the app completely.

## Vocabulary sources and licensing

- [Datamuse API](https://www.datamuse.com/api/): dedicated English WordNet synonyms via `rel_syn`, ordered using frequency metadata. Only a validated word is sent. Attribution appears on the card. The provider has announced that access may require a key in 2027; dictionary synonyms remain a fallback. Its documentation describes a temporary query log discarded at the end of the day.

- [Free Dictionary API](https://dictionaryapi.dev/): real English definitions, part of speech, phonetics, examples and synonyms. Its response-provided license is linked on the card, often [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The word's Wiktionary page is linked for attribution/history.
- [Wiktionary](https://en.wiktionary.org/): primary Russian translations and synonym templates from the English section, via the [MediaWiki revisions API](https://www.mediawiki.org/wiki/API:Revisions). Current text is used under [CC BY-SA 4.0](https://en.wiktionary.org/wiki/Wiktionary:Copyrights); the source entry is linked on each card. Stress marks are removed, and translation terms are joined with semicolons.
- [MyMemory](https://mymemory.translated.net/): translation fallback when a Russian Wiktionary entry is missing or cannot be parsed. See its [API specification](https://mymemory.translated.net/doc/spec.php), [usage limits](https://mymemory.translated.net/doc/usagelimits.php) and [terms](https://mymemory.translated.net/doc/en/tos.php). No invented API key, email address, or paid service is used. Quota failures are reported.

Dictionary text and translations remain under their source licenses; the app's own MIT license does not replace those licenses. Providers can contain mistakes. Words may have several meanings; Russian translations and synonyms can span those meanings, while the card shows one English definition. Definitions are actual dictionary entries, without AI simplification. If a field is unavailable, the card says so; no made-up data is substituted. Partial results are usable but not cached as complete entries.

The flag and app icon are drawn locally from geometric shapes. Pronunciation uses the installed Windows voice; an English voice is recommended. No remote audio download is required.

## Selection compatibility and limits

UI Automation cannot read every visible selection. Support depends on the application's accessibility provider. It does not extract text from images or scanned PDFs, and it cannot generally access higher-privilege windows. A mouse release is the automatic trigger; keyboard-only highlighting can be read with the shortcut. Dragging and popup placement use Electron display coordinates; native selection uses per-monitor-aware screen coordinates. Multiple-monitor positioning is covered by geometry tests; physical mixed-DPI monitor testing still needs user verification.

Executed compatibility results are recorded in `artifacts/desktop-test.txt` and `artifacts/yandex-test.txt`; see `VERIFICATION.md`. Automatic selection was verified in Yandex Browser 26.8 (Chromium 150) on an isolated local HTML page with default accessibility settings, and in a Windows RichTextBox. This does not guarantee every website, PDF, or browser document. ChatGPT for Windows still needs a manual check with a selected word. Chrome, Edge, Firefox, Word and external PDF readers were not individually verified in this environment. No universal compatibility claim is made.

## Manual checks

1. In Yandex Browser and ChatGPT for Windows, highlight a word such as `consistent`; wait for its card. Try mouse dragging and double-clicking.
2. Ensure typing remains focused in the source app, even when Buddy appears. Switch RU/EN and bookmark a word.
3. If no card appears, try Ctrl+Shift+E; if necessary, manually copy the word and click Use copied word.
4. Pause selection watching, select again, then resume. Select a phrase, a number or a password: no vocabulary request should be generated.
5. Restart Buddy and verify mode, position and saved vocabulary. Search and delete a saved word.
6. Drag Buddy to each monitor and screen edge; verify flag/card stay inside the work area at different DPI settings.
7. Change popup timeout, animation and startup. Hide/show via tray; quit and confirm the helper exits.

Unsigned MVP builds may receive a Windows SmartScreen prompt. No certificate or system security setting is changed by the build.
