import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/handler.js';
import { createStorageState, defaultState, migrateState, publicState } from '../src/state.js';
import { watchKey } from '../src/urls.js';

function memStorage() {
  const map = new Map();
  return {
    async get(key) { return map.has(key) ? { [key]: map.get(key) } : {}; },
    async set(items) { for (const [k, v] of Object.entries(items)) map.set(k, v); },
    _map: map,
  };
}

const PROJECTS = [
  { id: 'p1', name: 'Alpha' },
  { id: 'p2', name: 'Beta' },
];

function mockApi(over = {}) {
  return {
    connectionData: over.connectionData || (async () => ({ authenticatedUser: { id: 'uid-1', providerDisplayName: 'Test User', uniqueName: 't@x.com' } })),
    listProjects: over.listProjects || (async () => PROJECTS.map((p) => ({ ...p }))),
    getRepository: over.getRepository || (async (projectId, name) => ({ id: `repo-${name}`, name: String(name), project: { id: projectId } })),
    getPullRequest: over.getPullRequest || (async (projectId, repoId, prId) => ({
      pullRequestId: prId, title: 'PR', status: 'active', isDraft: false,
      targetRefName: 'refs/heads/main', reviewers: [], lastMergeSourceCommit: { commitId: 's' },
    })),
    getThreads: async () => [],
    getStatuses: async () => [],
    getPolicyEvaluations: async () => [],
    listActivePullRequests: async () => [],
  };
}

function harness(over = {}) {
  const storage = memStorage();
  const store = createStorageState(storage);
  const polls = [];
  let api = over.api || mockApi();
  const handler = createHandler({
    getState: () => store.load(),
    saveState: (s) => store.save(s),
    runPoll: async (opts) => { polls.push(opts); return { skipped: null, added: [] }; },
    apiFactory: () => api,
    onStateChanged: over.onStateChanged || (async () => {}),
    hasNotificationPermission: async () => false,
    playSound: over.playSound,
    now: () => 1700000000000,
  });
  return { handler, store, storage, polls, setApi: (a) => { api = a; } };
}

async function connect(h, projectIds = ['p1']) {
  const c = await h.handler.dispatch({ type: 'CONNECT', organization: 'Contoso', token: 'tok' });
  assert.equal(c.ok, true, JSON.stringify(c));
  const f = await h.handler.dispatch({ type: 'CONFIRM_CONNECT', projectIds });
  assert.equal(f.ok, true, JSON.stringify(f));
}

test('GET_STATE never exposes the PAT', async () => {
  const h = harness();
  await connect(h);
  const res = await h.handler.dispatch({ type: 'GET_STATE' });
  assert.equal(res.ok, true);
  const json = JSON.stringify(res.state);
  assert.ok(!json.includes('tok'));
  assert.ok(!json.includes('pat'));
  assert.equal(res.state.connected, true);
  assert.equal(res.state.settings.organization, 'contoso');
  assert.equal(res.state.settings.identity.displayName, 'Test User');
});

test('CONNECT validates org and token before calling API', async () => {
  const h = harness();
  const bad = await h.handler.dispatch({ type: 'CONNECT', organization: 'bad_org!', token: 'x' });
  assert.equal(bad.ok, false);
  const badTok = await h.handler.dispatch({ type: 'CONNECT', organization: 'contoso', token: 'has space' });
  assert.equal(badTok.ok, false);
});

test('CONNECT surfaces sanitized API errors', async () => {
  const h = harness({
    api: mockApi({
      connectionData: async () => { const e = new Error('Azure DevOps rejected the credentials (401).'); e.kind = 'auth'; throw e; },
    }),
  });
  const res = await h.handler.dispatch({ type: 'CONNECT', organization: 'contoso', token: 'bad' });
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('401') || res.error.toLowerCase().includes('credential'));
});

