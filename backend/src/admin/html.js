// Server-rendered HTML without a template engine: html`…` escapes every interpolated value unless it is itself
// html`…` (or raw()). Arrays are joined. null/undefined/false render as nothing.
class Html {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Html) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return escape(v);
}

function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Html(out);
}

// Trusted HTML only (e.g. output of renderMarkdown, which is sanitized).
const raw = (s) => new Html(s ?? '');
const { asset } = require('./assets');
const feedback = require('./feedback-count');
const config = require('../config');

// page: { type, slug, mode } — tells the live connection (editor/live.js) where the user is.
function layout({ title, user, body, flash, nav = true, page = null }) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · Art history admin</title>
<link rel="stylesheet" href="${asset('admin.css')}">
<script src="${asset('theme.js')}"></script>
<script src="${asset('editor.js')}" defer></script>
</head>
<body data-map-js="${asset('map.js')}" data-map-css="${asset('map.css')}"${user ? html` data-live="1"` : ''}${page ? html` data-page-type="${page.type}" data-page-slug="${page.slug || ''}" data-page-mode="${page.mode}"` : ''}>
${config.testEnv ? html`<div class="test-env" role="note"><b>Test environment</b> — changes here are reset every night to the live data and never reach
  <a href="https://arthistory.piogino.ch">arthistory.piogino.ch</a>. See them on the <a href="${config.testSite}">test site</a>.</div>` : ''}
${nav && user ? html`<header class="top">
  <a class="brand" href="/">Art history admin</a>
  <nav>
    <span class="nav-group" title="The collection: works and who made, owned and kept them"><a href="/artworks">Artworks</a><a href="/artists">Artists</a><a href="/people">People</a><a href="/institutions">Institutions</a></span>
    <span class="nav-group" title="Context: when and where"><a href="/events">Events</a><a href="/movements">Movements</a><a href="/places">Places</a><a href="/polities">Polities</a></span>
    <span class="nav-group" title="Reference"><a href="/glossary">Glossary</a><a href="/bibliography">Bibliography</a></span>
    <span class="nav-group nav-tools" title="The data: its checks and every change"><a href="/quality">Quality</a><a href="/history">History</a></span>
    <span class="nav-group nav-site" title="The public site: its texts and settings"><a href="/pages" title="Text pages of the site: the project documentation, the privacy statement">Pages</a><a href="/changelog" title="What changed on the site, by day">Changelog</a><a href="/roadmap" title="What is being worked on, next, later">Roadmap</a><a href="/featured" title="The curated views of the start page">Start views</a><a href="/search-words" title="Words the public search treats as the same, across languages">Search words</a><a href="/feedback" title="What visitors sent with the F button">Feedback${feedback.newCount() ? html` <span class="nav-count" title="new">${String(feedback.newCount())}</span>` : ''}</a></span>
  </nav>
  <form method="get" action="/search" class="inline top-search" role="search"><input type="search" name="q" placeholder="Search everything…" aria-label="Search everything"></form>
  <button type="button" class="theme-toggle" data-theme-toggle title="Theme (click to change)">◐ Auto</button>
  <form method="post" action="/logout" class="inline"><span class="muted">${user.username}</span> <button class="link">Log out</button></form>
</header>` : ''}
<main>
${flash ? html`<p class="flash ${flash.kind}">${flash.text}</p>` : ''}
${body}
</main>
</body>
</html>`;
}

module.exports = { html, raw, layout, escape };
