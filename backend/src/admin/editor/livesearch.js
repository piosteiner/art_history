// Live search for the admin's search bars.
//
// form[data-live]           results follow the typing: after a short pause the page is fetched again in the background
//                           and only its [data-live-results="…"] regions are swapped — the field keeps focus and caret,
//                           the address bar follows (reload and back still work). A newer search cancels an older one.
//                           data-live-delay (ms, default 250), data-live-min (characters, default 0).
// form[data-live="change"]  only selects and checkboxes apply at once; typed text waits for Enter (searches that ask
//                           outside services several times per search — the image search).
// The header's "Search everything": a dropdown with the best matches of every type (/lookup); Enter = the full page.
const FOLDER = { artist: 'artists', artwork: 'artworks', institution: 'institutions', person: 'people', movement: 'movements',
  place: 'places', polity: 'polities', term: 'glossary', source: 'bibliography', event: 'events' };

function liveForm(form) {
  const typing = form.dataset.live !== 'change';
  const delay = Number(form.dataset.liveDelay || 250);
  const min = Number(form.dataset.liveMin || 0);
  const status = Object.assign(document.createElement('span'), { className: 'muted small live-status-search', textContent: 'searching…', hidden: true });
  form.append(status);
  let timer = null;
  let ctrl = null;
  let last = location.pathname + location.search;

  const run = async () => {
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form)) if (typeof v === 'string' && v.trim()) params.append(k, v.trim());
    const box = form.querySelector('input[type=search]');
    if (box && box.value.trim() && box.value.trim().length < min) return;
    const url = `${form.getAttribute('action') || location.pathname}${params.toString() ? `?${params}` : ''}`;
    if (url === last) return;
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    status.hidden = false;
    status.textContent = 'searching…';
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/html' } });
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      for (const region of document.querySelectorAll('[data-live-results]')) {
        const fresh = doc.querySelector(`[data-live-results="${region.dataset.liveResults}"]`);
        if (fresh) region.replaceWith(document.importNode(fresh, true));
      }
      history.replaceState(null, '', url);
      last = url;
      status.hidden = true;
    } catch (err) {
      if (err.name !== 'AbortError') { status.textContent = 'search failed — press Enter'; return; }
    }
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(run, delay); };
  if (typing) form.addEventListener('input', (e) => { if (e.target.matches('input[type=search], input[name=q], input[name=search]')) later(); });
  form.addEventListener('change', (e) => { if (e.target.matches('select, input[type=checkbox]')) { clearTimeout(timer); run(); } });
}

function headerSearch(input) {
  const list = Object.assign(document.createElement('div'), { className: 'top-search-list', hidden: true });
  list.setAttribute('role', 'listbox');
  input.parentElement.append(list);
  input.setAttribute('autocomplete', 'off');
  let timer = null;
  let ctrl = null;
  let active = -1;
  const items = () => [...list.querySelectorAll('a')];
  const close = () => { list.hidden = true; active = -1; };
  const show = (i) => { items().forEach((a, k) => a.classList.toggle('active', k === i)); active = i; };
  const run = async () => {
    const q = input.value.trim();
    if (q.length < 2) return close();
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    try {
      const res = await fetch(`/lookup?types=${Object.keys(FOLDER).join(',')}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      const hits = (await res.json()).slice(0, 8);
      list.replaceChildren(...hits.map((h) => {
        const a = Object.assign(document.createElement('a'), { href: `/${FOLDER[h.type]}/${h.slug}` });
        a.append(Object.assign(document.createElement('span'), { textContent: h.name }),
          Object.assign(document.createElement('span'), { className: 'tag', textContent: h.type === 'term' ? 'glossary' : h.type === 'source' ? 'source' : h.type }));
        return a;
      }));
      const all = Object.assign(document.createElement('a'), { href: `/search?q=${encodeURIComponent(q)}`, className: 'all', textContent: `All results for “${q}” →` });
      list.append(all);
      list.hidden = false;
      active = -1;
    } catch (err) { if (err.name !== 'AbortError') close(); }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 200); });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    const n = items().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); show(Math.min(active + 1, n - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); show(Math.max(active - 1, 0)); }
    else if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); location.href = items()[active].href; }  // otherwise: the full search page
  });
  input.addEventListener('blur', () => setTimeout(close, 150));  // let a click on a result land first
}

export function initLiveSearch() {
  document.querySelectorAll('form[data-live]').forEach(liveForm);
  const top = document.querySelector('.top-search input[type=search]');
  if (top) headerSearch(top);
}
