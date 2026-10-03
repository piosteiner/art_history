// One dropdown per type ("Artists · 2 of 14"): All / None, a filter box and a checklist of entries.
import { html, render } from './html';
import { ALL, GROUPS, type Group, type Pick, type Selection } from './selection';

export interface PickItem {
  slug: string;
  name: string;
  meta?: string; // dates or kind, shown small next to the name
}

export interface PickerGroup {
  group: Group;
  label: string;
  items: PickItem[];
}

const countLabel = (p: Pick, total: number) =>
  p.mode === 'all' ? 'all' : p.mode === 'none' ? 'none' : `${p.slugs.length} of ${total}`;

export function mountPickers(
  root: HTMLElement,
  groups: PickerGroup[],
  initial: Selection,
  onChange: (sel: Selection) => void,
) {
  let sel: Selection = structuredClone(initial);
  const byGroup = new Map(groups.map((g) => [g.group, g]));

  render(root, html`<div class="pickers">
    <span class="pickers-label">Show</span>
    ${groups.map((g) => html`<details class="pick" data-group="${g.group}">
      <summary><span class="pick-name">${g.label}</span> <span class="pick-count"></span></summary>
      <div class="pick-panel">
        <div class="pick-actions">
          <button type="button" data-act="all">All</button>
          <button type="button" data-act="none">None</button>
        </div>
        ${g.items.length > 8 ? html`<input type="search" class="pick-filter" placeholder="Filter…" aria-label="Filter ${g.label.toLowerCase()}">` : ''}
        <ul class="pick-list">${g.items.map((it) => html`<li data-name="${it.name.toLowerCase()}">
          <label><input type="checkbox" value="${it.slug}"> <span>${it.name}</span>${it.meta ? html` <span class="muted">${it.meta}</span>` : ''}</label>
          <button type="button" class="pick-only" data-only="${it.slug}" title="Show only ${it.name}">only</button>
        </li>`)}${g.items.length ? '' : html`<li class="muted">No entries yet.</li>`}</ul>
      </div>
    </details>`)}
    <button type="button" class="link-button pickers-reset" hidden>Show everything</button>
  </div>`);

  const reset = root.querySelector<HTMLButtonElement>('.pickers-reset')!;

  /** Reflects `sel` in the summaries and checkboxes. */
  function sync() {
    for (const details of root.querySelectorAll<HTMLDetailsElement>('details.pick')) {
      const g = details.dataset.group as Group;
      const p = sel[g];
      details.querySelector('.pick-count')!.textContent = countLabel(p, byGroup.get(g)!.items.length);
      details.classList.toggle('pick-filtered', p.mode !== 'all');
      details.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((cb) => {
        cb.checked = p.mode === 'all' || (p.mode === 'some' && p.slugs.includes(cb.value));
      });
    }
    reset.hidden = GROUPS.every((g) => sel[g].mode === 'all');
  }

  function set(g: Group, p: Pick) {
    sel = { ...sel, [g]: p };
    sync();
    onChange(sel);
  }

  root.addEventListener('change', (e) => {
    const cb = e.target as HTMLInputElement;
    if (cb.type !== 'checkbox') return;
    const details = cb.closest<HTMLDetailsElement>('details.pick')!;
    const g = details.dataset.group as Group;
    const checked = [...details.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')].map((c) => c.value);
    // keep earlier picks first, so colours on the map stay put when more are added
    const before = sel[g].mode === 'some' ? (sel[g] as { slugs: string[] }).slugs : [];
    const slugs = [...before.filter((s) => checked.includes(s)), ...checked.filter((s) => !before.includes(s))];
    set(g, slugs.length ? { mode: 'some', slugs } : { mode: 'none' });
  });

  root.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!btn) return;
    if (btn === reset) {
      sel = structuredClone(ALL);
      sync();
      onChange(sel);
      return;
    }
    const g = btn.closest<HTMLDetailsElement>('details.pick')?.dataset.group as Group | undefined;
    if (!g) return;
    if (btn.dataset.act === 'all') set(g, { mode: 'all' });
    else if (btn.dataset.act === 'none') set(g, { mode: 'none' });
    else if (btn.dataset.only) set(g, { mode: 'some', slugs: [btn.dataset.only] });
  });

  root.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains('pick-filter')) return;
    const q = input.value.trim().toLowerCase();
    input.closest('details')!.querySelectorAll<HTMLLIElement>('.pick-list li[data-name]').forEach((li) => {
      li.hidden = !!q && !li.dataset.name!.includes(q);
    });
  });

  // one panel open at a time; clicking elsewhere closes it
  root.addEventListener('toggle', (e) => {
    const opened = e.target as HTMLDetailsElement;
    if (opened.open) root.querySelectorAll<HTMLDetailsElement>('details.pick[open]').forEach((d) => d !== opened && (d.open = false));
  }, true);
  const outside = (e: MouseEvent) => {
    if (!root.contains(e.target as Node)) root.querySelectorAll<HTMLDetailsElement>('details.pick[open]').forEach((d) => (d.open = false));
  };
  document.addEventListener('click', outside);

  sync();
  return { destroy: () => document.removeEventListener('click', outside) };
}

