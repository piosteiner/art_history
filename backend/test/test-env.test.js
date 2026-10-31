// The test environment (scripts/test-env.sh): the CMS shows a notice when TEST_ENV=1 — and only then
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { layout, html } = require('../src/admin/html');

test('layout: the test environment notice only with config.testEnv', () => {
  const page = () => String(layout({ title: 'T', user: null, body: html`<p>x</p>`, nav: false }));
  const before = config.testEnv;
  try {
    config.testEnv = false;
    assert.doesNotMatch(page(), /class="test-env"/);
    config.testEnv = true;
    assert.match(page(), /class="test-env" role="note"><b>Test environment<\/b>/);
    assert.match(page(), /href="https:\/\/test\.arthistory\.piogino\.ch">test site</);
  } finally { config.testEnv = before; }
});
