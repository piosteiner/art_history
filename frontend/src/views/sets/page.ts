// Study sets — see index.ts for the whole picture. This file: page.
import { account } from '../../account';
import { ApiError, PLURAL, copyOwnSet, copySet, getSet, getSetStats, getSets, leaveSet, lockSet, previewDescription, removeFromSet, updateSet, type Proposed, type SetRef, type StudyItem, type StudyPlan, type StudySet } from '../../api';
import { ask, askText } from '../../dialog';
import { plural } from '../../format';
import { PLURAL_LABEL, href, html, render, trusted } from '../../html';
import { setChat } from './chat';
import { aboutClosed, failed, itemPicture, loggedOut, loginLink, meta, proposedText, rememberAbout, together, topicOptions, visBadge, yourPart } from './common';
import { history } from './history';
import { HOLD_MS, HOLD_RING, holdToConfirm } from './hold';


import { members } from './members';
import { ownerPanel } from './owner';
import { proposalList } from './proposals';
import { results } from './results';
import { planBox, studyForm } from './study';


export function one(main: HTMLElement, ref: SetRef, note = '') {
  Promise.all([getSet(ref), account()]).then(([r, me]) => {
    if (!r) return 'own' in ref ? loggedOut(main) : failed(main, 'This set is not shared (any more).');
    const { set, items } = r;
    const proposals = r.proposals ?? [];
    const decided = r.decided ?? [];
    const own = 'own' in ref;
    const role = own ? set.role ?? 'owner' : null;
    const owner = role === 'owner';
    const viewer = role === 'viewer';
    const locked = Boolean(set.locked_at);
    const editor = role === 'editor';
    const directly = owner || set.rights === 'full';
    const canChange = own && !viewer && !(editor && locked);
    const pending = new Map(proposals.filter((p) => p.kind !== 'field').map((p) => [`${p.type ?? ''}/${p.slug ?? ''}`, p]));
    if (!own && set.mine && set.id) { location.replace(`/sets/${set.id}`); return; }   // the owner's or a member's own page
    document.title = `${set.name} · Study sets · Art History`;
    const byType = new Map<string, StudyItem[]>();
    for (const i of items) { if (!byType.has(i.type)) byType.set(i.type, []); byType.get(i.type)!.push(i); }
    const crumbs = own ? html`<a href="/sets">Your study sets</a>` : html`<a href="/sets/shared">Shared sets</a>`;
    const hasMembers = Boolean(set.members?.length);
    render(main, html`<section class="page sets-page">
      <header class="sets-head"><p class="crumbs">${crumbs} / ${set.name}</p>
      <h1>${set.name}${own ? visBadge(set) : ''}${own ? together(set) : ''}${own && locked ? html` <span class="tag sets-locked-tag" title="Its members read and study it but change nothing">locked</span>` : ''}</h1>
      ${meta(set, !owner)}</header>
      ${own && (!owner || hasMembers) ? yourPart(set) : ''}
      ${editor && locked ? html`<p class="flash">The owner has locked this set: you can study it, but not change or propose anything until they unlock it.</p>` : ''}
      ${set.description_html || (own && set.copied_from) ? html`<details class="sets-about sets-card"${aboutClosed(ref) ? '' : ' open'}>
        <summary class="sets-about-summary"><span class="sets-card-title">About this set</span><span class="muted small sets-about-toggle"></span></summary>
        ${set.description_html ? html`<div class="prose sets-description">${trusted(set.description_html)}</div>` : ''}
        ${own && set.copied_from ? html`<p class="muted small">A copy of <a href="/sets/s/${set.copied_from.code}">${set.copied_from.name}</a>${set.copied_from.creator ? ` by ${set.copied_from.creator}` : ''}.</p>` : ''}
        <p class="sets-about-foot"><button type="button" class="link-button small sets-about-hide">Hide ▴</button></p></details>` : ''}
      ${own ? html`<section class="sets-manage sets-card" aria-labelledby="sets-manage-title"><h2 class="sets-card-title" id="sets-manage-title">${viewer ? 'This set' : 'Manage this set'}</h2><div class="sets-tools">
        ${viewer ? '' : html`<details class="sets-edit"${editor && locked ? ' hidden' : ''}><summary class="link-button">${directly ? 'Edit name, topic, description' : 'Propose a new name, topic, description'}</summary>
          <form class="sets-edit-form"><p class="sets-conflict flash" hidden></p>
            ${directly ? '' : html`<p class="small muted">${set.rights === 'approval' ? 'What you change here is proposed to the owner; it applies once they accept it.'
              : set.vote_mode === 'binding' ? 'What you change here is put to the vote; the vote decides.' : 'What you change here is put to the vote; the owner decides.'}</p>`}
            <input type="hidden" name="base_name" value="${set.name}"><input type="hidden" name="base_topic" value="${set.topic ?? ''}">
            <textarea name="base_description" hidden>${set.description ?? ''}</textarea>
            <label>Name <input name="name" value="${set.name}" maxlength="120" required></label>
            <label>Topic <input name="topic" value="${set.topic ?? ''}" maxlength="80" list="sets-topics" autocomplete="off" placeholder="e.g. Japanese art"></label>
            <label class="sets-edit-desc"><span>Description</span>
              <textarea name="description" rows="7" maxlength="10000" placeholder="What it is for, what to look out for, notes for learning …">${set.description ?? ''}</textarea></label>
            ${directly ? '' : html`<label>Why <span class="muted small">(optional — the others see it)</span> <input name="reason" maxlength="500"></label>`}
            <button type="submit">${directly ? 'Save' : 'Propose'}</button><datalist id="sets-topics"></datalist></form></details>`}
        ${owner ? html`<details class="sets-share" id="sets-sharing"><summary class="link-button">Sharing</summary><div class="sets-share-body"></div></details>
          <details class="sets-share sets-members-panel" id="sets-members-panel"><summary class="link-button">Members${hasMembers ? html` <span class="muted">${String(set.members!.length)}</span>` : ''}</summary><div class="sets-share-body"></div></details>` : ''}
        ${owner ? html`<button type="button" class="link-button sets-lock" title="${locked ? 'Its members may change and propose again' : 'Its members can still study it, but change and propose nothing'}">${locked ? 'Unlock' : 'Lock'}</button>` : ''}
        ${viewer ? '' : html`<details class="sets-history"><summary class="link-button">History</summary><div class="sets-history-body"></div></details>`}
        ${viewer ? '' : html`<details class="sets-copy-box"><summary class="link-button">${owner ? 'Make a copy' : 'Make my own copy'}</summary>
          <div class="sets-copy-info"><p><b>A new, private set of your own</b> with the same name, topic, description and the ${plural(items.length, 'entry', 'entries')} as they are now.
            ${owner ? 'This set stays as it is.' : 'This set stays as it is, and you stay a member of it.'}</p>
            <p class="muted small">Not copied: members, links, chat, proposals and history. What you know of the cards stays — boxes are the same in every set holding an entry.</p>
            <p class="sets-copy-buttons"><button type="button" class="sets-copy-own">Make the copy</button> <button type="button" class="link-button sets-copy-cancel">Cancel</button></p></div></details>`}
        ${owner ? '' : html`<button type="button" class="link-button sets-leave">Leave this set</button>`}</div></section>`
        : html`<p class="sets-tools sets-card">${me ? html`<button type="button" class="sets-copy">Save a copy to your sets</button>`
          : html`<span class="muted small">${loginLink() ?? 'Log in'} to keep track of what you know and to save a copy.</span>`}</p>`}
      <p class="sets-msg small" role="status"></p>
      ${own && hasMembers && !owner ? html`<section class="sets-members sets-card" id="sets-members" aria-label="Members"></section>` : ''}
      ${own && set.chat_allowed && (set.chat_on || owner) && (hasMembers || set.chat_on) ? html`<section class="sets-chat" id="sets-chat" aria-label="The set's chat"></section>` : ''}
      ${items.length ? html`<section class="sets-learn sets-card${me ? ' with-plan' : ''}" aria-labelledby="sets-learn-title">
        <h2 class="sets-card-title" id="sets-learn-title">Study the ${plural(items.length, 'entry', 'entries')}</h2>
        <div class="sets-learn-grid">${me ? html`<section class="sets-plan" aria-label="Today's study set"></section>` : ''}
        ${studyForm(ref, items.length, Boolean(me))}</div></section>` : studyForm(ref, 0, Boolean(me))}
      ${me ? html`<section class="sets-stats sets-card" aria-label="Your results"></section>` : ''}
      ${own && (proposals.length || decided.length) ? html`<section class="sets-proposals" id="sets-proposals"></section>` : ''}
      ${items.length ? html`<section class="sets-entries" aria-labelledby="sets-entries-title"><h2 id="sets-entries-title" class="sets-entries-title">Entries <span class="muted">${String(items.length)}</span></h2>
      ${byType.size > 1 ? html`<nav class="sets-jump" aria-label="Kinds of entries">${[...byType.entries()].map(([type, list]) => html`<a class="chip" href="#sets-${type}">${PLURAL_LABEL[PLURAL[type as StudyItem['type']]]} <span class="muted">${String(list.length)}</span></a>`)}</nav>` : ''}
      ${[...byType.entries()].map(([type, list]) => html`<section class="sets-group" id="sets-${type}"><h3>${PLURAL_LABEL[PLURAL[type as StudyItem['type']]]} <span class="muted">${String(list.length)}</span></h3>
        <ul class="sets-items">${list.map((i) => {
          const p = pending.get(`${i.type}/${i.slug}`);
          return html`<li class="sets-entry">
          <a class="sets-entry-link" href="${href(PLURAL[i.type], i.slug)}">${itemPicture(i)}<span><span class="sets-entry-name">${i.name}</span>
            ${i.subtitle ? html`<span class="muted small">${i.subtitle}</span>` : ''}${i.added_by ? html`<span class="muted small sets-added-by">added by ${i.added_by}</span>` : ''}</span></a>
          ${!canChange ? '' : p ? html`<a class="muted small" href="#sets-proposals">removal proposed</a>` : directly
            ? html`<button type="button" class="link-button sets-remove" data-type="${i.type}" data-slug="${i.slug}" title="Hold to remove from this set" aria-label="Remove ${i.name} from this set (hold for 3 seconds)">${HOLD_RING}<span aria-hidden="true">×</span></button>`
            : html`<button type="button" class="link-button sets-propose small" data-type="${i.type}" data-slug="${i.slug}" data-name="${i.name}" title="${set.rights === 'approval' ? 'Propose its removal — the owner decides' : 'Propose its removal — it is put to the vote'}">Propose removal</button>`}</li>`;
        })}</ul></section>`)}</section>` : ''}
    </section>`);
    const msg = main.querySelector<HTMLElement>('.sets-msg')!;
    main.querySelector<HTMLDetailsElement>('.sets-about')?.addEventListener('toggle', (e) => rememberAbout(ref, !(e.target as HTMLDetailsElement).open));
    main.querySelector('.sets-about-hide')?.addEventListener('click', () => { const d = main.querySelector<HTMLDetailsElement>('.sets-about')!; d.open = false; d.scrollIntoView({ block: 'nearest' }); });
    // Manage this set: one of its panels open at a time (owner 2026-11-06)
    const tools = [...main.querySelectorAll<HTMLDetailsElement>('.sets-manage .sets-tools > details')];
    for (const d of tools) d.addEventListener('toggle', () => { if (d.open) for (const o of tools) if (o !== d) o.open = false; });
    const missing = Number(new URLSearchParams(location.search).get('missing') || 0);
    msg.textContent = note || (missing ? `Saved as a new set. ${plural(missing, 'entry', 'entries')} of that version ${missing === 1 ? 'is' : 'are'} no longer on the site and left out.` : '');
    const stats = main.querySelector<HTMLElement>('.sets-stats');
    const planEl = main.querySelector<HTMLElement>('.sets-plan');
    const todayCount = (p: StudyPlan) => {
      const n = (d?: { due: number; new_left_today: number }) => String(d ? d.due + d.new_left_today : 0);
      const el = main.querySelector('.sets-today-count');
      if (el) el.textContent = `(${n(p.directions.forward)} Name it · ${n(p.directions.reverse)} Describe it)`;
    };
    if (stats) {
      getSetStats(ref).then((s) => {
        if (!s) return;
        render(stats, results(s, set.count));
        if (planEl && s.plan && set.count) { planBox(planEl, ref, s.plan, todayCount); todayCount(s.plan); }
      }).catch(() => {});
    }
    if (!own) {
      main.querySelector('.sets-copy')?.addEventListener('click', () => {
        copySet((ref as { code: string }).code).then((c) => { if (c) location.assign(`/sets/${c.id}`); }).catch((err: Error) => { msg.textContent = err.message; });
      });
      return;
    }
    const id = ref.own;
    const reload = () => one(main, ref);
    /** a change made — or proposed (228): the message says which, then the page is drawn again */
    const after = (r: unknown, what: string) => {
      const p = r && typeof r === 'object' && 'proposed' in r ? r as Proposed : null;
      one(main, ref, p ? proposedText(p, set, what) : '');
    };
    const editForm = main.querySelector<HTMLFormElement>('.sets-edit-form');
    if (editForm) {
      const desc = editForm.querySelector<HTMLTextAreaElement>('textarea[name=description]')!;
      void import('../../md-editor').then((m) => m.markdownEditor(desc, previewDescription));
      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = (n: string) => (editForm.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '';
        const conflict = editForm.querySelector<HTMLElement>('.sets-conflict')!;
        updateSet(id, { name: val('name'), topic: val('topic'), description: val('description'), base_name: val('base_name'), base_topic: val('base_topic'), base_description: val('base_description'), reason: val('reason') })
          .then((r) => after(r, 'Your changes'))
          .catch((err: Error) => {
            if (!(err instanceof ApiError && err.status === 409 && (err.body as { error?: string } | null)?.error === 'changed')) { msg.textContent = err.message; return; }
            // someone else changed it meanwhile: their version shown, yours kept in the form; Save again replaces theirs
            const now = (err.body?.set ?? null) as StudySet | null;
            if (!now) return;
            const put = (n: string, v: string) => { (editForm.elements.namedItem(n) as HTMLInputElement).value = v; };
            put('base_name', now.name); put('base_topic', now.topic ?? ''); put('base_description', now.description ?? '');
            conflict.hidden = false;
            render(conflict, html`<b>${now.updated_by ?? 'Someone'} changed this set meanwhile.</b> Their version is below — yours is still in the form:
              Save again to replace theirs, or copy what you need first.
              <span class="sets-conflict-theirs"><b>Name:</b> ${now.name}${now.topic ? html` · <b>Topic:</b> ${now.topic}` : ''}</span>
              ${now.description_html ? html`<span class="prose sets-conflict-theirs">${trusted(now.description_html)}</span>` : ''}`);
          });
      });
      main.querySelector('.sets-edit')!.addEventListener('toggle', () => {
        getSets().then((x) => { const dl = main.querySelector('#sets-topics'); if (x && dl) render(dl, topicOptions(x.topics)); }).catch(() => {});
      }, { once: true });
    }
    if (owner) ownerPanel(main.querySelector<HTMLDetailsElement>('#sets-sharing')!, main.querySelector<HTMLDetailsElement>('#sets-members-panel')!, set, id, reload);
    const historyBox = main.querySelector<HTMLDetailsElement>('.sets-history');
    if (historyBox) history(historyBox, id, owner, reload);
    main.querySelector('.sets-copy-cancel')?.addEventListener('click', () => { main.querySelector<HTMLDetailsElement>('.sets-copy-box')!.open = false; });
    main.querySelector('.sets-copy-own')?.addEventListener('click', () => {
      copyOwnSet(id).then((c) => { if (c) location.assign(`/sets/${c.id}`); }).catch((err: Error) => { msg.textContent = err.message; });
    });
    main.querySelector('.sets-leave')?.addEventListener('click', async () => {
      if (!(await ask('Leave this set? It goes from your sets; your progress on its entries stays yours. To come back you need a new invitation or link.', { title: 'Leave this set?', ok: 'Leave', danger: true }))) return;
      leaveSet(id).then(() => location.assign('/sets')).catch((err: Error) => { msg.textContent = err.message; });
    });
    const chatBox = main.querySelector<HTMLElement>('.sets-chat');
    if (chatBox) setChat(chatBox, id, owner);
    const membersBox = main.querySelector<HTMLElement>('.sets-members');
    if (membersBox) members(membersBox, set, id, owner, () => { if (chatBox) setChat(chatBox, id, owner); });
    const proposalsBox = main.querySelector<HTMLElement>('.sets-proposals');
    if (proposalsBox) proposalList(proposalsBox, set, id, proposals, decided, reload);
    if (location.hash === '#sets-chat') chatBox?.scrollIntoView();
    if (location.hash === '#sets-proposals') proposalsBox?.scrollIntoView();
    for (const h of ['#sets-sharing', '#sets-members-panel']) if (location.hash === h) { const d = main.querySelector<HTMLDetailsElement>(h); if (d) { d.open = true; d.scrollIntoView(); } }
    // locking changes only the button and the title's tag for the owner: those two are updated in place — drawing
    // the whole page again made it flash (owner 2026-11-07)
    let isLocked = locked;
    const lockButton = main.querySelector<HTMLButtonElement>('.sets-lock');
    lockButton?.addEventListener('click', async () => {
      if (!isLocked && !(await ask('Lock this set? Its members can still study it, but change, propose and vote on nothing until you unlock it.', { title: 'Lock this set?', ok: 'Lock' }))) return;
      lockButton.disabled = true;
      lockSet(id, !isLocked).then(() => {
        isLocked = !isLocked;
        lockButton.textContent = isLocked ? 'Unlock' : 'Lock';
        lockButton.title = isLocked ? 'Its members may change and propose again' : 'Its members can still study it, but change and propose nothing';
        const h1 = main.querySelector('.sets-head h1')!;
        h1.querySelector('.sets-locked-tag')?.remove();
        if (isLocked) h1.insertAdjacentHTML('beforeend', ' <span class="tag sets-locked-tag" title="Its members read and study it but change nothing">locked</span>');
        msg.textContent = isLocked ? 'Locked: its members can study it but change nothing.' : 'Unlocked.';
      }).catch((err: Error) => { msg.textContent = err.message; }).finally(() => { lockButton.disabled = false; });
    });
    main.querySelectorAll<HTMLButtonElement>('.sets-propose').forEach((b) => b.addEventListener('click', async () => {
      const reason = (await askText(`Why should “${b.dataset.name}” go? (optional — the others see it)`, { title: 'Propose its removal', label: 'Why? (optional — the others see it)', maxLength: 500, ok: 'Propose' }));
      if (reason === null) return;
      removeFromSet(id, b.dataset.type as StudyItem['type'], b.dataset.slug!, reason).then((r) => after(r, 'Removing it')).catch((err: Error) => { msg.textContent = err.message; });
    }));
    // removing takes a hold of three seconds while the ring fills (owner 2026-11-06: a click removed too easily)
    main.querySelectorAll<HTMLButtonElement>('.sets-remove').forEach((b) => holdToConfirm(b, HOLD_MS, () => {
      removeFromSet(id, b.dataset.type as StudyItem['type'], b.dataset.slug!).then(reload).catch((err: Error) => { msg.textContent = err.message; });
    }, () => { b.classList.add('hold-hint'); setTimeout(() => b.classList.remove('hold-hint'), 2500); }));
  }).catch(() => failed(main, 'This set could not be loaded.'));
}
