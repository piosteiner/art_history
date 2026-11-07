// A person's profile (owner 2026-11-07): the public name, the friendship with a button to ask or accept, the sets the
// two have in common and the person's public sets — in the site's own dialog (from a message in a set's chat) and as
// a page of its own, /friends/<id>/profile (names on Friends and in members' lists link there).
// Nothing else about an account is shown anywhere — the public name is all others know.
import { plural } from './format';
import { friendAction, getPerson, type FriendStatus, type PersonProfile } from './api';
import { html, render } from './html';

const statusLine = (s: FriendStatus) => ({ friend: 'You are friends.', sent: 'You have sent them a friend request.', received: 'They have sent you a friend request.', blocked: 'You have blocked them.', none: '' })[s];

/** where a person's name leads */
export const profileHref = (id: string) => `/friends/${id}/profile`;

const lists = (p: PersonProfile) => html`<section class="profile-part"><h3>Sets you share <span class="muted">${String(p.common.length)}</span></h3>${p.common.length
    ? html`<ul class="profile-sets">${p.common.map((s) => html`<li><a href="/sets/${s.id}">${s.name}</a>${s.topic ? html` <span class="muted small">${s.topic}</span>` : ''}${s.theirs ? html` <span class="tag">theirs</span>` : ''}</li>`)}</ul>`
    : html`<p class="muted small">None.</p>`}</section>
  <section class="profile-part"><h3>Public sets <span class="muted">${String(p.public.length)}</span></h3>${p.public.length
    ? html`<ul class="profile-sets">${p.public.map((s) => html`<li><a href="/sets/s/${s.code}">${s.name}</a> <span class="muted small">${s.topic ? `${s.topic} · ` : ''}${plural(s.count, 'entry', 'entries')}</span></li>`)}</ul>`
    : html`<p class="muted small">None.</p>`}</section>`;
const friendButton = (p: PersonProfile) => (p.status === 'none' ? html`<button type="button" class="secondary" data-friend="request">Send a friend request</button>`
  : p.status === 'received' ? html`<button type="button" class="secondary" data-friend="accept">Accept their friend request</button>`
    : p.status === 'friend' ? html`<a class="button-link secondary" href="/friends/${p.id}">Chat</a>` : '');

/** a click on Send / Accept: done, then drawn again with a note */
function wireFriend(box: HTMLElement, id: string, again: (note: string) => void, onChange?: () => void) {
  box.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-friend]');
    if (!b) return;
    b.disabled = true;
    friendAction(b.dataset.friend as 'request' | 'accept', id).then(() => { onChange?.(); again(b.dataset.friend === 'accept' ? 'You are friends now.' : 'Friend request sent.'); })
      .catch((err: Error) => { b.disabled = false; again(err.message); });
  });
}

/** the page /friends/<id>/profile */
export function profilePage(main: HTMLElement, id: string) {
  const draw = (note = '') => getPerson(id).then((p) => {
    if (!p) { render(main, html`<section class="page friends-page"><p>Log in to see profiles.</p></section>`); return; }
    document.title = `${p.name} · Friends · Art History`;
    render(main, html`<section class="page friends-page profile-page"><p class="crumbs"><a href="/friends">Friends</a> / ${p.name}</p>
      <h1>${p.name}</h1>
      ${statusLine(p.status) || note ? html`<p class="muted">${note || statusLine(p.status)}</p>` : ''}
      <p class="profile-actions">${friendButton(p)}</p>
      <div class="profile-lists">${lists(p)}</div></section>`);
  }).catch(() => render(main, html`<section class="page friends-page"><p class="flash">This profile could not be loaded — the account has no public name, or it no longer exists.</p><p><a href="/friends">Friends</a></p></section>`));
  wireFriend(main, id, (note) => { void draw(note); });
  void draw();
}

export function showProfile(id: string, onChange?: () => void) {
  const dialog = document.createElement('dialog');
  dialog.className = 'site-dialog profile-dialog';
  dialog.setAttribute('aria-label', 'Profile');
  document.body.append(dialog);
  const draw = (p: PersonProfile | null, note = '') => render(dialog, p ? html`<div class="site-dialog-form">
      <h2 class="site-dialog-title"><a href="${profileHref(p.id)}">${p.name}</a></h2>
      ${statusLine(p.status) || note ? html`<p class="site-dialog-text muted small">${note || statusLine(p.status)}</p>` : ''}
      ${lists(p)}
      <div class="site-dialog-buttons">${friendButton(p)}<button type="button" class="profile-close">Close</button></div></div>`
    : html`<div class="site-dialog-form"><p class="site-dialog-text">${note || '…'}</p><div class="site-dialog-buttons"><button type="button" class="profile-close">Close</button></div></div>`);
  const load = (note = '') => getPerson(id).then((p) => draw(p, note)).catch(() => draw(null, 'This profile could not be loaded.'));
  draw(null);
  void load();
  dialog.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t === dialog || t.closest('.profile-close')) dialog.close();   // a click beside it closes it
    else if (t.closest('a')) dialog.close();
  });
  wireFriend(dialog, id, (note) => { void load(note); }, onChange);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}