test('CONFIRM_CONNECT with same org+identity preserves watches', async () => {
  const h = harness();
  await connect(h);
  const key = watchKey({ organization: 'contoso', projectId: 'p1', repoId: 'r1', prId: 1 });
  let state = await h.store.load();
  state.watches[key] = { key, organization: 'contoso', projectId: 'p1', projectName: 'Alpha', repoId: 'r1', repoName: 'r', prId: 1, url: 'u', title: 't', origin: 'manual', eventTypes: null, status: 'active', isDraft: false, addedAt: 1 };
  state.notifications = [{ id: 'n1', key, category: 'comments', title: 't', body: 'b', prTitle: '', repoName: 'r', projectName: 'p', prId: 1, url: 'u', actorName: null, createdAt: 1, read: false, readAt: 0 }];
  await h.store.save(state);
  await h.handler.dispatch({ type: 'DISCONNECT' });
  await connect(h);
  state = await h.store.load();
  assert.ok(state.watches[key], 'watch should survive same-account reconnect');
  assert.equal(state.notifications.length, 1);
});

test('CONFIRM_CONNECT with different org resets scoped data', async () => {
  const h = harness();
  await connect(h);
  const s0 = await h.store.load();
  const key = watchKey({ organization: 'contoso', projectId: 'p1', repoId: 'r1', prId: 9 });
  s0.watches[key] = { key, organization: 'contoso', projectId: 'p1', projectName: 'Alpha', repoId: 'r1', repoName: 'r', prId: 9, url: 'u', title: 't', origin: 'manual', eventTypes: null, status: 'active', isDraft: false, addedAt: 1 };
  s0.snapshots[key] = { comments: { '1': {} } };
  s0.notifications = [{ id: 'n', key, category: 'comments', title: 't', body: 'b', prTitle: '', repoName: 'r', projectName: 'p', prId: 9, url: 'u', actorName: null, createdAt: 1, read: false, readAt: 0 }];
  s0.excludedKeys = [key];
  await h.store.save(s0);
  const otherApi = mockApi({
    connectionData: async () => ({ authenticatedUser: { id: 'uid-2', providerDisplayName: 'Other', uniqueName: 'o@x.com' } }),
  });
  h.setApi(otherApi);
  const c = await h.handler.dispatch({ type: 'CONNECT', organization: 'otherorg', token: 'tok2' });
  assert.equal(c.ok, true);
  const f = await h.handler.dispatch({ type: 'CONFIRM_CONNECT', projectIds: ['p1'] });
  assert.equal(f.ok, true);
  const state = await h.store.load();
  assert.equal(state.settings.organization, 'otherorg');
  assert.equal(Object.keys(state.watches).length, 0);
  assert.equal(Object.keys(state.snapshots).length, 0);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.excludedKeys.length, 0);
});

test('DISCONNECT clears credentials but keeps organization preference', async () => {
  const h = harness();
  await connect(h);
  await h.handler.dispatch({ type: 'DISCONNECT' });
  const res = await h.handler.dispatch({ type: 'GET_STATE' });
  assert.equal(res.state.connected, false);
  assert.equal(res.state.settings.organization, 'contoso');
  const state = await h.store.load();
  assert.equal(state.credentials.pat, null);
  assert.equal(state.settings.identity, null);
});

test('WATCH_PR rejects bad URLs and wrong org', async () => {
  const h = harness();
  await connect(h);
  const bad = await h.handler.dispatch({ type: 'WATCH_PR', url: 'https://evil.com/o/p/_git/r/pullrequest/1' });
  assert.equal(bad.ok, false);
  const wrongOrg = await h.handler.dispatch({ type: 'WATCH_PR', url: 'https://dev.azure.com/other/p/_git/r/pullrequest/1' });
  assert.equal(wrongOrg.ok, false);
  const spoof = await h.handler.dispatch({ type: 'WATCH_PR', url: 'https://dev.azure.com/contoso/Alpha/_git/r/pullrequest/1/extra' });
  assert.equal(spoof.ok, false);
});

test('WATCH_PR adds canonical watch and triggers poll', async () => {
  const h = harness();
  await connect(h);
  const res = await h.handler.dispatch({ type: 'WATCH_PR', url: 'https://dev.azure.com/contoso/Alpha/_git/webapp/pullrequest/42' });
  assert.equal(res.ok, true, JSON.stringify(res));
  const state = await h.store.load();
  const w = Object.values(state.watches)[0];
  assert.equal(w.prId, 42);
  assert.equal(w.repoId, 'repo-webapp');
  assert.equal(w.origin, 'manual');
  assert.ok(w.url.startsWith('https://dev.azure.com/contoso/'));
  assert.ok(h.polls.length >= 1);
});

