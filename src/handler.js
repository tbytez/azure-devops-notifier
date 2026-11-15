import { CATEGORIES } from './core.js';
import { parsePrUrl, normalizeOrganization, buildPrWebUrl, watchKey } from './urls.js';
import { isConnected, publicState } from './state.js';
import { createApi } from './api.js';

const POLL_CHOICES = [1, 2, 5, 10];
const SETTINGS_FIELDS = ['selectedProjects', 'autoWatchMine', 'pollMinutes', 'eventTypes', 'desktopEnabled', 'soundEnabled', 'paused', 'ignoreSelf'];

function ok(data = {}) {
  return { ok: true, ...data };
}

function fail(error) {
  return { ok: false, error: String(error || 'Something went wrong.') };
}

function validateOrg(input) {
  const org = normalizeOrganization(input);
  if (!org) return null;
  return org;
}

function validateToken(token) {
  if (typeof token !== 'string') return null;
  const t = token.trim();
  if (!t || t.length > 512 || /\s/.test(t)) return null;
  return t;
}

function validateProjectIds(ids, available) {
  if (!Array.isArray(ids)) return null;
  const byId = new Map(available.map((p) => [String(p.id), p]));
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const p = byId.get(String(id));
    if (!p || seen.has(p.id)) return null;
    seen.add(p.id);
    out.push({ id: p.id, name: p.name });
  }
  return out;
}

function validateEventTypesOverride(et) {
  if (et === null) return null;
  if (!Array.isArray(et)) return undefined;
  const out = [];
  for (const c of et) {
    if (!CATEGORIES.includes(c) || out.includes(c)) return undefined;
    out.push(c);
  }
  return out;
}

function resetScopedData(state) {
  state.watches = {};
  state.excludedKeys = [];
  state.snapshots = {};
  state.notifications = [];
  state.lastSyncAt = null;
  state.errors = { global: null, items: {} };
  state.sync = { notBefore: 0, failures: 0 };
}

