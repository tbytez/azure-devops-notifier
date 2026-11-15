import { createStorageState, publicState, isConnected } from './state.js';
import { runPoll } from './sync.js';
import { createHandler } from './handler.js';
import { createApi } from './api.js';
import { createSoundPlayer, AUDIO_TARGET } from './sound.js';

const ALARM_NAME = 'azdo-poll';

function log(...args) {
  console.log('[azdo-notifier]', ...args);
}

async function refreshBadge(chromeApi) {
  try {
    const state = await store.load();
    const pub = publicState(state);
    const unread = pub.unreadCount;
    const hasError = Boolean(pub.errors.global) || Object.keys(pub.errors.items || {}).length > 0;
    await chromeApi.action.setBadgeText({ text: unread > 0 ? String(Math.min(unread, 999)) : hasError ? '!' : '' });
    await chromeApi.action.setBadgeBackgroundColor({ color: hasError && unread === 0 ? '#b45309' : '#0078d4' });
    const parts = ['Azure DevOps Notifier'];
    if (pub.settings.organization) parts.push(`org: ${pub.settings.organization}`);
    if (unread) parts.push(`${unread} unread`);
    if (pub.lastSyncAt) parts.push(`checked ${new Date(pub.lastSyncAt).toLocaleTimeString()}`);
    if (pub.errors.global) parts.push(`error: ${pub.errors.global}`);
    await chromeApi.action.setTitle({ title: parts.join(' — ') });
  } catch (e) {
    log('badge refresh failed', e?.message || e);
  }
}

async function scheduleAlarm(chromeApi) {
  try {
    const state = await store.load();
    const minutes = state.settings?.pollMinutes || 5;
    const existing = await chromeApi.alarms.get(ALARM_NAME);
    if (state.settings?.paused) {
      if (existing) await chromeApi.alarms.clear(ALARM_NAME);
      return;
    }
    if (existing && existing.periodInMinutes === minutes) return;
    if (existing) await chromeApi.alarms.clear(ALARM_NAME);
    await chromeApi.alarms.create(ALARM_NAME, { periodInMinutes: minutes });
  } catch (e) {
    log('alarm schedule failed', e?.message || e);
  }
}

async function hasNotificationPermission(chromeApi) {
  try {
    return await chromeApi.permissions.contains({ permissions: ['notifications'] });
  } catch {
    return false;
  }
}

async function emitDesktopNotification(chromeApi, state, notif) {
  if (!state.settings?.desktopEnabled) return;
  const granted = await hasNotificationPermission(chromeApi);
  if (!granted) return;
  const title = `${notif.title} — ${notif.prTitle || `PR #${notif.prId}`}`;
  const message = [notif.body, notif.repoName, notif.projectName].filter(Boolean).join(' · ').slice(0, 300);
  try {
    await chromeApi.notifications?.create?.(notif.id, {
      type: 'basic',
      iconUrl: chromeApi.runtime.getURL('assets/icons/icon-128.png'),
      title,
      message,
      silent: true,
    });
  } catch {}
}

let store;
let handler;
let notifClickApi = null;

async function onNotificationClicked(id) {
  try {
    const state = await store.load();
    const notif = (state.notifications || []).find((n) => n.id === id);
    if (notif?.url) {
      await chromeApiRef?.tabs?.create?.({ url: notif.url });
    }
    if (notif && !notif.read) {
      await handler.dispatch({ type: 'MARK_READ', ids: [id] });
    }
    await chromeApiRef?.notifications?.clear?.(id);
    await refreshBadge(chromeApiRef);
  } catch (e) {
    log('notification click failed', e?.message || e);
  }
}

let chromeApiRef = null;

function registerNotificationClick(chromeApi) {
  if (notifClickApi === chromeApi) return;
  const ns = chromeApi.notifications;
  if (!ns?.onClicked?.addListener) return;
  ns.onClicked.addListener((id) => { onNotificationClicked(id).catch(() => {}); });
  notifClickApi = chromeApi;
}

function init(chromeApi) {
  chromeApiRef = chromeApi;
  store = createStorageState(chromeApi.storage.local);
  const soundPlayer = createSoundPlayer(chromeApi);
  try {
    const p = chromeApi.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
    p?.catch?.(() => {});
  } catch {}

  const runPollOp = async ({ forced = false } = {}) => {
    const state = await store.load();
    if (!isConnected(state)) return { skipped: 'disconnected', added: [] };
    const emitDesktop = (notif) => emitDesktopNotification(chromeApi, state, notif);
    const result = await runPoll({
      getState: () => store.load(),
      saveState: (s) => store.save(s),
      apiFactory: (s) => createApi(s, globalThis.fetch?.bind(globalThis)),
      emitDesktop,
      emitSound: () => soundPlayer.play(),
      now: Date.now(),
      forced,
    });
    await refreshBadge(chromeApi);
    return result;
  };

  handler = createHandler({
    getState: () => store.load(),
    saveState: (s) => store.save(s),
    runPoll: runPollOp,
    apiFactory: (s) => createApi(s, globalThis.fetch?.bind(globalThis)),
    onStateChanged: async () => {
      await scheduleAlarm(chromeApi);
      await refreshBadge(chromeApi);
    },
    afterMutation: () => refreshBadge(chromeApi),
    hasNotificationPermission: () => hasNotificationPermission(chromeApi),
    playSound: () => soundPlayer.play(),
  });

  chromeApi.runtime.onInstalled.addListener(() => {
    scheduleAlarm(chromeApi).then(() => refreshBadge(chromeApi));
  });
  chromeApi.runtime.onStartup.addListener(() => {
    scheduleAlarm(chromeApi).then(() => refreshBadge(chromeApi));
  });
  chromeApi.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== ALARM_NAME) return;
    handler.enqueue(() => runPollOp({ forced: false })).catch((e) => log('poll failed', e?.message || e));
    refreshBadge(chromeApi);
  });
  chromeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.target === AUDIO_TARGET) return false;
    handler.dispatch(msg).then(sendResponse, (e) => {
      log('message handler error', e?.message || e);
      sendResponse({ ok: false, error: 'Internal error.' });
    });
    return true;
  });
  registerNotificationClick(chromeApi);
  chromeApi.permissions?.onAdded?.addListener?.((details) => {
    if (details?.permissions?.includes?.('notifications')) {
      registerNotificationClick(chromeApi);
    }
  });

  scheduleAlarm(chromeApi).then(() => refreshBadge(chromeApi));
}

const chromeApi = globalThis.chrome;
if (chromeApi?.runtime?.onInstalled && !globalThis.AZDO_EXTENSION_TEST) {
  init(chromeApi);
}

export { init, refreshBadge, scheduleAlarm, ALARM_NAME };
