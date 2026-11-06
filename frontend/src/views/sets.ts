// Study sets (owner 2026-11-04; backend routes/site-sets.js, src/study.js, migrations 218/219): an account's own lists
// of entries of any type, to keep for reference and to learn — and to share.
//   /sets                    the account's sets by topic: create (name, topic), open, delete
//   /sets/<id>               one set: its entries (removed with ×), name, topic, description (Markdown, md-editor.ts),
//                            sharing, the account's results, "Study"
//   /sets/<id>/study?mode=…  a round of a quiz on it
//   /sets/shared             the public sets of every account, by topic
//   /sets/s/<code>           a public set — anyone may look and learn; logged in: "Save a copy",
//   /sets/s/<code>/study       and the round counts among the account's results (never the owner's)
//   /sets/join/<code>        a link to join a set with the rights it carries (228): logged in with a public name → a member
// Members (228): private (its owner only), shared (its members), public (anyone, listed). Members are viewers or edit
// it — with full rights (at once), with the owner's approval, or with votes (the set's kind: advisory → the owner
// decides; binding → the vote decides, ties → the owner, a veto if the owner keeps one). Everyone sees their own part
// in plain words at the top of the set (yourPart) and before joining; the owner's "Sharing and members" panel says the
// same for every kind of rights (RIGHTS_NAME / rightsText / voteRules — one wording everywhere). Proposed changes
// with their votes under "Proposed changes". A save from an older version of a field someone else changed meanwhile
// is refused (409) — their version is shown, yours stays in the form.
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
  answerCard, answerInvitation, ApiError, copySnapshot, forgetResults, getResults, getSnapshot, cancelInvitation, changeMember, chatEvents, copyOwnSet, copySet, createSet, decideProposal, deleteSet, deleteSetChat,
  endSetLink, getCards, getInvitation, getPublicSets, getSet, getSetChat, getSetHistory, getSetMembers, getSets, getSetStats, getSharing, hideInSetChat,
  inviteToSet, joinSet, leaveSet, lockSet, loginUrl, newSetLink, postSetChat, previewDescription, recordRound, removeFromSet, reportSetChat, restoreSet,
  savePlan, saveVoteSettings, setChatMember, shareSet, switchSetChat, updateSet, voteOn, withdrawProposal,
  type Proposed, type SetChatMessage, type SetEvent, type SetProposal, type SetRef, type SetRights, type SetSharing, type StudyCard, type StudyItem,
  type StudyMode, type StudyPlan, type StudySet, type StudyStats, type Visibility, type Vote, type VoteMode,
} from '../api';
import { accountLinks } from './account';
import { href, html, PLURAL_LABEL, render, thumb, trusted, TYPE_LABEL, type Html } from '../html';
import { PLURAL } from '../api';
import { markdownEditor } from '../md-editor';
import { bestMatch, points } from '../quiz-match';

type Dir = 'forward' | 'reverse';
export interface SetsRoute { id: string | null; code: string | null; study: boolean; browse: boolean; join: string | null; results?: boolean; params: URLSearchParams }

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
const VISIBILITY: Visibility[] = ['private', 'shared', 'public'];
const VIS_LABEL: Record<Visibility, string> = { private: 'Private', shared: 'Shared', public: 'Public' };
const VIS_HELP: Record<Visibility, string> = {
  private: 'only you see it. Making a set private again removes all members, ends open invitations and links, and closes open proposals.',
  shared: 'only its members see it: friends you invite and people who join with one of your links — each with the rights you give them. Not listed anywhere.',
  public: 'anyone can look at it and study it, also without an account, and it is listed under Shared sets. Only you and the members you give editing rights change it, in the way their rights say.',
};
const joinUrl = (code: string) => `${location.origin}/sets/join/${code}`;

// ---- rights in a set (228): one wording wherever someone meets them (owner 2026-11-05: "clearly communicated to any
// person involved") — the owner's panel, the member's own part, invitations and links before joining, the list
type RightsKey = SetRights | 'owner';
const RIGHTS: SetRights[] = ['view', 'full', 'approval', 'vote'];
const RIGHTS_NAME: Record<RightsKey, string> = { owner: 'Owner', view: 'Viewer', full: 'Editor with full rights', approval: 'Editor with approval', vote: 'Editor with votes' };
const RIGHTS_SHORT: Record<RightsKey, string> = { owner: 'yours', view: 'viewer', full: 'editor', approval: 'editor with approval', vote: 'editor with votes' };
const VOTE_LABEL: Record<Vote, string> = { yes: 'Yes', no: 'No', abstain: 'Abstain' };
function voteRules(mode: VoteMode, hours: number, veto: boolean) {
  return mode === 'advisory'
    ? 'The owner and everyone with editing rights vote Yes, No or Abstain; whoever proposes votes Yes by proposing. The owner sees the votes and decides whenever they like — also before everyone has voted.'
    : `The owner and everyone with editing rights vote Yes, No or Abstain; whoever proposes votes Yes by proposing. After ${plural(hours, 'hour')} — or earlier, as soon as the votes still missing can no longer change the result — more Yes than No accepts the change and more No than Yes rejects it; a single vote is enough. If it ends even, the owner decides. When only the owner and the proposer can vote, there is no vote: the change applies at once. ${veto ? 'The owner keeps a veto: they may decide a vote before it ends.' : 'The owner cannot overrule the vote.'}`;
}
function rightsText(r: RightsKey, s: { vote_mode?: VoteMode; vote_hours?: number; owner_veto?: boolean }) {
  switch (r) {
    case 'owner': return 'Decides who sees the set, invites members and gives each their rights, makes and turns off links, chooses how votes work, and changes the set directly. Only the owner locks, restores, hands over or deletes it.';
    case 'view': return 'Reads and studies the set. Changes nothing and votes on nothing; the set\'s chat only if the owner allows it to them.';
    case 'full': return 'Adds and removes entries and changes the name, topic and description — at once, without asking. Votes on the proposals that are put to the vote.';
    case 'approval': return 'Proposes changes — entries added or removed, a new name, topic or description; each waits until the owner accepts or rejects it. Votes on the proposals that are put to the vote.';
    case 'vote': return `Proposes changes, which are put to the vote. ${voteRules(s.vote_mode ?? 'advisory', s.vote_hours ?? 24, Boolean(s.owner_veto))}`;
  }
}
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
      if (route.results) return resultsPage(main);
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
  : html` <span class="tag sets-vis sets-vis-${set.visibility}" title="${VIS_HELP[set.visibility]}">${set.visibility}</span>`);
/** "3 members" (the owner's) / "editor with approval · Ms X's" (a member's) */
const together = (s: StudySet) => {
  if (s.role && s.role !== 'owner') return html` <span class="tag sets-together-tag" title="${rightsText((s.rights ?? 'view') as RightsKey, s)}">${RIGHTS_SHORT[(s.rights ?? 'view') as RightsKey]} · ${s.creator ?? 'its owner'}'s</span>`;
  const n = s.members?.length ?? (s.editor_count ?? 0) + (s.viewer_count ?? 0);
  return n ? html` <span class="tag sets-together-tag" title="Others are members of it">${plural(n, 'member')}</span>` : '';
};
const topicOptions = (topics: string[]) => html`${topics.map((t) => html`<option value="${t}"></option>`)}`;

