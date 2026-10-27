// /statistik — the project's numbers in one place (API /v1/stats, migration 138): how many entries of each kind,
// provenance steps, citations, images, migrations, tests, words of the documentation; today's value as a tile and the
// development as a line chart per number. The documentation links here instead of carrying numbers that age.
// Below: the vocabulary (API /v1/stats/vocabulary) — every kind of relationship and every provenance option with how often
// it is used, for professionals who want to see the model and give feedback.
// The charts: one series each (no legend — the title names it), a 2px line in --chart-line (the dots are HTML, so a
// chart stretched to its width keeps them round), a crosshair with the
// day's value under the pointer (or the keyboard: ← →).
import { getModelVocabulary, getStats, type ModelVocabulary, type Stats, type VocabOption } from '../api';
import { html, render, type Html } from '../html';
import { guard, showError } from './common';

const NUM = new Intl.NumberFormat('de-CH');
const DAY = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'short', year: 'numeric' });
const DAY_SHORT = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'short' });
const date = (d: string) => new Date(`${d}T12:00:00`);

const LABELS: Record<string, string> = {
  'entries.total': 'Einträge insgesamt',
  'entries.artworks': 'Kunstwerke', 'entries.artists': 'Künstler:innen', 'entries.people': 'Personen',
  'entries.institutions': 'Institutionen', 'entries.places': 'Orte', 'entries.movements': 'Strömungen und Epochen',
  'entries.events': 'Ereignisse', 'entries.polities': 'Staatsgebilde', 'entries.glossary': 'Glossarbegriffe',
  'entries.bibliography': 'Quellen im Literaturverzeichnis',
  'content.provenance': 'Provenienzschritte', 'content.relationships': 'Beziehungen', 'content.citations': 'Quellenangaben',
  'content.images': 'Bilder',
  'project.migrations': 'Migrationen der Datenbank', 'project.relationship_types': 'Arten von Beziehungen',
  'tests.backend_e2e': 'Tests von Backend und CMS (End-to-End)', 'tests.backend_unit': 'Tests des Backends (Unit)',
  'tests.site': 'Tests der Website', 'documentation.words': 'Wörter',
};
const GROUPS: { title: string; tiles: string[]; charts: string[]; note?: string }[] = [
  { title: 'Einträge', tiles: ['entries.artworks', 'entries.artists', 'entries.people', 'entries.institutions', 'entries.places',
    'entries.movements', 'entries.events', 'entries.polities', 'entries.glossary', 'entries.bibliography'], charts: ['entries.total', 'entries.artworks'],
    note: 'Gezählt werden die Einträge, die heute bestehen, an dem Tag, an dem sie erfasst wurden; später gelöschte fehlen in den früheren Tagen.' },
  { title: 'Inhalte', tiles: ['content.provenance', 'content.relationships', 'content.citations', 'content.images'], charts: ['content.provenance', 'content.citations'] },
  { title: 'Entwicklung', tiles: ['project.migrations', 'tests.backend_e2e', 'tests.backend_unit', 'tests.site', 'project.relationship_types'],
    charts: ['project.migrations', 'tests.backend_e2e', 'tests.site'],
    note: 'Tests werden als ihre Definitionen im Code gezählt, frühere Tage aus der Versionsgeschichte auf GitHub.' },
  { title: 'Projektdokumentation', tiles: ['documentation.words'], charts: ['documentation.words'] },
];

const W = 560;
const H = 180;
const PAD = { l: 52, r: 12, t: 12, b: 26 };

