// Study sets — see index.ts for the whole picture. This file: study.
import { account } from '../../account';
import { PLURAL, answerCard, getCards, getSetStats, recordRound, savePlan, type SetRef, type StudyCard, type StudyMode, type StudyPlan } from '../../api';
import { longDay, plural } from '../../format';
import { TYPE_LABEL, href, html, render, thumb, type Html } from '../../html';
import { bestMatch, points } from '../../quiz-match';
import { CHOICE_MIN, Dir, MODES, MODE_HELP, MODE_NAME, examIn, failed, loggedOut, loginLink, pageHref, studyHref } from './common';




export function studyForm(ref: SetRef, count: number, learner: boolean) {
  if (!count) return html`<p class="muted">Nothing in it yet — add entries with <b>+ Set</b> on their pages.</p>`;
  const modes = MODES.filter((m) => m !== 'choice' || count >= CHOICE_MIN);
  return html`<form class="sets-study" action="${studyHref(ref)}">
    <fieldset class="sets-modes"><legend class="sets-label">Kind of quiz</legend>
    ${modes.map((m, i) => html`<label class="sets-mode"><input type="radio" name="mode" value="${m}"${i ? '' : ' checked'}><span><b>${MODE_NAME[m]}</b><span class="muted small">${MODE_HELP[m]}</span></span></label>`)}</fieldset>
    <fieldset class="sets-cards-choice"><legend class="sets-label">Which cards</legend>
      <label class="sets-pill"><input type="radio" name="cards" value="all" checked> All</label>
      ${learner ? html`<label class="sets-pill"><input type="radio" name="cards" value="today"> Today's <span class="muted small sets-today-count"></span></label>` : ''}
      <label class="sets-pill"><input type="radio" name="cards" value="weak"> Leave out those you know well</label></fieldset>
    <button type="submit" class="sets-study-go">Study</button></form>`;
}

/** The exam date and the day's plan (logged in): set, changed, removed; per kind of card the cards due today. */
export function planBox(box: HTMLElement, ref: SetRef, plan: StudyPlan, onChange: (p: StudyPlan) => void) {
  const f = plan.directions.forward;
  const r = plan.directions.reverse;
  const todayOf = (d?: { due: number; new_left_today: number }) => (d ? d.due + d.new_left_today : 0);
  const line = (label: string, d?: { due: number; new: number; new_left_today: number }) => (d
    ? html`<li><b>${label}</b>: ${plural(d.due, 'card')} to review${d.new_left_today ? html` + ${String(d.new_left_today)} new` : ''}${d.new ? html` <span class="muted small">(${String(d.new)} not asked yet)</span>` : ''}</li>` : '');
  const exam = plan.exam_on && plan.days_left !== null;
  render(box, html`<h3 class="sets-plan-title">Today's study set${exam ? html` <span class="muted small">· exam ${examIn(plan.days_left!)}</span>` : ''}</h3>
    ${exam ? html`<p class="muted small">${longDay(plan.exam_on!)} — every card comes round again before it; the new ones are spread over the days until then.</p>` : ''}
    <ul class="sets-plan-today">${line('Name it', f)}${line('Describe it', r)}</ul>
    ${todayOf(f) + todayOf(r) === 0 ? html`<p class="small">Nothing due today${exam ? '' : ' — or set an exam date and the plan fits it'}. </p>` : ''}
    <form class="sets-exam-form"><label>Exam date <input type="date" name="exam_on" value="${plan.exam_on ?? ''}" min="${new Date().toISOString().slice(0, 10)}"></label>
      <button type="submit">${plan.exam_on ? 'Change' : 'Set'}</button>${plan.exam_on ? html` <button type="button" class="link-button sets-exam-remove">Remove</button>` : ''}
      <span class="sets-exam-msg small" role="status"></span></form>
    <p class="muted small sets-plan-foot">Only you see your exam date and plan.</p>`);
  const save = (value: string) => savePlan(ref, value).then((p) => { if (p) { planBox(box, ref, p, onChange); onChange(p); } })
    .catch((err: Error) => { box.querySelector('.sets-exam-msg')!.textContent = err.message; });
  box.querySelector('form')!.addEventListener('submit', (e) => { e.preventDefault(); save((box.querySelector('input[name=exam_on]') as HTMLInputElement).value); });
  box.querySelector('.sets-exam-remove')?.addEventListener('click', () => save(''));
}

// ---- the index cards --------------------------------------------------------------------------------------------
/** The text with the entry's name blanked out (its words of three letters or more, any case). */
const FILLER = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'by', 'for', 'from', 'with', 'and', 'or', 'as',
  'de', 'del', 'della', 'di', 'da', 'du', 'des', 'la', 'le', 'les', 'el', 'los', 'las', 'il', 'lo', 'et', 'y', 'e',
  'der', 'die', 'das', 'dem', 'den', 'des', 'und', 'von', 'vom', 'zu', 'zum', 'zur', 'im', 'am', 'van', 'het', 'een', 'no']);
export function blank(text: string, name: string) {
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // the whole name first ("Ukiyo-e", "The Great Wave"), then each of its words but the small filler words — short
  // names count too ("Li" in "Li Jun"), "the" and "in" give nothing away (owner 2026-11-06)
  let out = name.trim() ? text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(name.trim())}(?![\\p{L}\\p{N}])`, 'giu'), '▁▁▁') : text;
  const words = [...new Set(name.split(/[\s,.;:()«»"“”‘’'–—-]+/).filter((w) => w.length >= 2 && !FILLER.has(w.toLowerCase())))].sort((a, b) => b.length - a.length);
  for (const w of words) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(w)}(?![\\p{L}\\p{N}])`, 'giu'), '▁▁▁');
  return out;
}

const PROMPT: Partial<Record<StudyCard['type'], [string, string]>> = {
  // [Name it, Describe it]
  artwork: ['Which work is it — title, artist, date?', 'What does it look like? Who made it, when?'],
  artist: ['Who is it?', 'Who was it — when, where?'],
  person: ['Who is it?', 'Who was it — when, where?'],
  term: ['Which term is it?', 'What does it mean?'],
  source: ['Which source is it (short reference)?', 'What is the full reference?'],
};
const prompt = (c: StudyCard, d: Dir, mode: StudyMode) => (mode === 'typed' ? `Type its ${c.type === 'artwork' ? 'title' : 'name'}:`
  : mode === 'choice' ? 'Which is it?'
    : PROMPT[c.type]?.[d === 'forward' ? 0 : 1] ?? (d === 'forward' ? 'What is it?' : 'What do you know about it?'));
export const picture = (c: StudyCard) => (c.image
  ? html`<img class="study-img" src="${c.own ? c.image : thumb(c.image, 960)}" alt=""${c.own ? '' : html` crossorigin="anonymous"`}>` : '');
export const facts = (c: StudyCard) => (c.facts.length ? html`<dl class="study-facts">${c.facts.map((f) => html`<dt>${f.label}</dt><dd>${f.value}</dd>`)}</dl>` : '');

/** What the card shows before it is turned. */
function front(c: StudyCard, d: Dir): Html {
  if (d === 'reverse') return html`<p class="study-type muted small">${TYPE_LABEL[c.type]}</p><p class="study-name">${c.name}</p>`;
  // Name it: an artwork by its picture alone (else its facts); others by what is known of them, the name blanked
  if (c.type === 'artwork' && c.image) return html`<p class="study-type muted small">Artwork</p>${picture(c)}`;
  return html`<p class="study-type muted small">${TYPE_LABEL[c.type]}</p>${c.type === 'artwork' ? '' : picture(c)}${facts(c)}${c.text ? html`<p class="study-text">${blank(c.text, c.name)}</p>` : ''}`;
}
/** What it shows once turned. */
export function back(c: StudyCard, d: Dir): Html {
  const link = html`<p class="small"><a href="${href(PLURAL[c.type], c.slug)}" target="_blank" rel="noopener">Open its page ↗</a></p>`;
  if (d === 'forward') return html`<p class="study-name">${c.name}</p>${c.type === 'artwork' ? facts(c) : ''}${link}`;
  return html`${picture(c)}${facts(c)}${c.text ? html`<p class="study-text">${c.text}</p>` : ''}${link}`;
}

/** Four names for "Pick it": the card's and three others of the set — of the same type first. */
export function options(card: StudyCard, all: StudyCard[], random = Math.random): string[] {
  const shuffle = <T>(a: T[]) => a.map((x) => ({ x, k: random() })).sort((p, q) => p.k - q.k).map((p) => p.x);
  const others = all.filter((c) => c.name !== card.name);
  const names = [...new Set([...shuffle(others.filter((c) => c.type === card.type)), ...shuffle(others.filter((c) => c.type !== card.type))].map((c) => c.name))];
  return shuffle([card.name, ...names.slice(0, 3)]);
}

export interface Turn { card: StudyCard; dir: Dir; again: boolean }

/** The round on screen: its cleanup, run by the router when another page is opened (index.ts) */
export const round_: { leave: (() => void) | null } = { leave: null };

export function studyView(main: HTMLElement, ref: SetRef, params: URLSearchParams) {
  const asked = (params.get('mode') ?? params.get('dir')) as StudyMode | null;
  let mode: StudyMode = asked && MODES.includes(asked) ? asked : 'forward';
  const which = params.get('cards') ?? (params.get('skip') === 'known' ? 'weak' : 'all');
  const skipKnown = which === 'weak';
  Promise.all([getCards(ref), account()]).then(async ([r, me]) => {
    if (!r) return 'own' in ref ? loggedOut(main) : failed(main, 'This set is not shared (any more).');
    const { set, cards } = r;
    if (mode === 'choice' && cards.length < 2) mode = 'forward';
    const learner = Boolean(me);                     // visitors learn too; nothing of it is kept
    document.title = `Study: ${set.name} · Art History`;
    const dirs: Dir[] = mode === 'both' ? ['forward', 'reverse'] : mode === 'reverse' ? ['reverse'] : ['forward'];
    // every card in the chosen directions; the low boxes first, at random within a box
    // today's cards (220): those due again, and the day's share of the new ones (in the set's order)
    const today = which === 'today' && learner;
    const plan = today ? (await getSetStats(ref).catch(() => null))?.plan ?? null : null;
    const newLeft: Record<Dir, number> = { forward: plan?.directions.forward?.new_left_today ?? 0, reverse: plan?.directions.reverse?.new_left_today ?? 0 };
    const queue: Turn[] = cards.flatMap((card) => dirs.map((dir) => ({ card, dir, again: false })))
      .filter((t) => !skipKnown || (t.card.progress[t.dir]?.box ?? 0) < 5)
      .filter((t) => {
        if (!today) return true;
        const p = t.card.progress[t.dir];
        if (p) return Boolean(p.due);
        if (newLeft[t.dir] <= 0) return false;
        newLeft[t.dir] -= 1;
        return true;
      })
      .map((t) => ({ t, k: (t.card.progress[t.dir]?.box ?? 0) + Math.random() }))
      .sort((a, b) => a.k - b.k).map((x) => x.t);
    const total = queue.length;
    const started = Date.now();
    let known = 0;
    let notYet = 0;
    let recorded = false;
    const missed: Turn[] = [];
    let turned = false;
    let current: Turn | undefined;
    const round = (complete: boolean, beacon = false) => {
      if (recorded || !learner || !(known + notYet)) return;
      recorded = true;
      recordRound(ref, { mode, answered: known + notYet, known, seconds: Math.round((Date.now() - started) / 1000), complete }, beacon).catch(() => {});
    };
    const onHide = () => round(false, true);
    window.addEventListener('pagehide', onHide);

    const crumbs = 'own' in ref ? html`<a href="/sets">Your study sets</a>` : html`<a href="/sets/shared">Shared sets</a>`;
    render(main, html`<section class="page sets-page study-page">
      <p class="crumbs">${crumbs} / <a href="${pageHref(ref)}">${set.name}</a> / Study</p>
      <h1>${set.name} <span class="muted study-mode">${MODE_NAME[mode]}${today ? ' · today\'s cards' : ''}</span></h1>
      ${learner ? '' : html`<p class="muted small">${loginLink() ?? 'Log in'} to keep what you know and your results — as a visitor nothing is kept.</p>`}
      <p class="study-count muted small" aria-live="polite"></p>
      <div class="study-card" tabindex="0" aria-live="polite"></div>
      <div class="study-buttons"></div>
      <p class="muted small study-keys">${mode === 'typed' ? 'Enter: check, then on to the next card'
        : mode === 'choice' ? '1–4: pick · Enter: next card' : 'Space or Enter: turn the card · ←: not yet · →: knew it'}</p></section>`);
    const box = main.querySelector<HTMLElement>('.study-card')!;
    const buttons = main.querySelector<HTMLElement>('.study-buttons')!;
    const count = main.querySelector<HTMLElement>('.study-count')!;

    const show = () => {
      current = queue.shift();
      turned = false;
      if (!current) return done();
      const p = current.card.progress[current.dir];
      count.textContent = `Card ${String(known + notYet + 1)} of ${String(total + missed.filter((m) => m.again).length)}${p ? ` · box ${String(p.box)} of 5` : learner ? ' · new' : ''}${current.again ? ' · once more' : ''}`;
      render(box, html`<div class="study-side study-front">${front(current.card, current.dir)}<p class="study-prompt">${prompt(current.card, current.dir, mode)}</p></div>`);
      if (mode === 'typed') {
        render(buttons, html`<form class="study-type-form"><input name="answer" autocomplete="off" spellcheck="false" aria-label="Your answer"> <button type="submit">Check</button></form>`);
        buttons.querySelector('input')!.focus({ preventScroll: true });
      } else if (mode === 'choice') {
        render(buttons, html`<div class="study-options">${options(current.card, cards).map((n, i) => html`<button type="button" class="study-option" data-name="${n}"><span class="muted">${String(i + 1)}</span> ${n}</button>`)}</div>`);
        box.focus({ preventScroll: true });
      } else {
        render(buttons, html`<button type="button" class="study-turn">Show the answer</button>`);
        box.focus({ preventScroll: true });
      }
    };
    /** The card turned: with its verdict (typed, picked — then "Next card"), or with the buttons to judge oneself. */
    const reveal = (verdict?: { yes: boolean; note: string }, keep?: Html) => {
      if (!current || turned) return;
      turned = true;
      render(box, html`<div class="study-side study-front study-dim">${front(current.card, current.dir)}</div><div class="study-side study-back">
        ${verdict ? html`<p class="study-verdict ${verdict.yes ? 'study-right' : 'study-wrong'}">${verdict.note}</p>` : ''}${back(current.card, current.dir)}</div>`);
      if (verdict) {
        render(buttons, html`${keep ?? ''}<button type="button" class="study-next" data-yes="${verdict.yes ? '1' : '0'}">Next card →</button>`);
        buttons.querySelector<HTMLButtonElement>('.study-next')!.focus({ preventScroll: true });
      } else {
        render(buttons, html`<button type="button" class="study-no">← Not yet</button> <button type="button" class="study-yes">Knew it →</button>`);
      }
    };
    const answer = (yes: boolean) => {
      if (!current || !turned) return;
      const t = current;
      if (learner) answerCard(t.card.type, t.card.slug, t.dir, yes).then((p) => { if (p) t.card.progress[t.dir] = p; }).catch(() => {});
      if (yes) known += 1; else notYet += 1;
      // not known: once more at the end of this round
      if (!yes && !t.again) { const again = { ...t, again: true }; queue.push(again); missed.push(again); }
      show();
    };
    const check = (given: string) => {
      if (!current || turned) return;
      const score = points(bestMatch(given, [current.card.name]).score);
      reveal(score === 1 ? { yes: true, note: 'Right.' } : score > 0 ? { yes: true, note: `Nearly — counted: “${given}”.` }
        : { yes: false, note: given.trim() ? `Not quite: “${given}”.` : 'Not answered.' });
    };
    const pick = (name: string) => {
      if (!current || turned) return;
      const right = current.card.name;
      const shown = html`<div class="study-options">${[...buttons.querySelectorAll<HTMLButtonElement>('.study-option')].map((b) => html`<button type="button" class="study-option${
        b.dataset.name === right ? ' study-right' : b.dataset.name === name ? ' study-wrong' : ''}" disabled>${b.dataset.name!}</button>`)}</div>`;
      reveal(name === right ? { yes: true, note: 'Right.' } : { yes: false, note: `Not “${name}”.` }, shown);
    };
    const done = () => {
      count.textContent = '';
      round(true);
      const pct = known + notYet ? Math.round((100 * known) / (known + notYet)) : 0;
      const weak = cards.filter((c) => dirs.some((d) => (c.progress[d]?.box ?? 1) <= 1)).length;
      render(box, html`<div class="study-side study-done"><p class="study-name">Done</p>
        <p>${String(known)} known · ${String(notYet)} not yet${missed.length ? html` (they came back once)` : ''} — ${String(pct)} %.</p>
        ${learner ? html`<p class="muted small">${String(weak)} of ${String(cards.length)} ${cards.length === 1 ? 'entry is' : 'entries are'} still in the first box.</p><p class="study-compare small"></p>` : ''}</div>`);
      render(buttons, html`<a class="button-link" href="${studyHref(ref)}?mode=${mode}${today ? '&cards=today' : ''}">Again</a>
        <a class="button-link" href="${pageHref(ref)}">Back to the set</a>`);
      if (learner) {
        // the round is being saved: the comparison a moment later
        setTimeout(() => getSetStats(ref).then((s) => {
          const r = s?.modes[mode];
          const el = main.querySelector('.study-compare');
          if (r && el && r.rounds > 1) el.textContent = `${MODE_NAME[mode]} on this set: ${plural(r.rounds, 'round')}, ${String(Math.round((100 * r.known) / r.answered))} % known in all, best round ${String(r.best ?? pct)} %.`;
        }).catch(() => {}), 400);
      }
    };
    buttons.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('button');
      if (!b) return;
      if (b.classList.contains('study-turn')) reveal();
      else if (b.classList.contains('study-yes')) answer(true);
      else if (b.classList.contains('study-no')) answer(false);
      else if (b.classList.contains('study-next')) answer(b.dataset.yes === '1');
      else if (b.classList.contains('study-option')) pick(b.dataset.name!);
    });
    buttons.addEventListener('submit', (e) => {
      e.preventDefault();
      check(((e.target as HTMLFormElement).elements.namedItem('answer') as HTMLInputElement).value);
    });
    box.addEventListener('click', (e) => { if (!(e.target as Element).closest('a') && mode !== 'typed' && mode !== 'choice') reveal(); });
    function keys(e: KeyboardEvent) {
      if (!box.isConnected) { document.removeEventListener('keydown', keys); return; }   // left the page
      if ((e.target as Element).closest?.('input, textarea, select')) return;
      if (mode === 'typed' || mode === 'choice') {
        if (e.key === 'Enter' && turned && !(e.target as Element).closest?.('button')) { e.preventDefault(); buttons.querySelector<HTMLButtonElement>('.study-next')?.click(); }
        else if (mode === 'choice' && !turned && /^[1-4]$/.test(e.key)) buttons.querySelectorAll<HTMLButtonElement>('.study-option')[Number(e.key) - 1]?.click();
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') { if (!turned) { e.preventDefault(); reveal(); } }
      else if (e.key === 'ArrowRight') answer(true);
      else if (e.key === 'ArrowLeft') answer(false);
    }
    document.addEventListener('keydown', keys);
    round_.leave = () => { window.removeEventListener('pagehide', onHide); document.removeEventListener('keydown', keys); round(false); };
    if (!total) {
      render(box, html`<div class="study-side study-done"><p>${today ? 'Nothing due today — well done. Come back tomorrow, or study all the cards.'
        : skipKnown ? 'You know every card of this set well.' : 'This set has no entries yet.'}</p></div>`);
      render(buttons, html`<a class="button-link" href="${pageHref(ref)}">Back to the set</a>`);
      return;
    }
    show();
  }).catch(() => failed(main, 'The cards could not be loaded.'));
}
