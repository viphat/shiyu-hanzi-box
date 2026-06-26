// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClozeEditor } from '../entrypoints/dashboard/components/ClozeEditor';
import { messages } from '../lib/i18n';
import type { Cloze, QuoteEntry } from '../lib/types';
import { getAiSettings } from '@/lib/ai/settings';
import { fetchClozeSuggestions } from '@/lib/ai/client';

// ---------------------------------------------------------------------------
// Module mocks for AI dependencies — preserve real isAiConfigured
// ---------------------------------------------------------------------------

vi.mock('@/lib/ai/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/settings')>();
  return { ...actual, getAiSettings: vi.fn() };
});
vi.mock('@/lib/ai/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/permissions')>();
  return { ...actual, requestAiSettingsPermission: vi.fn(async () => true) };
});
vi.mock('@/lib/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/client')>();
  return { ...actual, fetchClozeSuggestions: vi.fn() };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuote(overrides: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: '学而时习之',
    tags: [],
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    category: 'classic',
    sourceTitle: 'Analects',
    sourceUrl: 'https://example.com',
    sourceDomain: 'example.com',
    surrounding: '学而时习之，不亦说乎',
    ...overrides,
  };
}

function makeCloze(overrides: Partial<Cloze> = {}): Cloze {
  return { id: 'c1', start: 0, end: 2, ...overrides };
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

  // Default: AI disabled — keeps the mount-effect in useClozeSuggestions happy
  // without interfering with non-AI tests.
  vi.mocked(getAiSettings).mockResolvedValue({
    enabled: false,
    provider: 'deepseek',
    baseUrl: '',
    apiKey: '',
    model: '',
  });
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

function getButton(label: string): HTMLButtonElement {
  const btn = queryButton(label);
  if (!btn) throw new Error(`Button not found: "${label}"`);
  return btn;
}

async function click(btn: HTMLButtonElement) {
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Flush pending microtasks (e.g., the mount-effect async chain in useClozeSuggestions). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClozeEditor — existing clozes render as chips', () => {
  it('renders a chip for each existing cloze showing its text span', async () => {
    const cloze = makeCloze({ id: 'c1', start: 0, end: 2 }); // '学而'
    const quote = makeQuote({ clozes: [cloze] });

    await renderClient(
      <ClozeEditor
        quote={quote}
        onChange={vi.fn()}
        onUpdate={vi.fn()}
        locale="en"
      />,
    );

    // chip should show the text slice
    expect(container.textContent).toContain('学而');
  });

  it('renders a remove button on each cloze chip', async () => {
    const cloze = makeCloze({ id: 'c1', start: 0, end: 2 });
    const quote = makeQuote({ clozes: [cloze] });

    await renderClient(
      <ClozeEditor
        quote={quote}
        onChange={vi.fn()}
        onUpdate={vi.fn()}
        locale="en"
      />,
    );

    expect(queryButton(messages.en['cloze.removeBlank'])).not.toBeNull();
  });
});

describe('ClozeEditor — removing a chip', () => {
  it('calls onChange without the removed cloze', async () => {
    const cloze1 = makeCloze({ id: 'c1', start: 0, end: 2 });
    const cloze2 = makeCloze({ id: 'c2', start: 2, end: 4 });
    const quote = makeQuote({ clozes: [cloze1, cloze2] });
    const onChange = vi.fn();

    await renderClient(
      <ClozeEditor
        quote={quote}
        onChange={onChange}
        onUpdate={vi.fn()}
        locale="en"
      />,
    );

    // Click the remove button scoped to c1's chip via data-cloze-id attribute.
    const removeBtn = container.querySelector<HTMLButtonElement>(
      `button[data-cloze-id="c1"]`,
    );
    if (!removeBtn) throw new Error('Remove button for c1 not found');
    await click(removeBtn);

    expect(onChange).toHaveBeenCalledOnce();
    const result: Cloze[] = onChange.mock.calls[0][0];
    expect(result.map((c) => c.id)).toEqual(['c2']);
  });
});