/** A "nice" upper bound for the axis: 1, 2 or 5 times a power of ten, at least the largest value. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)) ?? 10 * p;
}

function chart(metric: string, series: [string, number][]): Html {
  const label = LABELS[metric] ?? metric;
  if (series.length < 2) return html``;
  const t0 = date(series[0][0]).getTime();
  const t1 = date(series[series.length - 1][0]).getTime();
  const max = niceMax(Math.max(...series.map((s) => s[1])));
  const x = (d: string) => PAD.l + ((date(d).getTime() - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const path = series.map(([d, v], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ticks = [0, max / 2, max];
  const last = series[series.length - 1];
  return html`<figure class="stats-chart" data-series="${JSON.stringify(series)}" data-max="${String(max)}">
    <figcaption>${label}</figcaption>
    <div class="stats-plot" tabindex="0" role="img" aria-label="${label}: von ${NUM.format(series[0][1])} am ${DAY.format(date(series[0][0]))} auf ${NUM.format(last[1])} am ${DAY.format(date(last[0]))}. Pfeiltasten zeigen die einzelnen Tage.">
      <svg viewBox="0 0 ${String(W)} ${String(H)}" preserveAspectRatio="none" aria-hidden="true">
        ${ticks.map((v) => html`<line class="stats-grid" x1="${String(PAD.l)}" x2="${String(W - PAD.r)}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"></line>`)}
        <path class="stats-line" d="${path}"></path>
        <line class="stats-cross" y1="${String(PAD.t)}" y2="${String(H - PAD.b)}" hidden></line>
      </svg>
      <span class="stats-end" style="left:${(x(last[0]) / W * 100).toFixed(2)}%;top:${(y(last[1]) / H * 100).toFixed(2)}%"></span>
      <span class="stats-dot" hidden></span>
      <div class="stats-axis-y">${ticks.slice().reverse().map((v) => html`<span style="top:${(y(v) / H * 100).toFixed(2)}%">${NUM.format(v)}</span>`)}</div>
      <div class="stats-axis-x"><span>${DAY_SHORT.format(date(series[0][0]))}</span><span>${DAY_SHORT.format(date(last[0]))}</span></div>
      <div class="stats-tip" hidden></div>
    </div>
  </figure>`;
}

/** Hover / keyboard: the crosshair on the nearest day, its value in the tooltip. */
function wireChart(fig: HTMLElement) {
  const series = JSON.parse(fig.dataset.series!) as [string, number][];
  const max = Number(fig.dataset.max);
  const plot = fig.querySelector<HTMLElement>('.stats-plot')!;
  const cross = fig.querySelector<SVGLineElement>('.stats-cross')!;
  const dot = fig.querySelector<HTMLElement>('.stats-dot')!;
  const tip = fig.querySelector<HTMLElement>('.stats-tip')!;
  const t0 = date(series[0][0]).getTime();
  const t1 = date(series[series.length - 1][0]).getTime();
  const xs = series.map(([d]) => PAD.l + ((date(d).getTime() - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r));
  let at = -1;
  const show = (i: number) => {
    at = Math.max(0, Math.min(series.length - 1, i));
    const [d, v] = series[at];
    const yv = H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
    cross.setAttribute('x1', xs[at].toFixed(1)); cross.setAttribute('x2', xs[at].toFixed(1)); cross.removeAttribute('hidden');
    dot.style.left = `${(xs[at] / W * 100).toFixed(2)}%`; dot.style.top = `${(yv / H * 100).toFixed(2)}%`; dot.hidden = false;
    tip.textContent = `${DAY.format(date(d))}: ${NUM.format(v)}`;
    tip.hidden = false;
    const left = (xs[at] / W) * 100;
    tip.style.left = `${left}%`;
    tip.style.transform = left > 70 ? 'translateX(-100%)' : left < 30 ? 'none' : 'translateX(-50%)';
  };
  const hide = () => { cross.setAttribute('hidden', ''); dot.hidden = true; tip.hidden = true; };
  plot.addEventListener('pointermove', (e) => {
    const r = plot.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    xs.forEach((xv, i) => { if (Math.abs(xv - px) < Math.abs(xs[best] - px)) best = i; });
    show(best);
  });
  plot.addEventListener('pointerleave', hide);
  plot.addEventListener('blur', hide);
  plot.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(at < 0 ? series.length - 1 : at - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(at < 0 ? series.length - 1 : at + 1); }
  });
}

