// Study sets (owner 2026-11-04; backend routes/site-sets.js, src/study.js, migrations 218/219): an account's own lists
// of entries of any type, to keep for reference and to learn — and to share.
//   /sets                    the account's sets by topic: create (name, topic), open, delete
//   /sets/<id>               one set: its entries (removed with ×), name, topic, description (Markdown, md-editor.ts),
//                            sharing, the account's results, "Study"
//   /sets/<id>/study?mode=…  a round of a quiz on it
//   /sets/shared             the public sets of every account, by topic
//   /sets/s/<code>           a set shared by link or in public — anyone may look and learn; logged in: "Save a copy",
//   /sets/s/<code>/study       and the round counts among the account's results (never the owner's)
//   /sets/join/<code>        an invitation to edit a set together (220): logged in with a public name → one of its editors
// Edited together (220): the owner and its editors change name, topic, description and entries (who changed it last,
// who added an entry is shown); sharing, the editors and deleting stay the owner's. A save from an older version of a
// field someone else changed meanwhile is refused (409) — their version is shown, yours stays in the form.
// Exam date (220): per account and set; the set page counts the days and plans the day's cards — ?cards=today in the
// study view: the cards due again (Leitner intervals, shortened before the exam) and today's share of the new ones.
// Kinds of quiz (mode):
//   forward  "Name it"      what it is → its name: an artwork's picture → title, artist, date; a term's definition →
//                           the term; an artist's dates and places (and portrait) → the name. The name is blanked out.
//   reverse  "Describe it"  its name → what it is: the picture, the facts, the definition
//   both     both directions, mixed
//   typed    "Type it"      as Name it, the name typed and checked (quiz-match.ts: a typo still counts)
//   choice   "Pick it"      as Name it, the name picked among four of the set (the same type first)
// Each answer moves the card's Leitner box (1–5, per account, entry and direction; typed and picked answers count for
// "Name it"): the low boxes come first; a card not known comes back once at the end of the round. Every round is kept
// with its result (per set and kind of quiz: the set page's "Your results"); visitors learn too, nothing is kept.
import { account } from '../account';
import {
  answerCard, ApiError, copySet, createSet, decideRemoval, deleteSet, editSetEditors, getCards, getInvitation, getPublicSets, getSet, getSetHistory, getSets, getSetStats, joinSet,
  leaveSet, lockSet, loginUrl, previewDescription, proposeRemoval, recordRound, removeFromSet, restoreSet, savePlan, shareSet, updateSet, voteRemoval,
  type SetEvent, type SetRef, type StudyCard, type StudyItem, type StudyMode, type StudyPlan, type StudySet, type StudyStats,
} from '../api';
import { accountLinks } from './account';
import { href, html, PLURAL_LABEL, render, thumb, trusted, TYPE_LABEL, type Html } from '../html';
import { PLURAL } from '../api';
import { markdownEditor } from '../md-editor';
import { bestMatch, points } from '../quiz-match';

type Dir = 'forward' | 'reverse';
export interface SetsRoute { id: string | null; code: string | null; study: boolean; browse: boolean; join: string | null; params: URLSearchParams }

const MODE_NAME: Record<StudyMode, string> = { forward: 'Name it', reverse: 'Describe it', both: 'Name it and describe it', typed: 'Type it', choice: 'Pick it' };
const MODE_HELP: Record<StudyMode, string> = {
  forward: 'picture, definition, facts → the name — you judge yourself',
  reverse: 'the name → picture, facts, definition — you judge yourself',
  both: 'both directions, mixed',
  typed: 'type the name — a small typo still counts',
  choice: 'pick the name among four of this set',
};
const MODES: StudyMode[] = ['forward', 'reverse', 'both', 'typed', 'choice'];
const CHOICE_MIN = 4;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;
const studyHref = (ref: SetRef) => ('own' in ref ? `/sets/${ref.own}/study` : `/sets/s/${ref.code}/study`);
const pageHref = (ref: SetRef) => ('own' in ref ? `/sets/${ref.own}` : `/sets/s/${ref.code}`);
const shareUrl = (code: string) => `${location.origin}/sets/s/${code}`;
const VIS_LABEL = { private: 'Only you', link: 'Anyone with the link', public: 'Public' } as const;
const joinUrl = (code: string) => `${location.origin}/sets/join/${code}`;
/** "in 12 days" / "tomorrow" / "today" / "was 3 days ago" — an exam date from the plan's days left */
const examIn = (days: number) => (days > 1 ? `in ${String(days)} days` : days === 1 ? 'tomorrow' : days === 0 ? 'today' : `was ${String(-days)} day${days === -1 ? '' : 's'} ago`);
const longDay = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Leaving the page (another route): the round in progress is still recorded. */
let leave: (() => void) | null = null;

export function setsPage(main: HTMLElement, route: SetsRoute) {
  document.title = 'Study sets · Art History';
  render(main, html`<section class="page sets-page"><p class="muted">Loading…</p></section>`);
  if (route.join) joinView(main, route.join);
  else if (route.browse) browse(main, route.params);
  else if (route.code) {
    const ref = { code: route.code };
    if (route.study) studyView(main, ref, route.params); else one(main, ref);
  } else {
    account().then((name) => {
      if (!name) return loggedOut(main);
      if (!route.id) return list(main);
      const ref = { own: route.id };
      return route.study ? studyView(main, ref, route.params) : one(main, ref);
    });
  }
  return () => { leave?.(); leave = null; };
}

const loginLink = (text = 'Log in') => {
  const next = new URL(location.href);
  next.searchParams.set('login', '1');
  const login = loginUrl(next.href);
  return login ? html`<a href="${login}" rel="nofollow">${text}</a>` : null;
};
function loggedOut(main: HTMLElement) {
  render(main, html`<section class="page sets-page"><h1>Study sets</h1>
    <p>Keep artworks, artists, terms, places … from this site in sets of your own — to look them up again, or to learn them
      as index cards for an exam (with a plan for each day until it) — share them, and edit them together with others.</p>
    <p class="sets-account-links">…</p>
    <p><a href="/sets/shared">Browse the sets others have shared →</a></p></section>`);
  accountLinks().then((links) => { const p = main.querySelector('.sets-account-links'); if (p) render(p, links); }).catch(() => {});
}
const failed = (main: HTMLElement, what: string) => render(main, html`<section class="page sets-page"><p class="flash">${what} <a href="/sets">Study sets</a></p></section>`);

/** "Topic · by X · created … · last changed … · n entries" */
function meta(set: StudySet, withCreator: boolean) {
  const parts: (Html | string)[] = [];
  if (set.topic) parts.push(html`<span class="sets-topic">${set.topic}</span>`);
  if (withCreator && set.creator) parts.push(html`by <b>${set.creator}</b>`);
  parts.push(`created ${day(set.created_at)}`);
  if (day(set.updated_at) !== day(set.created_at) || set.updated_by) parts.push(`last changed ${day(set.updated_at)}${set.updated_by && set.editors?.length ? ` by ${set.updated_by}` : ''}`);
  parts.push(plural(set.count, 'entry', 'entries'));
  return html`<p class="sets-meta muted small">${parts.map((p, i) => html`${i ? ' · ' : ''}${p}`)}</p>`;
}
const visBadge = (set: StudySet) => (set.visibility === 'private' ? ''
  : html` <span class="tag sets-vis sets-vis-${set.visibility}" title="${VIS_LABEL[set.visibility]}">${set.visibility === 'public' ? 'public' : 'shared by link'}</span>`);