// ---- the account's sets -----------------------------------------------------------------------------------------
function list(main: HTMLElement, note = '') {
  getSets().then((r) => {
    if (!r) return loggedOut(main);
    const { sets, topics } = r;
    const byTopic = new Map<string, StudySet[]>();
    for (const s of sets) { const k = s.topic ?? ''; if (!byTopic.has(k)) byTopic.set(k, []); byTopic.get(k)!.push(s); }
    const groups = [...byTopic.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    const welcome = new URLSearchParams(location.search).get('welcome') === '1';
    render(main, html`<section class="page sets-page">${welcome ? html`<p class="flash ok">Welcome — your account is ready. Your settings: <a href="/account">Your account</a>.</p>` : ''}<h1>Your study sets</h1>
      <p class="muted">Your own lists of entries — only you see them unless you share one. Add an entry with <b>+ Set</b>
        on its page; learn a set with <b>Study</b>. <a href="/sets/shared">Browse shared sets →</a> · <a href="/sets/results">Your results →</a></p>
      <form class="sets-new">
        <input name="name" placeholder="Name of a new set — e.g. Exam: Japanese art" aria-label="Name of a new set" maxlength="120" required>
        <input name="topic" placeholder="Topic (optional)" aria-label="Topic" maxlength="80" list="sets-topics" autocomplete="off">
        <button type="submit">Create</button><datalist id="sets-topics">${topicOptions(topics)}</datalist></form>
      <p class="sets-msg small" role="status"></p>
      ${r.invitations.length ? html`<section class="sets-invitations"><h2>Invitations</h2><ul>${r.invitations.map((i) => html`<li data-set="${String(i.set_id)}">
        <b>${i.creator ?? 'Someone'}</b> invites you to <b>${i.name}</b>${i.topic ? html` <span class="sets-topic">${i.topic}</span>` : ''} <span class="muted small">(${plural(i.count, 'entry', 'entries')})</span>
        as <b>${RIGHTS_NAME[i.rights]}</b>${i.chat && i.rights === 'view' ? ', with the chat' : ''}.
        <span class="small muted sets-invitation-rights">${rightsText(i.rights, { vote_mode: i.vote_mode })}</span>
        <span class="sets-actions"><button type="button" data-accept="1">Accept</button> <button type="button" class="secondary" data-accept="0">Decline</button></span></li>`)}</ul></section>` : ''}
      ${sets.some((s) => s.to_vote || s.to_decide) ? html`<p class="flash sets-votes-waiting">Proposed changes wait for you:
        ${sets.filter((s) => s.to_vote || s.to_decide).map((s, i) => html`${i ? ' · ' : ''}<a href="/sets/${s.id!}#sets-proposals">${s.name}</a> <span class="muted">(${[s.to_vote ? `${String(s.to_vote)} to vote on` : '', s.to_decide ? `${String(s.to_decide)} to decide` : ''].filter(Boolean).join(', ')})</span>`)}</p>` : ''}
      ${sets.length ? groups.map(([topic, list]) => html`<section class="sets-group">${groups.length > 1 || topic ? html`<h2>${topic || 'No topic'}</h2>` : ''}
        <ul class="sets-list">${list.map((s) => html`<li class="sets-item">
          <a class="sets-name" href="/sets/${s.id!}">${s.name}</a>${visBadge(s)}${together(s)}${s.locked_at ? html` <span class="tag" title="The owner locked it: no changes by its editors">locked</span>` : ''}${s.proposals ? html` <a class="tag sets-proposal-tag" href="/sets/${s.id!}#sets-proposals" title="Changes proposed and not decided yet">${plural(s.proposals, 'change')} proposed</a>` : ''}${s.chat_unread ? html` <a class="tag sets-chat-tag" href="/sets/${s.id!}#sets-chat" title="Unread messages in the set's chat">${plural(s.chat_unread, 'new message')}</a>` : ''}${s.exam_on ? html` <span class="tag sets-exam" title="Your exam date">exam ${longDay(s.exam_on)}</span>` : ''}
          <span class="muted small">${plural(s.count, 'entry', 'entries')} · changed ${day(s.updated_at)}${s.description_text ? html` · ${s.description_text}` : ''}</span>
          <span class="sets-actions">${s.count ? html`<a class="button-link" href="/sets/${s.id!}/study">Study</a>` : ''}
            ${s.role && s.role !== 'owner' ? '' : html`<button type="button" class="link-button sets-delete" data-id="${s.id!}" data-name="${s.name}">Delete</button>`}</span></li>`)}</ul></section>`)
        : html`<p class="muted">No sets yet.</p>`}
    </section>`);
    const msg = main.querySelector<HTMLElement>('.sets-msg')!;
    if (note) msg.textContent = note;
    main.querySelector<HTMLFormElement>('.sets-new')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const val = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value.trim();
      createSet(val('name'), val('topic')).then((set) => { if (set) location.assign(`/sets/${set.id!}`); }).catch((err: Error) => { msg.textContent = err.message; });
    });
    main.querySelectorAll<HTMLButtonElement>('[data-accept]').forEach((b) => b.addEventListener('click', () => {
      const setId = b.closest<HTMLElement>('[data-set]')!.dataset.set!;
      answerInvitation(setId, b.dataset.accept === '1').then((x) => { if (x?.set) location.assign(`/sets/${x.set.id}`); else list(main); }).catch((err: Error) => {
        // gone meanwhile (the set deleted or made private, the invitation withdrawn): say so, and show the list as it is now
        if (err instanceof ApiError && err.status === 404) { list(main, 'This invitation is no longer valid — the set was deleted or made private, or the owner withdrew it.'); return; }
        msg.textContent = err.message;
      });
    }));
    main.querySelectorAll<HTMLButtonElement>('.sets-delete').forEach((b) => b.addEventListener('click', () => {
      if (!confirm(`Delete the set “${b.dataset.name}”? Its entries stay on the site; what you know of them stays too, and your results on it stay under “Your results” with the set as it was. Its members lose it, its links and its public address stop working.`)) return;
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

export const HOLD_MS = 3000;
const HOLD_RING = html`<svg class="hold-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" pathLength="100"></circle></svg>`;
/** Press and hold (pointer, Enter or Space) for `ms` to confirm: the button's ring fills meanwhile; let go early and it
 *  empties again and `early` says how it works. */
export function holdToConfirm(btn: HTMLElement, ms: number, done: () => void, early: () => void) {
  btn.style.setProperty('--hold-ms', `${String(ms)}ms`);
  let timer = 0;
  let started = 0;
  const start = () => {
    if (timer) return;
    started = Date.now();
    btn.classList.add('holding');
    timer = window.setTimeout(() => { timer = 0; btn.classList.remove('holding'); btn.classList.add('held'); done(); }, ms);
  };
  const stop = () => {
    if (!timer) return;
    clearTimeout(timer); timer = 0;
    btn.classList.remove('holding');
    if (Date.now() - started < ms) early();
  };
  btn.addEventListener('pointerdown', (e) => { if (e.button === 0) { btn.setPointerCapture(e.pointerId); start(); } });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) btn.addEventListener(ev, stop);
  btn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); } });
  btn.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') stop(); });
  btn.addEventListener('blur', stop);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());   // a long touch opens no menu
  btn.addEventListener('click', (e) => e.preventDefault());
}

