// ---------------------------------------------------------------------------
// Pure geometry for mapping a DOM text selection back to character offsets into
// the quote string. Extracted from ClozeEditor so the mapping is testable
// without driving the live Selection API (which happy-dom can't reliably do).
// ---------------------------------------------------------------------------

/** The parts of a DOM Selection we depend on (a real Selection satisfies it). */
export interface SelectionLike {
  anchorNode: Node | null;
  focusNode: Node | null;
  anchorOffset: number;
  focusOffset: number;
  isCollapsed: boolean;
}

/**
 * Character offset, within quoteSpan's text content, of a DOM point
 * (node, offset). Returns null when the point lies outside quoteSpan.
 *
 * The Selection API produces two kinds of points:
 *   - a Text node, where `offset` is a character index into that node;
 *   - an Element (including quoteSpan itself, e.g. on select-all / triple-click),
 *     where `offset` is a *child index* — we sum the text length of the children
 *     before it rather than treating it as a character index.
 * Because it accumulates text in document order, it stays correct even if the
 * quote is ever rendered as multiple text nodes instead of a single one.
 */
function pointToCharOffset(quoteSpan: Node, node: Node, offset: number): number | null {
  let count = 0;

  function walk(current: Node): boolean {
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE) {
        count += offset; // character index into this text node
      } else {
        // Element/other: offset is a child index — count children before it.
        const children = current.childNodes;
        for (let i = 0; i < offset && i < children.length; i++) {
          count += children[i].textContent?.length ?? 0;
        }
      }
      return true; // reached the point — stop accumulating
    }
    if (current.nodeType === Node.TEXT_NODE) {
      count += current.textContent?.length ?? 0;
      return false;
    }
    const children = current.childNodes;
    for (let i = 0; i < children.length; i++) {
      if (walk(children[i])) return true;
    }
    return false;
  }

  return walk(quoteSpan) ? count : null;
}

/**
 * Resolve a selection to a {start, end} character range within quoteSpan, or
 * null when the selection is collapsed, missing an endpoint, or has either
 * endpoint outside quoteSpan (e.g. a selection spanning two quote cards).
 * Direction-agnostic: start <= end. An empty resolved range yields null.
 */
export function resolveSelectionOffsets(
  selection: SelectionLike,
  quoteSpan: Node,
): { start: number; end: number } | null {
  if (selection.isCollapsed) return null;
  const { anchorNode, focusNode } = selection;
  if (!anchorNode || !focusNode) return null;

  const a = pointToCharOffset(quoteSpan, anchorNode, selection.anchorOffset);
  const f = pointToCharOffset(quoteSpan, focusNode, selection.focusOffset);
  if (a === null || f === null) return null;

  const start = Math.min(a, f);
  const end = Math.max(a, f);
  if (start === end) return null;
  return { start, end };
}