/** "with 2 editors" (the owner's) / "edited with Ms X" (an editor's) */
const together = (s: StudySet) => (s.role === 'editor' ? html` <span class="tag sets-together-tag" title="You edit it with its owner">edited with ${s.creator ?? 'its owner'}</span>`
  : (s.editor_count ?? s.editors?.length) ? html` <span class="tag sets-together-tag" title="Others edit it with you">${plural(s.editor_count ?? s.editors!.length, 'editor')}</span>` : '');
const topicOptions = (topics: string[]) => html`${topics.map((t) => html`<option value="${t}"></option>`)}`;

// ---- the account's sets -----------------------------------------------------------------------------------------
function list(main: HTMLElement) {
  getSets().then((r) => {
    if (!r) return loggedOut(main);
    const { sets, topics } = r;
    const byTopic = new Map<string, StudySet[]>();
    for (const s of sets) { const k = s.topic ?? ''; if (!byTopic.has(k)) byTopic.set(k, []); byTopic.get(k)!.push(s); }
    const groups = [...byTopic.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    const welcome = new URLSearchParams(location.search).get('welcome') === '1';
    render(main, html`<section class="page sets-page">${welcome ? html`<p class="flash ok">Welcome — your account is ready. Your settings: <a href="/account">Your account</a>.</p>` : ''}<h1>Your study sets</h1>
      <p class="muted">Your own lists of entries — only you see them unless you share one. Add an entry with <b>+ Set</b>
        on its page; learn a set with <b>Study</b>. <a href="/sets/shared">Browse shared sets →</a></p>
      <form class="sets-new">
        <input name="name" placeholder="Name of a new set — e.g. Exam: Japanese art" aria-label="Name of a new set" maxlength="120" required>
        <input name="topic" placeholder="Topic (optional)" aria-label="Topic" maxlength="80" list="sets-topics" autocomplete="off">
        <button type="submit">Create</button><datalist id="sets-topics">${topicOptions(topics)}</datalist></form>
      <p class="sets-msg small" role="status"></p>
      ${sets.some((s) => s.to_vote) ? html`<p class="flash sets-votes-waiting">Removals proposed in your sets wait for your vote:
        ${sets.filter((s) => s.to_vote).map((s, i) => html`${i ? ' · ' : ''}<a href="/sets/${s.id!}#sets-proposals">${s.name}</a> <span class="muted">(${String(s.to_vote)})</span>`)}</p>` : ''}
      ${sets.length ? groups.map(([topic, list]) => html`<section class="sets-group">${groups.length > 1 || topic ? html`<h2>${topic || 'No topic'}</h2>` : ''}
        <ul class="sets-list">${list.map((s) => html`<li class="sets-item">
          <a class="sets-name" href="/sets/${s.id!}">${s.name}</a>${visBadge(s)}${together(s)}${s.locked_at ? html` <span class="tag" title="The owner locked it: no changes by its editors">locked</span>` : ''}${s.proposals ? html` <a class="tag sets-proposal-tag" href="/sets/${s.id!}#sets-proposals" title="Entries proposed for removal">${plural(s.proposals, 'removal')} proposed</a>` : ''}${s.exam_on ? html` <span class="tag sets-exam" title="Your exam date">exam ${longDay(s.exam_on)}</span>` : ''}
          <span class="muted small">${plural(s.count, 'entry', 'entries')} · changed ${day(s.updated_at)}${s.description_text ? html` · ${s.description_text}` : ''}</span>
          <span class="sets-actions">${s.count ? html`<a class="button-link" href="/sets/${s.id!}/study">Study</a>` : ''}
            ${s.role === 'editor' ? '' : html`<button type="button" class="link-button sets-delete" data-id="${s.id!}" data-name="${s.name}">Delete</button>`}</span></li>`)}</ul></section>`)
        : html`<p class="muted">No sets yet.</p>`}
    </section>`);
    const msg = main.querySelector<HTMLElement>('.sets-msg')!;
    main.querySelector<HTMLFormElement>('.sets-new')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const val = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value.trim();
      createSet(val('name'), val('topic')).then((set) => { if (set) location.assign(`/sets/${set.id!}`); }).catch((err: Error) => { msg.textContent = err.message; });
    });
    main.querySelectorAll<HTMLButtonElement>('.sets-delete').forEach((b) => b.addEventListener('click', () => {
      if (!confirm(`Delete the set “${b.dataset.name}”? Its entries stay on the site; what you know of them stays too. A shared link stops working.`)) return;
      deleteSet(b.dataset.id!).then(() => list(main)).catch((err: Error) => { msg.textContent = err.message; });
    }));
  }).catch(() => failed(main, 'Your sets could not be loaded.'));
}

// ---- the public sets ---------------------------------------------------------------------------------------------
function browse(main: HTMLElement, params: URLSearchParams) {
  const topic = params.get('topic') ?? '';
  const q = params.get('q') ?? '';
  document.title = 'Shared study sets · Art History';
  getPublicSets(topic, q).then((r) => {
    const sets = r?.sets ?? [];
    const topics = r?.topics ?? [];
    const chip = (t: string, label: string, n?: number) => {
      const p = new URLSearchParams(); if (t) p.set('topic', t); if (q) p.set('q', q);
      const qs = p.toString();
      return html`<a class="chip${t === topic ? ' chip-on' : ''}" href="/sets/shared${qs ? `?${qs}` : ''}">${label}${n ? html` <span class="muted">${String(n)}</span>` : ''}</a>`;
    };
    render(main, html`<section class="page sets-page"><p class="crumbs"><a href="/sets">Study sets</a> / Shared</p>
      <h1>Shared study sets</h1>
      <p class="muted">Sets others have made public — look, learn them as index cards, or save a copy among your own.</p>
      <form class="sets-search" action="/sets/shared">${topic ? html`<input type="hidden" name="topic" value="${topic}">` : ''}
        <input type="search" name="q" value="${q}" placeholder="Search names, topics, descriptions" aria-label="Search shared sets"><button type="submit">Search</button></form>
      ${topics.length ? html`<p class="sets-topics">${chip('', 'All topics')} ${topics.map((t) => html`${chip(t.topic, t.topic, t.count)} `)}</p>` : ''}
      ${sets.length ? html`<ul class="sets-list">${sets.map((s) => html`<li class="sets-item">
          <a class="sets-name" href="/sets/s/${s.code!}">${s.name}</a>
          <span class="muted small">${s.topic ? html`<span class="sets-topic">${s.topic}</span> · ` : ''}by ${s.creator ?? '—'} · ${plural(s.count, 'entry', 'entries')} · changed ${day(s.updated_at)}</span>
          ${s.description_text ? html`<span class="small">${s.description_text}</span>` : ''}
          <span class="sets-actions">${s.count ? html`<a class="button-link" href="/sets/s/${s.code!}/study">Study</a>` : ''}</span></li>`)}</ul>`
        : html`<p class="muted">${r ? (topic || q ? 'No public set matches.' : 'No set has been made public yet.') : 'Shared sets cannot be shown here.'}</p>`}
    </section>`);
  }).catch(() => failed(main, 'The shared sets could not be loaded.'));
}

// ---- one set (own or shared) ------------------------------------------------------------------------------------
const itemPicture = (i: StudyItem) => (i.image
  ? html`<img class="sets-thumb${i.own ? ' own-image' : ''}" src="${i.own ? i.image : thumb(i.image, 120)}" alt="" loading="lazy"${i.own ? '' : html` crossorigin="anonymous"`}>`
  : html`<span class="sets-thumb sets-thumb-empty" aria-hidden="true"></span>`);

