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
  // a picture from another website: an image's link is stored at once; a page's pictures are offered to choose from
  const linkInput = box.querySelector('[name="pi-link"]');
  const chooser = box.querySelector('.pi-choose');
  const fromLink = async (url, page = null) => {
    const res = await fetch(`${box.dataset.privateUpload}/from-link`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, page, source: box.querySelector('[name="pi-source"]').value, locator: box.querySelector('[name="pi-locator"]').value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `failed (${res.status})`);
    return body;
  };
  const done = () => { location.hash = 'private-images'; location.reload(); };
  box.querySelector('.pi-link-add')?.addEventListener('click', async () => {
    const url = linkInput.value.trim();
    if (!url) return;
    try {
      const got = await fromLink(url);
      if (!got.pictures) return done();
      chooser.hidden = false;
      chooser.replaceChildren();
      const note = document.createElement('p');
      note.className = 'muted small';
      note.textContent = `${got.pictures.length} picture${got.pictures.length === 1 ? '' : 's'} on that page — pick the ones to keep:`;
      const list = document.createElement('div');
      list.className = 'pi-choose-list';
      for (const pic of got.pictures) {
        const label = document.createElement('label');
        label.className = 'pi-choice';
        const box2 = document.createElement('input');
        box2.type = 'checkbox';
        box2.value = pic;
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = '';
        img.src = `/private-images/preview?${new URLSearchParams({ url: pic, page: got.page })}`;
        img.addEventListener('error', () => label.remove());   // not a picture after all (an icon, a broken link)
        label.append(box2, img);
        list.append(label);
      }
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = 'Add the chosen pictures';
      add.addEventListener('click', async () => {
        const chosen = [...list.querySelectorAll('input:checked')].map((x) => x.value);
        if (!chosen.length) return;
        add.disabled = true;
        try {
          for (const pic of chosen) await fromLink(pic, got.page);   // one after another: the site isn't flooded
          done();
        } catch (err) { add.disabled = false; alert(err.message); }   // eslint-disable-line no-alert
      });
      chooser.append(note, list, add);
    } catch (err) { alert(err.message); }   // eslint-disable-line no-alert
  });
  linkInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.querySelector('.pi-link-add').click(); } });
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
