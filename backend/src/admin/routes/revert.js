// Admin panel — Revert a change set / restore a version (src/admin/revert.js, revert-ui.js).
// Mounted by src/admin/index.js in a fixed order; shared helpers in src/admin/core.js.
const express = require('express');
const { adminPool } = require('../../db');
const { BY_FOLDER } = require('../../content');
const { html } = require('../html');
const { planChangeSet, planVersion, execute, fingerprint, revertedBy, unconfirmed } = require('../revert');
const { planPage } = require('../revert-ui');
const collab = require('../collab');
const { send, friendly, notFoundPage } = require('../core');

const router = express.Router();

// ---------------------------------------------------------------------------------------------------------------
// Revert a change set / restore a version (src/admin/revert.js, revert-ui.js)
// ---------------------------------------------------------------------------------------------------------------
// One transaction per request: plan → fingerprint → execute every step (with savepoints) → COMMIT only when "Apply"
// was pressed, the state is unchanged since the preview, everything is confirmed and nothing failed; otherwise
// ROLLBACK — which makes the same code the dry run. The markers make the audit trigger record what was undone.
async function runPlan(req, res, kind, id) {
  const choices = req.method === 'POST' ? req.body : {};
  const submitted = choices.submitted === '1';
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('arthistory.user_id', $1, true), set_config('arthistory.source', $2, true),
                               set_config('arthistory.reverts', $3, true), set_config('arthistory.restores', $4, true)`,
    [String(req.user.id), kind, kind === 'revert' ? id : '', kind === 'restore' ? id : '']);
    const plan = kind === 'revert' ? await planChangeSet(client, id, choices, submitted) : await planVersion(client, id, choices, submitted);
    if (!plan || !plan.items.length) {
      await client.query('ROLLBACK');
      return notFoundPage(req, res);
    }
    const fp = await fingerprint(client, plan.items);
    const problems = [];
    let apply = choices.do === 'apply';
    if (apply && choices.fingerprint !== fp) {
      problems.push('Something changed since this preview was shown. The plan below is up to date — please check it again.');
      apply = false;
    }
    if (apply && unconfirmed(plan.items).length) {
      problems.push('Some steps need your confirmation (see below) — confirm them or untick them.');
      apply = false;
    }
    const raw = await execute(client, plan.items);
    const results = Object.fromEntries(Object.entries(raw).map(([k, r]) => {
      let message = null;
      if (!r.ok) { try { message = friendly(r.error); } catch { message = r.error.message; } }
      return [k, { ok: r.ok, message }];
    }));
    const active = plan.items.filter((i) => i.include && i.op !== 'none' && !i.blocked);
    if (apply && active.length && Object.values(results).every((r) => r.ok)) {
      await client.query('COMMIT');
      // Entries changed here may have open working copies (live step 2): rebase them, or close them if deleted.
      for (const item of plan.items.filter((i) => BY_FOLDER[i.table] && i.include && i.op !== 'none' && !i.blocked)) {
        const tt = BY_FOLDER[item.table];
        if (item.op === 'delete') await collab.gone(tt, item.rowId); else await collab.changedElsewhere(tt, item.rowId);
      }
      if (kind === 'restore') {
        const [item] = plan.items;
        const { rows } = await adminPool.query(`SELECT slug FROM ${item.table} WHERE id = $1`, [item.rowId]);
        return res.redirect(303, rows[0] ? `/${item.table}/${rows[0].slug}?done=restored` : '/history?done=restored');
      }
      return res.redirect(303, '/history?done=reverted');
    }
    // Geography values are stored as hex in the audit log — show them as WKT.
    const hex = [...new Set(plan.items.flatMap((i) => i.fields).filter((f) => ['location', 'area'].includes(f.name))
      .flatMap((f) => [f.before, f.after, f.now]).filter((v) => typeof v === 'string'))];
    const geo = hex.length ? Object.fromEntries((await client.query(
      'SELECT h, ST_AsText(h::geography) AS wkt FROM unnest($1::text[]) h', [hex])).rows.map((r) => [r.h, r.wkt])) : {};
    await client.query('ROLLBACK');

    let intro;
    if (kind === 'revert') {
      const first = plan.entries[0];
      const done = await revertedBy(adminPool, id);
      intro = html`<p>Undo what one save did on <b>${first.changed_at.toISOString().slice(0, 16).replace('T', ' ')}</b>
        by ${first.username || 'an unknown user'} <span class="tag">${first.source}</span>. Fields changed later are kept unless you choose otherwise.</p>
        ${done.length ? html`<p class="flash ok">Already reverted on ${done.map((d) => d.at.toISOString().slice(0, 16).replace('T', ' ')).join(', ')} — steps that are already undone show as “nothing to do”.</p>` : ''}`;
    } else {
      const e = plan.entry;
      intro = html`<p>Bring <b>${plan.items[0].label}</b> back to how it was right after the change of
        <b>${e.changed_at.toISOString().slice(0, 16).replace('T', ' ')}</b> (${e.username || 'unknown user'}). Untick fields to leave them as they are now.
        Relationships are not touched — revert their changes individually.</p>`;
    }
    send(req, res, {
      title: kind === 'revert' ? 'Revert a change' : 'Restore a version',
      body: planPage({ title: kind === 'revert' ? 'Revert a change' : 'Restore a version', intro, action: `/${kind}/${id}`,
        items: plan.items, results, fingerprint: fp, problems, geo, version: kind === 'restore' }),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

router.get('/revert/:txid', (req, res, next) => (/^\d+$/.test(req.params.txid) ? runPlan(req, res, 'revert', req.params.txid) : next()));
router.post('/revert/:txid', (req, res, next) => (/^\d+$/.test(req.params.txid) ? runPlan(req, res, 'revert', req.params.txid) : next()));
router.get('/restore/:id', (req, res, next) => (/^\d+$/.test(req.params.id) ? runPlan(req, res, 'restore', req.params.id) : next()));
router.post('/restore/:id', (req, res, next) => (/^\d+$/.test(req.params.id) ? runPlan(req, res, 'restore', req.params.id) : next()));

module.exports = router;