function studyForm(ref: SetRef, count: number, learner: boolean) {
  if (!count) return html`<p class="muted">Nothing in it yet — add entries with <b>+ Set</b> on their pages.</p>`;
  const modes = MODES.filter((m) => m !== 'choice' || count >= CHOICE_MIN);
  return html`<form class="sets-study sets-card" action="${studyHref(ref)}">
    <h2 class="sets-card-title">Study the ${plural(count, 'entry', 'entries')}</h2>
    <fieldset class="sets-modes"><legend class="sets-label">Kind of quiz</legend>
    ${modes.map((m, i) => html`<label class="sets-mode"><input type="radio" name="mode" value="${m}"${i ? '' : ' checked'}><span><b>${MODE_NAME[m]}</b><span class="muted small">${MODE_HELP[m]}</span></span></label>`)}</fieldset>
    <fieldset class="sets-cards-choice"><legend class="sets-label">Which cards</legend>
      <label class="sets-pill"><input type="radio" name="cards" value="all" checked> All</label>
      ${learner ? html`<label class="sets-pill"><input type="radio" name="cards" value="today"> Today's <span class="muted small sets-today-count"></span></label>` : ''}
      <label class="sets-pill"><input type="radio" name="cards" value="weak"> Leave out those you know well</label></fieldset>
    <button type="submit" class="sets-study-go">Study</button></form>`;
}

/** The exam date and the day's plan (logged in): set, changed, removed; per kind of card the cards due today. */
function planBox(box: HTMLElement, ref: SetRef, plan: StudyPlan, onChange: (p: StudyPlan) => void) {
  const f = plan.directions.forward;
  const r = plan.directions.reverse;
  const todayOf = (d?: { due: number; new_left_today: number }) => (d ? d.due + d.new_left_today : 0);
  const line = (label: string, d?: { due: number; new: number; new_left_today: number }) => (d
    ? html`<li><b>${label}</b>: ${plural(d.due, 'card')} to review${d.new_left_today ? html` + ${String(d.new_left_today)} new` : ''}${d.new ? html` <span class="muted small">(${String(d.new)} not asked yet)</span>` : ''}</li>` : '');
  const exam = plan.exam_on && plan.days_left !== null;
  render(box, html`<h2 class="sets-card-title">${exam ? html`Exam ${examIn(plan.days_left!)}` : 'Today'}</h2>
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

function one(main: HTMLElement, ref: SetRef, note = '') {
  Promise.all([getSet(ref), account()]).then(([r, me]) => {
    if (!r) return 'own' in ref ? loggedOut(main) : failed(main, 'This set is not shared (any more).');
    const { set, items } = r;
    const proposals = r.proposals ?? [];
    const decided = r.decided ?? [];
    const own = 'own' in ref;
    const role = own ? set.role ?? 'owner' : null;
    const owner = role === 'owner';
    const viewer = role === 'viewer';
    const locked = Boolean(set.locked_at);
    const editor = role === 'editor';
    const directly = owner || set.rights === 'full';
    const canChange = own && !viewer && !(editor && locked);
    const pending = new Map(proposals.filter((p) => p.kind !== 'field').map((p) => [`${p.type ?? ''}/${p.slug ?? ''}`, p]));
    if (!own && set.mine && set.id) { location.replace(`/sets/${set.id}`); return; }   // the owner's or a member's own page
    document.title = `${set.name} · Study sets · Art History`;
    const byType = new Map<string, StudyItem[]>();
    for (const i of items) { if (!byType.has(i.type)) byType.set(i.type, []); byType.get(i.type)!.push(i); }
    const crumbs = own ? html`<a href="/sets">Your study sets</a>` : html`<a href="/sets/shared">Shared sets</a>`;
    const hasMembers = Boolean(set.members?.length);
    render(main, html`<section class="page sets-page">
      <header class="sets-head"><p class="crumbs">${crumbs} / ${set.name}</p>
      <h1>${set.name}${own ? visBadge(set) : ''}${own ? together(set) : ''}${own && locked ? html` <span class="tag" title="Its members read and study it but change nothing">locked</span>` : ''}</h1>
      ${meta(set, !owner)}</header>
      ${own && (!owner || hasMembers) ? yourPart(set) : ''}
      ${editor && locked ? html`<p class="flash">The owner has locked this set: you can study it, but not change or propose anything until they unlock it.</p>` : ''}
      ${set.description_html || (own && set.copied_from) ? html`<section class="sets-about sets-card" aria-label="About this set">
        ${set.description_html ? html`<div class="prose sets-description">${trusted(set.description_html)}</div>` : ''}
        ${own && set.copied_from ? html`<p class="muted small">A copy of <a href="/sets/s/${set.copied_from.code}">${set.copied_from.name}</a>${set.copied_from.creator ? ` by ${set.copied_from.creator}` : ''}.</p>` : ''}</section>` : ''}
      ${own ? html`<section class="sets-manage sets-card" aria-labelledby="sets-manage-title"><h2 class="sets-card-title" id="sets-manage-title">${viewer ? 'This set' : 'Manage this set'}</h2><div class="sets-tools">
        ${viewer ? '' : html`<details class="sets-edit"${editor && locked ? ' hidden' : ''}><summary class="link-button">${directly ? 'Edit name, topic, description' : 'Propose a new name, topic, description'}</summary>
          <form class="sets-edit-form"><p class="sets-conflict flash" hidden></p>
            ${directly ? '' : html`<p class="small muted">${set.rights === 'approval' ? 'What you change here is proposed to the owner; it applies once they accept it.'
              : set.vote_mode === 'binding' ? 'What you change here is put to the vote; the vote decides.' : 'What you change here is put to the vote; the owner decides.'}</p>`}
            <input type="hidden" name="base_name" value="${set.name}"><input type="hidden" name="base_topic" value="${set.topic ?? ''}">
            <textarea name="base_description" hidden>${set.description ?? ''}</textarea>
            <label>Name <input name="name" value="${set.name}" maxlength="120" required></label>
            <label>Topic <input name="topic" value="${set.topic ?? ''}" maxlength="80" list="sets-topics" autocomplete="off" placeholder="e.g. Japanese art"></label>
            <label class="sets-edit-desc"><span>Description</span>
              <textarea name="description" rows="7" maxlength="10000" placeholder="What it is for, what to look out for, notes for learning …">${set.description ?? ''}</textarea></label>
            ${directly ? '' : html`<label>Why <span class="muted small">(optional — the others see it)</span> <input name="reason" maxlength="500"></label>`}
            <button type="submit">${directly ? 'Save' : 'Propose'}</button><datalist id="sets-topics"></datalist></form></details>`}
        ${owner ? html`<details class="sets-share" id="sets-sharing"><summary class="link-button">Sharing and members…</summary><div class="sets-share-body"></div></details>` : ''}
        ${owner ? html`<button type="button" class="link-button sets-lock" title="${locked ? 'Its members may change and propose again' : 'Its members can still study it, but change and propose nothing'}">${locked ? 'Unlock' : 'Lock'}</button>` : ''}
        ${viewer ? '' : html`<details class="sets-history"><summary class="link-button">History</summary><div class="sets-history-body"></div></details>`}
        ${viewer ? '' : html`<button type="button" class="link-button sets-copy-own" title="A set of your own with the same entries — yours to share and to invite to">Make my own copy</button>`}
        ${owner ? '' : html`<button type="button" class="link-button sets-leave">Leave this set</button>`}</div></section>`
        : html`<p class="sets-tools sets-card">${me ? html`<button type="button" class="sets-copy">Save a copy to your sets</button>`
          : html`<span class="muted small">${loginLink() ?? 'Log in'} to keep track of what you know and to save a copy.</span>`}</p>`}
      <p class="sets-msg small" role="status"></p>
      <div class="sets-learn${me && items.length ? ' with-plan' : ''}">
        ${me ? html`<section class="sets-plan sets-card" aria-label="Your plan"></section>` : ''}
        ${studyForm(ref, items.length, Boolean(me))}</div>
      ${me ? html`<section class="sets-stats sets-card" aria-label="Your results"></section>` : ''}
      ${own && (proposals.length || decided.length) ? html`<section class="sets-proposals" id="sets-proposals"></section>` : ''}
      ${own && hasMembers ? html`<section class="sets-members sets-card" id="sets-members" aria-label="Members"></section>` : ''}
      ${own && set.chat_allowed && (set.chat_on || owner) && (hasMembers || set.chat_on) ? html`<section class="sets-chat" id="sets-chat" aria-label="The set's chat"></section>` : ''}
      ${items.length ? html`<section class="sets-entries" aria-labelledby="sets-entries-title"><h2 id="sets-entries-title" class="sets-entries-title">Entries <span class="muted">${String(items.length)}</span></h2>
      ${byType.size > 1 ? html`<nav class="sets-jump" aria-label="Kinds of entries">${[...byType.entries()].map(([type, list]) => html`<a class="chip" href="#sets-${type}">${PLURAL_LABEL[PLURAL[type as StudyItem['type']]]} <span class="muted">${String(list.length)}</span></a>`)}</nav>` : ''}
      ${[...byType.entries()].map(([type, list]) => html`<section class="sets-group" id="sets-${type}"><h3>${PLURAL_LABEL[PLURAL[type as StudyItem['type']]]} <span class="muted">${String(list.length)}</span></h3>
        <ul class="sets-items">${list.map((i) => {
          const p = pending.get(`${i.type}/${i.slug}`);
          return html`<li class="sets-entry">
          <a class="sets-entry-link" href="${href(PLURAL[i.type], i.slug)}">${itemPicture(i)}<span><span class="sets-entry-name">${i.name}</span>
            ${i.subtitle ? html`<span class="muted small">${i.subtitle}</span>` : ''}${i.added_by ? html`<span class="muted small sets-added-by">added by ${i.added_by}</span>` : ''}</span></a>
          ${!canChange ? '' : p ? html`<a class="muted small" href="#sets-proposals">removal proposed</a>` : directly
            ? html`<button type="button" class="link-button sets-remove" data-type="${i.type}" data-slug="${i.slug}" title="Hold to remove from this set" aria-label="Remove ${i.name} from this set (hold for 3 seconds)">${HOLD_RING}<span aria-hidden="true">×</span></button>`
            : html`<button type="button" class="link-button sets-propose small" data-type="${i.type}" data-slug="${i.slug}" data-name="${i.name}" title="${set.rights === 'approval' ? 'Propose its removal — the owner decides' : 'Propose its removal — it is put to the vote'}">Propose removal</button>`}</li>`;
        })}</ul></section>`)}</section>` : ''}
    </section>`);
    const msg = main.querySelector<HTMLElement>('.sets-msg')!;
    const missing = Number(new URLSearchParams(location.search).get('missing') || 0);
    msg.textContent = note || (missing ? `Saved as a new set. ${plural(missing, 'entry', 'entries')} of that version ${missing === 1 ? 'is' : 'are'} no longer on the site and left out.` : '');
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
    const reload = () => one(main, ref);
    /** a change made — or proposed (228): the message says which, then the page is drawn again */
    const after = (r: unknown, what: string) => {
      const p = r && typeof r === 'object' && 'proposed' in r ? r as Proposed : null;
      one(main, ref, p ? proposedText(p, set, what) : '');
    };
    const editForm = main.querySelector<HTMLFormElement>('.sets-edit-form');
    if (editForm) {
      markdownEditor(editForm.querySelector<HTMLTextAreaElement>('textarea[name=description]')!, previewDescription);
      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = (n: string) => (editForm.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '';
        const conflict = editForm.querySelector<HTMLElement>('.sets-conflict')!;
        updateSet(id, { name: val('name'), topic: val('topic'), description: val('description'), base_name: val('base_name'), base_topic: val('base_topic'), base_description: val('base_description'), reason: val('reason') })
          .then((r) => after(r, 'Your changes'))
          .catch((err: Error) => {
            if (!(err instanceof ApiError && err.status === 409 && (err.body as { error?: string } | null)?.error === 'changed')) { msg.textContent = err.message; return; }
            // someone else changed it meanwhile: their version shown, yours kept in the form; Save again replaces theirs
            const now = (err.body?.set ?? null) as StudySet | null;
            if (!now) return;
            const put = (n: string, v: string) => { (editForm.elements.namedItem(n) as HTMLInputElement).value = v; };
            put('base_name', now.name); put('base_topic', now.topic ?? ''); put('base_description', now.description ?? '');
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
    }
    if (owner) ownerPanel(main.querySelector<HTMLDetailsElement>('.sets-share')!, set, id, reload);
    const historyBox = main.querySelector<HTMLDetailsElement>('.sets-history');
    if (historyBox) history(historyBox, id, owner, reload);
    main.querySelector('.sets-copy-own')?.addEventListener('click', () => {
      copyOwnSet(id).then((c) => { if (c) location.assign(`/sets/${c.id}`); }).catch((err: Error) => { msg.textContent = err.message; });
    });
    main.querySelector('.sets-leave')?.addEventListener('click', () => {
      if (!confirm('Leave this set? It goes from your sets; your progress on its entries stays yours. To come back you need a new invitation or link.')) return;
      leaveSet(id).then(() => location.assign('/sets')).catch((err: Error) => { msg.textContent = err.message; });
    });
    const chatBox = main.querySelector<HTMLElement>('.sets-chat');
    if (chatBox) setChat(chatBox, id, owner);
    const membersBox = main.querySelector<HTMLElement>('.sets-members');
    if (membersBox) members(membersBox, set, id, owner, () => { if (chatBox) setChat(chatBox, id, owner); });
    const proposalsBox = main.querySelector<HTMLElement>('.sets-proposals');
    if (proposalsBox) proposalList(proposalsBox, set, id, proposals, decided, reload);
    if (location.hash === '#sets-chat') chatBox?.scrollIntoView();
    if (location.hash === '#sets-proposals') proposalsBox?.scrollIntoView();
    if (location.hash === '#sets-sharing') { const d = main.querySelector<HTMLDetailsElement>('.sets-share'); if (d) { d.open = true; d.scrollIntoView(); } }
    main.querySelector('.sets-lock')?.addEventListener('click', () => {
      if (!locked && !confirm('Lock this set? Its members can still study it, but change, propose and vote on nothing until you unlock it.')) return;
      lockSet(id, !locked).then(reload).catch((err: Error) => { msg.textContent = err.message; });
    });
    main.querySelectorAll<HTMLButtonElement>('.sets-propose').forEach((b) => b.addEventListener('click', () => {
      const reason = window.prompt(`Why should “${b.dataset.name}” go? (optional — the others see it)`);
      if (reason === null) return;
      removeFromSet(id, b.dataset.type as StudyItem['type'], b.dataset.slug!, reason).then((r) => after(r, 'Removing it')).catch((err: Error) => { msg.textContent = err.message; });
    }));
    // removing takes a hold of three seconds while the ring fills (owner 2026-11-06: a click removed too easily)
    main.querySelectorAll<HTMLButtonElement>('.sets-remove').forEach((b) => holdToConfirm(b, HOLD_MS, () => {
      removeFromSet(id, b.dataset.type as StudyItem['type'], b.dataset.slug!).then(reload).catch((err: Error) => { msg.textContent = err.message; });
    }, () => { b.classList.add('hold-hint'); setTimeout(() => b.classList.remove('hold-hint'), 2500); }));
  }).catch(() => failed(main, 'This set could not be loaded.'));
}

/** "Proposed: … waits for the owner" — what happens to a change the account proposed (228). */
function proposedText(p: Proposed, set: StudySet, what: string) {
  const outcomes = [p.proposal?.outcome, ...(p.proposals ?? []).map((x) => x.outcome)].filter(Boolean);
  if (outcomes.length && outcomes.every((o) => o === 'accepted')) return `${what}: done — with only you and the owner voting, there is no vote.`;
  return `${what}: proposed — ${set.rights === 'approval' ? 'it applies once the owner accepts it.'
    : set.vote_mode === 'binding' ? `put to the vote (at most ${String(set.vote_hours ?? 24)} h).` : 'put to the vote; the owner decides.'} See “Proposed changes” below.`;
}

/** The viewer's part in a set (228): their rights in plain words — and how its votes work. */
function yourPart(set: StudySet) {
  const r = (set.rights ?? 'owner') as RightsKey;
  const votes = set.vote_mode && (r !== 'view');
  return html`<div class="sets-your-part"><p><b>Your part: ${RIGHTS_NAME[r]}</b>${r === 'owner' ? '' : html` <span class="muted small">— given by the owner, ${set.creator ?? '—'}</span>`}</p>
    <p class="small">${rightsText(r, set)}</p>
    ${votes && r !== 'vote' ? html`<p class="small muted">Votes in this set: ${voteRules(set.vote_mode!, set.vote_hours ?? 24, Boolean(set.owner_veto))}</p>` : ''}
    ${r === 'owner' ? '' : html`<p class="small muted">Your progress, results and exam date are your own — nobody else sees them. Your public name is shown to the other members.</p>`}</div>`;
}

const OUTCOME: Record<string, string> = { accepted: 'accepted', rejected: 'rejected', withdrawn: 'withdrawn', outdated: 'outdated — done or changed meanwhile', closed: 'closed — the set became private' };
/** "add X" / "remove X" / "rename to Y" — what a proposal changes */
function changeOf(p: SetProposal) {
  const entry = p.slug && p.type ? html`<a href="${href(PLURAL[p.type], p.slug)}">${p.name ?? p.slug}</a>` : html`<span class="muted">an entry since deleted</span>`;
  if (p.kind === 'add') return html`add ${entry}`;
  if (p.kind === 'remove') return html`remove ${entry}${p.added_by ? html` <span class="muted small">(added by ${p.added_by})</span>` : ''}`;
  if (p.field === 'description') return html`a new description <details class="sets-proposal-text"><summary class="small">show</summary><div class="small"><b>Now:</b> ${p.old ?? '—'}</div><div class="small"><b>Proposed:</b> ${p.new ?? '—'}</div></details>`;
  return html`${p.field === 'name' ? 'rename it' : 'a new topic'}: <s class="muted">${p.old ?? '—'}</s> → <b>${p.new ?? '—'}</b>`;
}
const until = (iso: string) => {
  const min = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  return min <= 0 ? 'now' : min < 60 ? `in ${String(min)} min` : `in ${String(Math.floor(min / 60))} h ${String(min % 60)} min`;
};

/** The set's proposed changes (228): what each changes, who proposed it and why, how it is decided, the votes; the
 *  members vote Yes / No / Abstain where it is put to the vote; the owner accepts or rejects where they may; the
 *  proposer withdraws. The last decided ones below. */
function proposalList(box: HTMLElement, set: StudySet, id: string, open: SetProposal[], decided: SetProposal[], reload: () => void) {
  const owner = set.role === 'owner';
  const locked = Boolean(set.locked_at);
  const how = (p: SetProposal) => (p.procedure === 'approval' ? 'The owner accepts or rejects it.'
    : p.procedure === 'advisory' ? 'Put to the vote; the owner decides, seeing the votes.'
      : p.tie_at ? 'The vote ended even — the owner decides.'
        : `Put to the vote: it decides ${until(p.closes_at!)} (${at(p.closes_at!)}) or earlier, once the missing votes can't change it.${set.owner_veto ? ' The owner may decide before.' : ''}`);
  const count = (p: SetProposal, v: Vote) => (p.votes ?? []).filter((x) => x.vote === v).length;
  const mayDecide = (p: SetProposal) => owner && (p.procedure !== 'binding' || Boolean(p.tie_at) || Boolean(set.owner_veto));
  render(box, html`<h2>Proposed changes${open.length ? html` <span class="muted">${String(open.length)}</span>` : ''}</h2>
    ${open.length ? html`<ul class="sets-proposal-list">${open.map((p) => {
      const missing = Math.max(0, (p.voters ?? 0) - (p.votes ?? []).length);
      return html`<li class="sets-proposal" data-id="${p.id}">
        <span>${changeOf(p)}</span> <span class="muted small">proposed by ${p.proposed_by ?? '—'}${p.mine ? ' (you)' : ''} · ${at(p.created_at)}</span>
        ${p.reason ? html`<q class="sets-proposal-reason">${p.reason}</q>` : ''}
        <span class="small sets-proposal-how">${how(p)}</span>
        ${p.procedure === 'approval' ? '' : html`<span class="sets-votes small" title="${(p.votes ?? []).map((v) => `${v.by ?? '—'}: ${VOTE_LABEL[v.vote]}`).join(', ')}">
          <b>${String(count(p, 'yes'))}</b> yes · <b>${String(count(p, 'no'))}</b> no · <b>${String(count(p, 'abstain'))}</b> abstain${missing ? ` · ${String(missing)} not voted yet` : ''}
          ${(p.votes ?? []).length ? html` <span class="muted">(${(p.votes ?? []).map((v) => `${v.by ?? '—'}: ${VOTE_LABEL[v.vote]}`).join(', ')})</span>` : ''}</span>`}
        ${p.procedure === 'approval' || p.tie_at || locked ? '' : html`<span class="sets-vote">${(['yes', 'no', 'abstain'] as const).map((v) => html`<button type="button"
          class="link-button${p.my_vote === v ? ' on' : ''}" data-vote="${v}" aria-pressed="${String(p.my_vote === v)}">${VOTE_LABEL[v]}</button> `)}</span>`}
        ${mayDecide(p) ? html`<span class="sets-decide"><button type="button" data-decide="accepted">Accept</button> <button type="button" class="secondary" data-decide="rejected">Reject</button></span>` : ''}
        ${p.mine ? html`<button type="button" class="link-button small" data-withdraw="${p.id}">Withdraw</button>` : ''}</li>`;
    })}</ul>` : html`<p class="muted small">Nothing waiting.</p>`}
    ${decided.length ? html`<details class="sets-decided"><summary class="small">Decided lately (${String(decided.length)})</summary><ul class="small">${decided.map((p) => html`<li>${changeOf(p)} — <b>${OUTCOME[p.outcome ?? ''] ?? p.outcome}</b>
      <span class="muted">${p.by_vote ? 'by the vote' : p.decided_by ? `by ${p.decided_by}` : ''} · ${p.decided_at ? at(p.decided_at) : ''} · proposed by ${p.proposed_by ?? '—'}</span></li>`)}</ul></details>` : ''}
    <p class="sets-proposals-msg small" role="status"></p>`);
  const msg = box.querySelector<HTMLElement>('.sets-proposals-msg')!;
  const fail = (err: Error) => { msg.textContent = err.message; };
  box.querySelectorAll<HTMLElement>('.sets-proposal').forEach((li) => {
    li.querySelectorAll<HTMLButtonElement>('[data-vote]').forEach((b) => b.addEventListener('click', () => { voteOn(id, li.dataset.id!, b.dataset.vote as Vote).then(reload).catch(fail); }));
    li.querySelectorAll<HTMLButtonElement>('[data-decide]').forEach((b) => b.addEventListener('click', () => { decideProposal(id, li.dataset.id!, b.dataset.decide as 'accepted' | 'rejected').then(reload).catch(fail); }));
    li.querySelector<HTMLButtonElement>('[data-withdraw]')?.addEventListener('click', () => { withdrawProposal(id, li.dataset.id!).then(reload).catch(fail); });
  });
}

/** A set's members (226, 228): the owner and everyone else with their part, since when, how many entries they added;
 *  hide someone in the chat (only your view — no one is told), report a name; the owner removes someone from the chat
 *  (their rights: "Sharing and members"). */
function members(box: HTMLElement, set: StudySet, id: string, owner: boolean, chatChanged: () => void) {
  const since = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const load = () => getSetMembers(id).then((list) => {
    render(box, html`<h2>Members <span class="muted">${String(list.length)}</span></h2>
      ${owner ? html`<p class="muted small">Rights, invitations and links: <a href="#sets-sharing">Sharing and members</a>.</p>` : ''}
      <ul class="sets-member-list">${list.map((m) => html`<li data-member="${m.id}"><b>${m.name ?? '—'}</b>
        <span class="tag" title="${rightsText(m.rights as RightsKey, set)}">${RIGHTS_NAME[m.rights as RightsKey]}</span>${m.me ? html` <span class="muted small">(you)</span>` : ''}
        <span class="muted small">since ${since(m.since)} · ${String(m.added)} ${m.added === 1 ? 'entry' : 'entries'} added</span>
        ${m.chat && m.removed ? html` <span class="tag">removed from the chat</span>` : ''}${m.blocked ? html` <span class="tag" title="Their messages are hidden for you in every set's chat; unblock them on Friends">blocked by you</span>`
          : m.hidden ? html` <span class="tag" title="Only you see this">hidden by you</span>` : ''}
        ${m.me ? '' : html`<span class="sets-member-actions small">
          ${m.chat && !m.blocked ? html`<button type="button" class="link-button" data-hide="${m.id}" data-on="${m.hidden ? '0' : '1'}" title="${m.hidden ? 'Show their messages again' : 'Hide their messages in your view of the chat — no one is told, not the owner and not them'}">${m.hidden ? 'Show their messages' : 'Hide in the chat'}</button>` : ''}
          <button type="button" class="link-button" data-report="${m.id}">Report</button>
          ${owner && m.chat && m.role !== 'owner' ? html`<button type="button" class="link-button" data-${m.removed ? 'readmit' : 'remove'}="${m.id}">${m.removed ? 'Let back into the chat' : 'Remove from the chat'}</button>` : ''}</span>`}</li>`)}</ul>
      <p class="sets-members-msg small" role="status"></p>`);
    const msg = box.querySelector<HTMLElement>('.sets-members-msg')!;
    const after = () => { void load(); chatChanged(); };
    box.querySelectorAll<HTMLButtonElement>('[data-hide]').forEach((b) => b.addEventListener('click', () => {
      hideInSetChat(id, b.dataset.hide!, b.dataset.on === '1').then(after).catch((err: Error) => { msg.textContent = err.message; });
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-report]').forEach((b) => b.addEventListener('click', () => {
      const note = window.prompt('Report this member (their name or what they do) to the site\'s administrators? What happened? (optional)');
      if (note === null) return;
      reportSetChat(id, { account: b.dataset.report! }, note).then(() => { msg.textContent = 'Reported — thank you.'; }).catch((err: Error) => { msg.textContent = err.message; });
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      if (confirm('Remove them from the chat? Everyone sees that they were removed.')) setChatMember(id, 'remove', b.dataset.remove!).then(after).catch((err: Error) => { msg.textContent = err.message; });
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-readmit]').forEach((b) => b.addEventListener('click', () => { setChatMember(id, 'readmit', b.dataset.readmit!).then(after).catch(() => {}); }));
  }).catch(() => render(box, html`<p class="muted small">The members could not be loaded.</p>`));
  void load();
}

let chatStream: EventSource | null = null;
/** A set's chat (225): its owner and editors; the owner switches it on, removes members, deletes messages; anyone
 *  reports a message or a member. Live: the account's event stream says when the set has a new line. */
function setChat(box: HTMLElement, id: string, owner: boolean) {
  chatStream?.close();
  chatStream = null;
  let shown: SetChatMessage[] = [];
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const line = (m: SetChatMessage) => (m.kind === 'system' ? html`<li class="chat-system muted small">${m.body} · ${when(m.at)}</li>`
    : m.deleted ? html`<li class="chat-msg chat-deleted muted small"><i>${m.deleted === 'owner' ? 'message deleted by the owner of the set' : 'message deleted'}</i></li>`
      : m.hidden ? html`<li class="chat-msg chat-hidden muted small" data-id="${m.id}"><i>${m.hidden === 'blocked' ? 'You have blocked this user; their message is hidden.' : 'You have hidden this user\'s message.'}</i>
        <button type="button" class="link-button" data-reveal="${m.id}" title="You hid ${m.by ?? 'them'} in this chat — show this one message">show</button></li>`
      : html`<li class="chat-msg${m.mine ? ' mine' : ''}" data-id="${m.id}"><b class="chat-by">${m.by ?? '—'}</b> <span class="chat-body">${m.body}</span>
        <span class="chat-meta muted small">${when(m.at)}
          ${m.mine || owner ? html` <button type="button" class="link-button" data-del="${m.id}" title="${m.mine ? 'Delete your message' : 'Delete as the owner of the set'}">delete</button>` : ''}
          ${m.mine ? '' : html` <button type="button" class="link-button" data-report-msg="${m.id}">report</button>`}</span></li>`);
  const load = () => getSetChat(id).then((r) => {
    if (!r) return;
    if (!r.on) {
      render(box, owner ? html`<h2>Chat</h2><p class="small">A chat for you and the set's editors — whether they are friends or not. You can remove members from it and delete messages.</p>
        <button type="button" class="sets-chat-on">Allow a chat for this set</button>` : html``);
      box.querySelector('.sets-chat-on')?.addEventListener('click', () => { switchSetChat(id, true).then(load).catch(() => {}); });
      return;
    }
    if (r.removed && !owner) { render(box, html`<h2>Chat</h2><p class="muted small">The owner removed you from this set's chat.</p>`); return; }
    shown = r.messages;
    const others = r.members.filter((m) => !m.me);
    render(box, html`<h2>Chat <span class="muted small">${String(r.members.filter((m) => !m.removed).length)} members</span></h2>
      <ol class="chat-list sets-chat-list" aria-live="polite">${shown.length ? shown.map(line) : html`<li class="muted">No messages yet.</li>`}</ol>
      <form class="chat-form"><textarea name="body" rows="2" maxlength="4000" placeholder="Write to everyone in this set — Enter sends" aria-label="Message to the set" required></textarea><button type="submit">Send</button></form>
      <details class="sets-chat-members small"><summary>Members</summary><ul>${r.members.map((m) => html`<li data-member="${m.id}">${m.name ?? '—'}${m.owner ? html` <span class="tag">owner</span>` : ''}${m.removed ? html` <span class="tag">removed</span>` : ''}${m.me ? html` <span class="muted">(you)</span>` : ''}
        ${owner && !m.owner ? (m.removed ? html` <button type="button" class="link-button" data-readmit="${m.id}">Let back in</button>` : html` <button type="button" class="link-button" data-remove="${m.id}">Remove from the chat</button>`) : ''}
        ${m.me ? '' : m.blocked ? html` <span class="tag" title="Their messages are hidden for you; unblock them on Friends">blocked by you</span>` : html` <button type="button" class="link-button" data-hide="${m.id}" data-on="${m.hidden ? '0' : '1'}" title="${m.hidden ? 'Show their messages again' : 'Hide their messages in your view — no one is told'}">${m.hidden ? 'show their messages' : 'hide'}</button>
          <button type="button" class="link-button" data-report-user="${m.id}">report</button>`}</li>`)}</ul>
        ${owner ? html`<p><button type="button" class="link-button sets-chat-off">Switch the chat off</button> <span class="muted">— the messages stay; on again, they are back.</span></p>` : ''}</details>
      <p class="chat-msg-status small" role="status"></p>`);
    void others;
    const status = box.querySelector<HTMLElement>('.chat-msg-status')!;
    const ol = box.querySelector<HTMLElement>('.sets-chat-list')!;
    ol.scrollTop = ol.scrollHeight;
    const form = box.querySelector<HTMLFormElement>('.chat-form')!;
    const ta = form.querySelector('textarea')!;
    form.addEventListener('submit', (e) => { e.preventDefault(); const b = ta.value.trim(); if (!b) return; postSetChat(id, b).then(() => { ta.value = ''; return load(); }).catch((err: Error) => { status.textContent = err.message; }); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    box.querySelectorAll<HTMLButtonElement>('[data-reveal]').forEach((b) => b.addEventListener('click', () => {
      const m = shown.find((x) => x.id === b.dataset.reveal);
      if (m) { m.hidden = null; b.closest('li')!.outerHTML = line(m).value; }
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm(owner && !b.closest('.mine') ? 'Delete this message? Everyone sees “message deleted by the owner of the set”.' : 'Delete your message?')) return;
      deleteSetChat(id, b.dataset.del!).then(load).catch((err: Error) => { status.textContent = err.message; });
    }));
    const report = (what: { message?: string; account?: string }, label: string) => {
      const note = window.prompt(`Report ${label} to the site's administrators? What happened? (optional)`);
      if (note === null) return;
      reportSetChat(id, what, note).then(() => { status.textContent = 'Reported — thank you.'; }).catch((err: Error) => { status.textContent = err.message; });
    };
    box.querySelectorAll<HTMLButtonElement>('[data-report-msg]').forEach((b) => b.addEventListener('click', () => report({ message: b.dataset.reportMsg! }, 'this message')));
    box.querySelectorAll<HTMLButtonElement>('[data-report-user]').forEach((b) => b.addEventListener('click', () => report({ account: b.dataset.reportUser! }, 'this member (their name)')));
    box.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      if (confirm('Remove them from the chat? Everyone sees that they were removed; they stay an editor of the set unless you remove them there too.')) setChatMember(id, 'remove', b.dataset.remove!).then(load).catch((err: Error) => { status.textContent = err.message; });
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-hide]').forEach((b) => b.addEventListener('click', () => {
      hideInSetChat(id, b.dataset.hide!, b.dataset.on === '1').then(load).catch((err: Error) => { status.textContent = err.message; });
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-readmit]').forEach((b) => b.addEventListener('click', () => { setChatMember(id, 'readmit', b.dataset.readmit!).then(load).catch(() => {}); }));
    box.querySelector('.sets-chat-off')?.addEventListener('click', () => { if (confirm('Switch the chat off for everyone?')) switchSetChat(id, false).then(load).catch(() => {}); });
  }).catch(() => render(box, html`<p class="muted small">The chat could not be loaded.</p>`));
  void load();
  chatStream = chatEvents();
  chatStream?.addEventListener('set', (e) => { if ((JSON.parse((e as MessageEvent<string>).data) as { set: string }).set === id && document.body.contains(box)) void load(); });
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

/** The owner's "Sharing and members" (228): who sees the set; its members with their rights (changed, chat for
 *  viewers, handed the set, removed); friends invited with rights; links with rights (turned off one by one); how
 *  votes work — and what every kind of rights means, in the same words the members see. */
function ownerPanel(details: HTMLDetailsElement, set: StudySet, id: string, reload: () => void) {
  const box = details.querySelector<HTMLElement>('.sets-share-body')!;
  let publicName: string | null = null;
  const rightsSelect = (name: string, value: SetRights = 'view') => html`<select name="${name}" aria-label="Rights">${RIGHTS.map((r) => html`<option value="${r}"${r === value ? ' selected' : ''}>${RIGHTS_NAME[r]}</option>`)}</select>`;
  const draw = (sh: SetSharing, note = '') => {
    const members = set.members ?? [];
    const vis = sh.settings.visibility;
    const active = sh.links.filter((l) => !l.closed);
    const ended = sh.links.filter((l) => l.closed);
    const today = new Date().toISOString().slice(0, 10);
    render(box, html`<div class="sets-panel">
      <p class="sets-share-msg small flash ok" role="status"${note ? '' : ' hidden'}>${note}</p>
      <section><h3>Who can see it</h3>
        <form class="sets-vis-form">${VISIBILITY.map((v) => html`<label class="check"><input type="radio" name="visibility" value="${v}"${vis === v ? ' checked' : ''}> <span><b>${VIS_LABEL[v]}</b> <span class="muted small">— ${VIS_HELP[v]}</span></span></label>`)}
          <label>Your public name <input name="public_name" value="${publicName ?? ''}" maxlength="60" placeholder="Shown to members and on public sets" autocomplete="nickname">
            <span class="muted small">— never your login name; the same on all your sets</span></label>
          <button type="submit">Save</button>
          ${vis === 'public' && set.code ? html`<p class="sets-share-link"><input readonly value="${shareUrl(set.code)}" aria-label="Address of the public set"> <button type="button" class="sets-copy-link">Copy</button></p>` : ''}</form></section>

      <section><h3>Members <span class="muted">${String(members.length)}</span></h3>
        ${members.length ? html`<ul class="sets-panel-members">${members.map((m) => html`<li data-member="${m.id}"><b>${m.name ?? '—'}</b>
          ${rightsSelect('rights', m.rights)}
          ${m.rights === 'view' ? html`<label class="check small"><input type="checkbox" name="chat"${m.chat ? ' checked' : ''}> <span>may use the chat</span></label>` : ''}
          <button type="button" class="link-button small" data-owner="${m.id}" title="They own the set from then on; you stay as a member with full rights">Hand the set over</button>
          <button type="button" class="link-button small danger-link" data-remove="${m.id}">Remove</button></li>`)}</ul>`
          : html`<p class="muted small">No members yet — invite friends or send a link.</p>`}</section>

      <section><h3>Invite a friend</h3>
        ${sh.friends.length ? html`<form class="sets-invite-form"><select name="account" aria-label="Friend">${sh.friends.map((f) => html`<option value="${f.id}">${f.name ?? '—'}</option>`)}</select>
          ${rightsSelect('rights')}<label class="check small sets-invite-chat"><input type="checkbox" name="chat"> <span>may use the chat (viewers)</span></label>
          <button type="submit">Invite</button></form>
          <p class="muted small">They find the invitation, with the rights it gives, among their sets and accept or decline it.</p>`
          : html`<p class="muted small">Friends who aren't members yet appear here — add friends on <a href="/friends">Friends</a>, or send a link.</p>`}
        ${sh.invitations.length ? html`<ul class="small">${sh.invitations.map((i) => html`<li>${i.name ?? '—'} — ${RIGHTS_NAME[i.rights]}${i.chat && i.rights === 'view' ? ', with the chat' : ''}
          <span class="muted">invited ${day(i.invited_at)}, not answered yet</span> <button type="button" class="link-button" data-cancel="${i.id}">Cancel</button></li>`)}</ul>` : ''}</section>

      <section><h3>Links</h3>
        <p class="muted small">Anyone with an account who has a link can join with the rights it gives — send each only to those you mean. A link can end by itself on a day you choose or after a number of people have joined; turned off, expired or full, it lets no one new in — who joined with it stays.</p>
        <form class="sets-link-form">${rightsSelect('rights')}
          <label class="small">Last day <input type="date" name="expires_on" min="${today}" aria-label="Last day the link works (optional)"></label>
          <label class="small">At most <input type="number" name="max_joins" min="1" max="5000" placeholder="any" aria-label="At most how many people join with it (optional)"> people</label>
          <button type="submit">Make a link</button></form>
        <p class="muted small">Both optional: without a last day the link works until you turn it off; without a number anyone who has it can join.</p>
        ${active.length ? html`<ul class="sets-links">${active.map((l) => html`<li data-link="${l.id}"><span class="tag">${RIGHTS_NAME[l.rights]}</span>
          <input readonly value="${joinUrl(l.code)}" aria-label="Link: ${RIGHTS_NAME[l.rights]}"> <button type="button" class="sets-link-copy">Copy</button>
          <span class="muted small">${l.max_joins ? `${String(l.joined)} of ${String(l.max_joins)} joined` : `${plural(l.joined, 'person', 'people')} joined`}${l.expires_at ? ` · works until ${linkEnd(l.expires_at)}` : ''}</span>
          <button type="button" class="link-button" data-end="${l.id}">Turn off</button></li>`)}</ul>` : ''}
        ${ended.length ? html`<details class="small"><summary>No longer open (${String(ended.length)})</summary><ul>${ended.map((l) => html`<li class="muted">${RIGHTS_NAME[l.rights]} · made ${day(l.created_at)} ·
          ${l.closed === 'off' ? `turned off ${day(l.ended_at!)}` : l.closed === 'expired' ? `expired ${linkEnd(l.expires_at!)}` : 'full'} · ${l.max_joins ? `${String(l.joined)} of ${String(l.max_joins)}` : plural(l.joined, 'person', 'people')} joined</li>`)}</ul></details>` : ''}</section>

      <section><h3>Votes</h3>
        <form class="sets-votes-form"><p class="small">For members who edit <b>with votes</b> — a set votes one way or the other:</p>
          <label class="check"><input type="radio" name="vote_mode" value="advisory"${sh.settings.vote_mode === 'advisory' ? ' checked' : ''}> <span><b>Advisory</b> <span class="muted small">— ${voteRules('advisory', sh.settings.vote_hours, false)}</span></span></label>
          <label class="check"><input type="radio" name="vote_mode" value="binding"${sh.settings.vote_mode === 'binding' ? ' checked' : ''}> <span><b>Binding</b> <span class="muted small">— the vote decides; it lasts the hours below.</span></span></label>
          <label>A vote lasts <input type="number" name="vote_hours" min="1" max="24" value="${String(sh.settings.vote_hours)}"> hours <span class="muted small">(1–24)</span></label>
          <label class="check"><input type="checkbox" name="owner_veto"${sh.settings.owner_veto ? ' checked' : ''}> <span>Keep a veto: I may decide a binding vote before it ends <span class="muted small">— the members see that you have it</span></span></label>
          <button type="submit">Save</button></form></section>

      <section><h3>What each part may do</h3><dl class="sets-rights-legend small">
        ${(['owner', ...RIGHTS] as RightsKey[]).map((r) => html`<dt>${RIGHTS_NAME[r]}</dt><dd>${rightsText(r, sh.settings)}</dd>`)}</dl>
        <p class="muted small">Every member sees their own part in these words at the top of the set, and on an invitation or link before they join.</p></section>
      <p class="sets-panel-msg small" role="status"></p></div>`);
    const msg = box.querySelector<HTMLElement>('.sets-panel-msg')!;
    const fail = (err: Error) => { msg.textContent = err.message; };
    /** the public name as typed above — sharing with someone needs one */
    const typedName = () => box.querySelector<HTMLInputElement>('.sets-vis-form input[name=public_name]')?.value.trim() || publicName || '';
    const again = (note: string) => getSharing(id).then((x) => { if (x) draw(x, note); }).catch(fail);
    const changed = (note: string) => getSet({ own: id }).then((r) => { if (r) Object.assign(set, r.set); return again(note); });
    box.querySelector<HTMLFormElement>('.sets-vis-form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const visibility = (f.elements.namedItem('visibility') as RadioNodeList).value as Visibility;
      if (visibility === 'private' && (set.members?.length || sh.links.some((l) => !l.ended_at) || sh.invitations.length)
        && !confirm('Make it private? All members leave the set, open invitations end, links stop working and open proposals close. Only you will see it.')) return;
      shareSet(id, { visibility, public_name: (f.elements.namedItem('public_name') as HTMLInputElement).value }).then((r) => {
        if (!r) return;
        publicName = r.public_name;
        Object.assign(set, r.set);
        void again(visibility === 'private' ? 'Private: only you see it now.' : visibility === 'public' ? 'Public: anyone can see it and it is listed under Shared sets.' : 'Shared: only its members see it.');
        const h1 = document.querySelector('.sets-page h1');
        if (h1) render(h1, html`${set.name}${visBadge(set)}${together(set)}`);
      }).catch(fail);
    });
    box.querySelector('.sets-copy-link')?.addEventListener('click', (e) => copyFrom((e.target as HTMLElement).previousElementSibling as HTMLInputElement, msg));
    box.querySelectorAll<HTMLLIElement>('[data-member]').forEach((li) => {
      const who = li.dataset.member!;
      li.querySelector('select')!.addEventListener('change', (e) => {
        const rights = (e.target as HTMLSelectElement).value as SetRights;
        changeMember(id, who, { action: 'rights', rights }).then(() => changed(`Now: ${RIGHTS_NAME[rights]}.`)).catch(fail);
      });
      li.querySelector<HTMLInputElement>('input[name=chat]')?.addEventListener('change', (e) => {
        changeMember(id, who, { action: 'chat', on: (e.target as HTMLInputElement).checked ? '1' : '0' }).then(() => changed('Saved.')).catch(fail);
      });
    });
    box.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      if (confirm('Remove them from the set? Their progress stays theirs; their open proposals stay until decided.')) changeMember(id, b.dataset.remove!, { action: 'remove' }).then(() => changed('Removed.')).catch(fail);
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-owner]').forEach((b) => b.addEventListener('click', () => {
      if (confirm('Hand the set over? They own it from then on — they decide about members, links and votes, and can delete it. You stay as a member with full rights.')) {
        changeMember(id, b.dataset.owner!, { action: 'owner' }).then(reload).catch(fail);
      }
    }));
    const invite = box.querySelector<HTMLFormElement>('.sets-invite-form');
    invite?.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = (n: string) => (invite.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement).value;
      inviteToSet(id, v('account'), v('rights') as SetRights, (invite.elements.namedItem('chat') as HTMLInputElement).checked, typedName())
        .then(() => changed('Invited — they see the invitation among their sets.')).catch(fail);
    });
    box.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((b) => b.addEventListener('click', () => { cancelInvitation(id, b.dataset.cancel!).then(() => again('Invitation cancelled.')).catch(fail); }));
    const linkForm = box.querySelector<HTMLFormElement>('.sets-link-form')!;
    linkForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const rights = (linkForm.elements.namedItem('rights') as HTMLSelectElement).value as SetRights;
      const field = (n: string) => (linkForm.elements.namedItem(n) as HTMLInputElement).value.trim();
      newSetLink(id, rights, typedName(), { expires_on: field('expires_on'), max_joins: field('max_joins') }).then(() => { publicName = typedName() || publicName; }).then(() => changed(`Link made: ${RIGHTS_NAME[rights]} — copy it and send it.`)).catch(fail);
    });
    box.querySelectorAll<HTMLButtonElement>('.sets-link-copy').forEach((b) => b.addEventListener('click', () => copyFrom(b.previousElementSibling as HTMLInputElement, msg)));
    box.querySelectorAll<HTMLButtonElement>('[data-end]').forEach((b) => b.addEventListener('click', () => {
      if (confirm('Turn this link off? No one new can join with it; who joined stays. This can\'t be undone — make a new link instead.')) endSetLink(id, b.dataset.end!).then(() => again('The link is off.')).catch(fail);
    }));
    const votes = box.querySelector<HTMLFormElement>('.sets-votes-form')!;
    votes.addEventListener('submit', (e) => {
      e.preventDefault();
      saveVoteSettings(id, { vote_mode: (votes.elements.namedItem('vote_mode') as RadioNodeList).value as VoteMode, vote_hours: (votes.elements.namedItem('vote_hours') as HTMLInputElement).value,
        owner_veto: (votes.elements.namedItem('owner_veto') as HTMLInputElement).checked ? '1' : '0' })
        .then((s) => { if (s) Object.assign(set, s); return changed('Saved — open votes keep the rules they started with.'); }).catch(fail);
    });
  };
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    Promise.all([getSharing(id), getSets()]).then(([sh, r]) => { publicName = r?.public_name ?? null; if (sh) draw(sh); })
      .catch(() => render(box, html`<p class="muted">This could not be loaded.</p>`));
  });
}
/** a link's end: the last day it works (it ends at midnight after it, Zurich) — "12 November 2026" */
const linkEnd = (iso: string) => new Date(new Date(iso).getTime() - 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
const copyFrom = (input: HTMLInputElement, msg: HTMLElement) => {
  navigator.clipboard?.writeText(input.value).then(() => { msg.textContent = 'Link copied.'; }, () => { input.select(); });
};

/** /sets/join/<code>: what the link is for and the rights it gives, in plain words; logged in → join (a public name
 *  first if none). */
function joinView(main: HTMLElement, code: string) {
  document.title = 'Join a study set · Art History';
  Promise.all([getInvitation(code), account()]).then(async ([inv, me]) => {
    if (!inv) return failed(main, 'This link could not be loaded.');
    if (inv.role && inv.set.id) { location.replace(`/sets/${inv.set.id}`); return; }
    const r = inv.rights;
    render(main, html`<section class="page sets-page"><p class="crumbs"><a href="/sets">Study sets</a> / Join</p>
      <h1>Join “${inv.set.name}”</h1>
      <p>${inv.set.creator ?? 'Someone'} shares this set${inv.set.topic ? html` (<span class="sets-topic">${inv.set.topic}</span>)` : ''} with you:
        ${plural(inv.set.count, 'entry', 'entries')} so far, ${plural(inv.set.members, 'member')} besides the owner.</p>
      <div class="sets-your-part"><p><b>You join as: ${RIGHTS_NAME[r]}</b></p><p class="small">${rightsText(r, { vote_mode: inv.set.vote_mode })}</p>
        <p class="small muted">The owner can change your rights later, and you can leave the set at any time. What you know of the cards, your results and your exam date stay your own; the other members see your public name.</p></div>
      ${me ? html`<form class="sets-join">${inv.public_name ? html`<p class="muted small">The others see you as <b>${inv.public_name}</b>.</p>`
        : html`<label>Your public name — the others see it, never your username <input name="public_name" maxlength="60" required autocomplete="nickname"></label>`}
        <button type="submit">Join as ${r === 'view' ? 'a viewer' : 'an editor'}</button> <span class="sets-msg small" role="status"></span></form>`
        : html`<p>${await accountLinks()}</p>`}</section>`);
    main.querySelector<HTMLFormElement>('.sets-join')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const name = (f.elements.namedItem('public_name') as HTMLInputElement | null)?.value ?? '';
      joinSet(code, name).then((s) => { if (s) location.assign(`/sets/${s.id}`); })
        .catch((err: Error) => { f.querySelector('.sets-msg')!.textContent = err.message; });
    });
  }).catch((err: unknown) => {
    const closed = err instanceof ApiError ? (err.body as { closed?: string } | null)?.closed : undefined;
    failed(main, closed === 'expired' ? 'This link has expired — ask the owner of the set for a new one.'
      : closed === 'full' ? 'As many people as this link allows have joined with it already — ask the owner of the set for a new one.'
        : 'This link is not valid (any more) — the owner may have turned it off. Ask them for a new one.');
  });
}

/** /sets/results (229): every round of the account, by set — each with the set as it was then (name, description,
 *  entries), also when the set has changed since, was made private or deleted. A version saved again as a new set;
 *  a set's results deleted. */
function resultsPage(main: HTMLElement) {
  document.title = 'Your results · Study sets · Art History';
  const pct = (known: number, answered: number) => Math.round((100 * known) / answered);
  const ACCESS: Record<string, string> = { own: 'your set', member: 'you are a member', public: 'public set' };
  getResults().then((r) => {
    if (!r) return loggedOut(main);
    render(main, html`<section class="page sets-page"><p class="crumbs"><a href="/sets">Your study sets</a> / Results</p>
      <h1>Your results</h1>
      <p class="muted">Every round you played, by set. Each round keeps the set as it was then — its name, description and
        entries — so your results stay traceable even when the set changes later, is made private or is deleted. Only you see them.</p>
      ${r.sets.length ? r.sets.map((s) => {
        const answered = s.rounds.reduce((a, x) => a + x.answered, 0);
        const known = s.rounds.reduce((a, x) => a + x.known, 0);
        const title = s.access === 'public' && s.code ? html`<a href="/sets/s/${s.code}">${s.name}</a>` : s.id ? html`<a href="/sets/${s.id}">${s.name}</a>` : s.name;
        return html`<section class="sets-group results-set" data-key="${s.key}">
          <h2>${title} <span class="tag${s.access ? '' : ' results-gone'}">${s.access ? ACCESS[s.access] : 'no longer available'}</span></h2>
          <p class="muted small">${plural(s.rounds.length, 'round')} · ${String(pct(known, answered))} % known · last ${day(s.rounds[0].at)}${s.topic ? html` · <span class="sets-topic">${s.topic}</span>` : ''}</p>
          <div class="sets-results-wrap"><table class="sets-results"><thead><tr><th>When</th><th>Quiz</th><th>Known</th><th>Time</th><th>The set then</th></tr></thead><tbody>
            ${s.rounds.map((x) => html`<tr><td class="small">${at(x.at)}</td><th scope="row">${MODE_NAME[x.mode]}</th>
              <td>${String(x.known)} of ${String(x.answered)} (${String(pct(x.known, x.answered))} %)${x.complete ? '' : html` <span class="muted small" title="Left before the end of the round">· left early</span>`}</td>
              <td class="small">${x.seconds === null ? '—' : x.seconds >= 90 ? `${String(Math.round(x.seconds / 60))} min` : `${String(x.seconds)} s`}</td>
              <td><button type="button" class="link-button small" data-snapshot="${x.snapshot.id}">${x.snapshot.name} · ${plural(x.snapshot.item_count, 'entry', 'entries')}</button></td></tr>`)}
          </tbody></table></div>
          <div class="results-snapshot" hidden></div>
          <p class="sets-actions"><button type="button" class="link-button" data-copy="${s.rounds[0].snapshot.id}" title="A set of your own with the entries as they were in your last round">Save as a new set</button>
            <button type="button" class="link-button danger-link" data-forget="${s.key}">Delete these results</button></p></section>`;
      }) : html`<p class="muted">No rounds yet — study a set and your results appear here.</p>`}
      ${r.more ? html`<p class="muted small">The 3000 most recent rounds.</p>` : ''}
      <p class="sets-msg small" role="status"></p></section>`);
    const msg = main.querySelector<HTMLElement>('.sets-msg')!;
    const fail = (err: Error) => { msg.textContent = err.message; };
    const copy = (id: string) => copySnapshot(id).then((c) => {
      if (c) location.assign(`/sets/${c.id}${c.missing ? '?missing=' + String(c.missing) : ''}`);
    }).catch(fail);
    main.querySelectorAll<HTMLButtonElement>('[data-snapshot]').forEach((b) => b.addEventListener('click', () => {
      const box = b.closest('.results-set')!.querySelector<HTMLElement>('.results-snapshot')!;
      if (!box.hidden && box.dataset.id === b.dataset.snapshot) { box.hidden = true; return; }
      getSnapshot(b.dataset.snapshot!).then((x) => {
        if (!x) return;
        box.hidden = false;
        box.dataset.id = x.id;
        render(box, html`<h3>${x.name} <span class="muted small">— as it was on ${at(x.taken_at)}</span></h3>
          ${x.topic ? html`<p class="small"><span class="sets-topic">${x.topic}</span></p>` : ''}
          ${x.description_html ? html`<div class="prose small">${trusted(x.description_html)}</div>` : ''}
          <ol class="results-items">${x.items.map((i) => html`<li>${i.slug ? html`<a href="${href(PLURAL[i.type], i.slug)}">${i.name}</a>` : i.name}
            <span class="muted small">${TYPE_LABEL[i.type]}${i.slug && i.now_name && i.now_name !== i.name ? ` · now “${i.now_name}”` : ''}${i.slug ? '' : ' · no longer on the site'}</span></li>`)}</ol>
          <p><button type="button" class="link-button" data-copy-this="${x.id}">Save this version as a new set</button></p>`);
        box.querySelector<HTMLButtonElement>('[data-copy-this]')!.addEventListener('click', () => { void copy(x.id); });
      }).catch(fail);
    }));
    main.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => b.addEventListener('click', () => { void copy(b.dataset.copy!); }));
    main.querySelectorAll<HTMLButtonElement>('[data-forget]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Delete your results on this set, with the versions of the set kept for them? What you know of its entries stays.')) return;
      forgetResults(b.dataset.forget!).then(() => resultsPage(main)).catch(fail);
    }));
  }).catch(() => failed(main, 'Your results could not be loaded.'));
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
  return html`<h2 class="sets-card-title">Your results</h2>
    ${modes.length ? html`<div class="sets-results-wrap"><table class="sets-results"><thead><tr><th>Quiz</th><th>Rounds</th><th>Known</th><th>Best round</th><th>Last ten rounds</th><th>Time</th><th>Last</th></tr></thead><tbody>
      ${modes.map((m) => { const r = s.modes[m]!; return html`<tr><th scope="row">${MODE_NAME[m]}</th><td>${String(r.rounds)}</td>
        <td>${String(Math.round((100 * r.known) / r.answered))} %</td><td>${r.best === null ? '—' : `${String(r.best)} %`}</td>
        <td><span class="sets-spark" role="img" aria-label="${[...r.recent].reverse().map((p) => `${String(p)} %`).join(', ')}">${[...r.recent].reverse().map((p) => html`<span style="height:${String(Math.max(p, 4))}%" title="${String(p)} %"></span>`)}</span></td>
        <td>${mins(r.seconds)}</td><td class="small">${day(r.last_at)}</td></tr>`; })}</tbody></table></div>`
      : html`<p class="muted small">No round yet — your results per kind of quiz appear here.</p>`}
    ${bar(s.boxes.forward, 'Name it')}${bar(s.boxes.reverse, 'Describe it')}
    <p class="small"><a href="/sets/results">All your results, each round with the set as it was then →</a></p>
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
