// Pages for reverting a change set and restoring a version (logic in revert.js).
// The page is the plan: one box per row with a field-by-field comparison, the choices, and the dry-run result.
// "Check again" re-plans with the choices made; "Apply" re-checks the state fingerprint and then writes.
const { html } = require('./html');

const OP_TEXT = {
  update: 'Set fields back', restore: 'Re-create (with its original id)', delete: 'Delete again', none: 'Nothing to do',
};

function show(v, geo) {
  if (v === null || v === undefined || v === '') return html`<span class="muted">(empty)</span>`;
  if (typeof v === 'string' && geo[v]) v = geo[v];  // hex geography → WKT
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 220 ? `${s.slice(0, 217)}…` : s;
}

function fieldRows(item, geo, version) {
  if (!item.fields.length) return '';
  return html`<div class="table-wrap"><table class="diff revert-fields"><thead><tr><th>Field</th>
    <th>${version ? 'That version' : 'Before the change'}</th>${version ? '' : html`<th>After the change</th>`}<th>Now</th><th>Do</th></tr></thead><tbody>
    ${item.fields.map((f) => html`<tr class="rf-${f.status}">
      <th>${f.name}</th>
      <td class="new">${show(f.before, geo)}</td>
      ${version ? '' : html`<td class="old">${show(f.after, geo)}</td>`}
      <td>${show(f.now, geo)}${f.status === 'conflict' ? html`<div class="tag warn">changed since</div>` : ''}</td>
      <td>${f.status === 'already' ? html`<span class="muted">already back</span>`
        : html`<label class="choice"><input type="radio" name="f.${item.key}.${f.name}" value="revert"${f.choice === 'revert' ? ' checked' : ''}> ${version ? 'restore' : 'revert'}</label>
               <label class="choice"><input type="radio" name="f.${item.key}.${f.name}" value="keep"${f.choice === 'keep' ? ' checked' : ''}> keep now</label>`}</td>
    </tr>`)}</tbody></table></div>`;
}

function itemBox(item, result, geo, version) {
  const status = item.op === 'none' ? html`<span class="tag">skipped</span>`
    : item.blocked ? html`<span class="tag warn">not possible: ${item.blocked}</span>`
      : !item.include ? html`<span class="tag">excluded</span>`
        : !result ? ''
          : result.ok ? html`<span class="tag ok">✓ dry run ok</span>`
            : html`<span class="tag warn">✗ ${result.message}</span>`;
  return html`<fieldset class="revert-item${item.blocked || (result && !result.ok) ? ' has-problem' : ''}">
    <legend>${item.op !== 'none' && !item.blocked
      ? html`<label><input type="checkbox" name="include.${item.key}" value="1"${item.include ? ' checked' : ''}> ${item.label}</label>`
      : item.label}
      <span class="muted">· ${OP_TEXT[item.op]}</span> ${status}</legend>
    ${item.notes.map((n) => html`<p class="muted small">${n}</p>`)}
    ${item.gone ? html`<p class="small"><label class="choice"><input type="radio" name="gone.${item.key}" value="skip"${item.op === 'none' ? ' checked' : ''}> skip it</label>
      <label class="choice"><input type="radio" name="gone.${item.key}" value="restore"${item.op === 'restore' ? ' checked' : ''}> re-create it as it was before this change</label></p>` : ''}
    ${item.needs.slug ? html`<div class="field"><label for="slug-${item.key}">New slug (“${item.needs.slug.taken}” is taken)</label>
      <input id="slug-${item.key}" name="slug.${item.key}" value="${item.needs.slug.value}" pattern="[a-z0-9]+(-[a-z0-9]+)*"></div>` : ''}
    ${item.needs.confirm ? html`<p class="small warnbox"><label><input type="checkbox" name="confirm.${item.key}" value="1"${item.confirmed ? ' checked' : ''}>
      ${item.needs.confirm} Confirm to include this.</label></p>` : ''}
    ${item.op === 'update' ? fieldRows(item, geo, version) : ''}
  </fieldset>`;
}

// ctx: { title, intro, action, items, results, fingerprint, problems, applied, geo, version }
function planPage(ctx) {
  const active = ctx.items.filter((i) => i.include && i.op !== 'none' && !i.blocked);
  const failed = active.filter((i) => ctx.results[i.key] && !ctx.results[i.key].ok);
  const conflicts = ctx.items.reduce((n, i) => n + i.fields.filter((f) => f.status === 'conflict').length, 0);
  const canApply = active.length && !failed.length && !ctx.problems.length;
  return html`<h1>${ctx.title}</h1>
    ${ctx.intro}
    <p>${active.length} of ${ctx.items.length} step${ctx.items.length === 1 ? '' : 's'} included
      ${conflicts ? html` · <b>${conflicts} field${conflicts === 1 ? '' : 's'} changed since</b> (kept unless you choose “${ctx.version ? 'restore' : 'revert'}”)` : ''}
      ${failed.length ? html` · <b class="err">${failed.length} would fail</b>` : ''}</p>
    ${ctx.problems.map((p) => html`<p class="flash error">${p}</p>`)}
    <form method="post" action="${ctx.action}" class="revert-form">
      <input type="hidden" name="fingerprint" value="${ctx.fingerprint}">
      <input type="hidden" name="submitted" value="1">
      ${ctx.items.map((i) => itemBox(i, ctx.results[i.key], ctx.geo, ctx.version))}
      <div class="actions sticky-actions">
        <button name="do" value="check" class="secondary">Check again</button>
        ${canApply ? html`<button name="do" value="apply">${ctx.version ? 'Restore this version' : 'Apply revert'}</button>`
          : html`<span class="muted">${active.length ? 'Resolve the problems above, then check again.' : 'Nothing selected.'}</span>`}
      </div>
    </form>`;
}

module.exports = { planPage };
