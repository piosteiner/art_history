// Endless lists: the pager after a table (core.js pager(), .pager[data-infinite]) loads the next page by itself when
// it comes near the screen — the rows of the next page's table are appended to this one, and its pager replaces
// this one (with the link after that, or none at the end). The links stay in the page: a reload, a shared link or
// a browser without scripts still pages. A list swapped by the live search (livesearch.js) brings a new pager; a
// MutationObserver picks it up.
const seen = new WeakSet();

const rowsBefore = (pager) => {
  const prev = pager.previousElementSibling;
  return prev && (prev.matches('tbody') ? prev : prev.querySelector('tbody'));
};

async function loadNext(pager, observer) {
  const next = pager.querySelector('a[rel=next]');
  const tbody = rowsBefore(pager);
  if (!next || !tbody || pager.dataset.loading) return;
  pager.dataset.loading = '1';
  next.textContent = 'loading …';
  try {
    const res = await fetch(next.href, { headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error(String(res.status));
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const fresh = doc.querySelector('.pager[data-infinite]');
    const rows = fresh && rowsBefore(fresh);
    if (!fresh || !rows) throw new Error('no list');
    tbody.append(...[...rows.children].map((r) => document.importNode(r, true)));
    const replacement = document.importNode(fresh, true);
    replacement.querySelector('a[rel=prev]')?.remove();   // the page above is already here
    observer.unobserve(pager);
    pager.replaceWith(replacement);
    watch(replacement, observer);
  } catch {
    delete pager.dataset.loading;
    next.textContent = 'more →';   // a click still works
  }
}

function watch(pager, observer) {
  if (seen.has(pager) || !pager.querySelector('a[rel=next]')) return;
  seen.add(pager);
  observer.observe(pager);
}

export function initInfinite() {
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) loadNext(e.target, observer);
  }, { rootMargin: '800px 0px' });   // start well before the end: the scroll doesn't stop
  const scan = () => document.querySelectorAll('.pager[data-infinite]').forEach((p) => watch(p, observer));
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
}
