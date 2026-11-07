// The logged-in account's own page (backend routes/site-account.js, migration 220): /account
//   the account (username, kind, since when, its sets), the public name shown on shared sets and to co-editors, a new
//   password (the current one asked; other sessions end), log out everywhere else, and — for site-only accounts —
//   delete the account with everything it holds. A forgotten password: the owner sets a new one (no e-mail is kept).
// Logged out: Log in / Create an account (when sign-up is open).
import { day } from '../format';
import { ask } from '../dialog';
import { account, rememberLogin } from '../account';
import {
  changePassword, deleteAccount, endOtherSessions, getAccountInfo, getSignup, loginUrl, setPublicName, signupUrl, ADMIN, type AccountInfo,
} from '../api';
import { html, render, type Html } from '../html';

const KIND = { member: 'Site account', editor: 'Site and CMS (editor)', admin: 'Site and CMS (admin)' } as const;

/** "Log in" and, while sign-up is open, "Create an account" — both back to this page afterwards. */
/** A page shown to visitors where an account is needed: the title, a text, the Log in / Sign up links, more (2026-11-07) */
export function loggedOutPage(main: HTMLElement, cls: string, title: string, text: Html, more: Html | '' = '') {
  render(main, html`<section class="page ${cls}"><h1>${title}</h1>${text}<p class="account-links-slot">…</p>${more}</section>`);
  accountLinks().then((links) => { const p = main.querySelector('.account-links-slot'); if (p) render(p, links); }).catch(() => {});
}

export async function accountLinks(path = location.pathname + location.search) {
  const next = new URL(path, location.origin);
  next.searchParams.set('login', '1');
  const login = loginUrl(next.href);
  const open = await getSignup().then((s) => s?.open ?? false).catch(() => false);
  const signup = open ? signupUrl(next.href) : null;
  if (!login) return html`<span class="muted">Accounts can't be used here.</span>`;
  return html`<a class="button-link" href="${login}" rel="nofollow">Log in</a>${signup ? html` <a class="button-link" href="${signup}" rel="nofollow">Create an account</a>
    <span class="muted small">— free: your own study sets, shared and edited together, your quiz results. No e-mail address needed.</span>` : ''}`;
}

export function accountPage(main: HTMLElement, params: URLSearchParams) {
  if (params.get('login') === '1') rememberLogin();
  render(main, html`<section class="page account-page"><p class="muted">Loading…</p></section>`);
  account().then(async (name) => {
    if (!name) {
      render(main, html`<section class="page account-page"><h1>Your account</h1>
        <p>An account keeps your study sets and your quiz results.</p><p>${await accountLinks()}</p></section>`);
      return;
    }
    const info = await getAccountInfo();
    if (!info) { render(main, html`<section class="page account-page"><h1>Your account</h1><p>You are no longer logged in. ${await accountLinks()}</p></section>`); return; }
    draw(main, info);
  }).catch(() => render(main, html`<section class="page account-page"><p class="flash">Your account could not be loaded.</p></section>`));
}

