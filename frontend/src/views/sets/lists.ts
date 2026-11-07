// Study sets — see index.ts for the whole picture. This file: lists.
import { account } from '../../account';
import { ApiError, answerInvitation, createSet, deleteSet, getInvitation, getPublicSets, getSets, joinSet, type StudySet } from '../../api';
import { ask } from '../../dialog';
import { day, longDay, plural } from '../../format';
import { html, render } from '../../html';
import { accountLinks } from '../account';
import { RIGHTS_NAME, failed, loggedOut, rightsText, together, topicOptions, visBadge } from './common';






// ---- the account's sets -----------------------------------------------------------------------------------------
export function list(main: HTMLElement, note = '') {
  getSets().then((r) => {
    if (!r) return loggedOut(main);
    const { sets, topics } = r;
    const byTopic = new Map<string, StudySet[]>();
    for (const s of sets) { const k = s.topic ?? ''; if (!byTopic.has(k)) byTopic.set(k, []); byTopic.get(k)!.push(s); }
    const groups = [...byTopic.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    const welcome = new URLSearchParams(location.search).get('welcome') === '1';
    render(main, html`<section class="page sets-page">${welcome ? html`<p class="flash ok">Welcome — your account is ready. Your settings: <a href="/account">Your account</a>.</p>` : ''}<h1>Your study sets</h1>
      <p class="muted">Your own lists of entries — only you see them unless you share one. Add an entry with <b>+ Set</b>
        on its page; learn a set with <b>Study</b>. <a href="/sets/shared">Browse shared sets →</a> · <a href="/sets/results">Your results →</a></p>
      <form class="sets-new">
        <input name="name" placeholder="Name of a new set — e.g. Exam: Japanese art" aria-label="Name of a new set" maxlength="120" required>
        <input name="topic" placeholder="Topic (optional)" aria-label="Topic" maxlength="80" list="sets-topics" autocomplete="off">
        <button type="submit">Create</button><datalist id="sets-topics">${topicOptions(topics)}</datalist></form>
      <p class="sets-msg small" role="status"></p>
      ${r.invitations.length ? html`<section class="sets-invitations"><h2>Invitations</h2><ul>${r.invitations.map((i) => html`<li data-set="${String(i.set_id)}">
        <b>${i.creator ?? 'Someone'}</b> invites you to <b>${i.name}</b>${i.topic ? html` <span class="sets-topic">${i.topic}</span>` : ''} <span class="muted small">(${plural(i.count, 'entry', 'entries')})</span>
        as <b>${RIGHTS_NAME[i.rights]}</b>${i.chat && i.rights === 'view' ? ', with the chat' : ''}.
        <span class="small muted sets-invitation-rights">${rightsText(i.rights, { vote_mode: i.vote_mode })}</span>
        <span class="sets-actions"><button type="button" data-accept="1">Accept</button> <button type="button" class="secondary" data-accept="0">Decline</button></span></li>`)}</ul></section>` : ''}
      ${sets.some((s) => s.to_vote || s.to_decide) ? html`<p class="flash sets-votes-waiting">Proposed changes wait for you:
        ${sets.filter((s) => s.to_vote || s.to_decide).map((s, i) => html`${i ? ' · ' : ''}<a href="/sets/${s.id!}#sets-proposals">${s.name}</a> <span class="muted">(${[s.to_vote ? `${String(s.to_vote)} to vote on` : '', s.to_decide ? `${String(s.to_decide)} to decide` : ''].filter(Boolean).join(', ')})</span>`)}</p>` : ''}
      ${sets.length ? groups.map(([topic, list]) => html`<section class="sets-group">${groups.length > 1 || topic ? html`<h2>${topic || 'No topic'}</h2>` : ''}
        <ul class="sets-list">${list.map((s) => html`<li class="sets-item">
          <a class="sets-name" href="/sets/${s.id!}">${s.name}</a>${visBadge(s)}${together(s)}${s.locked_at ? html` <span class="tag" title="The owner locked it: no changes by its editors">locked</span>` : ''}${s.proposals ? html` <a class="tag sets-proposal-tag" href="/sets/${s.id!}#sets-proposals" title="Changes proposed and not decided yet">${plural(s.proposals, 'change')} proposed</a>` : ''}${s.chat_unread ? html` <a class="tag sets-chat-tag" href="/sets/${s.id!}#sets-chat" title="Unread messages in the set's chat">${plural(s.chat_unread, 'new message')}</a>` : ''}${s.exam_on ? html` <span class="tag sets-exam" title="Your exam date">exam ${longDay(s.exam_on)}</span>` : ''}
          <span class="muted small">${plural(s.count, 'entry', 'entries')} · changed ${day(s.updated_at)}${s.description_text ? html` · ${s.description_text}` : ''}</span>
          <span class="sets-actions">${s.count ? html`<a class="button-link" href="/sets/${s.id!}/study">Study</a>` : ''}
            ${s.role && s.role !== 'owner' ? '' : html`<button type="button" class="link-button sets-delete" data-id="${s.id!}" data-name="${s.name}">Delete</button>`}</span></li>`)}</ul></section>`)
        : html`<p class="muted">No sets yet.</p>`}
    </section>`);
    const msg = main.querySelector<HTMLElement>('.sets-msg')!;
    if (note) msg.textContent = note;
    main.querySelector<HTMLFormElement>('.sets-new')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const val = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value.trim();
      createSet(val('name'), val('topic')).then((set) => { if (set) location.assign(`/sets/${set.id!}`); }).catch((err: Error) => { msg.textContent = err.message; });
    });
    main.querySelectorAll<HTMLButtonElement>('[data-accept]').forEach((b) => b.addEventListener('click', () => {
      const setId = b.closest<HTMLElement>('[data-set]')!.dataset.set!;
      answerInvitation(setId, b.dataset.accept === '1').then((x) => { if (x?.set) location.assign(`/sets/${x.set.id}`); else list(main); }).catch((err: Error) => {
        // gone meanwhile (the set deleted or made private, the invitation withdrawn): say so, and show the list as it is now
        if (err instanceof ApiError && err.status === 404) { list(main, 'This invitation is no longer valid — the set was deleted or made private, or the owner withdrew it.'); return; }
        msg.textContent = err.message;
      });
    }));
    main.querySelectorAll<HTMLButtonElement>('.sets-delete').forEach((b) => b.addEventListener('click', async () => {
      if (!(await ask(`Delete the set “${b.dataset.name}”? Its entries stay on the site; what you know of them stays too, and your results on it stay under “Your results” with the set as it was. Its members lose it, its links and its public address stop working.`, { title: 'Delete this set?', ok: 'Delete the set', danger: true }))) return;
      deleteSet(b.dataset.id!).then(() => list(main)).catch((err: Error) => { msg.textContent = err.message; });
    }));
  }).catch(() => failed(main, 'Your sets could not be loaded.'));
}

