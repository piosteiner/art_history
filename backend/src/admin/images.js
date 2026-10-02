// Image URLs at the size a page needs. Wikimedia Commons serves thumbnails in standard widths (120, 250, 330, 500,
// 960, 1280 … px) — a list needs 120 px (~6 KB) rather than the stored 1280 px (~250 KB). Other hosts: unchanged.
//   …/commons/thumb/b/b5/Name.jpg/1280px-Name.jpg  → …/250px-Name.jpg
//   …/commons/b/b5/Name.jpg (original)             → …/commons/thumb/b/b5/Name.jpg/250px-Name.jpg
const WIKIMEDIA = /^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/(commons|[a-z]+)\//;

function thumbUrl(url, width) {
  if (!url || !WIKIMEDIA.test(url)) return url || null;
  if (/\/thumb\//.test(url) && /\/\d+px-[^/]+$/.test(url)) return url.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`);
  const m = /^(https:\/\/[^/]+\/wikipedia\/[a-z]+)\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+\.(?:jpe?g|png|gif|webp))$/i.exec(url);
  return m ? `${m[1]}/thumb/${m[2]}/${m[3]}/${m[4]}/${width}px-${m[4]}` : url;
}

module.exports = { thumbUrl };