export function createHandler(deps) {
  const {
    getState,
    saveState,
    runPoll,
    apiFactory = (state) => createApi(state),
    onStateChanged,
    afterMutation,
    hasNotificationPermission,
    playSound,
    now = () => Date.now(),
  } = deps;

  let tail = Promise.resolve();
  const enqueue = (fn) => {
    const run = tail.then(() => fn());
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
  const mutate = (fn) => enqueue(async () => {
    const result = await fn();
    if (result?.ok && typeof afterMutation === 'function') {
      try { await afterMutation(); } catch {}
    }
    return result;
  });

  async function publicPayload() {
    const state = await getState();
    const extras = {};
    if (typeof hasNotificationPermission === 'function') {
      try {
        extras.desktopPermission = await hasNotificationPermission();
      } catch {
        extras.desktopPermission = false;
      }
    }
    return publicState(state, extras);
  }

  async function connect(msg) {
    const org = validateOrg(msg?.organization);
    if (!org) return fail('Enter a valid Azure DevOps organization name (letters, numbers, hyphens).');
    const token = validateToken(msg?.token);
    if (!token) return fail('Enter your Personal Access Token.');
    const state = await getState();
    const api = apiFactory({ settings: { organization: org }, credentials: { pat: token } });
    let conn;
    let projects;
    try {
      conn = await api.connectionData();
      projects = await api.listProjects();
    } catch (e) {
      return fail(e?.message || 'Could not connect to Azure DevOps. Check the organization and token.');
    }
    const user = conn?.authenticatedUser;
    if (!user?.id) return fail('Azure DevOps did not return a signed-in identity. Check the token.');
    const identity = { id: String(user.id), displayName: String(user.providerDisplayName || user.displayName || user.uniqueName || 'Unknown') };
    const list = (Array.isArray(projects) ? projects : [])
      .filter((p) => p && p.id && p.name)
      .map((p) => ({ id: String(p.id), name: String(p.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) return fail('This account cannot see any Azure DevOps projects.');
    state.account.pending = {
      organization: org,
      identity,
      projects: list,
      pat: token,
      at: now(),
    };
    await saveState(state);
    return ok({ pending: { identity, projects: list, organization: org } });
  }

  async function confirmConnect(msg) {
    const state = await getState();
    const pending = state.account?.pending;
    if (!pending?.pat || !pending?.identity?.id) return fail('No pending connection. Start again.');
    const selected = validateProjectIds(msg?.projectIds, pending.projects || []);
    if (!selected) return fail('Select at least the projects you want to watch. Valid project ids are required.');
    if ('desktopEnabled' in (msg || {}) && typeof msg.desktopEnabled !== 'boolean') {
      return fail('desktopEnabled must be true or false.');
    }
    const orgChanged = state.session?.organization !== pending.organization || state.session?.identityId !== String(pending.identity.id);
    if (orgChanged) resetScopedData(state);
    state.settings.organization = pending.organization;
    state.settings.identity = { id: String(pending.identity.id), displayName: String(pending.identity.displayName || '') };
    state.settings.selectedProjects = selected;
    if (typeof msg.desktopEnabled === 'boolean') state.settings.desktopEnabled = msg.desktopEnabled;
    state.account.projects = (pending.projects || []).map((p) => ({ id: String(p.id), name: String(p.name) }));
    state.credentials.pat = pending.pat;
    state.session = { organization: pending.organization, identityId: String(pending.identity.id) };
    state.account.pending = null;
    state.sync.notBefore = 0;
    await saveState(state);
    if (typeof onStateChanged === 'function') {
      try { await onStateChanged(); } catch {}
    }
    enqueue(() => runPoll({ forced: false })).catch(() => {});
    return ok({ connected: true });
  }

  async function cancelConnect() {
    const state = await getState();
    state.account.pending = null;
    await saveState(state);
    return ok();
  }

  async function saveSettings(msg) {
    const state = await getState();
    if (!isConnected(state)) return fail('Connect to Azure DevOps before changing settings.');
    const patch = msg?.settings;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return fail('Invalid settings payload.');
    for (const k of Object.keys(patch)) {
      if (!SETTINGS_FIELDS.includes(k)) return fail(`Unsupported setting: ${k}`);
    }
    if ('selectedProjects' in patch) {
      const sel = validateProjectIds(patch.selectedProjects, state.account.projects || []);
      if (!sel) return fail('Selected projects must be a subset of the projects returned by Azure DevOps.');
      state.settings.selectedProjects = sel;
    }
    if ('autoWatchMine' in patch) {
      if (typeof patch.autoWatchMine !== 'boolean') return fail('autoWatchMine must be true or false.');
      state.settings.autoWatchMine = patch.autoWatchMine;
    }
    if ('pollMinutes' in patch) {
      if (!POLL_CHOICES.includes(patch.pollMinutes)) return fail('pollMinutes must be one of 1, 2, 5, 10.');
      state.settings.pollMinutes = patch.pollMinutes;
    }
    if ('eventTypes' in patch) {
      const et = patch.eventTypes;
      if (!et || typeof et !== 'object' || Array.isArray(et)) return fail('eventTypes must be an object of booleans.');
      for (const [k, v] of Object.entries(et)) {
        if (!CATEGORIES.includes(k)) return fail(`Unknown event category: ${k}`);
        if (typeof v !== 'boolean') return fail(`eventTypes.${k} must be true or false.`);
        state.settings.eventTypes[k] = v;
      }
    }
    for (const k of ['desktopEnabled', 'soundEnabled', 'paused', 'ignoreSelf']) {
      if (k in patch) {
        if (typeof patch[k] !== 'boolean') return fail(`${k} must be true or false.`);
        state.settings[k] = patch[k];
      }
    }
    await saveState(state);
    if (typeof onStateChanged === 'function') {
      try { await onStateChanged(); } catch {}
    }
    return ok({ settings: state.settings });
  }

  async function watchPr(msg) {
    const state = await getState();
    if (!isConnected(state)) return fail('Connect to Azure DevOps first.');
    const parsed = parsePrUrl(msg?.url);
    if (!parsed.ok) return fail(parsed.error);
    if (parsed.organization !== state.settings.organization) {
      return fail(`That URL belongs to organization "${parsed.organization}", but you are connected to "${state.settings.organization}".`);
    }
    const project = (state.account.projects || []).find((p) => p.name.toLowerCase() === parsed.projectName.toLowerCase());
    if (!project) return fail(`Project "${parsed.projectName}" was not found for this account.`);
    const existing = Object.values(state.watches || {}).find((w) =>
      String(w.organization || '').toLowerCase() === state.settings.organization
      && String(w.projectId) === String(project.id)
      && Number(w.prId) === parsed.prId
      && String(w.repoName || '').toLowerCase() === parsed.repoName.toLowerCase());
    if (existing) return ok({ key: existing.key, existed: true });
    const api = apiFactory(state);
    let repo;
    let pr;
    try {
      repo = await api.getRepository(project.id, parsed.repoName);
      const repoProjectId = repo?.project?.id ? String(repo.project.id) : null;
      if (repoProjectId && repoProjectId.toLowerCase() !== String(project.id).toLowerCase()) {
        return fail(`Repository "${parsed.repoName}" is not in project "${project.name}".`);
      }
      pr = await api.getPullRequest(project.id, repo.id, parsed.prId);
    } catch (e) {
      return fail(e?.message || 'Could not load that pull request. Check the URL.');
    }
    if (!repo?.id || !pr) return fail('Could not resolve that pull request.');
    const key = watchKey({
      organization: state.settings.organization,
      projectId: project.id,
      repoId: repo.id,
      prId: parsed.prId,
    });
    if (state.watches[key]) return ok({ key, existed: true });
    state.watches[key] = {
      key,
      organization: state.settings.organization,
      projectId: String(project.id),
      projectName: project.name,
      repoId: String(repo.id),
      repoName: String(repo.name || parsed.repoName),
      prId: parsed.prId,
      url: buildPrWebUrl({
        organization: state.settings.organization,
        projectName: project.name,
        repoName: repo.name || parsed.repoName,
        prId: parsed.prId,
      }),
      title: String(pr.title || ''),
      origin: 'manual',
      eventTypes: null,
      status: typeof pr.status === 'string' ? pr.status : null,
      isDraft: typeof pr.isDraft === 'boolean' ? pr.isDraft : null,
      addedAt: now(),
    };
    state.excludedKeys = state.excludedKeys.filter((k) => k !== key);
    await saveState(state);
    enqueue(() => runPoll({ forced: false })).catch(() => {});
    return ok({ key, existed: false });
  }

  async function updateWatch(msg) {
    const state = await getState();
    const key = String(msg?.key || '');
    const watch = state.watches[key];
    if (!watch) return fail('That watched pull request no longer exists.');
    if (!('eventTypes' in (msg || {}))) return fail('eventTypes is required (array or null).');
    const et = validateEventTypesOverride(msg.eventTypes);
    if (et === undefined) return fail('eventTypes must be null or an array of known categories.');
    watch.eventTypes = et;
    await saveState(state);
    return ok();
  }

  async function unwatchPr(msg) {
    const state = await getState();
    const key = String(msg?.key || '');
    if (!state.watches[key]) return fail('That watched pull request no longer exists.');
    delete state.watches[key];
    delete state.snapshots[key];
    if (!state.excludedKeys.includes(key)) state.excludedKeys.push(key);
    await saveState(state);
    return ok();
  }

  async function markRead(msg, all = false) {
    const state = await getState();
    const t = now();
    if (all) {
      for (const n of state.notifications) {
        if (!n.read) {
          n.read = true;
          n.readAt = t;
        }
      }
    } else {
      const ids = new Set(Array.isArray(msg?.ids) ? msg.ids.map(String) : []);
      for (const n of state.notifications) {
        if (ids.has(n.id) && !n.read) {
          n.read = true;
          n.readAt = t;
        }
      }
    }
    await saveState(state);
    return ok({ unreadCount: state.notifications.filter((n) => !n.read).length });
  }

  async function disconnect() {
    const state = await getState();
    state.credentials.pat = null;
    state.settings.identity = null;
    state.settings.selectedProjects = [];
    state.account.projects = [];
    state.account.pending = null;
    await saveState(state);
    if (typeof onStateChanged === 'function') {
      try { await onStateChanged(); } catch {}
    }
    return ok();
  }

  async function dispatch(msg) {
    if (!msg || typeof msg !== 'object') return fail('Invalid message.');
    switch (msg.type) {
      case 'GET_STATE':
        return ok({ state: await publicPayload() });
      case 'CONNECT':
        return mutate(() => connect(msg));
      case 'CONFIRM_CONNECT':
        return mutate(() => confirmConnect(msg));
      case 'CANCEL_CONNECT':
        return mutate(() => cancelConnect());
      case 'SAVE_SETTINGS':
        return mutate(() => saveSettings(msg));
      case 'WATCH_PR':
        return mutate(() => watchPr(msg));
      case 'UPDATE_WATCH':
        return mutate(() => updateWatch(msg));
      case 'UNWATCH_PR':
        return mutate(() => unwatchPr(msg));
      case 'MARK_READ':
        return mutate(() => markRead(msg, false));
      case 'MARK_ALL_READ':
        return mutate(() => markRead(msg, true));
      case 'SYNC_NOW':
        return mutate(async () => {
          const result = await runPoll({ forced: true });
          return ok({ sync: result });
        });
      case 'TEST_SOUND':
        return enqueue(async () => {
          if (typeof playSound !== 'function') return fail('Sound playback is not available in this context.');
          try {
            await playSound();
          } catch (e) {
            return fail(e?.message || 'Sound could not be played.');
          }
          return ok({ tested: true });
        });
      case 'DISCONNECT':
        return mutate(() => disconnect());
      default:
        return fail(`Unknown message type: ${msg.type}`);
    }
  }

  return { dispatch, enqueue };
}
