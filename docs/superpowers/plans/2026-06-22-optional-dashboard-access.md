# Optional Dashboard Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard an optional extension page instead of a Chrome new-tab override, while keeping obvious dashboard access from the popup and extension action context menu.

**Architecture:** Rename the WXT special `entrypoints/newtab/` entrypoint to the unlisted page `entrypoints/dashboard/`, which makes WXT emit `dashboard.html` without `chrome_url_overrides.newtab`. Add two explicit open-dashboard flows that call `browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html') })`: a localized popup button and an action context menu item. Keep all capture, review, dictionary, AI, export, backup, and restore data paths unchanged.

**Tech Stack:** WXT 0.20.26, Chrome MV3 APIs, React, TypeScript, Vitest, `@webext-core/fake-browser`, lucide-react, Tailwind CSS.

---

## File Structure

- Rename: `entrypoints/newtab/` -> `entrypoints/dashboard/`
  - Existing dashboard React app, hooks, and components remain together.
  - `entrypoints/dashboard/index.html` becomes WXT's unlisted page source for `dashboard.html`.
- Modify: `entrypoints/settings/SettingsApp.tsx`
  - Update dashboard hook import and "Back to dashboard" URL.
- Modify: `entrypoints/background/capture-handler.ts`
  - Export `MENU_OPEN_DASHBOARD`.
- Modify: `entrypoints/background/index.ts`
  - Register the action context menu item and handle clicks by opening `dashboard.html`.
- Modify: `entrypoints/popup/Popup.tsx`
  - Add a localized "Open dashboard" button.
- Modify: `lib/i18n.ts`
  - Add `popup.openDashboard` in `en` and `zh-CN`.
- Create: `tests/dashboard-access.test.ts`
  - Source-level guard for entrypoint rename, settings back link, popup open action, and docs.
- Create: `tests/background-menu.test.ts`
  - Runtime test for menu registration and action-menu dashboard open behavior with mocked fake-browser context menu APIs.
- Modify: `tests/i18n.test.ts`
  - Assert `popup.openDashboard` messages.
- Modify: `tests/ai-settings-location.test.ts`, `tests/ai-components.test.tsx`, `tests/word-card.test.tsx`
  - Update dashboard import/source paths.
- Modify: `README.md`, `AGENTS.md`, `docs/chrome-web-store-reviewer-notes.md`, `docs/chrome-web-store-dashboard-checklist.md`
  - Remove current new-tab override wording and document popup/action-menu access.

---

### Task 1: Add Failing Dashboard Access Tests

**Files:**
- Create: `tests/dashboard-access.test.ts`
- Create: `tests/background-menu.test.ts`
- Modify: `tests/i18n.test.ts`

- [ ] **Step 1: Create source-level tests for dashboard access**

Create `tests/dashboard-access.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('optional dashboard access source layout', () => {
  it('uses an unlisted dashboard entrypoint instead of the newtab override entrypoint', () => {
    expect(existsSync('entrypoints/dashboard/index.html')).toBe(true);
    expect(existsSync('entrypoints/dashboard/main.tsx')).toBe(true);
    expect(existsSync('entrypoints/dashboard/App.tsx')).toBe(true);
    expect(existsSync('entrypoints/newtab/index.html')).toBe(false);
  });

  it('settings navigates back to dashboard.html', () => {
    const source = read('entrypoints/settings/SettingsApp.tsx');

    expect(source).toContain("browser.runtime.getURL('/dashboard.html')");
    expect(source).not.toContain("browser.runtime.getURL('/newtab.html')");
    expect(source).toContain("from '../dashboard/hooks/useSettings'");
  });

  it('popup exposes a localized open-dashboard action', () => {
    const source = read('entrypoints/popup/Popup.tsx');

    expect(source).toContain('function openDashboard');
    expect(source).toContain("browser.runtime.getURL('/dashboard.html')");
    expect(source).toContain("t(locale, 'popup.openDashboard')");
  });

  it('current docs describe optional dashboard access without new-tab takeover wording', () => {
    const readme = read('README.md');
    const reviewerNotes = read('docs/chrome-web-store-reviewer-notes.md');
    const checklist = read('docs/chrome-web-store-dashboard-checklist.md');
    const agents = read('AGENTS.md');

    expect(readme).toContain('Dashboard page opened from the toolbar popup or extension action menu');
    expect(readme).toContain('entrypoints/dashboard/');
    expect(readme).not.toContain('New-tab dashboard');
    expect(reviewerNotes).toContain('Open the dashboard from the toolbar popup');
    expect(reviewerNotes).not.toContain('uses a new-tab override');
    expect(checklist).toContain('contextMenus: Adds user-triggered "save as word", "save as quote", and "open dashboard" actions.');
    expect(agents).toContain('entrypoints/dashboard/App.tsx');
    expect(agents).not.toContain('entrypoints/newtab/');
  });
});
```

