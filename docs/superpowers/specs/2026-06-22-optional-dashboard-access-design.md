# Optional Dashboard Access Design

## Goal

Make the dashboard optional instead of replacing every Chrome new tab. Users
should still have an obvious way to open the dashboard whenever they need it,
but installing the extension should not take over the browser's default new-tab
experience.

## Background

The current dashboard lives in `entrypoints/newtab/`. In WXT, `newtab/index.html`
is a special entrypoint that automatically emits:

```json
"chrome_url_overrides": {
  "newtab": "newtab.html"
}
```

That is convenient for daily use, but it is also a high-friction product choice:
some users dislike any extension that replaces their new-tab page. It can also
make Chrome Web Store reviewers look more closely at whether the override is
core to the extension.

The dashboard itself remains valuable. The change should remove the automatic
override, not remove the dashboard.

## Current Review Behavior

The app already has a review queue, but it should not be described as full
spaced repetition yet. `lib/review.ts` uses a fixed interval ladder:

```ts
[1, 3, 7, 14, 30, 60]
```

`viewReview` advances to the next fixed interval, `skipReview` moves an item to
tomorrow, and `repeatReview` keeps it in today's queue. This is useful, but it
does not model recall quality, ease, item difficulty, forgetting, graduating
states, relearning, or per-item interval adjustment. A real SRS pass should be a
separate feature.

## Non-Goals

- Do not add real SRS in this change.
- Do not redesign the dashboard UI.
- Do not remove the toolbar popup.
- Do not add a user setting to restore new-tab override behavior in this pass.
- Do not change capture, export, AI, dictionary, or review persistence behavior.

## Recommended Approach

Rename the dashboard entrypoint from WXT's special `newtab` entrypoint to a
normal unlisted extension page:

```text
entrypoints/newtab/      -> entrypoints/dashboard/
newtab.html              -> dashboard.html
```

Because WXT treats arbitrary HTML entrypoints as `unlisted-page`, the dashboard
will still be bundled and reachable through `browser.runtime.getURL`, but it
will no longer appear under `chrome_url_overrides`.

## User Access Points

Add two dashboard access points:

1. **Popup button:** Add an "Open dashboard" button in the toolbar popup. This
   is the primary discoverable path because most users click the extension icon.
2. **Extension action context menu:** Add an "Open dashboard" context-menu item
   with `contexts: ['action']`. This appears when the user right-clicks the
   extension toolbar icon.

Both access points should open:

```ts
browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html') });
```

The existing dashboard toolbar should keep its Settings button. The Settings
page "Back to dashboard" link should point to `/dashboard.html`.

## Manifest Impact

Expected generated manifest after the change:

- Keep `action.default_popup: "popup.html"`.
- Keep `background.service_worker`.
- Keep existing permissions.
- Remove `chrome_url_overrides.newtab`.
- Do not add new permissions.

`contextMenus` is already present and remains justified because the extension
uses both selection context menus and the new action context menu.

## File-Level Design

### Dashboard Entrypoint Move

Move the directory:

```text
entrypoints/newtab/
entrypoints/dashboard/
```

Update imports that refer to `entrypoints/newtab`, including tests and the
Settings page.

Important references:

- `entrypoints/settings/SettingsApp.tsx`
- `tests/ai-settings-location.test.ts`
- `tests/ai-components.test.tsx`
- `tests/word-card.test.tsx`
- docs that describe the current project structure

### Background Context Menu

Add a new menu id in `entrypoints/background/capture-handler.ts` or
`entrypoints/background/index.ts`:

```ts
export const MENU_OPEN_DASHBOARD = 'open-dashboard';
```

Register it on install:

```ts
browser.contextMenus.create({
  id: MENU_OPEN_DASHBOARD,
  title: 'Open dashboard (拾语汉字box)',
  contexts: ['action'],
});
```

Handle it in `contextMenus.onClicked`:

```ts
if (info.menuItemId === MENU_OPEN_DASHBOARD) {
  void browser.tabs.create({
    url: browser.runtime.getURL('/dashboard.html'),
  });
  return;
}
```

### Popup Button

In `entrypoints/popup/Popup.tsx`, add a visible secondary action:

```text
Open dashboard
```

Click behavior:

```ts
await browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html') });
window.close();
```

Use an existing lucide icon such as `LayoutDashboard` or `BookOpen`.

### Settings Back Link

Change:

```ts
browser.runtime.getURL('/newtab.html')
```

to:

```ts
browser.runtime.getURL('/dashboard.html')
```

## Testing

Use TDD where practical.

Focused tests:

- Add or update a background/context-menu test to verify the action menu item is
  registered and opens `/dashboard.html`.
- Update source-location tests from `entrypoints/newtab` to
  `entrypoints/dashboard`.
- Add a popup component/source test that verifies an "Open dashboard" action
  exists and targets `/dashboard.html`, or cover it in a component test if the
  current test harness supports the browser mock cleanly.

Build verification:

```bash
npm run compile
npm test
npm run build
cat .output/chrome-mv3/manifest.json
```

Expected manifest checks:

- `.output/chrome-mv3/dashboard.html` exists.
- `.output/chrome-mv3/newtab.html` does not exist.
- `manifest.chrome_url_overrides` is absent.
- `manifest.action.default_popup` remains `popup.html`.
- Permissions are unchanged.

## Documentation Updates

Update current docs that say the dashboard replaces new tab:

- `README.md`
- `docs/chrome-web-store-reviewer-notes.md`
- `docs/chrome-web-store-dashboard-checklist.md`
- Current AGENTS summary, if desired

Historical plans/specs can remain as history unless a current statement would
mislead Chrome Web Store submission notes.

Suggested user-facing wording:

```text
Open the dashboard from the toolbar popup or by right-clicking the extension icon
and choosing "Open dashboard."
```

## Risks

- Users who liked the new-tab takeover lose a one-keystroke dashboard path.
  Mitigation: the popup button is obvious and the action context-menu item is
  always available.
- Moving the entrypoint directory can create stale test imports. Mitigation:
  search for `entrypoints/newtab`, `newtab.html`, and `chrome_url_overrides`.
- Chrome action context menus are less discoverable than popup buttons.
  Mitigation: use the popup button as the primary access path.

## Acceptance Criteria

1. Installing the extension no longer changes Chrome's new-tab page.
2. Clicking the extension icon opens the popup, and the popup includes an
   "Open dashboard" action.
3. Right-clicking the extension icon exposes "Open dashboard (拾语汉字box)".
4. Both dashboard entry points open `dashboard.html`.
5. Settings can navigate back to `dashboard.html`.
6. Capture, review, export, AI, dictionary, backup, and restore behavior remain
   unchanged.
7. `npm run compile`, `npm test`, and `npm run build` pass.
8. The built manifest has no `chrome_url_overrides`.
