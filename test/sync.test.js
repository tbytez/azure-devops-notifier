import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPoll } from '../src/sync.js';
import { defaultState, migrateState } from '../src/state.js';
import { watchKey, buildPrWebUrl } from '../src/urls.js';

const NOW = 1700000000000;
const ORG = 'contoso';

function makeWatch(over = {}) {
  const w = {
    key: watchKey({ organization: ORG, projectId: 'p1', repoId: 'r1', prId: 1 }),
    organization: ORG,
    projectId: 'p1',
    projectName: 'Proj',
    repoId: 'r1',
    repoName: 'repo',
    prId: 1,
    url: buildPrWebUrl({ organization: ORG, projectName: 'Proj', repoName: 'repo', prId: 1 }),
    title: 'PR one',
    origin: 'manual',
    eventTypes: null,
    status: 'active',
    isDraft: false,
    addedAt: NOW - 10000,
    ...over,
  };
  return w;
}

function makeState(watches = [], over = {}) {
  const s = defaultState();
  s.settings.organization = ORG;
  s.settings.identity = { id: 'me', displayName: 'Me' };
  s.settings.selectedProjects = [{ id: 'p1', name: 'Proj' }];
  s.credentials.pat = 'pat';
  s.account.projects = [{ id: 'p1', name: 'Proj' }];
  s.session = { organization: ORG, identityId: 'me' };
  for (const w of watches) s.watches[w.key] = w;
  Object.assign(s.settings, over.settings || {});
  return s;
}

function prPayload(over = {}) {
  return {
    pullRequestId: 1,
    title: 'PR one',
    status: 'active',
    isDraft: false,
    targetRefName: 'refs/heads/main',
    reviewers: [],
    lastMergeSourceCommit: { commitId: 'sha-v1' },
    ...over,
  };
}

function makeApi(over = {}) {
  return {
    listActivePullRequests: over.listActivePullRequests || (async () => []),
    getPullRequest: over.getPullRequest || (async () => prPayload()),
    getThreads: over.getThreads || (async () => []),
    getStatuses: over.getStatuses || (async () => []),
    getPolicyEvaluations: over.getPolicyEvaluations || (async () => []),
    getRepository: over.getRepository || (async () => ({ id: 'r1', name: 'repo' })),
  };
}

function harness(state, api, extra = {}) {
  let saved = null;
  return {
    deps: {
      getState: async () => state,
      saveState: async (s) => { saved = s; },
      apiFactory: () => api,
      emitDesktop: extra.emitDesktop || (() => {}),
      emitSound: extra.emitSound,
      now: NOW,
      forced: extra.forced,
    },
    get saved() { return saved; },
  };
}

test('first poll baselines quietly: no notifications for existing activity', async () => {
  const w = makeWatch();
  const state = makeState([w]);
  const api = makeApi({
    getThreads: async () => [{ id: 1, status: 'active', comments: [{ id: 9, content: 'old comment', lastUpdatedDate: '2026-01-01T00:00:00Z', author: { id: 'x', displayName: 'X' }, commentType: 'text' }] }],
    getStatuses: async () => [{ id: 1, context: { genre: 'g', name: 'build' }, state: 'succeeded', creationDate: '2026-01-01T00:00:00Z' }],
  });
  const h = harness(state, api);
  const res = await runPoll(h.deps);
  assert.equal(res.added.length, 0);
  assert.ok(state.snapshots[w.key]);
  assert.equal(state.notifications.length, 0);
});

