# XGloss Development Guidelines

- Read `docs/ARCHITECTURE.md` and `docs/CODING_STANDARDS.md` before modifying code.
- Use `npm` with `package-lock.json` on Node.js `>= 24`.
- Keep domain logic in `src/domain`, free of browser, DOM, and network dependencies.
- Access IndexedDB and persistent settings exclusively through the background worker. Expose API keys only to the extension Options page.
- Share tokenization, vocabulary states, and coverage algorithms across web and PDF readers; source adapters provide text and positions.
- Route translations through the OpenAI-compatible Chat Completions adapter, keeping Base URL and model configurable.
- Enforce budgets and explicit cleanup paths for DOM traversal, `Range` highlights, `Canvas` buffers, and event listeners.
- Use strict TypeScript, validate async message boundaries with Zod, and surface actionable error feedback.
- After completing changes, run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
- Base performance claims strictly on real measurements and document both verified scope and remaining acceptance items.
