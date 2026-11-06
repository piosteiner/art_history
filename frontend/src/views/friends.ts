// Friends and chat (backend routes/site-friends.js, migration 224; owner 2026-11-05). /friends: everyone the account
// works with in its sets and everyone it has a friendship or request with — by set or A–Z —, requests to answer, a
// personal friend link, blocked accounts; /friends/<id>: the chat with a friend, live (Server-Sent Events: a message
// arrives while the page is open); /friends/add/<code>: someone's friend link — send them a request.
// People are shown by their public name only.
import { ask, askText } from '../dialog';
import {
  ApiError, chatEvents, deleteChat, friendAction, getChat, getFriendLink, getFriends, newFriendCode, reportChat, requestByCode, sendChat,
  type ChatMessage, type Person,
} from '../api';
import { html, render, type Html } from '../html';
import { accountLinks } from './account';

interface FriendsRoute { id: string | null; add: string | null }
let stream: EventSource | null = null;
const closeStream = () => { stream?.close(); stream = null; };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const STATUS: Record<Person['status'], string> = { friend: 'friend', sent: 'request sent', received: 'wants to be your friend', none: '', blocked: 'blocked' };
const KEY = 'arthistory:friends:by';

/** → a cleanup: leaving the page closes its live connection */
export function friendsPage(main: HTMLElement, route: FriendsRoute) {
  closeStream();
  if (route.add) addView(main, route.add);
  else if (route.id) chatView(main, route.id);
  else listView(main);
  return closeStream;
}

function loggedOut(main: HTMLElement) {
  render(main, html`<section class="page friends-page"><h1>Friends</h1><p>Log in to see the people you work with on study sets, and to chat with your friends.</p>
    <p class="friends-account-links">…</p></section>`);
  accountLinks().then((links) => { const p = main.querySelector('.friends-account-links'); if (p) render(p, links); }).catch(() => {});
}

