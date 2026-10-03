// One dropdown per type ("Artists · 2 of 14"): search, sort with section headings, All / None,
// add or remove everything a search shows, "chosen first", and a checklist of entries.
import { explain, matches, saveSort, savedSort, sortEntries, sortOptions, type Entry, type SortOption } from './catalog';
import { href, html, render } from './html';
import { ALL, GROUPS, type Group, type Pick, type Selection } from './selection';
import type { Plural } from './types';

export interface PickerGroup {
  group: Group;
  plural: Plural;
  label: string;
  entries: Entry[];
}

interface View {
  query: string;
  sort: string;
  chosenFirst: boolean;
  options: SortOption[];
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
  const views = new Map<Group, View>(groups.map((g) => {
    const options = sortOptions(g.plural, g.entries);
    return [g.group, { query: '', sort: savedSort(g.plural, options), chosenFirst: false, options }];
  }));

  render(root, html`<div class="pickers">
    <span class="pickers-label">Show</span>
    ${groups.map((g) => {
      const v = views.get(g.group)!;
      return html`<details class="pick" data-group="${g.group}">
        <summary><span class="pick-name">${g.label}</span> <span class="pick-count"></span></summary>
        <div class="pick-panel">
          <div class="pick-tools">
            <input type="search" class="pick-search" placeholder="Search ${g.label.toLowerCase()}…" aria-label="Search ${g.label.toLowerCase()}" autocomplete="off">
            <select class="pick-sort" aria-label="Sort ${g.label.toLowerCase()}">
              ${v.options.map((o) => html`<option value="${o.id}" ${o.id === v.sort ? html`selected` : ''}>${o.label}</option>`)}
            </select>
          </div>
          <div class="pick-actions">
            <button type="button" data-act="all">All</button>
            <button type="button" data-act="none">None</button>
            <button type="button" data-act="add-shown" hidden></button>
            <button type="button" data-act="remove-shown" hidden>Remove shown</button>
            <label class="pick-first"><input type="checkbox" class="pick-chosen-first"> chosen first</label>
          </div>
          <p class="pick-info muted" aria-live="polite"></p>
          <ul class="pick-list"></ul>
        </div>
      </details>`;
    })}
    <button type="button" class="link-button pickers-reset" hidden>Show everything</button>
  </div>`);

  const reset = root.querySelector<HTMLButtonElement>('.pickers-reset')!;
  const detailsOf = (g: Group) => root.querySelector<HTMLDetailsElement>(`details.pick[data-group="${g}"]`)!;
  const isChosen = (g: Group, slug: string) => {
    const p = sel[g];
    return p.mode === 'all' || (p.mode === 'some' && p.slugs.includes(slug));
  };

  /** The entries a group's search lets through, in its sort order (chosen ones first if asked). */
  function visible(g: Group) {
    const v = views.get(g)!;
    const list = sortEntries(byGroup.get(g)!.entries.filter((e) => matches(e, v.query)), v.sort);
    if (!v.chosenFirst || sel[g].mode === 'all') return { chosenPart: [], rest: list };
    return { chosenPart: list.filter((e) => isChosen(g, e.slug)), rest: list.filter((e) => !isChosen(g, e.slug)) };
  }

  function renderList(g: Group) {
    const v = views.get(g)!;
    const d = detailsOf(g);
    const total = byGroup.get(g)!.entries.length;
    const { chosenPart, rest } = visible(g);
    const shown = chosenPart.length + rest.length;
    // the name is a real link: a click ticks the box, Ctrl/Cmd/middle click or "open in new tab" opens the entry
    const item = (e: Entry) => {
      const m = v.query ? explain(e, v.query) : null;
      return html`<li class="pick-item">
        <label><input type="checkbox" value="${e.slug}">
          <span class="pick-text">
            <span class="pick-line"><a class="pick-link" href="${href(e.type, e.slug)}">${m ? m.name : e.name}</a>${e.meta ? html` <span class="muted">${m ? m.meta : e.meta}</span>` : ''}</span>
            ${m?.why ? html`<span class="pick-why">${m.why}</span>` : ''}
          </span>
        </label>
        <button type="button" class="pick-only" data-only="${e.slug}" title="Show only ${e.name}">only</button>
      </li>`;
    };
    let last = '';
    const withHeadings = rest.map((e) => {
      const h = e.sorts[v.sort]?.heading ?? '';
      const head = h !== last ? html`<li class="pick-heading" aria-hidden="true">${h}</li>` : '';
      last = h;
      return html`${head}${item(e)}`;
    });
    render(d.querySelector('.pick-list')!, html`
      ${chosenPart.length ? html`<li class="pick-heading pick-heading-chosen" aria-hidden="true">Chosen</li>${chosenPart.map(item)}` : ''}
      ${withHeadings}
      ${!total ? html`<li class="muted">No entries yet.</li>` : !shown ? html`<li class="muted">No matches for “${v.query}”.</li>` : ''}`);
    d.querySelector('.pick-info')!.textContent = v.query ? `${shown} of ${total} match` : `${total} ${total === 1 ? 'entry' : 'entries'}`;
    const add = d.querySelector<HTMLButtonElement>('[data-act="add-shown"]')!;
    const remove = d.querySelector<HTMLButtonElement>('[data-act="remove-shown"]')!;
    add.hidden = remove.hidden = !v.query || !shown;
    add.textContent = `Add the ${shown} shown`;
    syncChecks(g);
  }

  function syncChecks(g: Group) {
    detailsOf(g).querySelectorAll<HTMLInputElement>('.pick-list input[type=checkbox]').forEach((cb) => {
      cb.checked = isChosen(g, cb.value);
    });
  }

