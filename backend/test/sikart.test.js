// SIKART's biographical note → life data (src/admin/sikart.js); the link → the number (src/admin/identifiers.js)
const test = require('node:test');
const assert = require('node:assert');
const { lifeData } = require('../src/admin/sikart');
const { numberFrom } = require('../src/admin/identifiers');

test('dates and places from the note', () => {
  assert.deepStrictEqual(lifeData('∗ 14.3.1853 Bern,\n† 19.5.1918 Genf'),
    { birth: { value: '1853-03-14', place: 'Bern' }, death: { value: '1918-05-19', place: 'Genf' } });
  assert.deepStrictEqual(lifeData('∗ 3.1887 Zürich'), { birth: { value: '1887-03', place: 'Zürich' } });
  assert.deepStrictEqual(lifeData('∗ um 1600 Basel,\n† 1661'), { birth: { value: 'c. 1600', place: 'Basel' }, death: { value: '1661', place: null } });
  assert.deepStrictEqual(lifeData(''), {});
});

test('the number from a SIKART link', () => {
  assert.strictEqual(numberFrom('sikart', 'https://recherche.sik-isea.ch/sik:person-4000055/in/sikart'), '4000055');
  assert.strictEqual(numberFrom('sikart', 'https://www.sikart.ch/KuenstlerInnen.aspx?id=4000055'), '4000055');
  assert.strictEqual(numberFrom('sikart', '4000055'), '4000055');
});
