// Private reference images on a work's page (src/admin/routes/private-images.js, migration 184): a chosen file, a
// pasted screenshot or an image dropped on the box is uploaded with the book and page given, then the page reloads.
export function initPrivateImages() {
  const box = document.querySelector('[data-private-upload]');
  if (!box) return;
  const upload = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const params = new URLSearchParams({
      source: box.querySelector('[name="pi-source"]').value,
      locator: box.querySelector('[name="pi-locator"]').value,
    });
    const res = await fetch(`${box.dataset.privateUpload}?${params}`, {
      method: 'POST', body: file, headers: { 'Content-Type': file.type }, credentials: 'same-origin',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { alert(body.error || `upload failed (${res.status})`); return; }  // eslint-disable-line no-alert
    location.hash = 'private-images';
    location.reload();
  };
  box.id = 'private-images';
  box.querySelector('[name="pi-file"]').addEventListener('change', (e) => upload(e.target.files[0]));
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drop'); });
  box.addEventListener('dragleave', () => box.classList.remove('drop'));
  box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('drop'); upload([...e.dataTransfer.files][0]); });
  // a pasted screenshot — only while the pointer or focus is in the box, so pasting text elsewhere is untouched
  let inside = false;
  box.addEventListener('mouseenter', () => { inside = true; });
  box.addEventListener('mouseleave', () => { inside = false; });
  document.addEventListener('paste', (e) => {
    if (!inside && !box.contains(document.activeElement)) return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); upload(file); }
  });
}
