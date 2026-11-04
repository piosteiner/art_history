// "+ Set" on an entry's page (owner 2026-11-04: study sets — backend routes/site-sets.js, migration 218): logged in,
// a small menu lists the account's sets with a tick for those holding the entry (a click adds or removes it) and a
// field for a new set, which gets the entry at once. Visitors see nothing (the site has no accounts for them yet).
import { account } from './account';
import { addToSet, createSet, removeFromSet, setsOf } from './api';
import { html, render } from './html';
import type { EntityType } from './types';

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
    const fill = () => setsOf(type, slug).then((sets) => {
      if (!sets) return;
      const n = sets.filter((s) => s.has).length;
      summary.textContent = n ? `✓ In ${n} set${n === 1 ? '' : 's'}` : '+ Set';
      render(list, sets.length
        ? html`${sets.map((s) => html`<li><label><input type="checkbox" value="${s.id}"${s.has ? ' checked' : ''}> ${s.name}</label></li>`)}`
        : html`<li class="muted small">No sets yet — name your first one below.</li>`);
    }).catch(() => { msg.textContent = 'Your sets could not be loaded.'; });
    // the panel opens towards where there is room: to the right of the button, or ending at its right edge
    const panel = slot.querySelector<HTMLElement>('.set-menu-panel')!;
    const place = () => {
      panel.style.left = '0'; panel.style.right = 'auto';
      const r = panel.getBoundingClientRect();
      if (r.right > document.documentElement.clientWidth - 8) { panel.style.left = 'auto'; panel.style.right = '0'; }
    };
    menu.addEventListener('toggle', () => { if (menu.open) { place(); fill(); } });
    list.addEventListener('change', (e) => {
      const box = e.target as HTMLInputElement;
      if (box.type !== 'checkbox') return;
      box.disabled = true;
      (box.checked ? addToSet(box.value, type, slug) : removeFromSet(box.value, type, slug))
        .then(() => { msg.textContent = box.checked ? 'Added.' : 'Removed.'; return fill(); })
        .catch((err: Error) => { box.checked = !box.checked; msg.textContent = err.message; })
        .finally(() => { box.disabled = false; });
    });
    slot.querySelector<HTMLFormElement>('.set-menu-new')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = (e.target as HTMLFormElement).elements.namedItem('name') as HTMLInputElement;
      const name = input.value.trim();
      if (!name) return;
      createSet(name).then((set) => (set ? addToSet(set.id, type, slug) : null))
        .then(() => { input.value = ''; msg.textContent = `Added to “${name}”.`; return fill(); })
        .catch((err: Error) => { msg.textContent = err.message; });
    });
    // closed by a click elsewhere or Escape
    document.addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target as Node)) menu.open = false; });
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { menu.open = false; summary.focus(); } });
  }).catch(() => {});
}
