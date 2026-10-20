// Provenance numbers (API 077): which works' provenance records a number — a lot, a dealer's stock number, ERR,
// Munich Central Collecting Point, Linz, "Entartete Kunst", a Lugt mark … The numbers on artwork pages link here.
import { getProvenanceNumbers } from '../api';
import { html, link, render } from '../html';
import { replaceUrl } from '../router';
import { guard, showError } from './common';

export function provenanceNumbers(main: HTMLElement, params: URLSearchParams) {
  document.title = 'Provenance numbers · Art History';
  const kind = params.get('kind');
  render(main, html`<section class="page">
    <h1>Provenance numbers</h1>
    <p class="muted">Lot, stock and inventory numbers, numbers of the ERR, the Munich Central Collecting Point, Linz or
      “Entartete Kunst”, collectors’ marks (Lugt): which works’ provenance records a number. Exact matches.</p>
    <form class="provenance-number-form" role="search">
      <input type="search" name="number" aria-label="Number" placeholder="e.g. 4317" value="${params.get('number') ?? ''}" autocomplete="off">
      <button type="submit">Look up</button>
    </form>
    <div id="number-results"></div>
  </section>`);
  const form = main.querySelector('form')!;
  const input = form.querySelector('input')!;
  const out = main.querySelector<HTMLElement>('#number-results')!;
  const current = guard();

  function lookUp(number: string, kindFilter: string | null) {
    if (!number) return render(out, html``);
    render(out, html`<p class="muted small">Looking up…</p>`);
    getProvenanceNumbers(number, kindFilter, number === (params.get('number') ?? '').trim() ? params.get('of') : null)
      .then((hits) => {
        if (!current() || input.value.trim() !== number) return;
        const kindLabel = kindFilter && hits[0]?.kind_label;
        render(out, html`<p class="muted" id="number-count">${hits.length ? `${hits.length} ${hits.length === 1 ? 'step records' : 'steps record'}` : 'No provenance step records'}
          ${kindLabel ? `${kindLabel} ` : ''}“${number}”${kindFilter ? html` · <a href="/provenance-numbers?${String(new URLSearchParams({ number }))}">any kind</a>` : ''}.</p>
          ${hits.length ? html`<ul class="rel-list number-hits">${hits.map((h) => html`<li>
            <span class="rel-label">${h.kind_label} ${h.number}</span>
            ${link('artwork', h.artwork.slug, h.artwork.title)}
            <span class="muted">${[h.owner_name, h.period?.label].filter(Boolean).join(', ')}</span>
          </li>`)}</ul>` : ''}`);
      })
      .catch((err) => current() && showError(out, err));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const number = input.value.trim();
    replaceUrl(`/provenance-numbers${number ? `?${new URLSearchParams({ number })}` : ''}`);
    lookUp(number, null);
  });
  lookUp((params.get('number') ?? '').trim(), kind);
}
