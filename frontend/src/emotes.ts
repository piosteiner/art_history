// Emotes in the chats (owner 2026-11-07, as on the adenai map): ":name:" in a chat message shows its picture, as in a
// Twitch chat — friends' chats and sets' chats only, nowhere else on the site. The list comes from 7TV through the CMS
// (/emotes there; backend src/admin/emotes.js, migration 240), read once per page view from /site/emotes.
//   chatText(body)  the message as Html: text escaped, known :names: as <img class="emote">
//   suggest(field)  typing ":" and a few letters lists emotes; ↑ ↓ choose, Enter / Tab or a click writes :name:, Esc closes
// Hovering an emote shows it larger (7TV's 4× file). The pictures come straight from 7TV's server, without the page
// as referrer (the privacy statement says so). Unknown :names: stay text. Names are matched exactly first,
// else regardless of case (as on the map).
import { getEmotes, type Emote } from './api';
import { escape, Html } from './html';

let emotes: Record<string, Emote> = {};
let lower = new Map<string, string>();
let loading: Promise<void> | null = null;

/** loaded once; the chats wait for it before drawing their messages (never fails: no emotes = text) */
export function emotesReady(): Promise<void> {
  loading ??= getEmotes().then((e) => {
    emotes = e;
    lower = new Map();
    for (const name of Object.keys(e)) if (!lower.has(name.toLowerCase())) lower.set(name.toLowerCase(), name);
  }).catch(() => {});
  return loading;
}

const find = (name: string) => (emotes[name] ? name : lower.get(name.toLowerCase()));

/** a chat message: escaped text with its :emotes: as pictures */
export function chatText(body: string): Html {
  let out = '';
  let last = 0;
  for (const m of body.matchAll(/:([^\s:]{1,64}):/g)) {
    const key = find(m[1]);
    if (!key) continue;
    const e = emotes[key];
    const h = 28;
    const w = e.h ? Math.round((e.w / e.h) * h) : h;
    out += escape(body.slice(last, m.index)) + `<img class="emote" src="${escape(e.url)}" alt=":${escape(key)}:" title=":${escape(key)}:" width="${String(w)}" height="${String(h)}" loading="lazy" referrerpolicy="no-referrer">`;
    last = m.index + m[0].length;
  }
  return new Html(out + escape(body.slice(last)));
}

/** ":" + letters in a chat's text field → emotes to pick (not after a letter or digit: "10:30" stays) */
export function suggest(field: HTMLTextAreaElement | HTMLInputElement) {
  void emotesReady();
  const box = Object.assign(document.createElement('ul'), { className: 'emote-suggest', role: 'listbox', hidden: true });
  document.body.append(box);
  let items: { name: string; e: Emote }[] = [];
  let index = 0;
  let from = 0;
  const close = () => { box.hidden = true; items = []; };
  const pick = (x: { name: string }) => {
    const v = field.value;
    const end = field.selectionStart ?? v.length;
    const after = v.slice(end).startsWith(':') ? end + 1 : end;
    const insert = `:${x.name}: `;
    field.value = v.slice(0, from) + insert + v.slice(after).replace(/^ /, '');
    field.selectionStart = field.selectionEnd = from + insert.length;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    close();
    field.focus();
  };
  const draw = () => {
    box.replaceChildren(...items.map((x, i) => {
      const li = Object.assign(document.createElement('li'), { role: 'option' });
      li.setAttribute('aria-selected', String(i === index));
      li.append(Object.assign(document.createElement('img'), { src: x.e.url, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }), `:${x.name}:`);
      li.addEventListener('mousedown', (ev) => { ev.preventDefault(); pick(x); });
      return li;
    }));
    const r = field.getBoundingClientRect();
    const below = window.innerHeight - r.bottom > 240;
    Object.assign(box.style, { left: `${String(Math.max(8, r.left))}px`, width: `${String(Math.min(300, r.width))}px`,
      top: below ? `${String(r.bottom + 4)}px` : '', bottom: below ? '' : `${String(window.innerHeight - r.top + 4)}px` });
    box.hidden = false;
    box.children[index]?.scrollIntoView({ block: 'nearest' });
  };
  const update = () => {
    const before = field.value.slice(0, field.selectionStart ?? 0);
    const m = /(^|[^\p{L}\p{N}\\]):([^\s:]{1,40})$/u.exec(before);
    if (!m) { close(); return; }
    const q = m[2].toLowerCase();
    items = Object.keys(emotes).map((name) => ({ name, n: name.toLowerCase() })).filter((x) => x.n.includes(q))
      .sort((a, b) => (Number(b.n.startsWith(q)) - Number(a.n.startsWith(q))) || a.name.length - b.name.length || a.name.localeCompare(b.name))
      .slice(0, 8).map((x) => ({ name: x.name, e: emotes[x.name] }));
    if (!items.length) { close(); return; }
    from = m.index + m[1].length;
    index = 0;
    draw();
  };
  field.addEventListener('input', update);
  field.addEventListener('click', update);
  field.addEventListener('blur', () => setTimeout(close, 150));
  field.addEventListener('keydown', (e) => {
    const k = e as KeyboardEvent;
    if (box.hidden) return;
    if (k.key === 'ArrowDown' || k.key === 'ArrowUp') { k.preventDefault(); index = (index + (k.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; draw(); }
    else if (k.key === 'Enter' || k.key === 'Tab') { k.preventDefault(); k.stopImmediatePropagation(); pick(items[index]); }
    else if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); close(); }
  });
  return { close, destroy: () => box.remove() };
}

// hover: the emote larger, without its name (as on the map)
let tip: HTMLDivElement | null = null;
let over: Element | null = null;
const bigUrl = (url: string) => url.replace(/(\/\/cdn\.7tv\.app\/emote\/[^/]+\/)2x\.webp$/, '$14x.webp');
let hovering = false;
export function emoteHover() {
  if (hovering) return;
  hovering = true;
  document.addEventListener('mouseover', (e) => {
    const img = (e.target as Element).closest?.('img.emote') ?? null;
    if (img === over) return;
    over = img;
    if (!img) { tip?.remove(); return; }
    tip ??= Object.assign(document.createElement('div'), { className: 'emote-tip', role: 'tooltip' });
    const big = new Image();
    big.alt = '';
    big.referrerPolicy = 'no-referrer';
    big.src = bigUrl((img as HTMLImageElement).src);
    big.onerror = () => { big.onerror = null; big.src = (img as HTMLImageElement).src; };
    tip.replaceChildren(big);
    const r = img.getBoundingClientRect();
    const above = r.top > 150;
    Object.assign(tip.style, { left: `${String(Math.min(Math.max(r.left + r.width / 2, 70), window.innerWidth - 70))}px`,
      top: `${String(above ? r.top - 8 : r.bottom + 8)}px`, transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)' });
    document.body.append(tip);
  });
  for (const ev of ['scroll', 'mousedown', 'keydown']) document.addEventListener(ev, () => { over = null; tip?.remove(); }, true);
}
