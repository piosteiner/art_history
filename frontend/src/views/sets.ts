// Study sets (owner 2026-11-04; backend routes/site-sets.js, src/study.js, migration 218): the logged-in account's own
// lists of entries of any type, to keep for reference and to learn as index cards.
//   /sets                 the account's sets: create, open, delete
//   /sets/<id>            one set: its entries (removed with ×), renamed, and "Study"
//   /sets/<id>/study?dir=name|describe|both&skip=known
//                         the index cards, in both directions:
//     "Name it"     (forward)  what it is → its name: an artwork's picture → title, artist, date; a term's definition →
//                              the term; an artist's dates and places (and portrait) → the name; a source's full
//                              reference → its short one. The name is blanked out of the text shown.
//     "Describe it" (reverse)  its name → what it is: the picture, the facts, the definition
//   Each answer moves the card's Leitner box (1–5, per account, entry and direction): the low boxes come first; a card
//   not known comes back once at the end of the round. Space/Enter turns a card, ← not yet, → knew it.
import { account } from '../account';
import { answerCard, createSet, deleteSet, getCards, getSet, getSets, loginUrl, updateSet, type StudyCard, type StudyItem } from '../api';
import { href, html, PLURAL_LABEL, render, thumb, TYPE_LABEL, type Html } from '../html';
import { PLURAL } from '../api';

type Dir = 'forward' | 'reverse';
const dirName: Record<Dir, string> = { forward: 'Name it', reverse: 'Describe it' };

export function setsPage(main: HTMLElement, id: string | null, study: boolean, params: URLSearchParams) {
  document.title = 'Your study sets · Art History';
  render(main, html`<section class="page sets-page"><p class="muted">Loading…</p></section>`);
  account().then((name) => {
    if (!name) return loggedOut(main);
    if (!id) return list(main);
    return study ? studyView(main, id, params) : one(main, id);
  });
}

function loggedOut(main: HTMLElement) {
  const next = new URL(location.href);
  next.searchParams.set('login', '1');
  const login = loginUrl(next.href);
  render(main, html`<section class="page sets-page"><h1>Study sets</h1>
    <p>Keep artworks, artists, terms, places … from this site in sets of your own — to look them up again, or to learn them
      as index cards for an exam.</p>
    <p>${login ? html`<a class="button-link" href="${login}" rel="nofollow">Log in</a> to see your sets.` : 'Sets need an account.'}</p></section>`);
}

// ---- the list of sets -------------------------------------------------------------------------------------------
function list(main: HTMLElement) {
  getSets().then((sets) => {
    if (!sets) return loggedOut(main);
    render(main, html`<section class="page sets-page"><h1>Your study sets</h1>
      <p class="muted">Your own lists of entries — only you see them. Add an entry with <b>+ Set</b> on its page; learn a
        set as index cards with <b>Study</b>.</p>
      <form class="sets-new"><input name="name" placeholder="Name of a new set — e.g. Exam: Japanese art" aria-label="Name of a new set" maxlength="120" required>
        <button type="submit">Create</button></form>
      <p class="sets-msg small" role="status"></p>
      ${sets.length ? html`<ul class="sets-list">${sets.map((s) => html`<li class="sets-item">
          <a class="sets-name" href="/sets/${s.id}">${s.name}</a>
          <span class="muted small">${String(s.count)} ${s.count === 1 ? 'entry' : 'entries'}${s.description ? html` · ${s.description}` : ''}</span>
          <span class="sets-actions">${s.count ? html`<a class="button-link" href="/sets/${s.id}/study">Study</a>` : ''}
            <button type="button" class="link-button sets-delete" data-id="${s.id}" data-name="${s.name}">Delete</button></span></li>`)}</ul>`
        : html`<p class="muted">No sets yet.</p>`}
    </section>`);
    const msg = main.querySelector<HTMLElement>('.sets-msg')!;
    main.querySelector<HTMLFormElement>('.sets-new')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = ((e.target as HTMLFormElement).elements.namedItem('name') as HTMLInputElement).value.trim();
      createSet(name).then((set) => { if (set) location.assign(`/sets/${set.id}`); }).catch((err: Error) => { msg.textContent = err.message; });
    });
    main.querySelectorAll<HTMLButtonElement>('.sets-delete').forEach((b) => b.addEventListener('click', () => {
      if (!confirm(`Delete the set “${b.dataset.name}”? Its entries stay on the site; what you know of them stays too.`)) return;
      deleteSet(b.dataset.id!).then(() => list(main)).catch((err: Error) => { msg.textContent = err.message; });
    }));
  }).catch(() => render(main, html`<section class="page sets-page"><p class="flash">Your sets could not be loaded.</p></section>`));
}

