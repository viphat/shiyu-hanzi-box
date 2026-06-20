# Agent Instructions

## Project Summary

This repo is `shiyu-hanzi-box`, a local-first Chrome MV3 extension named
拾语汉字box. Its job is to capture selected Chinese text as words or quotes,
store the working inbox in `chrome.storage.local`, and later export daily
Markdown notes.

The implementation plan is in:

- `docs/superpowers/plans/2026-06-20-shiyu-hanzi-box.md`
- `docs/superpowers/specs/2026-06-20-shiyu-hanzi-box-design.md`

Tasks 0 through 6 have landed. Future work should continue from Task 7 unless
the user says otherwise.

## Commands

Use these commands from the repo root:

```bash
npm install
npm run dev
npm run build
npm run compile
npm test
npm run zip
```

Focused tests:

```bash
npx vitest run tests/normalize.test.ts
npx vitest run tests/capture.test.ts
npx vitest run tests/capture-handler.test.ts
```

`npm run compile` is `tsc --noEmit`.

## Architecture

The central data path is:

1. `entrypoints/background/index.ts` registers context menus and commands.
2. `entrypoints/background/capture-handler.ts` queries the active tab and runs
   `readPageContext` through `browser.scripting.executeScript`.
3. `lib/page-context.ts` reads selected text and page metadata in the page.
4. `lib/capture.ts` decides word vs quote behavior.
5. `lib/storage.ts` persists the inbox with WXT storage.

Core modules:

- `lib/types.ts`: persisted data shapes only.
- `lib/normalize.ts`: pure text normalization for word dedupe.
- `lib/id.ts`: dependency-free id helper.
- `lib/storage.ts`: `local:inbox` storage item and serialized mutations.
- `lib/capture.ts`: `saveWord` and `saveQuote`.
- `lib/page-context.ts`: self-contained injected function.

## Conventions

- Keep capture behavior funneled through `lib/capture.ts`; do not duplicate
  dedupe or storage writes in UI entrypoints.
- Keep injected functions self-contained. `readPageContext` must not depend on
  imported closure state because it is serialized into the active tab.
- Prefer pure modules for behavior that can be unit-tested without Chrome APIs.
- Use `@/*` imports where existing WXT code does, and relative imports where the
  file already uses that style.
- Use `apply_patch` for manual edits.
- Do not revert user changes. Check `git status --short` before editing.

## WXT And Fake-Browser Notes

- For WXT `0.20.26`, import storage from `wxt/utils/storage`, not
  `wxt/storage`.
- For WXT browser types, use:

```ts
import type { Browser } from 'wxt/browser';
type ActiveTab = Browser.tabs.Tab;
```

- `@webext-core/fake-browser` does not expose the plan's older
  `setReturnValue` / `setReject` helpers. Use Vitest spies instead:

```ts
vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([...]);
vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([...]);
```

- `fakeBrowser.reset()` clears storage and event state between tests.

## Testing Expectations

- Use TDD for behavior changes and new modules when practical.
- Run the focused test for the files you changed.
- Before claiming work is complete, run at least:

```bash
npm run compile
npm test
```

- For manifest/background changes, also run:

```bash
npm run build
cat .output/chrome-mv3/manifest.json
```

Expected manifest features include `contextMenus`, `storage`, `activeTab`,
`scripting`, command shortcuts, and an MV3 background service worker.

## Current Known Gaps

- `entrypoints/popup/main.tsx` is still a placeholder.
- New-tab dashboard, pinyin, Markdown export, and zip export are not implemented
  yet.
- `assets/icon.png` is missing, so WXT auto-icons emits a warning and generates
  default icons.
- Tailwind theme tokens for jade/ink styling are planned later.