test('new comment after baseline produces one notification', async () => {
  const w = makeWatch();
  const state = makeState([w]);
  const oldComment = { id: 9, content: 'old', lastUpdatedDate: '2026-01-01T00:00:00Z', author: { id: 'x', displayName: 'X' }, commentType: 'text' };
  const api1 = makeApi({ getThreads: async () => [{ id: 1, status: 'active', comments: [oldComment] }] });
  await runPoll(harness(state, api1).deps);
  const api2 = makeApi({
    getThreads: async () => [{ id: 1, status: 'active', comments: [oldComment, { id: 10, content: 'new!', lastUpdatedDate: '2026-01-02T00:00:00Z', author: { id: 'y', displayName: 'Y' }, commentType: 'text' }] }],
  });
  const res = await runPoll(harness(state, api2).deps);
  assert.equal(res.added.length, 1);
  assert.equal(res.added[0].category, 'comments');
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].id, res.added[0].id);
  assert.equal(res.added[0].url, `${w.url}?_a=overview&discussionId=1`);
});

test('file-context enrichment is quiet; replies and resolved threads keep their exact discussion destination', async () => {
  const w = makeWatch();
  const state = makeState([w]);
  const old = { id: 1, content: 'Old', author: { id: 'other' }, commentType: 'text' };
  let thread = { id: 42, status: 'active', comments: [old] };
  const api = makeApi({ getThreads: async () => [thread] });
  await runPoll(harness(state, api).deps);
  thread = { ...thread, threadContext: { filePath: '/src/a #.ts' } };
  assert.equal((await runPoll(harness(state, api).deps)).added.length, 0);
  thread = { ...thread, comments: [old, { ...old, id: 2, content: 'A reply', parentCommentId: 1 }] };
  const emitted = [];
  const reply = await runPoll(harness(state, api, { emitDesktop: (n) => emitted.push(n) }).deps);
  const expected = `${w.url}?_a=files&discussionId=42&path=%2Fsrc%2Fa+%23.ts`;
  assert.equal(reply.added[0].url, expected);
  assert.equal(state.notifications[0].url, expected);
  assert.equal(emitted[0].url, expected);
  thread = { ...thread, status: 'fixed' };
  const resolved = await runPoll(harness(state, api).deps);
  assert.equal(resolved.added[0].url, expected);
  assert.equal((await runPoll(harness(state, api).deps)).added.length, 0);
});

test('repeat sync does not duplicate notifications', async () => {
  const w = makeWatch();
  const state = makeState([w]);
  let comment = { id: 9, content: 'old', lastUpdatedDate: '2026-01-01T00:00:00Z', author: { id: 'x', displayName: 'X' }, commentType: 'text' };
  const api = makeApi({ getThreads: async () => [{ id: 1, status: 'active', comments: [comment] }] });
  await runPoll(harness(state, api).deps);
  comment = { ...comment, id: 10, content: 'fresh', lastUpdatedDate: '2026-01-03T00:00:00Z' };
  const api2 = makeApi({ getThreads: async () => [{ id: 1, status: 'active', comments: [comment] }] });
  await runPoll(harness(state, api2).deps);
  await runPoll(harness(state, api2).deps);
  assert.equal(state.notifications.length, 1);
});

test('auto discovery adds own active PRs, respects exclusions, skips non-selected projects', async () => {
  const state = makeState([]);
  state.settings.selectedProjects = [{ id: 'p1', name: 'Proj' }, { id: 'p2', name: 'Other' }];
  const discovered = { pullRequestId: 55, title: 'Mine', status: 'active', isDraft: false, repository: { id: 'r9', name: 'repo9' } };
  const api = makeApi({
    listActivePullRequests: async (projectId, identityId, role) => {
      assert.equal(identityId, 'me');
      return projectId === 'p1' && role === 'creator' ? [discovered] : [];
    },
  });
  const res = await runPoll(harness(state, api).deps);
  assert.equal(res.discovered, 1);
  const key = watchKey({ organization: ORG, projectId: 'p1', repoId: 'r9', prId: 55 });
  assert.equal(state.watches[key].origin, 'auto');
  const watchCount = Object.keys(state.watches).length;
  state.excludedKeys.push(key);
  delete state.watches[key];
  await runPoll(harness(state, api).deps);
  assert.equal(Object.keys(state.watches).length, watchCount - 1 + 0);
  assert.equal(state.watches[key], undefined);
});