function listView(main: HTMLElement, note = '') {
  getFriends().then((r) => {
    if (!r) return loggedOut(main);
    let by: 'set' | 'name' = 'set';
    try { if (localStorage.getItem(KEY) === 'name') by = 'name'; } catch { /* no storage */ }
    const received = r.people.filter((p) => p.status === 'received');
    const blocked = r.people.filter((p) => p.status === 'blocked');
    const others = r.people.filter((p) => p.status !== 'received' && p.status !== 'blocked');
    const link = `${location.origin}/friends/add/${r.me.friend_code}`;
    const row = (p: Person) => html`<li class="friend" data-id="${p.id}">
      ${p.status === 'friend' ? html`<a class="friend-name" href="/friends/${p.id}">${p.name}</a>` : html`<span class="friend-name">${p.name}</span>`}
      ${p.unread ? html` <span class="unread-badge" title="unread messages">${String(p.unread)}</span>` : ''}
      ${STATUS[p.status] ? html` <span class="tag">${STATUS[p.status]}</span>` : ''}
      ${by === 'name' && p.sets.length ? html` <span class="muted small">${p.sets.map((s) => s.name).join(' · ')}</span>` : ''}
      <span class="friend-actions">${p.status === 'none' ? html`<button type="button" class="link-button" data-do="request">Add as friend</button>`
        : p.status === 'sent' ? html`<button type="button" class="link-button" data-do="withdraw">Withdraw the request</button>`
          : p.status === 'friend' ? html`<a href="/friends/${p.id}">Chat</a> <button type="button" class="link-button" data-do="remove">Remove</button>` : ''}
        ${p.status === 'blocked' ? html`<button type="button" class="link-button" data-do="unblock">Unblock</button>` : html`<button type="button" class="link-button muted" data-do="block">Block</button>`}</span></li>`;
    // by set: each set with its people (someone in several sets in each); people outside any set (friends by link) last
    const groups: [string, Person[]][] = by === 'name' ? [['', others]] : (() => {
      const m = new Map<string, Person[]>();
      for (const p of others) for (const s of p.sets.length ? p.sets : [{ id: '', name: '' }]) { if (!m.has(s.name)) m.set(s.name, []); m.get(s.name)!.push(p); }
      return [...m.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    })();
    render(main, html`<section class="page friends-page">
      <h1>Friends</h1>
      ${note ? html`<p class="flash ok">${note}</p>` : ''}
      ${r.me.public_name ? '' : html`<p class="flash">Others see you by your public name — <a href="/account">choose one</a> before you send a request or a message.</p>`}
      <p class="muted">Everyone you work with on study sets, and your friends. Friends can chat with each other — only the two of you see the messages.</p>
      ${received.length ? html`<section class="friends-requests"><h2>Requests <span class="muted">${String(received.length)}</span></h2>
        <ul class="friends-list">${received.map((p) => html`<li class="friend" data-id="${p.id}"><span class="friend-name">${p.name}</span> wants to be your friend
          <span class="friend-actions"><button type="button" data-do="accept">Accept</button> <button type="button" class="secondary" data-do="decline">Decline</button>
          <button type="button" class="link-button muted" data-do="block">Block</button></span></li>`)}</ul></section>` : ''}
      <p class="friends-sort small">List <button type="button" class="link-button${by === 'set' ? ' on' : ''}" data-by="set" aria-pressed="${String(by === 'set')}">by set</button>
        · <button type="button" class="link-button${by === 'name' ? ' on' : ''}" data-by="name" aria-pressed="${String(by === 'name')}">A–Z</button></p>
      ${others.length ? groups.map(([set, list]) => html`<section class="friends-group">${by === 'set' ? html`<h2>${set || 'Not in a set with you'}</h2>` : ''}
        <ul class="friends-list">${list.map(row)}</ul></section>`)
        : html`<p class="muted">No one yet. Edit a set together with someone, or send them your friend link.</p>`}
      <section class="friends-link"><h2>Your friend link</h2>
        <p class="small">Send it to someone you'd like as a friend who isn't in one of your sets: it lets them send you a request.</p>
        <p class="sets-share-link"><input readonly value="${link}" aria-label="Your friend link"> <button type="button" class="friends-copy">Copy link</button>
          <button type="button" class="link-button friends-new-link" title="The old link stops working">New link</button></p></section>
      ${blocked.length ? html`<details class="friends-blocked"><summary>Blocked <span class="muted">${String(blocked.length)}</span></summary>
        <ul class="friends-list">${blocked.map(row)}</ul></details>` : ''}
      <p class="friends-msg small" role="status"></p></section>`);
    const msg = main.querySelector<HTMLElement>('.friends-msg')!;
    main.querySelectorAll<HTMLButtonElement>('[data-by]').forEach((b) => b.addEventListener('click', () => {
      try { localStorage.setItem(KEY, b.dataset.by!); } catch { /* no storage */ }
      listView(main);
    }));
    main.querySelectorAll<HTMLButtonElement>('[data-do]').forEach((b) => b.addEventListener('click', async () => {
      const li = b.closest<HTMLElement>('[data-id]')!;
      const what = b.dataset.do as Parameters<typeof friendAction>[0];
      if (what === 'block' && !(await ask('Block them? Your friendship ends; neither of you can send the other a request or a message until you unblock them.', { title: 'Block them?', ok: 'Block', danger: true }))) return;
      if (what === 'remove' && !(await ask('Remove this friend? You can no longer chat (your messages stay until you delete them).', { title: 'Remove this friend?', ok: 'Remove', danger: true }))) return;
      friendAction(what, li.dataset.id!).then(() => listView(main)).catch((err: Error) => { msg.textContent = err.message; });
    }));
    main.querySelector('.friends-copy')?.addEventListener('click', () => {
      const input = main.querySelector<HTMLInputElement>('.friends-link input')!;
      navigator.clipboard?.writeText(input.value).then(() => { msg.textContent = 'Link copied.'; }, () => input.select());
    });
    main.querySelector('.friends-new-link')?.addEventListener('click', async () => {
      if ((await ask('Make a new friend link? The old one stops working.', { ok: 'Make a new link' }))) newFriendCode().then(() => listView(main, 'New link made.')).catch((err: Error) => { msg.textContent = err.message; });
    });
    stream = chatEvents();
    stream?.addEventListener('message', () => listView(main));
  }).catch(() => render(main, html`<section class="page friends-page"><p class="flash">Your friends could not be loaded.</p></section>`));
}

function addView(main: HTMLElement, code: string) {
  getFriendLink(code).then((r) => {
    if (r === null) return loggedOut(main);
    const done = r.status === 'friend' ? html`<p>You are friends already. <a href="/friends">Your friends</a></p>`
      : r.status === 'sent' ? html`<p>Your request has been sent. <a href="/friends">Your friends</a></p>`
        : r.status === 'me' ? html`<p>This is your own friend link — send it to someone. <a href="/friends">Your friends</a></p>`
          : html`<p><button type="button" class="friends-request">Send ${r.name} a friend request</button></p>`;
    render(main, html`<section class="page friends-page"><p class="crumbs"><a href="/friends">Friends</a></p><h1>${r.name}</h1>${done}
      <p class="friends-msg small" role="status"></p></section>`);
    main.querySelector('.friends-request')?.addEventListener('click', () => {
      requestByCode(code).then((x) => {
        const m = main.querySelector('.friends-msg')!;
        m.textContent = x?.status === 'friend' ? 'You are friends now.' : 'Request sent — you are friends once they accept.';
        main.querySelector('.friends-request')?.remove();
      }).catch((err: Error) => { main.querySelector('.friends-msg')!.textContent = err.message; });
    });
  }).catch(() => render(main, html`<section class="page friends-page"><p class="flash">This friend link does not work (any more).</p><p><a href="/friends">Your friends</a></p></section>`));
}

function chatView(main: HTMLElement, id: string) {
  let messages: ChatMessage[] = [];
  let more = false;
  let name = '';
  const bubble = (m: ChatMessage): Html => html`<li class="chat-msg${m.mine ? ' mine' : ''}" data-id="${m.id}">
    <span class="chat-body">${m.body}</span>
    <span class="chat-meta muted small">${when(m.at)}${m.mine ? (m.read ? ' · read' : '') : ''}
      ${m.mine ? html` <button type="button" class="link-button chat-delete" title="Delete this message for both of you" aria-label="Delete this message">×</button>` : ''}</span></li>`;
  const draw = (keepScroll = false) => {
    const list = main.querySelector<HTMLElement>('.chat-list');
    const atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    if (!list) {
      render(main, html`<section class="page friends-page chat-page">
        <p class="crumbs"><a href="/friends">Friends</a> / ${name}</p>
        <h1>${name}</h1>
        <ol class="chat-list" aria-live="polite"></ol>
        <form class="chat-form"><textarea name="body" rows="2" maxlength="4000" placeholder="Write a message — Enter sends, Shift+Enter a new line" aria-label="Message" required></textarea>
          <button type="submit">Send</button></form>
        <p class="chat-tools small"><button type="button" class="link-button chat-clear">Delete the conversation for me</button> ·
          <button type="button" class="link-button chat-report">Report…</button>
          <span class="muted"> Only the two of you see these messages; a report sends a copy to the site's administrators.</span></p>
        <p class="friends-msg small" role="status"></p></section>`);
      wire();
    }
    const ol = main.querySelector<HTMLElement>('.chat-list')!;
    render(ol, html`${more ? html`<li class="chat-more"><button type="button" class="link-button">Earlier messages</button></li>` : ''}
      ${messages.length ? messages.map(bubble) : html`<li class="muted">No messages yet — say hello.</li>`}`);
    ol.querySelector('.chat-more button')?.addEventListener('click', () => {
      const h = ol.scrollHeight;
      getChat(id, messages[0]?.id ?? '').then((r) => { if (!r) return; messages = [...r.messages, ...messages]; more = r.more; draw(true); ol.scrollTop = ol.scrollHeight - h; }).catch(() => {});
    });
    ol.querySelectorAll<HTMLButtonElement>('.chat-delete').forEach((b) => b.addEventListener('click', () => {
      const mid = b.closest<HTMLElement>('[data-id]')!.dataset.id!;
      deleteChat(id, { message: mid }).then(() => { messages = messages.filter((m) => m.id !== mid); draw(true); }).catch(() => {});
    }));
    if (!keepScroll && atBottom) ol.scrollTop = ol.scrollHeight;
  };
  const load = () => getChat(id).then((r) => {
    if (!r) return loggedOut(main);
    name = r.friend.name;
    document.title = `${name} · Friends · Art History`;
    const known = new Set(messages.map((m) => m.id));
    const fresh = r.messages.filter((m) => !known.has(m.id));
    messages = messages.length ? [...messages.filter((m) => r.messages.every((x) => x.id !== m.id)), ...r.messages] : r.messages;
    more = more || r.more;
    draw();
    if (fresh.some((m) => !m.mine)) window.dispatchEvent(new Event('chat-read'));
  });
  function wire() {
    const form = main.querySelector<HTMLFormElement>('.chat-form')!;
    const ta = form.querySelector('textarea')!;
    const msg = main.querySelector<HTMLElement>('.friends-msg')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body) return;
      sendChat(id, body).then((r) => { if (r) { messages.push(r.message); ta.value = ''; msg.textContent = ''; draw(); } })
        .catch((err: Error) => { msg.textContent = err.message; });
    });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    main.querySelector('.chat-clear')!.addEventListener('click', async () => {
      if (!(await ask('Delete the whole conversation for you? The other person keeps their copy.', { title: 'Delete the conversation?', ok: 'Delete', danger: true }))) return;
      deleteChat(id, { all: '1' }).then(() => { messages = []; more = false; draw(); }).catch((err: Error) => { msg.textContent = err.message; });
    });
    main.querySelector('.chat-report')!.addEventListener('click', async () => {
      const note = (await askText('Report this conversation to the site\'s administrators? They receive a copy of its last 100 messages.', { title: 'Report this conversation', label: 'What happened? (optional)', multiline: true, maxLength: 1000, ok: 'Report' }));
      if (note === null) return;
      reportChat(id, note).then(() => { msg.textContent = 'Reported — thank you. You can also block them on the Friends page.'; }).catch((err: Error) => { msg.textContent = err.message; });
    });
    ta.focus();
  }
  load().catch((err: unknown) => render(main, html`<section class="page friends-page"><p class="flash">${err instanceof ApiError && err.status === 404 ? 'You can chat with friends only.' : 'The chat could not be loaded.'}</p>
    <p><a href="/friends">Your friends</a></p></section>`));
  // live: a message from this friend, or a read receipt for ours
  stream = chatEvents();
  stream?.addEventListener('message', (e) => { if ((JSON.parse((e as MessageEvent<string>).data) as { from: string }).from === id) void load(); });
  stream?.addEventListener('read', (e) => { if ((JSON.parse((e as MessageEvent<string>).data) as { by: string }).by === id) void load(); });
}
