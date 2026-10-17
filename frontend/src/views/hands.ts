// Through whose hands (/provenance/1933-1945, any window /provenance/<from>-<to>; API 088): the holders of works in a
// time window — most works first, their roles, possessors ("held without title") and flagged holders in red — and the
// handovers dated in it. The window is adjustable; 1933–1945 is the default.
import { getNetworkHands } from '../api';
import { html, render } from '../html';
import { navigate } from '../router';
import type { HandsHolder, NetworkHands } from '../types';
import { guard, showError } from './common';
import { netLink } from './detail-network';

const SHOWN_WORKS = 6; // per holder; the rest behind "and N more"

const roleTag = (r: string) => (r.startsWith('possessor')
  ? html`<span class="tag tag-ns" title="Seized, looted, stolen, or received from those who took it">held without title</span>`
  : html`<span class="tag">${r}</span>`);

function holderRow(h: HandsHolder) {
  const more = h.artworks.length - SHOWN_WORKS;
  const works = (list: typeof h.artworks) => list.map((w, i) => html`${i ? ', ' : ''}${netLink(w)}`);
  return html`<li class="${h.flag || h.roles.some((r) => r.startsWith('possessor')) ? 'hands-flagged' : ''}">
    ${netLink(h.holder)} ${h.roles.map(roleTag)}${h.flag ? html` <span class="tag tag-ns" title="A provenance flag on this holder">${h.flag}</span>` : ''}
    <span class="muted small">${String(h.artworks.length)} ${h.artworks.length === 1 ? 'work' : 'works'}</span>
    <div class="hands-works">${works(h.artworks.slice(0, SHOWN_WORKS))}${more > 0 ? html` <details class="hands-more"><summary>and ${String(more)} more</summary>${works(h.artworks.slice(SHOWN_WORKS))}</details>` : ''}</div>
  </li>`;
}

export function handsPage(main: HTMLElement, from: number, to: number) {
  document.title = `Through whose hands, ${from}–${to} · Art History`;
  render(main, html`<section class="page hands-page">
    <h1>Through whose hands, ${String(from)}–${String(to)}</h1>
    <p class="muted">Who held works of this collection in the window, from the provenance of each work — owners, dealers,
      custodians, and those who held them without title (seized, looted, stolen) — and the handovers dated in it.</p>
    <form class="hands-window">
      <label>From <input type="number" name="from" value="${String(from)}" min="1000" max="2100" required></label>
      <label>to <input type="number" name="to" value="${String(to)}" min="1000" max="2100" required></label>
      <button type="submit">Show</button>
      ${from !== 1933 || to !== 1945 ? html`<a href="/provenance/1933-1945">1933–1945</a>` : ''}
    </form>
    <div id="hands"><p class="muted small">Loading…</p></div>
  </section>`);
  const form = main.querySelector('form')!;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const a = Number((form.elements.namedItem('from') as HTMLInputElement).value);
    const b = Number((form.elements.namedItem('to') as HTMLInputElement).value);
    if (a && b) navigate(`/provenance/${Math.min(a, b)}-${Math.max(a, b)}`);
  });
  const out = main.querySelector<HTMLElement>('#hands')!;
  const current = guard();
  getNetworkHands(from, to)
    .then((d: NetworkHands) => {
      if (!current()) return;
      const without = d.holders.filter((h) => h.flag || h.roles.some((r) => r.startsWith('possessor')));
      render(out, html`
        <p>${String(d.holders.length)} holders · ${String(d.handovers.length)} handovers dated in the window${without.length ? html` · <span class="ns-text">${String(without.length)} held without title or flagged</span>` : ''}</p>
        <h2>Holders</h2>
        ${d.holders.length ? html`<ul class="rel-list hands-holders">${d.holders.map(holderRow)}</ul>` : html`<p class="muted">No one recorded in this window.</p>`}
        <h2>Handovers</h2>
        ${d.handovers.length ? html`<ol class="rel-list hands-handovers">${d.handovers.map((h) => html`<li>
          ${netLink(h.from)} <span class="muted">→</span> ${netLink(h.to)} · ${netLink(h.artwork)}
          ${h.period?.label ? html` <span class="muted">${h.period.label}</span>` : ''}${h.note ? html` <span class="muted">· ${h.note}</span>` : ''}
          ${h.certainty && h.certainty !== 'attested' ? html` <span class="tag">${h.certainty}</span>` : ''}
        </li>`)}</ol>` : html`<p class="muted">No handover dated in this window.</p>`}`);
    })
    .catch((err) => current() && showError(out, err));
}