- [ ] **Step 2: Create background menu registration tests**

Create `tests/background-menu.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Browser } from 'wxt/browser';
import background from '../entrypoints/background/index';
import {
  MENU_OPEN_DASHBOARD,
  MENU_SAVE_QUOTE,
  MENU_SAVE_WORD,
} from '../entrypoints/background/capture-handler';

type InstalledListener = () => void;
type MenuClickListener = (
  info: Browser.contextMenus.OnClickData,
  tab?: Browser.tabs.Tab,
) => void;

describe('background context menus', () => {
  let installedListener: InstalledListener | undefined;
  let menuClickListener: MenuClickListener | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    fakeBrowser.reset();
    installedListener = undefined;
    menuClickListener = undefined;

    vi.spyOn(fakeBrowser.runtime.onInstalled, 'addListener').mockImplementation((listener) => {
      installedListener = listener as InstalledListener;
    });
    vi.spyOn(fakeBrowser.contextMenus, 'create').mockImplementation(() => undefined);
    vi.spyOn(fakeBrowser.contextMenus.onClicked, 'addListener').mockImplementation((listener) => {
      menuClickListener = listener as MenuClickListener;
    });
    vi.spyOn(fakeBrowser.commands.onCommand, 'addListener').mockImplementation(() => undefined);
    vi.spyOn(fakeBrowser.runtime, 'getURL').mockImplementation((path) => `chrome-extension://id${path}`);
    vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({ id: 9 } as Browser.tabs.Tab);
  });

  it('registers selection capture menus and action dashboard menu', () => {
    background.main?.();
    expect(installedListener).toBeDefined();

    installedListener?.();

    expect(fakeBrowser.contextMenus.create).toHaveBeenCalledWith({
      id: MENU_SAVE_WORD,
      title: 'Save as word (拾语汉字box)',
      contexts: ['selection'],
    });
    expect(fakeBrowser.contextMenus.create).toHaveBeenCalledWith({
      id: MENU_SAVE_QUOTE,
      title: 'Save as quote (拾语汉字box)',
      contexts: ['selection'],
    });
    expect(fakeBrowser.contextMenus.create).toHaveBeenCalledWith({
      id: MENU_OPEN_DASHBOARD,
      title: 'Open dashboard (拾语汉字box)',
      contexts: ['action'],
    });
  });

  it('opens dashboard.html from the action context menu', () => {
    background.main?.();
    expect(menuClickListener).toBeDefined();

    menuClickListener?.({ menuItemId: MENU_OPEN_DASHBOARD } as Browser.contextMenus.OnClickData);

    expect(fakeBrowser.runtime.getURL).toHaveBeenCalledWith('/dashboard.html');
    expect(fakeBrowser.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://id/dashboard.html',
    });
  });
});
```

- [ ] **Step 3: Add i18n expectations for the popup dashboard label**

Modify `tests/i18n.test.ts` by adding this test after the Traditional conversion label test:

```ts
  it('returns popup dashboard labels in both locales', () => {
    expect(t('en', 'popup.openDashboard')).toBe('Open dashboard');
    expect(t('zh-CN', 'popup.openDashboard')).toBe('打开收藏箱');
  });
