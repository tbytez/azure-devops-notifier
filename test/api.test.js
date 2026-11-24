import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AzureApi, ApiError, createApi } from '../src/api.js';

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const h = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: h,
    json: async () => body,
  };
}

function makeApi(handler, opts = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  const api = new AzureApi({ organization: 'contoso', token: 'tok123', fetchImpl, timeoutMs: opts.timeoutMs ?? 5000 });
  return { api, calls };
}

test('requests go to dev.azure.com with Basic auth and GET only', async () => {
  const { api, calls } = makeApi(() => jsonResponse({ value: [] }));
  await api.getPullRequest('proj-guid', 'repo-guid', 5);
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.ok(url.startsWith('https://dev.azure.com/contoso/proj-guid/_apis/git/repositories/repo-guid/pullRequests/5'));
  assert.ok(url.includes('api-version=7.1'));
  assert.equal(init.method, 'GET');
  assert.equal(init.redirect, 'error');
  const expected = `Basic ${Buffer.from(':tok123', 'utf8').toString('base64')}`;
  assert.equal(init.headers.Authorization, expected);
});

test('UTF8-safe auth header for non-ascii tokens', async () => {
  const api = new AzureApi({
    organization: 'contoso',
    token: 'päss:wörd',
    fetchImpl: async (url, init) => {
      const expected = `Basic ${Buffer.from(':päss:wörd', 'utf8').toString('base64')}`;
      assert.equal(init.headers.Authorization, expected);
      return jsonResponse({});
    },
  });
  await api.connectionData();
});

test('status errors map to sanitized kinds', async () => {
  for (const [status, kind] of [[401, 'auth'], [403, 'forbidden'], [404, 'notfound'], [429, 'ratelimit'], [500, 'server'], [418, 'http']]) {
    const { api } = makeApi(() => jsonResponse({}, { status }));
    await assert.rejects(() => api.getPullRequest('p', 'r', 1), (e) => e instanceof ApiError && e.kind === kind);
  }
});

test('429 honors Retry-After header', async () => {
  const { api } = makeApi(() => jsonResponse({}, { status: 429, headers: { 'retry-after': '120' } }));
  await assert.rejects(() => api.getPullRequest('p', 'r', 1), (e) => e.kind === 'ratelimit' && e.retryAfterMs === 120000);
});

test('network failure and timeout map to network kind', async () => {
  const { api: apiNet } = makeApi(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(() => apiNet.getPullRequest('p', 'r', 1), (e) => e.kind === 'network');
  const { api: apiSlow } = makeApi((url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      reject(e);
    });
  }), { timeoutMs: 30 });
  await assert.rejects(() => apiSlow.getPullRequest('p', 'r', 1), (e) => e.kind === 'network');
});

test('reviewer discovery uses only the Azure reviewer filter', async () => {
  const { api, calls } = makeApi(() => jsonResponse({ value: [] }));
  await api.listActivePullRequests('proj', 'assigned-user', 'reviewer');
  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get('searchCriteria.reviewerId'), 'assigned-user');
  assert.equal(params.has('searchCriteria.creatorId'), false);
  assert.equal(params.get('searchCriteria.status'), 'active');
});

test('pagination follows $skip for pull requests and $top', async () => {
  const pages = [
    { value: Array.from({ length: 100 }, (_, i) => ({ pullRequestId: i + 1 })) },
    { value: [{ pullRequestId: 101 }] },
  ];
  let i = 0;
  const { api, calls } = makeApi(() => jsonResponse(pages[i++]));
  const prs = await api.listActivePullRequests('proj', 'creator');
  assert.equal(prs.length, 101);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.includes('searchCriteria.creatorId=creator'));
  assert.ok(calls[0].url.includes('searchCriteria.status=active'));
  assert.ok(calls[1].url.includes('skip=100'));
});

test('pagination stops at bound and on short page', async () => {
  const { api, calls } = makeApi(() => jsonResponse({ value: [{ id: 1 }] }));
  const out = await api.getThreads('p', 'r', 1);
  assert.equal(out.length, 1);
  assert.equal(calls.length, 1);
});

test('project listing uses continuation token header', async () => {
  const responses = [
    jsonResponse({ value: [{ id: 'a', name: 'A' }] }, { headers: { 'x-ms-continuationtoken': 'tok2' } }),
    jsonResponse({ value: [{ id: 'b', name: 'B' }] }),
  ];
  let i = 0;
  const { api, calls } = makeApi(() => responses[i++]);
  const projects = await api.listProjects();
  assert.equal(projects.length, 2);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.includes('continuationToken=tok2'));
});