test('reviewer discovery baselines existing assignments and alerts once for later assignments', async () => {
  let state = makeState([]);
  const assignments = [];
  const emitted = [];
  const api = makeApi({
    listActivePullRequests: async (projectId, identityId, role) => {
      assert.equal(projectId, 'p1');
      assert.equal(identityId, 'me');
      return role === 'reviewer' ? assignments : [];
    },
  });
  const assign = (prId) => assignments.push({ ...prPayload({ pullRequestId: prId }), repository: { id: 'r1', name: 'repo' } });
  const poll = () => runPoll(harness(state, api, { emitDesktop: (n) => emitted.push(n) }).deps);

  assign(1);
  const baseline = await poll();
  assert.equal(baseline.discovered, 1);
  assert.deepEqual(baseline.added, []);
  state = migrateState(state);

  assign(2);
  assign(3);
  const excluded = watchKey({ organization: ORG, projectId: 'p1', repoId: 'r1', prId: 3 });
  state.excludedKeys.push(excluded);
  const result = await poll();
  assert.equal(result.discovered, 1);
  assert.equal(state.watches[excluded], undefined);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].title, 'Review requested');
  assert.equal(result.added[0].category, 'reviewers');
  assert.equal(result.added[0].prId, 2);
  assert.deepEqual(emitted, result.added);
  assert.deepEqual((await poll()).added, []);

  assign(4);
  state.settings.eventTypes.reviewers = false;
  const muted = await poll();
  assert.equal(muted.discovered, 1);
  assert.deepEqual(muted.added, []);
});

test('discovery skipped when autoWatchMine off or no projects', async () => {
  const state = makeState([], { settings: { autoWatchMine: false } });
  let called = 0;
  const api = makeApi({ listActivePullRequests: async () => { called++; return []; } });
  await runPoll(harness(state, api).deps);
  assert.equal(called, 0);
  const state2 = makeState([]);
  state2.settings.selectedProjects = [];
  await runPoll(harness(state2, api).deps);
  assert.equal(called, 0);
});

test('ignoreSelf filters events authored by connected identity', async () => {
  const w = makeWatch();
  const state = makeState([w], { settings: { ignoreSelf: true } });
  await runPoll(harness(state, makeApi()).deps);
  const api2 = makeApi({
    getThreads: async () => [{ id: 1, status: 'active', comments: [{ id: 10, content: 'mine', lastUpdatedDate: '2026-01-02T00:00:00Z', author: { id: 'me', displayName: 'Me' }, commentType: 'text' }, { id: 11, content: 'theirs', lastUpdatedDate: '2026-01-02T00:00:00Z', author: { id: 'other', displayName: 'Other' }, commentType: 'text' }] }],
  });
  const res = await runPoll(harness(state, api2).deps);
  assert.equal(res.added.length, 1);
  assert.equal(res.added[0].actorName, 'Other');
});

test('disabled global category still updates snapshot but emits nothing', async () => {
  const w = makeWatch();
  const state = makeState([w]);
  state.settings.eventTypes.comments = false;
  await runPoll(harness(state, makeApi()).deps);
  const api2 = makeApi({
    getThreads: async () => [{ id: 1, status: 'active', comments: [{ id: 10, content: 'new', lastUpdatedDate: '2026-01-02T00:00:00Z', author: { id: 'x' }, commentType: 'text' }] }],
  });
  const res = await runPoll(harness(state, api2).deps);
  assert.equal(res.added.length, 0);
  assert.ok(state.snapshots[w.key].comments['1:10']);
});

test('per-watch eventTypes override mutes all when empty array', async () => {
  const w = makeWatch({ eventTypes: [] });
  const state = makeState([w]);
  await runPoll(harness(state, makeApi()).deps);
  const api2 = makeApi({
    getPullRequest: async () => prPayload({ status: 'completed' }),
  });
  const res = await runPoll(harness(state, api2).deps);
  assert.equal(res.added.length, 0);
  assert.equal(state.watches[w.key].status, 'completed');
});

