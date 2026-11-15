import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init, ALARM_NAME } from '../src/background.js';

function mockChrome(opts = {}) {
  const listeners = { message: [], alarm: [], installed: [], startup: [], notifClicked: [], permAdded: [] };
  const badge = { text: null, color: null, title: null };
  const alarms = { created: [], cleared: [] };
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
    },
    ...(opts.noOffscreen ? {} : {
      offscreen: {
        createDocument: async () => {},
      },
    }),
    alarms: {
      create: async (name, info) => { alarmMap.set(name, { name, periodInMinutes: info.periodInMinutes }); alarms.created.push({ name, info }); },
      get: async (name) => alarmMap.get(name) || null,
      clear: async (name) => { alarmMap.delete(name); alarms.cleared.push(name); return true; },
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    },
    action: {
      setBadgeText: async ({ text }) => { badge.text = text; },
      setBadgeBackgroundColor: async ({ color }) => { badge.color = color; },
      setTitle: async ({ title }) => { badge.title = title; },
    },
    notifications: opts.noNotifications ? undefined : {
      create: async () => 'nid',
      clear: async () => true,
      onClicked: { addListener: (fn) => listeners.notifClicked.push(fn) },
    },
    permissions: {
      contains: async () => false,
      request: async () => false,
      onAdded: { addListener: (fn) => listeners.permAdded.push(fn) },
    },
    tabs: { create: async () => {} },
  };
  return { api, listeners, badge, alarms, store };
}

test('init registers listeners, sets trusted storage, schedules alarm, answers GET_STATE', async () => {
  const { api, listeners, badge, alarms } = mockChrome();
  init(api);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(listeners.message.length >= 1);
  assert.ok(listeners.alarm.length >= 1);
  assert.ok(listeners.installed.length >= 1);
  assert.ok(listeners.startup.length >= 1);
  assert.ok(listeners.notifClicked.length >= 1);
  assert.ok(alarms.created.some((a) => a.name === ALARM_NAME && a.info.periodInMinutes === 5));
  assert.equal(badge.text, '');

  const res = await new Promise((resolve) => {
    listeners.message[0]({ type: 'GET_STATE' }, {}, resolve);
  });
  assert.equal(res.ok, true);
  assert.equal(res.state.connected, false);
});

test('init works when notifications API is absent (optional permission not granted)', async () => {
  const { api, listeners, alarms } = mockChrome({ noNotifications: true });
  init(api);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(listeners.message.length >= 1);
  assert.ok(alarms.created.some((a) => a.name === ALARM_NAME));
  const res = await new Promise((resolve) => {
    listeners.message[0]({ type: 'GET_STATE' }, {}, resolve);
  });
  assert.equal(res.ok, true);
});

test('alarm fires poll path without throwing when disconnected', async () => {
  const { api, listeners } = mockChrome();
  init(api);
  await new Promise((r) => setTimeout(r, 20));
  assert.doesNotThrow(() => listeners.alarm[0]({ name: ALARM_NAME }));
  assert.doesNotThrow(() => listeners.alarm[0]({ name: 'other' }));
  await new Promise((r) => setTimeout(r, 20));
});

function seedNotifState(store, unread = 2) {
  const s = {
    version: 1,
    settings: { organization: 'contoso', identity: { id: 'u', displayName: 'U' }, selectedProjects: [], autoWatchMine: true, pollMinutes: 5, eventTypes: {}, desktopEnabled: false, paused: false, ignoreSelf: false },
    credentials: { pat: 'x' },
    account: { projects: [], pending: null },
    session: { organization: 'contoso', identityId: 'u' },
    watches: {}, excludedKeys: [], snapshots: {},
    notifications: Array.from({ length: unread }, (_, i) => ({
      id: `n${i}`, key: 'k', category: 'comments', title: 't', body: 'b', prTitle: 'p', repoName: 'r', projectName: 'pr', prId: 1,
      url: 'https://dev.azure.com/contoso/p/_git/r/pullrequest/1', actorName: null, createdAt: 1, read: false, readAt: 0,
    })),
    lastSyncAt: null, sync: { notBefore: 0, failures: 0 }, errors: { global: null, items: {} },
  };
  store.set('azdoNotifier.v1', s);
}

