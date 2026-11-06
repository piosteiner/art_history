// The site's own questions — never the browser's confirm()/prompt()/alert() (owner 2026-11-06: those can be switched
// off by the browser or an add-on, and they don't look like the site). A modal <dialog> in the site's style:
// `ask()` for yes/no, `askText()` for an optional or required line of text. Escape or a click beside it = Cancel.

export interface AskOptions {
  title?: string;
  text: string;
  ok?: string;          // the button that does it, e.g. "Lock", "Delete"
  cancel?: string;
  danger?: boolean;     // the action can't be undone or removes something: the button in the warning colour
}
export interface AskTextOptions extends AskOptions {
  label?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  maxLength?: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function open<T>(o: AskTextOptions, withText: boolean, answer: (ok: boolean, value: string) => T): Promise<T> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'site-dialog';
    const field = withText
      ? (o.multiline
        ? `<textarea name="value" rows="3"${o.maxLength ? ` maxlength="${String(o.maxLength)}"` : ''}${o.required ? ' required' : ''} placeholder="${esc(o.placeholder ?? '')}"></textarea>`
        : `<input name="value"${o.maxLength ? ` maxlength="${String(o.maxLength)}"` : ''}${o.required ? ' required' : ''} placeholder="${esc(o.placeholder ?? '')}" autocomplete="off">`)
      : '';
    dialog.innerHTML = `<form method="dialog" class="site-dialog-form">
      ${o.title ? `<h2 class="site-dialog-title">${esc(o.title)}</h2>` : ''}
      <p class="site-dialog-text">${esc(o.title && o.text.startsWith(o.title) ? o.text.slice(o.title.length).trim() : o.text)}</p>
      ${withText ? `<label class="site-dialog-field">${o.label ? `<span>${esc(o.label)}</span>` : ''}${field}</label>` : ''}
      <div class="site-dialog-buttons">
        <button type="button" class="secondary site-dialog-cancel" value="cancel">${esc(o.cancel ?? 'Cancel')}</button>
        <button type="submit" class="site-dialog-ok${o.danger ? ' danger-fill' : ''}" value="ok">${esc(o.ok ?? 'OK')}</button></div></form>`;
    const form = dialog.querySelector('form')!;
    const input = dialog.querySelector<HTMLInputElement | HTMLTextAreaElement>('[name=value]');
    let result: T | undefined;
    const finish = (ok: boolean) => { if (result === undefined) result = answer(ok, input?.value.trim() ?? ''); dialog.close(); };
    form.addEventListener('submit', (e) => { e.preventDefault(); finish(true); });
    dialog.querySelector('.site-dialog-cancel')!.addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });          // Escape
    dialog.addEventListener('click', (e) => { if (e.target === dialog) finish(false); });      // beside the box
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result ?? answer(false, '')); });
    document.body.append(dialog);
    dialog.showModal();
    (input ?? dialog.querySelector<HTMLButtonElement>(o.danger ? '.site-dialog-cancel' : '.site-dialog-ok'))!.focus();
  });
}

/** Yes or no: true when the action button was chosen. */
export const ask = (text: string, o: Omit<AskOptions, 'text'> = {}) => open({ ...o, text }, false, (ok) => ok);

/** A line of text: the text typed (possibly empty) when confirmed, null when cancelled. */
export const askText = (text: string, o: Omit<AskTextOptions, 'text'> = {}) => open({ ...o, text }, true, (ok, value) => (ok ? value : null));