test('watch fetch failure is isolated; other watches still sync', async () => {
  const w1 = makeWatch();
  const w2 = makeWatch({ key: watchKey({ organization: ORG, projectId: 'p1', repoId: 'r1', prId: 2 }), prId: 2, title: 'PR two' });
  const state = makeState([w1, w2]);
  await runPoll(harness(state, makeApi()).deps);
  const api2 = makeApi({
    getPullRequest: async (projectId, repoId, prId) => {
      if (prId === 1) { const e = new Error('nope'); e.kind = 'notfound'; throw e; }
      return prPayload({ pullRequestId: 2, status: 'completed' });
    },
    getThreads: async (p, r, prId) => prId === 1 ? (() => { throw new Error('unreachable'); })() : [],
  });
  const res = await runPoll(harness(state, api2).deps);
  assert.ok(state.errors.items[w1.key]);
  assert.equal(state.watches[w2.key].status, 'completed');
  assert.equal(state.errors.global, null);
});

test('total outage sets global error and backoff; forced sync does not bypass backoff', async () => {
  const w = makeWatch();
  const state = makeState([w]);
  await runPoll(harness(state, makeApi()).deps);
  const failing = makeApi({
    getPullRequest: async () => { const e = new Error('down'); e.kind = 'network'; throw e; },
  });
  const res = await runPoll(harness(state, failing).deps);
  assert.ok(state.errors.global);
  assert.ok(state.sync.notBefore > NOW);
  assert.equal(res.skipped, null);
  const res2 = await runPoll(harness(state, failing, { forced: true }).deps);
  assert.equal(res2.skipped, 'backoff');
});

test('paused state skips scheduled poll but forced works', async () => {
  const w = makeWatch();
  const state = makeState([w], { settings: { paused: true } });
  let calls = 0;
  const api = makeApi({ getPullRequest: async () => { calls++; return prPayload(); } });
  const res = await runPoll(harness(state, api).deps);
  assert.equal(res.skipped, 'paused');
  assert.equal(calls, 0);
  await runPoll(harness(state, api, { forced: true }).deps);
  assert.equal(calls, 1);
});

test('disconnected state skips entirely', async () => {
  const state = makeState([]);
  state.credentials.pat = null;
  const res = await runPoll(harness(state, makeApi()).deps);
  assert.equal(res.skipped, 'disconnected');
});

test('merged watched PR is still fetched and status updated', async () => {
  const w = makeWatch({ status: 'active' });
  const state = makeState([w]);
  await runPoll(harness(state, makeApi()).deps);
  const api2 = makeApi({ getPullRequest: async () => prPayload({ status: 'completed' }) });
  const res = await runPoll(harness(state, api2).deps);
  assert.equal(state.watches[w.key].status, 'completed');
  assert.ok(res.added.some((n) => n.category === 'lifecycle'));
});

test('desktop emit receives notifications', async () => {
  const w = makeWatch();
  const state = makeState([w]);
  await runPoll(harness(state, makeApi()).deps);
  const emitted = [];
  const api2 = makeApi({ getPullRequest: async () => prPayload({ status: 'abandoned' }) });
  await runPoll(harness(state, api2, { emitDesktop: (n) => emitted.push(n) }).deps);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].category, 'lifecycle');
});

function rateErr(ms = 60000) {
  const e = new Error('rate limited');
  e.kind = 'ratelimit';
  e.retryAfterMs = ms;
  return e;
}