test('UPDATE_WATCH validates eventTypes override', async () => {
  const h = harness();
  await connect(h);
  await h.handler.dispatch({ type: 'WATCH_PR', url: 'https://dev.azure.com/contoso/Alpha/_git/webapp/pullrequest/42' });
  const state0 = await h.store.load();
  const key = Object.keys(state0.watches)[0];
  const bad = await h.handler.dispatch({ type: 'UPDATE_WATCH', key, eventTypes: ['bogus'] });
  assert.equal(bad.ok, false);
  const ok1 = await h.handler.dispatch({ type: 'UPDATE_WATCH', key, eventTypes: [] });
  assert.equal(ok1.ok, true);
  let s = await h.store.load();
  assert.deepEqual(s.watches[key].eventTypes, []);
  const ok2 = await h.handler.dispatch({ type: 'UPDATE_WATCH', key, eventTypes: null });
  assert.equal(ok2.ok, true);
  s = await h.store.load();
  assert.equal(s.watches[key].eventTypes, null);
});

test('UNWATCH_PR removes watch, snapshot and records exclusion', async () => {
  const h = harness();
  await connect(h);
  await h.handler.dispatch({ type: 'WATCH_PR', url: 'https://dev.azure.com/contoso/Alpha/_git/webapp/pullrequest/42' });
  const s0 = await h.store.load();
  const key = Object.keys(s0.watches)[0];
  s0.snapshots[key] = { comments: {} };
  await h.store.save(s0);
  const res = await h.handler.dispatch({ type: 'UNWATCH_PR', key });
  assert.equal(res.ok, true);
  const s = await h.store.load();
  assert.equal(s.watches[key], undefined);
  assert.equal(s.snapshots[key], undefined);
  assert.ok(s.excludedKeys.includes(key));
});

test('MARK_READ and MARK_ALL_READ update flags', async () => {
  const h = harness();
  await connect(h);
  const s0 = await h.store.load();
  s0.notifications = [
    { id: 'a', key: 'k', category: 'comments', title: 't', body: 'b', prTitle: '', repoName: 'r', projectName: 'p', prId: 1, url: 'u', actorName: null, createdAt: 1, read: false, readAt: 0 },
    { id: 'b', key: 'k', category: 'checks', title: 't', body: 'b', prTitle: '', repoName: 'r', projectName: 'p', prId: 1, url: 'u', actorName: null, createdAt: 2, read: false, readAt: 0 },
  ];
  await h.store.save(s0);
  await h.handler.dispatch({ type: 'MARK_READ', ids: ['a'] });
  let s = await h.store.load();
  assert.equal(s.notifications.find((n) => n.id === 'a').read, true);
  assert.equal(s.notifications.find((n) => n.id === 'b').read, false);
  await h.handler.dispatch({ type: 'MARK_ALL_READ' });
  s = await h.store.load();
  assert.ok(s.notifications.every((n) => n.read));
});

test('SAVE_SETTINGS rejects unknown fields and bad values', async () => {
  const h = harness();
  await connect(h);
  const bad = await h.handler.dispatch({ type: 'SAVE_SETTINGS', settings: { evil: true } });
  assert.equal(bad.ok, false);
  const badPoll = await h.handler.dispatch({ type: 'SAVE_SETTINGS', settings: { pollMinutes: 3 } });
  assert.equal(badPoll.ok, false);
  const good = await h.handler.dispatch({ type: 'SAVE_SETTINGS', settings: { pollMinutes: 2, paused: true, autoWatchMine: false } });
  assert.equal(good.ok, true);
  const s = await h.store.load();
  assert.equal(s.settings.pollMinutes, 2);
  assert.equal(s.settings.paused, true);
});

