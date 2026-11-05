// The owner's login on the site (backend src/admin/routes/site-account.js): "Log in" in the footer opens the CMS login,
// which sends the browser back here with ?login=1. Only then — remembered in localStorage — does a page ask the admin
// host who is logged in; visitors' pages never contact it. Logged in, artwork pages show the account's private
// reference images (views/detail.ts).
import { chatEvents, getAccount, getFriends, getOwnThumbs, getPrivateImages, logOut, loginUrl, type Me, type PrivateImage } from './api';
import { setOwnThumbs, gallery } from './html';
import { html, render } from './html';

const KEY = 'arthistory.account';
const remembered = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const remember = (on: boolean) => { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* private window */ } };

let whoFull: Promise<Me | null> = Promise.resolve(null);
let who: Promise<string | null> = Promise.resolve(null);
/** Ready once the account's own pictures are known (html.ts ownThumb) — at once for visitors. */
export let ownThumbsReady: Promise<void> = Promise.resolve();

/** The footer's "Log in" / "Logged in as … · Log out"; call once at start, before the router reads the address. */
export function mountAccount(footer: HTMLElement) {
  const url = new URL(location.href);
  if (url.searchParams.get('login') === '1') {
    remember(true);
    url.searchParams.delete('login');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  const slot = document.createElement('span');
  slot.className = 'account';
  footer.append(slot);
  // "Log in" carries the address of the page it is clicked on (set as it is pressed: the site navigates without reloads)
  const loginHref = () => {
    const next = new URL(location.href);
    next.searchParams.set('login', '1');
    return loginUrl(next.href);
  };
  const show = (name: string | null) => {
    if (name) {
      render(slot, html`Logged in as <a href="/account">${name}</a> · <a href="/sets">Your study sets</a> · <a href="/friends" class="friends-link">Friends<span class="unread-badge" hidden></span></a> · <button type="button" class="link-button">Log out</button>`);
      watchUnread(slot.querySelector<HTMLElement>('.unread-badge')!);
      slot.querySelector('button')!.addEventListener('click', () => {
        logOut().catch(() => null).finally(() => { remember(false); location.reload(); });
      });
    } else if (loginHref()) {
      render(slot, html`<a href="${loginHref()!}" rel="nofollow">Log in</a>`);
      const a = slot.querySelector('a')!;
      const update = () => { a.href = loginHref()!; };
      a.addEventListener('pointerdown', update);
      a.addEventListener('focus', update);
    }
  };
  whoFull = remembered() ? getAccount().catch(() => null) : Promise.resolve(null);
  who = whoFull.then((a) => a?.username ?? null);
  who.then((name) => { if (!name) remember(false); show(name); });
  // works without a public picture show the account's reference image instead (lists, an artist's works, search …)
  ownThumbsReady = who.then((name) => (name ? getOwnThumbs().then((m) => setOwnThumbs(m)).catch(() => {}) : undefined));
}

/** The footer's unread badge: counted once, then kept up to date by the chat's live stream (224). */
function watchUnread(badge: HTMLElement) {
  const count = () => getFriends().then((r) => { const n = r?.unread ?? 0; badge.hidden = !n; badge.textContent = n ? ` ${String(n)}` : ''; }).catch(() => {});
  void count();
  const events = chatEvents();
  events?.addEventListener('message', () => { void count(); });
  window.addEventListener('chat-read', () => { void count(); });
}

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