test('first threads failure then recovery baselines quietly; later new item alerts once', async () => {
  const w = makeWatch();
  const state = makeState([w]);
  const statuses = [{ id: 1, context: { genre: 'g', name: 'build' }, state: 'succeeded', creationDate: '2026-01-01T00:00:00Z' }];
  const policies = [{ evaluationId: 'e1', status: 'approved', configuration: { id: 42, type: { displayName: 'P' } }, completedDate: '2026-01-01T00:00:00Z' }];
  const api1 = makeApi({
    getThreads: async () => { throw new Error('threads down'); },
    getStatuses: async () => statuses,
    getPolicyEvaluations: async () => policies,
  });
  await runPoll(harness(state, api1).deps);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.snapshots[w.key].init.comments, false);
  assert.equal(state.snapshots[w.key].init.checks, true);
  const api2 = makeApi({
    getThreads: async () => [{ id: 1, status: 'active', comments: [{ id: 1, content: 'old', lastUpdatedDate: '2026-01-01T00:00:00Z', author: { id: 'x' }, commentType: 'text' }] }],
    getStatuses: async () => statuses,
    getPolicyEvaluations: async () => policies,
  });
  const res2 = await runPoll(harness(state, api2).deps);
  assert.equal(res2.added.length, 0);
  assert.equal(state.snapshots[w.key].init.comments, true);
  const api3 = makeApi({
    getThreads: async () => [{ id: 1, status: 'active', comments: [
      { id: 1, content: 'old', lastUpdatedDate: '2026-01-01T00:00:00Z', author: { id: 'x' }, commentType: 'text' },
      { id: 2, content: 'new after recovery', lastUpdatedDate: '2026-01-02T00:00:00Z', author: { id: 'y' }, commentType: 'text' },
    ] }],
    getStatuses: async () => statuses,
    getPolicyEvaluations: async () => policies,
  });
  const res3 = await runPoll(harness(state, api3).deps);
  assert.equal(res3.added.length, 1);
  assert.equal(res3.added[0].category, 'comments');
});

test('429 on discovery sets Retry-After backoff; forced sync during cooldown makes zero HTTP', async () => {
  const w = makeWatch();
  const state = makeState([w]);
  let calls = 0;
  const api = makeApi({
    listActivePullRequests: async () => { calls++; throw rateErr(120000); },
    getPullRequest: async () => { calls++; return prPayload(); },
  });
  const res = await runPoll(harness(state, api).deps);
  assert.equal(res.skipped, null);
  assert.ok(state.sync.notBefore >= NOW + 120000);
  assert.ok(state.errors.global.includes('rate limit'));
  calls = 0;
  const res2 = await runPoll(harness(state, api, { forced: true }).deps);
  assert.equal(res2.skipped, 'backoff');
  assert.equal(calls, 0);
});

test('subresource 429 sets notBefore even when PR metadata succeeds', async () => {
  const w = makeWatch();
  const state = makeState([w]);
  await runPoll(harness(state, makeApi()).deps);
  state.sync.notBefore = 0;
  const api = makeApi({
    getStatuses: async () => { throw rateErr(90000); },
  });
  const res = await runPoll(harness(state, api).deps);
  assert.equal(res.skipped, null);
  assert.ok(state.sync.notBefore >= NOW + 90000);
  assert.ok(state.errors.global.includes('rate limit'));
});

test('rate limit stops remaining watch fetches and preserves unattempted snapshots', async () => {
  const watches = [];
  for (let i = 1; i <= 5; i++) {
    watches.push(makeWatch({
      key: watchKey({ organization: ORG, projectId: 'p1', repoId: 'r1', prId: i }),
      prId: i, title: `PR ${i}`,
    }));
  }
  const state = makeState(watches);
  for (const w of watches) state.snapshots[w.key] = { marker: `snap-${w.prId}`, init: {} };
  let prCalls = 0;
  const api = makeApi({
    getPullRequest: async (p, r, prId) => {
      prCalls++;
      if (prId === 1) throw rateErr(30000);
      await new Promise((res) => setTimeout(res, 30));
      return prPayload({ pullRequestId: prId });
    },
  });
  await runPoll(harness(state, api).deps);
  assert.ok(prCalls < 5, `expected fewer than 5 PR fetches, got ${prCalls}`);
  assert.equal(state.snapshots[watches[3].key].marker, 'snap-4');
  assert.equal(state.snapshots[watches[4].key].marker, 'snap-5');
  assert.ok(state.sync.notBefore > NOW);
});

