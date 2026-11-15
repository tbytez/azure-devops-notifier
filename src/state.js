import { CATEGORIES } from './core.js';

export const STATE_KEY = 'azdoNotifier.v1';
export const NOTIFICATION_LIMIT = 300;

export function defaultEventTypes() {
  return Object.fromEntries(CATEGORIES.map((c) => [c, true]));
}

export function defaultState() {
  return {
    version: 1,
    settings: {
      organization: null,
      identity: null,
      selectedProjects: [],
      autoWatchMine: true,
      pollMinutes: 5,
      eventTypes: defaultEventTypes(),
      desktopEnabled: true,
      soundEnabled: false,
      paused: false,
      ignoreSelf: false,
    },
    credentials: { pat: null },
    account: {
      projects: [],
      pending: null,
    },
    session: { organization: null, identityId: null },
    watches: {},
    excludedKeys: [],
    snapshots: {},
    notifications: [],
    lastSyncAt: null,
    sync: { notBefore: 0, failures: 0 },
    errors: { global: null, items: {} },
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sanitizeSettings(s) {
  const d = defaultState().settings;
  if (!isPlainObject(s)) return d;
  const et = isPlainObject(s.eventTypes) ? s.eventTypes : {};
  const eventTypes = {};
  for (const c of CATEGORIES) eventTypes[c] = et[c] !== false;
  const poll = Number(s.pollMinutes);
  return {
    organization: typeof s.organization === 'string' && s.organization ? s.organization : null,
    identity: isPlainObject(s.identity) && s.identity.id ? { id: String(s.identity.id), displayName: String(s.identity.displayName || '') } : null,
    selectedProjects: Array.isArray(s.selectedProjects)
      ? s.selectedProjects.filter((p) => isPlainObject(p) && p.id && p.name).map((p) => ({ id: String(p.id), name: String(p.name) }))
      : [],
    autoWatchMine: s.autoWatchMine !== false,
    pollMinutes: [1, 2, 5, 10].includes(poll) ? poll : d.pollMinutes,
    eventTypes,
    desktopEnabled: s.desktopEnabled !== false,
    soundEnabled: s.soundEnabled === true,
    paused: s.paused === true,
    ignoreSelf: s.ignoreSelf === true,
  };
}

function sanitizeWatch(w) {
  if (!isPlainObject(w) || !w.key) return null;
  const et = w.eventTypes;
  return {
    key: String(w.key),
    organization: String(w.organization || ''),
    projectId: String(w.projectId || ''),
    projectName: String(w.projectName || ''),
    repoId: String(w.repoId || ''),
    repoName: String(w.repoName || ''),
    prId: Number(w.prId) || 0,
    url: String(w.url || ''),
    title: String(w.title || ''),
    origin: w.origin === 'auto' ? 'auto' : 'manual',
    eventTypes: Array.isArray(et) ? et.filter((c) => CATEGORIES.includes(c)) : null,
    status: typeof w.status === 'string' ? w.status : null,
    isDraft: typeof w.isDraft === 'boolean' ? w.isDraft : null,
    addedAt: Number(w.addedAt) || 0,
  };
}

function sanitizeNotification(n) {
  if (!isPlainObject(n) || !n.id) return null;
  return {
    id: String(n.id),
    key: String(n.key || ''),
    category: CATEGORIES.includes(n.category) ? n.category : 'comments',
    title: String(n.title || ''),
    body: String(n.body || ''),
    prTitle: String(n.prTitle || ''),
    repoName: String(n.repoName || ''),
    projectName: String(n.projectName || ''),
    prId: Number(n.prId) || 0,
    url: String(n.url || ''),
    actorName: typeof n.actorName === 'string' ? n.actorName : null,
    createdAt: Number(n.createdAt) || 0,
    read: n.read === true,
    readAt: Number(n.readAt) || 0,
  };
}

export function migrateState(raw) {
  const d = defaultState();
  if (!isPlainObject(raw)) return d;
  const out = d;
  out.settings = sanitizeSettings(raw.settings);
  out.credentials = { pat: typeof raw.credentials?.pat === 'string' ? raw.credentials.pat : null };
  out.account = {
    projects: Array.isArray(raw.account?.projects)
      ? raw.account.projects.filter((p) => isPlainObject(p) && p.id && p.name).map((p) => ({ id: String(p.id), name: String(p.name) }))
      : [],
    pending: isPlainObject(raw.account?.pending) ? raw.account.pending : null,
  };
  out.session = {
    organization: typeof raw.session?.organization === 'string' ? raw.session.organization : null,
    identityId: typeof raw.session?.identityId === 'string' ? raw.session.identityId : null,
  };
  out.watches = {};
  if (isPlainObject(raw.watches)) {
    for (const [k, w] of Object.entries(raw.watches)) {
      const sw = sanitizeWatch(w);
      if (sw) out.watches[k] = sw;
    }
  }
  out.excludedKeys = Array.isArray(raw.excludedKeys) ? raw.excludedKeys.map(String).slice(0, 5000) : [];
  out.snapshots = isPlainObject(raw.snapshots) ? raw.snapshots : {};
  out.notifications = Array.isArray(raw.notifications)
    ? raw.notifications.map(sanitizeNotification).filter(Boolean).slice(0, NOTIFICATION_LIMIT)
    : [];
  out.lastSyncAt = Number(raw.lastSyncAt) || null;
  out.sync = {
    notBefore: Number(raw.sync?.notBefore) || 0,
    failures: Number(raw.sync?.failures) || 0,
  };
  out.errors = {
    global: typeof raw.errors?.global === 'string' ? raw.errors.global : null,
    items: isPlainObject(raw.errors?.items) ? raw.errors.items : {},
  };
  return out;
}

export function isConnected(state) {
  return Boolean(state?.credentials?.pat && state?.settings?.identity?.id && state?.settings?.organization);
}

export function publicState(state, extras = {}) {
  const s = state || defaultState();
  const watches = Object.values(s.watches || {})
    .map((w) => ({
      key: w.key,
      organization: w.organization,
      projectId: w.projectId,
      projectName: w.projectName,
      repoId: w.repoId,
      repoName: w.repoName,
      prId: w.prId,
      url: w.url,
      title: w.title,
      origin: w.origin,
      eventTypes: w.eventTypes ? [...w.eventTypes] : null,
      status: w.status,
      isDraft: w.isDraft,
      addedAt: w.addedAt,
    }))
    .sort((a, b) => b.addedAt - a.addedAt || a.key.localeCompare(b.key));
  const notifications = (s.notifications || []).map((n) => ({ ...n }));
  const unreadCount = notifications.filter((n) => !n.read).length;
  return {
    connected: isConnected(s),
    settings: {
      organization: s.settings.organization,
      identity: s.settings.identity ? { ...s.settings.identity } : null,
      selectedProjects: (s.settings.selectedProjects || []).map((p) => ({ ...p })),
      autoWatchMine: s.settings.autoWatchMine,
      pollMinutes: s.settings.pollMinutes,
      eventTypes: { ...s.settings.eventTypes },
      desktopEnabled: s.settings.desktopEnabled,
      soundEnabled: s.settings.soundEnabled,
      paused: s.settings.paused,
      ignoreSelf: s.settings.ignoreSelf,
    },
    projects: (s.account?.projects || []).map((p) => ({ ...p })),
    watches,
    excludedCount: (s.excludedKeys || []).length,
    notifications,
    unreadCount,
    lastSyncAt: s.lastSyncAt,
    syncNotBefore: s.sync?.notBefore || 0,
    errors: {
      global: s.errors?.global || null,
      items: { ...(s.errors?.items || {}) },
    },
    ...extras,
  };
}

export function createStorageState(storage) {
  async function load() {
    const raw = await storage.get(STATE_KEY);
    const value = raw?.[STATE_KEY];
    if (value === undefined) return defaultState();
    return migrateState(value);
  }
  async function save(state) {
    await storage.set({ [STATE_KEY]: state });
    return state;
  }
  async function update(fn) {
    const state = await load();
    const result = await fn(state);
    await save(state);
    return result;
  }
  return { load, save, update, key: STATE_KEY };
}
