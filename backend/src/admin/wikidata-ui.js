// Pages for the Wikidata comparison (logic: wikidata.js). Nothing is pre-selected that would replace a value of yours.
const { thumbUrl } = require('./images');
const { html } = require('./html');
const { humanize } = require('./forms');

const fmt = (v) => (v === null || v === undefined || v === '' ? html`<span class="muted">(empty)</span>` : v);

function searchPage({ title, action, q, results, error }) {
  return html`<h1>${title}</h1>
    <p>Which Wikidata item is it? Search by name, or enter its id (e.g. <code>Q5582</code>).</p>
    <form class="bar" method="get" action="${action}"><input name="search" value="${q}" class="grow" type="search" autofocus>
      <button>Search Wikidata</button></form>
    ${error ? html`<p class="flash error">${error}</p>` : ''}
    ${results ? (results.length ? html`<div class="search-results">${results.map((r) => html`<div class="search-hit">
        <a href="${action}?q=${r.id}"><b>${r.label}</b></a> <span class="tag">${r.id}</span>
        <div class="muted small">${r.description}</div></div>`)}</div>` : html`<p class="muted">Nothing found.</p>`) : ''}`;
}

function fieldRow(r, t) {
  const name = humanize(r.key);
  if (r.kind === 'list') {
    const shown = r.items.filter((it) => !it.declined);
    const declined = r.items.filter((it) => it.declined);
    const box = (it, checked) => html`<label class="choice"><input type="checkbox" name="alt.${r.key}" value="${it.value}"${checked ? ' checked' : ''}> ${it.value}</label>`;
    // Never pre-ticked: Wikidata's aliases are often noisy ("The Starry Night by Vincent van Gogh") — pick what fits.
    return html`<tr><th>${name}</th><td>${r.ours.length ? r.ours.join(' · ') : fmt('')}</td>
      <td colspan="2">${shown.map((it) => box(it, false))}
        ${declined.length ? html`<details><summary class="muted small">declined before (${declined.length})</summary>${declined.map((it) => box(it, false))}</details>` : ''}
        <div class="muted small">Tick the names to add — yours stay as they are. The unticked ones:
          <label class="choice"><input type="radio" name="altrest.${r.key}" value="later" checked> decide later</label>
          <label class="choice"><input type="radio" name="altrest.${r.key}" value="decline"> decline (remembered)</label></div></td></tr>`;
  }
  if (r.status === 'same') {
    return html`<tr class="wd-same"><th>${name}</th><td>${fmt(r.kind === 'ref' ? r.ours : r.ours)}</td><td>${r.kind === 'ref' ? r.wikiLabel : r.display}</td><td class="muted">same</td></tr>`;
  }
  const note = r.declined ? html`<div class="muted small">you kept yours on ${r.declined.decided_at.toISOString().slice(0, 10)}</div>` : '';
  if (r.kind === 'ref') {
    // Explicit decisions only: "decide later" records nothing; keep/leave empty is remembered.
    const pre = r.declined ? 'keep' : r.status === 'empty' && r.target ? 'link' : 'later';
    const radio = (value, label) => html`<label class="choice"><input type="radio" name="ref.${r.key}" value="${value}"${pre === value ? ' checked' : ''}> ${label}</label>`;
    return html`<tr class="wd-${r.status}"><th>${name}</th><td>${fmt(r.ours)}</td>
      <td>${r.wikiLabel} <span class="tag">${r.qid}</span></td>
      <td>${radio('later', 'decide later')} ${radio('keep', r.ours ? 'keep mine' : 'leave empty')}
        ${r.target ? radio('link', html`link our <a href="/${t.folderOf(r.target.type)}/${r.target.slug}" target="_blank">${r.target.name}</a>${r.target.matchedBy === 'name' ? ' (same name)' : ''}`) : ''}
        ${!r.target && r.candidate ? radio('candidate', html`link our <a href="/${t.folderOf(r.candidate.type)}/${r.candidate.slug}" target="_blank">${r.candidate.name}</a> (similar name)`) : ''}
        ${!r.target && r.create ? radio('create', html`create new: ${r.create.describe}`) : ''}${note}</td></tr>`;
  }
  const pre = r.declined ? 'keep' : r.status === 'empty' ? 'take' : 'later';
  const radio = (value, label) => html`<label class="choice"><input type="radio" name="take.${r.key}" value="${value}"${pre === value ? ' checked' : ''}> ${label}</label>`;
  const extra = r.status === 'more-precise' ? html`<div class="muted small">yours is more precise (within Wikidata's range)</div>`
    : r.kind === 'point' && r.km !== null ? html`<div class="muted small">${r.km} km apart</div>` : '';
  return html`<tr class="wd-${r.status}"><th>${name}</th><td>${fmt(r.ours)}</td><td>${r.display}${extra}</td>
    <td>${radio('take', "take Wikidata's")} ${radio('keep', r.ours ? 'keep mine' : 'leave empty')} ${radio('later', 'decide later')}${note}</td></tr>`;
}

