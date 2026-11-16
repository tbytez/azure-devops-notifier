import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, normalizeVersion, isNewerVersion, checkLatestRelease, RELEASES_PAGE_URL } from '../src/update.js';
import { migrateState, publicState, defaultState } from '../src/state.js';
import { createHandler } from '../src/handler.js';
import { init, UPDATE_ALARM } from '../src/background.js';

const releaseResponse = (tag = 'v0.2.0', url = `https://github.com/tbytez/azure-devops-notifier/releases/tag/${tag}`) => ({
  ok: true,
  json: async () => ({ tag_name: tag, html_url: url }),
});

test('parseVersion accepts v-prefixed and plain versions', () => {
  assert.deepEqual(parseVersion('v0.1.2'), [0, 1, 2]);
  assert.deepEqual(parseVersion('0.2'), [0, 2, 0]);
  assert.deepEqual(parseVersion('1.0.0'), [1, 0, 0]);
  assert.equal(parseVersion('nope'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(null), null);
});

test('normalizeVersion produces a comparable string', () => {
  assert.equal(normalizeVersion('v0.1.2'), '0.1.2');
  assert.equal(normalizeVersion('0.2'), '0.2.0');
  assert.equal(normalizeVersion('garbage'), null);
});

test('isNewerVersion compares numerically across segments', () => {
  assert.equal(isNewerVersion('0.1.2', '0.1.1'), true);
  assert.equal(isNewerVersion('v0.2.0', '0.1.9'), true);
  assert.equal(isNewerVersion('1.0.0', '0.9.9'), true);
  assert.equal(isNewerVersion('0.1.1', '0.1.1'), false);
  assert.equal(isNewerVersion('0.1.0', '0.1.1'), false);
  assert.equal(isNewerVersion('0.10.0', '0.9.9'), true);
  assert.equal(isNewerVersion('bad', '0.1.1'), false);
  assert.equal(isNewerVersion('0.1.2', ''), false);
});

test('checkLatestRelease returns normalized version and url', async () => {
  const res = await checkLatestRelease(async () => releaseResponse('v0.2.0'));
  assert.equal(res.version, '0.2.0');
  assert.equal(res.url, 'https://github.com/tbytez/azure-devops-notifier/releases/tag/v0.2.0');
});

test('checkLatestRelease falls back to the releases page on hostile urls', async () => {
  const res = await checkLatestRelease(async () => releaseResponse('v0.2.0', 'https://evil.example/steal'));
  assert.equal(res.url, RELEASES_PAGE_URL);
});

test('checkLatestRelease returns null for non-ok or unparseable responses', async () => {
  assert.equal(await checkLatestRelease(async () => ({ ok: false, status: 403 })), null);
  assert.equal(await checkLatestRelease(async () => ({ ok: true, json: async () => ({}) })), null);
  assert.equal(await checkLatestRelease(async () => ({ ok: true, json: async () => { throw new Error('bad'); } })), null);
  assert.equal(await checkLatestRelease(null), null);
});

test('migrateState sanitizes update info and drops hostile urls', () => {
  const s = migrateState({ update: { checkedAt: 5, version: '0.2.0', url: 'https://evil.example/x', available: true } });
  assert.equal(s.update.url, null);
  assert.equal(s.update.available, false);
  const ok = migrateState({ update: { checkedAt: 5, version: '0.2.0', url: 'https://github.com/a/b/releases/tag/v0.2.0', available: true } });
  assert.equal(ok.update.available, true);
  assert.equal(ok.update.version, '0.2.0');
  const missing = migrateState({});
  assert.deepEqual(missing.update, { checkedAt: 0, version: null, url: null, available: false });
});

test('publicState exposes update info without the PAT', () => {
  const s = defaultState();
  s.update = { checkedAt: 7, version: '0.2.0', url: 'https://github.com/a/b/releases/tag/v0.2.0', available: true };
  s.credentials.pat = 'secret';
  const pub = publicState(s);
  assert.equal(pub.update.available, true);
  assert.equal(JSON.stringify(pub).includes('secret'), false);
});

test('CHECK_UPDATES calls the dep and returns its result', async () => {
  let calls = 0;
  const store = { state: defaultState() };
  const h = createHandler({
    getState: async () => store.state,
    saveState: async (s) => { store.state = s; return s; },
    runPoll: async () => ({}),
    checkUpdates: async (opts) => {
      calls += 1;
      assert.equal(opts.forced, true);
      return { update: { checkedAt: 1, version: '0.9.9', url: 'https://github.com/a/b/releases/tag/v0.9.9', available: true } };
    },
  });
  const res = await h.dispatch({ type: 'CHECK_UPDATES' });
  assert.equal(res.ok, true);
  assert.equal(calls, 1);
  assert.equal(res.update.version, '0.9.9');
});

test('CHECK_UPDATES fails cleanly when the dep is unavailable', async () => {
  const store = { state: defaultState() };
  const h = createHandler({
    getState: async () => store.state,
    saveState: async (s) => { store.state = s; return s; },
    runPoll: async () => ({}),
  });
  const res = await h.dispatch({ type: 'CHECK_UPDATES' });
  assert.equal(res.ok, false);
  assert.ok(res.error.length > 0);
});

function mockChrome() {
  const listeners = { message: [], alarm: [], installed: [], startup: [] };
  const alarms = { created: [] };
  const alarmMap = new Map();
  const store = new Map();
  const api = {
    storage: {
      local: {
        async get(key) { return store.has(key) ? { [key]: store.get(key) } : {}; },
        async set(items) { for (const [k, v] of Object.entries(items)) store.set(k, v); },
        setAccessLevel: async () => {},
      },
    },
    runtime: {
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      getURL: (p) => `chrome-extension://test/${p}`,
      getContexts: async () => [],
      sendMessage: async () => ({ ok: true }),
      getManifest: () => ({ version: '0.0.1' }),
    },
    offscreen: { createDocument: async () => {} },
    alarms: {
      create: async (name, info) => { alarmMap.set(name, { name }); alarms.created.push({ name, info }); },
      get: async (name) => alarmMap.get(name) || null,
      clear: async (name) => { alarmMap.delete(name); return true; },
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
      setTitle: async () => {},
    },
    notifications: undefined,
    permissions: { contains: async () => false, onAdded: { addListener: () => {} } },
    tabs: { create: async () => {} },
  };
  return { api, listeners, alarms, store };
}

test('init schedules a 12h update alarm; firing it records the check', async () => {
  const { api, listeners, alarms, store } = mockChrome();
  let fetchCalls = 0;
  init(api, { fetchImpl: async () => { fetchCalls += 1; return releaseResponse('v9.9.9'); } });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(alarms.created.some((a) => a.name === UPDATE_ALARM && a.info.periodInMinutes === 720));

  assert.equal(fetchCalls, 0, 'init alone must not hit the network');
  listeners.alarm[0]({ name: UPDATE_ALARM });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fetchCalls, 1);
  const saved = store.get('azdoNotifier.v1');
  assert.equal(saved.update.version, '9.9.9');
  assert.equal(saved.update.available, true);
  assert.ok(saved.update.checkedAt > 0);
});

