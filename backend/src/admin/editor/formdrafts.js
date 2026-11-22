// Autosave for whole forms (migration 119: the changelog and roadmap forms, src/admin/routes/changelog.js): a form
// [data-form-draft="<url>"] sends its fields as a draft of this account 1.5 s after typing pauses, and when the tab is
// hidden or closed; [data-form-draft-status] says when. Save (the form) applies it and the server removes the draft;
// opening the form again restores one that was never saved. Like the pages' autosave (uploads.js), for many fields.
// Also: a form [data-confirm="question"] asks before it is sent (delete buttons); a button [data-copy-from="#id"] copies
// that field's text (the message after a password reset, 256) and says so in the [data-copy-status] beside it.
// A new form (…/new) with nothing written in it is no draft (blank.js): instead of saving it, its draft is removed.
import { hasContent } from './blank.js';

export function initFormDrafts() {
  for (const form of document.querySelectorAll('form[data-confirm]')) {
    form.addEventListener('submit', (e) => { if (!window.confirm(form.dataset.confirm)) e.preventDefault(); });
  }
  for (const form of document.querySelectorAll('form[data-form-draft]')) setup(form);
  for (const button of document.querySelectorAll('button[data-copy-from]')) {
    button.addEventListener('click', async () => {
      const field = document.querySelector(button.dataset.copyFrom);
      const status = button.parentElement.querySelector('[data-copy-status]');
      if (!field) return;
      try {
        await navigator.clipboard.writeText(field.value);
        if (status) status.textContent = 'Copied.';
      } catch {
        field.select();   // no clipboard (http, an old browser): selected, to copy by hand
        if (status) status.textContent = 'Selected — copy it with Ctrl+C / ⌘C.';
      }
    });
  }
}

function setup(form) {
  const status = form.querySelector('[data-form-draft-status]');
  const say = (t) => { if (status) status.textContent = t; };
  const fields = () => {
    const out = {};
    for (const [k, v] of new FormData(form)) if (typeof v === 'string') out[k] = v;
    return out;
  };
  let last = JSON.stringify(fields());
  let timer = null;
  let submitting = false;
  const time = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const send = async (beacon = false) => {
    clearTimeout(timer);
    const now = JSON.stringify(fields());
    if (submitting || now === last) return;
    const empty = /\/new$/.test(form.dataset.formDraft) && !hasContent(form);
    const body = JSON.stringify(empty ? { discard: true } : { fields: JSON.parse(now), base: form.dataset.formDraftBase || '' });
    if (beacon && navigator.sendBeacon) { if (navigator.sendBeacon(form.dataset.formDraft, new Blob([body], { type: 'application/json' }))) last = now; return; }
    say('Saving draft…');
    try {
      const r = await fetch(form.dataset.formDraft, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', keepalive: true });
      if (!r.ok) throw new Error(String(r.status));
      last = now;
      say(empty ? '' : `Draft saved ${time()} — not saved to the entry until you press the button.`);
    } catch {
      say('Draft not saved (offline?) — retrying when you type; keep this tab open.');
    }
  };
  const changed = () => { clearTimeout(timer); timer = setTimeout(send, 1500); };
  form.addEventListener('input', changed);
  form.addEventListener('change', changed);
  form.addEventListener('md-change', changed, true);   // the Markdown editor's textarea (CodeMirror keeps it in step)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void send(true); });
  form.addEventListener('submit', () => { submitting = true; clearTimeout(timer); });
  window.addEventListener('beforeunload', (e) => {
    if (submitting || JSON.stringify(fields()) === last) return;
    void send(true);
    if (/\/new$/.test(form.dataset.formDraft) && !hasContent(form)) return;   // nothing written: nothing to lose
    e.preventDefault();
  });
}