// ---- one set ----------------------------------------------------------------------------------------------------
const itemPicture = (i: StudyItem) => (i.image
  ? html`<img class="sets-thumb${i.own ? ' own-image' : ''}" src="${i.own ? i.image : thumb(i.image, 120)}" alt="" loading="lazy"${i.own ? '' : html` crossorigin="anonymous"`}>`
  : html`<span class="sets-thumb sets-thumb-empty" aria-hidden="true"></span>`);

function one(main: HTMLElement, id: string) {
  getSet(id).then((r) => {
    if (!r) return loggedOut(main);
    const { set, items } = r;
    document.title = `${set.name} · Study sets · Art History`;
    const byType = new Map<string, StudyItem[]>();
    for (const i of items) { if (!byType.has(i.type)) byType.set(i.type, []); byType.get(i.type)!.push(i); }
    render(main, html`<section class="page sets-page">
      <p class="crumbs"><a href="/sets">Your study sets</a> / ${set.name}</p>
      <h1>${set.name}</h1>
      ${set.description ? html`<p>${set.description}</p>` : ''}
      <details class="sets-edit"><summary class="link-button">Rename / describe</summary>
        <form class="sets-edit-form"><input name="name" value="${set.name}" maxlength="120" required aria-label="Name">
          <textarea name="description" rows="2" maxlength="2000" placeholder="What it is for (optional)" aria-label="Description">${set.description ?? ''}</textarea>
          <button type="submit">Save</button></form></details>
      ${items.length ? html`<form class="sets-study" action="/sets/${set.id}/study">
          <span>Study the ${String(items.length)} ${items.length === 1 ? 'entry' : 'entries'} as index cards:</span>
          <label><input type="radio" name="dir" value="forward" checked> Name it <span class="muted small">(picture, definition, facts → the name)</span></label>
          <label><input type="radio" name="dir" value="reverse"> Describe it <span class="muted small">(the name → picture, facts)</span></label>
          <label><input type="radio" name="dir" value="both"> Both, mixed</label>
          <label><input type="checkbox" name="skip" value="known"> Leave out cards you know well</label>
          <button type="submit">Study</button></form>`
        : html`<p class="muted">Nothing in it yet — add entries with <b>+ Set</b> on their pages.</p>`}
      <p class="sets-msg small" role="status"></p>
      ${[...byType.entries()].map(([type, list]) => html`<section class="sets-group"><h2>${PLURAL_LABEL[PLURAL[type as StudyItem['type']]]} <span class="muted">${String(list.length)}</span></h2>
        <ul class="sets-items">${list.map((i) => html`<li class="sets-entry">
          <a class="sets-entry-link" href="${href(PLURAL[i.type], i.slug)}">${itemPicture(i)}<span><span class="sets-entry-name">${i.name}</span>
            ${i.subtitle ? html`<span class="muted small">${i.subtitle}</span>` : ''}</span></a>
          <button type="button" class="link-button sets-remove" data-type="${i.type}" data-slug="${i.slug}" title="Remove from this set" aria-label="Remove ${i.name} from this set">×</button></li>`)}</ul></section>`)}
    </section>`);
    const msg = main.querySelector<HTMLElement>('.sets-msg')!;
    main.querySelector<HTMLFormElement>('.sets-edit-form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const val = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
      updateSet(set.id, val('name'), val('description')).then(() => one(main, id)).catch((err: Error) => { msg.textContent = err.message; });
    });
    main.querySelectorAll<HTMLButtonElement>('.sets-remove').forEach((b) => b.addEventListener('click', () => {
      import('../api').then(({ removeFromSet }) => removeFromSet(set.id, b.dataset.type as StudyItem['type'], b.dataset.slug!))
        .then(() => one(main, id)).catch((err: Error) => { msg.textContent = err.message; });
    }));
  }).catch(() => render(main, html`<section class="page sets-page"><p class="flash">This set could not be loaded. <a href="/sets">Your sets</a></p></section>`));
}

