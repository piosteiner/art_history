// A person's profile in the site's own dialog (owner 2026-11-07, opened from a message in a set's chat): the public
// name, the friendship with a button to ask or accept, the sets the two have in common and the person's public sets.
// Nothing else about an account is shown anywhere — the public name is all others know.
import { friendAction, getPerson, type FriendStatus, type PersonProfile } from './api';
import { html, render } from './html';

const plural = (n: number, w: string, ws = `${w}s`) => `${String(n)} ${n === 1 ? w : ws}`;
const statusLine = (s: FriendStatus) => ({ friend: 'You are friends.', sent: 'You have sent them a friend request.', received: 'They have sent you a friend request.', blocked: 'You have blocked them.', none: '' })[s];

export function showProfile(id: string, onChange?: () => void) {
  const dialog = document.createElement('dialog');
  dialog.className = 'site-dialog profile-dialog';
  dialog.setAttribute('aria-label', 'Profile');
  document.body.append(dialog);
  const draw = (p: PersonProfile | null, note = '') => render(dialog, p ? html`<div class="site-dialog-form">
      <h2 class="site-dialog-title">${p.name}</h2>
      ${statusLine(p.status) || note ? html`<p class="site-dialog-text muted small">${note || statusLine(p.status)}</p>` : ''}
      <section><h3>Sets you share</h3>${p.common.length
        ? html`<ul class="profile-sets">${p.common.map((s) => html`<li><a href="/sets/${s.id}">${s.name}</a>${s.topic ? html` <span class="muted small">${s.topic}</span>` : ''}${s.theirs ? html` <span class="tag">theirs</span>` : ''}</li>`)}</ul>`
        : html`<p class="muted small">None.</p>`}</section>
      <section><h3>Public sets</h3>${p.public.length
        ? html`<ul class="profile-sets">${p.public.map((s) => html`<li><a href="/sets/s/${s.code}">${s.name}</a> <span class="muted small">${s.topic ? `${s.topic} · ` : ''}${plural(s.count, 'entry', 'entries')}</span></li>`)}</ul>`
        : html`<p class="muted small">None.</p>`}</section>
      <div class="site-dialog-buttons">
        ${p.status === 'none' ? html`<button type="button" class="secondary" data-friend="request">Send a friend request</button>`
          : p.status === 'received' ? html`<button type="button" class="secondary" data-friend="accept">Accept their friend request</button>` : ''}
        <button type="button" class="profile-close">Close</button></div></div>`
    : html`<div class="site-dialog-form"><p class="site-dialog-text">${note || '…'}</p><div class="site-dialog-buttons"><button type="button" class="profile-close">Close</button></div></div>`);
  const load = (note = '') => getPerson(id).then((p) => draw(p, note)).catch(() => draw(null, 'This profile could not be loaded.'));
  draw(null);
  void load();
  dialog.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t === dialog || t.closest('.profile-close')) { dialog.close(); return; }   // a click beside it closes it
    const b = t.closest<HTMLButtonElement>('[data-friend]');
    if (b) {
      b.disabled = true;
      friendAction(b.dataset.friend as 'request' | 'accept', id).then(() => { onChange?.(); return load(b.dataset.friend === 'accept' ? 'You are friends now.' : 'Friend request sent.'); })
        .catch((err: Error) => { b.disabled = false; void load(err.message); });
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}
