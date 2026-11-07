// Study sets (owner 2026-11-04; backend routes/site-sets.js, src/study.js, migrations 218/219): an account's own lists
// of entries of any type, to keep for reference and to learn — and to share.
//   /sets                    the account's sets by topic: create (name, topic), open, delete
//   /sets/<id>               one set: its entries (removed with ×), name, topic, description (Markdown, md-editor.ts),
//                            sharing, the account's results, "Study"
//   /sets/<id>/study?mode=…  a round of a quiz on it
//   /sets/shared             the public sets of every account, by topic
//   /sets/s/<code>           a public set — anyone may look and learn; logged in: "Save a copy",
//   /sets/s/<code>/study       and the round counts among the account's results (never the owner's)
//   /sets/join/<code>        a link to join a set with the rights it carries (228): logged in with a public name → a member
// Members (228): private (its owner only), shared (its members), public (anyone, listed). Members are viewers or edit
// it — with full rights (at once), with the owner's approval, or with votes (the set's kind: advisory → the owner
// decides; binding → the vote decides, ties → the owner, a veto if the owner keeps one). Everyone sees their own part
// in plain words at the top of the set (yourPart) and before joining; the owner's "Sharing and members" panel says the
// same for every kind of rights (RIGHTS_NAME / rightsText / voteRules — one wording everywhere). Proposed changes
// with their votes under "Proposed changes". A save from an older version of a field someone else changed meanwhile
// is refused (409) — their version is shown, yours stays in the form.
// Exam date (220): per account and set; the set page counts the days and plans the day's cards — ?cards=today in the
// study view: the cards due again (Leitner intervals, shortened before the exam) and today's share of the new ones.
// Kinds of quiz (mode):
//   forward  "Name it"      what it is → its name: an artwork's picture → title, artist, date; a term's definition →
//                           the term; an artist's dates and places (and portrait) → the name. The name is blanked out.
//   reverse  "Describe it"  its name → what it is: the picture, the facts, the definition
//   both     both directions, mixed
//   typed    "Type it"      as Name it, the name typed and checked (quiz-match.ts: a typo still counts)
//   choice   "Pick it"      as Name it, the name picked among four of the set (the same type first)
// Each answer moves the card's Leitner box (1–5, per account, entry and direction; typed and picked answers count for
// "Name it"): the low boxes come first; a card not known comes back once at the end of the round. Every round is kept
// with its result (per set and kind of quiz: the set page's "Your results"); visitors learn too, nothing is kept.
// Split into this folder on 2026-11-07 (one file of 1,300 lines before): index = the router, page = a set's page,
// lists, study (the cards and the round), chat, members, owner (sharing and members panels), proposals, history,
// results, hold (the ×), common (wording, links, helpers).
import { account } from '../../account';
import { html, render } from '../../html';
import { SetsRoute, loggedOut } from './common';
import { browse, joinView, list } from './lists';
import { one } from './page';
import { resultsPage } from './results';
import { studyView, round_ } from './study';


/** Leaving the page (another route): the round in progress is still recorded. */


export function setsPage(main: HTMLElement, route: SetsRoute) {
  document.title = 'Study sets · Art History';
  render(main, html`<section class="page sets-page"><p class="muted">Loading…</p></section>`);
  if (route.join) joinView(main, route.join);
  else if (route.browse) browse(main, route.params);
  else if (route.code) {
    const ref = { code: route.code };
    if (route.study) studyView(main, ref, route.params); else one(main, ref);
  } else {
    account().then((name) => {
      if (!name) return loggedOut(main);
      if (route.results) return resultsPage(main);
      if (!route.id) return list(main);
      const ref = { own: route.id };
      return route.study ? studyView(main, ref, route.params) : one(main, ref);
    });
  }
  return () => { round_.leave?.(); round_.leave = null; };
}
