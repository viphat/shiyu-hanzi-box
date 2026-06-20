export interface PageContext {
  text: string;
  surrounding: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
}

/**
 * Runs in the PAGE context via scripting.executeScript({ func }).
 * Must not reference outer scope.
 */
export function readPageContext(): PageContext | null {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text) return null;

  // Surrounding sentence: expand to nearest sentence boundary from selection anchor.
  let surrounding = '';
  if (sel && sel.anchorNode && sel.anchorNode.parentElement) {
    const el = sel.anchorNode.parentElement;
    const full = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const anchorOffset = sel.anchorOffset;
    // crude: take ±80 chars around anchor
    const start = Math.max(0, anchorOffset - 80);
    const end = Math.min(full.length, anchorOffset + text.length + 80);
    surrounding = full.slice(start, end).trim();
  }

  let domain = '';
  try {
    domain = location.hostname;
  } catch {
    domain = '';
  }

  return {
    text,
    surrounding,
    sourceTitle: document.title || domain || '',
    sourceUrl: location.href,
    sourceDomain: domain,
  };
}
