// The bibliography form: "Cited as …" above it (which fields a kind of source uses, and what it still needs, is the
// relevance engine's job — editor/relevance.js with the rules of src/admin/relevance.js).
export function initSourceForm() {
  if (document.body.dataset.pageType !== 'source') return;
  const kind = document.querySelector('form.form select[name="f.kind"]');
  if (!kind) return;
  initCitedAs(kind.form);
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
