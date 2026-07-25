# Quote Translation (Google + AI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every quote card two one-click buttons that translate the whole quote into English — one via Google's free keyless endpoint, one via the existing BYO-key AI provider — persisting both results side by side.

**Architecture:** Two independent translation slots persist on `QuoteEntry.translations`, following the `traditionalText` precedent (generated only on explicit click, then stored). Pure parser modules are isolated from `fetch` transports so the breakage-prone Google response shape is unit-testable with no network. A presentational component takes all state as props; a single hook owns both request paths and the one storage write.

**Tech Stack:** TypeScript, React 19, WXT 0.20.26 (MV3), Vitest 4 + happy-dom, `@webext-core/fake-browser`, Tailwind 4.

## Global Constraints

- Target version: `0.4.2`.
- Source text for translation is always `quote.text` (Simplified). **Never** `traditionalText`.
- Translations are a display/export annotation only. Never use them for capture, dedupe, normalization, or SRS scheduling.
- The two slots are written independently. Writing one must never clear or overwrite the other.
- A failed request writes nothing to storage; the previous slot value survives.
- Failures are returned as `TranslateFailure` codes, never English prose. The component localizes them.
- All user-facing strings go in `lib/i18n.ts` under both `en` and `zh-CN`. `tests/i18n-source.test.ts` enforces key parity.
- Import style: use `@/*` where the file being edited already does; relative imports where it already uses those.
- For WXT storage import from `wxt/utils/storage`, not `wxt/storage`.
- No new npm dependencies.
- Every network call is one explicit user click. No automatic, batch, or on-render translation.

---

### Task 1: Persisted types, i18n strings, backup round-trip

Establishes the schema and every localized string the later tasks consume, and proves the new field survives backup/restore.

**Files:**
- Modify: `lib/types.ts`
- Create: `lib/translate/types.ts`
- Modify: `lib/i18n.ts`
- Test: `tests/backup.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `QuoteTranslation { text: string; generatedAt: number }`
  - `AiQuoteTranslation extends QuoteTranslation { provider: AiProvider; model: string; baseUrl: string }`
  - `QuoteTranslations { google?: QuoteTranslation; ai?: AiQuoteTranslation }`
  - `QuoteEntry.translations?: QuoteTranslations`
  - `TranslateFailure = 'rate-limited' | 'unreachable' | 'unexpected' | 'permission-denied' | 'empty' | 'not-configured'`
  - `TranslateResult = { ok: true; text: string } | { ok: false; code: TranslateFailure; detail?: string }`
  - i18n keys `translate.*` listed in Step 4.

- [ ] **Step 1: Write the failing backup round-trip test**

Append to `tests/backup.test.ts`:

```ts
describe('backup preserves quote translations', () => {
  it('round-trips both translation slots through serialize and parse', () => {
    const translated: QuoteEntry = {
      id: 'q9',
      kind: 'quote',
      text: '天地不仁',
      tags: [],
      note: '',
      status: 'inbox',
      createdAt: 1,
      updatedAt: 2,
      sourceTitle: 'Laozi',
      sourceUrl: 'https://example.com',
      sourceDomain: 'example.com',
      surrounding: '天地不仁，以万物为刍狗',
      translations: {
        google: { text: 'Heaven and earth are not kind', generatedAt: 100 },
        ai: {
          text: 'Nature shows no favour',
          generatedAt: 200,
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          baseUrl: 'https://api.deepseek.com',
        },
      },
    };

    const restored = parseBackup(serializeBackup({ words: [], quotes: [translated] }));

    expect(restored.quotes[0].translations).toEqual(translated.translations);
  });

  it('leaves translations undefined for an untranslated quote', () => {
    const plain: QuoteEntry = {
      id: 'q10',
      kind: 'quote',
      text: '学而时习之',
      tags: [],
      note: '',
      status: 'inbox',
      createdAt: 1,
      updatedAt: 1,
      sourceTitle: 'Lunyu',
      sourceUrl: 'https://lunyu.com',
      sourceDomain: 'lunyu.com',
      surrounding: '不亦说乎',
    };

    const restored = parseBackup(serializeBackup({ words: [], quotes: [plain] }));

    expect(restored.quotes[0].translations).toBeUndefined();
  });
});
```

Check the existing imports at the top of `tests/backup.test.ts`. Add `serializeBackup` and `parseBackup` to the import list from `'../lib/backup'` if they are not already there, and `QuoteEntry` to the type import from `'../lib/types'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/backup.test.ts`
Expected: FAIL — TypeScript rejects `translations` because it is not a property of `QuoteEntry`.

- [ ] **Step 3: Add the persisted types**

In `lib/types.ts`, add these three interfaces immediately after the existing `AiInsight` interface (they reference `AiProvider`, which is declared in the same AI settings block):

```ts
/** One English translation of a whole quote, generated on explicit request. */
export interface QuoteTranslation {
  text: string;
  generatedAt: number;
}

/** AI-generated translation, carrying provider provenance like AiInsight. */
export interface AiQuoteTranslation extends QuoteTranslation {
  provider: AiProvider;
  model: string;
  baseUrl: string;
}

/**
 * Per-source English translation slots for a quote. Each slot is written
 * independently; filling one never clears the other.
 */
export interface QuoteTranslations {
  google?: QuoteTranslation;
  ai?: AiQuoteTranslation;
}
```

Interface declarations hoist, so forward-referencing `AiProvider` from `QuoteEntry` is fine — `WordEntry.aiInsight` already does exactly this.

Then extend `QuoteEntry`:

```ts
export interface QuoteEntry extends EntryBase {
  kind: 'quote';
  tags: string[];
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  surrounding: string;
  clozes?: Cloze[];    // absent or [] => parked (not review-eligible)
  /** English translations generated on demand. Display/export annotation only. */
  translations?: QuoteTranslations;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/backup.test.ts`
Expected: PASS. `lib/backup.ts` needs no change — `hasEntryBase` deliberately skips optional fields added after format v1, and `cloneJson` preserves unknown keys. This test exists to pin that behavior so a future validation tightening cannot silently drop the field.

- [ ] **Step 5: Create the translate result types**

Create `lib/translate/types.ts`:

```ts
/**
 * Why a translation request failed. A code rather than prose so the UI can
 * localize it — see the `translate.err*` keys in lib/i18n.ts.
 */
export type TranslateFailure =
  | 'rate-limited'
  | 'unreachable'
  | 'unexpected'
  | 'permission-denied'
  | 'empty'
  | 'not-configured';

/**
 * Shared result shape for both the Google and AI translation paths, so the
 * hook and the component can treat them identically.
 * `detail` optionally carries a provider's own message (the AI path returns
 * prose reasons) to append after the localized line.
 */
export type TranslateResult =
  | { ok: true; text: string }
  | { ok: false; code: TranslateFailure; detail?: string };
```

- [ ] **Step 6: Add the i18n keys**

In `lib/i18n.ts`, add these to the `en` table immediately after the `'traditional.hide'` line:

```ts
    'translate.googleShort': 'EN·G',
    'translate.aiShort': 'EN·AI',
    'translate.googleTitle': 'Translate to English with Google',
    'translate.aiTitle': 'Translate to English with AI',
    'translate.showGoogle': 'Show Google translation',
    'translate.hideGoogle': 'Hide Google translation',
    'translate.showAi': 'Show AI translation',
    'translate.hideAi': 'Hide AI translation',
    'translate.labelGoogle': 'EN (Google)',
    'translate.labelAi': 'EN (AI)',
    'translate.loading': 'Translating...',
    'translate.retry': 'Retry',
    'translate.errRateLimited': 'Google rate-limited this request; try again later.',
    'translate.errUnreachable': 'Translation service unreachable; retry.',
    'translate.errUnexpected': 'Unexpected translation response.',
    'translate.errPermissionDenied': 'Google Translate permission was not granted.',
    'translate.errEmpty': 'Nothing to translate.',
    'translate.errNotConfigured': 'Configure AI in Settings to translate.',
```

And the matching keys in the `'zh-CN'` table, after its `'traditional.hide'` line:

```ts
    'translate.googleShort': 'EN·G',
    'translate.aiShort': 'EN·AI',
    'translate.googleTitle': '用 Google 翻译成英文',
    'translate.aiTitle': '用 AI 翻译成英文',
    'translate.showGoogle': '显示 Google 译文',
    'translate.hideGoogle': '隐藏 Google 译文',
    'translate.showAi': '显示 AI 译文',
    'translate.hideAi': '隐藏 AI 译文',
    'translate.labelGoogle': 'EN（Google）',
    'translate.labelAi': 'EN（AI）',
    'translate.loading': '翻译中...',
    'translate.retry': '重试',
    'translate.errRateLimited': 'Google 请求频率受限，请稍后重试。',
    'translate.errUnreachable': '翻译服务无法访问，请重试。',
    'translate.errUnexpected': '翻译响应异常。',
    'translate.errPermissionDenied': '未授予 Google 翻译权限。',
    'translate.errEmpty': '没有可翻译的内容。',
    'translate.errNotConfigured': '请在设置中配置 AI 后再翻译。',
```

- [ ] **Step 7: Verify parity and compilation**

Run: `npx vitest run tests/i18n-source.test.ts tests/backup.test.ts && npm run compile`
Expected: PASS, and `tsc --noEmit` exits 0. The parity test fails loudly if any key is missing from either table.

- [ ] **Step 8: Commit**

```bash
git add lib/types.ts lib/translate/types.ts lib/i18n.ts tests/backup.test.ts
git commit -m "feat(types): add quote translation slots, result codes, and i18n strings"
```

---

### Task 2: Google gtx response parser

The gtx endpoint returns a nested array whose element `[0]` holds **one entry per sentence segment**. A long quote comes back split across several segments, so the parser must join them in order. This is the most breakage-prone piece of the feature, which is why it is a pure function with no `fetch`.

**Files:**
- Create: `lib/translate/google-parse.ts`
- Test: `tests/translate-google-parse.test.ts`

**Interfaces:**
- Consumes: `TranslateResult` from `lib/translate/types.ts` (Task 1).
- Produces: `parseGtxResponse(json: unknown): TranslateResult`

- [ ] **Step 1: Write the failing test**

Create `tests/translate-google-parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseGtxResponse } from '../lib/translate/google-parse';

