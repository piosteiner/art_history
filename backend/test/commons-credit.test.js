// src/admin/commons-credit.js: a credit from a Commons description page without machine-readable author
// (cases from the 19 images of 2026-11-13)
const test = require('node:test');
const assert = require('node:assert/strict');
const { creditFromWikitext: c, fillCredit } = require('../src/admin/commons-credit');

test('a {{Creator:…}} in the artist field, an author field with a user link', () => {
  assert.equal(c(' |artist           = {{Creator:Giunta Pisano}}     \n|Source = {{self-scanned}}\n{{PD-Art|PD-old-100-expired}}'), 'Giunta Pisano');
  assert.equal(c('|author=[[User:Someone|Jane Doe]]\n{{cc-by-sa-4.0}}'), 'Jane Doe');
});
test('empty template fields are skipped, a free "Foto:" / "Photograph ©" / "Photographer:" line is read', () => {
  assert.equal(c('*Der Brüggemannaltar (1514-21) im [[:de:Schleswiger Dom|Schleswiger Dom]]\n*Foto: [[:de:Benutzer:Arne List|Arne List]], 31.10.2004\n{{GFDL|migration=relicense}}'), 'Arne List');
  assert.equal(c('| Photograph © [[:en:User:Solipsist|Andrew Dunn]]{{ #if: date |, 9 September 2004.|.}}\n|{{cc-by-sa-2.0-self}}'), 'Andrew Dunn');
  assert.equal(c(' |author = \n |artist = \n* Photographer: [[:de:Benutzer:AlterVista|AlterVista]]\n{{cc-by-sa-3.0}}'), 'AlterVista');
  assert.equal(c('| Artist =\n| Date =\n    Photographie\n| Institution = {{Institution:Bibliothèque interuniversitaire de santé}}\n{{Licence ouverte}}'), 'Bibliothèque interuniversitaire de santé');
});
test('PD-user, own work = the uploader, a museum, nobody named', () => {
  assert.equal(c('{{PD-user-w|en|English wikipedia|Jansamurai}}'), 'Jansamurai');
  assert.equal(c('Ivory artwork\n\nSource: own pictures\n\n{{GFDL|migration=relicense}}', 'Stahlkocher'), 'Stahlkocher');
  assert.equal(c('|uploaded = x\n{{cc-by-sa-4.0-self}}', 'Someone~commonswiki'), 'Someone');
  assert.equal(c(' |artist = \n |institution = {{Institution:Metropolitan Museum of Art}}\n |permission = {{Cc-zero}}'), 'Metropolitan Museum of Art');
  assert.equal(c('{{PD-old}}'), 'Unknown author');
  assert.equal(c('|Author= {{unknown|author}}\n{{PD-old}}'), 'Unknown author');
});
test('no name and no free licence → null; a work known only by its Wikidata item → null, not "Unknown author"', () => {
  assert.equal(c('Plan cavalier de l\'abbaye.\n{{Viollet-le-Duc}}'), null);
  assert.equal(c('{{cc-by-sa-3.0}}'), null);
  assert.equal(c('{{Art Photo\n |wikidata = Q18713070\n |author = \n}}\n{{PD-Art|PD-old-100-expired}}'), null);
});
test('fillCredit keeps a given credit and leaves non-Commons images alone', async () => {
  const v = ['https://x/a.jpg', 'https://commons.wikimedia.org/wiki/File:A.jpg', 'CC0', 'Given', null];
  assert.deepEqual(await fillCredit(v), v);
  const w = ['https://x/a.jpg', 'https://example.org/a', 'CC0', null, null];
  assert.deepEqual(await fillCredit(w), w);
});
