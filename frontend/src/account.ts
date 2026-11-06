// The account on the site (backend src/admin/routes/site-account.js): "Log in" in the header's account menu opens the CMS login,
// which sends the browser back here with ?login=1. Only then — remembered in localStorage — does a page ask the admin
// host who is logged in; visitors' pages never contact it. Logged in, artwork pages show the account's private
// reference images (views/detail.ts).
import { ADMIN, chatEvents, getAccount, getFriends, getOwnThumbs, getPrivateImages, logOut, loginUrl, signupUrl, type Me, type PrivateImage } from './api';
import { setOwnThumbs, gallery } from './html';
import { html, render } from './html';

const KEY = 'arthistory.account';
const remembered = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const remember = (on: boolean) => { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* private window */ } };

let whoFull: Promise<Me | null> = Promise.resolve(null);
let who: Promise<string | null> = Promise.resolve(null);
/** Ready once the account's own pictures are known (html.ts ownThumb) — at once for visitors. */
export let ownThumbsReady: Promise<void> = Promise.resolve();

/** The account menu at the end of the header (owner 2026-11-05): logged out "Log in" and "Sign up" (always shown — the
 *  sign-up page says when it is closed); logged in a button with the public name (else the username's initial in a
 *  circle, a dot for unread chat messages) opening the account's pages and Log out. Call once at start, before the
 *  router reads the address. `setsLink`: the nav's "Sets" — the account's own sets once it is logged in. */
export function mountAccount(slot: HTMLElement, setsLink: HTMLAnchorElement | null = null) {
  const url = new URL(location.href);
  if (url.searchParams.get('login') === '1') {
    remember(true);
    url.searchParams.delete('login');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  // "Log in" / "Sign up" carry the address of the page they are pressed on (the site navigates without reloads)
  const back = () => {
    const next = new URL(location.href);
    next.searchParams.set('login', '1');
    return next.href;
  };
  const loggedOut = () => {
    const login = loginUrl(back());
    if (!login) return;
    render(slot, html`<a class="account-login" href="${login}" rel="nofollow">Log in</a><a class="account-signup" href="${signupUrl(back())!}" rel="nofollow">Sign up</a>`);
    const update = () => {
      slot.querySelector<HTMLAnchorElement>('.account-login')!.href = loginUrl(back())!;
      slot.querySelector<HTMLAnchorElement>('.account-signup')!.href = signupUrl(back())!;
    };
    slot.addEventListener('pointerdown', update);
    slot.addEventListener('focusin', update);
  };
  const loggedIn = (a: Me) => {
    if (setsLink) setsLink.href = '/sets';
    const label = (who: Me) => (who.public_name
      ? html`<span class="account-name">${who.public_name}</span>`
      : html`<span class="account-initial" aria-hidden="true">${(who.username[0] ?? '?').toUpperCase()}</span><span class="visually-hidden">${who.username}</span>`);
    render(slot, html`<div class="account-menu">
      <button type="button" class="account-button" aria-haspopup="menu" aria-expanded="false" aria-controls="account-items" title="Your account">
        ${label(a)}<span class="account-dot" hidden></span></button>
      <div class="account-items" id="account-items" role="menu" hidden>
        <p class="account-who">${a.public_name ?? a.username} <span class="muted small">· ${a.cms ? 'site and CMS' : 'site account'}</span></p>
        <a role="menuitem" href="/sets">Study sets</a>
        <a role="menuitem" href="/sets/results">Your results</a>
        <a role="menuitem" href="/" title="Your saved views of the start map: under the map">Your views</a>
        <a role="menuitem" href="/friends">Friends <span class="unread-badge" hidden></span></a>
        <hr>
        <a role="menuitem" href="/account">Your account</a>
        ${a.cms && ADMIN ? html`<a role="menuitem" href="${ADMIN}/" target="_blank" rel="noopener">CMS ↗</a>` : ''}
        <button type="button" role="menuitem" class="account-logout">Log out</button>
      </div></div>`);
    const button = slot.querySelector<HTMLButtonElement>('.account-button')!;
    const menu = slot.querySelector<HTMLElement>('.account-items')!;
    const items = () => [...menu.querySelectorAll<HTMLElement>('[role=menuitem]')];
    const open = (on: boolean, focus = false) => {
      menu.hidden = !on;
      button.setAttribute('aria-expanded', String(on));
      if (on && focus) items()[0]?.focus();
    };
    button.addEventListener('click', () => open(menu.hidden === true));
    button.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); open(true, true); } });
    menu.addEventListener('keydown', (e) => {
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'Escape') { open(false); button.focus(); } else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i + list.length - 1) % list.length].focus(); }
    });
    menu.addEventListener('click', (e) => { if ((e.target as Element).closest('a')) open(false); });   // a page chosen
    document.addEventListener('click', (e) => { if (!slot.contains(e.target as Node)) open(false); });
    slot.addEventListener('focusout', (e) => { if (!slot.contains(e.relatedTarget as Node | null)) open(false); });
    slot.querySelector('.account-logout')!.addEventListener('click', () => {
      logOut().catch(() => null).finally(() => { remember(false); location.reload(); });
    });
    watchUnread(menu.querySelector<HTMLElement>('.unread-badge')!, slot.querySelector<HTMLElement>('.account-dot')!);
    // the public name changed on /account: the button follows
    window.addEventListener('account-changed', ((e: CustomEvent<Partial<Me>>) => {
      Object.assign(a, e.detail);
      const name = button.querySelector('.account-name, .account-initial');
      button.querySelector('.visually-hidden')?.remove();
      if (name) { const tmp = document.createElement('span'); render(tmp, label(a)); name.replaceWith(...tmp.childNodes); }
    }) as EventListener);
  };
  whoFull = remembered() ? getAccount().catch(() => null) : Promise.resolve(null);
  who = whoFull.then((a) => a?.username ?? null);
  whoFull.then((a) => { if (!a) { remember(false); loggedOut(); } else loggedIn(a); });
  // works without a public picture show the account's reference image instead (lists, an artist's works, search …)
  ownThumbsReady = who.then((name) => (name ? getOwnThumbs().then((m) => setOwnThumbs(m)).catch(() => {}) : undefined));
}