// ---- the index cards --------------------------------------------------------------------------------------------
/** The text with the entry's name blanked out (its words of three letters or more, any case). */
export function blank(text: string, name: string) {
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // the whole name first ("Ukiyo-e", "The Great Wave"), then its words of three letters or more
  let out = name.trim() ? text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(name.trim())}(?![\\p{L}\\p{N}])`, 'giu'), '▁▁▁') : text;
  const words = [...new Set(name.split(/[\s,.;:()«»"“”‘’'–—-]+/).filter((w) => w.length >= 3))].sort((a, b) => b.length - a.length);
  for (const w of words) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(w)}(?![\\p{L}\\p{N}])`, 'giu'), '▁▁▁');
  return out;
}

const PROMPT: Partial<Record<StudyCard['type'], [string, string]>> = {
  // [Name it, Describe it]
  artwork: ['Which work is it — title, artist, date?', 'What does it look like? Who made it, when?'],
  artist: ['Who is it?', 'Who was it — when, where?'],
  person: ['Who is it?', 'Who was it — when, where?'],
  term: ['Which term is it?', 'What does it mean?'],
  source: ['Which source is it (short reference)?', 'What is the full reference?'],
};
const prompt = (c: StudyCard, d: Dir) => PROMPT[c.type]?.[d === 'forward' ? 0 : 1] ?? (d === 'forward' ? 'What is it?' : 'What do you know about it?');
const picture = (c: StudyCard) => (c.image
  ? html`<img class="study-img" src="${c.own ? c.image : thumb(c.image, 960)}" alt=""${c.own ? '' : html` crossorigin="anonymous"`}>` : '');
const facts = (c: StudyCard) => (c.facts.length ? html`<dl class="study-facts">${c.facts.map((f) => html`<dt>${f.label}</dt><dd>${f.value}</dd>`)}</dl>` : '');

/** What the card shows before it is turned. */
function front(c: StudyCard, d: Dir): Html {
  if (d === 'reverse') return html`<p class="study-type muted small">${TYPE_LABEL[c.type]}</p><p class="study-name">${c.name}</p>`;
  // Name it: an artwork by its picture alone (else its facts); others by what is known of them, the name blanked
  if (c.type === 'artwork' && c.image) return html`<p class="study-type muted small">Artwork</p>${picture(c)}`;
  return html`<p class="study-type muted small">${TYPE_LABEL[c.type]}</p>${c.type === 'artwork' ? '' : picture(c)}${facts(c)}${c.text ? html`<p class="study-text">${blank(c.text, c.name)}</p>` : ''}`;
}
/** What it shows once turned. */
function back(c: StudyCard, d: Dir): Html {
  const link = html`<p class="small"><a href="${href(PLURAL[c.type], c.slug)}" target="_blank" rel="noopener">Open its page ↗</a></p>`;
  if (d === 'forward') return html`<p class="study-name">${c.name}</p>${c.type === 'artwork' ? facts(c) : ''}${link}`;
  return html`${picture(c)}${facts(c)}${c.text ? html`<p class="study-text">${c.text}</p>` : ''}${link}`;
}

interface Turn { card: StudyCard; dir: Dir; again: boolean }

