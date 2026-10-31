// An entry as recorded at a moment (?as_of=…, API 089): a banner saying so — how much changed since, a link to the
// current version (or that the entry no longer exists) — then its fields, relationships and provenance steps as they
// were, plainly: the answer is the stored record (Markdown as text, dates by their labels), not the normal page.
import { ApiError, getEntityAsOf, PLURAL } from '../api';
import { html, joinRange, PLURAL_LABEL, render, TYPE_LABEL, type Html } from '../html';
import { replaceUrl } from '../router';
import type { AsOfDetail, AsOfStep, Plural } from '../types';
import { guard, loading, showError } from './common';
import { moment, netLink } from './detail-network';

// stored columns not worth showing: keys, bookkeeping, geometry, and what has its own *_label or section
const HIDDEN = /^(id|slug|names|metadata|created_at|updated_at|location|area|part_sort|.*_id|.*_ruby|.*_lang)$/;
const NAME_KEYS = ['title', 'name', 'siglum'];

const fieldLabel = (k: string) => {
  const t = k.replace(/_label$/, '').replace(/_md$/, '').replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** A stored value as text: lists joined, booleans as yes/no; null for objects and empty values. */
function shown(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join(', ');
  return null;
}

/** The fields in stored order: a date by its label ("created" → "created_label"), texts (Markdown) as their own paragraphs. */
function fields(entry: Record<string, unknown>): { facts: [string, string][]; texts: [string, string][] } {
  const facts: [string, string][] = [];
  const texts: [string, string][] = [];
  for (const [k, v] of Object.entries(entry)) {
    if (HIDDEN.test(k) || NAME_KEYS.includes(k)) continue;
    if (`${k}_label` in entry) continue; // the range itself: its label says it
    const value = shown(v);
    if (value === null) continue;
    (k.endsWith('_md') ? texts : facts).push([fieldLabel(k), value]);
  }
  return { facts, texts };
}

const span = (a: AsOfStep) => { const [x, y] = [...new Set([a.acquired?.label, a.ended?.label].filter(Boolean))] as string[]; return y ? joinRange(x, y) : x ?? ''; }; // a day: once

function stepLine(s: AsOfStep): Html {
  const holder = s.holder ? netLink(s.holder) : html`${s.holder_label ?? 'Unknown holder'}`;
  return html`<li class="${s.alternative_to ? 'asof-alt' : ''}">
    ${s.alternative_to ? html`<span class="muted small">Another reading: </span>` : ''}${holder}
    ${s.role === 'possessor' ? html` <span class="tag tag-ns" title="Seized, looted, stolen, or received from those who took it">held without title</span>`
      : s.role && s.role !== 'owner' ? html` <span class="tag">${s.role}</span>` : ''}${span(s) ? html` <span class="muted">${span(s)}</span>` : ''}
    ${[s.method && s.method !== 'unknown' ? s.method.replace(/_/g, ' ') : null, s.label].filter(Boolean).length
      ? html`<div class="provenance-how">${[s.method && s.method !== 'unknown' ? s.method.replace(/_/g, ' ') : null, s.label].filter(Boolean).join(' · ')}</div>` : ''}
    ${s.notes_md ? html`<div class="rel-note asof-text">${s.notes_md}</div>` : ''}
  </li>`;
}

export function asOfView(main: HTMLElement, plural: Plural, key: string, asOf: string) {
  loading(main);
  const current = guard();
  getEntityAsOf(plural, key, asOf)
    .then((d: AsOfDetail) => {
      if (!current()) return;
      // the canonical address of the entry, keeping the version asked for
      if (d.current?.path && location.pathname !== d.current.path) replaceUrl(`${d.current.path}${location.search}${location.hash}`);
      const name = NAME_KEYS.map((k) => d.entry[k]).find((x) => typeof x === 'string') as string | undefined ?? d.current?.name ?? 'Entry';
      document.title = `${name} (as recorded on ${moment(d.version)}) · Art History`;
      const { facts, texts } = fields(d.entry);
      const changes = d.changes_since.length;
      render(main, html`<article class="page detail asof">
        <p class="crumbs"><a href="/${PLURAL[d.type]}">${PLURAL_LABEL[PLURAL[d.type]]}</a> / ${TYPE_LABEL[d.type]}</p>
        <div class="asof-banner" role="note">
          <strong>As recorded on ${moment(d.version)}</strong>
          — ${changes ? `${changes} ${changes === 1 ? 'change' : 'changes'} since` : 'unchanged since'}
          · ${d.deleted || !d.current ? html`<span>this entry no longer exists</span>` : html`<a href="${d.current.path}">see the current version</a>`}
        </div>
        <h1>${name}</h1>
        ${texts.map(([, t]) => html`<div class="asof-text">${t}</div>`)}
        ${facts.length ? html`<dl class="facts">${facts.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>` : ''}
        ${d.provenance?.length ? html`<section class="provenance"><h2>Provenance</h2>
          <ol class="plain-list asof-provenance">${[...d.provenance].sort((a, b) => a.position - b.position).map(stepLine)}</ol></section>` : ''}
        ${d.relationships.length ? html`<section class="rel-group"><h2>Relationships</h2><ul class="rel-list">${d.relationships.map((r) => html`<li>
          <span class="rel-label">${r.reads}</span> ${netLink(r.other)}${r.period?.label ? html` <span class="muted">${r.period.label}</span>` : ''}
          ${r.certainty && r.certainty !== 'attested' ? html` <span class="tag">${r.certainty}</span>` : ''}${r.label ? html`<div class="rel-note">${r.label}</div>` : ''}
        </li>`)}</ul></section>` : ''}
        <p class="muted small">The stored record of that moment: texts are shown as entered (Markdown), entries named as they are now.</p>
      </article>`);
    })
    .catch((err) => {
      if (!current()) return;
      if (err instanceof ApiError && err.status === 404) {
        const first = typeof err.body?.first_recorded === 'string' ? err.body.first_recorded : null;
        const now = err.body?.current as { path?: string } | undefined;
        render(main, html`<section class="page"><h1>Not recorded yet then</h1>
          <p>This entry wasn't recorded at that moment${first ? html` — it was first recorded on ${moment(first)}` : ''}.</p>
          ${now?.path ? html`<p><a href="${now.path}">See the current version →</a></p>` : ''}</section>`);
      } else if (err instanceof ApiError && err.status === 400) {
        render(main, html`<section class="page"><h1>No such version</h1><p>${err.message}</p></section>`);
      } else showError(main, err);
    });
}
