// "+ Set" on an entry's page (owner 2026-11-04: study sets — backend routes/site-sets.js, migration 218): logged in,
// a small menu lists the account's sets with a tick for those holding the entry (a click adds or removes it) and a
// field for a new set, which gets the entry at once. Visitors see nothing (the site has no accounts for them yet).
// A set the account edits with approval or votes (228): a click proposes the change — the menu says so and marks it
// "proposed" until it is decided; a locked set can't be changed.
// Where (owner 2026-11-07): fixed at the bottom right of the screen, above the feedback button, so it stays at hand
// while the page scrolls; the panel opens upwards. Locked sets are hidden from the list until "Show locked sets"
// (they can't be changed anyway, and with many sets they crowd it) — the choice is remembered in this browser.
import { account } from './account';
import { addToSet, createSet, removeFromSet, setsOf } from './api';
import { html, render } from './html';
import type { EntityType } from './types';

/** What a change in a set does for this account (228) — the title of its line */
const HOW: Record<string, string> = {
  owner: 'Your set: changes apply at once', full: 'You edit it with full rights: changes apply at once',
  approval: 'You edit it with the owner\'s approval: a change is a proposal until the owner accepts it',
  advisory: 'You edit it with votes: the members vote on a change, the owner decides', binding: 'You edit it with votes: the vote decides a change',
};

const KEY = 'arthistory.set-menu.locked';
const remembered = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const remember = (on: boolean) => { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* no storage */ } };

export function addToSetButton(slot: HTMLElement | null, type: EntityType, slug: string, title: string) {
  if (!slot) return;
  account().then((name) => {
    if (!name || !slot.isConnected) return;
    render(slot, html`<details class="set-menu">
      <summary class="button-link" title="Keep it in one of your study sets">+ Set</summary>
      <div class="set-menu-panel" role="group" aria-label="Your study sets">
        <p class="muted small set-menu-head">Keep “${title}” in:</p>
        <ul class="set-menu-list"><li class="muted small">Loading…</li></ul>
        <form class="set-menu-new"><input name="name" placeholder="New set…" aria-label="Name of a new set" maxlength="120" autocomplete="off">
          <button type="submit">Create</button></form>
        <p class="small"><a href="/sets">All your sets →</a></p>
        <p class="set-menu-msg small" role="status"></p>
      </div></details>`);
    const menu = slot.querySelector<HTMLDetailsElement>('.set-menu')!;
    const list = slot.querySelector<HTMLUListElement>('.set-menu-list')!;
    const msg = slot.querySelector<HTMLElement>('.set-menu-msg')!;
    const summary = menu.querySelector('summary')!;
    const fill = () => setsOf(type, slug).then((all) => {
      if (!all) return;
      const n = all.filter((s) => s.has).length;
      summary.textContent = n ? `✓ In ${n} set${n === 1 ? '' : 's'}` : '+ Set';
      const locked = all.filter((s) => s.locked).length;
      const showLocked = remembered();
      const sets = showLocked ? all : all.filter((s) => !s.locked);
      const toggle = locked ? html`<li class="set-menu-locked"><button type="button" class="link-button small" data-locked="${showLocked ? '0' : '1'}">${showLocked ? `Hide locked sets` : `Show ${String(locked)} locked set${locked === 1 ? '' : 's'}`}</button></li>` : '';
      render(list, sets.length || locked
        ? html`${sets.map((s) => html`<li><label title="${HOW[s.rights === 'vote' ? s.vote_mode : s.rights]}"><input type="checkbox" value="${s.id}" data-rights="${s.rights}" data-mode="${s.vote_mode}"${s.has ? ' checked' : ''}${s.proposed || s.locked ? ' disabled' : ''}> ${s.name}${
          s.proposed ? html` <span class="tag">${s.proposed === 'add' ? 'adding' : 'removal'} proposed</span>` : s.locked ? html` <span class="tag">locked</span>`
            : s.rights === 'approval' || s.rights === 'vote' ? html` <span class="muted small">(${s.rights === 'approval' ? 'the owner approves' : s.vote_mode === 'binding' ? 'by vote' : 'vote, the owner decides'})</span>` : ''}</label></li>`)}${toggle}`
        : html`<li class="muted small">No sets yet — name your first one below.</li>`);
    }).catch(() => { msg.textContent = 'Your sets could not be loaded.'; });
    menu.addEventListener('toggle', () => { if (menu.open) void fill(); });
    list.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('[data-locked]');
      if (!b) return;
      e.stopPropagation();
      remember(b.dataset.locked === '1');
      void fill();
    });
    list.addEventListener('change', (e) => {
      const box = e.target as HTMLInputElement;
      if (box.type !== 'checkbox') return;
      box.disabled = true;
      (box.checked ? addToSet(box.value, type, slug) : removeFromSet(box.value, type, slug))
        .then((r) => {
          if (r && 'proposed' in r) {
            const done = r.proposal?.outcome === 'accepted';
            msg.textContent = done ? (box.checked ? 'Added — with only you and the owner voting, no vote is needed.' : 'Removed — with only you and the owner voting, no vote is needed.')
              : `Proposed: ${box.checked ? 'adding' : 'removing'} it ${box.dataset.rights === 'approval' ? 'waits for the owner\'s approval' : box.dataset.mode === 'binding' ? 'is put to the vote' : 'is put to the vote; the owner decides'}.`;
          } else msg.textContent = box.checked ? 'Added.' : 'Removed.';
          return fill();
        })
        .catch((err: Error) => { box.checked = !box.checked; msg.textContent = err.message; })
        .finally(() => { box.disabled = false; });
    });
    slot.querySelector<HTMLFormElement>('.set-menu-new')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = (e.target as HTMLFormElement).elements.namedItem('name') as HTMLInputElement;
      const name = input.value.trim();
      if (!name) return;
      createSet(name).then((set) => (set?.id ? addToSet(set.id, type, slug) : null))
        .then(() => { input.value = ''; msg.textContent = `Added to “${name}”.`; return fill(); })
        .catch((err: Error) => { msg.textContent = err.message; });
    });
    // closed by a click elsewhere or Escape
    document.addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target as Node)) menu.open = false; });
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { menu.open = false; summary.focus(); } });
  }).catch(() => {});
}
