// Study sets — see index.ts for the whole picture. This file: common.

import { loginUrl, type Proposed, type SetRef, type SetRights, type StudyItem, type StudyMode, type StudySet, type Visibility, type Vote, type VoteMode } from '../../api';
import { day, plural } from '../../format';
import { html, render, thumb, type Html } from '../../html';
import { loggedOutPage } from '../account';







export type Dir = 'forward' | 'reverse';
export interface SetsRoute { id: string | null; code: string | null; study: boolean; browse: boolean; join: string | null; results?: boolean; params: URLSearchParams }

export const MODE_NAME: Record<StudyMode, string> = { forward: 'Name it', reverse: 'Describe it', both: 'Name it and describe it', typed: 'Type it', choice: 'Pick it' };
export const MODE_HELP: Record<StudyMode, string> = {
  forward: 'picture, definition, facts → the name — you judge yourself',
  reverse: 'the name → picture, facts, definition — you judge yourself',
  both: 'both directions, mixed',
  typed: 'type the name — a small typo still counts',
  choice: 'pick the name among four of this set',
};
export const MODES: StudyMode[] = ['forward', 'reverse', 'both', 'typed', 'choice'];
export const CHOICE_MIN = 4;
export const studyHref = (ref: SetRef) => ('own' in ref ? `/sets/${ref.own}/study` : `/sets/s/${ref.code}/study`);
export const pageHref = (ref: SetRef) => ('own' in ref ? `/sets/${ref.own}` : `/sets/s/${ref.code}`);
export const shareUrl = (code: string) => `${location.origin}/sets/s/${code}`;
export const VISIBILITY: Visibility[] = ['private', 'shared', 'public'];
export const VIS_LABEL: Record<Visibility, string> = { private: 'Private', shared: 'Shared', public: 'Public' };
export const VIS_HELP: Record<Visibility, string> = {
  private: 'only you see it. Making a set private again removes all members, ends open invitations and links, and closes open proposals.',
  shared: 'only its members see it: friends you invite and people who join with one of your links — each with the rights you give them. Not listed anywhere.',
  public: 'anyone can look at it and study it, also without an account, and it is listed under Shared sets. Only you and the members you give editing rights change it, in the way their rights say.',
};
export const joinUrl = (code: string) => `${location.origin}/sets/join/${code}`;

// ---- rights in a set (228): one wording wherever someone meets them (owner 2026-11-05: "clearly communicated to any
// person involved") — the owner's panel, the member's own part, invitations and links before joining, the list
export type RightsKey = SetRights | 'owner';
export const RIGHTS: SetRights[] = ['view', 'full', 'approval', 'vote'];
export const RIGHTS_NAME: Record<RightsKey, string> = { owner: 'Owner', view: 'Viewer', full: 'Editor with full rights', approval: 'Editor with approval', vote: 'Editor with votes' };
const RIGHTS_SHORT: Record<RightsKey, string> = { owner: 'yours', view: 'viewer', full: 'editor', approval: 'editor with approval', vote: 'editor with votes' };
export const VOTE_LABEL: Record<Vote, string> = { yes: 'Yes', no: 'No', abstain: 'Abstain' };
export function voteRules(mode: VoteMode, hours: number, veto: boolean) {
  return mode === 'advisory'
    ? 'The owner and everyone with editing rights vote Yes, No or Abstain; whoever proposes votes Yes by proposing. The owner sees the votes and decides whenever they like — also before everyone has voted.'
    : `The owner and everyone with editing rights vote Yes, No or Abstain; whoever proposes votes Yes by proposing. After ${plural(hours, 'hour')} — or earlier, as soon as the votes still missing can no longer change the result — more Yes than No accepts the change and more No than Yes rejects it; a single vote is enough. If it ends even, the owner decides. When only the owner and the proposer can vote, there is no vote: the change applies at once. ${veto ? 'The owner keeps a veto: they may decide a vote before it ends.' : 'The owner cannot overrule the vote.'}`;
}
export function rightsText(r: RightsKey, s: { vote_mode?: VoteMode; vote_hours?: number; owner_veto?: boolean }) {
  switch (r) {
    case 'owner': return 'Decides who sees the set, invites members and gives each their rights, makes and turns off links, chooses how votes work, and changes the set directly. Only the owner locks, restores, hands over or deletes it.';
    case 'view': return 'Reads and studies the set. Changes nothing and votes on nothing; the set\'s chat only if the owner allows it to them.';
    case 'full': return 'Adds and removes entries and changes the name, topic and description — at once, without asking. Votes on the proposals that are put to the vote.';
    case 'approval': return 'Proposes changes — entries added or removed, a new name, topic or description; each waits until the owner accepts or rejects it. Votes on the proposals that are put to the vote.';
    case 'vote': return `Proposes changes, which are put to the vote. ${voteRules(s.vote_mode ?? 'advisory', s.vote_hours ?? 24, Boolean(s.owner_veto))}`;
  }
}
/** "in 12 days" / "tomorrow" / "today" / "was 3 days ago" — an exam date from the plan's days left */
export const examIn = (days: number) => (days > 1 ? `in ${String(days)} days` : days === 1 ? 'tomorrow' : days === 0 ? 'today' : `was ${String(-days)} day${days === -1 ? '' : 's'} ago`);

