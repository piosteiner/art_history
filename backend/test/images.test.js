// src/admin/images.js thumbUrl: Wikimedia thumbnails at the width a page needs (standard widths only)
const test = require('node:test');
const assert = require('node:assert/strict');
const { thumbUrl } = require('../src/admin/images');

test('a stored 1280 px Commons thumbnail → the width asked for, on either Wikimedia host', () => {
  const u = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Apollo.jpg/1280px-Apollo.jpg';
  assert.equal(thumbUrl(u, 330), 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Apollo.jpg/330px-Apollo.jpg');
  assert.equal(thumbUrl(u.replace('thumb.', 'upload.'), 120), 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Apollo.jpg/120px-Apollo.jpg');
});
test('an original Commons file → its thumbnail; other hosts unchanged', () => {
  assert.equal(thumbUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/Apollo.jpg', 250), 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Apollo.jpg/250px-Apollo.jpg');
  assert.equal(thumbUrl('https://collection.kunstsammlungenakademie.at/multimedia/4/x.large.jpg', 330), 'https://collection.kunstsammlungenakademie.at/multimedia/4/x.large.jpg');
});