  function syncSummaries() {
    for (const g of groups) {
      const d = detailsOf(g.group);
      const p = sel[g.group];
      d.querySelector('.pick-count')!.textContent = countLabel(p, g.entries.length);
      d.classList.toggle('pick-filtered', p.mode !== 'all');
    }
    reset.hidden = GROUPS.every((g) => sel[g].mode === 'all');
  }

  /** Nothing ticked = "none"; every entry ticked = "all" (which also includes entries added later). */
  function normalize(g: Group, p: Pick): Pick {
    if (p.mode !== 'some') return p;
    if (!p.slugs.length) return { mode: 'none' };
    const all = byGroup.get(g)!.entries;
    return all.length && all.every((e) => p.slugs.includes(e.slug)) ? { mode: 'all' } : p;
  }

  function set(g: Group, p: Pick) {
    sel = { ...sel, [g]: normalize(g, p) };
    syncSummaries();
    if (views.get(g)!.chosenFirst) renderList(g);
    else syncChecks(g);
    onChange(sel);
  }

  const allSlugs = (g: Group) => byGroup.get(g)!.entries.map((e) => e.slug);
  const current = (g: Group) => (sel[g].mode === 'all' ? allSlugs(g) : sel[g].mode === 'some' ? (sel[g] as { slugs: string[] }).slugs : []);

  function toggle(g: Group, slug: string, on: boolean) {
    const now = current(g);
    if (on) set(g, { mode: 'some', slugs: now.includes(slug) ? now : [...now, slug] });
    else set(g, { mode: 'some', slugs: now.filter((s) => s !== slug) });
  }

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    const g = t.closest<HTMLDetailsElement>('details.pick')?.dataset.group as Group | undefined;
    if (!g) return;
    if (t instanceof HTMLSelectElement && t.classList.contains('pick-sort')) {
      views.get(g)!.sort = t.value;
      saveSort(byGroup.get(g)!.plural, t.value);
      renderList(g);
    } else if (t instanceof HTMLInputElement && t.classList.contains('pick-chosen-first')) {
      views.get(g)!.chosenFirst = t.checked;
      renderList(g);
    } else if (t instanceof HTMLInputElement && t.type === 'checkbox') {
      toggle(g, t.value, t.checked);
    }
  });

  root.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a.pick-link');
    if (a) {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // the browser opens it in a new tab/window
      e.preventDefault();
      const cb = a.closest('li')!.querySelector<HTMLInputElement>('input[type=checkbox]')!;
      toggle(a.closest<HTMLDetailsElement>('details.pick')!.dataset.group as Group, cb.value, !cb.checked);
      return;
    }
    const btn = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!btn) return;
    if (btn === reset) {
      sel = structuredClone(ALL);
      syncSummaries();
      groups.forEach((g) => renderList(g.group));
      onChange(sel);
      return;
    }
    const g = btn.closest<HTMLDetailsElement>('details.pick')?.dataset.group as Group | undefined;
    if (!g) return;
    const { chosenPart, rest } = visible(g);
    const shownSlugs = [...chosenPart, ...rest].map((x) => x.slug);
    switch (btn.dataset.act) {
      case 'all': return set(g, { mode: 'all' });
      case 'none': return set(g, { mode: 'none' });
      case 'add-shown': {
        if (sel[g].mode === 'all') return;
        const now = current(g);
        return set(g, { mode: 'some', slugs: [...now, ...shownSlugs.filter((s) => !now.includes(s))] });
      }
      case 'remove-shown':
        return set(g, { mode: 'some', slugs: current(g).filter((s) => !shownSlugs.includes(s)) });
    }
    if (btn.dataset.only) set(g, { mode: 'some', slugs: [btn.dataset.only] });
  });

  root.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains('pick-search')) return;
    const g = input.closest<HTMLDetailsElement>('details.pick')!.dataset.group as Group;
    views.get(g)!.query = input.value.trim();
    renderList(g);
  });

  root.addEventListener('keydown', (e) => {
    const input = e.target as HTMLElement;
    const d = input.closest<HTMLDetailsElement>('details.pick');
    if (!d) return;
    if (e.key === 'Escape') {
      d.open = false;
      d.querySelector('summary')!.focus();
    } else if (e.key === 'Enter' && input.classList.contains('pick-search')) {
      // Enter ticks (or unticks) the first match
      e.preventDefault();
      const first = d.querySelector<HTMLInputElement>('.pick-list input[type=checkbox]');
      if (first) toggle(d.dataset.group as Group, first.value, !first.checked);
    }
  });

  // one panel open at a time, search focused; clicking elsewhere closes it
  root.addEventListener('toggle', (e) => {
    const opened = e.target as HTMLDetailsElement;
    if (!opened.open) return;
    root.querySelectorAll<HTMLDetailsElement>('details.pick[open]').forEach((d) => d !== opened && (d.open = false));
    renderList(opened.dataset.group as Group);
    opened.querySelector<HTMLInputElement>('.pick-search')!.focus({ preventScroll: true });
  }, true);
  const outside = (e: MouseEvent) => {
    if (!root.contains(e.target as Node)) root.querySelectorAll<HTMLDetailsElement>('details.pick[open]').forEach((d) => (d.open = false));
  };
  document.addEventListener('click', outside);

  // a remembered or shared URL may tick every entry one by one: show (and store) it as "all"
  const before = JSON.stringify(sel);
  for (const g of groups) sel = { ...sel, [g.group]: normalize(g.group, sel[g.group]) };
  syncSummaries();
  if (JSON.stringify(sel) !== before) queueMicrotask(() => onChange(sel));
  return { destroy: () => document.removeEventListener('click', outside) };
}