function suggestionRow(s, i, t) {
  if (s.already) {
    return html`<tr class="wd-same"><td>${s.label}</td><td>${s.target.name}</td><td>${s.period_display || ''}</td><td class="muted">already there</td></tr>`;
  }
  const pre = s.declined ? 'skip' : 'later';
  const radio = (value, label) => html`<label class="choice"><input type="radio" name="rel.${i}" value="${value}"${pre === value ? ' checked' : ''}> ${label}</label>`;
  return html`<tr${s.declined ? html` class="wd-declined"` : ''}><td>${s.label}</td>
    <td>${s.name} <span class="tag">${s.qid}</span></td>
    <td>${s.period_display || ''}</td>
    <td>${radio('later', 'decide later')} ${radio('skip', 'skip')}
      ${s.target ? radio('link', html`link our <a href="/${t.folderOf(s.target.type)}/${s.target.slug}" target="_blank">${s.target.name}</a>${s.target.matchedBy === 'name' ? ' (same name)' : ''}`) : ''}
      ${!s.target && s.candidate ? radio('candidate', html`link our <a href="/${t.folderOf(s.candidate.type)}/${s.candidate.slug}" target="_blank">${s.candidate.name}</a> (similar)`) : ''}
      ${!s.target && s.create ? radio('create', html`create new ${s.create.describe}`) : ''}
      ${s.declined ? html`<div class="muted small">skipped before</div>` : ''}</td></tr>`;
}

// One Commons image: add it to the entry's images, skip it (remembered), or decide later.
function imageChoice(img, i) {
  const pre = img.declined ? 'skip' : img.suggested ? 'add' : 'later';
  const radio = (value, label) => html`<label class="choice"><input type="radio" name="img.${i}" value="${value}"${pre === value ? ' checked' : ''}> ${label}</label>`;
  return html`<div class="wd-image${img.declined ? ' wd-declined' : ''}"><img src="${thumbUrl(img.url, 250)}" alt="" loading="lazy">
    <div><div><b>${img.file}</b></div><div><b>License:</b> ${img.license || '?'}</div><div><b>Credit:</b> ${img.credit || '?'}</div>
      <div class="small"><a href="${img.source_url}" target="_blank" rel="noopener">file page ↗</a></div>
      ${img.status === 'same' ? html`<p class="muted">Already one of ours.</p>`
        : html`${radio('add', 'add to the images')} ${radio('skip', 'skip')} ${radio('later', 'decide later')}
          ${img.declined ? html`<div class="muted small">skipped before</div>` : ''}`}</div></div>`;
}

function reviewPage({ title, plan, t, action, isNew }) {
  const fresh = plan.suggestions.filter((s) => !s.declined);
  const declined = plan.suggestions.filter((s) => s.declined);
  return html`<h1>${title}</h1>
    <p><b>${plan.label}</b> <a class="tag" href="https://www.wikidata.org/wiki/${plan.qid}" target="_blank" rel="noopener">${plan.qid} ↗</a>
      <span class="muted">${plan.description}</span> · <a href="${action}?search=${encodeURIComponent(plan.label || '')}">not this one?</a></p>
    <p class="muted">Nothing is taken unless chosen. Your own values are never pre-selected for replacement; empty fields are.
      “Keep mine” and “skip” are remembered as checked; “decide later” records nothing and asks again next time.
      ${isNew ? 'The values fill the new-entry form — check it and press Create.' : 'Field values go into the working copy — check them in the editor and Publish. Relationships and new entries are created when you apply.'}</p>
    <form method="post" action="${action}" class="wd-form">
      <input type="hidden" name="qid" value="${plan.qid}">
      <h2>Fields</h2>
      <div class="table-wrap"><table class="diff wd-table"><thead><tr><th>Field</th><th>Yours</th><th>Wikidata</th><th>Take?</th></tr></thead>
        <tbody>${plan.rows.map((r) => fieldRow(r, t))}</tbody></table></div>
      ${plan.images.length ? html`<h2>Images (Wikimedia Commons)</h2>
        ${isNew ? html`<p class="muted">${plan.images.length} image${plan.images.length === 1 ? '' : 's'} on Commons — create the entry first, then compare it with Wikidata again to add them.</p>`
          : html`<div class="wd-images">${plan.images.map((img, i) => imageChoice(img, i))}</div>`}` : ''}
      ${!isNew ? html`<h2>Relationships suggested by Wikidata</h2>
        ${plan.suggestions.length ? html`<p class="actions wd-bulk">Set all open suggestions:
            <button type="button" class="secondary" data-wd-set="link">link where we have it</button>
            <button type="button" class="secondary" data-wd-set="skip">skip</button>
            <button type="button" class="secondary" data-wd-set="later">decide later</button></p>
          <div class="table-wrap"><table class="diff wd-table"><thead><tr><th>Relationship</th><th>With</th><th>Period</th><th>Do</th></tr></thead>
          <tbody>${fresh.map((s) => suggestionRow(s, plan.suggestions.indexOf(s), t))}</tbody></table></div>
          ${declined.length ? html`<details><summary class="muted">skipped before (${declined.length})</summary><table class="diff wd-table"><tbody>
            ${declined.map((s) => suggestionRow(s, plan.suggestions.indexOf(s), t))}</tbody></table></details>` : ''}`
          : html`<p class="muted">None.</p>`}` : html`<p class="muted">Relationships: create the entry first, then compare it with Wikidata again.</p>`}
      <div class="actions sticky-actions"><button>Apply selected</button><a class="button secondary" href="${action.replace(/\/wikidata$/, '')}">Cancel</a></div>
    </form>`;
}

module.exports = { searchPage, reviewPage };
