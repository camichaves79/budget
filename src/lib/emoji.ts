/**
 * Emoji helpers (2026-09, category-emoji-field).
 *
 * Category emojis render inside small circles everywhere (rows, transaction
 * lists, selects), so the category form keeps them to ONE grapheme cluster.
 * A cluster means "one visible glyph": 👍 and 👨‍👩‍👧 (ZWJ family) both count
 * as one; "🏠🔥" counts as two and is trimmed to 🏠.
 */

/** The first grapheme cluster of `s`, or '' when empty (never throws). */
export function firstGrapheme(s: string): string {
  if (!s) return '';
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const first = segmenter.segment(s)[Symbol.iterator]().next();
    return first.done ? '' : first.value.segment;
  } catch {
    // Very old engines without Intl.Segmenter: fall back to the first
    // code point (splits ZWJ sequences, but keeps the field usable).
    return Array.from(s)[0] ?? '';
  }
}