const CATEGORY: Record<string, string> = {
  polity: 'Staatsgebilde', presence: 'Aufenthalt und Orte', association: 'Zugehörigkeit', depiction: 'Darstellung', influence: 'Einfluss',
  education: 'Ausbildung', collaboration: 'Zusammenarbeit', membership: 'Mitgliedschaft', patronage: 'Förderung und Auftrag',
  publication: 'Veröffentlichung', provenance: 'Provenienz (aus den Provenienzschritten abgeleitet)', architecture: 'Architektur', event: 'Ereignisse', glossary: 'Glossar',
};
const TYPE: Record<string, string> = {
  artist: 'Künstler:in', artwork: 'Kunstwerk', institution: 'Institution', person: 'Person', movement: 'Strömung', place: 'Ort',
  polity: 'Staatsgebilde', term: 'Glossarbegriff', source: 'Quelle', event: 'Ereignis',
};
const types = (t: string[]) => t.map((x) => TYPE[x] ?? x).join(', ');
const used = (n: number) => html`<td class="vocab-n">${NUM.format(n)}</td>`;

/** One list of options: the wording on the site, what it means, how often it is used. */
const optionTable = (title: string, intro: string, rows: VocabOption[]) => html`<h3>${title}</h3>
  <p class="muted small">${intro}</p>
  <div class="table-wrap"><table class="vocab-table"><thead><tr><th>Option</th><th>Bedeutung</th><th class="vocab-n">Verwendet</th></tr></thead>
    <tbody>${rows.map((o) => html`<tr${o.n ? '' : html` class="vocab-unused"`}><td><code>${o.label}</code></td><td>${o.description ?? ''}</td>${used(o.n)}</tr>`)}</tbody></table></div>`;

function vocabularyView(box: HTMLElement, v: ModelVocabulary) {
  const byCategory = new Map<string, ModelVocabulary['relationships']>();
  for (const r of v.relationships) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  const p = v.provenance;
  render(box, html`<section class="stats-group vocab" id="beziehungen"><h2>Arten von Beziehungen</h2>
      <p class="muted small">Alle ${String(v.relationships.length)} Arten, mit denen Einträge verbunden werden, in der Bezeichnung der Website
        (englisch) und in der Gegenrichtung, wie sie auf der anderen Seite erscheint. „Verwendet“ zählt die Verbindungen in der Datenbank.
        Rückmeldungen dazu sind willkommen.</p>
      ${[...byCategory].map(([cat, rows]) => html`<h3>${CATEGORY[cat] ?? cat}</h3>
        <div class="table-wrap"><table class="vocab-table"><thead><tr><th>Beziehung</th><th>Gegenrichtung</th><th>Von → Zu</th><th class="vocab-n">Verwendet</th></tr></thead>
          <tbody>${rows.map((r) => html`<tr${r.n ? '' : html` class="vocab-unused"`}>
            <td><code>${r.label}</code>${r.symmetric ? html` <span class="tag" title="Gilt in beide Richtungen">gegenseitig</span>` : ''}${r.derived ? html` <span class="tag" title="Wird aus anderen Angaben abgeleitet, nicht von Hand erfasst">abgeleitet</span>` : ''}${r.presence ? html` <span class="tag" title="Bedeutet physische Anwesenheit: erscheint auf der Karte und der Route">auf der Karte</span>` : ''}
              ${r.description ? html`<div class="muted small">${r.description}</div>` : ''}</td>
            <td>${r.symmetric ? '–' : html`<code>${r.inverse_label}</code>`}</td>
            <td class="small">${types(r.subject_types)} → ${types(r.object_types)}</td>${used(r.n)}</tr>`)}</tbody></table></div>`)}
    </section>
    <section class="stats-group vocab" id="provenienz"><h2>Provenienz: die Optionen</h2>
      <p class="muted small">Was ein Provenienzschritt festhalten kann: wie ein Werk erworben wurde, in welcher Rolle es jemand hielt, wie sicher
        die Angabe ist, welche Nachweise es gibt. Die Bezeichnungen sind jene der Website (englisch); „Verwendet“ zählt die Schritte.
        Rückmeldungen dazu sind willkommen.</p>
      ${optionTable('Art des Erwerbs', 'Wie das Werk an die Halterin oder den Halter kam.', p.methods)}
      ${optionTable('Rolle', 'In welcher Eigenschaft jemand das Werk hielt. Wer nicht Eigentümer:in ist, steht neben der Kette der Eigentümer:innen.', p.roles)}
      ${optionTable('Sicherheit', 'Wie gut ein Schritt belegt ist.', p.certainty)}
      ${optionTable('Nachweise', 'Einträge zu einem Schritt: wo und wann das Werk dokumentiert ist.', p.records)}
      ${optionTable('Provenienz 1933–1945', 'Die Kategorien des Schweizer Bundesamts für Kultur, pro Werk; „Verwendet“ zählt die Werke.', p.status)}
      <h3>Nummern</h3>
      <p class="muted small">Nummern, die ein Schritt tragen kann. Jene der Halter:innen gelten nur bei ihnen, die übrigen werden über alle Werke
        hinweg verglichen und verlinkt.</p>
      <div class="table-wrap"><table class="vocab-table"><thead><tr><th>Nummer</th><th>Bedeutung</th><th>Gilt</th><th class="vocab-n">Verwendet</th></tr></thead>
        <tbody>${p.numbers.map((o) => html`<tr${o.n ? '' : html` class="vocab-unused"`}><td><code>${o.label}</code></td><td>${o.description ?? ''}</td>
          <td class="small">${o.scope === 'global' ? 'über alle Werke' : 'bei der Halter:in'}</td>${used(o.n)}</tr>`)}</tbody></table></div>
      <h3>Währungen</h3>
      <p class="muted small">Für Preise in der Provenienz, auch historische; „Verwendet“ zählt die Schritte mit einem Preis in dieser Währung.</p>
      <div class="table-wrap"><table class="vocab-table"><thead><tr><th>Code</th><th>Währung</th><th>In Gebrauch</th><th class="vocab-n">Verwendet</th></tr></thead>
        <tbody>${p.currencies.map((c) => html`<tr${c.n ? '' : html` class="vocab-unused"`}><td><code>${c.code}</code></td><td>${c.name}</td>
          <td class="small">${c.since ? `${c.since.slice(0, 4)}–${c.until ? c.until.slice(0, 4) : 'heute'}` : ''}</td>${used(c.n)}</tr>`)}</tbody></table></div>
    </section>`);
}

