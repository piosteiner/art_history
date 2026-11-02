// An artist's works (views/detail-facts.ts, worksGallery): once a picture has loaded its shape is known — a very wide
// one (more than WIDE × as wide as high) takes a line of its own with the text below, in a sharper rendition.
import { thumb, WIDE } from '../html';

export function wireWorkPictures(root: Element) {
  const shape = (img: HTMLImageElement) => {
    const row = img.closest<HTMLElement>('.work-row');
    if (!row || !img.naturalWidth) return;
    const wide = img.naturalWidth / img.naturalHeight > WIDE;
    row.classList.toggle('wide', wide);
    const full = img.dataset.full;
    if (wide && full && !img.dataset.wideSrc) {
      img.dataset.wideSrc = '1';
      const sharp = thumb(full, 1280);
      if (sharp !== img.src) img.src = sharp;
    }
  };
  root.querySelectorAll<HTMLImageElement>('.work-list img').forEach((img) => {
    if (img.complete) shape(img);
    img.addEventListener('load', () => shape(img));
  });
}
