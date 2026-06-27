// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagCloud } from '../entrypoints/dashboard/components/TagCloud';
import { formatMessage } from '../lib/i18n';
import type { QuoteEntry } from '../lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const q = (id: string, tags: string[]) =>
  ({
    id,
    kind: 'quote',
    text: id,
    note: '',
    status: 'inbox',
    tags,
    createdAt: 1,
    updatedAt: 1,
    sourceTitle: '',
    sourceUrl: '',
    sourceDomain: '',
    surrounding: '',
  }) as QuoteEntry;

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
  vi.restoreAllMocks();
});

async function renderClient(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function queryByAriaLabel(label: string): Element | null {
  return container.querySelector(`[aria-label="${label}"]`);
}

function queryByText(text: string): Element | null {
  return (
    [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TagCloud', () => {
  it('renders each tag once, sized by frequency', async () => {
    await renderClient(
      <TagCloud
        quotes={[q('1', ['a', 'b']), q('2', ['a'])]}
        selectedTags={new Set()}
        onSelect={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        locale="en"
      />,
    );

    const a = queryByText('a') as HTMLElement;
    const b = queryByText('b') as HTMLElement;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    const aSize = parseFloat(a.style.fontSize);
    const bSize = parseFloat(b.style.fontSize);
    expect(aSize).toBeGreaterThan(bSize); // a appears twice, b once
  });

  it('calls onSelect when a tag is clicked', async () => {
    const onSelect = vi.fn();
    await renderClient(
      <TagCloud
        quotes={[q('1', ['a'])]}
        selectedTags={new Set()}
        onSelect={onSelect}
        onRename={() => {}}
        onDelete={() => {}}
        locale="en"
      />,
    );

    const tagBtn = queryByText('a')!;
    expect(tagBtn).not.toBeNull();
    await click(tagBtn);
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('calls onDelete after confirm', async () => {
    const onDelete = vi.fn();
    // happy-dom may not define window.confirm — ensure it exists before spying
    if (!window.confirm) window.confirm = () => false;
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await renderClient(
      <TagCloud
        quotes={[q('1', ['a'])]}
        selectedTags={new Set()}
        onSelect={() => {}}
        onRename={() => {}}
        onDelete={onDelete}
        locale="en"
      />,
    );

    const deleteLabel = formatMessage('en', 'cloud.delete', { tag: 'a' });
    const deleteBtn = queryByAriaLabel(deleteLabel)!;
    expect(deleteBtn).not.toBeNull();
    await click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith('a');
  });

  it('calls onRename with the prompt value', async () => {
    const onRename = vi.fn();
    // happy-dom may not define window.prompt — ensure it exists before spying
    if (!window.prompt) window.prompt = () => null;
    vi.spyOn(window, 'prompt').mockReturnValue('b');

    await renderClient(
      <TagCloud
        quotes={[q('1', ['a'])]}
        selectedTags={new Set()}
        onSelect={() => {}}
        onRename={onRename}
        onDelete={() => {}}
        locale="en"
      />,
    );

    const renameLabel = formatMessage('en', 'cloud.rename', { tag: 'a' });
    const renameBtn = queryByAriaLabel(renameLabel)!;
    expect(renameBtn).not.toBeNull();
    await click(renameBtn);
    expect(onRename).toHaveBeenCalledWith('a', 'b');
  });

  it('shows empty state when there are no tags', async () => {
    await renderClient(
      <TagCloud
        quotes={[q('1', [])]}
        selectedTags={new Set()}
        onSelect={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        locale="en"
      />,
    );

    expect(container.textContent).toContain('No tags yet.');
  });
});
