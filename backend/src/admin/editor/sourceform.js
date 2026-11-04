// The bibliography form: "Cited as …" above it (which fields a kind of source uses, and what it still needs, is the
// relevance engine's job — editor/relevance.js with the rules of src/admin/relevance.js).
export function initSourceForm() {
  if (document.body.dataset.pageType !== 'source') return;
  const kind = document.querySelector('form.form select[name="f.kind"]');
  if (!kind) return;
  initCitedAs(kind.form);
  initAccessedToday(kind.form);
}

// A link typed (or pasted) while "last accessed" is empty: today — the day you read it is nearly always the day you
// enter it (owner 2026-11-04). Shown and changeable like any value; nothing is set over an existing date.
function initAccessedToday(form) {
  const url = form.querySelector('[name="f.url"]');
  const day = form.querySelector('[name="f.accessed"]');
  if (!url || !day) return;
  url.addEventListener('change', () => {
    if (!/^https?:\/\/\S+/i.test(url.value.trim()) || day.value.trim()) return;
    const d = new Date();
    day.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    day.dispatchEvent(new Event('input', { bubbles: true }));
    day.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// "Cited as …" above the form: the short reference and full entry as the site will show them, and a warning for names
// without a comma — built on the server (POST /bibliography/new/citation, src/bibliography.js); nothing saved.
function initCitedAs(form) {
  const box = document.createElement('p');
  box.className = 'citation cited-as';
  box.setAttribute('aria-live', 'polite');
  form.prepend(box);
  let timer = null;
  let seq = 0;
  const show = async () => {
    const mine = ++seq;
    try {
      const res = await fetch('/bibliography/new/citation', { method: 'POST', body: new URLSearchParams(new FormData(form)),
        credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (res.ok && mine === seq) box.innerHTML = await res.text();  // escaped by the server
    } catch { /* offline: no preview */ }
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(show, 400); };
  form.addEventListener('input', later);
  form.addEventListener('change', later);
  show();
}
