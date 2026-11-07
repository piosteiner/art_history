// Study sets — see index.ts for the whole picture. This file: history.
import { PLURAL, getSetHistory, restoreSet, type SetEvent } from '../../api';
import { ask } from '../../dialog';
import { at } from '../../format';
import { href, html, render } from '../../html';





const WHAT: Record<SetEvent['action'], string> = { created: 'created the set', changed: 'changed the', added: 'added', removed: 'removed', restored: 'restored the set to', locked: 'locked the set', unlocked: 'unlocked the set' };

/** A set's history (221), loaded when opened: who changed what, newest first; the owner restores the set to any step. */
export function history(details: HTMLDetailsElement, id: string, owner: boolean, reload: () => void) {
  const box = details.querySelector<HTMLElement>('.sets-history-body')!;
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    getSetHistory(id).then((r) => {
      if (!r) return;
      const ev = r.events;
      const entry = (e: SetEvent) => (e.entry ? html`<a href="${href(PLURAL[e.entry.type], e.entry.slug)}">${e.entry.name}</a>` : html`<span class="muted">an entry since deleted</span>`);
      const what = (e: SetEvent) => (e.action === 'changed' ? html`${WHAT.changed} ${e.field}${e.field === 'description' ? '' : html`: <s class="muted">${e.old ?? '—'}</s> → ${e.new ?? '—'}`}`
        : e.action === 'added' || e.action === 'removed' ? html`${WHAT[e.action]} ${entry(e)}`
          : e.action === 'restored' ? html`${WHAT.restored} ${e.detail?.to ? at(e.detail.to) : '?'} <span class="muted small">(${String(e.detail?.removed ?? 0)} removed, ${String(e.detail?.added ?? 0)} back${e.detail?.reason ? ` · ${e.detail.reason}` : ''})</span>`
            : WHAT[e.action]);
      render(box, html`<p class="muted small">${owner ? 'Every change, newest first. “Back to here” makes the set as it was right after that step — the restore is a step too, so it can be undone.' : 'Every change, newest first. The owner can bring the set back to any step.'}
        ${ev.some((e) => e.seeded) ? ' Changes before 5 November 2026 are not recorded; entries added before then are.' : ''}</p>
        <ol class="sets-history-list">${ev.map((e, i) => html`<li><span class="muted small">${at(e.at)}</span> <b>${e.by ?? '—'}</b> ${what(e)}
          ${owner && i > 0 ? html`<button type="button" class="link-button small sets-restore" data-event="${e.id}" data-at="${e.at}">Back to here</button>` : ''}</li>`)}</ol>
        ${r.more ? html`<p class="muted small">The 1000 most recent steps.</p>` : ''}<p class="sets-history-msg small" role="status"></p>`);
      box.querySelectorAll<HTMLButtonElement>('.sets-restore').forEach((b) => b.addEventListener('click', async () => {
        if (!(await ask(`Make the set as it was on ${at(b.dataset.at!)}? Entries added since go, entries removed since come back. You can undo this the same way.`, { title: 'Go back to this moment?', ok: 'Restore' }))) return;
        restoreSet(id, b.dataset.event!).then(() => reload()).catch((err: Error) => { box.querySelector('.sets-history-msg')!.textContent = err.message; });
      }));
    }).catch(() => render(box, html`<p class="muted">The history could not be loaded.</p>`));
  });
}
