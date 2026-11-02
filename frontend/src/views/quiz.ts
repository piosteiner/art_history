// /quiz — games to learn the collection (API /v1/quiz, owner 2026-11-02): a picture to name (title, artist, year,
// movement); an artist and eight works to pick theirs from; a movement and its works, or three works and their
// movement; glossary terms and their definitions. /quiz/<kind>?mode=… plays one; the rounds come with their answers
// and are checked here (src/quiz-match.ts for typed ones). The best result per game stays in this browser.
// Logged in (account.ts), the picture quiz can use the owner's private reference images too (?mine=1, or only: ?mine=only).
import {
  getQuizArtists, getQuizGlossary, getQuizMovements, getQuizPictures, getQuizPrivateImages,
  type QuizArtistRound, type QuizMovementRound, type QuizPicture, type QuizTermRound, type QuizWork,
} from '../api';
import { account } from '../account';
import { html, href, render, thumb, type Html } from '../html';
import { bestMatch, parseYear, points, yearPoints } from '../quiz-match';
import { guard, showError } from './common';

type Kind = 'picture' | 'artist' | 'movement' | 'glossary';
interface Mode { mode: string; label: string }
const QUIZZES: { kind: Kind; title: string; text: string; modes: Mode[] }[] = [
  { kind: 'picture', title: 'Name the picture', text: 'A work of art: its title, who made it, when, and the movement it belongs to.',
    modes: [{ mode: '', label: 'Start' }] },
  { kind: 'artist', title: 'Whose works?', text: 'An artist and eight works that look alike — pick the ones they made.',
    modes: [{ mode: '', label: 'Start' }] },
  { kind: 'movement', title: 'Movements and periods', text: 'Pick the works of a movement or period, or name the movement of three works.',
    modes: [{ mode: 'mixed', label: 'Mixed' }, { mode: 'pick', label: 'Pick its works' }, { mode: 'name', label: 'Name the movement' }] },
  { kind: 'glossary', title: 'Glossary', text: 'Terms of art history: match terms and definitions, or describe a term in your own words.',
    modes: [{ mode: 'mixed', label: 'Mixed' }, { mode: 'definition', label: 'Term → definition' }, { mode: 'term', label: 'Definition → term' }, { mode: 'describe', label: 'Describe it' }] },
];
const ROUNDS: Record<Kind, number> = { picture: 10, artist: 8, movement: 8, glossary: 10 };
const isKind = (k: string | null): k is Kind => QUIZZES.some((q) => q.kind === k);

// ---- the best result per game, in this browser only ------------------------------------------------------------
const BEST = 'arthistory.quiz.best';
const bests = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(BEST) ?? '{}'); } catch { return {}; } };
function saveBest(key: string, pct: number) {
  try {
    const b = bests();
    if (!(key in b) || pct > b[key]) localStorage.setItem(BEST, JSON.stringify({ ...b, [key]: pct }));
  } catch { /* private window: no record */ }
}
const gameKey = (kind: Kind, mode: string) => (mode ? `${kind}:${mode}` : kind);
const pct = (score: number, max: number) => (max ? Math.round((100 * score) / max) : 0);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

export function quizPage(main: HTMLElement, kind: string | null, params: URLSearchParams) {
  if (!isKind(kind)) return menu(main);
  return game(main, kind, params);
}

function menu(main: HTMLElement) {
  document.title = 'Quiz · Art History';
  const best = bests();
  render(main, html`<section class="page quiz-page">
    <h1>Quiz</h1>
    <p class="lead">Train what you know about the collection — every round is drawn from the database, so the questions change as it grows.</p>
    <div class="quiz-menu">${QUIZZES.map((q) => html`<article class="quiz-card">
      <h2>${q.title}</h2>
      <p>${q.text}</p>
      <p class="quiz-modes">${q.modes.map((m) => {
        const b = best[gameKey(q.kind, m.mode)];
        return html`<a class="button-link" href="/quiz/${q.kind}${m.mode ? `?mode=${m.mode}` : ''}">${m.label}${b !== undefined ? html` <span class="muted small">best ${b}%</span>` : ''}</a>`;
      })}</p>
      ${q.kind === 'picture' ? html`<p class="quiz-mine small" hidden>With your reference images:
        <a href="/quiz/picture?mine=1">mixed in</a> · <a href="/quiz/picture?mine=only">only those</a></p>` : ''}
    </article>`)}</div>
    <p class="muted small">Answers come from the entries as they are now. Something wrong? Tell us with the “F” button at the bottom right.</p>
  </section>`);
  account().then((name) => { if (name) main.querySelector<HTMLElement>('.quiz-mine')?.removeAttribute('hidden'); });
}