describe('ClozeEditor — hint selector', () => {
  it('renders hint options and calls onChange with updated hint', async () => {
    const cloze = makeCloze({ id: 'c1', start: 0, end: 2 });
    const quote = makeQuote({ clozes: [cloze] });
    const onChange = vi.fn();

    await renderClient(
      <ClozeEditor
        quote={quote}
        onChange={onChange}
        onUpdate={vi.fn()}
        locale="en"
      />,
    );

    // Find the hint select
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();

    await act(async () => {
      select.value = 'pinyin';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledOnce();
    const result: Cloze[] = onChange.mock.calls[0][0];
    expect(result[0].hint).toBe('pinyin');
  });

  it('stores undefined (not "none") when user picks the none option', async () => {
    const cloze = makeCloze({ id: 'c1', start: 0, end: 2, hint: 'pinyin' });
    const quote = makeQuote({ clozes: [cloze] });
    const onChange = vi.fn();

    await renderClient(
      <ClozeEditor
        quote={quote}
        onChange={onChange}
        onUpdate={vi.fn()}
        locale="en"
      />,
    );

    const select = container.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'none';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledOnce();
    const result: Cloze[] = onChange.mock.calls[0][0];
    expect(result[0].hint).toBeUndefined();
  });
});

describe('ClozeEditor — drag-select via quoteTextRef', () => {
  // happy-dom can't drive a real Selection, so we stub window.getSelection and
  // hand the editor a ref to a span we build by hand (mirroring QuoteCard).
  function buildQuoteSpan(text: string): { span: HTMLSpanElement; textNode: Text } {
    const span = document.createElement('span');
    span.setAttribute('data-quote-text', '');
    const textNode = document.createTextNode(text);
    span.append(textNode);
    document.body.append(span);
    return { span, textNode };
  }

  function stubSelection(partial: {
    anchorNode: Node;
    anchorOffset: number;
    focusNode: Node;
    focusOffset: number;
    isCollapsed?: boolean;
  }) {
    const selection = {
      isCollapsed: false,
      removeAllRanges: vi.fn(),
      ...partial,
    };
    return vi
      .spyOn(window, 'getSelection')
      .mockReturnValue(selection as unknown as Selection);
  }

  it('commits a manual cloze for a valid selection within the quote span', async () => {
    const quote = makeQuote({ text: '学而时习之', clozes: [] });
    const onChange = vi.fn();
    const { span, textNode } = buildQuoteSpan(quote.text);
    const getSelection = stubSelection({
      anchorNode: textNode, anchorOffset: 0,
      focusNode: textNode, focusOffset: 2,
    });

    await renderClient(
      <ClozeEditor
        quote={quote}
        onChange={onChange}
        onUpdate={vi.fn()}
        locale="en"
        quoteTextRef={{ current: span }}
      />,
    );
    await click(getButton(messages.en['cloze.addBlank']));

    expect(onChange).toHaveBeenCalledOnce();
    const result: Cloze[] = onChange.mock.calls[0][0];
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ start: 0, end: 2 });
    expect(result[0].wordId).toBeUndefined();

    getSelection.mockRestore();
    span.remove();
  });

  it('maps a whole-quote (select-all) selection to the full text span', async () => {
    // anchorNode === focusNode === the span element; offsets are CHILD indices.
    const quote = makeQuote({ text: '学而时习之', clozes: [] });
    const onChange = vi.fn();
    const { span } = buildQuoteSpan(quote.text);
    const getSelection = stubSelection({
      anchorNode: span, anchorOffset: 0,
      focusNode: span, focusOffset: 1,
    });

    await renderClient(
      <ClozeEditor
        quote={quote}
        onChange={onChange}
        onUpdate={vi.fn()}
        locale="en"
        quoteTextRef={{ current: span }}
      />,
    );
    await click(getButton(messages.en['cloze.addBlank']));

    expect(onChange).toHaveBeenCalledOnce();
    const result: Cloze[] = onChange.mock.calls[0][0];
    expect(result[0]).toMatchObject({ start: 0, end: quote.text.length });

    getSelection.mockRestore();
    span.remove();
  });

  it('ignores a selection whose endpoints leave this card’s quote span', async () => {
    // Simulates a selection spanning into a sibling quote card: the focus node
    // is not inside the span this editor was given.
    const quote = makeQuote({ text: '学而时习之', clozes: [] });
    const onChange = vi.fn();
    const { span, textNode } = buildQuoteSpan(quote.text);
    const otherSpan = document.createElement('span');
    otherSpan.setAttribute('data-quote-text', '');
    const otherText = document.createTextNode('别的句子');
    otherSpan.append(otherText);
    document.body.append(otherSpan);

    const getSelection = stubSelection({
      anchorNode: textNode, anchorOffset: 0,
      focusNode: otherText, focusOffset: 2,
    });

    await renderClient(
      <ClozeEditor
        quote={quote}
        onChange={onChange}
        onUpdate={vi.fn()}
        locale="en"
        quoteTextRef={{ current: span }}
      />,
    );
    await click(getButton(messages.en['cloze.addBlank']));

    expect(onChange).not.toHaveBeenCalled();

    getSelection.mockRestore();
    span.remove();
    otherSpan.remove();
  });
});

describe('ClozeEditor — manual span validation (via clozeFromRange)', () => {
  // The drag-select path in the component calls clozeFromRange. We test the
  // pure function directly in cloze.test.ts. Here we verify that the component
  // exposes an "Add blank" button and rejects bad spans.
  it('renders the add-blank button for manual selection', async () => {
    const quote = makeQuote({ clozes: [] });

    await renderClient(
      <ClozeEditor
        quote={quote}
        onChange={vi.fn()}
        onUpdate={vi.fn()}
        locale="en"
      />,
    );

    // The add-blank button should always be present
    expect(queryButton(messages.en['cloze.addBlank'])).not.toBeNull();
  });
});

