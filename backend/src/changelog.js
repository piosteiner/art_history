// The public changelog and roadmap (migration 118) — shared by the CMS (src/admin/routes/changelog.js) and the API.
// In the CMS an entry's bullet points are written one per line, each starting with its kind:
//   Neu: Projekt Dokumentation auf der Website
//   Verbessert: Die Suche versteht „aber nicht in …"
//   Behoben: Inventarnummern nur noch verlinkt, wenn geteilt
//   Inhalt: 20 Werke des Belvedere mit Provenienz
//   Technik: pg_stat_statements eingeschaltet
// A topic (137, the roadmap's list, roadmap_areas) goes in brackets after the kind: "Neu [Karte]: Historische Karten".
// A line without a kind is "Neu"; a line starting with two spaces or a tab continues the bullet above. Bullets may use
// Markdown and [[type/slug]] links (rendered like every text: src/markdown.js).
const { renderMarkdown, linkNames } = require('./markdown');

const KINDS = { neu: 'Neu', verbessert: 'Verbessert', behoben: 'Behoben', inhalt: 'Inhalt', technik: 'Technik' };
const BY_LABEL = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [v.toLowerCase(), k]));
const STATUS = { jetzt: 'In Arbeit', naechstes: 'Als Nächstes', spaeter: 'Später', erledigt: 'Erledigt' };

// "Neu [Topic]: Text" lines → [{kind, area, text}] (area null without brackets)
function parseItems(text) {
  const items = [];
  for (const raw of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    if (/^(\s{2,}|\t)/.test(raw) && items.length) { items[items.length - 1].text += `\n${raw.trim()}`; continue; }
    const line = raw.trim().replace(/^[-*•]\s+/, '');
    const m = /^([A-Za-zÄÖÜäöü]+)\s*(?:\[([^\]\n]+)\])?\s*:\s*(.+)$/.exec(line);
    const kind = m && BY_LABEL[m[1].toLowerCase()];
    items.push(kind ? { kind, area: m[2] ? m[2].trim() || null : null, text: m[3].trim() } : { kind: 'neu', area: null, text: line });
  }
  return items;
}
// [{kind, area, text}] → the lines again (a bullet's further lines indented, so they stay its own)
const itemsToText = (items) => items.map((i) => `${KINDS[i.kind]}${i.area ? ` [${i.area}]` : ''}: ${String(i.text_md ?? i.text).replace(/\n/g, '\n  ')}`).join('\n');

// a bullet's Markdown → inline HTML (the one paragraph markdown-it wraps it in removed; several stay paragraphs)
async function renderItems(db, texts) {
  const names = await linkNames(db, texts);
  return texts.map((t) => {
    const out = renderMarkdown(t, { names, used: new Set(), cited: new Set() }).trim();
    return (out.match(/<p>/g) || []).length === 1 ? out.replace(/^<p>([\s\S]*)<\/p>$/, '$1') : out;   // several paragraphs: kept
  });
}

module.exports = { KINDS, STATUS, parseItems, itemsToText, renderItems };
