// The owner's login on the site (backend src/admin/routes/site-account.js): "Log in" in the footer opens the CMS login,
// which sends the browser back here with ?login=1. Only then — remembered in localStorage — does a page ask the admin
// host who is logged in; visitors' pages never contact it. Logged in, artwork pages show the account's private
// reference images (views/detail.ts).
import { getAccount, getPrivateImages, logOut, loginUrl, type PrivateImage } from './api';
import { html, render } from './html';

const KEY = 'arthistory.account';
const remembered = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const remember = (on: boolean) => { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* private window */ } };

let who: Promise<string | null> = Promise.resolve(null);

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
      render(slot, html`Logged in as ${name} · <button type="button" class="link-button">Log out</button>`);
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
  who = remembered() ? getAccount().then((a) => a?.username ?? null).catch(() => null) : Promise.resolve(null);
  who.then((name) => { if (!name) remember(false); show(name); });
}

/** A work's private reference images for the logged-in account (none for visitors). */
export const privateImages = (slug: string): Promise<PrivateImage[]> =>
  who.then((name) => (name ? getPrivateImages(slug).then((x) => x ?? []).catch(() => []) : []));

/** The section under the gallery: "Only you see these" — opened large in a new tab. */
export function privateImagesSection(images: PrivateImage[]) {
  return html`<section class="private-images">
    <h2>Your reference images <span class="tag">private</span></h2>
    <p class="muted small">Only you see these — from your own books, for your private use (managed in the CMS).</p>
    <div class="private-image-list">${images.map((i) => html`<figure>
      <a href="${i.url}" target="_blank" rel="noopener"><img src="${i.url}" alt="" loading="lazy" width="${String(i.width)}" height="${String(i.height)}"></a>
      <figcaption class="muted small">${[i.source, i.locator].filter(Boolean).join(', ') || '—'}</figcaption></figure>`)}</div>
  </section>`;
}
