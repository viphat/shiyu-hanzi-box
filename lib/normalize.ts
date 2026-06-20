// Character class covering ASCII + CJK punctuation/whitespace to strip at the edges.
const EDGE_PUNCT = /[\s\u3000-\u303f\uff00-\uffef!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？、；：""''（）【】《》〈〉「」『』〔〕…—·]+/;

const FULLWIDTH_OFFSET = 0xfee0;

function toHalfWidth(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code === 0x3000) return ' '; // ideographic space -> regular space
  // Convert full-width ASCII *alphanumeric* variants (U+FF10-19 digits,
  // U+FF21-5A upper, U+FF41-5A lower) to half-width. CJK full-width
  // punctuation (U+FF01-0F, U+FF1B-20, U+FF3B-40, U+FF5B-e0, …) is preserved
  // so internal CJK punctuation like ，。！？ is not mangled into ASCII.
  const half = code - FULLWIDTH_OFFSET;
  if (
    (half >= 0x30 && half <= 0x39) || // 0-9
    (half >= 0x41 && half <= 0x5a) || // A-Z
    (half >= 0x61 && half <= 0x7a)    // a-z
  ) {
    return String.fromCharCode(half);
  }
  return ch;
}

export function normalizeText(input: string): string {
  let s = input
    .split('')
    .map(toHalfWidth)
    .join('');
  s = s.replace(/\s+/g, ''); // collapse all whitespace (Chinese has no word spaces)
  s = s.toLowerCase();
  // strip leading/trailing punctuation (ASCII + CJK) until stable
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(new RegExp('^' + EDGE_PUNCT.source, 'u'), '');
    s = s.replace(new RegExp(EDGE_PUNCT.source + '$', 'u'), '');
  }
  return s;
}
