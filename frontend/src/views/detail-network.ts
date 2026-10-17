// Detail pages: questions to the network and the history (API 088/089) — how this entry is connected to another one,
// the works that went through the same hands (artworks), and a citable version of the entry.
import { getHistory, getNetworkPath, getSharedHands, PLURAL } from '../api';
import { html, render, TYPE_LABEL, type Html } from '../html';
import { findAll } from '../search';
import type { Entity, NetRef, NetworkPath, Plural, SharedHand, Version } from '../types';
import { showError } from './common';

const SITE = 'https://arthistory.piogino.ch';
const SHOWN = 8; // works per line; the rest behind "and N more"

/** "A, B, C and 12 more" — the rest unfolds. */
function works(list: { w: SharedHand }[]): Html {
  const line = (l: typeof list) => l.map((x, i) => html`${i ? ', ' : ''}${netLink(x.w.artwork)}`);
  return list.length <= SHOWN ? html`${line(list)}`
    : html`${line(list.slice(0, SHOWN))} <details class="hands-more"><summary>and ${String(list.length - SHOWN)} more</summary>${line(list.slice(SHOWN))}</details>`;
}

/** An entry named by the network or history answers: linked by its canonical path, or "(no longer exists)". */
export const netLink = (r: NetRef | null) => (!r ? html`<span class="muted">unknown</span>`
  : r.gone || !r.name ? html`<span class="muted">(an entry that no longer exists)</span>` : html`<a href="${r.path}">${r.name}</a>`);

// ---- how are they connected? ------------------------------------------------------------------------------------

/** "A — owned by → B — creator → C": the chain top to bottom, each link with its period and note. */
export function pathChain(p: NetworkPath): Html {
  if (!p.found) return html`<p class="muted">No connection within 6 steps.</p>`;
  if (!p.steps.length) return html`<p class="muted">That is this entry itself.</p>`;
  return html`<ol class="net-path">
    <li class="net-node">${netLink(p.steps[0].from)} <span class="muted small">${TYPE_LABEL[p.steps[0].from.type]}</span></li>
    ${p.steps.map((s) => html`<li class="net-link${s.certainty && s.certainty !== 'attested' ? ' uncertain' : ''}">
        <span class="net-reads">${s.reads}</span>${s.period?.label ? html` <span class="muted">${s.period.label}</span>` : ''}${s.note ? html` <span class="muted">· ${s.note}</span>` : ''}${s.certainty && s.certainty !== 'attested' ? html` <span class="tag">${s.certainty}</span>` : ''}
      </li>
      <li class="net-node">${netLink(s.to)} <span class="muted small">${TYPE_LABEL[s.to.type]}</span></li>`)}
  </ol>
  <p class="muted small">${String(p.steps.length)} ${p.steps.length === 1 ? 'step' : 'steps'}: relationships and provenance (owned by, held by, handed to …), the shortest chain.</p>`;
}

/** "Connect to…": pick any entry (the site's own search over every entry), then the chain between the two. */
export function connectSection(el: HTMLElement, e: Entity, current: () => boolean) {
  const self = `${PLURAL[e.type]}/${e.public_id ?? e.slug}`;
  render(el, html`<h2>How are they connected?</h2>
    <form class="connect-form" role="search" autocomplete="off">
      <label>Connect to… <input type="search" name="to" placeholder="An artist, a work, a collector…" aria-autocomplete="list" aria-controls="connect-hits"></label>
      <ul class="connect-hits" id="connect-hits" role="listbox" hidden></ul>
    </form>
    <div id="connect-result" aria-live="polite"></div>`);
  const input = el.querySelector<HTMLInputElement>('input')!;
  const hits = el.querySelector<HTMLElement>('#connect-hits')!;
  const out = el.querySelector<HTMLElement>('#connect-result')!;
  let timer: number | undefined;
  let request = 0;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { hits.hidden = true; return; }
    timer = window.setTimeout(async () => {
      const mine = ++request;
      const { local } = await findAll(q).catch(() => ({ local: [] }));
      if (mine !== request || !current()) return;
      const shown = local.filter(({ e: x }) => !(x.type === e.type && x.slug === e.slug)).slice(0, 8);
      hits.hidden = false;
      render(hits, shown.length ? html`${shown.map(({ e: x, m }) => html`<li><button type="button" role="option" data-to="${PLURAL[x.type]}/${x.slug}" data-name="${x.name}">
        ${m.name} <span class="muted small">${TYPE_LABEL[x.type]}${m.meta ? html` · ${m.meta}` : ''}</span></button></li>`)}` : html`<li class="muted">No matches</li>`);
    }, 200);
  });
  hits.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('button[data-to]');
    if (!b) return;
    hits.hidden = true;
    input.value = b.dataset.name ?? '';
    render(out, html`<p class="muted small">Looking for the shortest chain…</p>`);
    getNetworkPath(self, b.dataset.to!)
      .then((p) => current() && render(out, pathChain(p)))
      .catch((err) => current() && showError(out, err));
  });
  el.querySelector('form')!.addEventListener('submit', (ev) => {
    ev.preventDefault();
    hits.querySelector<HTMLButtonElement>('button[data-to]')?.click();
  });
}

// ---- through the same hands (artworks) -----------------------------------------------------------------------

/**
 * Works that went through the same hands: depth 1 grouped by holder ("Also held by Ambroise Vollard: …", "at the same
 * time" when they were there together), depth 2 folded away ("further: … via …"). A switch adds the hands both works
 * are still in (a museum's whole collection would otherwise swamp the list).
 */