describe('parseGtxResponse', () => {
  it('reads a single-segment translation', () => {
    const body = [[['Learning is a joy', '学而时习之', null, null, 3]], null, 'zh-CN'];
    expect(parseGtxResponse(body)).toEqual({ ok: true, text: 'Learning is a joy' });
  });

  it('joins every sentence segment in order', () => {
    const body = [
      [
        ['Heaven and earth are not benevolent, ', '天地不仁，', null, null, 3],
        ['treating all things as straw dogs', '以万物为刍狗', null, null, 3],
      ],
      null,
      'zh-CN',
    ];
    expect(parseGtxResponse(body)).toEqual({
      ok: true,
      text: 'Heaven and earth are not benevolent, treating all things as straw dogs',
    });
  });

  it('skips a non-string segment head rather than failing the whole parse', () => {
    const body = [[['Kept text', '保留', null, null, 3], [null, '丢弃', null, null, 3]]];
    expect(parseGtxResponse(body)).toEqual({ ok: true, text: 'Kept text' });
  });

  it('rejects a non-array body as unexpected', () => {
    expect(parseGtxResponse({ translation: 'nope' })).toEqual({ ok: false, code: 'unexpected' });
  });

  it('rejects a body whose first element is not an array', () => {
    expect(parseGtxResponse(['not-segments', null, 'zh-CN'])).toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('rejects null', () => {
    expect(parseGtxResponse(null)).toEqual({ ok: false, code: 'unexpected' });
  });

  it('reports empty when every segment head is unusable', () => {
    const body = [[[null, '一', null, null, 3], ['   ', '二', null, null, 3]]];
    expect(parseGtxResponse(body)).toEqual({ ok: false, code: 'empty' });
  });

  it('reports empty for a zero-segment body', () => {
    expect(parseGtxResponse([[], null, 'zh-CN'])).toEqual({ ok: false, code: 'empty' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/translate-google-parse.test.ts`
Expected: FAIL — cannot resolve `../lib/translate/google-parse`.

- [ ] **Step 3: Write the implementation**

Create `lib/translate/google-parse.ts`:

```ts
import type { TranslateResult } from './types';

/**
 * Parse the undocumented `translate_a/single?client=gtx` response.
 *
 * Shape (only element [0] matters to us):
 *   [ [ ["<english>", "<chinese>", null, null, n], ... ], null, "zh-CN", ... ]
 *
 * Element [0] holds one entry per sentence segment, so a multi-sentence quote
 * arrives split and MUST be rejoined in order. Google does not document this
 * endpoint and can change it, so every deviation returns a failure code rather
 * than throwing.
 */
export function parseGtxResponse(json: unknown): TranslateResult {
  if (!Array.isArray(json)) return { ok: false, code: 'unexpected' };

  const segments = json[0];
  if (!Array.isArray(segments)) return { ok: false, code: 'unexpected' };

  let text = '';
  for (const segment of segments) {
    if (!Array.isArray(segment)) continue;
    const head = segment[0];
    if (typeof head !== 'string') continue;
    text += head;
  }

  if (text.trim() === '') return { ok: false, code: 'empty' };
  return { ok: true, text };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/translate-google-parse.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/translate/google-parse.ts tests/translate-google-parse.test.ts
git commit -m "feat(translate): parse the Google gtx response, joining sentence segments"
```

---

### Task 3: Google transport and host permission

**Files:**
- Create: `lib/translate/google.ts`
- Create: `lib/translate/permissions.ts`
- Test: `tests/translate-google.test.ts`

**Interfaces:**
- Consumes: `parseGtxResponse` (Task 2), `TranslateResult` (Task 1).
- Produces:
  - `GOOGLE_TRANSLATE_ORIGIN = 'https://translate.googleapis.com/*'`
  - `fetchGoogleTranslation(params: { text: string }): Promise<TranslateResult>`
  - `requestGoogleTranslatePermission(): Promise<boolean>`
  - `hasGoogleTranslatePermission(): Promise<boolean>`

`lib/translate/google.ts` stays a pure transport with no permission awareness — the hook in Task 7 requests the permission before calling it. That keeps this module testable with nothing but a mocked `fetch`.

- [ ] **Step 1: Write the failing test**

Create `tests/translate-google.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';
import { fetchGoogleTranslation } from '../lib/translate/google';
import {
  GOOGLE_TRANSLATE_ORIGIN,
  hasGoogleTranslatePermission,
  requestGoogleTranslatePermission,
} from '../lib/translate/permissions';

function gtxResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const OK_BODY = [[['Learning is a joy', '学而时习之', null, null, 3]], null, 'zh-CN'];

describe('fetchGoogleTranslation', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the gtx URL with encoded query text and zh-CN to en', async () => {
    fetchSpy.mockResolvedValue(gtxResponse(OK_BODY));

    await fetchGoogleTranslation({ text: '学而时习之' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url.startsWith('https://translate.googleapis.com/translate_a/single?')).toBe(true);
    expect(url).toContain('client=gtx');
    expect(url).toContain('sl=zh-CN');
    expect(url).toContain('tl=en');
    expect(url).toContain('dt=t');
    expect(url).toContain(`q=${encodeURIComponent('学而时习之')}`);
  });

  it('returns the parsed translation on success', async () => {
    fetchSpy.mockResolvedValue(gtxResponse(OK_BODY));
    await expect(fetchGoogleTranslation({ text: '学而时习之' })).resolves.toEqual({
      ok: true,
      text: 'Learning is a joy',
    });
  });

  it('maps HTTP 429 to rate-limited', async () => {
    fetchSpy.mockResolvedValue(gtxResponse(null, 429));
    await expect(fetchGoogleTranslation({ text: '你好' })).resolves.toEqual({
      ok: false,
      code: 'rate-limited',
    });
  });

  it('maps HTTP 500 to unreachable', async () => {
    fetchSpy.mockResolvedValue(gtxResponse(null, 503));
    await expect(fetchGoogleTranslation({ text: '你好' })).resolves.toEqual({
      ok: false,
      code: 'unreachable',
    });
  });

  it('maps other non-2xx statuses to unexpected', async () => {
    fetchSpy.mockResolvedValue(gtxResponse(null, 404));
    await expect(fetchGoogleTranslation({ text: '你好' })).resolves.toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('maps a network rejection to unreachable', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchGoogleTranslation({ text: '你好' })).resolves.toEqual({
      ok: false,
      code: 'unreachable',
    });
  });

  it('maps a body that fails JSON parsing to unexpected', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    } as unknown as Response);
    await expect(fetchGoogleTranslation({ text: '你好' })).resolves.toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('propagates the parser failure code for a malformed body', async () => {
    fetchSpy.mockResolvedValue(gtxResponse({ nope: true }));
    await expect(fetchGoogleTranslation({ text: '你好' })).resolves.toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('short-circuits blank input without any fetch', async () => {
    await expect(fetchGoogleTranslation({ text: '   ' })).resolves.toEqual({
      ok: false,
      code: 'empty',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Google Translate host permission', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests exactly the translate.googleapis.com origin', async () => {
    const spy = vi
      .spyOn(fakeBrowser.permissions, 'request')
      .mockResolvedValue(true);

    await expect(requestGoogleTranslatePermission()).resolves.toBe(true);
    expect(spy).toHaveBeenCalledWith({ origins: [GOOGLE_TRANSLATE_ORIGIN] });
  });

  it('returns false when the user denies the request', async () => {
    vi.spyOn(fakeBrowser.permissions, 'request').mockResolvedValue(false);
    await expect(requestGoogleTranslatePermission()).resolves.toBe(false);
  });

  it('returns false when the permissions API throws', async () => {
    vi.spyOn(fakeBrowser.permissions, 'request').mockRejectedValue(new Error('no gesture'));
    await expect(requestGoogleTranslatePermission()).resolves.toBe(false);
  });

  it('reports whether the origin is already granted', async () => {
    vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(true);
    await expect(hasGoogleTranslatePermission()).resolves.toBe(true);
  });

  it('reports false when the contains check throws', async () => {
    vi.spyOn(fakeBrowser.permissions, 'contains').mockRejectedValue(new Error('boom'));
    await expect(hasGoogleTranslatePermission()).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/translate-google.test.ts`
Expected: FAIL — cannot resolve `../lib/translate/google` and `../lib/translate/permissions`.

- [ ] **Step 3: Write the transport**

Create `lib/translate/google.ts`:

```ts
import { parseGtxResponse } from './google-parse';
import type { TranslateResult } from './types';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

/**
 * Google's undocumented keyless translation endpoint. It needs no API key and
 * no account, but it is unsupported: it can rate-limit or change shape without
 * notice, so every deviation becomes a retryable failure code.
 *
 * This module is deliberately permission-unaware — callers request the host
 * permission first (see lib/translate/permissions.ts) so this stays testable
 * with nothing but a mocked fetch.
 */
export async function fetchGoogleTranslation(params: {
  text: string;
}): Promise<TranslateResult> {
  if (params.text.trim() === '') return { ok: false, code: 'empty' };

  const url =
    `${ENDPOINT}?client=gtx&sl=zh-CN&tl=en&dt=t&q=${encodeURIComponent(params.text)}`;

  try {
    const response = await fetch(url);

    if (response.status === 429) return { ok: false, code: 'rate-limited' };
    if (response.status >= 500) return { ok: false, code: 'unreachable' };
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, code: 'unexpected' };
    }

    // Inner guard: a body that fails JSON parsing is `unexpected` (Google sent
    // something we don't understand), distinct from the outer `unreachable`
    // (we never got a response at all).
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, code: 'unexpected' };
    }

    return parseGtxResponse(body);
  } catch {
    return { ok: false, code: 'unreachable' };
  }
}
```

The two nested `try` blocks are deliberate: without the inner guard, a
`SyntaxError` from `json()` would fall through to the outer `catch` and be
misreported as `unreachable`. The "maps a body that fails JSON parsing to
unexpected" test in Step 1 pins that distinction.

- [ ] **Step 4: Write the permission helper**

Create `lib/translate/permissions.ts`:

```ts
import { browser } from 'wxt/browser';

export const GOOGLE_TRANSLATE_ORIGIN = 'https://translate.googleapis.com/*';

/**
 * Lazily request the Google Translate host permission. Must be called from a
 * user gesture (a button click), mirroring lib/ai/permissions.ts.
 */
export async function requestGoogleTranslatePermission(): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: [GOOGLE_TRANSLATE_ORIGIN] });
  } catch {
    return false;
  }
}

export async function hasGoogleTranslatePermission(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [GOOGLE_TRANSLATE_ORIGIN] });
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/translate-google.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/translate/google.ts lib/translate/permissions.ts tests/translate-google.test.ts
git commit -m "feat(translate): add the Google gtx transport and its optional host permission"
```

---

### Task 4: AI translation prompt and parser

**Files:**
- Create: `lib/ai/translate-prompt.ts`
- Create: `lib/ai/translate-parse.ts`
- Test: `tests/ai-translate-prompt.test.ts`
- Test: `tests/ai-translate-parse.test.ts`

**Interfaces:**
- Consumes: `AiMessage` from `lib/ai/prompt.ts`, `TranslateResult` (Task 1).
- Produces:
  - `buildTranslateMessages(quoteText: string): AiMessage[]`
  - `parseTranslation(content: string): TranslateResult`

- [ ] **Step 1: Write the failing prompt test**

Create `tests/ai-translate-prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildTranslateMessages } from '../lib/ai/translate-prompt';

describe('buildTranslateMessages', () => {
  it('returns a system message then a user message', () => {
    const messages = buildTranslateMessages('学而时习之');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('instructs the model to return JSON only in the translation shape', () => {
    const system = buildTranslateMessages('学而时习之')[0].content;
    expect(system).toContain('"translation"');
    expect(system).toContain('JSON');
  });

  it('carries the quote text verbatim in the user message', () => {
    const user = buildTranslateMessages('天地不仁，以万物为刍狗')[1].content;
    expect(user).toContain('天地不仁，以万物为刍狗');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/ai-translate-prompt.test.ts`
Expected: FAIL — cannot resolve `../lib/ai/translate-prompt`.

- [ ] **Step 3: Write the prompt builder**

Create `lib/ai/translate-prompt.ts`:

```ts
import type { AiMessage } from './prompt';

const SYSTEM_PROMPT = `You translate Chinese sentences into natural English. Given one Chinese sentence, produce a single fluent English rendering that reads as an English sentence, not a word-for-word gloss.

Return valid JSON only, no markdown, in this shape:
{"translation":"Heaven and earth are not kind; they treat all things as straw dogs."}

Do not add pinyin, commentary, alternatives, or explanation. Respond with JSON only.`;

export function buildTranslateMessages(quoteText: string): AiMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Sentence: ${quoteText}` },
  ];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/ai-translate-prompt.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing parser test**

Create `tests/ai-translate-parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseTranslation } from '../lib/ai/translate-parse';

describe('parseTranslation', () => {
  it('accepts a valid translation object', () => {
    expect(parseTranslation('{"translation":"Learning is a joy"}')).toEqual({
      ok: true,
      text: 'Learning is a joy',
    });
  });

  it('trims surrounding whitespace from the translation', () => {
    expect(parseTranslation('{"translation":"  Learning is a joy \\n"}')).toEqual({
      ok: true,
      text: 'Learning is a joy',
    });
  });

  it('rejects invalid JSON', () => {
    expect(parseTranslation('not json')).toEqual({ ok: false, code: 'unexpected' });
  });

  it('rejects a JSON array', () => {
    expect(parseTranslation('["Learning is a joy"]')).toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('rejects JSON null', () => {
    expect(parseTranslation('null')).toEqual({ ok: false, code: 'unexpected' });
  });

  it('rejects a missing translation key', () => {
    expect(parseTranslation('{"text":"Learning is a joy"}')).toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('rejects a non-string translation', () => {
    expect(parseTranslation('{"translation":42}')).toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('rejects a whitespace-only translation', () => {
    expect(parseTranslation('{"translation":"   "}')).toEqual({
      ok: false,
      code: 'unexpected',
    });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/ai-translate-parse.test.ts`
Expected: FAIL — cannot resolve `../lib/ai/translate-parse`.

- [ ] **Step 7: Write the parser**

Create `lib/ai/translate-parse.ts`:

```ts
import type { TranslateResult } from '../translate/types';

/**
 * Validate the model's JSON reply into a single English string. Any deviation
 * is `unexpected` — the caller shows a localized retry, never raw model output.
 */
export function parseTranslation(content: string): TranslateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, code: 'unexpected' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: 'unexpected' };
  }

  const translation = (parsed as Record<string, unknown>).translation;
  if (typeof translation !== 'string' || translation.trim() === '') {
    return { ok: false, code: 'unexpected' };
  }

  return { ok: true, text: translation.trim() };
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npx vitest run tests/ai-translate-parse.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 9: Commit**

```bash
git add lib/ai/translate-prompt.ts lib/ai/translate-parse.ts tests/ai-translate-prompt.test.ts tests/ai-translate-parse.test.ts
git commit -m "feat(ai): add the quote translation prompt and response parser"
```

---

### Task 5: AI translation client call

**Files:**
- Modify: `lib/ai/client.ts`
- Test: `tests/ai-translate-client.test.ts`

**Interfaces:**
- Consumes: the existing private `postChatCompletion` in `lib/ai/client.ts`, `buildTranslateMessages` and `parseTranslation` (Task 4), `TranslateResult` (Task 1).
- Produces:

```ts
fetchAiTranslation(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: AiProvider;
  quoteText: string;
}): Promise<TranslateResult>
```

Returning the shared `TranslateResult` is what lets Task 7's hook and Task 6's component treat the Google and AI paths identically.

- [ ] **Step 1: Write the failing test**

Create `tests/ai-translate-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAiTranslation } from '../lib/ai/client';

function completion(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

function errorResponse(status: number, message?: string): Response {
  return {
    ok: false,
    status,
    json: async () => (message ? { error: { message } } : {}),
  } as unknown as Response;
}

const PARAMS = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test',
  model: 'deepseek-v4-flash',
  provider: 'deepseek' as const,
  quoteText: '学而时习之',
};

describe('fetchAiTranslation', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts to the chat completions endpoint and returns the translation', async () => {
    fetchSpy.mockResolvedValue(completion('{"translation":"Learning is a joy"}'));

    await expect(fetchAiTranslation(PARAMS)).resolves.toEqual({
      ok: true,
      text: 'Learning is a joy',
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.max_tokens).toBe(400);
    expect(JSON.stringify(body.messages)).toContain('学而时习之');
  });

  it('maps a 5xx provider status to unreachable and keeps the provider detail', async () => {
    fetchSpy.mockResolvedValue(errorResponse(503, 'upstream down'));

    const result = await fetchAiTranslation(PARAMS);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('unreachable');
    expect(result.detail).toContain('upstream down');
  });

  it('maps a rejected API key to unexpected and keeps the provider detail', async () => {
    fetchSpy.mockResolvedValue(errorResponse(401, 'bad key'));

    const result = await fetchAiTranslation(PARAMS);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('unexpected');
    expect(result.detail).toContain('bad key');
  });

  it('maps a network rejection to unreachable', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchAiTranslation(PARAMS)).resolves.toEqual({
      ok: false,
      code: 'unreachable',
    });
  });

  it('maps an unparseable model reply to unexpected', async () => {
    fetchSpy.mockResolvedValue(completion('I cannot do that'));
    await expect(fetchAiTranslation(PARAMS)).resolves.toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('short-circuits blank quote text without any fetch', async () => {
    await expect(fetchAiTranslation({ ...PARAMS, quoteText: '  ' })).resolves.toEqual({
      ok: false,
      code: 'empty',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-translate-client.test.ts`
Expected: FAIL — `fetchAiTranslation` is not exported from `../lib/ai/client`.

- [ ] **Step 3: Add the client function**

In `lib/ai/client.ts`, extend the existing imports at the top of the file:

```ts
import { buildTranslateMessages } from './translate-prompt';
import { parseTranslation } from './translate-parse';
import type { TranslateResult } from '../translate/types';
```

Then add this function after the existing `fetchClozeSuggestions`:

```ts
export async function fetchAiTranslation(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: AiProvider;
  quoteText: string;
}): Promise<TranslateResult> {
  if (params.quoteText.trim() === '') return { ok: false, code: 'empty' };

  try {
    const result = await postChatCompletion({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      provider: params.provider,
      messages: buildTranslateMessages(params.quoteText),
      maxTokens: 400,
    });

    if (!result.ok) {
      // postChatCompletion returns prose reasons; keep them as `detail` so
      // provider errors stay debuggable behind the localized message.
      const code = /unreachable|retry/i.test(result.reason) ? 'unreachable' : 'unexpected';
      return { ok: false, code, detail: result.reason };
    }

    return parseTranslation(result.content);
  } catch {
    return { ok: false, code: 'unreachable' };
  }
}
```

The `unreachable` test relies on `classifyHttpStatus` already returning `'Provider unreachable; retry.'` for status `>= 500`, which the regex matches. The 401 path returns `'API key rejected by provider.'`, which does not match, so it maps to `unexpected` — both asserted in Step 1.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-translate-client.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Confirm no regression in the existing AI client tests**

Run: `npx vitest run tests/ai-client.test.ts tests/ai-cloze-client.test.ts`
Expected: PASS — the new function reuses `postChatCompletion` without altering it.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/client.ts tests/ai-translate-client.test.ts
git commit -m "feat(ai): add fetchAiTranslation returning the shared translate result"
```

---

### Task 6: TranslateButtons presentational component

A pure props-driven component: no hook, no network, no storage. Fully testable with zero mocks.

**Files:**
- Create: `entrypoints/dashboard/components/TranslateButtons.tsx`
- Test: `tests/translate-buttons.test.tsx`

**Interfaces:**
- Consumes: `TranslateFailure` (Task 1), i18n keys (Task 1).
- Produces:

```ts
export type TranslateSlotState = 'idle' | 'loading' | 'error' | 'disabled';

export interface TranslateSlot {
  state: TranslateSlotState;
  failure?: TranslateFailure;
  detail?: string;
}

export function TranslateButtons(props: {
  google: TranslateSlot;
  ai: TranslateSlot;
  hasGoogle: boolean;
  hasAi: boolean;
  shownGoogle: boolean;
  shownAi: boolean;
  onTranslateGoogle: () => void;
  onTranslateAi: () => void;
  onToggleGoogle: () => void;
  onToggleAi: () => void;
  locale: UiLocale;
}): JSX.Element;
```

`hasGoogle` / `hasAi` mean "a stored translation exists for this slot". The component also exports the failure-to-i18n-key mapping so Task 8 does not duplicate it:

```ts
export function failureMessageKey(failure: TranslateFailure): MessageKey;
```

- [ ] **Step 1: Write the failing test**

Create `tests/translate-buttons.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TranslateButtons,
  type TranslateSlot,
} from '../entrypoints/dashboard/components/TranslateButtons';
import { messages } from '../lib/i18n';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function renderClient(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function queryButton(label: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(label),
    ) ?? null
  ) as HTMLButtonElement | null;
}

async function click(btn: HTMLButtonElement) {
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const IDLE: TranslateSlot = { state: 'idle' };

function props(over: Partial<Parameters<typeof TranslateButtons>[0]> = {}) {
  return {
    google: IDLE,
    ai: IDLE,
    hasGoogle: false,
    hasAi: false,
    shownGoogle: false,
    shownAi: false,
    onTranslateGoogle: vi.fn(),
    onTranslateAi: vi.fn(),
    onToggleGoogle: vi.fn(),
    onToggleAi: vi.fn(),
    locale: 'en' as const,
    ...over,
  };
}

describe('TranslateButtons', () => {
  it('renders both generate chips when no translation exists', async () => {
    await renderClient(<TranslateButtons {...props()} />);
    expect(queryButton(messages.en['translate.googleShort'])).not.toBeNull();
    expect(queryButton(messages.en['translate.aiShort'])).not.toBeNull();
  });

  it('calls onTranslateGoogle when the Google chip is clicked', async () => {
    const p = props();
    await renderClient(<TranslateButtons {...p} />);
    await click(queryButton(messages.en['translate.googleShort'])!);
    expect(p.onTranslateGoogle).toHaveBeenCalledTimes(1);
    expect(p.onTranslateAi).not.toHaveBeenCalled();
  });

  it('calls onTranslateAi when the AI chip is clicked', async () => {
    const p = props();
    await renderClient(<TranslateButtons {...p} />);
    await click(queryButton(messages.en['translate.aiShort'])!);
    expect(p.onTranslateAi).toHaveBeenCalledTimes(1);
    expect(p.onTranslateGoogle).not.toHaveBeenCalled();
  });

  it('shows a disabled loading chip while a slot is in flight', async () => {
    await renderClient(<TranslateButtons {...props({ google: { state: 'loading' } })} />);
    const chip = queryButton(messages.en['translate.loading'])!;
    expect(chip).not.toBeNull();
    expect(chip.disabled).toBe(true);
  });

  it('disables the AI chip and explains when AI is not configured', async () => {
    await renderClient(
      <TranslateButtons
        {...props({ ai: { state: 'disabled', failure: 'not-configured' } })}
      />,
    );
    expect(queryButton(messages.en['translate.aiShort'])!.disabled).toBe(true);
    expect(container.textContent).toContain(messages.en['translate.errNotConfigured']);
  });

  it('offers Retry with a localized message on a rate-limited failure', async () => {
    const p = props({ google: { state: 'error', failure: 'rate-limited' } });
    await renderClient(<TranslateButtons {...p} />);
    expect(container.textContent).toContain(messages.en['translate.errRateLimited']);
    await click(queryButton(messages.en['translate.retry'])!);
    expect(p.onTranslateGoogle).toHaveBeenCalledTimes(1);
  });

  it('appends the provider detail after the localized message', async () => {
    await renderClient(
      <TranslateButtons
        {...props({ ai: { state: 'error', failure: 'unreachable', detail: 'upstream down' } })}
      />,
    );
    expect(container.textContent).toContain(messages.en['translate.errUnreachable']);
    expect(container.textContent).toContain('upstream down');
  });

  it('shows independent error lines for both slots at once', async () => {
    await renderClient(
      <TranslateButtons
        {...props({
          google: { state: 'error', failure: 'rate-limited' },
          ai: { state: 'error', failure: 'unexpected' },
        })}
      />,
    );
    expect(container.textContent).toContain(messages.en['translate.errRateLimited']);
    expect(container.textContent).toContain(messages.en['translate.errUnexpected']);
  });

  it('turns a chip into a hide toggle once its translation exists and is shown', async () => {
    const p = props({ hasGoogle: true, shownGoogle: true });
    await renderClient(<TranslateButtons {...p} />);
    const chip = queryButton(messages.en['translate.googleShort'])!;
    expect(chip.title).toBe(messages.en['translate.hideGoogle']);
    await click(chip);
    expect(p.onToggleGoogle).toHaveBeenCalledTimes(1);
    expect(p.onTranslateGoogle).not.toHaveBeenCalled();
  });

  it('titles the chip as a show toggle when the translation is hidden', async () => {
    await renderClient(<TranslateButtons {...props({ hasAi: true, shownAi: false })} />);
    expect(queryButton(messages.en['translate.aiShort'])!.title).toBe(
      messages.en['translate.showAi'],
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/translate-buttons.test.tsx`
Expected: FAIL — cannot resolve `../entrypoints/dashboard/components/TranslateButtons`.

- [ ] **Step 3: Write the component**

Create `entrypoints/dashboard/components/TranslateButtons.tsx`:

```tsx
import { Languages, Loader2 } from 'lucide-react';
import { t, type MessageKey } from '@/lib/i18n';
import type { TranslateFailure } from '@/lib/translate/types';
import type { UiLocale } from '@/lib/types';

export type TranslateSlotState = 'idle' | 'loading' | 'error' | 'disabled';

export interface TranslateSlot {
  state: TranslateSlotState;
  failure?: TranslateFailure;
  detail?: string;
}

const FAILURE_KEYS: Record<TranslateFailure, MessageKey> = {
  'rate-limited': 'translate.errRateLimited',
  unreachable: 'translate.errUnreachable',
  unexpected: 'translate.errUnexpected',
  'permission-denied': 'translate.errPermissionDenied',
  empty: 'translate.errEmpty',
  'not-configured': 'translate.errNotConfigured',
};

export function failureMessageKey(failure: TranslateFailure): MessageKey {
  return FAILURE_KEYS[failure];
}

function Chip({
  slot,
  hasTranslation,
  shown,
  label,
  generateTitle,
  showTitle,
  hideTitle,
  onGenerate,
  onToggle,
  locale,
}: {
  slot: TranslateSlot;
  hasTranslation: boolean;
  shown: boolean;
  label: string;
  generateTitle: string;
  showTitle: string;
  hideTitle: string;
  onGenerate: () => void;
  onToggle: () => void;
  locale: UiLocale;
}) {
  // A stored translation turns the chip into a show/hide toggle, exactly like
  // TraditionalButton's two modes.
  if (hasTranslation && slot.state !== 'loading') {
    return (
      <button
        type="button"
        title={shown ? hideTitle : showTitle}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs transition ${
          shown
            ? 'border-accent-border bg-accent-light text-accent-deep'
            : 'border-border bg-transparent text-muted hover:border-border-hover hover:text-ink-secondary'
        }`}
      >
        {label}
      </button>
    );
  }

  if (slot.state === 'loading') {
    return (
      <button
        type="button"
        disabled
        className="inline-flex cursor-not-allowed items-center gap-1 rounded-sm border border-border bg-paper-input px-1.5 py-0.5 text-xs text-muted opacity-60"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        {t(locale, 'translate.loading')}
      </button>
    );
  }

  const disabled = slot.state === 'disabled';
  const isError = slot.state === 'error';

  return (
    <button
      type="button"
      disabled={disabled}
      title={generateTitle}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onGenerate();
      }}
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs transition ${
        isError
          ? 'border-accent-border bg-accent-light text-accent-deep hover:bg-accent hover:text-white'
          : 'border-border bg-transparent text-muted hover:border-border-hover hover:text-ink-secondary'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <Languages className="h-3 w-3" />
      {isError ? t(locale, 'translate.retry') : label}
    </button>
  );
}

function SlotMessage({ slot, locale }: { slot: TranslateSlot; locale: UiLocale }) {
  if (slot.state !== 'error' && slot.state !== 'disabled') return null;
  if (!slot.failure) return null;
  const text = t(locale, failureMessageKey(slot.failure));
  return (
    <p className="text-[11px] text-accent-deep">
      {slot.detail ? `${text} ${slot.detail}` : text}
    </p>
  );
}

export function TranslateButtons({
  google,
  ai,
  hasGoogle,
  hasAi,
  shownGoogle,
  shownAi,
  onTranslateGoogle,
  onTranslateAi,
  onToggleGoogle,
  onToggleAi,
  locale,
}: {
  google: TranslateSlot;
  ai: TranslateSlot;
  hasGoogle: boolean;
  hasAi: boolean;
  shownGoogle: boolean;
  shownAi: boolean;
  onTranslateGoogle: () => void;
  onTranslateAi: () => void;
  onToggleGoogle: () => void;
  onToggleAi: () => void;
  locale: UiLocale;
}) {
  return (
    <>
      <Chip
        slot={google}
        hasTranslation={hasGoogle}
        shown={shownGoogle}
        label={t(locale, 'translate.googleShort')}
        generateTitle={t(locale, 'translate.googleTitle')}
        showTitle={t(locale, 'translate.showGoogle')}
        hideTitle={t(locale, 'translate.hideGoogle')}
        onGenerate={onTranslateGoogle}
        onToggle={onToggleGoogle}
        locale={locale}
      />
      <Chip
        slot={ai}
        hasTranslation={hasAi}
        shown={shownAi}
        label={t(locale, 'translate.aiShort')}
        generateTitle={t(locale, 'translate.aiTitle')}
        showTitle={t(locale, 'translate.showAi')}
        hideTitle={t(locale, 'translate.hideAi')}
        onGenerate={onTranslateAi}
        onToggle={onToggleAi}
        locale={locale}
      />
      {/*
        A div, not a span: SlotMessage renders <p>, which is invalid inside
        phrasing content. `basis-full` drops it onto its own line of the
        footer's flex-wrap row so both slots' errors can show at once.
      */}
      <div className="basis-full space-y-0.5">
        <SlotMessage slot={google} locale={locale} />
        <SlotMessage slot={ai} locale={locale} />
      </div>
    </>
  );
}
```

`MessageKey` must be exported from `lib/i18n.ts` — it already is (`export type MessageKey`), so no change is needed there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/translate-buttons.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/dashboard/components/TranslateButtons.tsx tests/translate-buttons.test.tsx
git commit -m "feat(dashboard): add the TranslateButtons chips with per-slot states"
```

---

### Task 7: useQuoteTranslation hook

Owns AI-settings detection, the host-permission gesture, both request paths, and the single storage write.

**Files:**
- Create: `entrypoints/dashboard/hooks/useQuoteTranslation.ts`
- Test: `tests/use-quote-translation.test.tsx`

**Interfaces:**
- Consumes: `fetchGoogleTranslation` (Task 3), `requestGoogleTranslatePermission` (Task 3), `fetchAiTranslation` (Task 5), `TranslateSlot` (Task 6), `getAiSettings` / `isAiConfigured` from `lib/ai/settings.ts`, `inboxStorage` from `lib/storage.ts`, `requestSyncMutation` from `entrypoints/background/sync-mutation-handler.ts`.
- Produces:

```ts
export function useQuoteTranslation(quote: QuoteEntry): {
  google: TranslateSlot;
  ai: TranslateSlot;
  /** Resolves to the generated English text, or null on any failure. */
  translateGoogle: () => Promise<string | null>;
  translateAi: () => Promise<string | null>;
};
```

The two functions return the generated text (not `void`) so Task 8's card can
show the new line immediately, before the persisted inbox re-render arrives.

- [ ] **Step 1: Write the failing test**

Create `tests/use-quote-translation.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuoteTranslation } from '../entrypoints/dashboard/hooks/useQuoteTranslation';
import type { Inbox, QuoteEntry } from '../lib/types';

vi.mock('../lib/translate/google', () => ({
  fetchGoogleTranslation: vi.fn(),
}));
vi.mock('../lib/translate/permissions', () => ({
  GOOGLE_TRANSLATE_ORIGIN: 'https://translate.googleapis.com/*',
  requestGoogleTranslatePermission: vi.fn(),
  hasGoogleTranslatePermission: vi.fn(),
}));
vi.mock('../lib/ai/client', () => ({
  fetchAiTranslation: vi.fn(),
}));
vi.mock('../lib/ai/settings', () => ({
  getAiSettings: vi.fn(),
  isAiConfigured: vi.fn(),
}));
vi.mock('../lib/storage', () => ({
  inboxStorage: { getValue: vi.fn() },
}));
vi.mock('../entrypoints/background/sync-mutation-handler', () => ({
  requestSyncMutation: vi.fn(),
}));

const { fetchGoogleTranslation } = await import('../lib/translate/google');
const { requestGoogleTranslatePermission } = await import('../lib/translate/permissions');
const { fetchAiTranslation } = await import('../lib/ai/client');
const { getAiSettings, isAiConfigured } = await import('../lib/ai/settings');
const { inboxStorage } = await import('../lib/storage');
const { requestSyncMutation } = await import('../entrypoints/background/sync-mutation-handler');

const AI_SETTINGS = {
  enabled: true,
  provider: 'deepseek' as const,
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test',
  model: 'deepseek-v4-flash',
};

function makeQuote(over: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: '学而时习之',
    tags: [],
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    sourceTitle: 'Lunyu',
    sourceUrl: 'https://lunyu.com',
    sourceDomain: 'lunyu.com',
    surrounding: '不亦说乎',
    ...over,
  };
}

// A harness that surfaces the hook's return value to the test.
let api: ReturnType<typeof useQuoteTranslation>;

function Harness({ quote }: { quote: QuoteEntry }) {
  api = useQuoteTranslation(quote);
  return <div data-states={`${api.google.state}|${api.ai.state}`} />;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  vi.mocked(getAiSettings).mockResolvedValue(AI_SETTINGS);
  vi.mocked(isAiConfigured).mockReturnValue(true);
  vi.mocked(requestGoogleTranslatePermission).mockResolvedValue(true);
  vi.mocked(requestSyncMutation).mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
});

async function renderClient(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function inboxWith(quote: QuoteEntry): Inbox {
  return { words: [], quotes: [quote] };
}

function writtenInbox(): Inbox {
  return vi.mocked(requestSyncMutation).mock.calls[0][1] as Inbox;
}

describe('useQuoteTranslation — Google path', () => {
  it('requests the host permission, then persists the Google slot', async () => {
    const quote = makeQuote();
    vi.mocked(inboxStorage.getValue).mockResolvedValue(inboxWith(quote));
    vi.mocked(fetchGoogleTranslation).mockResolvedValue({
      ok: true,
      text: 'Learning is a joy',
    });

    await renderClient(<Harness quote={quote} />);
    let returned: string | null = null;
    await act(async () => {
      returned = await api.translateGoogle();
    });

    expect(requestGoogleTranslatePermission).toHaveBeenCalledTimes(1);
    expect(fetchGoogleTranslation).toHaveBeenCalledWith({ text: '学而时习之' });
    expect(requestSyncMutation).toHaveBeenCalledTimes(1);
    expect(writtenInbox().quotes[0].translations?.google?.text).toBe('Learning is a joy');
    expect(api.google.state).toBe('idle');
    expect(returned).toBe('Learning is a joy');
  });

  it('returns null when a request fails', async () => {
    vi.mocked(fetchGoogleTranslation).mockResolvedValue({ ok: false, code: 'unexpected' });

    await renderClient(<Harness quote={makeQuote()} />);
    let returned: string | null = 'unset';
    await act(async () => {
      returned = await api.translateGoogle();
    });

    expect(returned).toBeNull();
  });

  it('never calls fetch and reports permission-denied when the user declines', async () => {
    const quote = makeQuote();
    vi.mocked(requestGoogleTranslatePermission).mockResolvedValue(false);

    await renderClient(<Harness quote={quote} />);
    await act(async () => {
      await api.translateGoogle();
    });

    expect(fetchGoogleTranslation).not.toHaveBeenCalled();
    expect(requestSyncMutation).not.toHaveBeenCalled();
    expect(api.google.state).toBe('error');
    expect(api.google.failure).toBe('permission-denied');
  });

  it('writes nothing and surfaces the failure code when the request fails', async () => {
    const quote = makeQuote();
    vi.mocked(fetchGoogleTranslation).mockResolvedValue({
      ok: false,
      code: 'rate-limited',
    });

    await renderClient(<Harness quote={quote} />);
    await act(async () => {
      await api.translateGoogle();
    });

    expect(requestSyncMutation).not.toHaveBeenCalled();
    expect(api.google.state).toBe('error');
    expect(api.google.failure).toBe('rate-limited');
  });

  it('preserves an existing AI slot when writing the Google slot', async () => {
    const quote = makeQuote({
      translations: {
        ai: {
          text: 'Nature shows no favour',
          generatedAt: 50,
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          baseUrl: 'https://api.deepseek.com',
        },
      },
    });
    vi.mocked(inboxStorage.getValue).mockResolvedValue(inboxWith(quote));
    vi.mocked(fetchGoogleTranslation).mockResolvedValue({ ok: true, text: 'G text' });

    await renderClient(<Harness quote={quote} />);
    await act(async () => {
      await api.translateGoogle();
    });

    const out = writtenInbox().quotes[0].translations!;
    expect(out.google?.text).toBe('G text');
    expect(out.ai?.text).toBe('Nature shows no favour');
  });

  it('leaves other quotes in the inbox untouched', async () => {
    const target = makeQuote({ id: 'q1' });
    const other = makeQuote({ id: 'q2', text: '不亦说乎' });
    vi.mocked(inboxStorage.getValue).mockResolvedValue({
      words: [],
      quotes: [target, other],
    });
    vi.mocked(fetchGoogleTranslation).mockResolvedValue({ ok: true, text: 'G text' });

    await renderClient(<Harness quote={target} />);
    await act(async () => {
      await api.translateGoogle();
    });

    const quotes = writtenInbox().quotes;
    expect(quotes.find((q) => q.id === 'q2')!.translations).toBeUndefined();
  });
});

describe('useQuoteTranslation — AI path', () => {
  it('persists the AI slot with provider provenance', async () => {
    const quote = makeQuote();
    vi.mocked(inboxStorage.getValue).mockResolvedValue(inboxWith(quote));
    vi.mocked(fetchAiTranslation).mockResolvedValue({
      ok: true,
      text: 'Nature shows no favour',
    });

    await renderClient(<Harness quote={quote} />);
    let returned: string | null = null;
    await act(async () => {
      returned = await api.translateAi();
    });

    expect(returned).toBe('Nature shows no favour');
    const slot = writtenInbox().quotes[0].translations!.ai!;
    expect(slot.text).toBe('Nature shows no favour');
    expect(slot.provider).toBe('deepseek');
    expect(slot.model).toBe('deepseek-v4-flash');
    expect(slot.baseUrl).toBe('https://api.deepseek.com');
    expect(requestGoogleTranslatePermission).not.toHaveBeenCalled();
  });

  it('starts disabled with not-configured when AI is unconfigured', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(false);

    await renderClient(<Harness quote={makeQuote()} />);

    expect(api.ai.state).toBe('disabled');
    expect(api.ai.failure).toBe('not-configured');
    expect(api.google.state).toBe('idle');
  });

  it('does not call the provider when AI is unconfigured', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(false);

    await renderClient(<Harness quote={makeQuote()} />);
    await act(async () => {
      await api.translateAi();
    });

    expect(fetchAiTranslation).not.toHaveBeenCalled();
    expect(requestSyncMutation).not.toHaveBeenCalled();
  });

  it('keeps the failure detail from the provider', async () => {
    vi.mocked(fetchAiTranslation).mockResolvedValue({
      ok: false,
      code: 'unreachable',
      detail: 'upstream down',
    });

    await renderClient(<Harness quote={makeQuote()} />);
    await act(async () => {
      await api.translateAi();
    });

    expect(api.ai.state).toBe('error');
    expect(api.ai.failure).toBe('unreachable');
    expect(api.ai.detail).toBe('upstream down');
  });

  it('leaves the Google slot idle when the AI path fails', async () => {
    vi.mocked(fetchAiTranslation).mockResolvedValue({ ok: false, code: 'unexpected' });

    await renderClient(<Harness quote={makeQuote()} />);
    await act(async () => {
      await api.translateAi();
    });

    expect(api.ai.state).toBe('error');
    expect(api.google.state).toBe('idle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/use-quote-translation.test.tsx`
Expected: FAIL — cannot resolve `../entrypoints/dashboard/hooks/useQuoteTranslation`.

- [ ] **Step 3: Write the hook**

Create `entrypoints/dashboard/hooks/useQuoteTranslation.ts`:

```ts
import { useEffect, useState } from 'react';
import { fetchAiTranslation } from '@/lib/ai/client';
import { getAiSettings, isAiConfigured } from '@/lib/ai/settings';
import { fetchGoogleTranslation } from '@/lib/translate/google';
import { requestGoogleTranslatePermission } from '@/lib/translate/permissions';
import type { TranslateResult } from '@/lib/translate/types';
import { inboxStorage } from '@/lib/storage';
import { requestSyncMutation } from '@/entrypoints/background/sync-mutation-handler';
import type { TranslateSlot } from '../components/TranslateButtons';
import type {
  AiQuoteTranslation,
  AiSettings,
  QuoteEntry,
  QuoteTranslation,
  QuoteTranslations,
} from '@/lib/types';

const IDLE: TranslateSlot = { state: 'idle' };

export function useQuoteTranslation(quote: QuoteEntry) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [google, setGoogle] = useState<TranslateSlot>(IDLE);
  const [ai, setAi] = useState<TranslateSlot>({
    state: 'disabled',
    failure: 'not-configured',
  });

  // The Google slot needs no configuration, so it starts idle. The AI slot
  // starts disabled and only opens once configured settings are read.
  useEffect(() => {
    let alive = true;
    getAiSettings()
      .then((next) => {
        if (!alive) return;
        setSettings(next);
        setAi(
          isAiConfigured(next) ? IDLE : { state: 'disabled', failure: 'not-configured' },
        );
      })
      .catch(() => {
        if (!alive) return;
        setAi({ state: 'disabled', failure: 'not-configured' });
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Merge one slot into this quote's translations and write the inbox through
   * the sync coordinator. Reads storage fresh so a concurrent edit to another
   * quote is not clobbered, and spreads the existing `translations` so the
   * sibling slot always survives.
   */
  async function persistSlot(patch: Partial<QuoteTranslations>) {
    const current = await inboxStorage.getValue();
    await requestSyncMutation('inbox', {
      ...current,
      quotes: current.quotes.map((candidate) =>
        candidate.id === quote.id
          ? {
              ...candidate,
              translations: { ...candidate.translations, ...patch },
              updatedAt: Date.now(),
            }
          : candidate,
      ),
    });
  }

  function applyFailure(
    set: (slot: TranslateSlot) => void,
    result: Extract<TranslateResult, { ok: false }>,
  ) {
    set({ state: 'error', failure: result.code, detail: result.detail });
  }

  // Both functions resolve to the generated text so the card can show the line
  // immediately, before the persisted inbox re-render arrives. null on failure.
  async function translateGoogle(): Promise<string | null> {
    setGoogle({ state: 'loading' });
    try {
      const granted = await requestGoogleTranslatePermission();
      if (!granted) {
        setGoogle({ state: 'error', failure: 'permission-denied' });
        return null;
      }

      const result = await fetchGoogleTranslation({ text: quote.text });
      if (!result.ok) {
        applyFailure(setGoogle, result);
        return null;
      }

      const slot: QuoteTranslation = { text: result.text, generatedAt: Date.now() };
      await persistSlot({ google: slot });
      setGoogle(IDLE);
      return slot.text;
    } catch {
      setGoogle({ state: 'error', failure: 'unreachable' });
      return null;
    }
  }

  async function translateAi(): Promise<string | null> {
    if (!settings || !isAiConfigured(settings)) {
      setAi({ state: 'disabled', failure: 'not-configured' });
      return null;
    }

    setAi({ state: 'loading' });
    try {
      const result = await fetchAiTranslation({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        provider: settings.provider,
        quoteText: quote.text,
      });
      if (!result.ok) {
        applyFailure(setAi, result);
        return null;
      }

      const slot: AiQuoteTranslation = {
        text: result.text,
        generatedAt: Date.now(),
        provider: settings.provider,
        model: settings.model,
        baseUrl: settings.baseUrl,
      };
      await persistSlot({ ai: slot });
      setAi(IDLE);
      return slot.text;
    } catch {
      setAi({ state: 'error', failure: 'unreachable' });
      return null;
    }
  }

  return { google, ai, translateGoogle, translateAi };
}
```

Note: the AI path does **not** request a host permission here. `useClozeSuggestions` calls `requestAiSettingsPermission` for the provider origin, but the AI-insight and cloze flows already establish that grant, and the test asserts `requestGoogleTranslatePermission` is not called on the AI path. If a reviewer wants provider-origin parity, that is a follow-up, not part of this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/use-quote-translation.test.tsx`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/dashboard/hooks/useQuoteTranslation.ts tests/use-quote-translation.test.tsx
git commit -m "feat(dashboard): add useQuoteTranslation owning both request paths"
```

---

### Task 8: Wire translation into QuoteCard

**Files:**
- Modify: `entrypoints/dashboard/components/QuoteCard.tsx`
- Test: `tests/quote-card-translation.test.tsx`

**Interfaces:**
- Consumes: `TranslateButtons` (Task 6), `useQuoteTranslation` (Task 7).
- Produces: no new exports. `QuoteCard`'s prop signature is unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/quote-card-translation.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuoteCard } from '../entrypoints/dashboard/components/QuoteCard';
import { messages } from '../lib/i18n';
import type { QuoteEntry } from '../lib/types';

vi.mock('../lib/translate/google', () => ({
  fetchGoogleTranslation: vi.fn().mockResolvedValue({ ok: true, text: 'Learning is a joy' }),
}));
vi.mock('../lib/translate/permissions', () => ({
  GOOGLE_TRANSLATE_ORIGIN: 'https://translate.googleapis.com/*',
  requestGoogleTranslatePermission: vi.fn().mockResolvedValue(true),
  hasGoogleTranslatePermission: vi.fn().mockResolvedValue(true),
}));
vi.mock('../lib/ai/client', () => ({ fetchAiTranslation: vi.fn() }));
vi.mock('../lib/ai/settings', () => ({
  getAiSettings: vi.fn().mockResolvedValue({
    enabled: true,
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-test',
    model: 'deepseek-v4-flash',
  }),
  isAiConfigured: vi.fn().mockReturnValue(true),
}));
vi.mock('../lib/storage', () => ({
  inboxStorage: { getValue: vi.fn().mockResolvedValue({ words: [], quotes: [] }) },
}));
vi.mock('../entrypoints/background/sync-mutation-handler', () => ({
  requestSyncMutation: vi.fn().mockResolvedValue(undefined),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
});

async function renderClient(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function queryButton(label: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(label),
    ) ?? null
  ) as HTMLButtonElement | null;
}

async function click(btn: HTMLButtonElement) {
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function makeQuote(over: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: '学而时习之',
    tags: [],
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    sourceTitle: 'Lunyu',
    sourceUrl: 'https://lunyu.com',
    sourceDomain: 'lunyu.com',
    surrounding: '不亦说乎',
    ...over,
  };
}

function card(quote: QuoteEntry) {
  return (
    <QuoteCard
      quote={quote}
      onUpdate={vi.fn()}
      onSetTags={vi.fn()}
      onDelete={vi.fn()}
      knownTags={[]}
      locale="en"
    />
  );
}

describe('QuoteCard translations', () => {
  it('renders both translate chips in the footer', async () => {
    await renderClient(card(makeQuote()));
    expect(queryButton(messages.en['translate.googleShort'])).not.toBeNull();
    expect(queryButton(messages.en['translate.aiShort'])).not.toBeNull();
  });

  it('renders a stored Google translation with its label', async () => {
    await renderClient(
      card(
        makeQuote({
          translations: { google: { text: 'Learning is a joy', generatedAt: 10 } },
        }),
      ),
    );
    // Hidden until toggled on: a stored translation starts collapsed.
    expect(container.textContent).not.toContain('Learning is a joy');
    await click(queryButton(messages.en['translate.googleShort'])!);
    expect(container.textContent).toContain(messages.en['translate.labelGoogle']);
    expect(container.textContent).toContain('Learning is a joy');
  });

  it('renders both stored translations independently', async () => {
    await renderClient(
      card(
        makeQuote({
          translations: {
            google: { text: 'Google version', generatedAt: 10 },
            ai: {
              text: 'AI version',
              generatedAt: 20,
              provider: 'deepseek',
              model: 'deepseek-v4-flash',
              baseUrl: 'https://api.deepseek.com',
            },
          },
        }),
      ),
    );

    await click(queryButton(messages.en['translate.googleShort'])!);
    expect(container.textContent).toContain('Google version');
    expect(container.textContent).not.toContain('AI version');

    await click(queryButton(messages.en['translate.aiShort'])!);
    expect(container.textContent).toContain('Google version');
    expect(container.textContent).toContain('AI version');
  });

  it('hides a shown translation when its chip is clicked again', async () => {
    await renderClient(
      card(
        makeQuote({
          translations: { google: { text: 'Learning is a joy', generatedAt: 10 } },
        }),
      ),
    );
    const chip = () => queryButton(messages.en['translate.googleShort'])!;
    await click(chip());
    expect(container.textContent).toContain('Learning is a joy');
    await click(chip());
    expect(container.textContent).not.toContain('Learning is a joy');
  });

  it('auto-shows a freshly generated Google translation', async () => {
    await renderClient(card(makeQuote()));
    await click(queryButton(messages.en['translate.googleShort'])!);
    // The parent re-renders with the persisted quote in the real app; here the
    // card must at least surface the newly fetched text from local state.
    expect(container.textContent).toContain('Learning is a joy');
  });

  it('still renders the Traditional chip alongside the translate chips', async () => {
    await renderClient(card(makeQuote()));
    expect(queryButton('繁')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quote-card-translation.test.tsx`
Expected: FAIL — no translate chips render; `queryButton` returns `null`.

- [ ] **Step 3: Wire the card**

In `entrypoints/dashboard/components/QuoteCard.tsx`, extend the imports:

```tsx
import { useQuoteTranslation } from '../hooks/useQuoteTranslation';
import { TranslateButtons } from './TranslateButtons';
```

Add state and the hook next to the existing `showTraditional` state:

```tsx
  const [showTraditional, setShowTraditional] = useState(false);
  const [showGoogle, setShowGoogle] = useState(false);
  const [showAi, setShowAi] = useState(false);
  /**
   * Freshly generated text, held locally so the line appears immediately.
   * The persisted value arrives on the next inbox render and takes over.
   */
  const [freshGoogle, setFreshGoogle] = useState<string | null>(null);
  const [freshAi, setFreshAi] = useState<string | null>(null);
  const translation = useQuoteTranslation(quote);

  const googleText = quote.translations?.google?.text ?? freshGoogle;
  const aiText = quote.translations?.ai?.text ?? freshAi;
```

Add the render lines directly after the existing `showTraditional` block:

```tsx
      {showTraditional && quote.traditionalText && (
        <p className="mt-2 pl-5 text-sm italic text-accent-deep">{quote.traditionalText}</p>
      )}
      {showGoogle && googleText && (
        <p className="mt-2 pl-5 text-sm text-ink-secondary">
          <span className="mr-1.5 text-[11px] uppercase tracking-wide text-muted">
            {t(locale, 'translate.labelGoogle')}
          </span>
          {googleText}
        </p>
      )}
      {showAi && aiText && (
        <p className="mt-2 pl-5 text-sm text-ink-secondary">
          <span className="mr-1.5 text-[11px] uppercase tracking-wide text-muted">
            {t(locale, 'translate.labelAi')}
          </span>
          {aiText}
        </p>
      )}
```

Add the chips in the footer row, immediately after the existing `<TraditionalButton ... />`:

```tsx
        <TranslateButtons
          google={translation.google}
          ai={translation.ai}
          hasGoogle={Boolean(googleText)}
          hasAi={Boolean(aiText)}
          shownGoogle={showGoogle}
          shownAi={showAi}
          onTranslateGoogle={async () => {
            // The hook returns the generated text so the line can appear now,
            // before the persisted inbox re-render reaches this card.
            const text = await translation.translateGoogle();
            if (text) setFreshGoogle(text);
            setShowGoogle(true);
          }}
          onTranslateAi={async () => {
            const text = await translation.translateAi();
            if (text) setFreshAi(text);
            setShowAi(true);
          }}
          onToggleGoogle={() => setShowGoogle((value) => !value)}
          onToggleAi={() => setShowAi((value) => !value)}
          locale={locale}
        />
```

- [ ] **Step 4: Run both test files to verify they pass**

Run: `npx vitest run tests/quote-card-translation.test.tsx tests/use-quote-translation.test.tsx`
Expected: PASS — 6 card tests and 11 hook tests.

- [ ] **Step 5: Confirm no regression in the existing quote tests**

Run: `npx vitest run tests/quote-list.test.tsx tests/cloze-editor.test.tsx`
Expected: PASS. `QuoteCard`'s prop signature did not change, so `QuoteList` needs no edit.

- [ ] **Step 6: Commit**

```bash
git add entrypoints/dashboard/components/QuoteCard.tsx entrypoints/dashboard/hooks/useQuoteTranslation.ts tests/quote-card-translation.test.tsx tests/use-quote-translation.test.tsx
git commit -m "feat(dashboard): render translate chips and translation lines on QuoteCard"
```

---

### Task 9: Markdown export

**Files:**
- Modify: `lib/markdown.ts`
- Test: `tests/markdown.test.ts` (extend)

**Interfaces:**
- Consumes: `QuoteEntry.translations` (Task 1), the existing private `esc` helper in `lib/markdown.ts`.
- Produces: no new exports; `renderDay` output gains nested translation bullets.

- [ ] **Step 1: Write the failing test**

Append to `tests/markdown.test.ts`:

```ts
describe('renderDay quote translations', () => {
  const translated: QuoteEntry = {
    ...quote,
    id: 'q-tr',
    translations: {
      google: { text: 'Learning is a joy', generatedAt: 10 },
      ai: {
        text: 'To learn and practise often',
        generatedAt: 20,
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        baseUrl: 'https://api.deepseek.com',
      },
    },
  };

  it('emits Google before AI as nested bullets', () => {
    const out = renderDay(day, [], [translated], null);
    expect(out).toContain('  - EN (Google): Learning is a joy');
    expect(out).toContain('  - EN (AI): To learn and practise often');
    expect(out.indexOf('EN (Google)')).toBeLessThan(out.indexOf('EN (AI)'));
  });

  it('emits only the Google bullet when only Google exists', () => {
    const googleOnly: QuoteEntry = {
      ...quote,
      translations: { google: { text: 'Learning is a joy', generatedAt: 10 } },
    };
    const out = renderDay(day, [], [googleOnly], null);
    expect(out).toContain('  - EN (Google): Learning is a joy');
    expect(out).not.toContain('EN (AI)');
  });

  it('emits only the AI bullet when only AI exists', () => {
    const aiOnly: QuoteEntry = {
      ...quote,
      translations: {
        ai: {
          text: 'To learn and practise often',
          generatedAt: 20,
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          baseUrl: 'https://api.deepseek.com',
        },
      },
    };
    const out = renderDay(day, [], [aiOnly], null);
    expect(out).toContain('  - EN (AI): To learn and practise often');
    expect(out).not.toContain('EN (Google)');
  });

  it('emits no translation bullet for an untranslated quote', () => {
    const out = renderDay(day, [], [quote], null);
    expect(out).not.toContain('EN (Google)');
    expect(out).not.toContain('EN (AI)');
  });

  it('escapes translation text', () => {
    const risky: QuoteEntry = {
      ...quote,
      translations: { google: { text: 'a | b [x](y)', generatedAt: 10 } },
    };
    const out = renderDay(day, [], [risky], null);
    expect(out).not.toContain('EN (Google): a | b [x](y)');
  });

  it('places translations after the note and before the source link', () => {
    const withNote: QuoteEntry = { ...translated, note: 'my note' };
    const out = renderDay(day, [], [withNote], null);
    expect(out.indexOf('my note')).toBeLessThan(out.indexOf('EN (Google)'));
    expect(out.indexOf('EN (AI)')).toBeLessThan(out.indexOf('lunyu.com]('));
  });
});
```

Check `renderDay`'s existing call signature in `tests/markdown.test.ts` and match it exactly — the fourth argument in existing tests is the dictionary index (`null` where unused). If the existing tests call it with a different arity, use theirs.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/markdown.test.ts`
Expected: FAIL — no `EN (Google)` substring in the output.

- [ ] **Step 3: Emit the bullets**

In `lib/markdown.ts`, inside the `if (quotes.length > 0)` loop, insert the two bullets between the note line and the source link line:

```ts
      lines.push(`- [ ] > ${renderQuoteBody(quote)}`);
      if (tags) lines.push(tags);
      if (quote.note) lines.push(`  - ${esc(quote.note)}`);
      // Translations are a read-only annotation: export never triggers a call.
      const google = quote.translations?.google?.text;
      if (google) lines.push(`  - EN (Google): ${esc(google)}`);
      const ai = quote.translations?.ai?.text;
      if (ai) lines.push(`  - EN (AI): ${esc(ai)}`);
      lines.push(`  - [${esc(quote.sourceTitle || quote.sourceDomain)}](${quote.sourceUrl})`);
```

The `EN (Google)` / `EN (AI)` labels are intentionally hardcoded English rather than localized: exported Markdown is a stable file format, and a label that changes with the UI locale would make old and new notes inconsistent.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/markdown.test.ts`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 5: Confirm the zip export still works**

Run: `npx vitest run tests/export.test.ts`
Expected: PASS — `lib/export.ts` delegates rendering to `renderDay` and needs no change.

- [ ] **Step 6: Commit**

```bash
git add lib/markdown.ts tests/markdown.test.ts
git commit -m "feat(export): emit quote translations as nested Markdown bullets"
```

---

### Task 10: Sync the translation slots

**Files:**
- Modify: `lib/sync/project.ts`
- Test: `tests/sync/project.test.ts` (extend)

**Interfaces:**
- Consumes: `QuoteTranslations` (Task 1), existing `reg` / `stamp` helpers and `QuoteNode.fields` in `lib/sync/project.ts`.
- Produces: two new registers on `QuoteNode.fields` — `translationGoogle` and `translationAi` — read back by `materialize`.

No change to `lib/sync/types.ts` or `lib/sync/merge.ts`: `QuoteNode.fields` is already `Record<string, Register<unknown>>` and `mergeRegisterMap` is field-generic.

- [ ] **Step 1: Write the failing test**

Append to `tests/sync/project.test.ts`. It needs `mergeSyncState`, so extend the imports with `import { mergeSyncState } from '../../lib/sync/merge';`, and add a quote fixture if the file does not already have one:

```ts
function quoteFixture(over: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: '学而时习之',
    tags: [],
    note: '',
    status: 'inbox',
    createdAt: 10,
    updatedAt: 20,
    sourceTitle: 't',
    sourceUrl: 'u',
    sourceDomain: 'd',
    surrounding: 's',
    ...over,
  };
}

const AI_SLOT = {
  text: 'To learn and practise often',
  generatedAt: 300,
  provider: 'deepseek' as const,
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com',
};

describe('quote translation sync', () => {
  it('round-trips both translation slots', () => {
    const quote = quoteFixture({
      translations: {
        google: { text: 'Learning is a joy', generatedAt: 200 },
        ai: AI_SLOT,
      },
    });
    const state = projectInbox({ words: [], quotes: [quote] }, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctx);

    const out = materialize(state).inbox.quotes[0];

    expect(out.translations?.google).toEqual({ text: 'Learning is a joy', generatedAt: 200 });
    expect(out.translations?.ai).toEqual(AI_SLOT);
  });

  it('omits translations entirely for an untranslated quote', () => {
    const state = projectInbox({ words: [], quotes: [quoteFixture()] }, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctx);

    expect(materialize(state).inbox.quotes[0].translations).toBeUndefined();
  });

  it('round-trips a quote with only the Google slot', () => {
    const quote = quoteFixture({
      translations: { google: { text: 'Learning is a joy', generatedAt: 200 } },
    });
    const state = projectInbox({ words: [], quotes: [quote] }, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctx);

    const out = materialize(state).inbox.quotes[0];

    expect(out.translations?.google?.text).toBe('Learning is a joy');
    expect(out.translations?.ai).toBeUndefined();
  });

  it('keeps both slots when two replicas each translated with a different source', () => {
    // Replica A translated with Google; replica B translated the same quote
    // with AI. Separate registers mean neither write loses.
    const stateA = projectInbox(
      {
        words: [],
        quotes: [
          quoteFixture({
            updatedAt: 100,
            translations: { google: { text: 'Learning is a joy', generatedAt: 100 } },
          }),
        ],
      },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      { replicaId: 'A', wallTime: 100 },
    );
    const stateB = projectInbox(
      { words: [], quotes: [quoteFixture({ updatedAt: 300, translations: { ai: AI_SLOT } })] },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      { replicaId: 'B', wallTime: 300 },
    );

    const out = materialize(mergeSyncState(stateA, stateB)).inbox.quotes[0];

    expect(out.translations?.google?.text).toBe('Learning is a joy');
    expect(out.translations?.ai?.text).toBe('To learn and practise often');
  });
});
```

The merge case works because replica B's newer `updatedAt` (300) stamps its `translationAi` register above A's, while A's `translationGoogle` register carries a real value and B's carries `null` at an older-or-equal stamp for that field. To make that deterministic rather than incidental, **only write a register when its slot exists** — see Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync/project.test.ts`
Expected: FAIL — `out.translations` is `undefined` in the round-trip test.

- [ ] **Step 3: Project and materialize the registers**

In `lib/sync/project.ts`, inside `projectQuote`'s `fields` object, add the two registers after `traditionalText`. Write a register **only when the slot exists**, so an untranslated device never stamps a `null` over a peer's real translation:

```ts
      pinyin: reg(quote.pinyin ?? null, s),
      traditionalText: reg(quote.traditionalText ?? null, s),
      // One register per slot, not one object register: a Google translate on
      // device A and an AI translate on device B must both survive the merge.
      // Absent slots are omitted rather than stamped null so an untranslated
      // replica cannot overwrite a peer's translation.
      ...(quote.translations?.google
        ? { translationGoogle: reg(quote.translations.google, s) }
        : {}),
      ...(quote.translations?.ai
        ? { translationAi: reg(quote.translations.ai, s) }
        : {}),
      updatedAt: reg(quote.updatedAt, s),
```

Then in `materialize`, inside the quotes loop, build the field back. Add this above the `quotes.push({ ... })` call:

```ts
    const googleSlot = node.fields.translationGoogle?.value as
      | QuoteTranslations['google']
      | null
      | undefined;
    const aiSlot = node.fields.translationAi?.value as
      | QuoteTranslations['ai']
      | null
      | undefined;
    const translations: QuoteTranslations = {
      ...(googleSlot ? { google: googleSlot } : {}),
      ...(aiSlot ? { ai: aiSlot } : {}),
    };
```

And add to the pushed object, after `traditionalText`:

```ts
      traditionalText: (node.fields.traditionalText?.value as string | null) ?? undefined,
      ...(Object.keys(translations).length > 0 ? { translations } : {}),
```

Extend the type import at the top of `lib/sync/project.ts` to include `QuoteTranslations`:

```ts
import type {
  AiSettings,
  AppSettings,
  Inbox,
  Occurrence,
  QuoteEntry,
  QuoteTranslations,
  ReviewLogEntry,
  ReviewState,
  WordEntry,
} from '../types';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sync/project.test.ts`
Expected: PASS, including all pre-existing projection tests.

- [ ] **Step 5: Run the whole sync suite for regressions**

Run: `npx vitest run tests/sync`
Expected: PASS. The merge is field-generic, so the new registers need no merge changes.

- [ ] **Step 6: Commit**

```bash
git add lib/sync/project.ts tests/sync/project.test.ts
git commit -m "feat(sync): carry quote translations as independent LWW registers"
```

---

### Task 11: Manifest permission, privacy, docs, release

**Files:**
- Modify: `wxt.config.ts`
- Modify: `PRIVACY.md`
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: `GOOGLE_TRANSLATE_ORIGIN` (Task 3) — the manifest entry must match it exactly.
- Produces: nothing consumed by later tasks. This is the release task.

- [ ] **Step 1: Add the optional host permission**

In `wxt.config.ts`, add the Google Translate origin to `optional_host_permissions`:

```ts
    optional_host_permissions: [
      'https://api.deepseek.com/*',
      'https://api.openai.com/*',
      'https://openrouter.ai/*',
      'https://generativelanguage.googleapis.com/*',
      'https://dashscope.aliyuncs.com/*',
      'https://api.moonshot.cn/*',
      'https://open.bigmodel.cn/*',
      'https://translate.googleapis.com/*',
    ],
```

It goes in `optional_host_permissions`, never `permissions` — the grant is requested on the first Google-translate click, not at install.

- [ ] **Step 2: Verify the built manifest**

Run: `npm run build && cat .output/chrome-mv3/manifest.json`
Expected: build succeeds and `optional_host_permissions` contains `https://translate.googleapis.com/*` alongside the seven existing provider origins.

- [ ] **Step 3: Update PRIVACY.md**

Change the `Last updated:` line to `2026-07-25`.

In the **Network Requests** section, add a paragraph after the AI-actions list:

```markdown
Quote translation is optional and user-triggered. Each quote card has two
translate buttons; neither runs unless you click it.

- **EN·G** sends that quote's sentence text to Google's translation endpoint at
  `translate.googleapis.com`. This is Google's unofficial keyless translation
  endpoint: no API key, no account, and no sign-in is involved, and the request
  carries no identifier for you or the extension beyond the sentence itself.
  Because the endpoint is undocumented and unsupported by Google, it may rate-limit
  or stop working; the extension treats any failure as a retryable error. Host
  access to `translate.googleapis.com` is optional and requested only the first
  time you click this button.
- **EN·AI** sends that quote's sentence text to the AI provider you configured,
  under the same terms as the other AI actions above.

Translations are stored locally on the quote and included in Markdown exports
and backups.
```

Also add the AI translate action to the existing bulleted list of AI actions:

```markdown
- **EN·AI** (quote translation) sends that quote's sentence text so the provider
  can return an English translation.
```

In the **Permissions** section, extend the sentence listing optional host access so it reads that AI provider host access and Google Translate host access are both optional and requested only on first use.

- [ ] **Step 4: Bump the version**

In `package.json`, change `"version": "0.4.1"` to `"version": "0.4.2"`.

- [ ] **Step 5: Add the changelog entry**

In `CHANGELOG.md`, insert above the `## [0.4.1] - 2026-07-04` heading:

```markdown
## [0.4.2] - 2026-07-25

### Added

- **Translate a whole quote to English, two ways.** Every quote card now has two
  chips beside 繁: **EN·G** translates through Google's free keyless endpoint,
  and **EN·AI** translates through your configured AI provider. Both results are
  stored on the quote and can be shown at once so you can compare the machine
  and AI phrasing; each chip toggles its own line. Translations reach the daily
  Markdown export as nested bullets, sync between profiles as independent
  fields (so translating with Google on one device and AI on another keeps
  both), and are included in backups. Fully localized (en / zh-CN).
- Google Translate host access is an **optional** permission, requested only the
  first time you click **EN·G**. The Google endpoint is undocumented and
  unsupported by Google; rate limits and outages surface as a retryable message.
```

- [ ] **Step 6: Update AGENTS.md**

Add to the landed-features sentence in the Project Summary: `, and quote translation (Google + AI)`.

Add a numbered architecture note after item 16:

```markdown
17. `lib/translate/*` and `lib/ai/translate-*` add two per-quote English
    translation paths. `google-parse.ts` is the pure parser for Google's
    undocumented `translate_a/single?client=gtx` response — element `[0]` holds
    one entry per sentence segment, so a multi-sentence quote arrives split and
    must be rejoined in order. `google.ts` is the permission-unaware transport;
    `permissions.ts` owns the optional `translate.googleapis.com` host grant,
    requested by the hook on click. `lib/ai/translate-prompt.ts` and
    `lib/ai/translate-parse.ts` back `fetchAiTranslation` in `lib/ai/client.ts`.
    Both paths return the shared `TranslateResult` from `lib/translate/types.ts`,
    whose failures are `TranslateFailure` codes rather than prose so the UI can
    localize them. `hooks/useQuoteTranslation.ts` owns both requests and the
    single storage write; `components/TranslateButtons.tsx` is purely
    presentational. Results persist on `QuoteEntry.translations` as two
    independent slots — `google` and `ai` — which sync as two separate LWW
    registers so translating with different sources on two devices never loses
    one.
```

Add to the Core modules list:

```markdown
- `lib/translate/types.ts`: `TranslateFailure` codes and the shared
  `TranslateResult`. Failures are codes, never prose.
- `lib/translate/google-parse.ts`: pure parser for the gtx response; joins every
  sentence segment.
- `lib/translate/google.ts`: single `fetch` to the keyless gtx endpoint with
  status classification. Permission-unaware by design.
- `lib/translate/permissions.ts`: lazy `chrome.permissions.request` for
  `https://translate.googleapis.com/*`.
- `lib/ai/translate-prompt.ts`: pure builder for the JSON-only translation
  messages array.
- `lib/ai/translate-parse.ts`: pure validation of the model reply into one
  English string.
```

Add to the Conventions list:

```markdown
- Keep quote translation a display/export annotation. Do not use
  `QuoteEntry.translations` for capture, dedupe, normalize, review scheduling,
  or cloze offsets. Translate `quote.text` (Simplified), never
  `traditionalText`.
- Write the two translation slots independently; filling one must never clear
  the other. A failed request writes nothing.
- Return `TranslateFailure` codes from the translate layer and localize them in
  the component. Do not surface raw provider prose as the primary message.
```

Add to the focused-tests list:

```bash
npx vitest run tests/translate-google-parse.test.ts
npx vitest run tests/translate-google.test.ts
npx vitest run tests/ai-translate-prompt.test.ts
npx vitest run tests/ai-translate-parse.test.ts
npx vitest run tests/ai-translate-client.test.ts
npx vitest run tests/translate-buttons.test.tsx
npx vitest run tests/use-quote-translation.test.tsx
npx vitest run tests/quote-card-translation.test.tsx
```

- [ ] **Step 7: Run the full verification suite**

Run: `npm run compile && npm test`
Expected: `tsc --noEmit` exits 0; every test passes. Do not claim completion before both commands have actually run clean.

- [ ] **Step 8: Commit**

```bash
git add wxt.config.ts PRIVACY.md package.json CHANGELOG.md AGENTS.md
git commit -m "chore(release): 0.4.2 — quote translation via Google and AI"
```

---

## Manual Verification

After Task 11, load the built extension and confirm by hand — the automated tests mock every network call, so the real gtx endpoint has never actually been hit:

```bash
npm run build
```

1. Load `.output/chrome-mv3` as an unpacked extension.
2. Capture a quote of two or more sentences from any page.
3. Open the dashboard, Quotes tab. Click **EN·G**. Accept the permission prompt.
4. Confirm the English line appears, **and that both sentences are present** — this is the segment-joining behavior that only the real endpoint exercises.
5. Click **EN·G** again; the line hides. Click again; it shows.
6. Configure an AI provider in Settings, return, click **EN·AI**. Confirm a second, separately-toggleable line appears and the Google line is untouched.
7. Reload the dashboard. Both translations should still be there.
8. Export today's Markdown and confirm both nested bullets.
9. Decline the permission prompt on a fresh profile and confirm the localized permission message appears with a Retry chip rather than a silent failure.
