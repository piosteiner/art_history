// Study sets — see index.ts for the whole picture. This file: results.

import { PLURAL, copySnapshot, forgetResults, getResults, getSnapshot, type StudyStats } from '../../api';
import { ask } from '../../dialog';
import { at, day, plural } from '../../format';
import { TYPE_LABEL, href, html, render, trusted, type Html } from '../../html';
import { MODES, MODE_NAME, failed, loggedOut } from './common';




/** /sets/results (229): every round of the account, by set — each with the set as it was then (name, description,
 *  entries), also when the set has changed since, was made private or deleted. A version saved again as a new set;
 *  a set's results deleted. */
export function resultsPage(main: HTMLElement) {
  document.title = 'Your results · Study sets · Art History';
  const pct = (known: number, answered: number) => Math.round((100 * known) / answered);
  const ACCESS: Record<string, string> = { own: 'your set', member: 'you are a member', public: 'public set' };
  getResults().then((r) => {
    if (!r) return loggedOut(main);
    render(main, html`<section class="page sets-page"><p class="crumbs"><a href="/sets">Your study sets</a> / Results</p>
      <h1>Your results</h1>
      <p class="muted">Every round you played, by set. Each round keeps the set as it was then — its name, description and
        entries — so your results stay traceable even when the set changes later, is made private or is deleted. Only you see them.</p>
      ${r.sets.length ? r.sets.map((s) => {
        const answered = s.rounds.reduce((a, x) => a + x.answered, 0);
        const known = s.rounds.reduce((a, x) => a + x.known, 0);
        const title = s.access === 'public' && s.code ? html`<a href="/sets/s/${s.code}">${s.name}</a>` : s.id ? html`<a href="/sets/${s.id}">${s.name}</a>` : s.name;
        return html`<section class="sets-group results-set" data-key="${s.key}">
          <h2>${title} <span class="tag${s.access ? '' : ' results-gone'}">${s.access ? ACCESS[s.access] : 'no longer available'}</span></h2>
          <p class="muted small">${plural(s.rounds.length, 'round')} · ${String(pct(known, answered))} % known · last ${day(s.rounds[0].at)}${s.topic ? html` · <span class="sets-topic">${s.topic}</span>` : ''}</p>
          <div class="sets-results-wrap"><table class="sets-results"><thead><tr><th>When</th><th>Quiz</th><th>Known</th><th>Time</th><th>The set then</th></tr></thead><tbody>
            ${s.rounds.map((x) => html`<tr><td class="small">${at(x.at)}</td><th scope="row">${MODE_NAME[x.mode]}</th>
              <td>${String(x.known)} of ${String(x.answered)} (${String(pct(x.known, x.answered))} %)${x.complete ? '' : html` <span class="muted small" title="Left before the end of the round">· left early</span>`}</td>
              <td class="small">${x.seconds === null ? '—' : x.seconds >= 90 ? `${String(Math.round(x.seconds / 60))} min` : `${String(x.seconds)} s`}</td>
              <td><button type="button" class="link-button small" data-snapshot="${x.snapshot.id}">${x.snapshot.name} · ${plural(x.snapshot.item_count, 'entry', 'entries')}</button></td></tr>`)}
          </tbody></table></div>
          <div class="results-snapshot" hidden></div>
          <p class="sets-actions"><button type="button" class="link-button" data-copy="${s.rounds[0].snapshot.id}" title="A set of your own with the entries as they were in your last round">Save as a new set</button>
            <button type="button" class="link-button danger-link" data-forget="${s.key}">Delete these results</button></p></section>`;
      }) : html`<p class="muted">No rounds yet — study a set and your results appear here.</p>`}
      ${r.more ? html`<p class="muted small">The 3000 most recent rounds.</p>` : ''}
      <p class="sets-msg small" role="status"></p></section>`);
    const msg = main.querySelector<HTMLElement>('.sets-msg')!;
    const fail = (err: Error) => { msg.textContent = err.message; };
    const copy = (id: string) => copySnapshot(id).then((c) => {
      if (c) location.assign(`/sets/${c.id}${c.missing ? '?missing=' + String(c.missing) : ''}`);
    }).catch(fail);
    main.querySelectorAll<HTMLButtonElement>('[data-snapshot]').forEach((b) => b.addEventListener('click', () => {
      const box = b.closest('.results-set')!.querySelector<HTMLElement>('.results-snapshot')!;
      if (!box.hidden && box.dataset.id === b.dataset.snapshot) { box.hidden = true; return; }
      getSnapshot(b.dataset.snapshot!).then((x) => {
        if (!x) return;
        box.hidden = false;
        box.dataset.id = x.id;
        render(box, html`<h3>${x.name} <span class="muted small">— as it was on ${at(x.taken_at)}</span></h3>
          ${x.topic ? html`<p class="small"><span class="sets-topic">${x.topic}</span></p>` : ''}
          ${x.description_html ? html`<div class="prose small">${trusted(x.description_html)}</div>` : ''}
          <ol class="results-items">${x.items.map((i) => html`<li>${i.slug ? html`<a href="${href(PLURAL[i.type], i.slug)}">${i.name}</a>` : i.name}
            <span class="muted small">${TYPE_LABEL[i.type]}${i.slug && i.now_name && i.now_name !== i.name ? ` · now “${i.now_name}”` : ''}${i.slug ? '' : ' · no longer on the site'}</span></li>`)}</ol>
          <p><button type="button" class="link-button" data-copy-this="${x.id}">Save this version as a new set</button></p>`);
        box.querySelector<HTMLButtonElement>('[data-copy-this]')!.addEventListener('click', () => { void copy(x.id); });
      }).catch(fail);
    }));
    main.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => b.addEventListener('click', () => { void copy(b.dataset.copy!); }));
    main.querySelectorAll<HTMLButtonElement>('[data-forget]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await ask('Delete your results on this set, with the versions of the set kept for them? What you know of its entries stays.', { title: 'Delete your results?', ok: 'Delete', danger: true }))) return;
      forgetResults(b.dataset.forget!).then(() => resultsPage(main)).catch(fail);
    }));
  }).catch(() => failed(main, 'Your results could not be loaded.'));
}

