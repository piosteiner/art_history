// Materials (artworks): the list stays free to type (one per line), and terms can be added with a click —
//   "from the medium": terms found in the medium text ("Ink and colour on paper" → ink · paper), re-checked as it changes
//   "used before":     terms already used on other works, so the same word is reused (the API filters by exact terms)
// textarea[data-suggest-from] names the medium input; data-used holds the terms in use (src/admin/forms.js).

// Common materials, and words in a medium that mean one of them. Terms in use are matched too.
const KNOWN = ['ink', 'paper', 'silk', 'canvas', 'oil paint', 'tempera', 'watercolour', 'gouache', 'pigment', 'gold leaf',
  'silver leaf', 'gold', 'silver', 'bronze', 'copper', 'iron', 'brass', 'wood', 'lacquer', 'mother-of-pearl', 'ivory',
  'marble', 'limestone', 'sandstone', 'granite', 'stone', 'clay', 'terracotta', 'porcelain', 'stoneware', 'earthenware',
  'glass', 'plaster', 'wax', 'charcoal', 'graphite', 'chalk', 'pastel', 'parchment', 'vellum', 'linen', 'cotton', 'bamboo', 'jade'];
const SYNONYMS = { oil: 'oil paint', oils: 'oil paint', 'oil-on': 'oil paint', watercolor: 'watercolour', colour: null, color: null,
  gilt: 'gold leaf', gilded: 'gold leaf', 'gold-leaf': 'gold leaf', terra: null, cotta: null, washi: 'paper' };

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s) => fold(s).split(/[^a-z-]+/).filter(Boolean);

function fromMedium(medium, vocabulary) {
  const text = ` ${words(medium).join(' ')} `;
  const found = new Map();  // term → where it appears in the medium (for the order)
  const add = (t, at) => { if (t && at >= 0 && !found.has(t)) found.set(t, at); };
  // multi-word terms first (oil paint, gold leaf), then single words with simple plurals
  for (const term of [...vocabulary].sort((a, b) => b.length - a.length)) {
    const w = words(term).join(' ');
    if (!w) continue;
    const at = text.indexOf(` ${w} `);
    add(term, at >= 0 ? at : text.indexOf(` ${w}s `));
  }
  for (const w of words(medium)) if (SYNONYMS[w]) add(SYNONYMS[w], text.indexOf(` ${w} `));
  return [...found].sort((a, b) => a[1] - b[1]).map(([t]) => t);  // in the order of the medium
}

function chip(term, onAdd, extraClass = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `chip ${extraClass}`.trim();
  b.textContent = `+ ${term}`;
  b.title = `Add “${term}”`;
  b.addEventListener('click', () => onAdd(term));
  return b;
}

export function initMaterials() {
  document.querySelectorAll('textarea[data-suggest-from]').forEach((ta) => {
    const medium = document.getElementById(ta.dataset.suggestFrom);
    let used = [];
    try { used = JSON.parse(ta.dataset.used || '[]'); } catch { used = []; }
    const box = Object.assign(document.createElement('div'), { className: 'material-suggestions' });
    const fieldBox = ta.closest('.field');
    const usedHint = fieldBox.querySelector('.used-terms');
    if (usedHint) usedHint.hidden = true;  // replaced by the clickable list
    (usedHint || ta).after(box);

    const current = () => ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
    const add = (term) => {
      const list = current();
      if (list.some((t) => fold(t) === fold(term))) return;
      ta.value = [...list, term].join('\n');
      ta.dispatchEvent(new Event('input', { bubbles: true }));  // drafts / the shared working copy
      render();
    };
    const render = () => {
      const have = new Set(current().map(fold));
      const suggested = medium ? fromMedium(medium.value, [...new Set([...KNOWN, ...used])]).filter((t) => !have.has(fold(t))) : [];
      const others = used.filter((t) => !have.has(fold(t)) && !suggested.includes(t));
      box.replaceChildren();
      if (suggested.length) {
        const row = Object.assign(document.createElement('div'), { className: 'chips' });
        row.append(Object.assign(document.createElement('span'), { className: 'muted small', textContent: 'From the medium:' }),
          ...suggested.map((t) => chip(t, add, 'suggested')));
        box.append(row);
      }
      if (others.length) {
        const row = Object.assign(document.createElement('div'), { className: 'chips' });
        row.append(Object.assign(document.createElement('span'), { className: 'muted small', textContent: 'Used before:' }),
          ...others.map((t) => chip(t, add)));
        box.append(row);
      }
    };
    for (const el of [medium, ta].filter(Boolean)) { el.addEventListener('input', render); el.addEventListener('change', render); }
    render();
  });
}
