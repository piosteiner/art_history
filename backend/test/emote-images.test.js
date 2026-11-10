// src/admin/emote-images.js: which address the site gets for an emote, and the id read from either kind.
const test = require('node:test');
const assert = require('node:assert');
const { idOf, publicUrl } = require('../src/admin/emote-images');
const config = require('../src/config');

test('7TV pictures are served by our admin host; own images stay as they are', () => {
  assert.strictEqual(publicUrl('https://cdn.7tv.app/emote/01F6MQ33FG000FFJ97ZB8MWV52/2x.webp'), `https://${config.adminHost}/site/emotes/img/01F6MQ33FG000FFJ97ZB8MWV52.webp`);
  assert.strictEqual(publicUrl('https://example.org/own.png'), 'https://example.org/own.png');
});

test('the id comes from a 7TV address or from ours', () => {
  assert.strictEqual(idOf('https://cdn.7tv.app/emote/ABC123/2x.webp'), 'ABC123');
  assert.strictEqual(idOf('https://admin.arthistory.piogino.ch/site/emotes/img/ABC123.webp'), 'ABC123');
  assert.strictEqual(idOf('https://example.org/x.png'), null);
});