test('policy evaluations use artifactId with project and pr ids', async () => {
  const { api, calls } = makeApi(() => jsonResponse({ value: [] }));
  await api.getPolicyEvaluations('proj-guid', 77);
  const url = calls[0].url;
  assert.ok(url.includes('/_apis/policy/evaluations'));
  assert.ok(url.includes('artifactId=vstfs%3A%2F%2F%2FCodeReview%2FCodeReviewId%2Fproj-guid%2F77'));
});

test('createApi builds from state without exposing token in errors', async () => {
  const api = createApi({ settings: { organization: 'org' }, credentials: { pat: 'secret' } }, async () => jsonResponse({}, { status: 500 }));
  try {
    await api.connectionData();
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(!e.message.includes('secret'));
  }
});

test('requests omit credentials and cover body read under the timeout', async () => {
  const { api, calls } = makeApi(() => jsonResponse({ value: [] }));
  await api.getPullRequest('p', 'r', 1);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');

  let signal = null;
  const slow = new AzureApi({
    organization: 'o', token: 't', timeoutMs: 30,
    fetchImpl: async (url, init) => {
      signal = init.signal;
      return { ok: true, status: 200, headers: new Headers(), json: () => new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        });
      }) };
    },
  });
  await assert.rejects(() => slow.getThreads('p', 'r', 1), (e) => e.kind === 'network');
  assert.ok(signal);
});

test('malformed list responses reject instead of silently returning empty', async () => {
  for (const body of [{}, { value: 'nope' }, { value: null }, null]) {
    const { api } = makeApi(() => jsonResponse(body));
    await assert.rejects(() => api.getThreads('p', 'r', 1), (e) => e.kind === 'http');
    await assert.rejects(() => api.getStatuses('p', 'r', 1), (e) => e.kind === 'http');
    await assert.rejects(() => api.getPolicyEvaluations('p', 1), (e) => e.kind === 'http');
    await assert.rejects(() => api.listActivePullRequests('p', 'c'), (e) => e.kind === 'http');
    await assert.rejects(() => api.listProjects(), (e) => e.kind === 'http');
  }
});

test('pagination exceeding page bound throws instead of truncating', async () => {
  const { api, calls } = makeApi(() => jsonResponse({ value: Array.from({ length: 100 }, (_, i) => ({ id: i })) }));
  await assert.rejects(() => api.getStatuses('p', 'r', 1), (e) => e.kind === 'http' && e.message.includes('pagination'));
  assert.equal(calls.length, 50);
  const { api: api2, calls: calls2 } = makeApi(() => jsonResponse({ value: Array.from({ length: 100 }, (_, i) => ({ pullRequestId: i })) }));
  await assert.rejects(() => api2.listActivePullRequests('p', 'c'), (e) => e.kind === 'http' && e.message.includes('pagination'));
  assert.equal(calls2.length, 50);
});

test('project listing rejects repeated continuation tokens', async () => {
  const responses = [
    jsonResponse({ value: [{ id: 'a' }] }, { headers: { 'x-ms-continuationtoken': 'same' } }),
    jsonResponse({ value: [{ id: 'b' }] }, { headers: { 'x-ms-continuationtoken': 'same' } }),
  ];
  let i = 0;
  const { api } = makeApi(() => responses[i++]);
  await assert.rejects(() => api.listProjects(), (e) => e.kind === 'http' && e.message.includes('repeated'));
});

test('threads endpoint fetches once even with >=100 threads', async () => {
  const threads = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, status: 'active', comments: [] }));
  const { api, calls } = makeApi(() => jsonResponse({ value: threads }));
  const out = await api.getThreads('p', 'r', 1);
  assert.equal(out.length, 150);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].url.includes('skip'));
});

test('statuses and policies paginate with skip until short page', async () => {
  const pages = [
    { value: Array.from({ length: 100 }, (_, i) => ({ id: i })) },
    { value: [{ id: 100 }] },
  ];
  let i = 0;
  const { api, calls } = makeApi(() => jsonResponse(pages[i++]));
  const out = await api.getStatuses('p', 'r', 1);
  assert.equal(out.length, 101);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.includes('skip=100'));
});