```

- [ ] **Step 4: Run focused tests to verify they fail**

Run:

```bash
npx vitest run tests/dashboard-access.test.ts tests/background-menu.test.ts tests/i18n.test.ts
```

Expected: FAIL. The failures should mention missing `entrypoints/dashboard/index.html`, missing `MENU_OPEN_DASHBOARD`, missing `popup.openDashboard`, and old `/newtab.html` or `entrypoints/newtab` references.

- [ ] **Step 5: Commit failing tests**

```bash
git add tests/dashboard-access.test.ts tests/background-menu.test.ts tests/i18n.test.ts
git commit -m "test: cover optional dashboard access"
```

---

### Task 2: Rename Dashboard Entrypoint And Update Internal Imports

**Files:**
- Rename: `entrypoints/newtab/` -> `entrypoints/dashboard/`
- Modify: `entrypoints/settings/SettingsApp.tsx`
- Modify: `tests/ai-settings-location.test.ts`
- Modify: `tests/ai-components.test.tsx`
- Modify: `tests/word-card.test.tsx`

- [ ] **Step 1: Move the WXT entrypoint directory**

Run:

```bash
mv entrypoints/newtab entrypoints/dashboard
```

- [ ] **Step 2: Update settings imports and back link**

Modify `entrypoints/settings/SettingsApp.tsx`:

```ts
import { useSettings } from '../dashboard/hooks/useSettings';
```

Replace the back link `href` with:

```tsx
href={browser.runtime.getURL('/dashboard.html')}
```

- [ ] **Step 3: Update test imports and source paths**

Modify `tests/ai-settings-location.test.ts`:

```ts
  it('does not expose a separate AI settings button on the dashboard home page', () => {
    const source = readFileSync('entrypoints/dashboard/App.tsx', 'utf8');

    expect(source).not.toContain('AiSettingsPanel');
    expect(source).not.toContain('openAiSettings');
    expect(source).not.toContain('extraActions=');
    expect(source).not.toContain('<Sparkles');
  });
```

Modify `tests/ai-components.test.tsx` imports:

```ts
import { AiInsightSection } from '../entrypoints/dashboard/components/AiInsightSection';
import { AskAiButton } from '../entrypoints/dashboard/components/AskAiButton';
```

Modify `tests/word-card.test.tsx` import:

```ts
import { WordCard } from '../entrypoints/dashboard/components/WordCard';
```

- [ ] **Step 4: Regenerate WXT path types**

Run:

```bash
npx wxt prepare
```

Expected: command exits 0 and `.wxt/types/paths.d.ts` includes `/dashboard.html` instead of `/newtab.html`.

- [ ] **Step 5: Run focused source tests**

Run:

```bash
npx vitest run tests/dashboard-access.test.ts tests/ai-settings-location.test.ts tests/ai-components.test.tsx tests/word-card.test.tsx
```

Expected: some tests may still fail because popup/background/docs changes are not implemented yet, but there should be no failures caused by missing `entrypoints/newtab` imports.

- [ ] **Step 6: Commit entrypoint rename**

```bash
git add entrypoints/dashboard entrypoints/settings/SettingsApp.tsx tests/ai-settings-location.test.ts tests/ai-components.test.tsx tests/word-card.test.tsx
git add -u entrypoints/newtab
git commit -m "refactor: rename dashboard entrypoint"
```

---

### Task 3: Add Popup Dashboard Button And I18n

**Files:**
- Modify: `entrypoints/popup/Popup.tsx`
- Modify: `lib/i18n.ts`
- Test: `tests/dashboard-access.test.ts`
- Test: `tests/i18n.test.ts`

- [ ] **Step 1: Add localized message keys**

Modify `lib/i18n.ts`.

In the `en` message table, add this entry after `popup.saveQuote`:

```ts
    'popup.openDashboard': 'Open dashboard',
