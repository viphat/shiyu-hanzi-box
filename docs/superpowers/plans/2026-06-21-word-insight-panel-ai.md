# AI Insight Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in AI insight layer to the Word Insight Panel that generates structured bilingual definitions, sample sentences, usage notes, and collocations for saved words, persisted onto `WordEntry.aiInsight` and flowing into exports and review cards.

**Architecture:** Pure modules under `lib/ai/` handle settings, prompt construction, response parsing, and OpenAI-compatible API calls. A new `local:aiSettings` storage item holds the BYO API key and provider config. The `AskAiButton` component in the expanded word card triggers the network call; the `AiInsightSection` renders the persisted result. `optional_host_permissions` are requested lazily on AI enable. The AI layer builds on top of the local Word Insight Panel delivered by Plan A — Plan A must land first.

**Tech Stack:** TypeScript, WXT 0.20.26, React 19, Tailwind 4, `wxt/utils/storage`, `wxt/browser` for `chrome.permissions`, Vitest 4.

**Prerequisite:** Plan A (`docs/superpowers/plans/2026-06-21-word-insight-panel-local.md`) must be complete, committed, and passing all tests. The local Word Insight Panel, dictionary assets, `WordInsightPanel`, `ReviewInsightReveal`, and markdown export must all exist and work before this plan starts.

---

## File Structure

**Create (pure AI modules — unit-tested, no Chrome APIs except `lib/ai/settings.ts`):**
- `lib/ai/settings.ts` — WXT storage for `local:aiSettings`, provider preset table, defaults.
- `lib/ai/prompt.ts` — pure `buildMessages(word, pinyin, cedictGlosses, recentOccurrence)` returning OpenAI-style `messages[]`. Testable.
- `lib/ai/parse.ts` — pure validation of model JSON response → `AiInsight`. Handles malformed JSON, missing/extra fields. Returns typed errors, never throws across boundary. Testable.
- `lib/ai/client.ts` — one `fetch` to `${baseUrl}/chat/completions` with `response_format: { type: 'json_object' }`. Returns typed result or error. Testable via mocked `fetch`.

**Create (UI components):**
- `entrypoints/newtab/components/AskAiButton.tsx` — trigger with idle / disabled-not-configured / loading / error / retry states.
- `entrypoints/newtab/components/AiInsightSection.tsx` — renders a persisted `AiInsight` below the local sections. Includes a "regenerate" control.
- `entrypoints/newtab/components/AiSettingsPanel.tsx` — provider picker, masked key, base URL (for custom), model, "test connection" action.

**Create (hooks):**
- `entrypoints/newtab/hooks/useAiInsight.ts` — orchestrates: reads settings, calls client, persists to `WordEntry.aiInsight` via `mutateInbox`. Handles all error states.

**Create (tests):**
- `tests/ai-prompt.test.ts`
- `tests/ai-parse.test.ts`
- `tests/ai-client.test.ts`

**Modify:**
- `lib/types.ts` — add `AiInsight`, `AiSettings`, and `AiProvider` types; add `aiInsight?: AiInsight` to `WordEntry`.
- `lib/ai/permissions.ts` — lazy `chrome.permissions.request` for the provider origin.
- `lib/markdown.ts` — add `## AI Insight` subsection per word when `aiInsight` is present.
- `lib/backup.ts` — update `hasEntryBase` to tolerate `aiInsight` on `WordEntry` (so old backups without it still parse, and new backups with it are preserved).
- `lib/export.ts` — pass the dictionary index to `renderDay` so both local definitions and AI insight render in exports.
- `entrypoints/newtab/components/WordInsightPanel.tsx` — render `AskAiButton` + `AiInsightSection` below the local sections.
- `entrypoints/newtab/components/ReviewInsightReveal.tsx` — show persisted AI insight in the review reveal (offline).
- `entrypoints/newtab/App.tsx` — add an AI settings gear icon in the toolbar area, and a settings modal/drawer with `AiSettingsPanel`.
- `wxt.config.ts` — add `optional_host_permissions` for DeepSeek and OpenAI origins.
- `AGENTS.md` — note the new `lib/ai/` modules.
- `README.md` — document the opt-in AI layer and BYO-key requirement.
- `package.json` — no new dependencies (uses native `fetch`).

---

## Task 0: Confirm Plan A is landed and baseline is clean

**Files:** none.

- [ ] **Step 1: Verify Plan A is complete**

Run: `git log --oneline -5`
Expected: the most recent commits should include Plan A tasks (dictionary parser, insight panel, review reveal, build script, etc.). If Plan A is not complete, **stop** — this plan depends on it.

- [ ] **Step 2: Verify clean tree**

Run: `git status --short`
Expected: empty output.

- [ ] **Step 3: Confirm baseline tests pass**

Run: `npm run compile && npm test`
Expected: compile succeeds; all tests pass. If any fail, stop.

---

## Task 1: AI types and extend WordEntry

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Read the current end of `lib/types.ts`**

Run: `cat lib/types.ts`
Confirm the file ends with the `EMPTY_INBOX` export and the insight domain types from Plan A.

- [ ] **Step 2: Append AI types to `lib/types.ts`**

Append exactly (after the existing insight types):

```ts

// ---------------------------------------------------------------------------
// AI Insight types (persisted on WordEntry)
// ---------------------------------------------------------------------------

export type AiProvider = 'deepseek' | 'openai' | 'custom';

/** Persisted AI settings (separate storage item, never synced). */
export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Persisted AI insight on a word entry. */
export interface AiInsight {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  generatedAt: number;
  summary: string;
  register: string;
  definitions: string[];
  sampleSentences: string[];
  translations: string[];
  collocations: string[];
  notes: string;
}
```

- [ ] **Step 3: Add `aiInsight?` to `WordEntry`**

In `lib/types.ts`, in the `WordEntry` interface, after the `occurrences: Occurrence[];` line, add:

```ts
  /** Opt-in AI-generated insight, persisted after explicit user request. */
  aiInsight?: AiInsight;
```

- [ ] **Step 4: Verify compile**

Run: `npm run compile`
Expected: no errors. (New field is optional, so existing code is unaffected.)

