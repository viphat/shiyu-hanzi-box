// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { resolveSelectionOffsets, type SelectionLike } from '../lib/cloze-selection';

// Build a [data-quote-text] span from one or more text chunks (chunks let us
// simulate a render that splits the quote into multiple text nodes).
function makeSpan(...textChunks: string[]): { span: HTMLElement; texts: Text[] } {
  const span = document.createElement('span');
  span.setAttribute('data-quote-text', '');
  const texts = textChunks.map((chunk) => {
    const node = document.createTextNode(chunk);
    span.append(node);
    return node;
  });
  document.body.append(span);
  return { span, texts };
}

function sel(overrides: Partial<SelectionLike>): SelectionLike {
  return {
    anchorNode: null,
    focusNode: null,
    anchorOffset: 0,
    focusOffset: 0,
    isCollapsed: false,
    ...overrides,
  };
}

describe('resolveSelectionOffsets', () => {
  it('maps a forward selection within a single text node', () => {
    const { span, texts } = makeSpan('学而时习之');
    const result = resolveSelectionOffsets(
      sel({ anchorNode: texts[0], anchorOffset: 0, focusNode: texts[0], focusOffset: 2 }),
      span,
    );
    expect(result).toEqual({ start: 0, end: 2 });
  });

  it('normalises a backward selection (focus before anchor)', () => {
    const { span, texts } = makeSpan('学而时习之');
    const result = resolveSelectionOffsets(
      sel({ anchorNode: texts[0], anchorOffset: 4, focusNode: texts[0], focusOffset: 1 }),
      span,
    );
    expect(result).toEqual({ start: 1, end: 4 });
  });

  it('returns null for a collapsed selection', () => {
    const { span, texts } = makeSpan('学而时习之');
    const result = resolveSelectionOffsets(
      sel({
        anchorNode: texts[0], anchorOffset: 2,
        focusNode: texts[0], focusOffset: 2,
        isCollapsed: true,
      }),
      span,
    );
    expect(result).toBeNull();
  });

  it('maps element-node offsets (child indices) to char offsets on select-all', () => {
    // Triple-click / select-all yields anchorNode === focusNode === the span
    // itself, with offsets that are CHILD indices, not character offsets.
    // Previously this produced a bogus {0,1}; it must cover the whole text.
    const { span } = makeSpan('学而时习之');
    const result = resolveSelectionOffsets(
      sel({ anchorNode: span, anchorOffset: 0, focusNode: span, focusOffset: 1 }),
      span,
    );
    expect(result).toEqual({ start: 0, end: 5 });
  });

  it('returns null when an endpoint lies outside the quote span', () => {
    // Simulates a selection that begins in this card's quote and ends in a
    // sibling card's quote (or anywhere else in the document).
    const { span, texts } = makeSpan('学而时习之');
    const outside = document.createTextNode('别的文字');
    document.body.append(outside);
    const result = resolveSelectionOffsets(
      sel({ anchorNode: texts[0], anchorOffset: 0, focusNode: outside, focusOffset: 2 }),
      span,
    );
    expect(result).toBeNull();
  });

  it('accumulates across multiple text nodes (robust to a split render)', () => {
    const { span, texts } = makeSpan('学而', '时习之');
    const result = resolveSelectionOffsets(
      sel({ anchorNode: texts[0], anchorOffset: 1, focusNode: texts[1], focusOffset: 1 }),
      span,
    );
    expect(result).toEqual({ start: 1, end: 3 });
  });
});
