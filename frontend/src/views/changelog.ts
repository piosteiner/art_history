// The changelog and the roadmap (API 118), in German (de-CH) as they are written in the CMS.
//   /changelog[?kind=neu|verbessert|behoben|inhalt|technik][&topic=<name>]   entries newest first, one per day or patch;
//                                a bullet's kind as a badge, its topic as a bubble in the roadmap's colours (137); chips
//                                filter by kind and by topic; more entries load as you scroll; RSS feed linked.
//                                Every entry has an anchor (#eintrag-<id>), which the feed links to.
//   /roadmap                     what is being worked on, what comes next, later, and what is done (with the day) —
//                                four columns side by side on wide screens; topics in their colour (136); a card shows
//                                title, topic and dates — a click opens its notes (<details>); done items only for the
//                                CMS's number of days
import { CHANGELOG_FEED, getChangelog, getRoadmap, type ChangeKind, type ChangelogEntry, type ChangelogTopic } from '../api';
import { html, render, trusted } from '../html';
import { replaceUrl } from '../router';
import { guard, showError } from './common';

const DAY = new Intl.DateTimeFormat('de-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const NUMERIC = new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });   // 24.10.2026: short cards
const day = (d: string, f = DAY) => f.format(new Date(`${d}T12:00:00Z`));
const KINDS: [ChangeKind, string][] = [['neu', 'Neu'], ['verbessert', 'Verbessert'], ['behoben', 'Behoben'], ['inhalt', 'Inhalt'], ['technik', 'Technik']];
const BATCH = 20;

const entryHtml = (e: ChangelogEntry) => html`<article class="cl-entry" id="eintrag-${String(e.id)}">
  <h2><a href="#eintrag-${String(e.id)}" class="cl-day">${day(e.day)}</a>${e.title ? html`<span class="cl-title"> · ${e.title}</span>` : ''}</h2>
  <ul class="cl-items">${e.items.map((i) => html`<li><span class="cl-kind cl-${i.kind}">${i.label}</span> <span class="cl-text">${i.area ? html`<span class="tag area area-${i.area_color || 'slate'}">${i.area}</span> ` : ''}${trusted(i.html)}</span>
    ${i.roadmap ? html` <a class="cl-roadmap muted small" href="/roadmap#punkt-${String(i.roadmap.id)}">Roadmap</a>` : ''}</li>`)}</ul></article>`;

export function changelogPage(main: HTMLElement, params: URLSearchParams) {
  document.title = 'Changelog · Art History';
  const asked = params.get('kind');
  let kind = (KINDS.some(([k]) => k === asked) ? asked : null) as ChangeKind | null;
  let topic = params.get('topic');
  let topics: ChangelogTopic[] = [];
  render(main, html`<section class="page changelog-page" lang="de-CH">
    <h1>Changelog</h1>
    <p class="muted">Was sich an dieser Website geändert hat – neue Funktionen, Verbesserungen, Korrekturen und neue Inhalte.
      Geplantes steht in der <a href="/roadmap">Roadmap</a>. <a href="${CHANGELOG_FEED}" class="cl-feed">RSS-Feed</a></p>
    <div class="chips cl-chips" role="group" aria-label="Nach Art filtern"></div>
    <div class="chips cl-topics" role="group" aria-label="Nach Thema filtern" hidden></div>
    <div class="cl-list"></div>
    <p class="muted small cl-more" aria-live="polite"></p>
  </section>`);
  const chips = main.querySelector<HTMLElement>('.cl-chips')!;
  const topicChips = main.querySelector<HTMLElement>('.cl-topics')!;
  const list = main.querySelector<HTMLElement>('.cl-list')!;
  const more = main.querySelector<HTMLElement>('.cl-more')!;
  const current = guard();
  let request = 0;
  let loaded = 0;
  let total = 0;
  let loading = false;

  const drawChips = () => render(chips, html`<button type="button" class="chip${kind ? '' : ' active'}" data-kind="" aria-pressed="${String(!kind)}">Alle</button>
    ${KINDS.map(([k, label]) => html`<button type="button" class="chip cl-chip-${k}${kind === k ? ' active' : ''}" data-kind="${k}" aria-pressed="${String(kind === k)}">${label}</button>`)}`);

  const address = () => {
    const q = new URLSearchParams();
    if (kind) q.set('kind', kind);
    if (topic) q.set('topic', topic);
    return `/changelog${q.size ? `?${q}` : ''}`;
  };
  // the topics in use, each a chip in its colour; the chosen one again = all topics
  const drawTopics = () => {
    topicChips.hidden = !topics.length;
    render(topicChips, html`<span class="muted small">Thema:</span>
      ${topics.map((t) => html`<button type="button" class="chip tag area area-${t.color}${topic === t.name ? ' active' : ''}" data-topic="${t.name}" aria-pressed="${String(topic === t.name)}">${t.name} <span class="muted">${String(t.n)}</span></button>`)}`);
  };

  async function load(first: boolean) {
    if (loading || (!first && loaded >= total)) return;
    loading = true;
    const mine = first ? ++request : request;
    if (first) { loaded = 0; render(list, html`<p class="muted small">Lädt…</p>`); }
    try {
      const res = await getChangelog({ kind, topic, limit: BATCH, offset: loaded });
      if (!current() || mine !== request) return;
      total = res.total;
      if (first && res.topics) { topics = res.topics; drawTopics(); }
      if (first) render(list, res.data.length ? html`` : html`<p class="muted">${kind || topic ? 'Keine Einträge dazu.' : 'Noch keine Einträge.'}</p>`);
      list.insertAdjacentHTML('beforeend', res.data.map((e) => String(entryHtml(e))).join(''));
      loaded += res.data.length;
      if (!res.data.length) total = loaded;
      if (first && location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
    } catch (err) {
      if (current() && mine === request) showError(first ? list : more, err);
    } finally {
      loading = false;
      if (current() && mine === request) {
        render(more, loaded < total ? html`${String(loaded)} von ${String(total)} Einträgen – weitere laden beim Scrollen` : html``);
        if (loaded < total && more.getBoundingClientRect().top < window.innerHeight + 400) void load(false);
      }
    }
  }
  const observer = new IntersectionObserver((seen) => { if (seen.some((x) => x.isIntersecting)) void load(false); }, { rootMargin: '400px' });
  observer.observe(more);
  chips.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('button[data-kind]');
    if (!b) return;
    kind = (b.dataset.kind || null) as ChangeKind | null;
    replaceUrl(address());
    drawChips();
    void load(true);
  });
  topicChips.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('button[data-topic]');
    if (!b) return;
    topic = topic === b.dataset.topic ? null : b.dataset.topic!;
    replaceUrl(address());
    drawTopics();
    void load(true);
  });
  drawChips();
  void load(true);
  return () => observer.disconnect();
}

