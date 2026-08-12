# Chrome Web Store Reviewer Notes

Last updated: 2026-08-11 (v0.5.0)

Use this file when filling the reviewer notes field during Chrome Web Store
submission.

**v0.5.0 note:** the Drift review mode added in this release introduces **no new
permissions** and makes no network requests. It reads the same locally stored
collection and writes a small local preference record. The permission audit in
`chrome-web-store.md` is unchanged from v0.4.5.

## Suggested Reviewer Notes

```text
拾语汉字box is a local-first Chinese reading extension. It captures selected text only after explicit user action through the context menu, keyboard shortcut, or toolbar popup. Saved entries are stored in local extension storage and can be exported as Markdown, zip, or JSON backup files.

AI is disabled by default. It powers two optional, user-triggered actions: "Ask AI" word insight, and "建议填空 / Suggest blanks" cloze suggestions for a saved quote. To test AI, open Settings, enable AI, choose a provider, enter a valid user-owned API key, and click Test Connection. The extension requests the provider host permission lazily at that point. Without a user-provided API key, all local dictionary, capture, and review features still work offline.

The bundled CC-CEDICT dictionary is packaged with the extension and used offline. The optional Kaikki workflow opens the Kaikki download page in a regular tab and processes a user-selected JSONL file locally.

The tts permission supports the user-triggered speaker button on saved words. Clicking the button passes only that saved word to a Chinese speech voice supplied by the operating system or an installed speech engine. The extension ranks the available Chinese voices rather than taking the first one reported, and Settings → Pronunciation lets the user override that choice and set the playback speed. Only voices the browser reports as on-device are selected unless the user turns on "Allow network voices", which is off by default; with it off, no pronunciation text leaves the computer. No audio is stored, and no developer-operated speech server is used.

The Review tab shows one due card at a time and schedules it locally from the user's Again, Hard, Good, or Easy rating. Word details are revealed on demand. Quotes are reviewed by cloze deletion: a newly saved quote starts "parked" with no blanks and does not enter the review queue until the user adds at least one blank. Blanks are added either manually (open "手动填空 / Mark blanks", wrap an answer span in braces, and click Apply) or via the optional "建议填空" AI suggestion. Each blank is an independent card; in review the active blank is hidden until the user clicks Reveal, which shows the full quote with the answer highlighted. When the user clicks "建议填空", the quote's sentence text is sent to the user-configured AI provider, the same opt-in path as other AI actions.

The Review tab has a second mode, "Drift", selectable in Settings and off by default. Drift replaces the scheduled queue with a weighted-random browse over the user's own saved entries, showing each card with all its saved detail already visible and no grading. Two thumb buttons adjust how often an entry reappears, on a bounded scale that never removes anything. Drift requires no network access, adds no permissions, writes only to local extension storage, and never modifies the spaced-repetition scheduling data — switching modes is reversible and non-destructive.

Quotes can be tagged. Tag chips are edited on each quote card with autocomplete, quotes can be filtered by tag, and a tag cloud allows rename and delete. Tags are stored locally and require no network access.

Folder sync is optional and off by default. When enabled, the extension writes an encrypted replica of the user's data to a folder the user selects through the browser's File System Access directory picker. The folder can be any local or cloud-synced directory (iCloud Drive, Dropbox, OneDrive, Syncthing, NAS, etc.); the extension does not call any provider API and operates no developer server. The entire payload, including the AI API key, is encrypted with the user's passphrase before being written. The alarms permission only schedules periodic background sync attempts once the user has configured sync.
```

## Manual Test Script

Use this flow for reviewer instructions or your own pre-submit smoke test.

1. Load or install the extension.
2. Open any normal webpage with Chinese text.
3. Select a Chinese word or phrase.
4. Right-click the selection and choose the extension action to save it as a
   word.
5. Select a longer Chinese sentence or passage.
6. Right-click the selection and save it as a quote.
7. Open the dashboard from the toolbar popup by clicking the extension icon and
   choosing **Open dashboard**.
8. Confirm the saved word and quote appear in the dashboard.
9. Expand the saved word. Local dictionary definitions, tone chips, source
   examples, and external dictionary links should appear without AI.
10. Click the speaker button beside the saved word and confirm it is pronounced
    with an installed Chinese voice. Click it again to stop playback. The voice
    and the playback speed can be changed in Settings → Pronunciation, which
    also offers a Test button.
11. On the saved quote card, add a cloze blank: open **手动填空 / Mark blanks**,
    wrap one word in braces (for example change `...刚需...` to `...{刚需}...`),
    and click **Apply / 应用**. Confirm the chosen word becomes a blank chip.
    (The quote is "parked" with no blanks until this step, so it would not
    otherwise appear in review.)
12. Open the **Review** tab. Confirm only one large card is visible.
13. For a word, click **Reveal / 查看答案**, choose a rating, and confirm the next
    due card replaces it.
