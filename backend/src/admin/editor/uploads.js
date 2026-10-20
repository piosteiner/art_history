// Images of a page (migration 114, src/admin/routes/pages.js): uploaded by name and embedded as ![[name]], as Obsidian does.
//   uploadImage(url, file)     POST the file (body) with its name (?name=) → { name, embed, url, size_label, delete, id }
//   imageHandlers(url, view)   CodeMirror: an image dropped on or pasted into the text is uploaded and its embed written there
//                              (a pasted screenshot has no name: "Pasted image 20261020143005.png", like Obsidian)
//   initImageUploads()         the page's image section: several files at once, copy an embed, delete (no reload: the
//                              text being written stays)
import { EditorView } from '@codemirror/view';

const pad = (n) => String(n).padStart(2, '0');
const pastedName = (file) => {
  const d = new Date();
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return `Pasted image ${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
};
// a plain name the server accepts: letters, digits, spaces, . _ - (umlauts are letters too)
const cleanName = (name) => name.normalize('NFC').replace(/[^\p{L}\p{N} ._-]+/gu, '-').replace(/^[^\p{L}\p{N}_]+/u, '');

export async function uploadImage(url, file, name = null) {
  const res = await fetch(`${url}?${new URLSearchParams({ name: cleanName(name || file.name) })}`, {
    method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' }, credentials: 'same-origin',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `upload failed (${res.status})`);
  document.dispatchEvent(new CustomEvent('page-image-uploaded', { detail: body }));
  return body;
}

const imagesOf = (list) => [...(list || [])].filter((f) => f.type && f.type.startsWith('image/'));

/** CodeMirror extension: drop or paste images into the text → uploaded, the embeds written at the drop point / cursor. */
export function imageHandlers(url) {
  const put = async (view, files, pos) => {
    const lines = [];
    for (const f of files) {
      try {
        const named = /^image\.\w+$/.test(f.name) || !f.name ? pastedName(f) : f.name;
        lines.push((await uploadImage(url, f, named)).embed);
      } catch (err) {
        alert(err.message);  // eslint-disable-line no-alert
      }
    }
    if (!lines.length) return;
    const text = `${lines.join('\n')}\n`;
    view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
    view.focus();
  };
  return EditorView.domEventHandlers({
    paste(e, view) {
      const files = imagesOf(e.clipboardData && e.clipboardData.files);
      if (!files.length) return false;
      e.preventDefault();
      void put(view, files, view.state.selection.main.head);
      return true;
    },
    drop(e, view) {
      const files = imagesOf(e.dataTransfer && e.dataTransfer.files);
      if (!files.length) return false;
      e.preventDefault();
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
      void put(view, files, pos);
      return true;
    },
  });
}

function addRow(list, img) {
  if (!list) return;
  list.querySelector(`[data-image-id="${img.id}"]`)?.remove();
  const li = document.createElement('li');
  li.dataset.imageId = String(img.id);
  const thumb = document.createElement('img');
  thumb.src = `${img.url}?v=${Date.now()}`;
  thumb.alt = '';
  const code = document.createElement('code');
  code.textContent = img.name;
  const size = document.createElement('span');
  size.className = 'muted small';
  size.textContent = ` ${img.size_label} · new`;
  const copy = document.createElement('button');
  Object.assign(copy, { type: 'button', className: 'link-button', textContent: 'copy embed' });
  copy.dataset.copy = img.embed;
  const del = document.createElement('button');
  Object.assign(del, { type: 'button', className: 'link-button danger', textContent: 'delete' });
  del.dataset.imageDelete = img.delete;
  li.append(thumb, ' ', code, size, ' ', copy, ' ', del);
  list.prepend(li);
}

// A .md file replaces the page's text (routes/pages.js POST /upload): 409 = changed in the CMS since the last download →
// asked, then sent again with ?force=1. Then the page reloads with the new chapters.
function initMdUpload() {
  for (const input of document.querySelectorAll('input[type=file][data-md-upload]')) {
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const text = await file.text();
      const send = (force) => fetch(`${input.dataset.mdUpload}${force ? '?force=1' : ''}`, {
        method: 'POST', body: text, headers: { 'Content-Type': 'text/markdown; charset=utf-8' }, credentials: 'same-origin' });
      let res = await send(false);
      if (res.status === 409) {
        const { error } = await res.json();
        if (!window.confirm(`${error}\n\nReplace the text with ${file.name}?`)) { input.value = ''; return; }  // eslint-disable-line no-alert
        res = await send(true);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { alert(body.error || `upload failed (${res.status})`); input.value = ''; return; }  // eslint-disable-line no-alert
      location.assign(`${location.pathname}?done=saved`);
    });
  }
}

export function initImageUploads() {
  initMdUpload();
  const list = document.querySelector('[data-image-list]');
  document.addEventListener('page-image-uploaded', (e) => addRow(list, e.detail));
  for (const input of document.querySelectorAll('input[type=file][data-image-upload]')) {
    const status = input.parentElement.querySelector('[data-image-upload-status]');
    input.addEventListener('change', async () => {
      const files = imagesOf(input.files);
      let done = 0;
      const failed = [];
      for (const f of files) {
        if (status) status.textContent = `Uploading ${done + 1} of ${files.length}: ${f.name}…`;
        try { await uploadImage(input.dataset.imageUpload, f); done += 1; } catch (err) { failed.push(`${f.name}: ${err.message}`); }
      }
      if (status) status.textContent = `${done} of ${files.length} uploaded.${failed.length ? ` Not uploaded — ${failed.join('; ')}` : ''}`;
      input.value = '';
    });
  }
  document.addEventListener('click', async (e) => {
    const copy = e.target.closest('button[data-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = 'copied'; } catch { copy.textContent = copy.dataset.copy; }
      setTimeout(() => { copy.textContent = 'copy embed'; }, 1500);
      return;
    }
    const del = e.target.closest('button[data-image-delete]');
    if (!del) return;
    const name = del.closest('li')?.querySelector('code')?.textContent || 'this image';
    if (!window.confirm(`Delete ${name}? Embeds of it show as a missing image.`)) return;  // eslint-disable-line no-alert
    const res = await fetch(del.dataset.imageDelete, { method: 'POST', credentials: 'same-origin' });
    if (res.ok) del.closest('li').remove();
  });
}
