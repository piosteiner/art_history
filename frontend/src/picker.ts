// One dropdown per type ("Artists · 2 of 14"): search, sort with section headings, All / None,
// add or remove everything a search shows, "chosen first", and a checklist of entries.
// Layers (museums, events) also have "Auto": the page picks them (`auto`), and their ticks show what it picked.
import { explain, matches, ordered, saveSort, savedSort, sortOptions, type Entry, type SortOption } from './catalog';
import { creatorsOf, href, html, langAttr, render } from './html';
import { ALL, includes, isDefault, isLayer, layerIncludes, type Key, type Pick, type Selection } from './selection';
import type { ArtworkItem, Plural } from './types';

export interface PickerGroup {
  group: Key;
  plural: Plural;
  label: string;
  entries: Entry[];
  /** Layers: what "Auto" picks, in words ("linked to the map") — the button's title and the summary. */
  autoLabel?: string;
}

interface View {
  query: string;
  sort: string;
  chosenFirst: boolean;
  options: SortOption[];
}

const countLabel = (p: Pick, total: number, autoCount: number) =>
  p.mode === 'all' ? 'all' : p.mode === 'none' ? 'none' : p.mode === 'by-artists' ? 'by chosen artists'
    : p.mode === 'auto' ? `auto · ${autoCount}` : `${p.slugs.length} of ${total}`;