function studyView(main: HTMLElement, id: string, params: URLSearchParams) {
  const mode = params.get('dir') === 'reverse' ? 'reverse' : params.get('dir') === 'both' ? 'both' : 'forward';
  const skipKnown = params.get('skip') === 'known';
  getCards(id).then((r) => {
    if (!r) return loggedOut(main);
    const { set, cards } = r;
    document.title = `Study: ${set.name} · Art History`;
    const dirs: Dir[] = mode === 'both' ? ['forward', 'reverse'] : [mode];
    // every card in the chosen directions; the low boxes first, at random within a box
    let queue: Turn[] = cards.flatMap((card) => dirs.map((dir) => ({ card, dir, again: false })))
      .filter((t) => !skipKnown || (t.card.progress[t.dir]?.box ?? 0) < 5)
      .map((t) => ({ t, k: (t.card.progress[t.dir]?.box ?? 0) + Math.random() }))
      .sort((a, b) => a.k - b.k).map((x) => x.t);
    const total = queue.length;
    let known = 0;
    let notYet = 0;
    const missed: Turn[] = [];
    let turned = false;
    let current: Turn | undefined;

    render(main, html`<section class="page sets-page study-page">
      <p class="crumbs"><a href="/sets">Your study sets</a> / <a href="/sets/${set.id}">${set.name}</a> / Study</p>
      <h1>${set.name} <span class="muted study-mode">${mode === 'both' ? 'Name it and describe it' : dirName[mode]}</span></h1>
      <p class="study-count muted small" aria-live="polite"></p>
      <div class="study-card" tabindex="0" aria-live="polite"></div>
      <p class="study-buttons"></p>
      <p class="muted small study-keys">Space or Enter: turn the card · ←: not yet · →: knew it</p></section>`);
    const box = main.querySelector<HTMLElement>('.study-card')!;
    const buttons = main.querySelector<HTMLElement>('.study-buttons')!;
    const count = main.querySelector<HTMLElement>('.study-count')!;

    const show = () => {
      current = queue.shift();
      turned = false;
      if (!current) return done();
      const p = current.card.progress[current.dir];
      count.textContent = `Card ${String(known + notYet + 1)} of ${String(total + missed.filter((m) => m.again).length)}${p ? ` · box ${String(p.box)} of 5` : ' · new'}${current.again ? ' · once more' : ''}`;
      render(box, html`<div class="study-side study-front">${front(current.card, current.dir)}<p class="study-prompt">${prompt(current.card, current.dir)}</p></div>`);
      render(buttons, html`<button type="button" class="study-turn">Show the answer</button>`);
      box.focus({ preventScroll: true });
    };
    const turn = () => {
      if (!current || turned) return;
      turned = true;
      render(box, html`<div class="study-side study-front study-dim">${front(current.card, current.dir)}</div><div class="study-side study-back">${back(current.card, current.dir)}</div>`);
      render(buttons, html`<button type="button" class="study-no">← Not yet</button> <button type="button" class="study-yes">Knew it →</button>`);
    };
    const answer = (yes: boolean) => {
      if (!current || !turned) return;
      const t = current;
      answerCard(t.card.type, t.card.slug, t.dir, yes).then((p) => { if (p) t.card.progress[t.dir] = p; }).catch(() => {});
      if (yes) known += 1; else notYet += 1;
      // not known: once more at the end of this round
      if (!yes && !t.again) { const again = { ...t, again: true }; queue.push(again); missed.push(again); }
      show();
    };
    const done = () => {
      count.textContent = '';
      const weak = cards.filter((c) => dirs.some((d) => (c.progress[d]?.box ?? 1) <= 1)).length;
      render(box, html`<div class="study-side study-done"><p class="study-name">Done</p>
        <p>${String(known)} known · ${String(notYet)} not yet${missed.length ? html` (they came back once)` : ''}.</p>
        <p class="muted small">${String(weak)} of ${String(cards.length)} ${cards.length === 1 ? 'entry is' : 'entries are'} still in the first box.</p></div>`);
      render(buttons, html`<a class="button-link" href="/sets/${set.id}/study?dir=${mode === 'both' ? 'both' : mode}">Again</a>
        <a class="button-link" href="/sets/${set.id}">Back to the set</a>`);
    };
    buttons.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('button');
      if (!b) return;
      if (b.classList.contains('study-turn')) turn();
      else if (b.classList.contains('study-yes')) answer(true);
      else if (b.classList.contains('study-no')) answer(false);
    });
    box.addEventListener('click', (e) => { if (!(e.target as Element).closest('a')) turn(); });
    const keys = (e: KeyboardEvent) => {
      if (!box.isConnected) { document.removeEventListener('keydown', keys); return; }   // left the page
      if ((e.target as Element).closest?.('input, textarea, select')) return;
      if (e.key === ' ' || e.key === 'Enter') { if (!turned) { e.preventDefault(); turn(); } }
      else if (e.key === 'ArrowRight') answer(true);
      else if (e.key === 'ArrowLeft') answer(false);
    };
    document.addEventListener('keydown', keys);
    if (!total) {
      render(box, html`<div class="study-side study-done"><p>${skipKnown ? 'You know every card of this set well.' : 'This set has no entries yet.'}</p></div>`);
      render(buttons, html`<a class="button-link" href="/sets/${set.id}">Back to the set</a>`);
      return;
    }
    show();
  }).catch(() => render(main, html`<section class="page sets-page"><p class="flash">The cards could not be loaded. <a href="/sets">Your sets</a></p></section>`));
}
