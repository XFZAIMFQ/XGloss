# Implementation Status & Verification Log

## 2026-11-19 Shadcn UI Redesign, Trigger Modes & Multi-Language Controls

- Removed the bundled offline ECDICT dictionary (`public/dictionary/`, `scripts/prepare-dictionary.mjs`, `src/services/dictionary.ts`) to reduce bundle size and rely on contextual online translation + saved word meanings; tightened the translation prompt with `temperature: 0.1`, explicit anti-source-echo rules, and cache `version: 4`.

- Redesigned extension pages (`library.html`, `options.html`, `popup.html`, `reader.html`) around a unified shadcn/ui Zinc aesthetic with a dedicated navigation shell, brand prism SVG logo ([logo.svg](../public/icon/logo.svg)), and bundled icons/fonts.
- Upgraded IndexedDB to schema v3 with `VocabularyCollection` management across 8 languages (`EN`, `JA`, `KO`, `DE`, `FR`, `ES`, `RU`, `IT`), collection pinning, inline word editing/deletion modals, and a 1-year GitHub-style daily learning activity heatmap.
- Replaced native `<select>` controls in Library filters, Review filters (fixing the filter label vertical misalignment), Settings (Default Definition Mode), Popup, and `WordCard` with unified `ShadcnSelect` and `LanguageFlag` components whose shared styles live in `ui.css` so they work inside webpage Shadow DOM (`#xgloss-root`).
- Added a 3-mode global selection trigger (`auto`, `icon`, `off`) in Popup (`SelectionTriggerIcon.vue` renders a compact `26x26` trigger icon near selections in `icon` mode without sending translation requests until clicked; `off` ignores text selection while leaving `ReadingPanel` word clicks active).
- Added Popup Active Collection (routing newly rated words with unidirectional `sourceLanguage` sync) and Translation Direction (`source -> target`) controls, plus a bottom-right per-card temporary language switcher capsule and upward popover on `WordCard` (layered `Escape` dismissal, `version: 3` translation cache key).
- Verified with `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` (31/31 unit tests passing across domain, repository v3 migration, and OpenAI translation v3 cache/prompt tests), `npm run build`, and Playwright Chromium smoke tests (`tests/browser-smoke.mjs`) covering Popup controls, 3 trigger modes, webpage Shadow DOM card dropdowns, 2,000-paragraph web pages, and 300-page PDF workflows.

## 2026-11-18 Meaning Selection & Panel Previews

- Pre-selected the first context-ranked meaning in `WordCard` and persisted the user's chosen gloss per encounter while preserving word-level fallback meanings; kept JSON and CSV backwards compatibility for entries without stored meanings.
- Shared the IndexedDB translation cache between `WordCard` and `ReadingPanel`; panel candidate rows fetch only top context meanings for visible rows (up to 5 concurrent requests per panel) or lazily on reveal in Recall Mode.
- Verified in isolated Chromium against a local mock service: default selection persistence across reopens, shared context cache reuse (1 request across panel + card and deduplicated concurrent requests), inline recommended sparkles badge, and 5-way parallel panel fetches.

## 2026-11-18 Contextual Word Lookup & Passage Translation

- Added the DeepSeek preset to Options. Web and PDF `WordCard` load context-ranked glosses for words/phrases and full text translations for sentences/passages, sharing one response across `Simple` and `Detailed` modes and falling back to ECDICT offline definitions on failure.
- Consolidated UI copy and error strings into `zh-CN` using half-width ASCII punctuation across UI messages, local glosses, and normalized translations.
- Validated against live DeepSeek API (`register` in hardware context returning 4 ranked meanings and full-sentence hardware interrupt translation) and isolated Chromium smoke tests covering web/PDF selections, dictionary fallback, mode toggle, and cache reuse.

## 2026-11-18 Per-Site Web Analysis & Recall Mode

- Enabled declarative content-script auto-analysis for permitted HTTP(S) websites with per-hostname toggles stored locally and live teardown/restoration on open tabs.
- Synced Spotlight highlighting and Recall Mode preferences globally across multiple web origins (including non-secure HTTP origins) and the PDF reader.
- Verified in Chromium across two distinct hostnames: auto-attach, site disable teardown, persistence across reload, cross-tab Spotlight synchronization, and Recall Mode per-row reveal and reset.

## 2026-11-18 Floating Reader Polish

- Compacted the resting Reading Panel badge to a coverage pill expanding on hover/focus, moved header controls (`Spotlight`, collapse) inline, kept rated batch positions until manual refresh, capped visible card glosses in `Simple` mode with expandable overflow, and anchored toolbar actions cleanly.
- Verified in Chromium across keyboard expansion, viewport bottom flip (`#edge-word` under HTTP 503), `390px` mobile width, two-page spread PDF right-page selection, and screenshot comparisons. (Raspberry Pi docs returned HTTP 403 inside the isolated sandbox, so `#edge-word` local fixture was added.)

## 2026-11-18 Learning Grades, Activity Calendar & Multi-Page PDF Layouts

- Introduced 4-level learning grades shared between web and PDF, paginated collection browsing with inline rating adjustments, JSON v2 exports with encounter and activity histories, local-date activity statistics calendars, card default mode settings, and PDF.js Viewer single/two-page layouts, outline navigation, bookmarks, and per-document progress restore.
- Verified in isolated Chromium against a 2,000-paragraph page (344 sampled viewport highlight ranges after scroll) and a 300-page synthetic PDF (page-2 source capture in two-page spread, scrolling, outline jumps, bookmarks, rotated text-layer alignment, and reload progress restoration).
- Tested a real 14-page document ([Mozilla PDF.js public paper sample](https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf)) in headless Chromium (`1440x1000`): first text layer visible in ~1.00s after local file upload, jump to page 10 in ~0.44s, and 10 canvases observed after two-page toggle and scrolling (single-run automated timings including browser overhead; larger complex manuals, scroll frame timings, memory trends, and side-by-side comparisons against native Chrome remain unmeasured).

## 2026-11-17 Initial Runnable Release (`0.1.0`)

- Scaffolded strict TypeScript + WXT + Vue 3 extension with npm lockfile, coding standards, local ECDICT dictionary sharded into 44,688 entries, local & online PDF.js reader, chunked web highlighter, JSON/CSV import/export, OpenAI-compatible translation adapter, and Playwright Chromium smoke harness producing `.output/xgloss-0.1.0-chrome.zip`.

## Remaining Roadmap & Open Items

- **PDF Virtualization & Range Requests**: Add page-level virtualization and HTTP Range streaming for very large online PDFs beyond eager full download.
- **Morphology & Multi-Span Word Joining**: Extend tokenization beyond lowercase + apostrophe normalization to full lemmatization, multi-word phrase spotting, and hyphenated/split PDF `TextItem` word joining.
- **Complex DOM Environments**: Expand coverage beyond `main` / `article` / `role="main"` into cross-origin iframes, nested closed Shadow DOMs, virtualized scrollers, and full SPA root replacements (web & PDF both enforce 1,000,000-character analysis budgets).
- **OCR & External Sync**: Add OCR support for scanned PDFs, PDF internal annotations/links, and optional cloud/mobile companion sync (e.g., Eudic).
- **Real-World Performance Profiling**: Collect frame-time traces, heap snapshots, and comparative benchmarks on large real-world engineering manuals and long dynamic pages.