test('badge refreshes after MARK_READ and MARK_ALL_READ without polling', async () => {
  const { api, listeners, badge, store } = mockChrome();
  init(api);
  await new Promise((r) => setTimeout(r, 20));
  seedNotifState(store, 2);
  const mark = await new Promise((resolve) => {
    listeners.message[0]({ type: 'MARK_READ', ids: ['n0'] }, {}, resolve);
  });
  assert.equal(mark.ok, true);
  assert.equal(badge.text, '1');
  const all = await new Promise((resolve) => {
    listeners.message[0]({ type: 'MARK_ALL_READ' }, {}, resolve);
  });
  assert.equal(all.ok, true);
  assert.equal(badge.text, '');
});

test('repeated init does not reset an existing same-interval alarm', async () => {
  const { api, alarms } = mockChrome();
  init(api);
  await new Promise((r) => setTimeout(r, 20));
  init(api);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(alarms.created.filter((a) => a.name === ALARM_NAME).length, 1);
});

test('notification click listener registers when permission granted later, exactly once', async () => {
  const { api, listeners, store } = mockChrome({ noNotifications: true });
  init(api);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(listeners.notifClicked.length, 0);
  const created = [];
  const tabsCreated = [];
  api.notifications = {
    create: async () => 'nid',
    clear: async () => true,
    onClicked: { addListener: (fn) => listeners.notifClicked.push(fn) },
  };
  api.tabs.create = async (o) => { tabsCreated.push(o); };
  for (const fn of listeners.permAdded) fn({ permissions: ['notifications'] });
  for (const fn of listeners.permAdded) fn({ permissions: ['notifications'] });
  assert.equal(listeners.notifClicked.length, 1);
  seedNotifState(store, 1);
  await listeners.notifClicked[0]('n0');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(tabsCreated.length, 1);
  assert.ok(tabsCreated[0].url.includes('pullrequest/1'));
  const saved = store.get('azdoNotifier.v1');
  assert.equal(saved.notifications[0].read, true);
});

test('AUDIO_TARGET messages return false immediately so offscreen keeps the reply', async () => {
  const { api, listeners } = mockChrome();
  init(api);
  await new Promise((r) => setTimeout(r, 20));
  let responded = false;
  const ret = listeners.message[0](
    { target: 'azdo-notifier-audio', type: 'PLAY_NOTIFICATION_SOUND' },
    {},
    () => { responded = true; },
  );
  assert.equal(ret, false);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(responded, false, 'generic dispatcher must not answer offscreen audio messages');
});

test('TEST_SOUND succeeds via offscreen player without mutating settings', async () => {
  const { api, listeners, store } = mockChrome();
  init(api);
  await new Promise((r) => setTimeout(r, 20));
  const res = await new Promise((resolve) => {
    listeners.message[0]({ type: 'TEST_SOUND' }, {}, resolve);
  });
  assert.equal(res.ok, true);
  assert.equal(res.tested, true);
  const saved = store.get('azdoNotifier.v1');
  assert.equal(saved?.settings?.soundEnabled ?? false, false, 'test sound must not enable automatic sound');
});

test('TEST_SOUND fails cleanly when offscreen audio APIs are unavailable', async () => {
  const { api, listeners } = mockChrome({ noOffscreen: true });
  init(api);
  await new Promise((r) => setTimeout(r, 20));
  const res = await new Promise((resolve) => {
    listeners.message[0]({ type: 'TEST_SOUND' }, {}, resolve);
  });
  assert.equal(res.ok, false);
  assert.ok(String(res.error).length > 0);
});
