const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {decode} = require('../../frontend/graph_links.js');
const script = fs.readFileSync(require.resolve('../../frontend/landing.js'), 'utf8');
function visit(hash) {
  const redirects = [];
  vm.runInNewContext(script, {URLSearchParams,window:{location:{hash,replace:path=>redirects.push(path)}}});
  return redirects;
}
test('legacy home-page map links preserve the full fragment for graph validation', () => {
  for (const hash of ['#map=%7B%22v%22%3A1%7D', '#map=broken', '#other=value&map=encoded']) {
    assert.deepEqual(visit(hash), ['/connections' + hash]);
  }
});
test('ordinary landing visits and section anchors do not redirect', () => {
  for (const hash of ['', '#main-content', '#entry-heading', '#maple=tree']) assert.deepEqual(visit(hash), []);
});
test('the landing example is a valid graph link with the promised researchers', () => {
  const html = fs.readFileSync(require.resolve('../../frontend/landing.html'), 'utf8');
  const href = html.match(/class="demo-link" href="([^"]+)"/)[1];
  const map = decode(new URL(href, 'https://example.org').hash);
  assert.equal(new URL(href, 'https://example.org').pathname, '/connections');
  assert.deepEqual(map.origins.map(x=>x.id), ['A5108093963','A5086198262']);
  assert.deepEqual(map.edges, ['coauthor']);
});