// ---- the public sets ---------------------------------------------------------------------------------------------
export function browse(main: HTMLElement, params: URLSearchParams) {
  const topic = params.get('topic') ?? '';
  const q = params.get('q') ?? '';
  document.title = 'Shared study sets · Art History';
  getPublicSets(topic, q).then((r) => {
    const sets = r?.sets ?? [];
    const topics = r?.topics ?? [];
    const chip = (t: string, label: string, n?: number) => {
      const p = new URLSearchParams(); if (t) p.set('topic', t); if (q) p.set('q', q);
      const qs = p.toString();
      return html`<a class="chip${t === topic ? ' chip-on' : ''}" href="/sets/shared${qs ? `?${qs}` : ''}">${label}${n ? html` <span class="muted">${String(n)}</span>` : ''}</a>`;
    };
    render(main, html`<section class="page sets-page"><p class="crumbs"><a href="/sets">Study sets</a> / Shared</p>
      <h1>Shared study sets</h1>
      <p class="muted">Sets others have made public — look, learn them as index cards, or save a copy among your own.</p>
      <form class="sets-search" action="/sets/shared">${topic ? html`<input type="hidden" name="topic" value="${topic}">` : ''}
        <input type="search" name="q" value="${q}" placeholder="Search names, topics, descriptions" aria-label="Search shared sets"><button type="submit">Search</button></form>
      ${topics.length ? html`<p class="sets-topics">${chip('', 'All topics')} ${topics.map((t) => html`${chip(t.topic, t.topic, t.count)} `)}</p>` : ''}
      ${sets.length ? html`<ul class="sets-list">${sets.map((s) => html`<li class="sets-item">
          <a class="sets-name" href="/sets/s/${s.code!}">${s.name}</a>
          <span class="muted small">${s.topic ? html`<span class="sets-topic">${s.topic}</span> · ` : ''}by ${s.creator ?? '—'} · ${plural(s.count, 'entry', 'entries')} · changed ${day(s.updated_at)}</span>
          ${s.description_text ? html`<span class="small">${s.description_text}</span>` : ''}
          <span class="sets-actions">${s.count ? html`<a class="button-link" href="/sets/s/${s.code!}/study">Study</a>` : ''}</span></li>`)}</ul>`
        : html`<p class="muted">${r ? (topic || q ? 'No public set matches.' : 'No set has been made public yet.') : 'Shared sets cannot be shown here.'}</p>`}
    </section>`);
  }).catch(() => failed(main, 'The shared sets could not be loaded.'));
}

