// Study sets — see index.ts for the whole picture. This file: proposals.
import { PLURAL, decideProposal, voteOn, withdrawProposal, type SetProposal, type StudySet, type Vote } from '../../api';
import { at } from '../../format';
import { href, html, render } from '../../html';
import { VOTE_LABEL, until } from './common';




const OUTCOME: Record<string, string> = { accepted: 'accepted', rejected: 'rejected', withdrawn: 'withdrawn', outdated: 'outdated — done or changed meanwhile', closed: 'closed — the set became private' };
/** "add X" / "remove X" / "rename to Y" — what a proposal changes */
function changeOf(p: SetProposal) {
  const entry = p.slug && p.type ? html`<a href="${href(PLURAL[p.type], p.slug)}">${p.name ?? p.slug}</a>` : html`<span class="muted">an entry since deleted</span>`;
  if (p.kind === 'add') return html`add ${entry}`;
  if (p.kind === 'remove') return html`remove ${entry}${p.added_by ? html` <span class="muted small">(added by ${p.added_by})</span>` : ''}`;
  if (p.field === 'description') return html`a new description <details class="sets-proposal-text"><summary class="small">show</summary><div class="small"><b>Now:</b> ${p.old ?? '—'}</div><div class="small"><b>Proposed:</b> ${p.new ?? '—'}</div></details>`;
  return html`${p.field === 'name' ? 'rename it' : 'a new topic'}: <s class="muted">${p.old ?? '—'}</s> → <b>${p.new ?? '—'}</b>`;
}

/** The set's proposed changes (228): what each changes, who proposed it and why, how it is decided, the votes; the
 *  members vote Yes / No / Abstain where it is put to the vote; the owner accepts or rejects where they may; the
 *  proposer withdraws. The last decided ones below. */
export function proposalList(box: HTMLElement, set: StudySet, id: string, open: SetProposal[], decided: SetProposal[], reload: () => void) {
  const owner = set.role === 'owner';
  const locked = Boolean(set.locked_at);
  const how = (p: SetProposal) => (p.procedure === 'approval' ? 'The owner accepts or rejects it.'
    : p.procedure === 'advisory' ? 'Put to the vote; the owner decides, seeing the votes.'
      : p.tie_at ? 'The vote ended even — the owner decides.'
        : `Put to the vote: it decides ${until(p.closes_at!)} (${at(p.closes_at!)}) or earlier, once the missing votes can't change it.${set.owner_veto ? ' The owner may decide before.' : ''}`);
  const count = (p: SetProposal, v: Vote) => (p.votes ?? []).filter((x) => x.vote === v).length;
  const mayDecide = (p: SetProposal) => owner && (p.procedure !== 'binding' || Boolean(p.tie_at) || Boolean(set.owner_veto));
  render(box, html`<h2>Proposed changes${open.length ? html` <span class="muted">${String(open.length)}</span>` : ''}</h2>
    ${open.length ? html`<ul class="sets-proposal-list">${open.map((p) => {
      const missing = Math.max(0, (p.voters ?? 0) - (p.votes ?? []).length);
      return html`<li class="sets-proposal" data-id="${p.id}">
        <span>${changeOf(p)}</span> <span class="muted small">proposed by ${p.proposed_by ?? '—'}${p.mine ? ' (you)' : ''} · ${at(p.created_at)}</span>
        ${p.reason ? html`<q class="sets-proposal-reason">${p.reason}</q>` : ''}
        <span class="small sets-proposal-how">${how(p)}</span>
        ${p.procedure === 'approval' ? '' : html`<span class="sets-votes small" title="${(p.votes ?? []).map((v) => `${v.by ?? '—'}: ${VOTE_LABEL[v.vote]}`).join(', ')}">
          <b>${String(count(p, 'yes'))}</b> yes · <b>${String(count(p, 'no'))}</b> no · <b>${String(count(p, 'abstain'))}</b> abstain${missing ? ` · ${String(missing)} not voted yet` : ''}
          ${(p.votes ?? []).length ? html` <span class="muted">(${(p.votes ?? []).map((v) => `${v.by ?? '—'}: ${VOTE_LABEL[v.vote]}`).join(', ')})</span>` : ''}</span>`}
        ${p.procedure === 'approval' || p.tie_at || locked ? '' : html`<span class="sets-vote">${(['yes', 'no', 'abstain'] as const).map((v) => html`<button type="button"
          class="link-button${p.my_vote === v ? ' on' : ''}" data-vote="${v}" aria-pressed="${String(p.my_vote === v)}">${VOTE_LABEL[v]}</button> `)}</span>`}
        ${mayDecide(p) ? html`<span class="sets-decide"><button type="button" data-decide="accepted">Accept</button> <button type="button" class="secondary" data-decide="rejected">Reject</button></span>` : ''}
        ${p.mine ? html`<button type="button" class="link-button small" data-withdraw="${p.id}">Withdraw</button>` : ''}</li>`;
    })}</ul>` : html`<p class="muted small">Nothing waiting.</p>`}
    ${decided.length ? html`<details class="sets-decided"><summary class="small">Decided lately (${String(decided.length)})</summary><ul class="small">${decided.map((p) => html`<li>${changeOf(p)} — <b>${OUTCOME[p.outcome ?? ''] ?? p.outcome}</b>
      <span class="muted">${p.by_vote ? 'by the vote' : p.decided_by ? `by ${p.decided_by}` : ''} · ${p.decided_at ? at(p.decided_at) : ''} · proposed by ${p.proposed_by ?? '—'}</span></li>`)}</ul></details>` : ''}
    <p class="sets-proposals-msg small" role="status"></p>`);
  const msg = box.querySelector<HTMLElement>('.sets-proposals-msg')!;
  const fail = (err: Error) => { msg.textContent = err.message; };
  box.querySelectorAll<HTMLElement>('.sets-proposal').forEach((li) => {
    li.querySelectorAll<HTMLButtonElement>('[data-vote]').forEach((b) => b.addEventListener('click', () => { voteOn(id, li.dataset.id!, b.dataset.vote as Vote).then(reload).catch(fail); }));
    li.querySelectorAll<HTMLButtonElement>('[data-decide]').forEach((b) => b.addEventListener('click', () => { decideProposal(id, li.dataset.id!, b.dataset.decide as 'accepted' | 'rejected').then(reload).catch(fail); }));
    li.querySelector<HTMLButtonElement>('[data-withdraw]')?.addEventListener('click', () => { withdrawProposal(id, li.dataset.id!).then(reload).catch(fail); });
  });
}
