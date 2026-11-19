# Coding Standards

## Language & Naming

- Enable TypeScript `strict` mode; forbid implicit `any`; accept external inputs as `unknown` and validate with Zod schemas at boundaries.
- Format with 4-space indentation, 110-column line width, single quotes, and no semicolons, enforced by Prettier.
- Use `kebab-case` for regular TypeScript modules, `PascalCase` for Vue components and types, and `camelCase` for variables and functions.
- Prefer descriptive domain names; write concise comments explaining constraints, non-obvious invariants, and compatibility requirements rather than restating what code does.
- Keep `src/domain` pure; all browser API, DOM, network, and IndexedDB I/O belongs in `src/data`, `src/services`, `src/platform`, or feature adapters.

## Data Integrity & Async Boundaries

- Migrate IndexedDB schemas explicitly across versions; validate entire import payloads before mutating state inside read-write transactions.
- Store words by normalized keys and deduplicate encounters; coalesce or cache repeated translation requests deterministically.
- Apply timeouts and `AbortSignal` propagation to async requests; cancel or discard stale async results when views unmount or inputs change.
- Reflect loading, success, and actionable error states clearly in user-facing operations.
- Render untrusted external definitions, PDF text, and model translations strictly as plain text (never unescaped HTML).
- Restrict credential storage and editing to the extension Options page (`options.html`); never log API keys, authorization headers, or private page context.

## Maintainability & Performance

- Organize features cleanly into cohesive modules and keep entrypoints focused on lifecycle wiring.
- Route all UI labels, status text, and user-facing errors through `src/i18n`; use ASCII half-width punctuation for extension-authored Chinese copy.
- Centralize shared business logic rather than duplicating across web, PDF, or workspace UI; introduce abstractions when driven by concrete callers.
- Give DOM observers, `Range` collections, PDF `Canvas` buffers, and global event listeners explicit budgets and teardown cleanup paths; chunk long-text scans to avoid blocking frames.
- Keep Vue responsible for UI state and DOM text processing decoupled in dedicated modules.
- After making changes, run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`, adding regression tests when modifying domain logic or protocol boundaries.