test('mutations serialize with polling: no lost updates', async () => {
  const h = harness();
  await connect(h);
  const s0 = await h.store.load();
  s0.notifications = [{ id: 'x', key: 'k', category: 'comments', title: 't', body: 'b', prTitle: '', repoName: 'r', projectName: 'p', prId: 1, url: 'u', actorName: null, createdAt: 1, read: false, readAt: 0 }];
  await h.store.save(s0);
  let releasePoll;
  const gate = new Promise((r) => { releasePoll = r; });
  h.handler = createHandler({
    getState: () => h.store.load(),
    saveState: (s) => h.store.save(s),
    runPoll: async () => { await gate; return { skipped: null, added: [{ id: 'new-n' }] }; },
    apiFactory: () => mockApi(),
    onStateChanged: async () => {},
    hasNotificationPermission: async () => false,
    now: () => 1,
  });
  const syncP = h.handler.dispatch({ type: 'SYNC_NOW' });
  const markP = h.handler.dispatch({ type: 'MARK_READ', ids: ['x'] });
  releasePoll();
  await Promise.all([syncP, markP]);
  const s = await h.store.load();
  assert.equal(s.notifications.find((n) => n.id === 'x').read, true);
});

test('publicState shape has no credentials or pending PAT', () => {
  const s = defaultState();
  s.credentials.pat = 'sekrit';
  s.account.pending = { pat: 'sekrit2', identity: { id: 'i' }, projects: [] };
  const pub = publicState(s);
  const json = JSON.stringify(pub);
  assert.ok(!json.includes('sekrit'));
  assert.equal(pub.connected, false);
});

test('migrateState drops malformed watches and caps notifications', () => {
  const raw = defaultState();
  raw.watches = { good: { key: 'g', prId: 1 }, bad: null, bad2: { nope: 1 } };
  raw.notifications = Array.from({ length: 400 }, (_, i) => ({ id: `n${i}`, category: 'comments', title: 't', createdAt: i }));
  const s = migrateState(raw);
  assert.equal(Object.keys(s.watches).length, 1);
  assert.equal(s.notifications.length, 300);
});

test('WATCH_PR duplicate add is idempotent: retains prefs, snapshot, origin, addedAt', async () => {
  const h = harness();
  await connect(h);
  const url = 'https://dev.azure.com/contoso/Alpha/_git/webapp/pullrequest/42';
  const first = await h.handler.dispatch({ type: 'WATCH_PR', url });
  assert.equal(first.ok, true);
  assert.equal(first.existed, false);
  const s0 = await h.store.load();
  const key = Object.keys(s0.watches)[0];
  s0.watches[key].eventTypes = ['comments'];
  s0.watches[key].origin = 'auto';
  s0.watches[key].addedAt = 12345;
  s0.snapshots[key] = { sentinel: true };
  await h.store.save(s0);
  h.setApi(mockApi({
    getRepository: async () => { throw new Error('must not be called for duplicate'); },
    getPullRequest: async () => { throw new Error('must not be called for duplicate'); },
  }));
  const res = await h.handler.dispatch({ type: 'WATCH_PR', url });
  assert.equal(res.ok, true);
  assert.equal(res.existed, true);
  assert.equal(res.key, key);
  const s = await h.store.load();
  assert.deepEqual(s.watches[key].eventTypes, ['comments']);
  assert.equal(s.watches[key].origin, 'auto');
  assert.equal(s.watches[key].addedAt, 12345);
  assert.deepEqual(s.snapshots[key], { sentinel: true });
});

test('afterMutation runs on successful mutations but not GET_STATE or failures', async () => {
  const calls = [];
  const storage = memStorage();
  const store = createStorageState(storage);
  const handler = createHandler({
    getState: () => store.load(),
    saveState: (s) => store.save(s),
    runPoll: async () => ({ skipped: null, added: [] }),
    apiFactory: () => mockApi(),
    afterMutation: async () => { calls.push('mutated'); },
    hasNotificationPermission: async () => false,
    now: () => 1,
  });
  await handler.dispatch({ type: 'GET_STATE' });
  assert.equal(calls.length, 0);
  await connect(handlerHarness(handler));
  assert.ok(calls.length >= 2);
  const before = calls.length;
  await handler.dispatch({ type: 'MARK_READ', ids: ['nope'] });
  assert.equal(calls.length, before + 1);
  await handler.dispatch({ type: 'SAVE_SETTINGS', settings: { bogus: 1 } });
  assert.equal(calls.length, before + 1);
});

function handlerHarness(handler) {
  return { handler };
}

test('storage read failure propagates and never triggers a write', async () => {
  let writes = 0;
  const storage = {
    async get() { throw new Error('denied'); },
    async set() { writes++; },
  };
  const store = createStorageState(storage);
  await assert.rejects(() => store.load(), /denied/);
  await assert.rejects(() => store.update(async () => {}), /denied/);
  assert.equal(writes, 0);
});

