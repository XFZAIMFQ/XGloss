<div align="center">
  <img src="public/icon/logo.svg" width="72" height="72" alt="XGloss Logo" />
  <h1>XGloss</h1>
  <p>
    <strong>Local-first vocabulary learning for the web.</strong><br />
    Look up words in context, collect example sentences, and track mastery across websites.
  </p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
    <img src="https://img.shields.io/badge/Platform-Chrome%20%7C%20Edge%20MV3-18181b" alt="Chrome / Edge MV3" />
    <img src="https://img.shields.io/badge/Stack-Vue%203%20%2B%20TypeScript-41b883" alt="Vue 3 + TypeScript" />
    <img src="https://img.shields.io/badge/Node.js-%3E%3D%2024-339933" alt="Node.js >= 24" />
  </p>
  <p>
    <strong>English</strong> | <a href="README.zh-CN.md">简体中文</a>
  </p>
</div>

---

## Features

- **Per-Site Web Analysis**: Toggle reading analysis per hostname with instant teardown and restoration across tabs.
- **Spotlight Highlighting**: Viewport-scoped CSS Custom Highlight API highlighting (`5,000` active range cap) synchronized in real time across open web tabs.
- **Floating Reading Panel**: Displays reading coverage percentage, frequency-ranked unknown words, estimated coverage gain per word, manual batch refresh, and a **Recall Mode** that hides candidate glosses until revealed.
- **Flexible Selection Trigger (`Auto` / `Icon` / `Off`)**: Switch directly from the extension toolbar popup between instant popup translation, a compact `26x26` selection trigger icon, or selection-off (panel lookups remain active).
- **Multi-Language Collections & Library Management**: Organize vocabulary across 8 languages (`EN`, `JA`, `KO`, `DE`, `FR`, `ES`, `RU`, `IT`), create/edit/pin/delete collections (choosing to migrate words to another collection or delete them together), sort words by time/name/mastery level, bulk-delete words via right-side checkboxes, and pick an active collection in the popup (unidirectionally syncing the default source language).
- **Multi-Profile OpenAI-Compatible Translation**:
    - Create, switch, and test multiple **OpenAI-compatible Chat Completions** providers (DeepSeek preset, OpenAI, or local `http://localhost` models without an API key) from card profiles in Settings.
    - Returns up to 5 context-ranked meanings for words/phrases (preserving chosen meanings per encounter) and full translations for sentences/passages.
    - Includes a compact per-card bottom-right language switcher on `WordCard` for one-off `source -> target` overrides without modifying global defaults.
- **Optional Cloud & External Wordbook Sync**:
    - **Google Drive Sync (`appDataFolder`)**: Free, zero-backend sync storing merged JSON v2 backups privately in your own Google Drive hidden app data folder via OAuth (`chrome.identity.launchWebAuthFlow`).
    - **External Wordbooks (Eudic & MaiMemo)**: Multi-profile external wordbook accounts in Settings with per-collection binding in Library, manual append-only sync, opt-in auto-sync for new learning words, and configurable keep/remove behavior when mastering a word.
- **Structured Review & GitHub-Style Activity Heatmap**:
    - Three review modes (`Flashcards`, `Meaning -> Word`, and `Spelling`) filtered by collection and session size (`10` / `20` / `50`).
    - Inline 4-grade `Learning` (`1-4`), `Known`, and `Ignored` controls, plus a 1-year calendar heatmap tracking daily added, rated, and reviewed words.
- **Local-First Privacy**: Vocabulary, encounters, and translation caches live in extension-origin IndexedDB; API keys stay restricted to `TRUSTED_CONTEXTS` storage and are only exposed to the Options page.

## Getting Started

### Prerequisites

- Node.js `>= 24` and `npm`
- Chromium-based browser (Chrome or Microsoft Edge, Manifest V3)

### Build & Load the Extension

```powershell
npm ci
npm run build
```

1. Open `chrome://extensions` in Chrome (or `edge://extensions` in Edge).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the generated `.output/chrome-mv3` directory.
4. Click the XGloss toolbar icon on any webpage to toggle site analysis, adjust selection trigger mode (`Auto` / `Icon` / `Off`), pick your active collection / translation direction, or open your **Library** and **Translation Settings**.

## Translation Configuration

Open **Translation Settings** (`options.html`) from the sidebar or popup gear icon:

1. Click **Use DeepSeek Preset** (or enter any OpenAI-compatible provider details):
    - **Base URL**: API root such as `https://api.deepseek.com` or `https://your-provider.example/v1` (local services can use `http://localhost:<port>/v1`).
    - **API Key**: Stored in extension-restricted storage; leave empty for unauthenticated local models.
    - **Model**: Model ID supported by your provider.
    - **Target Language** & **Timeout (ms)**: Defaults to Simplified Chinese (`30000 ms`).
2. Click **Save & Authorize** to grant host permission for the API origin, and optionally **Test Contextual Translation**.

XGloss sends `POST {baseUrl}/chat/completions` with `model`, `temperature: 0.1`, `messages`, and `stream: false`, expecting JSON in `choices[0].message.content`. Both `WordCard` and `ReadingPanel` share an IndexedDB translation cache (`version: 4` keyed by configuration, source/target languages, selection text, and sentence context).

## Data & Backup

- **Library Page (`library.html`)**: Manage collections (create, edit, pin), search/filter words, inspect historical encounters and contexts, edit custom meanings, and adjust ratings inline.
- **JSON v2 Export / Import**: Preserves collections, words, saved meanings, encounter contexts, and learning activities; imports merge while keeping newer word states and unioning history. Backward compatible with JSON v1 backups.
- **CSV Import / Export**: Supports native `word,state,level,meaning` CSV (`state`: `learning`, `known`, or `ignored`) as well as WordByWord exports (`term,meaning,example,term_language,meaning_language,status`, mapping `1-4` to `New` / `Recognized` / `Familiar` / `Learned` and `5` to `Known`).
- All data stays in local IndexedDB unless exported; export a JSON backup before uninstalling the extension.

## Development & Verification

```powershell
npm ci                  # Install dependencies
npm run dev             # Start WXT development build
npm run typecheck       # Run vue-tsc --noEmit
npm run lint            # Run ESLint across src, scripts, tests, wxt.config.ts
npm run format:check    # Verify formatting with Prettier
npm test                # Run Vitest unit & IndexedDB tests
npm run build           # Produce .output/chrome-mv3 production bundle
npm run test:browser    # Run Playwright Chromium end-to-end smoke suite
npm run zip             # Package extension archive into .output/
```

For browser smoke testing, ensure Playwright Chromium is installed (`npx playwright install chromium`). The smoke suite (`tests/browser-smoke.mjs`) launches Chromium against `.output/chrome-mv3` with a local HTTP article fixture, a mock Chat Completions server, and isolated temporary profiles/screenshots written under `.cache/`.

## Documentation

- [Architecture & Module Boundaries](docs/ARCHITECTURE.md)
- [Coding Standards](docs/CODING_STANDARDS.md)
- [Implementation Status & Benchmarks](docs/IMPLEMENTATION_STATUS.md)
- [Product Plan & Research Notes](PROJECT_PLAN.md)
- [Repository Agent Guidelines](AGENTS.md)

## Third-Party Licenses & Credits

Bundled third-party fonts and icons retain their respective licenses and are packaged into builds:

- **Lucide Icons**: [public/licenses/Lucide-LICENSE.txt](public/licenses/Lucide-LICENSE.txt)
- **Nunito Font**: [public/licenses/Nunito-OFL.txt](public/licenses/Nunito-OFL.txt)

## License

Released under the [MIT License](LICENSE).