describe('ClozeEditor — manual brace-markup editor', () => {
  it('manual apply commits parsed clozes from brace markup', async () => {
    const quote = makeQuote({ text: '满足人们的刚需', clozes: [] });
    const onChange = vi.fn();
    const onUpdate = vi.fn();

    await renderClient(
      <ClozeEditor
        quote={quote}
        onChange={onChange}
        onUpdate={onUpdate}
        locale="zh-CN"
      />,
    );

    // Open the manual editor
    await click(getButton('手动填空'));
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await setTextareaValue(textarea, '满足人们的{刚需}');
    await click(getButton('应用'));

    // text unchanged -> onChange(clozes) called, onUpdate not called
    expect(onChange).toHaveBeenCalledTimes(1);
    const committed = onChange.mock.calls[0][0];
    expect(committed).toHaveLength(1);
    expect(quote.text.slice(committed[0].start, committed[0].end)).toBe('刚需');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('manual apply persists edited text via onUpdate when the sentence changes', async () => {
    const quote = makeQuote({ text: '满足人们的刚需', clozes: [] });
    const onChange = vi.fn();
    const onUpdate = vi.fn();

    await renderClient(
      <ClozeEditor
        quote={quote}
        onChange={onChange}
        onUpdate={onUpdate}
        locale="zh-CN"
      />,
    );

    await click(getButton('手动填空'));
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await setTextareaValue(textarea, '满足大众的{刚需}');
    await click(getButton('应用'));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const patch = onUpdate.mock.calls[0][0];
    expect(patch.text).toBe('满足大众的刚需');
    expect(patch.clozes).toHaveLength(1);
  });

  it('manual apply shows an inline error on malformed markup and does not mutate', async () => {
    const quote = makeQuote({ text: '满足人们的刚需', clozes: [] });
    const onChange = vi.fn();
    const onUpdate = vi.fn();

    await renderClient(
      <ClozeEditor
        quote={quote}
        onChange={onChange}
        onUpdate={onUpdate}
        locale="zh-CN"
      />,
    );

    await click(getButton('手动填空'));
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await setTextareaValue(textarea, '满足{刚需');
    await click(getButton('应用'));

    expect(onChange).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('无法识别填空');
  });
});

// ---------------------------------------------------------------------------
// AI candidate panel
// ---------------------------------------------------------------------------

const DISABLED_SETTINGS = {
  enabled: false as const,
  provider: 'deepseek' as const,
  baseUrl: '',
  apiKey: '',
  model: '',
};
const ENABLED_SETTINGS = {
  enabled: true as const,
  provider: 'deepseek' as const,
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk',
  model: 'deepseek-chat',
};

describe('ClozeEditor — AI suggest button and candidate panel', () => {
  it('disables the AI suggest button when AI is unconfigured', async () => {
    vi.mocked(getAiSettings).mockResolvedValue({ ...DISABLED_SETTINGS });
    const quote = makeQuote({ text: '满足人们的刚需', clozes: [] });
    await renderClient(
      <ClozeEditor quote={quote} onChange={vi.fn()} onUpdate={vi.fn()} locale="zh-CN" />,
    );
    await flush();

    const btn = getButton('建议填空');
    expect(btn.disabled).toBe(true);
    expect(container.textContent).toContain('请在设置中配置 AI');
  });

  it('accepting an AI candidate adds a cloze', async () => {
    vi.mocked(getAiSettings).mockResolvedValue({ ...ENABLED_SETTINGS });
    vi.mocked(fetchClozeSuggestions).mockResolvedValue({
      ok: true,
      suggestions: [{ answer: '刚需', reason: 'key vocabulary' }],
    });
    const onChange = vi.fn();
    const quote = makeQuote({ text: '满足人们的刚需', clozes: [] });
    await renderClient(
      <ClozeEditor quote={quote} onChange={onChange} onUpdate={vi.fn()} locale="zh-CN" />,
    );
    await flush();

    // Click the enabled AI suggest button
    await click(getButton('建议填空'));

    // Accept the candidate chip
    await click(getButton('接受'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const added: Cloze[] = onChange.mock.calls[0][0];
    expect(added).toHaveLength(1);
    expect(quote.text.slice(added[0].start, added[0].end)).toBe('刚需');
  });

  it('shows the empty state when AI returns no usable spans', async () => {
    vi.mocked(getAiSettings).mockResolvedValue({ ...ENABLED_SETTINGS });
    // '股票' does not appear in '满足人们的刚需' so no candidates will be produced
    vi.mocked(fetchClozeSuggestions).mockResolvedValue({
      ok: true,
      suggestions: [{ answer: '股票' }],
    });
    const quote = makeQuote({ text: '满足人们的刚需', clozes: [] });
    await renderClient(
      <ClozeEditor quote={quote} onChange={vi.fn()} onUpdate={vi.fn()} locale="zh-CN" />,
    );
    await flush();

    await click(getButton('建议填空'));

    expect(container.textContent).toContain('没有可用的填空建议');
  });
});