test('CONFIRM_CONNECT accepts optional desktopEnabled and preserves pref when omitted', async () => {
  const h = harness();
  await h.handler.dispatch({ type: 'CONNECT', organization: 'Contoso', token: 'tok' });
  const r1 = await h.handler.dispatch({ type: 'CONFIRM_CONNECT', projectIds: ['p1'], desktopEnabled: true });
  assert.equal(r1.ok, true);
  let s = await h.store.load();
  assert.equal(s.settings.desktopEnabled, true);

  const h2 = harness();
  await h2.handler.dispatch({ type: 'CONNECT', organization: 'Contoso', token: 'tok' });
  const r2 = await h2.handler.dispatch({ type: 'CONFIRM_CONNECT', projectIds: ['p1'] });
  assert.equal(r2.ok, true);
  s = await h2.store.load();
  assert.equal(s.settings.desktopEnabled, true);
});

test('CONFIRM_CONNECT desktopEnabled false persists; invalid value rejected without reset', async () => {
  const h = harness();
  await h.handler.dispatch({ type: 'CONNECT', organization: 'Contoso', token: 'tok' });
  const bad = await h.handler.dispatch({ type: 'CONFIRM_CONNECT', projectIds: ['p1'], desktopEnabled: 'yes' });
  assert.equal(bad.ok, false);
  let s = await h.store.load();
  assert.ok(s.account.pending, 'pending must survive rejected confirm');
  assert.equal(s.session.organization, null);
  const r = await h.handler.dispatch({ type: 'CONFIRM_CONNECT', projectIds: ['p1'], desktopEnabled: false });
  assert.equal(r.ok, true);
  s = await h.store.load();
  assert.equal(s.settings.desktopEnabled, false);
});

test('SAVE_SETTINGS persists soundEnabled true and false; rejects invalid values', async () => {
  const h = harness();
  await connect(h);
  const r1 = await h.handler.dispatch({ type: 'SAVE_SETTINGS', settings: { soundEnabled: true } });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  let s = await h.store.load();
  assert.equal(s.settings.soundEnabled, true);
  const r2 = await h.handler.dispatch({ type: 'SAVE_SETTINGS', settings: { soundEnabled: false } });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  s = await h.store.load();
  assert.equal(s.settings.soundEnabled, false);
  const bad = await h.handler.dispatch({ type: 'SAVE_SETTINGS', settings: { soundEnabled: 'yes' } });
  assert.equal(bad.ok, false);
  s = await h.store.load();
  assert.equal(s.settings.soundEnabled, false, 'invalid value must not persist');
  const pub = publicState(s);
  assert.equal(pub.settings.soundEnabled, false);
});

test('TEST_SOUND: missing hook fails, rejection fails, success does not mutate state', async () => {
  const hNoHook = harness();
  await connect(hNoHook);
  const before = await hNoHook.store.load();
  const missing = await hNoHook.handler.dispatch({ type: 'TEST_SOUND' });
  assert.equal(missing.ok, false);
  assert.ok(missing.error);
  const after = await hNoHook.store.load();
  assert.equal(after.settings.soundEnabled, before.settings.soundEnabled);
  assert.equal(after.notifications.length, before.notifications.length);

  const hFail = harness({ playSound: async () => { throw new Error('no audio device'); } });
  await connect(hFail);
  const fail = await hFail.handler.dispatch({ type: 'TEST_SOUND' });
  assert.equal(fail.ok, false);
  assert.ok(String(fail.error).length > 0);

  let plays = 0;
  const hOk = harness({ playSound: async () => { plays++; } });
  await connect(hOk);
  const beforeOk = await hOk.store.load();
  const okRes = await hOk.handler.dispatch({ type: 'TEST_SOUND' });
  assert.equal(okRes.ok, true);
  assert.equal(plays, 1);
  const afterOk = await hOk.store.load();
  assert.equal(afterOk.settings.soundEnabled, beforeOk.settings.soundEnabled);
  assert.equal(afterOk.notifications.length, beforeOk.notifications.length);
  assert.equal(afterOk.watches && Object.keys(afterOk.watches).length, Object.keys(beforeOk.watches).length);
});