test('staleness gate skips refetch within 6h; CHECK_UPDATES forces', async () => {
  const { api, listeners, store } = mockChrome();
  let fetchCalls = 0;
  init(api, { fetchImpl: async () => { fetchCalls += 1; return releaseResponse('v9.9.9'); } });
  await new Promise((r) => setTimeout(r, 20));
  listeners.alarm[0]({ name: UPDATE_ALARM });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fetchCalls, 1);
  listeners.alarm[0]({ name: UPDATE_ALARM });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fetchCalls, 1, 'fresh checkedAt suppresses refetch');
  const res = await new Promise((resolve) => {
    listeners.message[0]({ type: 'CHECK_UPDATES' }, {}, resolve);
  });
  assert.equal(res.ok, true);
  assert.equal(fetchCalls, 2, 'manual check bypasses the staleness gate');
  assert.equal(res.update.version, '9.9.9');
});

test('a failed fetch preserves a previously found update', async () => {
  const { api, listeners, store } = mockChrome();
  const responses = [releaseResponse('v9.9.9'), { ok: false, status: 500 }];
  init(api, { fetchImpl: async () => responses.shift() });
  await new Promise((r) => setTimeout(r, 20));
  listeners.alarm[0]({ name: UPDATE_ALARM });
  await new Promise((r) => setTimeout(r, 30));
  let saved = store.get('azdoNotifier.v1');
  assert.equal(saved.update.available, true);
  const res = await new Promise((resolve) => {
    listeners.message[0]({ type: 'CHECK_UPDATES' }, {}, resolve);
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(res.ok, true);
  saved = store.get('azdoNotifier.v1');
  assert.equal(saved.update.available, true, 'failed recheck must not clear the flag');
  assert.equal(saved.update.version, '9.9.9');
});

test('installed and startup listeners trigger a check', async () => {
  const { api, listeners } = mockChrome();
  let fetchCalls = 0;
  init(api, { fetchImpl: async () => { fetchCalls += 1; return releaseResponse('v9.9.9'); } });
  await new Promise((r) => setTimeout(r, 20));
  listeners.installed[0]();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fetchCalls, 1);
  listeners.startup[0]();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fetchCalls, 1, 'startup within the fresh window does not refetch');
});