test('desktop emit runs after save and is awaited; save failure emits nothing', async () => {
  const w = makeWatch();
  const state = makeState([w]);
  await runPoll(harness(state, makeApi()).deps);
  const order = [];
  const api2 = makeApi({ getPullRequest: async () => prPayload({ status: 'abandoned' }) });
  const h = harness(state, api2, { emitDesktop: async (n) => { order.push('emit'); } });
  h.deps.saveState = async (s) => { order.push('save'); state.notifications = s.notifications; state.snapshots = s.snapshots; state.errors = s.errors; state.sync = s.sync; };
  const res = await runPoll(h.deps);
  assert.equal(res.added.length, 1);
  assert.deepEqual(order, ['save', 'emit']);

  const state2 = makeState([makeWatch({ key: watchKey({ organization: ORG, projectId: 'p1', repoId: 'r1', prId: 9 }), prId: 9 })]);
  await runPoll(harness(state2, makeApi()).deps);
  let emitted = 0;
  const h2 = harness(state2, makeApi({ getPullRequest: async () => prPayload({ pullRequestId: 9, status: 'completed' }) }), { emitDesktop: () => { emitted++; } });
  h2.deps.saveState = async () => { throw new Error('storage full'); };
  await assert.rejects(() => runPoll(h2.deps));
  assert.equal(emitted, 0);
});

test('ignoreSelf does not hide membership events about self being added as reviewer', async () => {
  const w = makeWatch();
  const state = makeState([w], { settings: { ignoreSelf: true } });
  await runPoll(harness(state, makeApi()).deps);
  const api2 = makeApi({
    getPullRequest: async () => prPayload({
      reviewers: [{ id: 'me', displayName: 'Me', vote: 0, isRequired: false, hasDeclined: false }],
    }),
  });
  const res = await runPoll(harness(state, api2).deps);
  assert.equal(res.added.length, 1);
  assert.equal(res.added[0].category, 'reviewers');
  assert.equal(res.added[0].title, 'Reviewer added');
});

test('main PR failure still records subresource rate-limit Retry-After and backoff blocks sync', async () => {
  const w = makeWatch();
  const state = makeState([w]);
  await runPoll(harness(state, makeApi()).deps);
  state.sync.notBefore = 0;
  state.sync.failures = 0;
  let statusCalls = 0;
  const api = makeApi({
    getPullRequest: async () => {
      const e = new Error('not found');
      e.kind = 'http';
      e.status = 404;
      throw e;
    },
    getStatuses: async () => { statusCalls++; throw rateErr(45000); },
  });
  await runPoll(harness(state, api).deps);
  assert.ok(state.sync.notBefore >= NOW + 45000, `notBefore ${state.sync.notBefore} < ${NOW + 45000}`);
  const callsAtBlock = statusCalls;
  const res2 = await runPoll(harness(state, api).deps);
  assert.equal(res2.skipped, 'backoff');
  assert.equal(statusCalls, callsAtBlock);
});

test('emitSound runs once per batch after save; desktop emit still runs per notification', async () => {
  const w = makeWatch();
  const state = makeState([w], { settings: { soundEnabled: true } });
  await runPoll(harness(state, makeApi()).deps);
  const order = [];
  const emitted = [];
  const api2 = makeApi({
    getPullRequest: async () => prPayload({ status: 'abandoned', reviewers: [{ id: 'r', displayName: 'R', vote: 10, isRequired: false, hasDeclined: false }] }),
  });
  const h = harness(state, api2, {
    emitDesktop: async (n) => { order.push('desktop'); emitted.push(n); },
    emitSound: async () => { order.push('sound'); },
  });
  h.deps.saveState = async (s) => { order.push('save'); state.notifications = s.notifications; state.snapshots = s.snapshots; state.errors = s.errors; state.sync = s.sync; };
  const res = await runPoll(h.deps);
  assert.ok(res.added.length >= 2, `expected >=2 notifications, got ${res.added.length}`);
  assert.equal(order.filter((x) => x === 'sound').length, 1);
  assert.equal(order.filter((x) => x === 'desktop').length, res.added.length);
  assert.ok(order.indexOf('save') < order.indexOf('sound'));
  assert.ok(order.indexOf('sound') < order.lastIndexOf('desktop'));
});