/** "Your results": per kind of quiz, the boxes, the hardest entries. */
export function results(s: StudyStats, count: number): Html {
  const modes = MODES.filter((m) => s.modes[m]);
  const bar = (row: number[], label: string) => {
    const total = row.reduce((a, b) => a + b, 0) || 1;
    return html`<div class="sets-boxes"><span class="small">${label}</span><span class="sets-boxbar" role="img" aria-label="${row.map((n, i) => `${i ? `box ${String(i)}` : 'new'}: ${String(n)}`).join(', ')}">
      ${row.map((n, i) => (n ? html`<span class="sets-box sets-box-${String(i)}" style="flex:${String(n / total)}" title="${i ? `Box ${String(i)}` : 'Not yet asked'}: ${String(n)}">${String(n)}</span>` : ''))}</span>
      <span class="muted small">${String(row[4] + row[5])} of ${String(count)} known well</span></div>`;
  };
  const mins = (sec: number) => (sec >= 90 ? `${String(Math.round(sec / 60))} min` : `${String(sec)} s`);
  // today's study set (owner 2026-11-07): how far today's cards are done, and today's rounds — beside the progress overall
  const t = s.today;
  const todayRow = (label: string, dir: 'forward' | 'reverse') => {
    const done = t?.[dir].done ?? 0;
    const p = s.plan?.directions[dir];
    const left = p ? p.due + p.new_left_today : 0;
    const total = done + left;
    if (!total) return '';
    return html`<div class="sets-today-row"><span class="small">${label}</span>
      <span class="sets-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${String(total)}" aria-valuenow="${String(done)}" aria-label="${label}: ${String(done)} of ${String(total)} of today's cards done"><span style="width:${String(Math.round((100 * done) / total))}%"></span></span>
      <span class="muted small">${String(done)} of ${String(total)} done${done ? ` · ${String(t![dir].right)} right` : ''}</span></div>`;
  };
  const todayRows = [todayRow('Name it', 'forward'), todayRow('Describe it', 'reverse')].filter((x) => x !== '');
  return html`<h2 class="sets-card-title">Your results</h2>
    <h3 class="sets-results-sub">Today's study set</h3>
    ${todayRows.length ? todayRows : html`<p class="muted small">Nothing due today.</p>`}
    ${t?.rounds ? html`<p class="small">Today: ${plural(t.rounds, 'round')} · ${String(t.known)} of ${String(t.answered)} known (${String(Math.round((100 * t.known) / Math.max(1, t.answered)))} %) · ${mins(t.seconds)}</p>` : ''}
    <h3 class="sets-results-sub">Overall</h3>
    ${modes.length ? html`<div class="sets-results-wrap"><table class="sets-results"><thead><tr><th>Quiz</th><th>Rounds</th><th>Known</th><th>Best round</th><th>Last ten rounds</th><th>Time</th><th>Last</th></tr></thead><tbody>
      ${modes.map((m) => { const r = s.modes[m]!; return html`<tr><th scope="row">${MODE_NAME[m]}</th><td>${String(r.rounds)}</td>
        <td>${String(Math.round((100 * r.known) / r.answered))} %</td><td>${r.best === null ? '—' : `${String(r.best)} %`}</td>
        <td><span class="sets-spark" role="img" aria-label="${[...r.recent].reverse().map((p) => `${String(p)} %`).join(', ')}">${[...r.recent].reverse().map((p) => html`<span style="height:${String(Math.max(p, 4))}%" title="${String(p)} %"></span>`)}</span></td>
        <td>${mins(r.seconds)}</td><td class="small">${day(r.last_at)}</td></tr>`; })}</tbody></table></div>`
      : html`<p class="muted small">No round yet — your results per kind of quiz appear here.</p>`}
    ${bar(s.boxes.forward, 'Name it')}${bar(s.boxes.reverse, 'Describe it')}
    <p class="small"><a href="/sets/results">All your results, each round with the set as it was then →</a></p>
    <p class="muted small">Boxes: a card known moves up a box, one not known goes back to box 1; boxes 4 and 5 count as known well. They are the same in every set holding the entry.</p>
    ${s.hardest.length ? html`<p class="small">Most often not known: ${s.hardest.map((h, i) => html`${i ? ', ' : ''}<a href="${href(PLURAL[h.type], h.slug)}">${h.name}</a> <span class="muted">(${String(h.seen - h.known)} of ${String(h.seen)})</span>`)}</p>` : ''}`;
}