function studyForm(ref: SetRef, count: number, learner: boolean) {
  if (!count) return html`<p class="muted">Nothing in it yet — add entries with <b>+ Set</b> on their pages.</p>`;
  const modes = MODES.filter((m) => m !== 'choice' || count >= CHOICE_MIN);
  return html`<form class="sets-study" action="${studyHref(ref)}">
    <span>Study the ${plural(count, 'entry', 'entries')}:</span>
    ${modes.map((m, i) => html`<label><input type="radio" name="mode" value="${m}"${i ? '' : ' checked'}> ${MODE_NAME[m]} <span class="muted small">(${MODE_HELP[m]})</span></label>`)}
    <fieldset class="sets-cards-choice"><legend class="small">Which cards</legend>
      <label><input type="radio" name="cards" value="all" checked> All</label>
      ${learner ? html`<label><input type="radio" name="cards" value="today"> Today's <span class="muted small sets-today-count"></span></label>` : ''}
      <label><input type="radio" name="cards" value="weak"> Leave out those you know well</label></fieldset>
    <button type="submit">Study</button></form>`;
}

/** The exam date and the day's plan (logged in): set, changed, removed; per kind of card the cards due today. */
function planBox(box: HTMLElement, ref: SetRef, plan: StudyPlan, onChange: (p: StudyPlan) => void) {
  const f = plan.directions.forward;
  const r = plan.directions.reverse;
  const todayOf = (d?: { due: number; new_left_today: number }) => (d ? d.due + d.new_left_today : 0);
  const line = (label: string, d?: { due: number; new: number; new_left_today: number }) => (d
    ? html`<li><b>${label}</b>: ${plural(d.due, 'card')} to review${d.new_left_today ? html` + ${String(d.new_left_today)} new` : ''}${d.new ? html` <span class="muted small">(${String(d.new)} not asked yet)</span>` : ''}</li>` : '');
  const exam = plan.exam_on && plan.days_left !== null;
  render(box, html`<h2>${exam ? html`Exam ${examIn(plan.days_left!)}` : 'Today'}</h2>
    ${exam ? html`<p class="muted small">${longDay(plan.exam_on!)} — every card comes round again before it; the new ones are spread over the days until then.</p>` : ''}
    <ul class="sets-plan-today">${line('Name it', f)}${line('Describe it', r)}</ul>
    ${todayOf(f) + todayOf(r) === 0 ? html`<p class="small">Nothing due today${exam ? '' : ' — or set an exam date and the plan fits it'}. </p>` : ''}
    <form class="sets-exam-form"><label>Exam date <input type="date" name="exam_on" value="${plan.exam_on ?? ''}" min="${new Date().toISOString().slice(0, 10)}"></label>
      <button type="submit">${plan.exam_on ? 'Change' : 'Set'}</button>${plan.exam_on ? html` <button type="button" class="link-button sets-exam-remove">Remove</button>` : ''}
      <span class="sets-exam-msg small" role="status"></span></form>
    <p class="muted small">Only you see your exam date and plan.</p>`);
  const save = (value: string) => savePlan(ref, value).then((p) => { if (p) { planBox(box, ref, p, onChange); onChange(p); } })
    .catch((err: Error) => { box.querySelector('.sets-exam-msg')!.textContent = err.message; });
  box.querySelector('form')!.addEventListener('submit', (e) => { e.preventDefault(); save((box.querySelector('input[name=exam_on]') as HTMLInputElement).value); });
  box.querySelector('.sets-exam-remove')?.addEventListener('click', () => save(''));
}

function one(main: HTMLElement, ref: SetRef) {
  Promise.all([getSet(ref), account()]).then(([r, me]) => {
    if (!r) return 'own' in ref ? loggedOut(main) : failed(main, 'This set is not shared (any more).');
    const { set, items } = r;
    const proposals = r.proposals ?? [];
    const own = 'own' in ref;
    const owner = own && (set.role ?? 'owner') === 'owner';
    const locked = Boolean(set.locked_at);
    const editor = own && !owner;
    const proposed = new Set(proposals.map((p) => `${p.type}/${p.slug}`));
    if (!own && set.mine && set.id) { location.replace(`/sets/${set.id}`); return; }   // the owner's own page
    document.title = `${set.name} · Study sets · Art History`;
    const byType = new Map<string, StudyItem[]>();
    for (const i of items) { if (!byType.has(i.type)) byType.set(i.type, []); byType.get(i.type)!.push(i); }
    const crumbs = own ? html`<a href="/sets">Your study sets</a>` : html`<a href="/sets/shared">Shared sets</a>`;
    render(main, html`<section class="page sets-page">
      <p class="crumbs">${crumbs} / ${set.name}</p>
      <h1>${set.name}${own ? visBadge(set) : ''}${own ? together(set) : ''}${own && locked ? html` <span class="tag" title="Its editors read and study it but change nothing">locked</span>` : ''}</h1>
      ${meta(set, !owner)}
      ${editor && locked ? html`<p class="flash">The owner has locked this set: you can study it, but not change it.</p>` : ''}
      ${set.description_html ? html`<div class="prose sets-description">${trusted(set.description_html)}</div>` : ''}
      ${own && set.copied_from ? html`<p class="muted small">A copy of <a href="/sets/s/${set.copied_from.code}">${set.copied_from.name}</a>${set.copied_from.creator ? ` by ${set.copied_from.creator}` : ''}.</p>` : ''}
      ${own ? html`<div class="sets-tools">
        <details class="sets-edit"${editor && locked ? ' hidden' : ''}><summary class="link-button">Edit name, topic, description</summary>
          <form class="sets-edit-form"><p class="sets-conflict flash" hidden></p>
            <input type="hidden" name="base_name" value="${set.name}"><input type="hidden" name="base_topic" value="${set.topic ?? ''}">
            <textarea name="base_description" hidden>${set.description ?? ''}</textarea>
            <label>Name <input name="name" value="${set.name}" maxlength="120" required></label>
            <label>Topic <input name="topic" value="${set.topic ?? ''}" maxlength="80" list="sets-topics" autocomplete="off" placeholder="e.g. Japanese art"></label>
            <label class="sets-edit-desc"><span>Description</span>
              <textarea name="description" rows="7" maxlength="10000" placeholder="What it is for, what to look out for, notes for learning …">${set.description ?? ''}</textarea></label>
            <button type="submit">Save</button><datalist id="sets-topics"></datalist></form></details>
        ${owner ? html`<details class="sets-share"><summary class="link-button">Share…</summary><div class="sets-share-body"></div></details>` : ''}
        <details class="sets-together"><summary class="link-button">${owner ? 'Edit together…' : 'Edited together'}</summary><div class="sets-together-body"></div></details>
        ${owner ? html`<button type="button" class="link-button sets-lock" title="${locked ? 'Its editors may change it again' : 'Its editors can still study it, but change nothing'}">${locked ? 'Unlock' : 'Lock'}</button>` : ''}
        <details class="sets-history"><summary class="link-button">History</summary><div class="sets-history-body"></div></details></div>`
        : html`<p class="sets-tools">${me ? html`<button type="button" class="sets-copy">Save a copy to your sets</button>`
          : html`<span class="muted small">${loginLink() ?? 'Log in'} to keep track of what you know and to save a copy.</span>`}</p>`}
      ${me ? html`<section class="sets-plan" aria-label="Your plan"></section>` : ''}
      ${studyForm(ref, items.length, Boolean(me))}
      <p class="sets-msg small" role="status"></p>
      ${me ? html`<section class="sets-stats" aria-label="Your results"></section>` : ''}
      ${own && proposals.length ? html`<section class="sets-proposals" id="sets-proposals"><h2>Proposed removals <span class="muted">${String(proposals.length)}</span></h2>
        <p class="muted small">${owner ? 'Your editors propose and vote; you decide — whenever you like, whatever the votes.' : 'Vote whether these entries should go; the owner decides.'}</p>
        <ul class="sets-proposal-list">${proposals.map((p) => {
          const remove = p.votes.filter((v) => v.remove).length;
          const keep = p.votes.length - remove;
          return html`<li class="sets-proposal" data-id="${p.id}">
            <a href="${href(PLURAL[p.type], p.slug)}">${p.name}</a> <span class="muted small">${TYPE_LABEL[p.type]}${p.added_by ? ` · added by ${p.added_by}` : ''} · proposed by ${p.proposed_by ?? '—'} ${day(p.created_at)}</span>
            ${p.reason ? html`<q class="sets-proposal-reason">${p.reason}</q>` : ''}
            <span class="sets-votes" title="${p.votes.map((v) => `${v.by ?? '—'}: ${v.remove ? 'remove' : 'keep'}`).join(', ')}"><b>${String(remove)}</b> remove · <b>${String(keep)}</b> keep</span>
            ${locked ? '' : html`<span class="sets-vote">
              <button type="button" class="link-button${p.my_vote === true ? ' on' : ''}" data-vote="1" aria-pressed="${String(p.my_vote === true)}">Remove</button>
              <button type="button" class="link-button${p.my_vote === false ? ' on' : ''}" data-vote="0" aria-pressed="${String(p.my_vote === false)}">Keep</button></span>`}
            ${owner ? html`<span class="sets-decide"><button type="button" class="danger-outline" data-decide="removed">Remove it</button> <button type="button" class="secondary" data-decide="kept">Keep it</button></span>` : ''}</li>`;
        })}</ul></section>` : ''}
      ${[...byType.entries()].map(([type, list]) => html`<section class="sets-group"><h2>${PLURAL_LABEL[PLURAL[type as StudyItem['type']]]} <span class="muted">${String(list.length)}</span></h2>
        <ul class="sets-items">${list.map((i) => html`<li class="sets-entry">
          <a class="sets-entry-link" href="${href(PLURAL[i.type], i.slug)}">${itemPicture(i)}<span><span class="sets-entry-name">${i.name}</span>
            ${i.subtitle ? html`<span class="muted small">${i.subtitle}</span>` : ''}${i.added_by ? html`<span class="muted small sets-added-by">added by ${i.added_by}</span>` : ''}</span></a>
          ${!own || (editor && locked) ? '' : owner || i.mine
            ? html`<button type="button" class="link-button sets-remove" data-type="${i.type}" data-slug="${i.slug}" title="Remove from this set" aria-label="Remove ${i.name} from this set">×</button>`
            : proposed.has(`${i.type}/${i.slug}`) ? html`<a class="muted small" href="#sets-proposals">proposed</a>`
              : html`<button type="button" class="link-button sets-propose small" data-type="${i.type}" data-slug="${i.slug}" data-name="${i.name}" title="Someone else added it: propose its removal — the owner decides">Propose removal</button>`}</li>`)}</ul></section>`)}
    </section>`);
    const msg = main.querySelector<HTMLElement>('.sets-msg')!;
    const stats = main.querySelector<HTMLElement>('.sets-stats');
    const planEl = main.querySelector<HTMLElement>('.sets-plan');
    const todayCount = (p: StudyPlan) => {
      const n = (d?: { due: number; new_left_today: number }) => String(d ? d.due + d.new_left_today : 0);
      const el = main.querySelector('.sets-today-count');
      if (el) el.textContent = `(${n(p.directions.forward)} Name it · ${n(p.directions.reverse)} Describe it)`;
    };
    if (stats) {
      getSetStats(ref).then((s) => {
        if (!s) return;
        render(stats, results(s, set.count));
        if (planEl && s.plan && set.count) { planBox(planEl, ref, s.plan, todayCount); todayCount(s.plan); }
      }).catch(() => {});
    }
    if (!own) {
      main.querySelector('.sets-copy')?.addEventListener('click', () => {
        copySet((ref as { code: string }).code).then((c) => { if (c) location.assign(`/sets/${c.id}`); }).catch((err: Error) => { msg.textContent = err.message; });
      });
      return;
    }
    const id = ref.own;
    const editForm = main.querySelector<HTMLFormElement>('.sets-edit-form')!;
    markdownEditor(editForm.querySelector<HTMLTextAreaElement>('textarea[name=description]')!, previewDescription);
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = (n: string) => (editForm.elements.namedItem(n) as HTMLInputElement).value;
      const conflict = editForm.querySelector<HTMLElement>('.sets-conflict')!;
      updateSet(id, { name: val('name'), topic: val('topic'), description: val('description'), base_name: val('base_name'), base_topic: val('base_topic'), base_description: val('base_description') })
        .then(() => one(main, ref))
        .catch((err: Error) => {
          if (!(err instanceof ApiError && err.status === 409)) { msg.textContent = err.message; return; }
          // someone else changed it meanwhile: their version shown, yours kept in the form; Save again replaces theirs
          const now = (err.body?.set ?? null) as StudySet | null;
          if (!now) return;
          const set = (n: string, v: string) => { (editForm.elements.namedItem(n) as HTMLInputElement).value = v; };
          set('base_name', now.name); set('base_topic', now.topic ?? ''); set('base_description', now.description ?? '');
          conflict.hidden = false;
          render(conflict, html`<b>${now.updated_by ?? 'Someone'} changed this set meanwhile.</b> Their version is below — yours is still in the form:
            Save again to replace theirs, or copy what you need first.
            <span class="sets-conflict-theirs"><b>Name:</b> ${now.name}${now.topic ? html` · <b>Topic:</b> ${now.topic}` : ''}</span>
            ${now.description_html ? html`<span class="prose sets-conflict-theirs">${trusted(now.description_html)}</span>` : ''}`);
        });
    });
    main.querySelector('.sets-edit')!.addEventListener('toggle', () => {
      getSets().then((x) => { const dl = main.querySelector('#sets-topics'); if (x && dl) render(dl, topicOptions(x.topics)); }).catch(() => {});
    }, { once: true });
    if (owner) sharing(main.querySelector<HTMLElement>('.sets-share-body')!, set, id);
    editors(main.querySelector<HTMLElement>('.sets-together-body')!, set, id, owner);
    history(main.querySelector<HTMLDetailsElement>('.sets-history')!, id, owner, () => one(main, ref));
    main.querySelector('.sets-lock')?.addEventListener('click', () => {
      if (!locked && !confirm('Lock this set? Its editors can still study it, but change nothing until you unlock it.')) return;
      lockSet(id, !locked).then(() => one(main, ref)).catch((err: Error) => { msg.textContent = err.message; });
    });
    main.querySelectorAll<HTMLButtonElement>('.sets-propose').forEach((b) => b.addEventListener('click', () => {
      const reason = window.prompt(`Why should “${b.dataset.name}” go? (optional — the owner decides)`);
      if (reason === null) return;
      proposeRemoval(id, b.dataset.type as StudyItem['type'], b.dataset.slug!, reason).then(() => one(main, ref)).catch((err: Error) => { msg.textContent = err.message; });
    }));
    main.querySelectorAll<HTMLElement>('.sets-proposal').forEach((li) => {
      li.querySelectorAll<HTMLButtonElement>('[data-vote]').forEach((b) => b.addEventListener('click', () => {
        voteRemoval(id, li.dataset.id!, b.dataset.vote === '1').then(() => one(main, ref)).catch((err: Error) => { msg.textContent = err.message; });
      }));
      li.querySelectorAll<HTMLButtonElement>('[data-decide]').forEach((b) => b.addEventListener('click', () => {
        decideRemoval(id, li.dataset.id!, b.dataset.decide as 'removed' | 'kept').then(() => one(main, ref)).catch((err: Error) => { msg.textContent = err.message; });
      }));
    });
    if (location.hash === '#sets-proposals') main.querySelector('#sets-proposals')?.scrollIntoView();
    main.querySelectorAll<HTMLButtonElement>('.sets-remove').forEach((b) => b.addEventListener('click', () => {
      removeFromSet(id, b.dataset.type as StudyItem['type'], b.dataset.slug!).then(() => one(main, ref)).catch((err: Error) => { msg.textContent = err.message; });
    }));
  }).catch(() => failed(main, 'This set could not be loaded.'));
}

const WHAT: Record<SetEvent['action'], string> = { created: 'created the set', changed: 'changed the', added: 'added', removed: 'removed', restored: 'restored the set to', locked: 'locked the set', unlocked: 'unlocked the set' };
const at = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** A set's history (221), loaded when opened: who changed what, newest first; the owner restores the set to any step. */
function history(details: HTMLDetailsElement, id: string, owner: boolean, reload: () => void) {
  const box = details.querySelector<HTMLElement>('.sets-history-body')!;
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    getSetHistory(id).then((r) => {
      if (!r) return;
      const ev = r.events;
      const entry = (e: SetEvent) => (e.entry ? html`<a href="${href(PLURAL[e.entry.type], e.entry.slug)}">${e.entry.name}</a>` : html`<span class="muted">an entry since deleted</span>`);
      const what = (e: SetEvent) => (e.action === 'changed' ? html`${WHAT.changed} ${e.field}${e.field === 'description' ? '' : html`: <s class="muted">${e.old ?? '—'}</s> → ${e.new ?? '—'}`}`
        : e.action === 'added' || e.action === 'removed' ? html`${WHAT[e.action]} ${entry(e)}`
          : e.action === 'restored' ? html`${WHAT.restored} ${e.detail?.to ? at(e.detail.to) : '?'} <span class="muted small">(${String(e.detail?.removed ?? 0)} removed, ${String(e.detail?.added ?? 0)} back${e.detail?.reason ? ` · ${e.detail.reason}` : ''})</span>`
            : WHAT[e.action]);
      render(box, html`<p class="muted small">${owner ? 'Every change, newest first. “Back to here” makes the set as it was right after that step — the restore is a step too, so it can be undone.' : 'Every change, newest first. The owner can bring the set back to any step.'}
        ${ev.some((e) => e.seeded) ? ' Changes before 5 November 2026 are not recorded; entries added before then are.' : ''}</p>
        <ol class="sets-history-list">${ev.map((e, i) => html`<li><span class="muted small">${at(e.at)}</span> <b>${e.by ?? '—'}</b> ${what(e)}
          ${owner && i > 0 ? html`<button type="button" class="link-button small sets-restore" data-event="${e.id}" data-at="${e.at}">Back to here</button>` : ''}</li>`)}</ol>
        ${r.more ? html`<p class="muted small">The 1000 most recent steps.</p>` : ''}<p class="sets-history-msg small" role="status"></p>`);
      box.querySelectorAll<HTMLButtonElement>('.sets-restore').forEach((b) => b.addEventListener('click', () => {
        if (!confirm(`Make the set as it was on ${at(b.dataset.at!)}? Entries added since go, entries removed since come back. You can undo this the same way.`)) return;
        restoreSet(id, b.dataset.event!).then(() => reload()).catch((err: Error) => { box.querySelector('.sets-history-msg')!.textContent = err.message; });
      }));
    }).catch(() => render(box, html`<p class="muted">The history could not be loaded.</p>`));
  });
}

/** Sharing a set: who sees it, the name shown, the link (copied; "New link" ends the old one). */
function sharing(box: HTMLElement, set: StudySet, id: string) {
  let publicName: string | null = null;
  const draw = (note = '') => {
    render(box, html`<form class="sets-share-form">
      <fieldset><legend>Who can see it</legend>
        ${(['private', 'link', 'public'] as const).map((v) => html`<label><input type="radio" name="visibility" value="${v}"${set.visibility === v ? ' checked' : ''}> ${VIS_LABEL[v]}
          <span class="muted small">${v === 'private' ? '' : v === 'link' ? '— not listed; only who gets the link' : '— also listed under Shared sets'}</span></label>`)}</fieldset>
      <label>Shown as <input name="public_name" value="${publicName ?? ''}" maxlength="60" placeholder="Your name on shared sets" autocomplete="nickname">
        <span class="muted small">— not your login name; the same on all your shared sets</span></label>
      <button type="submit">Save</button>
      ${set.visibility !== 'private' && set.code ? html`<p class="sets-share-link"><input readonly value="${shareUrl(set.code)}" aria-label="Link to this set">
        <button type="button" class="sets-share-copy">Copy link</button> <button type="button" class="link-button sets-share-new" title="The old link stops working">New link</button>
        <button type="button" class="link-button sets-share-off" title="The link stops working for good; shared again, the set gets a new one">Turn the link off</button></p>` : ''}
      <p class="muted small">Others see the name, topic, description, entries, your public name and the dates — never your results.</p>
      <p class="sets-share-msg small" role="status">${note}</p></form>`);
    const form = box.querySelector<HTMLFormElement>('form')!;
    const msg = box.querySelector<HTMLElement>('.sets-share-msg')!;
    const save = (data: Parameters<typeof shareSet>[1], done: string) => shareSet(id, data).then((r) => {
      if (!r) return;
      Object.assign(set, { visibility: r.set.visibility, code: r.set.code });
      publicName = r.public_name;
      draw(done);
      const h1 = document.querySelector('.sets-page h1');
      if (h1) render(h1, html`${set.name}${visBadge(set)}${together(set)}`);
    }).catch((err: Error) => { msg.textContent = err.message; });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const visibility = (form.elements.namedItem('visibility') as RadioNodeList).value as StudySet['visibility'];
      save({ visibility, public_name: (form.elements.namedItem('public_name') as HTMLInputElement).value }, visibility === 'private' ? 'Only you see it now.' : 'Shared.');
    });
    box.querySelector('.sets-share-copy')?.addEventListener('click', () => {
      const input = box.querySelector<HTMLInputElement>('.sets-share-link input')!;
      navigator.clipboard?.writeText(input.value).then(() => { msg.textContent = 'Link copied.'; }, () => { input.select(); });
    });
    box.querySelector('.sets-share-off')?.addEventListener('click', () => {
      if (confirm('Turn the link off? It stops working for everyone who has it; only you see the set. Shared again, it gets a new link.')) save({ visibility: 'private' }, 'The link is off — only you see the set.');
    });
    box.querySelector('.sets-share-new')?.addEventListener('click', () => {
      if (confirm('Make a new link? The old one stops working.')) save({ new_link: '1' }, 'New link made — the old one no longer works.');
    });
  };
  getSets().then((r) => { publicName = r?.public_name ?? null; draw(); }).catch(() => draw());
}

/** Editing together: the owner's invitation link (copied; a new one ends the old; stop), the editors (removed with ×);
 *  an editor sees who else edits it and can leave. */
function editors(box: HTMLElement, set: StudySet, id: string, owner: boolean) {
  const draw = (note = '') => {
    const list = set.editors ?? [];
    render(box, html`<div class="sets-together-form">
      <p class="small">${owner ? 'Those you invite change the name, topic, description and entries with you; sharing, the editors and deleting stay yours. Each keeps their own progress, results and exam date.'
        : html`You edit this set with its owner <b>${set.creator ?? '—'}</b>. Sharing and deleting it are theirs; your progress and results are your own.`}</p>
      ${list.length ? html`<ul class="sets-editors">${list.map((e) => html`<li>${e.name ?? '—'}${e.me ? html` <span class="muted small">(you)</span>` : ''}
        ${owner ? html`<button type="button" class="link-button sets-editor-remove" data-id="${e.id}" aria-label="Remove ${e.name ?? 'this editor'}" title="Remove from the editors">×</button>` : ''}</li>`)}</ul>`
        : html`<p class="muted small">No one else edits it yet.</p>`}
      ${owner ? (set.edit_code
        ? html`<p class="sets-share-link"><input readonly value="${joinUrl(set.edit_code)}" aria-label="Invitation link">
            <button type="button" class="sets-invite-copy">Copy link</button> <button type="button" class="link-button sets-invite-new" title="The old link stops working">New link</button>
            <button type="button" class="link-button sets-invite-stop">Stop inviting</button></p>
          <p class="muted small">Anyone with this link and an account can join as an editor — send it only to those you mean. Editors who joined stay until you remove them.</p>`
        : html`<p><label class="sets-invite-name">Your public name (the editors see it) <input name="public_name" maxlength="60" autocomplete="nickname"></label>
            <button type="button" class="sets-invite">Make an invitation link</button></p>`)
        : html`<p><button type="button" class="link-button sets-leave">Leave this set</button></p>`}
      <p class="sets-together-msg small" role="status">${note}</p></div>`);
    const msg = box.querySelector<HTMLElement>('.sets-together-msg')!;
    const act = (data: Parameters<typeof editSetEditors>[1], done: string) => editSetEditors(id, data).then((s) => {
      if (s) Object.assign(set, { edit_code: s.edit_code, editors: s.editors });
      draw(done);
    }).catch((err: Error) => { msg.textContent = err.message; });
    box.querySelector('.sets-invite')?.addEventListener('click', () => act({ action: 'invite', public_name: (box.querySelector('input[name=public_name]') as HTMLInputElement).value }, 'Invitation link made — copy it and send it.'));
    box.querySelector('.sets-invite-new')?.addEventListener('click', () => { if (confirm('Make a new invitation link? The old one stops working (editors who joined stay).')) void act({ action: 'invite' }, 'New link made.'); });
    box.querySelector('.sets-invite-stop')?.addEventListener('click', () => act({ action: 'stop' }, 'No one can join any more; the editors stay.'));
    box.querySelector('.sets-invite-copy')?.addEventListener('click', () => {
      const input = box.querySelector<HTMLInputElement>('.sets-share-link input')!;
      navigator.clipboard?.writeText(input.value).then(() => { msg.textContent = 'Link copied.'; }, () => { input.select(); });
    });
    box.querySelectorAll<HTMLButtonElement>('.sets-editor-remove').forEach((b) => b.addEventListener('click', () => act({ action: 'remove', account: b.dataset.id! }, 'Removed.')));
    box.querySelector('.sets-leave')?.addEventListener('click', () => {
      if (!confirm('Leave this set? It goes from your sets; the owner can invite you again.')) return;
      leaveSet(id).then(() => location.assign('/sets')).catch((err: Error) => { msg.textContent = err.message; });
    });
  };
  // the owner's public name: asked only when an invitation is made and none is set yet
  getSets().then((r) => { draw(); if (r?.public_name) box.querySelector('.sets-invite-name')?.remove(); }).catch(() => draw());
}

/** /sets/join/<code>: what the invitation is for; logged in → join (a public name first if none). */
function joinView(main: HTMLElement, code: string) {
  document.title = 'Edit a set together · Art History';
  Promise.all([getInvitation(code), account()]).then(async ([inv, me]) => {
    if (!inv) return failed(main, 'This invitation could not be loaded.');
    if (inv.role && inv.set.id) { location.replace(`/sets/${inv.set.id}`); return; }
    render(main, html`<section class="page sets-page"><p class="crumbs"><a href="/sets">Study sets</a> / Invitation</p>
      <h1>Edit “${inv.set.name}” together</h1>
      <p>${inv.set.creator ?? 'Someone'} invites you to edit this set${inv.set.topic ? html` (<span class="sets-topic">${inv.set.topic}</span>)` : ''} with
        ${inv.set.editors ? plural(inv.set.editors + 1, 'other') : 'them'}: ${plural(inv.set.count, 'entry', 'entries')} so far. You change its name, description and entries with them;
        what you know of the cards, your results and your exam date stay your own.</p>
      ${me ? html`<form class="sets-join">${inv.public_name ? html`<p class="muted small">The others see you as <b>${inv.public_name}</b>.</p>`
        : html`<label>Your public name — the others see it, never your username <input name="public_name" maxlength="60" required autocomplete="nickname"></label>`}
        <button type="submit">Join as an editor</button> <span class="sets-msg small" role="status"></span></form>`
        : html`<p>${await accountLinks()}</p>`}</section>`);
    main.querySelector<HTMLFormElement>('.sets-join')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const name = (f.elements.namedItem('public_name') as HTMLInputElement | null)?.value ?? '';
      joinSet(code, name).then((s) => { if (s) location.assign(`/sets/${s.id}`); })
        .catch((err: Error) => { f.querySelector('.sets-msg')!.textContent = err.message; });
    });
  }).catch(() => failed(main, 'This invitation is not valid (any more) — ask for a new link.'));
}

/** "Your results": per kind of quiz, the boxes, the hardest entries. */
function results(s: StudyStats, count: number): Html {
  const modes = MODES.filter((m) => s.modes[m]);
  const bar = (row: number[], label: string) => {
    const total = row.reduce((a, b) => a + b, 0) || 1;
    return html`<div class="sets-boxes"><span class="small">${label}</span><span class="sets-boxbar" role="img" aria-label="${row.map((n, i) => `${i ? `box ${String(i)}` : 'new'}: ${String(n)}`).join(', ')}">
      ${row.map((n, i) => (n ? html`<span class="sets-box sets-box-${String(i)}" style="flex:${String(n / total)}" title="${i ? `Box ${String(i)}` : 'Not yet asked'}: ${String(n)}">${String(n)}</span>` : ''))}</span>
      <span class="muted small">${String(row[4] + row[5])} of ${String(count)} known well</span></div>`;
  };
  const mins = (sec: number) => (sec >= 90 ? `${String(Math.round(sec / 60))} min` : `${String(sec)} s`);
  return html`<h2>Your results</h2>
    ${modes.length ? html`<div class="sets-results-wrap"><table class="sets-results"><thead><tr><th>Quiz</th><th>Rounds</th><th>Known</th><th>Best round</th><th>Last ten rounds</th><th>Time</th><th>Last</th></tr></thead><tbody>
      ${modes.map((m) => { const r = s.modes[m]!; return html`<tr><th scope="row">${MODE_NAME[m]}</th><td>${String(r.rounds)}</td>
        <td>${String(Math.round((100 * r.known) / r.answered))} %</td><td>${r.best === null ? '—' : `${String(r.best)} %`}</td>
        <td><span class="sets-spark" role="img" aria-label="${[...r.recent].reverse().map((p) => `${String(p)} %`).join(', ')}">${[...r.recent].reverse().map((p) => html`<span style="height:${String(Math.max(p, 4))}%" title="${String(p)} %"></span>`)}</span></td>
        <td>${mins(r.seconds)}</td><td class="small">${day(r.last_at)}</td></tr>`; })}</tbody></table></div>`
      : html`<p class="muted small">No round yet — your results per kind of quiz appear here.</p>`}
    ${bar(s.boxes.forward, 'Name it')}${bar(s.boxes.reverse, 'Describe it')}
    <p class="muted small">Boxes: a card known moves up a box, one not known goes back to box 1; boxes 4 and 5 count as known well. They are the same in every set holding the entry.</p>
    ${s.hardest.length ? html`<p class="small">Most often not known: ${s.hardest.map((h, i) => html`${i ? ', ' : ''}<a href="${href(PLURAL[h.type], h.slug)}">${h.name}</a> <span class="muted">(${String(h.seen - h.known)} of ${String(h.seen)})</span>`)}</p>` : ''}`;
}

// ---- the index cards --------------------------------------------------------------------------------------------
/** The text with the entry's name blanked out (its words of three letters or more, any case). */
export function blank(text: string, name: string) {
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // the whole name first ("Ukiyo-e", "The Great Wave"), then its words of three letters or more
  let out = name.trim() ? text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(name.trim())}(?![\\p{L}\\p{N}])`, 'giu'), '▁▁▁') : text;
  const words = [...new Set(name.split(/[\s,.;:()«»"“”‘’'–—-]+/).filter((w) => w.length >= 3))].sort((a, b) => b.length - a.length);
  for (const w of words) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(w)}(?![\\p{L}\\p{N}])`, 'giu'), '▁▁▁');
  return out;
}

const PROMPT: Partial<Record<StudyCard['type'], [string, string]>> = {
  // [Name it, Describe it]
  artwork: ['Which work is it — title, artist, date?', 'What does it look like? Who made it, when?'],
  artist: ['Who is it?', 'Who was it — when, where?'],
  person: ['Who is it?', 'Who was it — when, where?'],
  term: ['Which term is it?', 'What does it mean?'],
  source: ['Which source is it (short reference)?', 'What is the full reference?'],
};
const prompt = (c: StudyCard, d: Dir, mode: StudyMode) => (mode === 'typed' ? `Type its ${c.type === 'artwork' ? 'title' : 'name'}:`
  : mode === 'choice' ? 'Which is it?'
    : PROMPT[c.type]?.[d === 'forward' ? 0 : 1] ?? (d === 'forward' ? 'What is it?' : 'What do you know about it?'));
const picture = (c: StudyCard) => (c.image
  ? html`<img class="study-img" src="${c.own ? c.image : thumb(c.image, 960)}" alt=""${c.own ? '' : html` crossorigin="anonymous"`}>` : '');
const facts = (c: StudyCard) => (c.facts.length ? html`<dl class="study-facts">${c.facts.map((f) => html`<dt>${f.label}</dt><dd>${f.value}</dd>`)}</dl>` : '');

/** What the card shows before it is turned. */
function front(c: StudyCard, d: Dir): Html {
  if (d === 'reverse') return html`<p class="study-type muted small">${TYPE_LABEL[c.type]}</p><p class="study-name">${c.name}</p>`;
  // Name it: an artwork by its picture alone (else its facts); others by what is known of them, the name blanked
  if (c.type === 'artwork' && c.image) return html`<p class="study-type muted small">Artwork</p>${picture(c)}`;
  return html`<p class="study-type muted small">${TYPE_LABEL[c.type]}</p>${c.type === 'artwork' ? '' : picture(c)}${facts(c)}${c.text ? html`<p class="study-text">${blank(c.text, c.name)}</p>` : ''}`;
}
/** What it shows once turned. */
function back(c: StudyCard, d: Dir): Html {
  const link = html`<p class="small"><a href="${href(PLURAL[c.type], c.slug)}" target="_blank" rel="noopener">Open its page ↗</a></p>`;
  if (d === 'forward') return html`<p class="study-name">${c.name}</p>${c.type === 'artwork' ? facts(c) : ''}${link}`;
  return html`${picture(c)}${facts(c)}${c.text ? html`<p class="study-text">${c.text}</p>` : ''}${link}`;
}

/** Four names for "Pick it": the card's and three others of the set — of the same type first. */
export function options(card: StudyCard, all: StudyCard[], random = Math.random): string[] {
  const shuffle = <T>(a: T[]) => a.map((x) => ({ x, k: random() })).sort((p, q) => p.k - q.k).map((p) => p.x);
  const others = all.filter((c) => c.name !== card.name);
  const names = [...new Set([...shuffle(others.filter((c) => c.type === card.type)), ...shuffle(others.filter((c) => c.type !== card.type))].map((c) => c.name))];
  return shuffle([card.name, ...names.slice(0, 3)]);
}

interface Turn { card: StudyCard; dir: Dir; again: boolean }

function studyView(main: HTMLElement, ref: SetRef, params: URLSearchParams) {
  const asked = (params.get('mode') ?? params.get('dir')) as StudyMode | null;
  let mode: StudyMode = asked && MODES.includes(asked) ? asked : 'forward';
  const which = params.get('cards') ?? (params.get('skip') === 'known' ? 'weak' : 'all');
  const skipKnown = which === 'weak';
  Promise.all([getCards(ref), account()]).then(async ([r, me]) => {
    if (!r) return 'own' in ref ? loggedOut(main) : failed(main, 'This set is not shared (any more).');
    const { set, cards } = r;
    if (mode === 'choice' && cards.length < 2) mode = 'forward';
    const learner = Boolean(me);                     // visitors learn too; nothing of it is kept
    document.title = `Study: ${set.name} · Art History`;
    const dirs: Dir[] = mode === 'both' ? ['forward', 'reverse'] : mode === 'reverse' ? ['reverse'] : ['forward'];
    // every card in the chosen directions; the low boxes first, at random within a box
    // today's cards (220): those due again, and the day's share of the new ones (in the set's order)
    const today = which === 'today' && learner;
    const plan = today ? (await getSetStats(ref).catch(() => null))?.plan ?? null : null;
    const newLeft: Record<Dir, number> = { forward: plan?.directions.forward?.new_left_today ?? 0, reverse: plan?.directions.reverse?.new_left_today ?? 0 };
    const queue: Turn[] = cards.flatMap((card) => dirs.map((dir) => ({ card, dir, again: false })))
      .filter((t) => !skipKnown || (t.card.progress[t.dir]?.box ?? 0) < 5)
      .filter((t) => {
        if (!today) return true;
        const p = t.card.progress[t.dir];
        if (p) return Boolean(p.due);
        if (newLeft[t.dir] <= 0) return false;
        newLeft[t.dir] -= 1;
        return true;
      })
      .map((t) => ({ t, k: (t.card.progress[t.dir]?.box ?? 0) + Math.random() }))
      .sort((a, b) => a.k - b.k).map((x) => x.t);
    const total = queue.length;
    const started = Date.now();
    let known = 0;
    let notYet = 0;
    let recorded = false;
    const missed: Turn[] = [];
    let turned = false;
    let current: Turn | undefined;
    const round = (complete: boolean, beacon = false) => {
      if (recorded || !learner || !(known + notYet)) return;
      recorded = true;
      recordRound(ref, { mode, answered: known + notYet, known, seconds: Math.round((Date.now() - started) / 1000), complete }, beacon).catch(() => {});
    };
    const onHide = () => round(false, true);
    window.addEventListener('pagehide', onHide);

    const crumbs = 'own' in ref ? html`<a href="/sets">Your study sets</a>` : html`<a href="/sets/shared">Shared sets</a>`;
    render(main, html`<section class="page sets-page study-page">
      <p class="crumbs">${crumbs} / <a href="${pageHref(ref)}">${set.name}</a> / Study</p>
      <h1>${set.name} <span class="muted study-mode">${MODE_NAME[mode]}${today ? ' · today\'s cards' : ''}</span></h1>
      ${learner ? '' : html`<p class="muted small">${loginLink() ?? 'Log in'} to keep what you know and your results — as a visitor nothing is kept.</p>`}
      <p class="study-count muted small" aria-live="polite"></p>
      <div class="study-card" tabindex="0" aria-live="polite"></div>
      <div class="study-buttons"></div>
      <p class="muted small study-keys">${mode === 'typed' ? 'Enter: check, then on to the next card'
        : mode === 'choice' ? '1–4: pick · Enter: next card' : 'Space or Enter: turn the card · ←: not yet · →: knew it'}</p></section>`);
    const box = main.querySelector<HTMLElement>('.study-card')!;
    const buttons = main.querySelector<HTMLElement>('.study-buttons')!;
    const count = main.querySelector<HTMLElement>('.study-count')!;

    const show = () => {
      current = queue.shift();
      turned = false;
      if (!current) return done();
      const p = current.card.progress[current.dir];
      count.textContent = `Card ${String(known + notYet + 1)} of ${String(total + missed.filter((m) => m.again).length)}${p ? ` · box ${String(p.box)} of 5` : learner ? ' · new' : ''}${current.again ? ' · once more' : ''}`;
      render(box, html`<div class="study-side study-front">${front(current.card, current.dir)}<p class="study-prompt">${prompt(current.card, current.dir, mode)}</p></div>`);
      if (mode === 'typed') {
        render(buttons, html`<form class="study-type-form"><input name="answer" autocomplete="off" spellcheck="false" aria-label="Your answer"> <button type="submit">Check</button></form>`);
        buttons.querySelector('input')!.focus({ preventScroll: true });
      } else if (mode === 'choice') {
        render(buttons, html`<div class="study-options">${options(current.card, cards).map((n, i) => html`<button type="button" class="study-option" data-name="${n}"><span class="muted">${String(i + 1)}</span> ${n}</button>`)}</div>`);
        box.focus({ preventScroll: true });
      } else {
        render(buttons, html`<button type="button" class="study-turn">Show the answer</button>`);
        box.focus({ preventScroll: true });
      }
    };
    /** The card turned: with its verdict (typed, picked — then "Next card"), or with the buttons to judge oneself. */
    const reveal = (verdict?: { yes: boolean; note: string }, keep?: Html) => {
      if (!current || turned) return;
      turned = true;
      render(box, html`<div class="study-side study-front study-dim">${front(current.card, current.dir)}</div><div class="study-side study-back">
        ${verdict ? html`<p class="study-verdict ${verdict.yes ? 'study-right' : 'study-wrong'}">${verdict.note}</p>` : ''}${back(current.card, current.dir)}</div>`);
      if (verdict) {
        render(buttons, html`${keep ?? ''}<button type="button" class="study-next" data-yes="${verdict.yes ? '1' : '0'}">Next card →</button>`);
        buttons.querySelector<HTMLButtonElement>('.study-next')!.focus({ preventScroll: true });
      } else {
        render(buttons, html`<button type="button" class="study-no">← Not yet</button> <button type="button" class="study-yes">Knew it →</button>`);
      }
    };
    const answer = (yes: boolean) => {
      if (!current || !turned) return;
      const t = current;
      if (learner) answerCard(t.card.type, t.card.slug, t.dir, yes).then((p) => { if (p) t.card.progress[t.dir] = p; }).catch(() => {});
      if (yes) known += 1; else notYet += 1;
      // not known: once more at the end of this round
      if (!yes && !t.again) { const again = { ...t, again: true }; queue.push(again); missed.push(again); }
      show();
    };
    const check = (given: string) => {
      if (!current || turned) return;
      const score = points(bestMatch(given, [current.card.name]).score);
      reveal(score === 1 ? { yes: true, note: 'Right.' } : score > 0 ? { yes: true, note: `Nearly — counted: “${given}”.` }
        : { yes: false, note: given.trim() ? `Not quite: “${given}”.` : 'Not answered.' });
    };
    const pick = (name: string) => {
      if (!current || turned) return;
      const right = current.card.name;
      const shown = html`<div class="study-options">${[...buttons.querySelectorAll<HTMLButtonElement>('.study-option')].map((b) => html`<button type="button" class="study-option${
        b.dataset.name === right ? ' study-right' : b.dataset.name === name ? ' study-wrong' : ''}" disabled>${b.dataset.name!}</button>`)}</div>`;
      reveal(name === right ? { yes: true, note: 'Right.' } : { yes: false, note: `Not “${name}”.` }, shown);
    };
    const done = () => {
      count.textContent = '';
      round(true);
      const pct = known + notYet ? Math.round((100 * known) / (known + notYet)) : 0;
      const weak = cards.filter((c) => dirs.some((d) => (c.progress[d]?.box ?? 1) <= 1)).length;
      render(box, html`<div class="study-side study-done"><p class="study-name">Done</p>
        <p>${String(known)} known · ${String(notYet)} not yet${missed.length ? html` (they came back once)` : ''} — ${String(pct)} %.</p>
        ${learner ? html`<p class="muted small">${String(weak)} of ${String(cards.length)} ${cards.length === 1 ? 'entry is' : 'entries are'} still in the first box.</p><p class="study-compare small"></p>` : ''}</div>`);
      render(buttons, html`<a class="button-link" href="${studyHref(ref)}?mode=${mode}${today ? '&cards=today' : ''}">Again</a>
        <a class="button-link" href="${pageHref(ref)}">Back to the set</a>`);
      if (learner) {
        // the round is being saved: the comparison a moment later
        setTimeout(() => getSetStats(ref).then((s) => {
          const r = s?.modes[mode];
          const el = main.querySelector('.study-compare');
          if (r && el && r.rounds > 1) el.textContent = `${MODE_NAME[mode]} on this set: ${plural(r.rounds, 'round')}, ${String(Math.round((100 * r.known) / r.answered))} % known in all, best round ${String(r.best ?? pct)} %.`;
        }).catch(() => {}), 400);
      }
    };
    buttons.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('button');
      if (!b) return;
      if (b.classList.contains('study-turn')) reveal();
      else if (b.classList.contains('study-yes')) answer(true);
      else if (b.classList.contains('study-no')) answer(false);
      else if (b.classList.contains('study-next')) answer(b.dataset.yes === '1');
      else if (b.classList.contains('study-option')) pick(b.dataset.name!);
    });
    buttons.addEventListener('submit', (e) => {
      e.preventDefault();
      check(((e.target as HTMLFormElement).elements.namedItem('answer') as HTMLInputElement).value);
    });
    box.addEventListener('click', (e) => { if (!(e.target as Element).closest('a') && mode !== 'typed' && mode !== 'choice') reveal(); });
    function keys(e: KeyboardEvent) {
      if (!box.isConnected) { document.removeEventListener('keydown', keys); return; }   // left the page
      if ((e.target as Element).closest?.('input, textarea, select')) return;
      if (mode === 'typed' || mode === 'choice') {
        if (e.key === 'Enter' && turned && !(e.target as Element).closest?.('button')) { e.preventDefault(); buttons.querySelector<HTMLButtonElement>('.study-next')?.click(); }
        else if (mode === 'choice' && !turned && /^[1-4]$/.test(e.key)) buttons.querySelectorAll<HTMLButtonElement>('.study-option')[Number(e.key) - 1]?.click();
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') { if (!turned) { e.preventDefault(); reveal(); } }
      else if (e.key === 'ArrowRight') answer(true);
      else if (e.key === 'ArrowLeft') answer(false);
    }
    document.addEventListener('keydown', keys);
    leave = () => { window.removeEventListener('pagehide', onHide); document.removeEventListener('keydown', keys); round(false); };
    if (!total) {
      render(box, html`<div class="study-side study-done"><p>${today ? 'Nothing due today — well done. Come back tomorrow, or study all the cards.'
        : skipKnown ? 'You know every card of this set well.' : 'This set has no entries yet.'}</p></div>`);
      render(buttons, html`<a class="button-link" href="${pageHref(ref)}">Back to the set</a>`);
      return;
    }
    show();
  }).catch(() => failed(main, 'The cards could not be loaded.'));
}