```

In the `zh-CN` message table, add this entry after `popup.saveQuote`:

```ts
    'popup.openDashboard': '打开收藏箱',
```

- [ ] **Step 2: Add dashboard opener to popup imports**

Modify the lucide import in `entrypoints/popup/Popup.tsx`:

```ts
import { ClipboardPaste, LayoutDashboard, Loader2, Quote, Type } from 'lucide-react';
```

Add a WXT browser import below the React/lucide imports:

```ts
import { browser } from 'wxt/browser';
```

- [ ] **Step 3: Add popup click handler**

Add this function inside `Popup`, after `pasteAndSave` and before `applyResult`:

```ts
  async function openDashboard() {
    await browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html') });
    window.close();
  }
```

- [ ] **Step 4: Add the visible dashboard button**

In `entrypoints/popup/Popup.tsx`, add this button immediately after the existing save quote button:

```tsx
        <button
          onClick={openDashboard}
          disabled={!!busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-sm border border-border bg-paper-light px-3 py-3 text-xs font-medium text-ink-secondary tracking-[2px] transition hover:border-border-hover hover:bg-paper-input disabled:opacity-50"
        >
          <LayoutDashboard className="h-4 w-4" />
          {t(locale, 'popup.openDashboard')}
        </button>
```

- [ ] **Step 5: Run popup and i18n tests**

Run:

```bash
npx vitest run tests/dashboard-access.test.ts tests/i18n.test.ts
```

Expected: popup and i18n assertions pass. Docs and background assertions may still fail until later tasks.

- [ ] **Step 6: Commit popup access**

```bash
git add entrypoints/popup/Popup.tsx lib/i18n.ts tests/i18n.test.ts
git commit -m "feat: add popup dashboard access"
```

---

### Task 4: Add Action Context Menu Dashboard Access

**Files:**
- Modify: `entrypoints/background/capture-handler.ts`
- Modify: `entrypoints/background/index.ts`
- Test: `tests/background-menu.test.ts`

- [ ] **Step 1: Export the dashboard menu id**

Modify `entrypoints/background/capture-handler.ts` near the existing menu constants:

```ts
export const MENU_SAVE_WORD = 'save-word-menu';
export const MENU_SAVE_QUOTE = 'save-quote-menu';
export const MENU_OPEN_DASHBOARD = 'open-dashboard';
```

- [ ] **Step 2: Import the new menu id in the background worker**

Modify `entrypoints/background/index.ts` import:

```ts
import {
  handleCapture,
  handleContextMenuCapture,
  MENU_OPEN_DASHBOARD,
  MENU_SAVE_WORD,
  MENU_SAVE_QUOTE,
} from './capture-handler';
```

- [ ] **Step 3: Register the action context menu**

In `entrypoints/background/index.ts`, add this `create` call inside the `onInstalled` listener after the two selection menu items:

```ts
    browser.contextMenus.create({
      id: MENU_OPEN_DASHBOARD,
      title: 'Open dashboard (拾语汉字box)',
      contexts: ['action'],
    });
```

- [ ] **Step 4: Handle action menu clicks**

In `entrypoints/background/index.ts`, extend the `contextMenus.onClicked` listener:

```ts
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_SAVE_WORD) {
      void handleContextMenuCapture('word', info, tab);
    } else if (info.menuItemId === MENU_SAVE_QUOTE) {
      void handleContextMenuCapture('quote', info, tab);
    } else if (info.menuItemId === MENU_OPEN_DASHBOARD) {
      void browser.tabs.create({
        url: browser.runtime.getURL('/dashboard.html'),
      });
    }
  });
