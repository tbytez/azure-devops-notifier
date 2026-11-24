import { diffPr, eventEnabled } from './core.js';
import { watchKey, buildPrWebUrl, buildNotificationUrl } from './urls.js';
import { NOTIFICATION_LIMIT } from './state.js';

const CONCURRENCY = 3;
const BACKOFF_BASE_MS = 60 * 1000;
const BACKOFF_CAP_MS = 30 * 60 * 1000;

const ERROR_MESSAGES = {
  auth: 'Azure DevOps rejected the credentials (401). Check the PAT and reconnect.',
  forbidden: 'Access denied (403). The PAT may lack required permissions.',
  notfound: 'Not found (404). The project, repository, or pull request may not exist or may not be visible to this token.',
  ratelimit: 'Azure DevOps rate limit reached (429).',
  server: 'Azure DevOps server error.',
  network: 'Network error reaching Azure DevOps.',
  http: 'Azure DevOps request failed.',
};

function sanitizeError(e) {
  const kind = e?.kind || 'http';
  return ERROR_MESSAGES[kind] || ERROR_MESSAGES.http;
}

function isAuthError(e) {
  return e?.kind === 'auth' || e?.kind === 'forbidden';
}

function noteFailure(e, rateCtx) {
  if (!e || !rateCtx) return;
  if (e.retryAfterMs) rateCtx.maxRetryAfter = Math.max(rateCtx.maxRetryAfter, e.retryAfterMs);
  if (e.kind === 'ratelimit' || e.retryAfterMs) rateCtx.rateLimited = true;
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchPrBundle(api, watch, rateCtx) {
  const [pr, threads, statuses, policies] = await Promise.allSettled([
    api.getPullRequest(watch.projectId, watch.repoId, watch.prId),
    api.getThreads(watch.projectId, watch.repoId, watch.prId),
    api.getStatuses(watch.projectId, watch.repoId, watch.prId),
    api.getPolicyEvaluations(watch.projectId, watch.prId),
  ]);
  if (pr.status === 'rejected') {
    for (const settled of [pr, threads, statuses, policies]) {
      if (settled.status === 'rejected') noteFailure(settled.reason, rateCtx);
    }
    throw pr.reason;
  }
  const failed = new Set();
  const wrap = (settled, cat) => {
    if (settled.status === 'fulfilled') return { value: settled.value };
    noteFailure(settled.reason, rateCtx);
    failed.add(cat);
    return { value: null };
  };
  const t = wrap(threads, 'sub:threads');
  const s = wrap(statuses, 'sub:statuses');
  const p = wrap(policies, 'sub:policies');
  return {
    data: {
      pr: pr.value,
      threads: t.value ? { value: t.value } : null,
      statuses: s.value ? { value: s.value } : null,
      policies: p.value ? { value: p.value } : null,
    },
    failedSubs: failed,
  };
}

function subFailuresToCategories(failedSubs) {
  const cats = new Set();
  if (failedSubs.has('sub:threads')) {
    cats.add('comments');
    cats.add('threads');
  }
  if (failedSubs.has('sub:statuses')) cats.add('checks');
  if (failedSubs.has('sub:policies')) cats.add('policies');
  return cats;
}

export async function runDiscovery(state, api, errors, now, rateCtx) {
  const settings = state.settings;
  const projects = settings.selectedProjects || [];
  const initializedProjects = new Set(state.sync.reviewerProjects);
  const notifications = [];
  let added = 0;
  let authFailed = false;

  if (!settings.autoWatchMine || !settings.identity?.id) {
    state.sync.reviewerProjects = [];
    return { added, authFailed, notifications };
  }

  for (const proj of projects) {
    for (const role of ['creator', 'reviewer']) {
      if (rateCtx?.rateLimited) break;
      try {
        const prs = await api.listActivePullRequests(proj.id, settings.identity.id, role);
        const notifyAssignment = role === 'reviewer' && initializedProjects.has(proj.id);
        for (const pr of prs || []) {
          const repoId = pr?.repository?.id;
          const prId = pr?.pullRequestId;
          if (!repoId || !prId) continue;
          const key = watchKey({ organization: settings.organization, projectId: proj.id, repoId, prId });
          if (state.watches[key] || state.excludedKeys.includes(key)) continue;
          const repoName = strOr(pr?.repository?.name, '');
          const watch = {
            key,
            organization: settings.organization,
            projectId: proj.id,
            projectName: proj.name,
            repoId: String(repoId),
            repoName,
            prId: Number(prId),
            url: buildPrWebUrl({ organization: settings.organization, projectName: proj.name, repoName, prId }),
            title: strOr(pr?.title, ''),
            origin: 'auto',
            eventTypes: null,
            status: typeof pr?.status === 'string' ? pr.status : null,
            isDraft: typeof pr?.isDraft === 'boolean' ? pr.isDraft : null,
            addedAt: now,
          };
          state.watches[key] = watch;
          added++;

          // Already watched PRs report reviewer changes through the snapshot diff.
          if (notifyAssignment) {
            const event = {
              id: `${key}|reviewers|assignment|${now}`,
              category: 'reviewers',
              title: 'Review requested',
              body: 'You were added as a reviewer.',
            };
            if (eventEnabled(event, watch, settings)) {
              notifications.push(buildNotification(event, watch, now));
            }
          }
        }
        if (role === 'reviewer') initializedProjects.add(proj.id);
      } catch (e) {
        noteFailure(e, rateCtx);
        errors.items[`project:${proj.id}`] = sanitizeError(e);
        if (isAuthError(e)) {
          errors.global = sanitizeError(e);
          authFailed = true;
        }
      }
    }
    if (rateCtx?.rateLimited) break;
  }
  state.sync.reviewerProjects = projects.map((p) => p.id).filter((id) => initializedProjects.has(id));
  return { added, authFailed, notifications };
}

function strOr(v, fallback) {
  return typeof v === 'string' && v ? v : fallback;
}

function buildNotification(event, watch, now) {
  return {
    id: event.id,
    key: watch.key,
    category: event.category,
    title: event.title,
    body: event.body,
    prTitle: watch.title || `PR #${watch.prId}`,
    repoName: watch.repoName,
    projectName: watch.projectName,
    prId: watch.prId,
    prUrl: watch.url,
    url: buildNotificationUrl(watch.url, event),
    actorName: event.actorName || null,
    createdAt: now,
    read: false,
    readAt: 0,
  };
}

export async function runPoll(deps) {
  const { getState, saveState, apiFactory, emitDesktop, emitSound, now = Date.now(), forced = false } = deps;
  const state = await getState();
  if (!state.credentials?.pat || !state.settings?.organization) {
    return { skipped: 'disconnected', added: [] };
  }
  if (state.settings.paused && !forced) return { skipped: 'paused', added: [] };
  if (state.sync?.notBefore && state.sync.notBefore > now) {
    return { skipped: 'backoff', added: [] };
  }

  const api = apiFactory(state);
  const errors = { global: null, items: {} };
  const rateCtx = { rateLimited: false, maxRetryAfter: 0 };
  let authFailed = false;
  let successes = 0;
  let attempts = 0;

  const discovery = await runDiscovery(state, api, errors, now, rateCtx).catch((e) => {
    noteFailure(e, rateCtx);
    errors.global = sanitizeError(e);
    if (isAuthError(e)) authFailed = true;
    return { added: 0, authFailed: isAuthError(e) };
  });
  if (discovery?.authFailed) authFailed = true;

  const keys = Object.keys(state.watches || {});
  const results = await mapPool(keys, CONCURRENCY, async (key) => {
    if (rateCtx.rateLimited) return undefined;
    const watch = state.watches[key];
    attempts++;
    try {
      const { data, failedSubs } = await fetchPrBundle(api, watch, rateCtx);
      successes++;
      return { key, watch, data, failedSubs };
    } catch (e) {
      noteFailure(e, rateCtx);
      if (isAuthError(e)) authFailed = true;
      errors.items[key] = sanitizeError(e);
      return { key, watch, error: e };
    }
  });

  const addedNotifications = discovery.notifications || [];
  state.notifications.unshift(...addedNotifications);
  for (const r of results) {
    if (!r || r.error || !r.data) continue;
    const failedCats = subFailuresToCategories(r.failedSubs || new Set());
    if (failedCats.size) {
      const names = [...failedCats].join(', ');
      errors.items[r.key] = `Some activity could not be refreshed (${names}). Showing the last known state.`;
    }
    const prev = state.snapshots[r.key] || null;
    const isBaseline = !prev;
    const { snapshot, events } = diffPr(r.key, prev, r.data, { now, failed: failedCats });
    state.snapshots[r.key] = snapshot;
    const pr = r.data.pr || {};
    if (typeof pr.status === 'string') r.watch.status = pr.status;
    if (typeof pr.isDraft === 'boolean') r.watch.isDraft = pr.isDraft;
    if (typeof pr.title === 'string' && pr.title) r.watch.title = pr.title;

    if (isBaseline) continue;
    for (const ev of events) {
      if (!eventEnabled(ev, r.watch, state.settings)) continue;
      if (state.settings.ignoreSelf && ev.actorId && state.settings.identity?.id && ev.actorId === state.settings.identity.id) continue;
      const notif = buildNotification(ev, r.watch, now);
      state.notifications.unshift(notif);
      addedNotifications.push(notif);
    }
  }

  if (state.notifications.length > NOTIFICATION_LIMIT) {
    state.notifications.length = NOTIFICATION_LIMIT;
  }

  const outage = attempts > 0 && successes === 0;
  if (authFailed || outage || rateCtx.rateLimited) {
    errors.global = errors.global || (authFailed
      ? ERROR_MESSAGES.auth
      : outage
        ? 'Could not reach Azure DevOps. Will retry automatically.'
        : 'Azure DevOps rate limit reached (429). Will retry automatically.');
    state.sync.failures = (state.sync.failures || 0) + 1;
    const expBackoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.min(state.sync.failures - 1, 5));
    const backoff = Math.max(rateCtx.maxRetryAfter || 0, expBackoff);
    state.sync.notBefore = now + backoff;
  } else {
    state.sync.failures = 0;
    state.sync.notBefore = 0;
    if (!errors.items || Object.keys(errors.items).length === 0) {
      errors.global = null;
    }
  }

  state.errors = errors;
  state.lastSyncAt = now;
  await saveState(state);
  if (state.settings?.soundEnabled === true && addedNotifications.length > 0 && typeof emitSound === 'function') {
    try {
      await emitSound();
    } catch {}
  }
  if (typeof emitDesktop === 'function') {
    for (const notif of addedNotifications) {
      try {
        await emitDesktop(notif);
      } catch {}
    }
  }
  return { skipped: null, added: addedNotifications, errors, discovered: discovery?.added || 0 };
}
