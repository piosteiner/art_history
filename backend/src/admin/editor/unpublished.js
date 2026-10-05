// Marks what the shared working copy changes compared with the published entry (form[data-published], set by the
// edit page): the field gets an outline and an "unpublished" tag, and a small line shows the published value.
// Checked on every edit (also those arriving from other editors and in the Markdown editors), and the published
// values are fetched again when someone publishes or a revert changes the entry.
const norm = (v) => String(v ?? '').replace(/\r\n/g, '\n').trim();
const short = (v) => {
  const s = norm(v).replace(/\n+/g, ' / ');
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
};
const decode = (b64) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));

export function initUnpublished(form, live) {
  if (!form.dataset.published) return;
  let published = decode(form.dataset.published);
  const summary = Object.assign(document.createElement('p'), { className: 'unpublished-summary', hidden: true });
  form.prepend(summary);

  const check = () => {
    const byField = new Map();  // .field → [published values of its changed inputs]
    for (const el of form.elements) {
      if (!el.name || !(el.name in published) || el.type === 'hidden' && el.name === 'version') continue;
      if (norm(el.value) === norm(published[el.name])) continue;
      const field = el.closest('.field');
      if (!field) continue;
      if (!byField.has(field)) byField.set(field, []);
      byField.get(field).push(published[el.name]);
    }
    for (const field of form.querySelectorAll('.field')) {
      const changed = byField.has(field);
      field.classList.toggle('unpublished', changed);
      let line = field.querySelector(':scope > .published-value');
      if (!changed) { if (line) line.remove(); continue; }
      if (!line) {
        line = Object.assign(document.createElement('div'), { className: 'published-value hint' });
        field.append(line);
      }
      const values = byField.get(field).map(short).filter(Boolean);
      line.textContent = values.length ? `Published: ${values.join(' · ')}` : 'Published: (empty) — new here';
    }
    summary.hidden = !byField.size;
    summary.textContent = `${byField.size} field${byField.size === 1 ? '' : 's'} with unpublished changes — marked below. Publish makes them public.`;
  };

  let timer = null;
  const soon = () => { clearTimeout(timer); timer = setTimeout(check, 60); };
  for (const type of ['input', 'change', 'md-change']) form.addEventListener(type, soon);
  setInterval(check, 2000);  // anything that changed a field without an event
  const refetch = async () => {
    try {
      const res = await fetch(form.dataset.publishedUrl, { headers: { Accept: 'application/json' } });
      if (res.ok) { published = await res.json(); check(); }
    } catch { /* offline: keep the old values */ }
  };
  if (live) for (const type of ['doc-published', 'doc-rebased']) live.on(type, refetch);
  check();
}