```

- [ ] **Step 5: Run background menu tests**

Run:

```bash
npx vitest run tests/background-menu.test.ts tests/capture-handler.test.ts
```

Expected: both test files pass. `tests/capture-handler.test.ts` confirms capture behavior still works.

- [ ] **Step 6: Commit background access**

```bash
git add entrypoints/background/capture-handler.ts entrypoints/background/index.ts tests/background-menu.test.ts
git commit -m "feat: add action dashboard context menu"
```

---

### Task 5: Update Current Documentation

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/chrome-web-store-reviewer-notes.md`
- Modify: `docs/chrome-web-store-dashboard-checklist.md`
- Test: `tests/dashboard-access.test.ts`

- [ ] **Step 1: Update README status wording**

In `README.md`, replace:

```md
- New-tab dashboard with search, status filters, cards, edit controls, pinyin,
  export actions, and backup/restore controls.
```

with:

```md
- Dashboard page opened from the toolbar popup or extension action menu, with
  search, status filters, cards, edit controls, pinyin, export actions, and
  backup/restore controls.
```

- [ ] **Step 2: Update README project layout**

In `README.md`, replace the `newtab/` project layout block with:

```text
  dashboard/
    index.html
    main.tsx
    App.tsx              # dashboard shell, filters, list wiring
    hooks/useAiInsight.ts # AI insight request + persistence hook
    hooks/useInbox.ts    # live WXT inbox storage hook
    hooks/useSettings.ts # live WXT settings storage hook
    components/          # toolbar, word/quote cards, lists, pinyin/traditional controls
```

- [ ] **Step 3: Update AGENTS dashboard paths**

In `AGENTS.md`, replace current `entrypoints/newtab/...` references in the active architecture summary with `entrypoints/dashboard/...`.

The central data path lines should read:

```md
6. `entrypoints/dashboard/App.tsx` reads and mutates the inbox through
   `entrypoints/dashboard/hooks/useInbox.ts`.
```

The Traditional conversion line should read:

```md
10. `lib/traditional.ts` and `entrypoints/dashboard/components/TraditionalButton.tsx`
```

The dashboard module line should read:

```md
- `entrypoints/dashboard/`: dashboard shell, toolbar, cards, lists, and storage
  hook.
```

- [ ] **Step 4: Update Chrome Web Store reviewer instructions**

In `docs/chrome-web-store-reviewer-notes.md`, replace manual test steps 7 and 8 with:

```md
7. Open the dashboard from the toolbar popup by clicking the extension icon and
   choosing **Open dashboard**.
8. Confirm the saved word and quote appear in the dashboard.
```

Replace popup fallback step 5 with:

```md
5. Open the dashboard from the popup and confirm the entry appears there.
```

- [ ] **Step 5: Update Chrome Web Store checklist permission text**

In `docs/chrome-web-store-dashboard-checklist.md`, replace the `contextMenus` permission justification block with:

```text
contextMenus: Adds user-triggered "save as word", "save as quote", and "open dashboard" actions.
```

- [ ] **Step 6: Search for stale current references**

Run:

```bash
rg -n --glob '!tests/dashboard-access.test.ts' "entrypoints/newtab|newtab\\.html|new-tab override|New-tab dashboard|uses a new-tab override" README.md AGENTS.md docs/chrome-web-store.md docs/chrome-web-store-reviewer-notes.md docs/chrome-web-store-dashboard-checklist.md entrypoints tests
```

Expected: no matches in current source, non-guard tests, README, AGENTS, or Chrome Web Store docs.

- [ ] **Step 7: Run docs/source guard tests**

Run:

