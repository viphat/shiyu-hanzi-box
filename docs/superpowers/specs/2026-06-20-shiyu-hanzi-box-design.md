# 拾语汉字box — Chinese Reading Inbox

## Summary

Build a local-first Chrome MV3 extension from a blank workspace using WXT, React, TypeScript, Tailwind CSS, and `lucide-react`. The extension captures selected Chinese text as either a word/phrase or quote without interrupting reading, stores a working copy locally, and exports permanent daily Markdown notes.

## Tech Stack

- **Extension framework:** WXT with Chrome Manifest V3.
- **Language:** TypeScript.
- **UI:** React for the new-tab dashboard and toolbar popup.
- **Styling:** Tailwind CSS with `lucide-react` icons.
- **Chrome APIs:** `contextMenus`, `commands`, `storage.local`, `scripting`, `activeTab`, `downloads`, and `chrome_url_overrides`.
- **Data:** Local-first `chrome.storage.local` working inbox, exported to Markdown daily notes.
- **Chinese utilities:** `pinyin-pro` for local pinyin generation.
- **Export utilities:** `fflate` for zipped Markdown exports.
- **Testing:** Vitest for unit tests, Chrome unpacked-extension checks for end-to-end capture/dashboard flows.

## Key Changes

- Add WXT entrypoints for a background service worker, a new-tab dashboard, and a toolbar popup.
- Use three capture paths: context menu items, keyboard commands, and toolbar popup buttons for `Save as word` and `Save as quote`.
- Treat keyboard commands and toolbar popup capture as the fallback for sites that block or replace the browser context menu.
- Use `activeTab` plus `scripting` to capture selection/context only after a user gesture, avoiding broad site permissions.
- Store data in `chrome.storage.local` with `unlimitedStorage`; no cloud sync or remote API calls.
- Add lazy pinyin support in the dashboard with `pinyin-pro`; no full dictionary lookup in v1.

## Interfaces

Two entry kinds share a common base, but differ in how source is modeled:

**Common fields (both words and quotes):** `id`, `text`, `tags`, `note`, `status: inbox | reviewed | archived`, `createdAt`, `updatedAt`, `pinyin?` (lazy, filled by the dashboard).

- **Words** are deduped by normalized Chinese text (see Normalization). The single word record carries an `occurrences[]` array; each occurrence captures `sourceTitle`, `sourceUrl`, `sourceDomain`, `surrounding` (the sentence the selection appeared in), and `capturedAt`. The first time a word is captured it is `createdAt`; subsequent captures append a new occurrence and bump `updatedAt`.
- **Quotes** stay independent (no dedupe). Each quote stores `sourceTitle`, `sourceUrl`, `sourceDomain`, `surrounding`, and `category` directly on the record. `category` defaults to `uncategorized` and is a freeform string.

**Normalization (for word dedupe):** trim, collapse internal whitespace, strip leading/trailing CJK punctuation, full-width → half-width, and lowercase Latin letters. Quotes are not normalized.
- Daily Markdown export creates either today's `.md` file or a zip of `daily/YYYY-MM-DD.md` files using `fflate`. A word with multiple occurrences on the same day appears once with all source links; quotes each appear as their own entry.
- Daily notes include frontmatter, `## Words`, `## Quotes`, review checkboxes, pinyin when available, tags, notes, and source links.

## Capture Fallbacks

- Context menu: select text, right-click, then save as word or quote when the site allows the browser menu.
- Keyboard: select text, then use configured Chrome extension shortcuts to save without relying on page context menus.
- Toolbar popup: select text, click the extension icon, then choose word or quote; the popup reads the active tab selection through a user gesture.
- All capture paths use the same storage service, dedupe logic, page metadata capture, and toast/badge feedback.

## Dashboard

- Replace the new tab page with a functional study dashboard, not a landing page.
- First screen: search, quick stats, export controls, words inbox, quotes inbox, and review filters.
- Support edit tags/category/note, mark reviewed, archive, restore, delete, and generate pinyin.
- Use a clean white/ink interface with jade accents, system Chinese font fallbacks, responsive layout, and keyboard-accessible controls.

## Test Plan

- Unit-test text normalization, duplicate word merging, date grouping, Markdown rendering, zip file map generation, and pinyin generation.
- Mock Chrome APIs for capture tests: context menu save, keyboard save, toolbar popup save, blocked/custom context menu fallback, empty selection, restricted page failure, and storage errors.
- Verify WXT build output and manifest permissions.
- Browser-check the new-tab dashboard, capture flow, persistence after reload, and exported Markdown content.

## Assumptions

- Target is Chrome/Chromium browsers only for v1.
- Markdown export is the permanent archive; extension storage is the fast working inbox.
- Categories are freeform strings, with `uncategorized` as the default.

## References

- [WXT](https://wxt.dev/)
- [WXT entrypoints](https://wxt.dev/guide/essentials/entrypoints.html)
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [contextMenus](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)
- [commands](https://developer.chrome.com/docs/extensions/reference/api/commands)
- [storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [override pages](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages)
- [pinyin-pro](https://pinyin-pro.cn/en/guide/start.html)
- [fflate](https://www.npmjs.com/package/fflate)