/** /sets/join/<code>: what the link is for and the rights it gives, in plain words; logged in → join (a public name
 *  first if none). */
export function joinView(main: HTMLElement, code: string) {
  document.title = 'Join a study set · Art History';
  Promise.all([getInvitation(code), account()]).then(async ([inv, me]) => {
    if (!inv) return failed(main, 'This link could not be loaded.');
    if (inv.role && inv.set.id) { location.replace(`/sets/${inv.set.id}`); return; }
    const r = inv.rights;
    render(main, html`<section class="page sets-page"><p class="crumbs"><a href="/sets">Study sets</a> / Join</p>
      <h1>Join “${inv.set.name}”</h1>
      <p>${inv.set.creator ?? 'Someone'} shares this set${inv.set.topic ? html` (<span class="sets-topic">${inv.set.topic}</span>)` : ''} with you:
        ${plural(inv.set.count, 'entry', 'entries')} so far, ${plural(inv.set.members, 'member')} besides the owner.</p>
      <div class="sets-your-part"><p><b>You join as: ${RIGHTS_NAME[r]}</b></p><p class="small">${rightsText(r, { vote_mode: inv.set.vote_mode })}</p>
        <p class="small muted">The owner can change your rights later, and you can leave the set at any time. What you know of the cards, your results and your exam date stay your own; the other members see your public name.</p></div>
      ${me ? html`<form class="sets-join">${inv.public_name ? html`<p class="muted small">The others see you as <b>${inv.public_name}</b>.</p>`
        : html`<label>Your public name — the others see it, never your username <input name="public_name" maxlength="60" required autocomplete="nickname"></label>`}
        <button type="submit">Join as ${r === 'view' ? 'a viewer' : 'an editor'}</button> <span class="sets-msg small" role="status"></span></form>`
        : html`<p>${await accountLinks()}</p>`}</section>`);
    main.querySelector<HTMLFormElement>('.sets-join')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const name = (f.elements.namedItem('public_name') as HTMLInputElement | null)?.value ?? '';
      joinSet(code, name).then((s) => { if (s) location.assign(`/sets/${s.id}`); })
        .catch((err: Error) => { f.querySelector('.sets-msg')!.textContent = err.message; });
    });
  }).catch((err: unknown) => {
    const closed = err instanceof ApiError ? (err.body as { closed?: string } | null)?.closed : undefined;
    failed(main, closed === 'expired' ? 'This link has expired — ask the owner of the set for a new one.'
      : closed === 'full' ? 'As many people as this link allows have joined with it already — ask the owner of the set for a new one.'
        : 'This link is not valid (any more) — the owner may have turned it off. Ask them for a new one.');
  });
}