// ---- one game: rounds one after another, then the result --------------------------------------------------------
interface Round {
  /** Shows the question; calls `answered(score, max)` once the answer is checked (the round shows what was right). */
  show(el: HTMLElement, answered: (score: number, max: number) => void): void;
  /** One line for the review at the end: what it was about, linked. */
  review: Html;
}

function game(main: HTMLElement, kind: Kind, params: URLSearchParams) {
  const quiz = QUIZZES.find((q) => q.kind === kind)!;
  const mode = quiz.modes.some((m) => m.mode === params.get('mode')) ? params.get('mode')! : quiz.modes[0].mode;
  const modeLabel = quiz.modes.length > 1 ? quiz.modes.find((m) => m.mode === mode)?.label : null;
  document.title = `${quiz.title} · Quiz · Art History`;
  const current = guard();
  let gone = false;
  const start = () => {
    render(main, html`<section class="page quiz-page"><p class="quiz-back"><a href="/quiz">← All quizzes</a></p>
      <h1>${quiz.title}${modeLabel ? html` <span class="muted quiz-mode">${modeLabel}</span>` : ''}</h1>
      <div class="quiz-stage"><p class="muted loading">Drawing questions…</p></div></section>`);
    const stage = main.querySelector<HTMLElement>('.quiz-stage')!;
    rounds(kind, mode, params).then((list) => {
      if (gone || !current()) return;
      if (!list.length) {
        render(stage, html`<p>Not enough entries for this quiz yet.</p>`);
        return;
      }
      play(stage, list, (score, max, reviews) => {
        const p = pct(score, max);
        saveBest(gameKey(kind, mode), p);
        render(stage, html`<div class="quiz-result">
          <p class="quiz-total"><strong>${fmt(score)}</strong> of ${fmt(max)} points · ${p}%</p>
          <p class="muted">${p >= 90 ? 'Excellent!' : p >= 70 ? 'Well done.' : p >= 40 ? 'Not bad — once more?' : 'Every round teaches something — try again.'}</p>
          <p class="quiz-modes"><button type="button" class="quiz-button primary" data-again>Play again</button> <a class="button-link" href="/quiz">Other quizzes</a></p>
          <h2>The rounds</h2>
          <ol class="quiz-review">${reviews.map((r) => html`<li>${r.review} <span class="muted small">${fmt(r.score)} / ${fmt(r.max)}</span></li>`)}</ol>
        </div>`);
        stage.querySelector('[data-again]')!.addEventListener('click', start);
      });
    }).catch((err) => { if (!gone && current()) showError(stage, err); });
  };
  start();
  return () => { gone = true; };
}

function play(stage: HTMLElement, list: Round[], done: (score: number, max: number, reviews: { review: Html; score: number; max: number }[]) => void) {
  const results: { review: Html; score: number; max: number }[] = [];
  const total = () => results.reduce((s, r) => s + r.score, 0);
  const next = (i: number) => {
    if (i >= list.length) return done(total(), results.reduce((s, r) => s + r.max, 0), results);
    render(stage, html`<p class="quiz-progress muted">Round ${i + 1} of ${list.length} · ${fmt(total())} points</p>
      <div class="quiz-round"></div><p class="quiz-next" hidden><button type="button" class="quiz-button primary">${i + 1 < list.length ? 'Next round' : 'See the result'}</button></p>`);
    const round = stage.querySelector<HTMLElement>('.quiz-round')!;
    const go = stage.querySelector<HTMLElement>('.quiz-next')!;
    list[i].show(round, (score, max) => {
      results.push({ review: list[i].review, score, max });
      go.hidden = false;
      const button = go.querySelector('button')!;
      button.addEventListener('click', () => { next(i + 1); window.scrollTo(0, 0); });
      button.focus({ preventScroll: true });
    });
  };
  next(0);
}