function view(box: HTMLElement, s: Stats) {
  const value = (m: string) => s.metrics[m]?.value;
  const total = value('entries.total');
  render(box, html`<h1>Statistik</h1>
    <p class="lead">Die Zahlen des Projekts an einem Ort: was erfasst ist, wie es gewachsen ist und woran gebaut wird.</p>
    <p class="muted small">Stand ${s.updated ? DAY.format(date(s.updated)) : '—'} · täglich nachgeführt</p>
    ${total !== undefined ? html`<p class="stats-hero"><span class="stats-hero-value">${NUM.format(total)}</span> Einträge</p>` : ''}
    ${GROUPS.map((g) => html`<section class="stats-group"><h2>${g.title}</h2>
      <ul class="stats-tiles">${g.tiles.filter((m) => value(m) !== undefined).map((m) => html`<li><span class="stats-value">${NUM.format(value(m)!)}</span><span class="stats-label">${LABELS[m] ?? m}</span></li>`)}</ul>
      <div class="stats-charts">${g.charts.filter((m) => s.metrics[m]).map((m) => chart(m, s.metrics[m].series))}</div>
      ${g.note ? html`<p class="muted small">${g.note}</p>` : ''}</section>`)}`);
  box.querySelectorAll<HTMLElement>('.stats-chart').forEach(wireChart);
  box.insertAdjacentHTML('beforeend', '<div class="vocab-box"><p class="muted small">Lädt…</p></div>');
}

export function statsPage(main: HTMLElement) {
  document.title = 'Statistik · Art History';
  render(main, html`<article class="page stats-page" lang="de-CH"><p class="muted small">Lädt…</p></article>`);
  const box = main.querySelector<HTMLElement>('article')!;
  const current = guard();
  getStats().then((s) => {
    if (!current()) return;
    view(box, s);
    const vocab = box.querySelector<HTMLElement>('.vocab-box')!;
    getModelVocabulary().then((v) => {
      if (!current()) return;
      vocabularyView(vocab, v);
      if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
    }).catch((err) => { if (current()) showError(vocab, err); });
  }).catch((err) => { if (current()) showError(box, err); });
}