```bash
npx vitest run tests/dashboard-access.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit documentation updates**

```bash
git add README.md AGENTS.md docs/chrome-web-store-reviewer-notes.md docs/chrome-web-store-dashboard-checklist.md tests/dashboard-access.test.ts
git commit -m "docs: document optional dashboard access"
```

---

### Task 6: Regenerate WXT Types And Verify Manifest Output

**Files:**
- Generated, untracked check only: `.wxt/types/paths.d.ts`
- Build output, untracked check only: `.output/chrome-mv3/`

- [ ] **Step 1: Regenerate WXT types**

Run:

```bash
npx wxt prepare
```

Expected: exits 0.

- [ ] **Step 2: Confirm public paths are updated**

Run:

```bash
rg -n 'dashboard.html|newtab.html' .wxt/types/paths.d.ts
```

Expected output includes `/dashboard.html` and does not include `/newtab.html`.

- [ ] **Step 3: Run TypeScript compile**

Run:

```bash
npm run compile
```

Expected: exits 0.

- [ ] **Step 4: Run the full Vitest suite**

Run:

```bash
npm test
```

Expected: exits 0 with all tests passing.

- [ ] **Step 5: Build the extension**

Run:

```bash
npm run build
```

Expected: exits 0 and writes `.output/chrome-mv3/`.

- [ ] **Step 6: Inspect generated manifest**

Run:

```bash
cat .output/chrome-mv3/manifest.json
```

Expected: manifest contains `action.default_popup: "popup.html"`, contains `background.service_worker`, keeps existing permissions, and has no `chrome_url_overrides`.

- [ ] **Step 7: Run manifest assertions**

Run:

```bash
node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('.output/chrome-mv3/manifest.json','utf8')); if (m.chrome_url_overrides) throw new Error('chrome_url_overrides should be absent'); if (m.action?.default_popup !== 'popup.html') throw new Error('popup.html default popup missing'); if (!m.background?.service_worker) throw new Error('background service worker missing'); const p=m.permissions||[]; for (const permission of ['contextMenus','storage','activeTab','scripting','downloads','unlimitedStorage','clipboardRead']) { if (!p.includes(permission)) throw new Error('missing permission '+permission); } if (!fs.existsSync('.output/chrome-mv3/dashboard.html')) throw new Error('dashboard.html missing'); if (fs.existsSync('.output/chrome-mv3/newtab.html')) throw new Error('newtab.html should not exist'); console.log('manifest ok');"
```

Expected:

```text
manifest ok
```

- [ ] **Step 8: Confirm no tracked generated files were staged accidentally**

Run:

```bash
git status --short
```

Expected: only intentional source, test, and doc changes are tracked. `.wxt/` and `.output/` remain untracked or ignored.

---

## Final Acceptance Checklist

- [ ] `entrypoints/dashboard/index.html` exists.
- [ ] `entrypoints/newtab/index.html` does not exist.
- [ ] `browser.runtime.getURL('/dashboard.html')` is used for popup, background action menu, and settings back navigation.
- [ ] Popup button label uses `t(locale, 'popup.openDashboard')`.
- [ ] `MENU_OPEN_DASHBOARD` is registered with `contexts: ['action']`.
- [ ] Capture context menu behavior and command capture behavior remain unchanged.
- [ ] Current docs describe popup/action-menu dashboard access and do not describe a new-tab override.
- [ ] `npx wxt prepare` exits 0.
- [ ] `npm run compile` exits 0.
- [ ] `npm test` exits 0.
- [ ] `npm run build` exits 0.
- [ ] `.output/chrome-mv3/dashboard.html` exists.
- [ ] `.output/chrome-mv3/newtab.html` does not exist.
- [ ] `.output/chrome-mv3/manifest.json` has no `chrome_url_overrides`.
- [ ] `.output/chrome-mv3/manifest.json` keeps `action.default_popup: "popup.html"`.
- [ ] `.output/chrome-mv3/manifest.json` keeps existing permissions.

## Self-Review

- Spec coverage: Tasks 2, 4, and 6 cover the WXT entrypoint rename and manifest impact. Tasks 3 and 4 cover both user access points. Task 2 covers the settings back link. Task 5 covers all current documentation updates. Tasks 1 and 6 cover the requested focused tests and build verification.
- Placeholder scan: This plan contains no deferred implementation notes and no unspecified validation steps.
- Type consistency: The dashboard URL is consistently `/dashboard.html`, the menu id is consistently `MENU_OPEN_DASHBOARD`, the i18n key is consistently `popup.openDashboard`, and renamed imports consistently use `entrypoints/dashboard`.