async function rounds(kind: Kind, mode: string, params: URLSearchParams): Promise<Round[]> {
  const n = ROUNDS[kind];
  if (kind === 'picture') return pictureRounds(n, params.get('mine'));
  if (kind === 'artist') return (await getQuizArtists(n)).data.map(artistRound);
  if (kind === 'movement') return (await getQuizMovements(n, mode)).data.map(movementRound);
  return (await getQuizGlossary(n, mode)).data.map(termRound);
}

// ---- pieces shared by the rounds --------------------------------------------------------------------------------
const shuffle = <T>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
/** A museum image at this width (thumb(): Wikimedia serves its standard widths only — 120, 250, 330, 500, 960 …), or the owner's private one as it is (with the login's cookie, no CORS mode). */
const picture = (url: string, alt: string, width: number, own = false) => (own
  ? html`<img src="${url}" alt="${alt}" decoding="async">`
  : html`<img src="${thumb(url, width)}" alt="${alt}" decoding="async" crossorigin="anonymous"${thumb(url, width) !== url ? html` data-fallback="${url}"` : ''}>`);
const workTitle = (w: { title: string; title_en?: string | null }) => html`${w.title}${w.title_en && w.title_en !== w.title ? html` <span class="muted">(${w.title_en})</span>` : ''}`;
const workLink = (w: QuizWork) => html`<a href="${href('artworks', w.slug)}">${workTitle(w)}</a>`;
const workLine = (w: QuizWork) => html`${workLink(w)}${w.creator ? html` · ${w.creator}` : ''}${w.created ? html` · ${w.created.label}` : ''}`;
const credit = (w: { credit: string | null; license: string | null }) => [w.credit, w.license].filter(Boolean).join(' · ');
const mark = (ok: number) => (ok >= 1 ? html`<span class="quiz-ok" aria-label="right">✓</span>` : ok > 0 ? html`<span class="quiz-near" aria-label="nearly">≈</span>` : html`<span class="quiz-no" aria-label="wrong">✗</span>`);

/** Eight works to choose from: toggles, then each marked — picked and right, missed, picked but wrong. Score: right
 *  picks minus wrong ones, as a share of the right ones (0–1). */
function pickWorks(el: HTMLElement, question: Html, options: QuizWork[], answered: (score: number, max: number) => void, after: () => Html) {
  render(el, html`<p class="quiz-question">${question}</p>
    <ul class="quiz-tiles">${options.map((o, i) => html`<li><button type="button" class="quiz-tile" aria-pressed="false" data-i="${String(i)}">
      ${picture(o.image_url, `Work ${i + 1}`, 500)}</button><p class="quiz-caption small" hidden>${workLine(o)}</p></li>`)}</ul>
    <p><button type="button" class="quiz-button" data-check>Check</button> <span class="muted small">Pick all that apply.</span></p>
    <div class="quiz-after"></div>`);
  const tiles = [...el.querySelectorAll<HTMLButtonElement>('.quiz-tile')];
  tiles.forEach((t) => t.addEventListener('click', () => t.setAttribute('aria-pressed', String(t.getAttribute('aria-pressed') !== 'true'))));
  el.querySelector<HTMLButtonElement>('[data-check]')!.addEventListener('click', (e) => {
    (e.currentTarget as HTMLButtonElement).disabled = true;
    let right = 0;
    let wrong = 0;
    const count = options.filter((o) => o.correct).length;
    tiles.forEach((t, i) => {
      const picked = t.getAttribute('aria-pressed') === 'true';
      const ok = !!options[i].correct;
      if (picked && ok) right++;
      if (picked && !ok) wrong++;
      t.disabled = true;
      t.classList.add(ok ? (picked ? 'is-right' : 'is-missed') : picked ? 'is-wrong' : 'is-other');
      t.insertAdjacentHTML('beforeend', ok ? '<span class="quiz-badge">✓</span>' : picked ? '<span class="quiz-badge">✗</span>' : '');
      const cap = t.parentElement!.querySelector<HTMLElement>('.quiz-caption')!;
      cap.hidden = false;
      const c = credit(options[i]);
      if (c) {
        const line = document.createElement('span');
        line.className = 'credit';
        line.textContent = c;
        cap.append(' ', line);
      }
    });
    const score = count ? Math.max(0, right - wrong) / count : 0;
    render(el.querySelector('.quiz-after')!, html`<p>${mark(score)} ${right} of ${count} found${wrong ? html`, ${wrong} picked wrongly` : ''}.</p>${after()}`);
    answered(Math.round(score * 4) / 4, 1);
  });
}

