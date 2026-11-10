// The picture of a shared link (og:image, 2026-11-10). Chat apps and social networks show a link's picture only when it
// loads quickly and is not too large, and Wikimedia serves thumbnails only at its standard widths (1200 px is refused
// with HTTP 400 — every preview was broken). So:
//   a JPEG on Wikimedia (thumbnail or original)  → Wikimedia's 960-px thumbnail (about 100–300 KB)
//   any other image — PNG, GIF, TIFF, SVG on Wikimedia (their thumbnails stay PNG, often over 1 MB), a museum's own
//   server                                         → the API's thumbnail service as an 800-px JPEG (&f=jpg)
//   no https address                              → no picture
export function ogImage(url, api) {
  if (!url || !/^https:\/\//.test(url)) return null;
  const clean = /^https:\/\/[^/]*wikimedia\.org\//.test(url) ? url.replace(/[?#].*$/, '') : url;   // ?utm_source=… on copied originals
  if (/^https:\/\/(upload|thumb)\.wikimedia\.org\/.*\/thumb\/.+\.jpe?g\/\d+px-[^/]+$/i.test(clean)) return clean.replace(/\/\d+px-([^/]+)$/, '/960px-$1');
  const commons = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[a-z-]+)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+\.jpe?g)$/i.exec(clean);
  if (commons) return `${commons[1]}/thumb/${commons[2]}/${commons[3]}/960px-${commons[3]}`;
  return `${api}/thumb?${new URLSearchParams({ src: url, w: '800', f: 'jpg' })}`;
}
