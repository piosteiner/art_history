// A search hit opened from /search: the entry page marks the words the full-text search matched and scrolls to the
// first. The words come from the hit's passage (`headline_html`, its <mark>s): they are the words as written in the
// entry, so "paintings" finding "painted" marks "painted". They travel in the address as ?hl=word+word.

const WORD = /[\p{L}\p{N}]/u;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The marked words of a passage, lower-case, each once. */
export function markedWords(headlineHtml: string | null): string[] {
  if (!headlineHtml) return [];
  const doc = new DOMParser().parseFromString(headlineHtml, 'text/html');
  const words = [...doc.querySelectorAll('mark')].map((m) => (m.textContent ?? '').trim().toLowerCase()).filter(Boolean);
  return [...new Set(words)];
}

/** `?hl=` of the current address. */
export const wordsToMark = (): string[] =>
  (new URLSearchParams(location.search).get('hl') ?? '').toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Wraps each whole-word occurrence of `words` under `root` in <mark class="search-hit">; returns the marks in
 * document order. Leaves form fields, scripts and existing marks alone.
 */
export function markWords(root: Element, words: string[]): HTMLElement[] {
  if (!words.length) return [];
  // longest first, so "van gogh" wins over "van"; whole words only (letters and digits of any script)
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...words].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const texts: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('script, style, textarea, input, select, mark, .search-hit')
      || !WORD.test(n.nodeValue ?? '') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  const marks: HTMLElement[] = [];
  for (const t of texts) {
    const s = t.nodeValue!;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let at = 0;
    const parts: (string | HTMLElement)[] = [];
    while ((m = re.exec(s))) {
      if (m.index > at) parts.push(s.slice(at, m.index));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = m[0];
      parts.push(mark);
      marks.push(mark);
      at = m.index + m[0].length;
    }
    if (!parts.length) continue;
    if (at < s.length) parts.push(s.slice(at));
    t.replaceWith(...parts);
  }
  return marks;
}

/**
 * Scrolls `target` to the middle of the window, and again as images above it load and push it down — until the
 * visitor scrolls themselves.
 */
export function keepInView(target: Element, scope: ParentNode) {
  const go = () => target.scrollIntoView({ block: 'center' });
  go();
  let mine = true;
  const stop = () => { mine = false; };
  for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) window.addEventListener(ev, stop, { once: true, passive: true });
  scope.querySelectorAll('img').forEach((img) => {
    if (!img.complete) img.addEventListener('load', () => { if (mine && target.isConnected) go(); }, { once: true });
  });
  setTimeout(stop, 5000);
}