/** Buttons to choose one of: the right one shown green, a wrong choice red. */
function chooseOne<T extends { slug: string }>(el: HTMLElement, question: Html, options: T[], answer: string, label: (o: T) => Html,
  answered: (score: number, max: number) => void, after: (o: T) => Html, cls = '') {
  render(el, html`${question}<ul class="quiz-choices ${cls}">${options.map((o, i) => html`<li><button type="button" class="quiz-choice" data-i="${String(i)}">${label(o)}</button></li>`)}</ul>
    <div class="quiz-after"></div>`);
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('.quiz-choice')];
  buttons.forEach((b, i) => b.addEventListener('click', () => {
    const ok = options[i].slug === answer;
    buttons.forEach((x, j) => {
      x.disabled = true;
      if (options[j].slug === answer) x.classList.add('is-right');
    });
    if (!ok) b.classList.add('is-wrong');
    render(el.querySelector('.quiz-after')!, html`<p>${mark(ok ? 1 : 0)} ${ok ? 'Right.' : 'Not quite.'}</p>${after(options.find((o) => o.slug === answer)!)}`);
    answered(ok ? 1 : 0, 1);
  }));
}

// ---- 1. name the picture ---------------------------------------------------------------------------------------
async function pictureRounds(n: number, mine: string | null): Promise<Round[]> {
  let own: { slug: string; url: string }[] = [];
  if (mine && await account()) own = shuffle((await getQuizPrivateImages().catch(() => null)) ?? []).slice(0, mine === 'only' ? n : Math.ceil(n / 2));
  const [ours, pub] = await Promise.all([
    own.length ? getQuizPictures(own.length, own.map((o) => o.slug)) : null,
    mine === 'only' && own.length ? null : getQuizPictures(n),
  ]);
  const url = new Map(own.map((o) => [o.slug, o.url]));
  const list = [...(ours?.data ?? []).map((p) => ({ p, own: url.get(p.slug)! })),
    ...(pub?.data ?? []).filter((p) => !url.has(p.slug) && p.image_url).map((p) => ({ p, own: null as string | null }))];
  const movements = (ours ?? pub)?.movements ?? [];
  return shuffle(list).slice(0, n).map(({ p, own: ownUrl }) => pictureRound(p, ownUrl, movements));
}

