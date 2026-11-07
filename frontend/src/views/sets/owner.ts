// Study sets — see index.ts for the whole picture. This file: owner.

import { cancelInvitation, changeMember, endSetLink, getSet, getSetMembers, getSets, getSharing, hideInSetChat, inviteToSet, newSetLink, reportSetChat, saveVoteSettings, setChatMember, shareSet, type FriendStatus, type SetMember, type SetRights, type SetSharing, type StudySet, type Visibility, type VoteMode } from '../../api';
import { ask, askText } from '../../dialog';
import { day, plural } from '../../format';
import { html, render } from '../../html';
import { RIGHTS, RIGHTS_NAME, RightsKey, VISIBILITY, VIS_HELP, VIS_LABEL, joinUrl, rightsText, shareUrl, together, visBadge, voteRules } from './common';


import { friendButton, friendButtons, friendStatuses, who } from './members';




/** The owner's "Sharing and members" (228): who sees the set; its members with their rights (changed, chat for
 *  viewers, handed the set, removed); friends invited with rights; links with rights (turned off one by one); how
 *  votes work — and what every kind of rights means, in the same words the members see. */
export function ownerPanel(shareD: HTMLDetailsElement, membersD: HTMLDetailsElement, set: StudySet, id: string, reload: () => void) {
  // two panels (owner 2026-11-06): Sharing = who can see it, links, votes; Members = the members with their rights,
  // invitations, what each part may do. Drawn together from one answer; a note goes to the panel it concerns.
  const sbox = shareD.querySelector<HTMLElement>('.sets-share-body')!;
  const mbox = membersD.querySelector<HTMLElement>('.sets-share-body')!;
  let publicName: string | null = null;
  let extra = new Map<string, SetMember>();          // per member: since, entries added, chat state (226)
  let friends = new Map<string, FriendStatus>();     // per member: friendship with the owner (224)
  type Where = 'share' | 'members';
  const load = () => Promise.all([getSharing(id), getSets(), getSetMembers(id).catch(() => []), friendStatuses()]).then(([sh, r, list, fr]) => {
    publicName = r?.public_name ?? null;
    extra = new Map(list.map((m) => [m.id, m]));
    friends = fr;
    return sh;
  });
  const rightsSelect = (name: string, value: SetRights = 'view') => html`<select name="${name}" aria-label="Rights">${RIGHTS.map((r) => html`<option value="${r}"${r === value ? ' selected' : ''}>${RIGHTS_NAME[r]}</option>`)}</select>`;
  const draw = (sh: SetSharing, note = '', where: Where = 'share') => {
    const members = set.members ?? [];
    const vis = sh.settings.visibility;
    const active = sh.links.filter((l) => !l.closed);
    const ended = sh.links.filter((l) => l.closed);
    const today = new Date().toISOString().slice(0, 10);
    const head = (w: Where) => html`<p class="sets-share-msg small flash ok" role="status"${note && where === w ? '' : ' hidden'}>${where === w ? note : ''}</p>
      ${publicName ? html`<p class="small sets-public-name">Members${vis === 'public' ? ' and visitors' : ''} see you as <b>${publicName}</b> · <a href="/account#public-name">change it on your account page</a></p>`
        : html`<p class="flash sets-need-name">Sharing a set shows your public name — you haven't chosen one yet. <a href="/account#public-name">Choose it on your account page →</a></p>`}`;
    render(sbox, html`<div class="sets-panel sets-panel-share">${head('share')}
      <section><h3>Who can see it</h3>
        <form class="sets-vis-form">${VISIBILITY.map((v) => html`<label class="check"><input type="radio" name="visibility" value="${v}"${vis === v ? ' checked' : ''}> <span><b>${VIS_LABEL[v]}</b> <span class="muted small">— ${VIS_HELP[v]}</span></span></label>`)}
          <button type="submit">Save</button>
          ${vis === 'public' && set.code ? html`<p class="sets-share-link"><input readonly value="${shareUrl(set.code)}" aria-label="Address of the public set"> <button type="button" class="sets-copy-link">Copy</button></p>` : ''}</form></section>

      <section><h3>Links</h3>
        <p class="muted small">Anyone with an account who has a link can join with the rights it gives — send each only to those you mean. A link can end by itself on a day you choose or after a number of people have joined; turned off, expired or full, it lets no one new in — who joined with it stays.</p>
        <form class="sets-link-form">${rightsSelect('rights')}
          <label class="small">Last day <input type="date" name="expires_on" min="${today}" aria-label="Last day the link works (optional)"></label>
          <label class="small">At most <input type="number" name="max_joins" min="1" max="5000" placeholder="any" aria-label="At most how many people join with it (optional)"> people</label>
          <button type="submit">Make a link</button></form>
        <p class="muted small">Both optional: without a last day the link works until you turn it off; without a number anyone who has it can join.</p>
        ${active.length ? html`<ul class="sets-links">${active.map((l) => html`<li data-link="${l.id}"><span class="tag">${RIGHTS_NAME[l.rights]}</span>
          <input readonly value="${joinUrl(l.code)}" aria-label="Link: ${RIGHTS_NAME[l.rights]}"> <button type="button" class="sets-link-copy">Copy</button>
          <span class="muted small">${l.max_joins ? `${String(l.joined)} of ${String(l.max_joins)} joined` : `${plural(l.joined, 'person', 'people')} joined`}${l.expires_at ? ` · works until ${linkEnd(l.expires_at)}` : ''}</span>
          <button type="button" class="link-button" data-end="${l.id}">Turn off</button></li>`)}</ul>` : ''}
        ${ended.length ? html`<details class="small"><summary>No longer open (${String(ended.length)})</summary><ul>${ended.map((l) => html`<li class="muted">${RIGHTS_NAME[l.rights]} · made ${day(l.created_at)} ·
          ${l.closed === 'off' ? `turned off ${day(l.ended_at!)}` : l.closed === 'expired' ? `expired ${linkEnd(l.expires_at!)}` : 'full'} · ${l.max_joins ? `${String(l.joined)} of ${String(l.max_joins)}` : plural(l.joined, 'person', 'people')} joined</li>`)}</ul></details>` : ''}</section>

      <section><h3>Votes</h3>
        <form class="sets-votes-form"><p class="small">For members who edit <b>with votes</b> — a set votes one way or the other:</p>
          <label class="check"><input type="radio" name="vote_mode" value="advisory"${sh.settings.vote_mode === 'advisory' ? ' checked' : ''}> <span><b>Advisory</b> <span class="muted small">— ${voteRules('advisory', sh.settings.vote_hours, false)}</span></span></label>
          <label class="check"><input type="radio" name="vote_mode" value="binding"${sh.settings.vote_mode === 'binding' ? ' checked' : ''}> <span><b>Binding</b> <span class="muted small">— the vote decides; it lasts the hours below.</span></span></label>
          <div class="sets-binding"${sh.settings.vote_mode === 'binding' ? '' : ' hidden'}>
            <label>A vote lasts <input type="number" name="vote_hours" min="1" max="24" value="${String(sh.settings.vote_hours)}"> hours <span class="muted small">(1–24)</span></label>
            <label class="check"><input type="checkbox" name="owner_veto"${sh.settings.owner_veto ? ' checked' : ''}> <span>Keep a veto: I may decide a vote before it ends <span class="muted small">— the members see that you have it</span></span></label></div>
          <button type="submit">Save</button></form></section>

      <p class="sets-panel-msg small" role="status"></p></div>`);
    render(mbox, html`<div class="sets-panel sets-panel-people">${head('members')}
      <section><h3>Members <span class="muted">${String(members.length)}</span></h3>
        ${members.length ? html`<ul class="sets-panel-members">${members.map((m) => { const x = extra.get(m.id); return html`<li data-member="${m.id}">
          <span class="sets-member-who"><b>${who(m)}</b>${x ? html`<span class="muted small">since ${day(x.since ?? '')} · ${plural(x.added, 'entry', 'entries')} added</span>` : ''}
            ${x?.removed ? html`<span class="tag">removed from the chat</span>` : ''}${x?.blocked ? html`<span class="tag" title="Their messages are hidden for you in every set's chat; unblock them on Friends">blocked by you</span>` : x?.hidden ? html`<span class="tag" title="Only you see this">hidden by you</span>` : ''}</span>
          <span class="sets-member-controls">
            <span class="sets-member-rights">${rightsSelect('rights', m.rights)}
              ${m.rights === 'view' ? html`<label class="check small"><input type="checkbox" name="chat"${m.chat ? ' checked' : ''}> <span>may use the chat</span></label>` : ''}</span>
            <span class="sets-member-actions small">${friendButton(m.id, friends.get(m.id) ?? 'none')}
              ${x?.chat && !x.blocked ? html`<button type="button" class="link-button" data-hide="${m.id}" data-on="${x.hidden ? '0' : '1'}" title="${x.hidden ? 'Show their messages again' : 'Hide their messages in your view of the chat — no one is told'}">${x.hidden ? 'Show their messages' : 'Hide in the chat'}</button>` : ''}
              ${x?.chat ? html`<button type="button" class="link-button" data-chat-${x.removed ? 'readmit' : 'out'}="${m.id}">${x.removed ? 'Let back into the chat' : 'Remove from the chat'}</button>` : ''}
              <button type="button" class="link-button" data-report="${m.id}">Report</button>
              <button type="button" class="link-button" data-owner="${m.id}" title="They own the set from then on; you stay as a member with full rights">Hand the set over</button>
              <button type="button" class="link-button danger-link" data-remove="${m.id}">Remove from the set</button></span></span></li>`; })}</ul>`
          : html`<p class="muted small">No members yet — invite friends or send a link.</p>`}</section>

      <section><h3>Invite a friend</h3>
        ${sh.friends.length ? html`<form class="sets-invite-form"><select name="account" aria-label="Friend">${sh.friends.map((f) => html`<option value="${f.id}">${f.name ?? '—'}</option>`)}</select>
          ${rightsSelect('rights')}<label class="check small sets-invite-chat"><input type="checkbox" name="chat"> <span>may use the chat (viewers)</span></label>
          <button type="submit">Invite</button></form>
          <p class="muted small">They find the invitation, with the rights it gives, among their sets and accept or decline it.</p>`
          : html`<p class="muted small">Friends who aren't members yet appear here — add friends on <a href="/friends">Friends</a>, or send a link.</p>`}
        ${sh.invitations.length ? html`<ul class="small">${sh.invitations.map((i) => html`<li>${i.name ?? '—'} — ${RIGHTS_NAME[i.rights]}${i.chat && i.rights === 'view' ? ', with the chat' : ''}
          <span class="muted">invited ${day(i.invited_at)}, not answered yet</span> <button type="button" class="link-button" data-cancel="${i.id}">Cancel</button></li>`)}</ul>` : ''}</section>

      <details class="sets-legend"><summary><h3>What each part may do</h3></summary><dl class="sets-rights-legend small">
        ${(['owner', ...RIGHTS] as RightsKey[]).map((r) => html`<dt>${RIGHTS_NAME[r]}</dt><dd>${rightsText(r, sh.settings)}</dd>`)}</dl>
        <p class="muted small">Every member sees their own part in these words at the top of the set, and on an invitation or link before they join.</p></details>
      <p class="sets-panel-msg small" role="status"></p></div>`);
    const smsg = sbox.querySelector<HTMLElement>('.sets-panel-msg')!;
    const mmsg = mbox.querySelector<HTMLElement>('.sets-panel-msg')!;
    const msg = smsg;
    const fail = (err: Error) => { smsg.textContent = err.message; };
    const mfail = (err: Error) => { mmsg.textContent = err.message; };
    /** the account's public name (set on the account page) — sharing with someone needs one */
    const typedName = () => publicName ?? '';
    const again = (note: string, w: Where = 'share') => load().then((x) => { if (x) draw(x, note, w); }).catch(w === 'share' ? fail : mfail);
    const changed = (note: string, w: Where = 'share') => getSet({ own: id }).then((r) => { if (r) Object.assign(set, r.set); return again(note, w); });
    sbox.querySelector<HTMLFormElement>('.sets-vis-form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const visibility = (f.elements.namedItem('visibility') as RadioNodeList).value as Visibility;
      if (visibility === 'private' && (set.members?.length || sh.links.some((l) => !l.ended_at) || sh.invitations.length)
        && !(await ask('Make it private? All members leave the set, open invitations end, links stop working and open proposals close. Only you will see it.', { title: 'Make it private?', ok: 'Make it private', danger: true }))) return;
      shareSet(id, { visibility }).then((r) => {
        if (!r) return;
        publicName = r.public_name;
        Object.assign(set, r.set);
        void again(visibility === 'private' ? 'Private: only you see it now.' : visibility === 'public' ? 'Public: anyone can see it and it is listed under Shared sets.' : 'Shared: only its members see it.');
        const h1 = document.querySelector('.sets-page h1');
        if (h1) render(h1, html`${set.name}${visBadge(set)}${together(set)}`);
      }).catch(fail);
    });
    sbox.querySelector('.sets-copy-link')?.addEventListener('click', (e) => copyFrom((e.target as HTMLElement).previousElementSibling as HTMLInputElement, msg));
    mbox.querySelectorAll<HTMLLIElement>('[data-member]').forEach((li) => {
      const who = li.dataset.member!;
      li.querySelector('select')!.addEventListener('change', (e) => {
        const rights = (e.target as HTMLSelectElement).value as SetRights;
        changeMember(id, who, { action: 'rights', rights }).then(() => changed(`Now: ${RIGHTS_NAME[rights]}.`, 'members')).catch(mfail);
      });
      li.querySelector<HTMLInputElement>('input[name=chat]')?.addEventListener('change', (e) => {
        changeMember(id, who, { action: 'chat', on: (e.target as HTMLInputElement).checked ? '1' : '0' }).then(() => changed('Saved.', 'members')).catch(mfail);
      });
    });
    mbox.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if ((await ask('Remove them from the set? Their progress stays theirs; their open proposals stay until decided.', { title: 'Remove this member?', ok: 'Remove', danger: true }))) changeMember(id, b.dataset.remove!, { action: 'remove' }).then(() => changed('Removed.', 'members')).catch(mfail);
    }));
    mbox.querySelectorAll<HTMLButtonElement>('[data-owner]').forEach((b) => b.addEventListener('click', async () => {
      if ((await ask('Hand the set over? They own it from then on — they decide about members, links and votes, and can delete it. You stay as a member with full rights.', { title: 'Hand the set over?', ok: 'Hand it over', danger: true }))) {
        changeMember(id, b.dataset.owner!, { action: 'owner' }).then(reload).catch(mfail);
      }
    }));
    friendButtons(mbox, (n) => { void again(n, 'members'); }, mfail);
    mbox.querySelectorAll<HTMLButtonElement>('[data-hide]').forEach((b) => b.addEventListener('click', () => {
      hideInSetChat(id, b.dataset.hide!, b.dataset.on === '1').then(() => again(b.dataset.on === '1' ? 'Hidden in your view of the chat.' : 'Shown again.', 'members')).catch(mfail);
    }));
    mbox.querySelectorAll<HTMLButtonElement>('[data-chat-out]').forEach((b) => b.addEventListener('click', async () => {
      if (await ask('Everyone sees that they were removed; they stay a member of the set.', { title: 'Remove them from the chat?', ok: 'Remove', danger: true })) setChatMember(id, 'remove', b.dataset.chatOut!).then(() => again('Removed from the chat.', 'members')).catch(mfail);
    }));
    mbox.querySelectorAll<HTMLButtonElement>('[data-chat-readmit]').forEach((b) => b.addEventListener('click', () => { setChatMember(id, 'readmit', b.dataset.chatReadmit!).then(() => again('Back in the chat.', 'members')).catch(mfail); }));
    mbox.querySelectorAll<HTMLButtonElement>('[data-report]').forEach((b) => b.addEventListener('click', async () => {
      const note = await askText('Report this member (their name or what they do) to the site\'s administrators?', { title: 'Report this member', label: 'What happened? (optional)', multiline: true, maxLength: 1000, ok: 'Report' });
      if (note !== null) reportSetChat(id, { account: b.dataset.report! }, note).then(() => again('Reported — thank you.', 'members')).catch(mfail);
    }));
    const invite = mbox.querySelector<HTMLFormElement>('.sets-invite-form');
    invite?.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = (n: string) => (invite.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement).value;
      inviteToSet(id, v('account'), v('rights') as SetRights, (invite.elements.namedItem('chat') as HTMLInputElement).checked, typedName())
        .then(() => changed('Invited — they see the invitation among their sets.', 'members')).catch(mfail);
    });
    mbox.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((b) => b.addEventListener('click', () => { cancelInvitation(id, b.dataset.cancel!).then(() => again('Invitation cancelled.', 'members')).catch(mfail); }));
    const linkForm = sbox.querySelector<HTMLFormElement>('.sets-link-form')!;
    linkForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const rights = (linkForm.elements.namedItem('rights') as HTMLSelectElement).value as SetRights;
      const field = (n: string) => (linkForm.elements.namedItem(n) as HTMLInputElement).value.trim();
      newSetLink(id, rights, typedName(), { expires_on: field('expires_on'), max_joins: field('max_joins') }).then(() => { publicName = typedName() || publicName; }).then(() => changed(`Link made: ${RIGHTS_NAME[rights]} — copy it and send it.`)).catch(fail);
    });
    sbox.querySelectorAll<HTMLButtonElement>('.sets-link-copy').forEach((b) => b.addEventListener('click', () => copyFrom(b.previousElementSibling as HTMLInputElement, msg)));
    sbox.querySelectorAll<HTMLButtonElement>('[data-end]').forEach((b) => b.addEventListener('click', async () => {
      if ((await ask('Turn this link off? No one new can join with it; who joined stays. This can\'t be undone — make a new link instead.', { title: 'Turn this link off?', ok: 'Turn it off', danger: true }))) endSetLink(id, b.dataset.end!).then(() => again('The link is off.')).catch(fail);
    }));
    const votes = sbox.querySelector<HTMLFormElement>('.sets-votes-form')!;
    // hours and veto only mean something for binding votes: with advisory ones the owner decides anyway
    votes.addEventListener('change', () => { votes.querySelector<HTMLElement>('.sets-binding')!.hidden = (votes.elements.namedItem('vote_mode') as RadioNodeList).value !== 'binding'; });
    votes.addEventListener('submit', (e) => {
      e.preventDefault();
      saveVoteSettings(id, { vote_mode: (votes.elements.namedItem('vote_mode') as RadioNodeList).value as VoteMode, vote_hours: (votes.elements.namedItem('vote_hours') as HTMLInputElement).value,
        owner_veto: (votes.elements.namedItem('owner_veto') as HTMLInputElement).checked ? '1' : '0' })
        .then((s) => { if (s) Object.assign(set, s); return changed('Saved — open votes keep the rules they started with.'); }).catch(fail);
    });
  };
  for (const d of [shareD, membersD]) d.addEventListener('toggle', () => {
    if (!d.open) return;
    load().then((sh) => { if (sh) draw(sh); })
      .catch(() => render(d.querySelector<HTMLElement>('.sets-share-body')!, html`<p class="muted">This could not be loaded.</p>`));
  });
}
/** a link's end: the last day it works (it ends at midnight after it, Zurich) — "12 November 2026" */
const linkEnd = (iso: string) => new Date(new Date(iso).getTime() - 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
const copyFrom = (input: HTMLInputElement, msg: HTMLElement) => {
  navigator.clipboard?.writeText(input.value).then(() => { msg.textContent = 'Link copied.'; }, () => { input.select(); });
};