export function sharedHandsSection(el: HTMLElement, e: Entity, current: () => boolean) {
  const key = String(e.public_id ?? `artworks/${e.slug}`);
  let withCurrent = false;
  const load = () => getSharedHands(key, withCurrent).then((res) => {
    if (!current()) return;
    const near = res.data.filter((d) => d.depth === 1);
    const far = res.data.filter((d) => d.depth > 1);
    if (!res.data.length && !withCurrent) { el.hidden = true; return; }
    el.hidden = false;
    const byHolder = new Map<string, { holder: NetRef; works: { w: SharedHand; together: boolean }[] }>();
    for (const w of near) for (const h of w.holders) {
      const k = h.path ?? `${h.type}/${h.slug}`;
      if (!byHolder.has(k)) byHolder.set(k, { holder: h, works: [] });
      byHolder.get(k)!.works.push({ w, together: !!h.together });
    }
    const groups = [...byHolder.values()].sort((a, b) => b.works.length - a.works.length || (a.holder.name ?? '').localeCompare(b.holder.name ?? ''));
    render(el, html`<h2>Through the same hands</h2>
      <p class="muted small">Other works their holders also had — from the provenance of each work. Not the artist.</p>
      <label class="shared-current"><input type="checkbox" ${withCurrent ? html`checked` : ''}> include the hands both are still in (a museum's collection)</label>
      ${groups.length ? html`<ul class="rel-list shared-hands">${groups.map((g) => {
        const same = g.works.filter((x) => x.together);
        const other = g.works.filter((x) => !x.together);
        return html`<li>
          <span class="rel-label">also held by</span> ${netLink(g.holder)}:
          ${same.length ? html`<div class="shared-line"><span class="tag" title="This work and these were in these hands at the same time">at the same time</span> ${works(same)}</div>` : ''}
          ${other.length ? html`<div class="shared-line">${same.length ? html`<span class="muted small">at other times</span> ` : ''}${works(other)}</div>` : ''}
        </li>`;
      })}</ul>` : html`<p class="muted">No other work went through the same hands.</p>`}
      ${far.length ? html`<details class="shared-far"><summary>Further: ${String(far.length)} ${far.length === 1 ? 'work' : 'works'} through the hands of those</summary>
        <ul class="rel-list">${far.map((w) => html`<li>${netLink(w.artwork)} <span class="muted">via ${netLink(w.via)}${w.holders.length ? html` (${w.holders.map((h, i) => html`${i ? ', ' : ''}${netLink(h)}`)})` : ''}</span></li>`)}</ul>
      </details>` : ''}`);
    el.querySelector<HTMLInputElement>('.shared-current input')!.addEventListener('change', (ev) => {
      withCurrent = (ev.target as HTMLInputElement).checked;
      void load();
    });
  }).catch(() => { /* an optional section: left out when the answer fails */ });
  void load();
}

// ---- cite this version ----------------------------------------------------------------------------------------

/** "16 October 2026, 17:29:26 (Zurich time)" — the moment as people read it; the citation carries it exactly. */
export const moment = (iso: string) =>
  `${new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} (Zurich time)`;

/** The address of a version: the canonical path with `as_of` exactly as the API gave it (microseconds). */
export const versionUrl = (path: string, asOf: string) => `${SITE}${path}?as_of=${asOf}`;

/** "Name." Art History, no. 100476, version of …. URL (accessed …). */
export const citation = (name: string, publicId: number, path: string, v: Version) =>
  `“${name}.” Art History, no. ${publicId}, version of ${moment(v.as_of)}. ${versionUrl(path, v.as_of)} (accessed ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}).`;

/** "Cite this version": the newest version by default, any earlier one to choose; the text to copy and its link. */
export function citeSection(el: HTMLElement, plural: Plural, e: Entity, name: string, current: () => boolean) {
  if (!e.public_id || !e.path) return;
  getHistory(plural, String(e.public_id)).then((h) => {
    if (!current() || !h.versions.length) return;
    el.hidden = false;
    const label = (v: Version) => `${moment(v.as_of)} — ${v.changes} ${v.changes === 1 ? 'change' : 'changes'}${v.sources.length ? ` (${v.sources.join(', ')})` : ''}`;
    const draw = (i: number) => {
      const v = h.versions[i];
      const text = citation(name, e.public_id!, e.path!, v);
      render(el, html`<h2>Cite this version</h2>
        <p class="muted small">Entries change. A version stays as it was: its link shows the entry as recorded at that moment.</p>
        <label class="cite-version-pick">Version <select>${h.versions.map((x, j) => html`<option value="${String(j)}" ${j === i ? html`selected` : ''}>${j === 0 ? 'Latest: ' : ''}${label(x)}</option>`)}</select></label>
        <blockquote class="cite-version-text">${text}</blockquote>
        <p><button type="button" class="cite-copy">Copy</button> <a href="${e.path}?as_of=${v.as_of}">Open this version →</a></p>`);
      el.querySelector('select')!.addEventListener('change', (ev) => draw(Number((ev.target as HTMLSelectElement).value)));
      el.querySelector('.cite-copy')!.addEventListener('click', (ev) => {
        const b = ev.currentTarget as HTMLButtonElement;
        navigator.clipboard?.writeText(text).then(() => { b.textContent = 'Copied'; }, () => { b.textContent = 'Select the text to copy'; });
      });
    };
    draw(0);
  }).catch(() => { /* optional: no box without the history */ });
}