function pictureRound(p: QuizPicture, ownUrl: string | null, movements: string[]): Round {
  const artists = p.creators;
  const years = p.created && p.created.from_year !== null ? { from: p.created.from_year, to: p.created.to_year ?? p.created.from_year } : null;
  const fields = { title: true, artist: artists.length > 0, year: !!years, movement: p.movements.length > 0 };
  const listId = `quiz-movements-${p.slug}`;
  return {
    review: html`<a href="${href('artworks', p.slug)}">${p.title}</a>`,
    show(el, answered) {
      render(el, html`<div class="quiz-picture">
        <figure class="quiz-figure">${picture(ownUrl ?? p.image_url!, 'The work to name', 960, !!ownUrl)}
          <figcaption class="small muted">${ownUrl ? 'Your reference image' : 'Credit shown after answering'}</figcaption></figure>
        <form class="quiz-form" autocomplete="off">
          <label>Title <input name="title" type="text" spellcheck="false"></label>
          ${fields.artist ? html`<label>Artist <input name="artist" type="text" spellcheck="false"></label>` : html`<p class="muted small">No artist to name: the maker is not known.</p>`}
          ${fields.year ? html`<label>Year <input name="year" type="text" inputmode="numeric" placeholder="e.g. 1889 or 500 BCE"></label>` : ''}
          ${fields.movement ? html`<label>Movement or period <input name="movement" type="text" list="${listId}" spellcheck="false"></label>
            <datalist id="${listId}">${movements.map((m) => html`<option value="${m}">`)}</datalist>` : ''}
          <p><button type="submit" class="quiz-button">Check</button> <span class="muted small">Leave out what you don't know.</span></p>
        </form>
        <div class="quiz-after"></div></div>`);
      const form = el.querySelector<HTMLFormElement>('form')!;
      // on a phone the keyboard would cover the picture: focus only where there is a mouse
      if (matchMedia('(hover: hover)').matches) form.querySelector<HTMLInputElement>('input')!.focus({ preventScroll: true });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value.trim() ?? '';
        form.querySelectorAll('input, button').forEach((x) => { (x as HTMLInputElement).disabled = true; });
        const rows: Html[] = [];
        let score = 0;
        let max = 0;
        const row = (label: string, answer: string, got: number, right: Html) => {
          score += got;
          max += 1;
          rows.push(html`<tr><th>${label}</th><td>${mark(got)} ${answer || html`<span class="muted">—</span>`}</td><td>${right}</td></tr>`);
        };
        const title = bestMatch(v('title'), p.titles);
        row('Title', v('title'), v('title') ? points(title.score) : 0,
          html`<a href="${href('artworks', p.slug)}">${p.title}</a>${title.score >= 0.6 && title.name !== p.title ? html` <span class="muted small">(${title.name})</span>` : ''}`);
        if (fields.artist) {
          const names = artists.flatMap((a) => [...a.names, a.family_name, a.name.split(' ').pop()].filter((x): x is string => !!x && x.length > 2));
          const m = bestMatch(v('artist'), names);
          row('Artist', v('artist'), v('artist') ? points(m.score) : 0,
            html`${artists.map((a, i) => html`${i ? ', ' : ''}<a href="${href('artists', a.slug)}">${a.name}</a>`)}${p.attribution ? html` <span class="muted small">(${p.attribution})</span>` : ''}`);
        }
        if (years) {
          const y = parseYear(v('year'));
          row('Year', v('year'), y === null ? 0 : yearPoints(y, years.from, years.to), html`${p.created!.label}`);
        }
        if (fields.movement) {
          const m = bestMatch(v('movement'), p.movements.flatMap((x) => x.names));
          row('Movement', v('movement'), v('movement') ? points(m.score) : 0,
            html`${p.movements.map((x, i) => html`${i ? ', ' : ''}<a href="${href('movements', x.slug)}">${x.name}</a>`)}`);
        }
        const c = credit(p);
        el.querySelector('.quiz-figure figcaption')!.textContent = ownUrl ? 'Your reference image' : c || 'No credit recorded';
        render(el.querySelector('.quiz-after')!, html`<table class="quiz-answers"><thead><tr><th></th><th>Your answer</th><th>Right</th></tr></thead>
          <tbody>${rows}</tbody></table><p class="muted small">${fmt(score)} of ${max} points. Years: inside the work's dates 1, within 10 years ½, within 25 ¼.</p>`);
        answered(score, max);
      });
    },
  };
}

// ---- 2. whose works --------------------------------------------------------------------------------------------
function artistRound(r: QuizArtistRound): Round {
  const who = html`<a href="${href('artists', r.artist.slug)}">${r.artist.name}</a>`;
  return {
    review: who,
    show(el, answered) {
      pickWorks(el, html`Which of these are by <strong>${r.artist.name}</strong>${r.artist.dates ? html` <span class="muted">(${r.artist.dates})</span>` : ''}?`,
        r.options, answered, () => html`<p class="small">More by ${who}.</p>`);
    },
  };
}

