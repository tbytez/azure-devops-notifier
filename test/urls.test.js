import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrUrl, normalizeOrganization, buildPrWebUrl, watchKey } from '../src/urls.js';

test('normalizeOrganization accepts valid slugs and lowercases', () => {
  assert.equal(normalizeOrganization('Contoso'), 'contoso');
  assert.equal(normalizeOrganization('my-org-1'), 'my-org-1');
  assert.equal(normalizeOrganization(''), null);
  assert.equal(normalizeOrganization('bad_org'), null);
  assert.equal(normalizeOrganization('a'.repeat(60)), null);
  assert.equal(normalizeOrganization(null), null);
});

test('parsePrUrl accepts canonical URL', () => {
  const r = parsePrUrl('https://dev.azure.com/contoso/My%20Project/_git/webapp/pullrequest/42');
  assert.equal(r.ok, true);
  assert.equal(r.organization, 'contoso');
  assert.equal(r.projectName, 'My Project');
  assert.equal(r.repoName, 'webapp');
  assert.equal(r.prId, 42);
  assert.equal(r.canonicalUrl, 'https://dev.azure.com/contoso/My%20Project/_git/webapp/pullrequest/42');
});

test('parsePrUrl tolerates query and fragment, case-insensitive pullrequest', () => {
  const r = parsePrUrl('https://dev.azure.com/CONTOSO/proj/_git/repo/PULLREQUEST/7?foo=bar#baz');
  assert.equal(r.ok, true);
  assert.equal(r.organization, 'contoso');
  assert.equal(r.prId, 7);
});

test('parsePrUrl accepts legacy visualstudio.com host and normalizes', () => {
  const r = parsePrUrl('https://contoso.visualstudio.com/proj/_git/repo/pullrequest/9');
  assert.equal(r.ok, true);
  assert.equal(r.organization, 'contoso');
  assert.equal(r.canonicalUrl.startsWith('https://dev.azure.com/contoso/'), true);
});

test('parsePrUrl rejects non-https, userinfo, port, wrong host', () => {
  assert.equal(parsePrUrl('http://dev.azure.com/o/p/_git/r/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('https://user:pass@dev.azure.com/o/p/_git/r/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com:8443/o/p/_git/r/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com.evil.com/o/p/_git/r/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('https://github.com/o/p/_git/r/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('not a url').ok, false);
});

test('parsePrUrl rejects traversal, encoded separators, malformed paths', () => {
  assert.equal(parsePrUrl('https://dev.azure.com/o/../_git/r/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com/o/p/_git/r/pullrequest/1/extra').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com/o/p/_git/r/pullrequest/abc').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com/o/p/_git/r/pullrequest/0').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com/o/p/_git/%2e%2e/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com/o/p/_git/a%2Fb/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com/o/p/_git/r/pullrequest/1%2f..%2f2').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com/o/p/_git/r/pullrequests/1').ok, false);
});

test('parsePrUrl handles spaces and XSS-looking names safely', () => {
  const r = parsePrUrl('https://dev.azure.com/o/my%20proj/_git/repo/pullrequest/5');
  assert.equal(r.ok, true);
  assert.equal(r.projectName, 'my proj');
  const x = parsePrUrl('https://dev.azure.com/o/%3Cscript%3E/_git/repo/pullrequest/5');
  assert.equal(x.ok, true);
  assert.equal(x.projectName, '<script>');
  assert.ok(!x.canonicalUrl.includes('<'));
});

test('buildPrWebUrl and watchKey are canonical', () => {
  const u = buildPrWebUrl({ organization: 'Contoso', projectName: 'My Proj', repoName: 'r epo', prId: 3 });
  assert.equal(u, 'https://dev.azure.com/contoso/My%20Proj/_git/r%20epo/pullrequest/3');
  const k1 = watchKey({ organization: 'Contoso', projectId: 'P1', repoId: 'R1', prId: 5 });
  const k2 = watchKey({ organization: 'contoso', projectId: 'p1', repoId: 'r1', prId: '5' });
  assert.equal(k1, k2);
});

test('parsePrUrl rejects nested subdomains on legacy host', () => {
  assert.equal(parsePrUrl('https://a.b.contoso.visualstudio.com/p/_git/r/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('https://contoso.visualstudio.com.evil.com/p/_git/r/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('https://deep.sub.contoso.visualstudio.com/p/_git/r/pullrequest/1').ok, false);
});

test('parsePrUrl rejects traversal that URL normalization would hide', () => {
  assert.equal(parsePrUrl('https://dev.azure.com/o/../p/_git/r/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com/o/p/_git/r/pullrequest/1/../2').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com/o/p/_git/r/pullrequest/%2e%2e/5').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com/o/p/_git/%2E%2E/r/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com/o/p/_git/r/pullrequest/1/.').ok, false);
});

test('parsePrUrl rejects backslashes and doubled separators', () => {
  assert.equal(parsePrUrl('https://dev.azure.com/o\\p\\_git\\r\\pullrequest\\1').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com/o//p/_git/r/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com//o/p/_git/r/pullrequest/1').ok, false);
  assert.equal(parsePrUrl('https://dev.azure.com/o/p//_git/r/pullrequest/1').ok, false);
});

test('parsePrUrl still accepts trailing slash and legacy exact host', () => {
  const r = parsePrUrl('https://dev.azure.com/o/p/_git/r/pullrequest/1/');
  assert.equal(r.ok, true);
  assert.equal(r.prId, 1);
  const l = parsePrUrl('https://contoso.visualstudio.com/p/_git/r/pullrequest/2');
  assert.equal(l.ok, true);
  assert.equal(l.organization, 'contoso');
});