- [ ] **Step 5: Run full tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add AI insight and settings types, extend WordEntry"
```

---

## Task 2: AI settings storage and provider presets (TDD)

**Files:**
- Create: `lib/ai/settings.ts`
- Create: `tests/ai-settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ai-settings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPreset,
  DEFAULT_SETTINGS,
  getProviderOrigins,
  PROVIDER_PRESETS,
} from '../lib/ai/settings';

describe('PROVIDER_PRESETS', () => {
  it('has deepseek as the first preset', () => {
    expect(PROVIDER_PRESETS[0].provider).toBe('deepseek');
    expect(PROVIDER_PRESETS[0].baseUrl).toContain('deepseek.com');
  });

  it('has openai with the correct origin', () => {
    const openai = PROVIDER_PRESETS.find((p) => p.provider === 'openai');
    expect(openai).toBeDefined();
    expect(openai!.baseUrl).toContain('openai.com');
    expect(openai!.model).toBeTruthy();
  });

  it('has custom with empty baseUrl and model', () => {
    const custom = PROVIDER_PRESETS.find((p) => p.provider === 'custom');
    expect(custom).toBeDefined();
    expect(custom!.baseUrl).toBe('');
    expect(custom!.model).toBe('');
  });
});

describe('applyPreset', () => {
  it('fills baseUrl and model from a preset', () => {
    const settings = applyPreset(DEFAULT_SETTINGS, 'deepseek');
    expect(settings.provider).toBe('deepseek');
    expect(settings.baseUrl).toBe(PROVIDER_PRESETS[0].baseUrl);
    expect(settings.model).toBe(PROVIDER_PRESETS[0].model);
  });

  it('preserves apiKey and enabled when applying a preset', () => {
    const base = { ...DEFAULT_SETTINGS, apiKey: 'sk-test', enabled: true };
    const settings = applyPreset(base, 'openai');
    expect(settings.apiKey).toBe('sk-test');
    expect(settings.enabled).toBe(true);
  });
});