export const loginLink = (text = 'Log in') => {
  const next = new URL(location.href);
  next.searchParams.set('login', '1');
  const login = loginUrl(next.href);
  return login ? html`<a href="${login}" rel="nofollow">${text}</a>` : null;
};
export const loggedOut = (main: HTMLElement) => loggedOutPage(main, 'sets-page', 'Study sets', html`<p>Keep artworks, artists, terms, places … from this site in sets of your own — to look them up again, or to learn them
      as index cards for an exam (with a plan for each day until it) — share them, and edit them together with others.</p>`,
  html`<p><a href="/sets/shared">Browse the sets others have shared →</a></p>`);
export const failed = (main: HTMLElement, what: string) => render(main, html`<section class="page sets-page"><p class="flash">${what} <a href="/sets">Study sets</a></p></section>`);

/** "Topic · by X · created … · last changed … · n entries" */
export function meta(set: StudySet, withCreator: boolean) {
  const parts: (Html | string)[] = [];
  if (set.topic) parts.push(html`<span class="sets-topic">${set.topic}</span>`);
  if (withCreator && set.creator) parts.push(html`by <b>${set.creator}</b>`);
  parts.push(`created ${day(set.created_at)}`);
  if (day(set.updated_at) !== day(set.created_at) || set.updated_by) parts.push(`last changed ${day(set.updated_at)}${set.updated_by && set.editors?.length ? ` by ${set.updated_by}` : ''}`);
  parts.push(plural(set.count, 'entry', 'entries'));
  return html`<p class="sets-meta muted small">${parts.map((p, i) => html`${i ? ' · ' : ''}${p}`)}</p>`;
}
export const visBadge = (set: StudySet) => (set.visibility === 'private' ? ''
  : html` <span class="tag sets-vis sets-vis-${set.visibility}" title="${VIS_HELP[set.visibility]}">${set.visibility}</span>`);
/** "3 members" (the owner's) / "editor with approval · Ms X's" (a member's) */
export const together = (s: StudySet) => {
  if (s.role && s.role !== 'owner') return html` <span class="tag sets-together-tag" title="${rightsText((s.rights ?? 'view') as RightsKey, s)}">${RIGHTS_SHORT[(s.rights ?? 'view') as RightsKey]} · ${s.creator ?? 'its owner'}'s</span>`;
  const n = s.members?.length ?? (s.editor_count ?? 0) + (s.viewer_count ?? 0);
  return n ? html` <span class="tag sets-together-tag" title="Others are members of it">${plural(n, 'member')}</span>` : '';
};
export const topicOptions = (topics: string[]) => html`${topics.map((t) => html`<option value="${t}"></option>`)}`;

// ---- one set (own or shared) ------------------------------------------------------------------------------------
export const itemPicture = (i: StudyItem) => (i.image
  ? html`<img class="sets-thumb${i.own ? ' own-image' : ''}" src="${i.own ? i.image : thumb(i.image, 120)}" alt="" loading="lazy"${i.own ? '' : html` crossorigin="anonymous"`}>`
  : html`<span class="sets-thumb sets-thumb-empty" aria-hidden="true"></span>`);

/** The description folded away is remembered per set in this browser (owner 2026-11-06: of no interest once you are
 *  learning the set) — a convenience only, so a blocked storage just shows it open. */
const aboutKey = (ref: SetRef) => `arthistory.set-about.${'own' in ref ? ref.own : `s-${ref.code}`}`;
export function aboutClosed(ref: SetRef) { try { return localStorage.getItem(aboutKey(ref)) === 'closed'; } catch { return false; } }
export function rememberAbout(ref: SetRef, closed: boolean) {
  try { if (closed) localStorage.setItem(aboutKey(ref), 'closed'); else localStorage.removeItem(aboutKey(ref)); } catch { /* private window */ }
}

/** "Proposed: … waits for the owner" — what happens to a change the account proposed (228). */
export function proposedText(p: Proposed, set: StudySet, what: string) {
  const outcomes = [p.proposal?.outcome, ...(p.proposals ?? []).map((x) => x.outcome)].filter(Boolean);
  if (outcomes.length && outcomes.every((o) => o === 'accepted')) return `${what}: done — with only you and the owner voting, there is no vote.`;
  return `${what}: proposed — ${set.rights === 'approval' ? 'it applies once the owner accepts it.'
    : set.vote_mode === 'binding' ? `put to the vote (at most ${String(set.vote_hours ?? 24)} h).` : 'put to the vote; the owner decides.'} See “Proposed changes” below.`;
}

/** The viewer's part in a set (228): their rights in plain words — and how its votes work. */
export function yourPart(set: StudySet) {
  const r = (set.rights ?? 'owner') as RightsKey;
  const votes = set.vote_mode && (r !== 'view');
  return html`<div class="sets-your-part"><p><b>Your part: ${RIGHTS_NAME[r]}</b>${r === 'owner' ? '' : html` <span class="muted small">— given by the owner, ${set.creator ?? '—'}</span>`}</p>
    <p class="small">${rightsText(r, set)}</p>
    ${votes && r !== 'vote' ? html`<p class="small muted">Votes in this set: ${voteRules(set.vote_mode!, set.vote_hours ?? 24, Boolean(set.owner_veto))}</p>` : ''}
    ${r === 'owner' ? '' : html`<p class="small muted">Your progress, results and exam date are your own — nobody else sees them. Your public name is shown to the other members.</p>`}</div>`;
}
export const until = (iso: string) => {
  const min = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  return min <= 0 ? 'now' : min < 60 ? `in ${String(min)} min` : `in ${String(Math.floor(min / 60))} h ${String(min % 60)} min`;
};