// ---- 3. movements and periods ----------------------------------------------------------------------------------
function movementRound(r: QuizMovementRound): Round {
  if (r.kind === 'pick') {
    const m = html`<a href="${href('movements', r.movement.slug)}">${r.movement.name}</a>`;
    return {
      review: html`Works of ${m}`,
      show(el, answered) {
        pickWorks(el, html`Which of these belong to <strong>${r.movement.name}</strong>${r.movement.period ? html` <span class="muted">(${r.movement.period.label})</span>` : ''}?`,
          r.options, answered, () => html`<p class="small">More about ${m}.</p>`);
      },
    };
  }
  const answer = r.options.find((o) => o.slug === r.answer)!;
  return {
    review: html`Name it: <a href="${href('movements', answer.slug)}">${answer.name}</a>`,
    show(el, answered) {
      chooseOne(el, html`<p class="quiz-question">Which movement or period do these works belong to?</p>
        <ul class="quiz-tiles three">${r.works.map((w, i) => html`<li><span class="quiz-tile">${picture(w.image_url, `Work ${i + 1}`, 500)}</span>
          <p class="quiz-caption small" hidden>${workLine(w)}</p></li>`)}</ul>`,
      r.options, r.answer, (o) => html`${o.name}${o.period ? html` <span class="muted small">${o.period.label}</span>` : ''}`,
      (score, max) => {
        el.querySelectorAll<HTMLElement>('.quiz-caption').forEach((c) => { c.hidden = false; });
        answered(score, max);
      }, (o) => html`<p class="small">More about <a href="${href('movements', o.slug)}">${o.name}</a>.</p>`);
    },
  };
}

// ---- 4. the glossary -------------------------------------------------------------------------------------------
function termRound(r: QuizTermRound): Round {
  const link = html`<a href="${href('glossary', r.term.slug)}">${r.term.name}</a>`;
  const category = html`<span class="tag">${r.term.category}</span>`;
  if (r.kind === 'describe') {
    return {
      review: html`Describe: ${link}`,
      show(el, answered) {
        render(el, html`<p class="quiz-question">What is <strong>${r.term.name}</strong>? ${category}</p>
          <form class="quiz-form"><label>In your own words <textarea name="text" rows="4"></textarea></label>
          <p><button type="submit" class="quiz-button">Show the definition</button></p></form><div class="quiz-after"></div>`);
        const form = el.querySelector<HTMLFormElement>('form')!;
        form.querySelector('textarea')!.focus({ preventScroll: true });
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          form.querySelector('button')!.disabled = true;
          (form.elements.namedItem('text') as HTMLTextAreaElement).readOnly = true;
          const after = el.querySelector<HTMLElement>('.quiz-after')!;
          render(after, html`<blockquote class="quiz-definition">${r.term.definition}</blockquote><p class="small">More: ${link}</p>
            <p>How close were you? <span class="quiz-modes">
              <button type="button" class="quiz-button" data-s="1">Got it</button>
              <button type="button" class="quiz-button" data-s="0.5">Partly</button>
              <button type="button" class="quiz-button" data-s="0">Missed it</button></span></p>`);
          after.querySelectorAll<HTMLButtonElement>('[data-s]').forEach((b) => b.addEventListener('click', () => {
            after.querySelectorAll<HTMLButtonElement>('[data-s]').forEach((x) => { x.disabled = true; x.classList.toggle('is-right', x === b); });
            answered(Number(b.dataset.s), 1);
          }));
        });
      },
    };
  }
  if (r.kind === 'definition') {
    return {
      review: html`Definition of ${link}`,
      show(el, answered) {
        chooseOne(el, html`<p class="quiz-question">What does <strong>${r.term.name}</strong> mean? ${category}</p>`, r.options, r.answer,
          (o) => html`${o.definition}`, answered, () => html`<p class="small">More: ${link}</p>`, 'long');
      },
    };
  }
  return {
    review: html`Which term: ${link}`,
    show(el, answered) {
      chooseOne(el, html`<p class="quiz-question">Which term is this? ${category}</p><blockquote class="quiz-definition">${r.term.definition}</blockquote>`,
        r.options, r.answer, (o) => html`${o.name}`, answered, () => html`<p class="small">More: ${link}</p>`);
    },
  };
}