describe('getProviderOrigins', () => {
  it('returns the origin for a known provider', () => {
    expect(getProviderOrigins('deepseek')).toEqual(['https://api.deepseek.com/*']);
  });

  it('returns an empty array for custom (user must grant at request time)', () => {
    expect(getProviderOrigins('custom')).toEqual([]);
  });

  it('returns the origin for openai', () => {
    expect(getProviderOrigins('openai')).toEqual(['https://api.openai.com/*']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ai-settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/ai/settings.ts`:

```ts
import { storage } from 'wxt/utils/storage';
import type { AiProvider, AiSettings } from '../types';

export const DEFAULT_SETTINGS: AiSettings = {
  enabled: false,
  provider: 'deepseek',
  baseUrl: '',
  apiKey: '',
  model: '',
};

export const PROVIDER_PRESETS: Array<{
  provider: AiProvider;
  baseUrl: string;
  model: string;
  label: string;
}> = [
  {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    label: 'DeepSeek',
  },
  {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    label: 'OpenAI',
  },
  {
    provider: 'custom',
    baseUrl: '',
    model: '',
    label: 'Custom endpoint',
  },
];

/** Resolve `baseUrl` and `model` from the provider preset table. */
export function applyPreset(
  settings: AiSettings,
  provider: AiProvider,
): AiSettings {
  const preset = PROVIDER_PRESETS.find((p) => p.provider === provider);
  if (!preset) return settings;
  return {
    ...settings,
    provider,
    baseUrl: preset.baseUrl,
    model: preset.model,
  };
}

/** Return the `optional_host_permissions` origins for a provider. */
export function getProviderOrigins(provider: AiProvider): string[] {
  const preset = PROVIDER_PRESETS.find((p) => p.provider === provider);
  if (!preset || preset.baseUrl === '') return [];
  try {
    const url = new URL(preset.baseUrl);
    return [`${url.origin}/*`];
  } catch {
    return [];
  }
}

export const aiSettingsStorage = storage.defineItem<AiSettings>('local:aiSettings', {
  fallback: DEFAULT_SETTINGS,
});

export async function getAiSettings(): Promise<AiSettings> {
  return aiSettingsStorage.getValue();
}

export async function setAiSettings(next: AiSettings): Promise<void> {
  await aiSettingsStorage.setValue(next);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ai-settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/settings.ts tests/ai-settings.test.ts
git commit -m "feat: add AI settings storage with provider presets"
```

---

## Task 3: AI permissions (lazy optional_host_permissions)

**Files:**
- Create: `lib/ai/permissions.ts`
- Modify: `wxt.config.ts`

This task adds the manifest declaration and the lazy permission-request logic.

- [ ] **Step 1: Add `optional_host_permissions` to `wxt.config.ts`**

In `wxt.config.ts`, add `optional_host_permissions` to the manifest object (after `permissions`):

```ts
    optional_host_permissions: {
      origins: [
        'https://api.deepseek.com/*',
        'https://api.openai.com/*',
      ],
    },
```

- [ ] **Step 2: Create the permissions module**

Create `lib/ai/permissions.ts`:

```ts
import { browser } from 'wxt/browser';
import type { AiProvider } from '../types';
import { getProviderOrigins } from './settings';

/**
 * Request host permissions for the given provider. Call this when the user
 * enables AI or changes provider. Returns `true` if the user granted the
 * permission, `false` otherwise.
 *
 * For `custom` endpoints, the caller must first ask the user for the URL
 * and pass it explicitly.
 */
export async function requestProviderPermission(
  provider: AiProvider,
  customOrigin?: string,
): Promise<boolean> {
  const presetOrigins = getProviderOrigins(provider);
  const origins = customOrigin
    ? [customOrigin]
    : presetOrigins;
  if (origins.length === 0) return true; // custom with no origin: user handles it later

  try {
    return await browser.permissions.request({ origins });
  } catch {
    return false;
  }
}

/**
 * Check whether the given provider's origin is currently granted.
 */
export async function hasProviderPermission(
  provider: AiProvider,
): Promise<boolean> {
  const origins = getProviderOrigins(provider);
  if (origins.length === 0) return true;
  try {
    return await browser.permissions.contains({ origins });
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Verify compile**

Run: `npm run compile`
Expected: clean. (No test for `chrome.permissions` itself — it's a thin browser API wrapper. The behavior is tested manually in Task 13.)

- [ ] **Step 4: Run full tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/permissions.ts wxt.config.ts
git commit -m "feat: add lazy optional_host_permissions for AI providers"
```

---

## Task 4: AI prompt builder (TDD)

**Files:**
- Create: `lib/ai/prompt.ts`
- Create: `tests/ai-prompt.test.ts`

Pure function — no Chrome APIs, no network. Builds the `messages[]` array for the OpenAI-compatible API.

- [ ] **Step 1: Write the failing test**

Create `tests/ai-prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildMessages } from '../lib/ai/prompt';
import type { WordEntry, DictionaryEntry } from '../lib/types';

const word: WordEntry = {
  id: 'w1',
  kind: 'word',
  text: '行',
  normalized: '行',
  note: '',
  status: 'inbox',
  createdAt: 1,
  updatedAt: 1,
  occurrences: [
    {
      sourceTitle: 'Test',
      sourceUrl: 'https://test.com',
      sourceDomain: 'test.com',
      surrounding: '你今天出行很方便',
      capturedAt: 1,
    },
  ],
};

const cedictEntries: DictionaryEntry[] = [
  { index: 0, traditional: '行', simplified: '行', pinyin: 'xing2', definitions: ['to walk', 'to travel'] },
  { index: 1, traditional: '行', simplified: '行', pinyin: 'hang2', definitions: ['row', 'line'] },
];

describe('buildMessages', () => {
  it('returns a system message and a user message', () => {
    const messages = buildMessages(word, undefined, [], undefined);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('the system message requests JSON output and lists fields', () => {
    const messages = buildMessages(word, undefined, [], undefined);
    const system = messages[0].content as string;
    expect(system).toContain('summary');
    expect(system).toContain('sampleSentences');
    expect(system).toContain('translations');
    expect(system).toContain('register');
    expect(system).toContain('json');
  });

  it('the user message contains the word text', () => {
    const messages = buildMessages(word, undefined, [], undefined);
    const user = messages[1].content as string;
    expect(user).toContain('行');
  });

  it('includes pinyin when provided', () => {
    const messages = buildMessages(word, 'xíng', [], undefined);
    const user = messages[1].content as string;
    expect(user).toContain('xíng');
  });

  it('includes CEDICT glosses when provided', () => {
    const messages = buildMessages(word, undefined, cedictEntries, undefined);
    const user = messages[1].content as string;
    expect(user).toContain('xing2');
    expect(user).toContain('to walk');
    expect(user).toContain('hang2');
    expect(user).toContain('row');
  });

  it('includes a recent occurrence when provided', () => {
    const messages = buildMessages(word, undefined, [], word.occurrences[0]);
    const user = messages[1].content as string;
    expect(user).toContain('出行');
  });

  it('is deterministic: same inputs produce same output', () => {
    const a = buildMessages(word, 'xíng', cedictEntries, word.occurrences[0]);
    const b = buildMessages(word, 'xíng', cedictEntries, word.occurrences[0]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ai-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/ai/prompt.ts`:

```ts
import type { DictionaryEntry, Occurrence, WordEntry } from '../types';

interface Message {
  role: 'system' | 'user';
  content: string;
}

const SYSTEM_PROMPT = `You are a Chinese-English dictionary assistant. Given a Chinese word, produce a structured JSON object with the following fields:

- "summary": a one-line English gloss
- "register": one of 书面/口语/formal/slang/neutral
- "definitions": an array of 1-3 bilingual definitions (Chinese definition + English gloss), richer than a basic dictionary
- "sampleSentences": an array of 2-3 Chinese example sentences using this word
- "translations": an array of English translations parallel to sampleSentences (same length and order)
- "collocations": an array of 2-4 common collocations or phrases
- "notes": usage notes covering nuance, register, common mistakes, or polyphone guidance

Respond with valid JSON only. No markdown, no code fences, no commentary.`;

export function buildMessages(
  word: WordEntry,
  pinyin: string | undefined,
  cedictEntries: DictionaryEntry[],
  recentOccurrence: Occurrence | undefined,
): Message[] {
  const parts: string[] = [`Word: ${word.text}`];

  if (pinyin) {
    parts.push(`Pinyin: ${pinyin}`);
  }

  if (cedictEntries.length > 0) {
    const glossLines = cedictEntries.map(
      (e) => `  [${e.pinyin}] ${e.definitions.join('; ')}`,
    );
    parts.push(`CEDICT entries:\n${glossLines.join('\n')}`);
  }

  if (recentOccurrence?.surrounding) {
    parts.push(`Recent context: ${recentOccurrence.surrounding}`);
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ai-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/prompt.ts tests/ai-prompt.test.ts
git commit -m "feat: add AI prompt builder"
```

---

## Task 5: AI response parser (TDD)

**Files:**
- Create: `lib/ai/parse.ts`
- Create: `tests/ai-parse.test.ts`

Pure function — validates the model's JSON response into a typed `AiInsight`. Returns a typed error, never throws across the boundary.

- [ ] **Step 1: Write the failing test**

Create `tests/ai-parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseAiResponse, type AiParseError } from '../lib/ai/parse';

const validBody = {
  summary: 'hello; to do something',
  register: 'neutral',
  definitions: ['打招呼；问候 — hello', '做某事 — to do something'],
  sampleSentences: ['你好，很高兴认识你。', '你好世界。'],
  translations: ['Hello, nice to meet you.', 'Hello world.'],
  collocations: ['你好吗', '你好啊'],
  notes: 'Common greeting. Also used as "how are you?" with 吗.',
};

describe('parseAiResponse', () => {
  it('parses a well-formed response', () => {
    const result = parseAiResponse(JSON.stringify(validBody), 'deepseek', 'deepseek-chat', 'https://api.deepseek.com/v1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toBe('hello; to do something');
    expect(result.value.register).toBe('neutral');
    expect(result.value.definitions).toHaveLength(2);
    expect(result.value.sampleSentences).toHaveLength(2);
    expect(result.value.translations).toHaveLength(2);
    expect(result.value.provider).toBe('deepseek');
    expect(result.value.generatedAt).toBeGreaterThan(0);
  });

  it('returns a parse error for malformed JSON', () => {
    const result = parseAiResponse('{ not json }', 'deepseek', 'deepseek-chat', '');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result as AiParseError).reason).toContain('JSON');
  });

  it('returns a parse error for non-object JSON', () => {
    const result = parseAiResponse('"just a string"', 'deepseek', 'deepseek-chat', '');
    expect(result.ok).toBe(false);
  });

  it('tolerates missing optional fields and uses defaults', () => {
    const result = parseAiResponse(
      JSON.stringify({ summary: 'test' }),
      'openai',
      'gpt-4o-mini',
      'https://api.openai.com/v1',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toBe('test');
    expect(result.value.definitions).toEqual([]);
    expect(result.value.sampleSentences).toEqual([]);
    expect(result.value.translations).toEqual([]);
    expect(result.value.collocations).toEqual([]);
    expect(result.value.notes).toBe('');
    expect(result.value.register).toBe('neutral');
  });

  it('tolerates extra unknown fields', () => {
    const result = parseAiResponse(
      JSON.stringify({ ...validBody, extraField: 'ignored' }),
      'deepseek',
      'deepseek-chat',
      '',
    );
    expect(result.ok).toBe(true);
  });

  it('coerces non-array fields to empty arrays', () => {
    const result = parseAiResponse(
      JSON.stringify({ ...validBody, definitions: 'not an array' }),
      'deepseek',
      'deepseek-chat',
      '',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.definitions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ai-prompt.test.ts` — oops, wrong file. Run:

`npx vitest run tests/ai-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/ai/parse.ts`:

```ts
import type { AiInsight, AiProvider } from '../types';

export type AiParseResult =
  | { ok: true; value: AiInsight }
  | { ok: false; reason: string };

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Parse the model's JSON response body into a typed `AiInsight`. Returns a
 * structured error rather than throwing — the caller decides how to surface it.
 */
export function parseAiResponse(
  body: string,
  provider: AiProvider,
  model: string,
  baseUrl: string,
): AiParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'Response is not valid JSON.' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'Response is not a JSON object.' };
  }

  const obj = parsed as Record<string, unknown>;

  return {
    ok: true,
    value: {
      provider,
      model,
      baseUrl,
      generatedAt: Date.now(),
      summary: typeof obj.summary === 'string' ? obj.summary : '',
      register: typeof obj.register === 'string' ? obj.register : 'neutral',
      definitions: toStringArray(obj.definitions),
      sampleSentences: toStringArray(obj.sampleSentences),
      translations: toStringArray(obj.translations),
      collocations: toStringArray(obj.collocations),
      notes: typeof obj.notes === 'string' ? obj.notes : '',
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ai-parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/parse.ts tests/ai-parse.test.ts
git commit -m "feat: add AI response parser with typed error handling"
```

---

## Task 6: AI client (TDD)

**Files:**
- Create: `lib/ai/client.ts`
- Create: `tests/ai-client.test.ts`

One `fetch` to `${baseUrl}/chat/completions`. Testable via mocked `fetch`.

- [ ] **Step 1: Write the failing test**

Create `tests/ai-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAiInsight } from '../lib/ai/client';

const VALID_RESPONSE_BODY = JSON.stringify({
  summary: 'hello',
  register: 'neutral',
  definitions: ['打招呼 — hello'],
  sampleSentences: ['你好。'],
  translations: ['Hello.'],
  collocations: [],
  notes: '',
});

const VALID_COMPLETION = {
  ok: true as const,
  status: 200,
  json: async () => ({
    choices: [{ message: { content: VALID_RESPONSE_BODY } }],
  }),
} as unknown as Response;

describe('fetchAiInsight', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls fetch with the correct URL, headers, body, and response_format', async () => {
    fetchSpy.mockResolvedValue(VALID_COMPLETION);

    await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: '你好' }],
      provider: 'deepseek',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect((init!.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
    expect((init!.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('includes response_format json_object in the body', async () => {
    fetchSpy.mockResolvedValue(VALID_COMPLETION);

    await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'test' }],
      provider: 'deepseek',
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.model).toBe('deepseek-chat');
    expect(body.messages).toEqual([{ role: 'user', content: 'test' }]);
  });

  it('returns the parsed AiInsight on success', async () => {
    fetchSpy.mockResolvedValue(VALID_COMPLETION);

    const result = await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'test' }],
      provider: 'deepseek',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toBe('hello');
  });

  it('returns a "key rejected" error on 401/403', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 401, json: async () => ({}) } as Response);
    const result = await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-bad', model: 'm', messages: [], provider: 'deepseek',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('key rejected');
  });

  it('returns a "rate limited" error on 429', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 429, json: async () => ({}) } as Response);
    const result = await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk', model: 'm', messages: [], provider: 'deepseek',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('Rate limited');
  });

  it('returns an "unreachable" error on 5xx', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 502, json: async () => ({}) } as Response);
    const result = await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk', model: 'm', messages: [], provider: 'deepseek',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('unreachable');
  });

  it('returns an "unreachable" error on network failure', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk', model: 'm', messages: [], provider: 'deepseek',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('unreachable');
  });

  it('returns a "parse error" when the model returns bad JSON', async () => {
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    } as unknown as Response);
    const result = await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk', model: 'm', messages: [], provider: 'deepseek',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('Unexpected');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ai-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/ai/client.ts`:

```ts
import type { AiInsight, AiProvider } from '../types';
import { parseAiResponse, type AiParseResult } from './parse';

export interface FetchAiParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  provider: AiProvider;
}

export type AiClientResult =
  | { ok: true; value: AiInsight }
  | { ok: false; reason: string };

function classifyHttpStatus(status: number): string | null {
  if (status === 401 || status === 403) return 'API key rejected by provider.';
  if (status === 429) return 'Rate limited; wait and retry.';
  if (status >= 500) return 'Provider unreachable; retry.';
  return null;
}

/**
 * Call the OpenAI-compatible /chat/completions endpoint and parse the
 * response into an AiInsight. Returns a typed error for every failure mode.
 */
export async function fetchAiInsight(
  params: FetchAiParams,
): Promise<AiClientResult> {
  const { baseUrl, apiKey, model, messages, provider } = params;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: 'json_object' },
      }),
    });

    const httpError = classifyHttpStatus(res.status);
    if (httpError) return { ok: false, reason: httpError };

    const data = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return { ok: false, reason: 'Unexpected response: no message content.' };
    }

    const parsed: AiParseResult = parseAiResponse(content, provider, model, baseUrl);
    if (!parsed.ok) return { ok: false, reason: `Unexpected response; ${parsed.reason}` };
    return parsed;
  } catch {
    return { ok: false, reason: 'Provider unreachable; retry.' };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ai-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/client.ts tests/ai-client.test.ts
git commit -m "feat: add AI client with typed error handling"
```

---

## Task 7: useAiInsight hook (orchestrator)

**Files:**
- Create: `entrypoints/newtab/hooks/useAiInsight.ts`

Orchestrates: reads settings → calls client → persists result to `WordEntry.aiInsight` via `mutateInbox` → handles all error states. No test (it glues tested modules; behavior is covered by the pure module tests).

- [ ] **Step 1: Implement**

Create `entrypoints/newtab/hooks/useAiInsight.ts`:

```ts
import { useState } from 'react';
import { fetchAiInsight, type AiClientResult } from '@/lib/ai/client';
import { buildMessages } from '@/lib/ai/prompt';
import { getAiSettings } from '@/lib/ai/settings';
import { mutateInbox } from '@/lib/storage';
import type { AiInsight, WordEntry } from '@/lib/types';

export type AiRequestState =
  | 'idle'
  | 'loading'
  | 'disabled'
  | 'error';

export function useAiInsight(word: WordEntry) {
  const [state, setState] = useState<AiRequestState>('idle');
  const [error, setError] = useState('');

  async function requestInsight() {
    setState('loading');
    setError('');

    try {
      const settings = await getAiSettings();
      if (!settings.enabled || !settings.apiKey) {
        setState('disabled');
        setError('Configure AI to use this.');
        return;
      }

      const recentOccurrence = word.occurrences[0];
      const messages = buildMessages(
        word,
        word.pinyin,
        [], // CEDICT entries are not passed here to keep the prompt focused;
            // the model generates richer definitions from its training data.
        recentOccurrence,
      );

      const result: AiClientResult = await fetchAiInsight({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        messages,
        provider: settings.provider,
      });

      if (!result.ok) {
        setState('error');
        setError(result.reason);
        return;
      }

      // Persist the insight onto the WordEntry.
      const insight: AiInsight = result.value;
      await mutateInbox((inbox) => ({
        ...inbox,
        words: inbox.words.map((w) =>
          w.id === word.id
            ? { ...w, aiInsight: insight, updatedAt: Date.now() }
            : w,
        ),
      }));

      setState('idle');
    } catch {
      setState('error');
      setError('Provider unreachable; retry.');
    }
  }

  return { state, error, requestInsight };
}
```

- [ ] **Step 2: Verify compile**

Run: `npm run compile`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add entrypoints/newtab/hooks/useAiInsight.ts
git commit -m "feat: add useAiInsight orchestrator hook"
```

---

## Task 8: AskAiButton + AiInsightSection components

**Files:**
- Create: `entrypoints/newtab/components/AskAiButton.tsx`
- Create: `entrypoints/newtab/components/AiInsightSection.tsx`

Following the shuimo theme conventions.

- [ ] **Step 1: Create AskAiButton**

Create `entrypoints/newtab/components/AskAiButton.tsx`:

```tsx
import { Loader2, Sparkles } from 'lucide-react';
import type { AiRequestState } from '../hooks/useAiInsight';

export function AskAiButton({
  state,
  error,
  onAsk,
  onRetry,
}: {
  state: AiRequestState;
  error: string;
  onAsk: () => void;
  onRetry: () => void;
}) {
  if (state === 'disabled') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs text-muted">
        <Sparkles className="h-3 w-3" /> AI 释义未配置
      </span>
    );
  }

  const isClick = state === 'idle' || state === 'error';

  return (
    <div className="space-y-1">
      <button
        onClick={isClick ? (state === 'error' ? onRetry : onAsk) : undefined}
        disabled={!isClick}
        className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1.5 text-xs transition ${
          state === 'error'
            ? 'border-cinnabar-border bg-cinnabar-light text-cinnabar hover:bg-cinnabar hover:text-white'
            : 'border-border bg-paper-input text-muted hover:border-cinnabar-border hover:text-cinnabar'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {state === 'loading' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
        {state === 'loading' ? '正在生成…' : state === 'error' ? '重试' : 'AI 释义'}
      </button>
      {state === 'error' && (
        <p className="text-[11px] text-cinnabar">{error}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create AiInsightSection**

Create `entrypoints/newtab/components/AiInsightSection.tsx`:

```tsx
import { RefreshCw } from 'lucide-react';
import type { AiInsight as AiInsightType } from '@/lib/types';

export function AiInsightSection({
  insight,
  onRegenerate,
}: {
  insight: AiInsightType;
  onRegenerate: () => void;
}) {
  return (
    <div className="space-y-2 rounded-sm border border-cinnabar-fade bg-paper-light p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[2px] text-cinnabar">
          AI 释义
        </p>
        <button
          onClick={onRegenerate}
          title="重新生成"
          className="rounded-sm p-1 text-muted transition hover:bg-paper-input hover:text-cinnabar"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {insight.summary && (
        <p className="text-sm text-ink">{insight.summary}</p>
      )}

      {insight.register && (
        <span className="inline-block rounded-sm border border-border bg-paper-input px-1.5 py-0.5 text-[11px] text-muted">
          {insight.register}
        </span>
      )}

      {insight.definitions.length > 0 && (
        <ul className="space-y-1">
          {insight.definitions.map((def, i) => (
            <li key={i} className="text-xs leading-5 text-ink-secondary">{def}</li>
          ))}
        </ul>
      )}

      {insight.sampleSentences.map((sent, i) => (
        <div key={i} className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
          <p className="text-xs leading-5 text-ink-secondary">{sent}</p>
          {insight.translations[i] && (
            <p className="mt-0.5 text-xs text-muted">{insight.translations[i]}</p>
          )}
        </div>
      ))}

      {insight.collocations.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {insight.collocations.map((col, i) => (
            <span key={i} className="rounded-sm border border-border bg-paper-input px-1.5 py-0.5 text-[11px] text-muted">
              {col}
            </span>
          ))}
        </div>
      )}

      {insight.notes && (
        <p className="text-xs leading-5 text-muted">{insight.notes}</p>
      )}

      <p className="text-[10px] text-muted">
        Generated by {insight.model} · {new Date(insight.generatedAt).toLocaleString('zh-CN')}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Verify compile**

Run: `npm run compile`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add entrypoints/newtab/components/AskAiButton.tsx entrypoints/newtab/components/AiInsightSection.tsx
git commit -m "feat: add AskAiButton and AiInsightSection components"
```

---

## Task 9: Wire AI into WordInsightPanel

**Files:**
- Modify: `entrypoints/newtab/components/WordInsightPanel.tsx`

Add `AskAiButton` + `AiInsightSection` below the local sections.

- [ ] **Step 1: Read the current WordInsightPanel**

Run: `cat entrypoints/newtab/components/WordInsightPanel.tsx`
Confirm the structure matches what Plan A produced.

- [ ] **Step 2: Add AI imports and render AI section**

Add imports at the top of `WordInsightPanel.tsx`:

```tsx
import { useAiInsight } from '../hooks/useAiInsight';
import { AskAiButton } from './AskAiButton';
import { AiInsightSection } from './AiInsightSection';
```

Inside the `WordInsightPanel` component function, after `const { insight, loading } = useWordInsight(word);`, add:

```tsx
  const { state: aiState, error: aiError, requestInsight } = useAiInsight(word);
```

Then in the JSX, immediately before the closing `</div>` (after the `<p className="text-[10px] text-muted">Dictionary: CC-CEDICT</p>` line), add:

```tsx
      <div className="border-t border-border pt-3">
        <AskAiButton
          state={aiState}
          error={aiError}
          onAsk={requestInsight}
          onRetry={requestInsight}
        />
        {word.aiInsight && (
          <div className="mt-2">
            <AiInsightSection
              insight={word.aiInsight}
              onRegenerate={requestInsight}
            />
          </div>
        )}
      </div>
```

- [ ] **Step 3: Verify compile**

Run: `npm run compile`
Expected: clean.

- [ ] **Step 4: Run full tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/newtab/components/WordInsightPanel.tsx
git commit -m "feat: wire AskAiButton and AiInsightSection into word panel"
```

---

## Task 10: Show persisted AI insight in review reveal

**Files:**
- Modify: `entrypoints/newtab/components/ReviewInsightReveal.tsx`

Review cards show persisted AI insight offline. No "Ask AI" button in review — just the persisted result.

- [ ] **Step 1: Read the current ReviewInsightReveal**

Run: `cat entrypoints/newtab/components/ReviewInsightReveal.tsx`

- [ ] **Step 2: Add AI section after local sections**

After the `<SourceExamples .../>` render, and before the closing `</div>`, add:

```tsx
      {word.aiInsight && (
        <div className="rounded-sm border border-cinnabar-fade bg-paper-light p-3 space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-[2px] text-cinnabar">AI 释义</p>
          <p className="text-sm text-ink">{word.aiInsight.summary}</p>
          {word.aiInsight.definitions.map((def, i) => (
            <p key={i} className="text-xs text-ink-secondary">{def}</p>
          ))}
        </div>
      )}
```

- [ ] **Step 3: Verify compile**

Run: `npm run compile`
Expected: clean.

- [ ] **Step 4: Run full tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/newtab/components/ReviewInsightReveal.tsx
git commit -m "feat: show persisted AI insight in review reveal"
```

---

## Task 11: AiSettingsPanel + wire into App

**Files:**
- Create: `entrypoints/newtab/components/AiSettingsPanel.tsx`
- Modify: `entrypoints/newtab/App.tsx`

The settings panel offers provider picker, masked key, model, and a "test connection" action. It's opened from a gear icon in the App toolbar area.

- [ ] **Step 1: Create AiSettingsPanel**

Create `entrypoints/newtab/components/AiSettingsPanel.tsx`:

```tsx
import { Eye, EyeOff, Save, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import type { AiSettings } from '@/lib/types';
import {
  applyPreset,
  DEFAULT_SETTINGS,
  PROVIDER_PRESETS,
} from '@/lib/ai/settings';

export function AiSettingsPanel({
  settings,
  onSave,
  onTestConnection,
  testing,
  testResult,
}: {
  settings: AiSettings;
  onSave: (next: AiSettings) => void;
  onTestConnection: () => Promise<{ ok: boolean; message: string }>;
  testing: boolean;
  testResult: { ok: boolean; message: string } | null;
}) {
  const [draft, setDraft] = useState<AiSettings>({ ...settings });
  const [showKey, setShowKey] = useState(false);
  const [open, setOpen] = useState(false);

  function handleProviderChange(provider: string) {
    const next = applyPreset(draft, provider as AiSettings['provider']);
    setDraft(next);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="AI 设置"
        className="rounded-sm border border-border bg-transparent p-1.5 text-muted transition hover:border-border-hover hover:bg-paper-input hover:text-ink-secondary"
      >
        <SparklesIcon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="rounded-sm border border-border bg-paper-light p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink tracking-[2px]">AI 设置</p>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-ink-secondary text-xs">
          关闭
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {/* Enable toggle */}
        <label className="flex items-center gap-2 text-xs text-ink-secondary">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            className="rounded-sm"
          />
          启用 AI 释义
        </label>

        {/* Provider picker */}
        <div>
          <label className="block text-[11px] font-medium text-muted mb-1">Provider</label>
          <select
            value={draft.provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs text-ink outline-none focus:border-cinnabar-fade"
          >
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.provider} value={p.provider}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* API Key */}
        <div>
          <label className="block text-[11px] font-medium text-muted mb-1">API Key</label>
          <div className="flex gap-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder="sk-..."
              className="flex-1 rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs text-ink outline-none focus:border-cinnabar-fade"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="rounded-sm border border-border bg-paper-input p-1.5 text-muted hover:text-ink-secondary"
            >
              {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          </div>
          <p className="mt-0.5 text-[10px] text-muted">
            Key 存储在本地，仅发送至您选择的 provider。
          </p>
        </div>

        {/* Base URL (editable for custom) */}
        <div>
          <label className="block text-[11px] font-medium text-muted mb-1">Base URL</label>
          <input
            type="url"
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            placeholder="https://api.deepseek.com/v1"
            className="w-full rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs text-ink outline-none focus:border-cinnabar-fade"
          />
        </div>

        {/* Model */}
        <div>
          <label className="block text-[11px] font-medium text-muted mb-1">Model</label>
          <input
            type="text"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            placeholder="deepseek-chat"
            className="w-full rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs text-ink outline-none focus:border-cinnabar-fade"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => { onSave(draft); setOpen(false); }}
            className="inline-flex items-center gap-1 rounded-sm bg-cinnabar px-3 py-1.5 text-xs font-medium text-white shadow-sm tracking-[1px] transition hover:brightness-95"
          >
            <Save className="h-3 w-3" /> 保存
          </button>
          <button
            onClick={onTestConnection}
            disabled={testing || !draft.apiKey}
            className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-ink-secondary tracking-[1px] transition hover:border-border-hover hover:bg-paper-input disabled:opacity-50"
          >
            {testing ? '...' : testResult ? (testResult.ok ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />) : <Wifi className="h-3 w-3" />}
            测试连接
          </button>
          {testResult && (
            <span className={`text-[11px] ${testResult.ok ? 'text-ink-secondary' : 'text-cinnabar'}`}>
              {testResult.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.9a2 2 0 0 0 1.2 1.2L21 12l-5.9 1.9a2 2 0 0 0-1.2 1.2L12 21l-1.9-5.9a2 2 0 0 0-1.2-1.2L3 12l5.9-1.9a2 2 0 0 0 1.2-1.2L12 3z" />
    </svg>
  );
}
```

- [ ] **Step 2: Wire into App.tsx**

In `entrypoints/newtab/App.tsx`, add imports:

```tsx
import { useState as useState2 } from 'react';
import { AiSettingsPanel } from './components/AiSettingsPanel';
import { getAiSettings, setAiSettings } from '@/lib/ai/settings';
import { fetchAiInsight } from '@/lib/ai/client';
import type { AiSettings } from '@/lib/types';
```

> Note: if `useState` is already imported, just add `useState as useState2` or rename appropriately. Adjust to avoid a naming conflict.

Add a settings state in the App component (after the existing `const [statusFilter, ...]` line):

```tsx
  const [aiSettings, setAiSettingsState] = useState2<AiSettings | null>(null);
  const [aiTesting, setAiTesting] = useState2(false);
  const [aiTestResult, setAiTestResult] = useState2<{ ok: boolean; message: string } | null>(null);

  // Load AI settings lazily when the panel is opened.
  async function openAiSettings() {
    const s = await getAiSettings();
    setAiSettingsState(s);
    setAiTestResult(null);
  }

  async function saveAiSettings(next: AiSettings) {
    await setAiSettings(next);
    setAiSettingsState(next);
  }

  async function testAiConnection() {
    if (!aiSettings) return;
    setAiTesting(true);
    try {
      const result = await fetchAiInsight({
        baseUrl: aiSettings.baseUrl,
        apiKey: aiSettings.apiKey,
        model: aiSettings.model,
        messages: [{ role: 'user', content: 'ping' }],
        provider: aiSettings.provider,
      });
      setAiTestResult({ ok: result.ok, message: result.ok ? '连接成功' : result.reason });
    } catch {
      setAiTestResult({ ok: false, message: '连接失败' });
    }
    setAiTesting(false);
  }
```

Then render the settings panel inside the `<main>` block, between the `</Toolbar>` and the tab bar. Add:

```tsx
        {aiSettings && (
          <AiSettingsPanel
            settings={aiSettings}
            onSave={saveAiSettings}
            onTestConnection={testAiConnection}
            testing={aiTesting}
            testResult={aiTestResult}
          />
        )}
```

And add a trigger button in the toolbar row — in the `<Toolbar>` call area, add a small button:

```tsx
        <div className="flex items-center gap-2">
          <button
            onClick={openAiSettings}
            title="AI 设置"
            className="rounded-sm border border-border bg-transparent p-1.5 text-muted transition hover:border-border-hover hover:bg-paper-input hover:text-ink-secondary"
          >
            ✦
          </button>
        </div>
```

- [ ] **Step 3: Verify compile**

Run: `npm run compile`
Expected: clean.

- [ ] **Step 4: Run full tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/newtab/components/AiSettingsPanel.tsx entrypoints/newtab/App.tsx
git commit -m "feat: add AI settings panel with provider picker and test connection"
```

---

## Task 12: Extend markdown export with AI insight

**Files:**
- Modify: `lib/markdown.ts`
- Modify: `tests/markdown.test.ts`

Add a `## AI Insight` subsection per word when `aiInsight` is present.

- [ ] **Step 1: Add a failing test**

Append to `tests/markdown.test.ts`:

```ts
import type { AiInsight } from '../lib/types';

const aiInsight: AiInsight = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com/v1',
  generatedAt: 1,
  summary: 'hello greeting',
  register: 'neutral',
  definitions: ['打招呼 — hello'],
  sampleSentences: ['你好世界。'],
  translations: ['Hello world.'],
  collocations: ['你好吗'],
  notes: 'Common greeting.',
};

describe('renderDay with AI insight', () => {
  it('includes an AI Insight subsection when the word has aiInsight', () => {
    const w: WordEntry = { ...word, aiInsight };
    const md = renderDay(day, [w], []);
    expect(md).toContain('AI Insight');
    expect(md).toContain('hello greeting');
    expect(md).toContain('你好世界。');
    expect(md).toContain('Hello world.');
  });

  it('omits the AI Insight subsection when aiInsight is absent', () => {
    const md = renderDay(day, [word], []);
    expect(md).not.toContain('AI Insight');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/markdown.test.ts`
Expected: FAIL — no AI Insight in output.

- [ ] **Step 3: Implement**

In `lib/markdown.ts`, inside the `for (const word of words)` loop, after the dictionary lines block and before `lines.push('');`, add:

```ts
      if (word.aiInsight) {
        const ai = word.aiInsight;
        lines.push('  - AI Insight:');
        if (ai.summary) lines.push(`    - _${esc(ai.summary)}_ (${esc(ai.register)})`);
        for (const def of ai.definitions) {
          lines.push(`    - ${esc(def)}`);
        }
        for (let i = 0; i < ai.sampleSentences.length; i += 1) {
          lines.push(`    - ${esc(ai.sampleSentences[i])}`);
          if (ai.translations[i]) {
            lines.push(`      ${esc(ai.translations[i])}`);
          }
        }
        if (ai.collocations.length > 0) {
          lines.push(`    - 搭配: ${ai.collocations.map((c) => esc(c)).join(', ')}`);
        }
        if (ai.notes) lines.push(`    - ${esc(ai.notes)}`);
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/markdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/markdown.ts tests/markdown.test.ts
git commit -m "feat: include AI insight in markdown export"
```

---

## Task 13: Update backup validator to tolerate aiInsight

**Files:**
- Modify: `lib/backup.ts`

The backup parser's `hasEntryBase` function explicitly checks known fields. An old backup without `aiInsight` must still parse. A new backup with `aiInsight` must preserve it. Currently `hasEntryBase` does not reject unknown fields (it only checks known ones), and `cloneJson` copies everything — so this should already work. But we add an explicit comment and a test to prevent regressions.

- [ ] **Step 1: Add a failing test for backup round-trip with aiInsight**

Append to `tests/markdown.test.ts` or create `tests/backup-ai.test.ts`. Let me put it in a focused file:

Create `tests/backup-ai.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createBackup, parseBackup, serializeBackup } from '../lib/backup';
import type { Inbox, WordEntry } from '../lib/types';

const word: WordEntry = {
  id: 'w1',
  kind: 'word',
  text: '你好',
  normalized: '你好',
  note: '',
  status: 'inbox',
  createdAt: 1,
  updatedAt: 1,
  occurrences: [],
  aiInsight: {
    provider: 'deepseek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    generatedAt: 1,
    summary: 'hello',
    register: 'neutral',
    definitions: ['打招呼 — hello'],
    sampleSentences: ['你好。'],
    translations: ['Hello.'],
    collocations: [],
    notes: '',
  },
};

describe('backup round-trip with aiInsight', () => {
  it('preserves aiInsight through serialize/parse', () => {
    const inbox: Inbox = { words: [word], quotes: [] };
    const json = serializeBackup(inbox);
    const restored = parseBackup(json);
    expect(restored.words).toHaveLength(1);
    expect(restored.words[0].aiInsight).toBeDefined();
    expect(restored.words[0].aiInsight!.summary).toBe('hello');
  });

  it('parses old backups without aiInsight without error', () => {
    const old = { words: [{ ...word, aiInsight: undefined }], quotes: [] };
    const json = serializeBackup(old as Inbox);
    const restored = parseBackup(json);
    expect(restored.words[0].aiInsight).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it passes (or fails)**

Run: `npx vitest run tests/backup-ai.test.ts`
Expected: PASS — the existing backup code already tolerates unknown optional fields because `hasEntryBase` only checks known fields and `cloneJson` copies everything. If this passes, no code change is needed in `backup.ts`; just add a comment.

If it **fails**, add a comment in `lib/backup.ts` near `hasEntryBase`:
```ts
  // Note: aiInsight is an optional field on WordEntry added after format version 1.
  // It is not checked here; cloneJson preserves it on round-trip.
```

- [ ] **Step 3: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add tests/backup-ai.test.ts lib/backup.ts
git commit -m "test: verify backup round-trip preserves aiInsight"
```

---

## Task 14: Update AGENTS.md, README, and manifest docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] **Step 1: Update AGENTS.md**

In `AGENTS.md`, in the "Core modules" list, add after the AI modules section:

```markdown
- `lib/ai/settings.ts`: WXT storage for `local:aiSettings` and provider
  preset table (DeepSeek, OpenAI, custom endpoint).
- `lib/ai/prompt.ts`: pure function that builds the OpenAI-style messages
  array for the AI request.
- `lib/ai/parse.ts`: pure validation of the model JSON response into
  `AiInsight`.
- `lib/ai/client.ts`: single `fetch` to `${baseUrl}/chat/completions` with
  typed error handling.
- `lib/ai/permissions.ts`: lazy `chrome.permissions.request` for the
  configured provider origin.
- `entrypoints/newtab/components/AiSettingsPanel.tsx`: provider picker,
  masked key, model, test connection.
- `entrypoints/newtab/components/AskAiButton.tsx`: trigger with idle /
  disabled / loading / error / retry states.
- `entrypoints/newtab/components/AiInsightSection.tsx`: renders persisted AI
  insight below local sections.
- `entrypoints/newtab/hooks/useAiInsight.ts`: orchestrates settings → client
  → persist on WordEntry.
```

- [ ] **Step 2: Update README.md**

Add a section after the Word Insight Panel section:

```markdown
### AI Insight (opt-in)

The word card's expanded panel offers an "AI 释义" button that generates
structured bilingual definitions, sample sentences, collocations, and usage
notes. This is an **opt-in feature** — it requires a user-supplied API key
and does not run until you click the button.

**How it works:**

1. Open **AI 设置** from the dashboard toolbar.
2. Choose a provider (DeepSeek recommended, or OpenAI, or a custom endpoint).
3. Paste your API key and select a model.
4. Click "测试连接" to verify.
5. Expand any word card and click "AI 释义".

**Privacy:**

- The API key is stored in `chrome.storage.local` on your device only.
- AI requests send only the saved word (plus optional pinyin and one recent
  occurrence) to the provider you chose.
- Generated insights are persisted on the word and flow into backups,
  exports, and review cards — so you only pay for each insight once.
- When AI is disabled, the extension makes no network requests at all.
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs: document AI insight layer in AGENTS.md and README"
```

---

## Task 15: Final verification

**Files:** none.

- [ ] **Step 1: Run compile**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: all tests pass (Plan A + Plan B).

- [ ] **Step 3: Run build and inspect manifest**

Run: `npm run build && cat .output/chrome-mv3/manifest.json`
Expected: build succeeds; manifest now includes `optional_host_permissions` with DeepSeek and OpenAI origins. No new required permissions were added.

- [ ] **Step 4: Manual dashboard check**

Run: `npm run dev`
Test the following flow:
1. Open AI settings → confirm panel renders, pick DeepSeek, paste a key, test connection.
2. Disable AI → expand a word → confirm "AI 释义未配置" message.
3. Enable AI → expand a word → click "AI 释义" → confirm loading state → confirm insight renders.
4. Collapse and re-expand → confirm persisted insight loads without a network call.
5. Check a review card → confirm persisted AI insight shows in reveal.
6. Export a daily note → confirm AI insight is in the Markdown.

- [ ] **Step 5: Confirm no uncommitted changes**

Run: `git status --short`
Expected: empty.
