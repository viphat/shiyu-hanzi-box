// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClozeEditor } from '../entrypoints/dashboard/components/ClozeEditor';
import { messages } from '../lib/i18n';
import type { Cloze, QuoteEntry, WordEntry } from '../lib/types';

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

function makeWord(text: string, id?: string): WordEntry {
  return {
    id: id ?? `w-${text}`,
    kind: 'word',
    text,
    normalized: text,
    note: '',
    status: 'inbox',
    createdAt: 0,
    updatedAt: 0,
    occurrences: [],
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
        savedWords={[]}
        onChange={vi.fn()}
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
        savedWords={[]}
        onChange={vi.fn()}
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
        savedWords={[]}
        onChange={onChange}
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
        savedWords={[]}
        onChange={onChange}
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
        savedWords={[]}
        onChange={onChange}
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

describe('ClozeEditor — suggest blanks', () => {
  it('shows the suggest button', async () => {
    const quote = makeQuote({ clozes: [] });

    await renderClient(
      <ClozeEditor
        quote={quote}
        savedWords={[makeWord('学而')]}
        onChange={vi.fn()}
        locale="en"
      />,
    );

    expect(queryButton(messages.en['cloze.suggestBlanks'])).not.toBeNull();
  });

  it('clicking suggest shows suggestions not already present', async () => {
    const quote = makeQuote({ clozes: [] });
    const savedWords = [makeWord('学而', 'w-xueer')];

    await renderClient(
      <ClozeEditor
        quote={quote}
        savedWords={savedWords}
        onChange={vi.fn()}
        locale="en"
      />,
    );

    await click(getButton(messages.en['cloze.suggestBlanks']));

    // Should show suggestion text and an accept button
    expect(container.textContent).toContain('学而');
    expect(queryButton(messages.en['cloze.accept'])).not.toBeNull();
  });

  it('filters out suggestions already in clozes', async () => {
    // '学而' is already a cloze (0-2)
    const existing = makeCloze({ id: 'c1', start: 0, end: 2 });
    const quote = makeQuote({ clozes: [existing] });
    const savedWords = [makeWord('学而', 'w-xueer')];

    await renderClient(
      <ClozeEditor
        quote={quote}
        savedWords={savedWords}
        onChange={vi.fn()}
        locale="en"
      />,
    );

    await click(getButton(messages.en['cloze.suggestBlanks']));

    // No new suggestion accept button should appear (already present)
    expect(queryButton(messages.en['cloze.accept'])).toBeNull();
  });

  it('accepting a suggestion calls onChange with appended cloze containing wordId', async () => {
    const quote = makeQuote({ clozes: [] });
    const savedWords = [makeWord('学而', 'w-xueer')];
    const onChange = vi.fn();

    await renderClient(
      <ClozeEditor
        quote={quote}
        savedWords={savedWords}
        onChange={onChange}
        locale="en"
      />,
    );

    await click(getButton(messages.en['cloze.suggestBlanks']));
    await click(getButton(messages.en['cloze.accept']));

    expect(onChange).toHaveBeenCalledOnce();
    const result: Cloze[] = onChange.mock.calls[0][0];
    expect(result).toHaveLength(1);
    expect(result[0].wordId).toBe('w-xueer');
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(2);
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
        savedWords={[]}
        onChange={onChange}
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
        savedWords={[]}
        onChange={onChange}
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
        savedWords={[]}
        onChange={onChange}
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
        savedWords={[]}
        onChange={vi.fn()}
        locale="en"
      />,
    );

    // The add-blank button should always be present
    expect(queryButton(messages.en['cloze.addBlank'])).not.toBeNull();
  });
});