14. For a quote, confirm the active blank is hidden on the front; click
    **Reveal** to show the full quote with the answer highlighted, then choose a
    rating.
15. Open **Settings** and, under **Review mode**, select **Drift (漫读)**.
    Return to the dashboard **Review** tab and confirm it now shows a single
    card with everything already visible — no hidden answer, no rating buttons —
    and a 👎 / Skip / 👍 row beneath it. Click 👍, confirm a different card
    appears, then click **Back** and confirm the first card returns.
16. Switch **Review mode** back to **Spaced repetition** and confirm the due
    queue is intact and unchanged — no card was rescheduled by drifting.
17. Click the daily Markdown export action and confirm Chrome downloads a
    `.md` file.
18. Click the zip export action and confirm Chrome downloads a `.zip` file.
19. Click the backup action and confirm Chrome downloads a `.json` backup file.
    The full backup also includes app settings and the AI API key for transfer
    to another device.
20. Open Settings from the dashboard.
21. Change the UI language between `zh-CN` and English, then return to the
    dashboard to confirm labels update.
22. Optional AI test: enable AI, choose a provider (DeepSeek, OpenAI,
    OpenRouter, Google Gemini, Qwen, Moonshot, or Zhipu), enter a valid API
    key, and click Test Connection. Then return to a saved word and click
    **Ask AI**, and on a saved quote click **建议填空** to fetch suggested blanks.
23. On a saved quote card, add a tag in the tag-chip editor and confirm a chip
    appears. Open the Quotes tab's **Cloud** sub-tab, confirm the tag appears
    sized by frequency, and click it to filter the **List** view.
24. Optional folder sync test: open **Settings → Folder Sync**, click **Create
    new vault**, choose an empty folder in the directory picker, and set a
    passphrase. Confirm the dashboard sync badge moves to **Synced** and that an
    encrypted file is written into the chosen folder. No network request is
    required for this step.

## Popup Fallback Test

Some pages restrict injected scripts or selection access. The popup provides a
manual fallback.

1. Click the extension toolbar icon.
2. Try saving the current selection as a word or quote.
3. If capture is unavailable, paste or type Chinese text into the fallback box.
4. Click the save button.
5. Open the dashboard from the popup and confirm the entry appears there.

## Privacy Boundary To Highlight

- Local dictionary insight is offline.
- External dictionary links open only when clicked.
- AI is opt-in, BYO-key, and initiated only by explicit user action.
- Cloze blank suggestions ("建议填空") are an AI action: clicking the button
  sends only that quote's sentence text to the user-configured provider. The
  user still chooses which suggested blanks to accept; nothing is auto-applied.
- API keys and generated AI insight are stored locally in extension storage.
- Review ratings, schedules, and history stay in local extension storage.
- Pronunciation runs only after a speaker-button click and stores no audio.
- The operating system or an installed speech engine provides the voice. By
  default only voices the browser reports as on-device are selected, so no
  pronunciation text leaves the computer. Network voices, which synthesize
  speech remotely, are off unless the user enables "Allow network voices" in
  Settings → Pronunciation and selects one; only then is the spoken word sent to
  that voice's provider.
- Markdown, zip, and backup files are created only after explicit download
  actions. The full backup additionally bundles app settings and the AI API key.
- Folder sync is off by default. When enabled it writes an encrypted replica to
  a user-chosen folder via the File System Access API; the payload (including the
  AI API key) is encrypted with the user's passphrase before being written, and
  no developer-operated server is used. Tags are stored locally.

## Known Limitations

- Chrome internal pages and some restricted pages cannot be scripted; use the
  popup manual fallback there.
- Newly saved quotes are "parked" with no cloze blanks and do not appear in the
  spaced-repetition queue until the user adds at least one blank (manually or
  via AI). They do appear in Drift, which has no such requirement.
- Drift weights and drift activity are per-device: they are carried in JSON
  backups but are not synchronized by folder sync. The selected review mode is
  likewise per-device.
- AI providers are an enumerated allow-list (DeepSeek, OpenAI, OpenRouter,
  Google Gemini, Qwen, Moonshot, Zhipu); each host permission is optional and
  requested lazily only for the selected provider. All endpoints use HTTPS.
- The pronunciation button is hidden if no usable Chinese voice is available.
  Novelty voices some systems ship (Apple's Eloquence set, for example) are
  never selected automatically, so a machine offering only those counts as
  having none.
- Kaikki dictionary import can take time for large JSONL files and should be
  run while the Settings page remains open.
- Folder sync requires a browser with File System Access support, is eventually
  consistent (not instant), and a forgotten passphrase cannot be recovered.
  Joining an existing vault replaces this profile's app and AI settings with the
  vault's while merging inbox entries.
