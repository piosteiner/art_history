// Study sets — see index.ts for the whole picture. This file: chat.

import { chatEvents, deleteSetChat, friendAction, getSetChat, hideInSetChat, postSetChat, reportSetChat, setChatMember, switchSetChat, type FriendStatus, type SetChatMessage } from '../../api';
import { ask, askText } from '../../dialog';
import { chatText, emoteHover, emotesReady, suggest } from '../../emotes';
import { when } from '../../format';
import { html, render } from '../../html';
import { showProfile } from '../../profile';


import { friendStatuses, who } from './members';




let chatStream: EventSource | null = null;
let setSuggest: { destroy: () => void } | null = null;
/** A set's chat (225): its owner and editors; the owner switches it on, removes members, deletes messages; anyone
 *  reports a message or a member. Live: the account's event stream says when the set has a new line. */
export function setChat(box: HTMLElement, id: string, owner: boolean) {
  chatStream?.close();
  chatStream = null;
  let shown: SetChatMessage[] = [];
  const line = (m: SetChatMessage) => (m.kind === 'system' ? html`<li class="chat-system muted small">${m.body} · ${when(m.at)}</li>`
    : m.deleted ? html`<li class="chat-msg chat-deleted muted small"><i>${m.deleted === 'owner' ? 'message deleted by the owner of the set' : 'message deleted'}</i></li>`
      : m.hidden ? html`<li class="chat-msg chat-hidden muted small" data-id="${m.id}"><i>${m.hidden === 'blocked' ? 'You have blocked this user; their message is hidden.' : 'You have hidden this user\'s message.'}</i>
        <button type="button" class="link-button" data-reveal="${m.id}" title="You hid ${m.by ?? 'them'} in this chat — show this one message">show</button></li>`
      : m.mine || !m.by_id ? html`<li class="chat-msg${m.mine ? ' mine' : ''}" data-id="${m.id}"><b class="chat-by">${m.by ?? '—'}</b> <span class="chat-body">${chatText(m.body ?? '')}</span><span class="chat-meta muted small">${when(m.at)}${m.mine || owner ? html` · <button type="button" class="link-button" data-del="${m.id}" title="${m.mine ? 'Delete your message' : 'Delete as the owner of the set'}">delete</button>` : ''}</span></li>`
        // someone else's message: a click on it opens what one can do about it or its author (owner 2026-11-07)
        : html`<li class="chat-msg" data-id="${m.id}" data-by="${m.by_id}"><button type="button" class="chat-open" aria-haspopup="menu" aria-expanded="false" title="Profile, friend request, report, block"><b class="chat-by">${m.by ?? '—'}</b> <span class="chat-body">${chatText(m.body ?? '')}</span><span class="chat-meta muted small">${when(m.at)}</span></button></li>`);
  let friends: Promise<Map<string, FriendStatus>> | null = null;
  const closeMenus = (except?: Element) => box.querySelectorAll('.chat-menu').forEach((x) => { if (x !== except) { x.previousElementSibling?.setAttribute('aria-expanded', 'false'); x.remove(); } });
  async function openMenu(li: HTMLElement, opener: HTMLButtonElement, status: HTMLElement) {
    const old = li.querySelector('.chat-menu');
    closeMenus();
    if (old) return;
    const who = li.dataset.by!;
    const name = li.querySelector('.chat-by')?.textContent ?? 'them';
    const st = (await (friends ??= friendStatuses())).get(who) ?? 'none';
    const menu = document.createElement('div');
    menu.className = 'chat-menu';
    menu.setAttribute('role', 'menu');
    render(menu, html`<button type="button" role="menuitem" data-act="profile">User profile</button>
      ${st === 'none' ? html`<button type="button" role="menuitem" data-act="befriend">Send a friend request</button>`
        : st === 'received' ? html`<button type="button" role="menuitem" data-act="accept">Accept their friend request</button>`
        : st === 'sent' ? html`<button type="button" role="menuitem" disabled>Friend request sent</button>` : ''}
      <button type="button" role="menuitem" data-act="report">Report message</button>
      ${st === 'blocked' ? '' : html`<button type="button" role="menuitem" data-act="block" class="danger-text">Block user</button>`}
      ${owner ? html`<button type="button" role="menuitem" data-act="delete" class="danger-text">Delete message</button>` : ''}`);
    // above the page at the message (the list scrolls and would cut it off): below it, or above it if there's no room
    li.append(menu);
    const at = opener.getBoundingClientRect(), h = menu.offsetHeight;
    menu.style.left = `${String(Math.max(8, Math.min(at.left, window.innerWidth - menu.offsetWidth - 8)))}px`;
    menu.style.top = `${String(at.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, at.top - 4 - h) : at.bottom + 4)}px`;
    li.closest('.chat-list')!.addEventListener('scroll', () => closeMenus(), { once: true });
    window.addEventListener('scroll', () => closeMenus(), { once: true });
    opener.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenus(); opener.focus(); } });
    menu.addEventListener('click', async (e) => {
      const act = (e.target as Element).closest<HTMLButtonElement>('[data-act]')?.dataset.act;
      if (!act) return;
      closeMenus();
      const fail = (err: Error) => { status.textContent = err.message; };
      const refriend = () => { friends = null; };
      if (act === 'profile') showProfile(who, refriend);
      else if (act === 'befriend') friendAction('request', who).then(() => { refriend(); status.textContent = `Friend request sent to ${name}.`; }).catch(fail);
      else if (act === 'accept') friendAction('accept', who).then(() => { refriend(); status.textContent = `You and ${name} are friends now.`; }).catch(fail);
      else if (act === 'report') {
        const note = await askText('Report this message to the site\'s administrators?', { title: 'Report message', label: 'What happened? (optional)', multiline: true, maxLength: 1000, ok: 'Report' });
        if (note !== null) reportSetChat(id, { message: li.dataset.id! }, note).then(() => { status.textContent = 'Reported — thank you.'; }).catch(fail);
      } else if (act === 'block') {
        if (await ask(`Their messages are hidden for you in every chat, a friendship or request between you ends, and they can't send you a new one. You can unblock them on Friends.`, { title: `Block ${name}?`, ok: 'Block', danger: true }))
          friendAction('block', who).then(() => { refriend(); return load(); }).catch(fail);
      } else if (act === 'delete') {
        if (await ask('Everyone sees “message deleted by the owner of the set”.', { title: 'Delete this message?', ok: 'Delete', danger: true }))
          deleteSetChat(id, li.dataset.id!).then(load).catch(fail);
      }
    });
  }
  // a click elsewhere closes an open menu
  const outside = (e: MouseEvent) => { if (!document.body.contains(box)) { document.removeEventListener('click', outside); return; } if (!(e.target as Element).closest('.chat-msg')) closeMenus(); };
  document.addEventListener('click', outside);
  const load = () => Promise.all([getSetChat(id), emotesReady()]).then(([r]) => {
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
      <details class="sets-chat-members small"><summary>Members</summary><ul>${r.members.map((m) => html`<li data-member="${m.id}">${who(m)}${m.owner ? html` <span class="tag">owner</span>` : ''}${m.removed ? html` <span class="tag">removed</span>` : ''}${m.me ? html` <span class="muted">(you)</span>` : ''}
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
    // ":" + letters offers emotes (2026-11-07) — before "Enter sends", so Enter picks while the list is open
    setSuggest?.destroy();
    setSuggest = suggest(ta);
    emoteHover();
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    ol.addEventListener('click', (e) => { const b = (e.target as Element).closest<HTMLButtonElement>('.chat-open'); if (b) void openMenu(b.closest('li')!, b, status); });
    box.querySelectorAll<HTMLButtonElement>('[data-reveal]').forEach((b) => b.addEventListener('click', () => {
      const m = shown.find((x) => x.id === b.dataset.reveal);
      if (m) { m.hidden = null; b.closest('li')!.outerHTML = line(m).value; }
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await ask(owner && !b.closest('.mine') ? 'Delete this message? Everyone sees “message deleted by the owner of the set”.' : 'Delete your message?', { ok: 'Delete', danger: true }))) return;
      deleteSetChat(id, b.dataset.del!).then(load).catch((err: Error) => { status.textContent = err.message; });
    }));
    const report = async (what: { message?: string; account?: string }, label: string) => {
      const note = (await askText(`Report ${label} to the site's administrators?`, { title: 'Report', label: 'What happened? (optional)', multiline: true, maxLength: 1000, ok: 'Report' }));
      if (note === null) return;
      reportSetChat(id, what, note).then(() => { status.textContent = 'Reported — thank you.'; }).catch((err: Error) => { status.textContent = err.message; });
    };
    box.querySelectorAll<HTMLButtonElement>('[data-report-user]').forEach((b) => b.addEventListener('click', () => report({ account: b.dataset.reportUser! }, 'this member (their name)')));
    box.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if ((await ask('Remove them from the chat? Everyone sees that they were removed; they stay an editor of the set unless you remove them there too.', { title: 'Remove them from the chat?', ok: 'Remove', danger: true }))) setChatMember(id, 'remove', b.dataset.remove!).then(load).catch((err: Error) => { status.textContent = err.message; });
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-hide]').forEach((b) => b.addEventListener('click', () => {
      hideInSetChat(id, b.dataset.hide!, b.dataset.on === '1').then(load).catch((err: Error) => { status.textContent = err.message; });
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-readmit]').forEach((b) => b.addEventListener('click', () => { setChatMember(id, 'readmit', b.dataset.readmit!).then(load).catch(() => {}); }));
    box.querySelector('.sets-chat-off')?.addEventListener('click', async () => { if ((await ask('Switch the chat off for everyone?', { ok: 'Switch it off' }))) switchSetChat(id, false).then(load).catch(() => {}); });
  }).catch(() => render(box, html`<p class="muted small">The chat could not be loaded.</p>`));
  void load();
  chatStream = chatEvents();
  chatStream?.addEventListener('set', (e) => { if ((JSON.parse((e as MessageEvent<string>).data) as { set: string }).set === id && document.body.contains(box)) void load(); });
}
