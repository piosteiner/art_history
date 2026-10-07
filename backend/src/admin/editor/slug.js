// Slug field (src/admin/forms.js): typed text becomes slug-shaped as you type — lowercase, spaces → hyphens, accents
// dropped (Dürer → durer), anything else removed. On a new entry the slug follows the name/title until you edit the
// slug yourself (clearing it hands it back to the title). Same rules as the server's slugify (src/admin/autocreate.js).
import { plain, splitLine } from '../../names';

const clean = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss')
  .replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-/, '');
// while typing a trailing hyphen stays (you are about to type the next word); a finished slug has none
const slugify = (s) => clean(s).replace(/-$/, '').slice(0, 80);

export function initSlug() {
  // by id: banners above the form ("unsaved changes — Discard") carry hidden inputs named slug too
  const slug = document.getElementById('f-slug');
  if (!slug) return;
  const set = (value) => {
    if (slug.value === value) return;
    slug.value = value;
    slug.dispatchEvent(new Event('input', { bubbles: true }));  // drafts / the shared working copy see the change
  };

  // Capture phase: runs before the draft and live-collaboration listeners, so they only ever see the cleaned value.
  slug.addEventListener('input', (e) => {
    if (!e.isTrusted) return;
    const before = slug.value;
    const caret = slug.selectionStart ?? before.length;
    const value = clean(before).slice(0, 80);
    if (value !== before) {
      slug.value = value;
      const at = clean(before.slice(0, caret)).length;
      slug.setSelectionRange(at, at);
    }
  }, { capture: true });
  slug.addEventListener('change', () => set(slugify(slug.value)));

  const from = slug.dataset.slugFrom && document.getElementById(slug.dataset.slugFrom);
  if (!from) return;
  // A title without Latin letters (神奈川沖浪裏) gives no slug: then the first romanization, else the first
  // translation from the other names ("Kanagawa-oki nami ura | ja-Latn | romanization").
  const others = document.getElementById('f-names');
  const source = () => {
    const own = slugify(plain(from.value));
    if (own || !others) return own;
    const list = others.value.split('\n').map((l) => splitLine(l.trim())).filter((p) => p[0]);
    const pick = list.find((p) => (p[2] || '').toLowerCase() === 'romanization') || list.find((p) => (p[2] || '').toLowerCase() === 'translation');
    return pick ? slugify(plain(pick[0])) : '';
  };
  // Following the title until the slug is typed by hand (a prefilled slug that matches the title still follows).
  // An existing entry's slug is part of its public address: it follows only once the field has been emptied by hand
  // (the old address then redirects, migration 041).
  // An empty slug (also one already emptied in the shared working copy) can't be saved anyway — it follows.
  let follow = slug.dataset.slugExisting ? !slug.value : !slug.value || slug.value === source();
  slug.addEventListener('input', (e) => { if (e.isTrusted) follow = slug.value === ''; });
  // checked when the title changes, not only on load: the shared working copy may fill in an emptied slug later
  for (const x of [from, others].filter(Boolean)) {
    x.addEventListener('input', () => { if (follow || !slug.value) { follow = true; set(source()); } });
  }
}
