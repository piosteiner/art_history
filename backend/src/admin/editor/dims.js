// Dimensions (artworks): pasting a whole line into one of the boxes fills height × width (× depth).
//   "139.38 × 85.09"   "139,4 x 85,1 cm"   "H 50 cm"   "54 7/8 × 33 1/2 in."   "1394 × 851 mm"
//   "139.4 × 85.1 cm (54 7/8 × 33 1/2 in.)"  → the metric part is taken as it is
// Inches, millimetres and metres are converted to cm (2 decimals, like the database column), with a notice showing
// the original and a button to keep it in the dimensions note. A unit typed into a single box is converted too.
const TO_CM = { cm: 1, mm: 0.1, m: 100, in: 2.54 };
// a unit right after a number or a space — so the "m" in "diam." isn't metres
const UNIT = /(?<=[\d\s])(cm|mm|m|inches|inch|in\.?|["″])(?![a-z])/i;
// 54 7/8 · 7/8 · 54.5 · 54,5
const NUMBER = /(\d+(?:[.,]\d+)?)(?:\s+(\d+)\/(\d+))?|(\d+)\/(\d+)/g;

const unitOf = (s) => {
  const m = UNIT.exec(s);
  if (!m) return null;
  const u = m[1].toLowerCase();
  return u.startsWith('in') || u === '"' || u === '″' ? 'in' : u;
};

// text → { values: [cm…], unit, original } or null when it isn't a dimensions line
export function parseDimensions(text) {
  const parts = String(text).split(/[();]/).map((s) => s.trim()).filter(Boolean);
  // prefer a metric part ("… cm (… in.)"), else the first one with numbers
  const part = parts.find((p) => /\d/.test(p) && ['cm', 'mm', 'm'].includes(unitOf(p))) || parts.find((p) => /\d/.test(p));
  if (!part) return null;
  const unit = unitOf(part) || 'cm';
  const values = [];
  for (const m of part.matchAll(NUMBER)) {
    let v;
    if (m[4]) v = Number(m[4]) / Number(m[5]);                                     // 7/8
    else v = Number(m[1].replace(',', '.')) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);  // 54 7/8
    if (Number.isFinite(v) && v > 0) values.push(Math.round(v * TO_CM[unit] * 100) / 100);
  }
  if (!values.length || values.length > 3) return null;
  return { values, unit, original: part };
}

const fmt = (n) => String(n);

export function initDims() {
  document.querySelectorAll('.row.dims').forEach((row) => {
    const inputs = ['h', 'w', 'd'].map((x) => row.querySelector(`input[name$="_${x}"]`));
    if (inputs.some((i) => !i)) return;
    const note = document.querySelector('input[name="f.dimensions_note"]');
    const notice = Object.assign(document.createElement('div'), { className: 'hint dims-notice', hidden: true });
    row.after(notice);

    const fill = (values, from = 0) => {
      values.forEach((v, i) => { if (inputs[from + i]) inputs[from + i].value = fmt(v); });
      if (from === 0) for (let i = values.length; i < 3; i += 1) inputs[i].value = '';  // a whole line replaces all three
      for (const i of inputs) i.dispatchEvent(new Event('input', { bubbles: true }));  // drafts, live copy, the hint
    };
    const tell = (parsed) => {
      notice.replaceChildren();
      if (parsed.unit === 'cm') { notice.hidden = true; return; }
      const name = { in: 'inches', mm: 'millimetres', m: 'metres' }[parsed.unit];
      notice.append(`Converted from ${name}: ${parsed.original} → ${parsed.values.join(' × ')} cm. `);
      if (note) {
        const keep = Object.assign(document.createElement('button'), { type: 'button', className: 'link small', textContent: 'Keep the original in the note' });
        keep.addEventListener('click', () => {
          note.value = note.value.trim() ? `${note.value.trim()}; ${parsed.original}` : parsed.original;
          note.dispatchEvent(new Event('input', { bubbles: true }));
          keep.remove();
        });
        notice.append(keep);
      }
      notice.hidden = false;
    };

    inputs.forEach((input, index) => {
      input.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData).getData('text');
        const parsed = parseDimensions(text);
        // a plain single number pastes normally; anything with ×, a unit or several numbers is handled here
        if (!parsed || (parsed.values.length === 1 && !unitOf(text) && /^\s*[\d.,]+\s*$/.test(text))) return;
        e.preventDefault();
        fill(parsed.values, parsed.values.length === 1 ? index : 0);
        tell(parsed);
      });
      // typed with a unit ("21 in"): converted when leaving the box
      input.addEventListener('change', () => {
        if (!unitOf(input.value)) return;
        const parsed = parseDimensions(input.value);
        if (!parsed || parsed.values.length !== 1) return;
        fill(parsed.values, index);
        tell(parsed);
      });
    });
  });
}