export function mountPickers(
  root: HTMLElement,
  groups: PickerGroup[],
  initial: Selection,
  onChange: (sel: Selection) => void,
  /** Layers in "Auto": whether the page has picked this entry (asked again on refresh()). */
  auto: (layer: Key, slug: string) => boolean = () => false,
) {
  let sel: Selection = structuredClone(initial);
  const byGroup = new Map(groups.map((g) => [g.group, g]));
  const views = new Map<Key, View>(groups.map((g) => {
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
            ${g.group === 'artwork' ? html`<button type="button" data-act="by-artists" title="Follows the Artists selection, also when you change it later">By chosen artists</button>` : ''}
            ${isLayer(g.group) ? html`<button type="button" data-act="auto" title="${`Picked for you: ${g.autoLabel ?? 'automatically'} — follows the other pickers and the time window`}">Auto</button>` : ''}
            <button type="button" data-act="add-shown" hidden></button>
            <button type="button" data-act="remove-shown" hidden>Remove shown</button>
            <label class="pick-first"><input type="checkbox" class="pick-chosen-first"> chosen first</label>
          </div>
          ${g.autoLabel ? html`<p class="pick-auto muted small" hidden>Auto: ${g.autoLabel}. Tick or untick one to choose yourself.</p>` : ''}
          <p class="pick-info muted" aria-live="polite"></p>
          <ul class="pick-list"></ul>
        </div>
      </details>`;
    })}
    <button type="button" class="link-button pickers-reset" hidden>Show everything</button>
  </div>`);

  const reset = root.querySelector<HTMLButtonElement>('.pickers-reset')!;
  const detailsOf = (g: Key) => root.querySelector<HTMLDetailsElement>(`details.pick[data-group="${g}"]`)!;
  // an artwork's artists, for the "by chosen artists" mode
  const artists = new Map((byGroup.get('artwork')?.entries ?? []).map((e) => [e.slug, creatorsOf(e.item as ArtworkItem).map((c) => c.slug)]));
  const isChosen = (g: Key, slug: string) => (isLayer(g) ? layerIncludes(sel, g, slug, (s) => auto(g, s)) : includes(sel, g, slug, (a) => artists.get(a)));

  const headings = new Map<Key, Map<string, string>>(); // per group: an entry's section heading in the last list
  /** The entries a group's search lets through, in its sort order (chosen ones first if asked). */
  function visible(g: Key) {
    const v = views.get(g)!;
    // in the sort's order with its headings; found only through a museum: after the others (catalog.ordered)
    const list = ordered(byGroup.get(g)!.entries.filter((e) => matches(e, v.query)), v.query, v.sort);
    headings.set(g, new Map(list.map((x) => [x.entry.slug, x.heading])));
    const all = list.map((x) => x.entry);
    if (!v.chosenFirst || sel[g].mode === 'all') return { chosenPart: [], rest: all };
    return { chosenPart: all.filter((e) => isChosen(g, e.slug)), rest: all.filter((e) => !isChosen(g, e.slug)) };
  }

  function renderList(g: Key) {
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
            <span class="pick-line"><a class="pick-link"${langAttr(e.lang)} href="${href(e.type, e.slug)}">${m ? m.name : e.name}</a>${e.meta ? html` <span class="muted">${m ? m.meta : e.meta}</span>` : ''}</span>
            ${m?.why ? html`<span class="pick-why">${m.why}</span>` : ''}
          </span>
        </label>
        <button type="button" class="pick-only" data-only="${e.slug}" title="Show only ${e.name}">only</button>
      </li>`;
    };
    let last = '';
    const withHeadings = rest.map((e) => {
      const h = headings.get(g)?.get(e.slug) ?? '';
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

  function syncChecks(g: Key) {
    detailsOf(g).querySelectorAll<HTMLInputElement>('.pick-list input[type=checkbox]').forEach((cb) => {
      cb.checked = isChosen(g, cb.value);
    });
  }

  function syncSummaries() {
    for (const g of groups) {
      const d = detailsOf(g.group);
      const p = sel[g.group];
      d.querySelector('.pick-count')!.textContent = countLabel(p, g.entries.length, p.mode === 'auto' ? g.entries.filter((e) => auto(g.group, e.slug)).length : 0);
      d.classList.toggle('pick-filtered', p.mode !== 'all' && p.mode !== 'auto');
      d.querySelector<HTMLElement>('.pick-auto')?.toggleAttribute('hidden', p.mode !== 'auto');
    }
    reset.hidden = isDefault(sel);
  }

  /** Nothing ticked = "none"; every entry ticked = "all" (which also includes entries added later). */
  function normalize(g: Key, p: Pick): Pick {
    if (p.mode !== 'some') return p;
    if (!p.slugs.length) return { mode: 'none' };
    const all = byGroup.get(g)!.entries;
    return all.length && all.every((e) => p.slugs.includes(e.slug)) ? { mode: 'all' } : p;
  }

  function set(g: Key, p: Pick) {
    sel = { ...sel, [g]: normalize(g, p) };
    syncSummaries();
    // "by chosen artists" follows the artist picks, so those ticks change too
    const affected: Key[] = g === 'artist' && sel.artwork.mode === 'by-artists' ? [g, 'artwork'] : [g];
    for (const a of affected) {
      if (!byGroup.has(a)) continue;
      if (views.get(a)!.chosenFirst) renderList(a);
      else syncChecks(a);
    }
    onChange(sel);
  }

  const allSlugs = (g: Key) => byGroup.get(g)!.entries.map((e) => e.slug);
  const current = (g: Key) => {
    const p = sel[g];
    if (p.mode === 'some') return p.slugs;
    return p.mode === 'none' ? [] : allSlugs(g).filter((s) => isChosen(g, s));
  };

  function toggle(g: Key, slug: string, on: boolean) {
    const now = current(g);
    if (on) set(g, { mode: 'some', slugs: now.includes(slug) ? now : [...now, slug] });
    else set(g, { mode: 'some', slugs: now.filter((s) => s !== slug) });
  }

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    const g = t.closest<HTMLDetailsElement>('details.pick')?.dataset.group as Key | undefined;
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
      toggle(a.closest<HTMLDetailsElement>('details.pick')!.dataset.group as Key, cb.value, !cb.checked);
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
    const g = btn.closest<HTMLDetailsElement>('details.pick')?.dataset.group as Key | undefined;
    if (!g) return;
    const { chosenPart, rest } = visible(g);
    const shownSlugs = [...chosenPart, ...rest].map((x) => x.slug);
    switch (btn.dataset.act) {
      case 'all': return set(g, { mode: 'all' });
      case 'none': return set(g, { mode: 'none' });
      case 'by-artists': return set(g, { mode: 'by-artists' });
      case 'auto': return set(g, { mode: 'auto' });
      case 'add-shown': {
        if (sel[g].mode === 'all') return;  // (auto: what it picked becomes your own choice, plus the shown ones)
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
    const g = input.closest<HTMLDetailsElement>('details.pick')!.dataset.group as Key;
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
      if (first) toggle(d.dataset.group as Key, first.value, !first.checked);
    }
  });

  // one panel open at a time, search focused; clicking elsewhere closes it
  root.addEventListener('toggle', (e) => {
    const opened = e.target as HTMLDetailsElement;
    if (!opened.open) return;
    root.querySelectorAll<HTMLDetailsElement>('details.pick[open]').forEach((d) => d !== opened && (d.open = false));
    renderList(opened.dataset.group as Key);
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
  return {
    destroy: () => document.removeEventListener('click', outside),
    /** What "Auto" picks has changed (other picks, the time window): ticks and counts again. */
    refresh() {
      syncSummaries();
      for (const g of groups) if (isLayer(g.group) && sel[g.group].mode === 'auto') syncChecks(g.group);
    },
  };
}
