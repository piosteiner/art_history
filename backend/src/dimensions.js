// Further measurements of an artwork (column other_dimensions, migration 025), shared by the content model and forms.
//   doc / YAML:  [{part: 'mount', cm: [180, 95.5]}]          form: one per line "mount | 180 × 95.5"
// Numbers are height, width, depth in cm; each only together with the ones before it (as the main dimensions).
const PARTS = ['image', 'sheet', 'mount', 'frame', 'overall', 'with base', 'base', 'pedestal', 'case', 'box'];

const label = (cm) => `${cm.join(' × ')} cm${cm.length === 1 ? ' (height)' : ''}`;

function normSet(v, i) {
  const where = `[${i}]`;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${where} must be {part, cm}`);
  const extra = Object.keys(v).filter((k) => !['part', 'cm'].includes(k));
  if (extra.length) throw new Error(`${where} unknown key(s) ${extra.join(', ')}`);
  const part = String(v.part ?? '').trim();
  if (!part) throw new Error(`${where} needs a part (mount, frame, sheet …)`);
  if (!Array.isArray(v.cm) || v.cm.length < 1 || v.cm.length > 3 || !v.cm.every((n) => Number.isFinite(n) && n > 0 && n < 1e6)) {
    throw new Error(`${where} ${part}: height, or height × width (× depth), in cm`);
  }
  return { part, cm: v.cm.map((n) => Math.round(n * 100) / 100) };
}

// "mount | 180 × 95,5" → {part: 'mount', cm: [180, 95.5]}
function linesToSets(text) {
  return String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const [part, nums = ''] = line.split('|').map((s) => s.trim());
    const cm = nums.split(/\s*[×xX*]\s*/).map((s) => s.trim().replace(',', '.')).filter(Boolean);
    if (!cm.every((s) => /^\d+(\.\d+)?$/.test(s))) throw new Error(`"${line}": numbers in cm, e.g. mount | 180 × 95.5`);
    return normSet({ part, cm: cm.map(Number) }, i);
  });
}
const setsToLines = (sets) => (sets || []).map((s) => `${s.part} | ${s.cm.join(' × ')}`).join('\n');

module.exports = { PARTS, label, normSet, linesToSets, setsToLines };
