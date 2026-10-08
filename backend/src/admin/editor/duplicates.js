// The live duplicate box on a new-entry form (src/admin/duplicates.js): as you type, the form is sent to
// …/new/duplicates — compared on the server like on Create, and nothing saved — and the box shows what may already
// exist. Debounced; an answer that arrives after a newer request was started is dropped.
export function initDuplicates() {
  const box = document.querySelector('.dup-live[data-dup-url]');
  const form = box && box.closest('form');
  if (!form) return;
  let timer = null;
  let seq = 0;
  let last = '';
  const check = async () => {
    const body = new URLSearchParams(new FormData(form));
    body.delete('slug');  // the slug changes with the name — no reason to ask again
    const key = body.toString();
    if (key === last) return;
    last = key;
    const mine = ++seq;
    try {
      const res = await fetch(box.dataset.dupUrl, { method: 'POST', body, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (res.ok && mine === seq) box.innerHTML = await res.text();  // HTML built (and escaped) by the server
    } catch { /* offline: no box — Create still checks */ }
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(check, 600); };
  form.addEventListener('input', later);
  form.addEventListener('change', later);
  // a form that arrives filled in (from Wikidata, a draft, the place finder): check right away
  if ([...form.querySelectorAll('input[id^="f-"]')].some((i) => i.value && i.id !== 'f-slug')) check();
}