export function roadmapPage(main: HTMLElement) {
  document.title = 'Roadmap · Art History';
  render(main, html`<section class="page roadmap-page" lang="de-CH"><h1>Roadmap</h1><p class="muted small">Lädt…</p></section>`);
  const box = main.querySelector<HTMLElement>('section')!;
  const current = guard();
  getRoadmap()
    .then(({ columns, done_days: doneDays }) => {
      if (!current()) return;
      render(box, html`<h1>Roadmap</h1>
        <p class="muted">Woran ich gerade arbeite, was als Nächstes kommt und was später. Was fertig ist, steht auch im
          <a href="/changelog">Changelog</a>${doneDays !== undefined ? ` – unter „Erledigt“ bleibt es ${String(doneDays)} Tage lang` : ''}.</p>
        <div class="roadmap-board">${columns.map((c) => html`<section class="roadmap-col roadmap-${c.status}" aria-labelledby="rm-${c.status}">
          <h2 id="rm-${c.status}">${c.label} <span class="muted small">${String(c.items.length)}</span></h2>
          ${c.items.length ? html`<ul class="roadmap-items">${c.items.map((i) => {
            const head = html`<b>${i.title}</b>${i.area ? html` <span class="tag area area-${i.area_color || 'slate'}">${i.area}</span>` : ''}
              <span class="roadmap-dates muted small">${[i.added_on ? `aufgenommen ${day(i.added_on, NUMERIC)}` : '', i.done_on ? `erledigt ${day(i.done_on, NUMERIC)}` : ''].filter(Boolean).join(' · ')}</span>`;
            // with notes: the card opens and closes on a click (and Enter / Space); without: just the head
            return html`<li class="roadmap-item" id="punkt-${String(i.id)}">${i.notes_html
              ? html`<details class="roadmap-card"><summary title="Klicken für die Beschreibung">${head}</summary><div class="roadmap-notes">${trusted(i.notes_html)}</div></details>`
              : head}</li>`;
          })}</ul>`
          : html`<p class="muted small">Nichts.</p>`}</section>`)}</div>`);
      // a link to one item (#punkt-12): that card open — also when only the anchor changes on this page
      const openTarget = () => {
        const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
        target?.querySelector('details')?.setAttribute('open', '');
        target?.scrollIntoView();
      };
      openTarget();
      const onHash = () => (current() ? openTarget() : window.removeEventListener('hashchange', onHash));
      window.addEventListener('hashchange', onHash);
    })
    .catch((err) => { if (current()) showError(box, err); });
}
