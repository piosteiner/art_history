// Study sets — see index.ts for the whole picture. This file: members.

import { friendAction, getFriends, getSetMembers, hideInSetChat, reportSetChat, setChatMember, type FriendStatus, type StudySet } from '../../api';
import { ask, askText } from '../../dialog';

import { html, render } from '../../html';
import { profileHref } from '../../profile';
import { RIGHTS_NAME, RightsKey, rightsText } from './common';





/** A set's members (226, 228): the owner and everyone else with their part, since when, how many entries they added;
 *  hide someone in the chat (only your view — no one is told), report a name; the owner removes someone from the chat
 *  (their rights: "Sharing and members"). */
export function members(box: HTMLElement, set: StudySet, id: string, owner: boolean, chatChanged: () => void) {
  const since = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const load = (): Promise<void> => Promise.all([getSetMembers(id), friendStatuses()]).then(([list, friends]) => {
    render(box, html`<h2>Members <span class="muted">${String(list.length)}</span></h2>
      ${owner ? html`<p class="muted small">Rights and invitations: <a href="#sets-members-panel">Members</a> · links: <a href="#sets-sharing">Sharing</a>.</p>` : ''}
      <ul class="sets-member-list">${list.map((m) => html`<li data-member="${m.id}"><b>${who(m)}</b>
        <span class="tag" title="${rightsText(m.rights as RightsKey, set)}">${RIGHTS_NAME[m.rights as RightsKey]}</span>${m.me ? html` <span class="muted small">(you)</span>` : ''}
        <span class="muted small">since ${since(m.since)} · ${String(m.added)} ${m.added === 1 ? 'entry' : 'entries'} added</span>
        ${m.chat && m.removed ? html` <span class="tag">removed from the chat</span>` : ''}${m.blocked ? html` <span class="tag" title="Their messages are hidden for you in every set's chat; unblock them on Friends">blocked by you</span>`
          : m.hidden ? html` <span class="tag" title="Only you see this">hidden by you</span>` : ''}
        ${m.me ? '' : html`<span class="sets-member-actions small">
          ${friendButton(m.id, friends.get(m.id) ?? 'none')}
          ${m.chat && !m.blocked ? html`<button type="button" class="link-button" data-hide="${m.id}" data-on="${m.hidden ? '0' : '1'}" title="${m.hidden ? 'Show their messages again' : 'Hide their messages in your view of the chat — no one is told, not the owner and not them'}">${m.hidden ? 'Show their messages' : 'Hide in the chat'}</button>` : ''}
          <button type="button" class="link-button" data-report="${m.id}">Report</button>
          ${owner && m.chat && m.role !== 'owner' ? html`<button type="button" class="link-button" data-${m.removed ? 'readmit' : 'remove'}="${m.id}">${m.removed ? 'Let back into the chat' : 'Remove from the chat'}</button>` : ''}</span>`}</li>`)}</ul>
      <p class="sets-members-msg small" role="status"></p>`);
    const msg = box.querySelector<HTMLElement>('.sets-members-msg')!;
    const after = () => { void load(); chatChanged(); };
    friendButtons(box, (note) => { void load().then(() => { const x = box.querySelector('.sets-members-msg'); if (x) x.textContent = note; }); }, (err) => { msg.textContent = err.message; });
    box.querySelectorAll<HTMLButtonElement>('[data-hide]').forEach((b) => b.addEventListener('click', () => {
      hideInSetChat(id, b.dataset.hide!, b.dataset.on === '1').then(after).catch((err: Error) => { msg.textContent = err.message; });
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-report]').forEach((b) => b.addEventListener('click', async () => {
      const note = (await askText('Report this member (their name or what they do) to the site\'s administrators?', { title: 'Report this member', label: 'What happened? (optional)', multiline: true, maxLength: 1000, ok: 'Report' }));
      if (note === null) return;
      reportSetChat(id, { account: b.dataset.report! }, note).then(() => { msg.textContent = 'Reported — thank you.'; }).catch((err: Error) => { msg.textContent = err.message; });
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if ((await ask('Remove them from the chat? Everyone sees that they were removed.', { title: 'Remove them from the chat?', ok: 'Remove', danger: true }))) setChatMember(id, 'remove', b.dataset.remove!).then(after).catch((err: Error) => { msg.textContent = err.message; });
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-readmit]').forEach((b) => b.addEventListener('click', () => { setChatMember(id, 'readmit', b.dataset.readmit!).then(after).catch(() => {}); }));
  }).catch(() => render(box, html`<p class="muted small">The members could not be loaded.</p>`));
  void load();
}

/** A member's friendship with the viewer, as a button or a note (owner 2026-11-06: friend requests from the members list) */
export const friendButton = (id: string, status: FriendStatus | undefined) => (status === 'none' ? html`<button type="button" class="link-button" data-befriend="${id}">Add as friend</button>`
  : status === 'received' ? html`<button type="button" class="link-button" data-accept-friend="${id}">Accept their friend request</button>`
    : status === 'sent' ? html`<span class="muted">friend request sent</span>` : status === 'friend' ? html`<a class="muted" href="/friends">friend</a>` : '');
export function friendButtons(box: HTMLElement, done: (note: string) => void, fail: (err: Error) => void) {
  box.querySelectorAll<HTMLButtonElement>('[data-befriend]').forEach((b) => b.addEventListener('click', () => {
    friendAction('request', b.dataset.befriend!).then(() => done('Friend request sent.')).catch(fail);
  }));
  box.querySelectorAll<HTMLButtonElement>('[data-accept-friend]').forEach((b) => b.addEventListener('click', () => {
    friendAction('accept', b.dataset.acceptFriend!).then(() => done('You are friends now.')).catch(fail);
  }));
}
/** a member's name: a link to their profile (2026-11-07) — not one's own, not without a public name */
export const who = (m: { id: string; name: string | null; me?: boolean }) => (m.name && !m.me ? html`<a class="sets-person" href="${profileHref(m.id)}" title="Their profile: sets you share, their public sets">${m.name}</a>` : m.name ?? '—');
export const friendStatuses = () => getFriends().then((r) => new Map((r?.people ?? []).map((p) => [p.id, p.status]))).catch(() => new Map<string, FriendStatus>());