test('emitSound: baseline poll with soundEnabled produces zero sound', async () => {
  const w = makeWatch();
  const state = makeState([w], { settings: { soundEnabled: true } });
  const api = makeApi({
    getThreads: async () => [{ id: 1, status: 'active', comments: [{ id: 9, content: 'old', lastUpdatedDate: '2026-01-01T00:00:00Z', author: { id: 'x' }, commentType: 'text' }] }],
  });
  let sounds = 0;
  await runPoll(harness(state, api, { emitSound: () => { sounds++; } }).deps);
  assert.equal(sounds, 0);
});

test('emitSound: disabled, filtered-out, and desktop-off scenarios', async () => {
  const w = makeWatch();
  const stateOff = makeState([w], { settings: { soundEnabled: false } });
  await runPoll(harness(stateOff, makeApi()).deps);
  let sounds = 0;
  const api2 = makeApi({ getPullRequest: async () => prPayload({ status: 'abandoned' }) });
  await runPoll(harness(stateOff, api2, { emitSound: () => { sounds++; } }).deps);
  assert.equal(sounds, 0, 'soundEnabled=false must not emit');

  const stateFiltered = makeState([w], { settings: { soundEnabled: true } });
  stateFiltered.settings.eventTypes.lifecycle = false;
  await runPoll(harness(stateFiltered, makeApi()).deps);
  sounds = 0;
  await runPoll(harness(stateFiltered, api2, { emitSound: () => { sounds++; } }).deps);
  assert.equal(sounds, 0, 'filtered-out categories must not emit');

  const stateDeskOff = makeState([w], { settings: { soundEnabled: true, desktopEnabled: false } });
  await runPoll(harness(stateDeskOff, makeApi()).deps);
  sounds = 0;
  let desktops = 0;
  const res2 = await runPoll(harness(stateDeskOff, api2, {
    emitSound: () => { sounds++; },
    emitDesktop: () => { desktops++; },
  }).deps);
  assert.equal(sounds, 1, 'sound is independent of desktopEnabled');
  assert.equal(desktops, res2.added.length, 'sync emits desktop per notification; desktopEnabled gating lives in the emit callback');
});

test('emitSound rejection does not drop stored notifications or desktop delivery', async () => {
  const w = makeWatch();
  const state = makeState([w], { settings: { soundEnabled: true } });
  await runPoll(harness(state, makeApi()).deps);
  const api2 = makeApi({ getPullRequest: async () => prPayload({ status: 'abandoned' }) });
  let desktops = 0;
  const res = await runPoll(harness(state, api2, {
    emitSound: async () => { throw new Error('audio blocked'); },
    emitDesktop: () => { desktops++; },
  }).deps);
  assert.equal(res.added.length, 1);
  assert.equal(state.notifications.length, 1);
  assert.equal(desktops, 1);
});

test('emitSound: save failure produces zero sound', async () => {
  const w = makeWatch();
  const state = makeState([w], { settings: { soundEnabled: true } });
  await runPoll(harness(state, makeApi()).deps);
  const api2 = makeApi({ getPullRequest: async () => prPayload({ status: 'abandoned' }) });
  let sounds = 0;
  const h = harness(state, api2, { emitSound: () => { sounds++; } });
  h.deps.saveState = async () => { throw new Error('storage full'); };
  await assert.rejects(() => runPoll(h.deps));
  assert.equal(sounds, 0);
});