function draw(main: HTMLElement, a: AccountInfo) {
  render(main, html`<section class="page account-page"><h1>Your account</h1>
    <dl class="account-facts"><dt>Username</dt><dd><b>${a.username}</b> <span class="muted small">— to log in; never shown to others</span></dd>
      <dt>Kind</dt><dd>${KIND[a.role]}${a.cms && ADMIN ? html` · <a href="${ADMIN}/">Open the CMS ↗</a>` : ''}</dd>
      <dt>Since</dt><dd>${day(a.created_at)}</dd>
      <dt>Study sets</dt><dd><a href="/sets">${String(a.sets)} of your own${a.edits ? `, member of ${String(a.edits)} more` : ''}</a></dd></dl>

    <section class="account-section" id="public-name"><h2>Public name</h2>
      <p class="muted small">Shown on the sets you share and to those you edit sets with — choose any name; your username is never shown.</p>
      <form class="account-form" data-form="name"><input name="public_name" value="${a.public_name ?? ''}" maxlength="60" autocomplete="nickname" aria-label="Public name">
        <button type="submit">Save</button><span class="account-msg small" role="status"></span></form></section>

    <section class="account-section"><h2>Password</h2>
      <form class="account-form account-form-stack" data-form="password">
        <label>Current password <input name="current" type="password" autocomplete="current-password" required></label>
        <label>New password <span class="muted small">(at least 10 characters)</span> <input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
        <label>New password again <input name="password2" type="password" autocomplete="new-password" required></label>
        <span><button type="submit">Change password</button> <span class="account-msg small" role="status"></span></span></form>
      <p class="muted small">Forgotten it one day? There is no e-mail to send a new one — ask the site's owner (the F button sends a message), who can set a new one.</p></section>

    <section class="account-section"><h2>Logged in</h2>
      <p>${a.sessions === 1 ? 'Only here.' : `In ${String(a.sessions)} browsers or devices, this one included.`}
        ${a.sessions > 1 ? html`<button type="button" class="account-sessions">Log out everywhere else</button>` : ''} <span class="account-msg small" role="status"></span></p></section>

    <section class="account-section account-danger"><h2>Delete the account</h2>
      ${a.cms ? html`<p class="muted">A CMS account is deleted by an admin in the CMS.</p>` : html`
      <p>Deletes the account with everything it holds: your study sets (shared ones too — their links stop working; sets you
        edit with others stay theirs), what you know of the cards, your results. It can't be undone.</p>
      <form class="account-form" data-form="delete"><input name="password" type="password" autocomplete="current-password" placeholder="Your password" aria-label="Your password" required>
        <button type="submit" class="danger">Delete my account</button><span class="account-msg small" role="status"></span></form>`}</section>
    <p class="small"><a href="/privacy">What an account keeps — the privacy statement</a></p></section>`);

  const msgOf = (el: Element) => el.querySelector<HTMLElement>('.account-msg')!;
  const fail = (el: Element) => (err: Error) => { msgOf(el).textContent = err.message.replace(/^./, (c) => c.toUpperCase()); };
  main.querySelectorAll<HTMLFormElement>('.account-form').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
    const msg = msgOf(f);
    msg.textContent = '…';
    if (f.dataset.form === 'name') {
      setPublicName(val('public_name')).then((r) => { msg.textContent = r?.public_name ? 'Saved.' : 'Removed.'; window.dispatchEvent(new CustomEvent('account-changed', { detail: { public_name: r?.public_name ?? null } })); }).catch(fail(f));
    } else if (f.dataset.form === 'password') {
      changePassword(val('current'), val('password'), val('password2')).then(() => { f.reset(); msg.textContent = 'Changed — you are logged out everywhere else.'; }).catch(fail(f));
    } else if (f.dataset.form === 'delete') {
      if (!(await ask('Delete your account and everything it holds? This can\'t be undone.', { title: 'Delete your account?', ok: 'Delete my account', danger: true }))) { msg.textContent = ''; return; }
      deleteAccount(val('password')).then(() => {
        try { localStorage.removeItem('arthistory.account'); } catch { /* private window */ }
        location.assign('/?deleted=1');
      }).catch(fail(f));
    }
  }));
  // /account#public-name (from a set's sharing panel): the section stands out, its field ready to type in
  if (location.hash === '#public-name') {
    const sec = main.querySelector<HTMLElement>('#public-name')!;
    sec.classList.add('account-highlight');
    sec.scrollIntoView({ block: 'center' });
    sec.querySelector<HTMLInputElement>('input[name=public_name]')!.focus({ preventScroll: true });
  }
  const sessions = main.querySelector('.account-sessions');
  sessions?.addEventListener('click', () => {
    const p = sessions.parentElement!;
    endOtherSessions().then((r) => { msgOf(p).textContent = `Done — ${String(r?.ended ?? 0)} other session${r?.ended === 1 ? '' : 's'} ended.`; sessions.remove(); }).catch(fail(p));
  });
}
