# Project Architecture

```text
src/
  domain/             Vocabulary, tokenization, collections, statistics, and runtime contracts
  data/               Extension-origin IndexedDB and restricted settings storage
  services/           OpenAI-compatible translation and background handler
  platform/           Typed extension runtime messaging
  features/
    web/              Web page chunked scanning and viewport highlighting
    pdf/              PDF.js page-level rendering and extraction lifecycle
  components/         Shared WordCard, ReadingPanel, ShadcnSelect, and workspace components
  i18n/               Typed UI copy and error message catalog
  assets/             Shared UI stylesheets (including ui.css injected into web Shadow DOM)
  entrypoints/        Background worker, content script, popup, options, library, and PDF reader
scripts/              Asset preparation scripts (PDF.js runtime)
tests/                Domain, storage, translation protocol, and browser smoke verification
public/               Bundled icons and third-party licenses
```

## Data Flow

Both the web content script and the PDF reader extract tokens from raw text and compute word frequencies and reading coverage against the same vocabulary state. Encounter locations retain source metadata, and vocabulary states are shared globally by normalized term key.

All persistent mutations pass through the background handler (`src/services/background-handler.ts`). Extension-origin IndexedDB transactions (schema v3, adding the `collections` store) atomically update `words`, `encounters`, and `activities`. UI surfaces update after receiving confirmed responses, and background broadcasts (`vocabularyChanged`, `siteReadingChanged`, `spotlightChanged`, `candidateRecallChanged`, `selectionTriggerChanged`, `translationLanguagesChanged`, `activeCollectionChanged`) keep open PDF pages, web tabs, and extension pages synchronized.

Vocabulary supports `learning` grades `1-4` (legacy ungraded records read as level `1`), `known`, and `ignored`. Reading coverage is computed from `known` token occurrences divided by non-ignored valid tokens. Words can be organized into multi-language `VocabularyCollection` records across 8 languages (`en`, `ja`, `ko`, `de`, `fr`, `es`, `ru`, `it`). Newly rated words default to the stored `activeCollectionId` (falling back to the top sorted collection), while re-rating an existing word preserves its current collection unless explicitly reassigned.

The background handler serves vocabulary state and non-credential reading preferences (`selectionTrigger`, `translationLanguages`, `spotlight`, `recallCandidateMeanings`) to content scripts. Privileged operations (`setSelectionTrigger`, `setTranslationLanguages`, `activeCollection`, `setActiveCollection`, collection/word management, export/import, statistics) require extension pages (`extensionOnly`), while API credentials and card display settings (`settings`, `saveSettings`, `saveDefinitionMode`) are strictly restricted to `options.html` (`optionsOnly`). Persistent storage uses `chrome.storage.local` configured at `TRUSTED_CONTEXTS` access level so API keys never leave restricted extension storage.

The Library workspace loads paginated meanings and recent encounters, lets users manage collections and edit/delete words inline, and renders a local-date activity heatmap tracking `added`, `rated`, and `reviewed` events. JSON v2 backups export collections, words, saved meanings, encounters, and activities while maintaining backwards compatibility with JSON v1 and CSV (`word,state,level,meaning`) imports. PDF bookmarks and last-read pages are persisted locally by document fingerprint.

## Translation Protocol

`Base URL` specifies the API root, such as `https://example.com/v1`. Requests are sent via `POST {baseUrl}/chat/completions` with `model`, `messages`, and `stream: false`. Authorization uses a Bearer header (optional API key so unauthenticated local `http://localhost` services work without credentials). The Options page provides a DeepSeek preset configured with the official endpoint and `deepseek-flash`; DeepSeek JSON output and non-thinking parameters are only attached to the official DeepSeek origin.

When a `WordCard` opens (or when switching language direction via its per-card bottom-right switcher), translation runs with the selection and optional sentence context:

- Words and phrases receive up to 5 context-ranked candidate glosses (`kind: "meanings"`), saving the chosen gloss per encounter without mutating global language defaults on per-card overrides.
- Clauses, sentences, and passages receive a full text translation (`kind: "text"`).
- Responses are validated with Zod schemas and rendered strictly as plain text. `Simple` and `Detailed` definition modes share the same cached response, with `Detailed` additionally showing part of speech, phonetics, and source context when available.

The Popup's active-collection selector unidirectionally updates the global default `sourceLanguage` to match the selected collection's language, while allowing independent overrides of `sourceLanguage` and `targetLanguage` in global preferences. `ReadingPanel` shares `translateSelection` with `WordCard`, displaying only the top context-ranked gloss for visible rows in expanded panels (up to 5 concurrent lookups per panel; in Recall Mode, lookups defer until revealed).

The background cache computes a `version: 4` SHA-256 key from provider configuration, effective `sourceLanguage` / `targetLanguage`, normalized selection text, and sentence context. Requests use `temperature: 0.1` and explicit target-language constraints to prevent source-phrase echoing. Concurrent requests sharing the same cache key coalesce onto a single upstream request, aborting upstream only when all waiting consumers cancel. Requests enforce per-call timeouts, a global cap of 6 concurrent upstream translations, and tolerate cache write failures without failing the returned translation. Origin permissions for both remote HTTPS providers and local HTTP servers are explicitly requested on user action.

## UI Copy & Shared Shadow DOM Styles

All visible labels, accessibility strings, and extension error messages are typed and centralized in `src/i18n/zh-CN.ts`, checked at compile time by `t()`. UI copy and online translations enforce ASCII half-width punctuation, while captured source selections and encounters preserve original source punctuation.

`WebReader` mounts inside an open Shadow DOM (`#xgloss-root`) injected with `src/assets/ui.css?inline` only. Shared controls rendered both in webpages and extension pages (`WordCard`, `ReadingPanel`, `SelectionTriggerIcon`, `ShadcnSelect`, `LanguageFlag`, `BrandLogo`) keep their styles in `src/assets/ui.css` rather than component `<style scoped>` blocks so styling stays consistent inside webpage Shadow Roots.

## Web & PDF Lifecycle

Accessible HTTP(S) pages run lightweight content-script listeners and read per-hostname `siteReading` preferences before mounting analysis. When disabled for a hostname, the active panel, word card, trigger icon, observers, and highlights tear down immediately while retaining the lightweight restoration listener. Spotlight highlighting, Recall Mode, and `selectionTrigger` (`'auto' | 'icon' | 'off'`) are extension-wide local preferences applied across open web tabs and PDFs. Clicking candidates inside `ReadingPanel` always opens `WordCard` regardless of `selectionTrigger`.

Web scanning partitions initial discovery and incremental DOM mutations by time and node budgets, retaining compact chunk summaries and capping active CSS Highlights at `5,000` ranges near the viewport. Removed nodes drop cached references cleanly via `MutationObserver`.

PDF.js parses documents in a dedicated worker and manages single/two-page and continuous/paginated layouts with visible-page rendering queues, capping main canvas size at 8,000,000 pixels and sharing the 5,000-range highlight budget across nearby rendered text layers. Background page statistics scan incrementally and preserve last-read progress and bookmarks per PDF fingerprint. Large files remain subject to per-page vector/text complexity, decoding time, and overall file size.

## Current Scope

This implementation covers web pages, text-layer PDFs, multi-language local vocabulary management, 3-mode selection triggering, contextual OpenAI-compatible translation with per-card overrides, review sessions, and activity statistics. Scanned PDF OCR, external sync adapters (e.g., Eudic), and additional UI locales remain open for future extension.