/** The button's red dot and the number beside Friends: unread messages and open friend requests to the account
 *  (owner 2026-11-06) — counted once, then kept up to date by the live stream (224: `message`, `friend`) and the
 *  site's own actions. */
function watchUnread(badge: HTMLElement, dot: HTMLElement) {
  const count = () => getFriends().then((r) => {
    const unread = r?.unread ?? 0;
    const requests = (r?.people ?? []).filter((p) => p.status === 'received').length;
    const n = unread + requests;
    const what = [requests ? plural(requests, 'friend request') : '', unread ? plural(unread, 'unread message') : ''].filter(Boolean).join(', ');
    badge.hidden = !n; dot.hidden = !n; badge.textContent = n ? String(n) : '';
    badge.title = what; dot.title = what;
    dot.textContent = n ? `(${what})` : '';
  }).catch(() => {});
  void count();
  const events = chatEvents();
  events?.addEventListener('message', () => { void count(); });
  events?.addEventListener('friend', () => { void count(); });
  window.addEventListener('chat-read', () => { void count(); });
  window.addEventListener('friends-changed', () => { void count(); });
}
const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

/** The logged-in account's name, or null (visitors: at once, without asking the admin host). */
export const account = () => who;
/** The logged-in account — name, role, whether it may use the CMS, public name — or null. */
export const me = () => whoFull;
/** After the account's sign-up or login elsewhere (the /sets?login=1 return): remembered as logged in. */
export const rememberLogin = () => remember(true);

/** A work's private reference images for the logged-in account (none for visitors). */
export const privateImages = (slug: string): Promise<PrivateImage[]> =>
  who.then((name) => (name ? getPrivateImages(slug).then((x) => x ?? []).catch(() => []) : []));

/** The section under the gallery: "Only you see these" — the site's own gallery (thumbnails to switch, a click opens it
 *  large with zoom: wireGalleries, wireLightbox), the source and page as its caption. */
export function privateImagesSection(images: PrivateImage[]) {
  return html`<section class="private-images">
    <h2>Your reference images <span class="tag">private</span></h2>
    <p class="muted small">Only you see these — from your own books, for your private use (managed in the CMS).</p>
    ${gallery(images.map((i) => ({ url: i.url, caption: [i.source, i.locator].filter(Boolean).join(', ') || null, credit: null, license: null, source_url: null })),
      'Your reference image', { own: true })}
  </section>`;
}
