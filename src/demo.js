import { createHandler } from './handler.js';
import { runPoll } from './sync.js';
import { watchKey, buildPrWebUrl } from './urls.js';
import { defaultState, migrateState, publicState, isConnected } from './state.js';
import { createAudioPlayer } from './audio-player.js';

const DEMO_SOUND_URL = new URL('../assets/sounds/notification.wav', import.meta.url).href;

const DEMO_KEY = 'azdoNotifier.demo.v1';
const DEMO_ORG = 'contoso';

const DEMO_PROJECTS = [
  { id: 'demo-proj-web', name: 'Web App' },
  { id: 'demo-proj-api', name: 'Platform API' },
  { id: 'demo-proj-infra', name: 'Infrastructure' },
];

const DEMO_IDENTITY = { id: 'demo-user-id', displayName: 'Demo User' };

const DEMO_PRS = [
  {
    projectId: 'demo-proj-web', repoId: 'demo-repo-webapp', repoName: 'webapp', prId: 101,
    title: 'Add sign-in with Microsoft', status: 'active', isDraft: false, creatorId: DEMO_IDENTITY.id,
    reviewers: [
      { id: 'demo-user-id', displayName: 'Demo User', vote: 10, isRequired: true, hasDeclined: false },
      { id: 'demo-rev-1', displayName: 'Priya Natarajan', vote: 5, isRequired: true, hasDeclined: false },
      { id: 'demo-rev-2', displayName: 'Marcus Webb', vote: 0, isRequired: false, hasDeclined: false },
    ],
    threads: [
      { id: 1, status: 'active', comments: [
        { id: 11, content: 'Can we add a fallback for guests?', lastUpdatedDate: '2026-11-14T09:12:00Z', publishedDate: '2026-11-14T09:12:00Z', author: { id: 'demo-rev-1', displayName: 'Priya Natarajan' }, commentType: 'text' },
        { id: 12, content: 'Good catch, added a guest path in the latest push.', lastUpdatedDate: '2026-11-14T10:40:00Z', publishedDate: '2026-11-14T10:40:00Z', author: { id: 'demo-user-id', displayName: 'Demo User' }, commentType: 'text' },
      ]},
      { id: 2, status: 'fixed', comments: [
        { id: 21, content: 'Token refresh looks solid now.', lastUpdatedDate: '2026-11-13T16:00:00Z', publishedDate: '2026-11-13T16:00:00Z', author: { id: 'demo-rev-2', displayName: 'Marcus Webb' }, commentType: 'text' },
      ]},
    ],
    statuses: [
      { id: 1, context: { genre: 'pr-checks', name: 'build' }, state: 'succeeded', creationDate: '2026-11-15T08:00:00Z' },
      { id: 2, context: { genre: 'pr-checks', name: 'lint' }, state: 'pending', creationDate: '2026-11-15T08:01:00Z' },
    ],
    policies: [
      { evaluationId: 501, status: 'approved', configuration: { id: 'demo-policy-1', type: { displayName: 'Require minimum reviewers' } }, completedDate: '2026-11-15T08:05:00Z' },
      { evaluationId: 502, status: 'queued', configuration: { id: 'demo-policy-2', type: { displayName: 'Comment requirements' } }, startedDate: '2026-11-15T08:06:00Z' },
    ],
  },
  {
    projectId: 'demo-proj-web', repoId: 'demo-repo-webapp', repoName: 'webapp', prId: 102,
    title: 'Fix flaky checkout test', status: 'active', isDraft: true,
    reviewers: [
      { id: 'demo-rev-1', displayName: 'Priya Natarajan', vote: -5, isRequired: false, hasDeclined: false },
    ],
    threads: [
      { id: 3, status: 'active', comments: [
        { id: 31, content: 'Still seeing the race on CI runners.', lastUpdatedDate: '2026-11-15T07:30:00Z', publishedDate: '2026-11-15T07:30:00Z', author: { id: 'demo-rev-1', displayName: 'Priya Natarajan' }, commentType: 'text' },
      ]},
    ],
    statuses: [
      { id: 3, context: { genre: 'pr-checks', name: 'build' }, state: 'failed', creationDate: '2026-11-15T07:45:00Z' },
    ],
    policies: [],
  },
  {
    projectId: 'demo-proj-api', repoId: 'demo-repo-orders', repoName: 'orders-api', prId: 203,
    title: 'Rate limit the public endpoint', status: 'active', isDraft: false,
    reviewers: [
      { id: 'demo-rev-2', displayName: 'Marcus Webb', vote: 10, isRequired: true, hasDeclined: false },
      { id: 'demo-user-id', displayName: 'Demo User', vote: 0, isRequired: true, hasDeclined: false },
    ],
    threads: [],
    statuses: [
      { id: 4, context: { genre: 'pr-checks', name: 'unit-tests' }, state: 'succeeded', creationDate: '2026-11-15T06:00:00Z' },
    ],
    policies: [
      { evaluationId: 601, status: 'approved', configuration: { id: 'demo-policy-1', type: { displayName: 'Require minimum reviewers' } }, completedDate: '2026-11-15T06:10:00Z' },
    ],
  },
  {
    projectId: 'demo-proj-api', repoId: 'demo-repo-orders', repoName: 'orders-api', prId: 198,
    title: 'Deprecate v1 webhook payload', status: 'completed', isDraft: false,
    reviewers: [],
    threads: [
      { id: 4, status: 'closed', comments: [
        { id: 41, content: 'Shipping this behind the flag.', lastUpdatedDate: '2026-11-10T12:00:00Z', publishedDate: '2026-11-10T12:00:00Z', author: { id: 'demo-rev-2', displayName: 'Marcus Webb' }, commentType: 'text' },
      ]},
    ],
    statuses: [],
    policies: [],
  },
  {
    projectId: 'demo-proj-infra', repoId: 'demo-repo-iac', repoName: 'iac', prId: 77,
    title: 'Rotate staging certificates', status: 'abandoned', isDraft: false,
    reviewers: [],
    threads: [],
    statuses: [],
    policies: [],
  },
];

function seedNotifications(now) {
  const base = [
    { id: 'demo-n-1', key: null, category: 'comments', title: 'New comment', body: 'Can we add a fallback for guests?', prTitle: 'Add sign-in with Microsoft', repoName: 'webapp', projectName: 'Web App', prId: 101, createdAt: now - 1000 * 60 * 22, read: false, actorName: 'Priya Natarajan' },
    { id: 'demo-n-2', key: null, category: 'reviews', title: 'Vote changed', body: 'Priya Natarajan approved with suggestions.', prTitle: 'Add sign-in with Microsoft', repoName: 'webapp', projectName: 'Web App', prId: 101, createdAt: now - 1000 * 60 * 60 * 2, read: false, actorName: 'Priya Natarajan' },
    { id: 'demo-n-3', key: null, category: 'checks', title: 'Check updated', body: 'pr-checks/build: succeeded.', prTitle: 'Rate limit the public endpoint', repoName: 'orders-api', projectName: 'Platform API', prId: 203, createdAt: now - 1000 * 60 * 60 * 5, read: false },
    { id: 'demo-n-4', key: null, category: 'lifecycle', title: 'Status changed', body: 'Pull request is now abandoned.', prTitle: 'Rotate staging certificates', repoName: 'iac', projectName: 'Infrastructure', prId: 77, createdAt: now - 1000 * 60 * 60 * 26, read: true, readAt: now - 1000 * 60 * 60 * 20 },
    { id: 'demo-n-5', key: null, category: 'threads', title: 'Thread resolved', body: 'Marked as fixed.', prTitle: 'Add sign-in with Microsoft', repoName: 'webapp', projectName: 'Web App', prId: 101, createdAt: now - 1000 * 60 * 60 * 30, read: true, readAt: now - 1000 * 60 * 60 * 28 },
    { id: 'demo-n-6', key: null, category: 'reviewers', title: 'Reviewer added', body: 'Marcus Webb was added as a reviewer.', prTitle: 'Fix flaky checkout test', repoName: 'webapp', projectName: 'Web App', prId: 102, createdAt: now - 1000 * 60 * 60 * 8, read: false, actorName: 'Marcus Webb' },
  ];
  return base.map((n, i) => ({
    ...n,
    key: watchKey({ organization: DEMO_ORG, projectId: n.projectName === 'Web App' ? 'demo-proj-web' : n.projectName === 'Platform API' ? 'demo-proj-api' : 'demo-proj-infra', repoId: n.repoName === 'webapp' ? 'demo-repo-webapp' : n.repoName === 'orders-api' ? 'demo-repo-orders' : 'demo-repo-iac', prId: n.prId }),
    url: `https://dev.azure.com/${DEMO_ORG}/${encodeURIComponent(n.projectName)}/_git/${n.repoName}/pullrequest/${n.prId}`,
  }));
}

function seedState(now) {
  const s = defaultState();
  s.settings.organization = DEMO_ORG;
  s.settings.identity = { ...DEMO_IDENTITY };
  s.settings.selectedProjects = DEMO_PROJECTS.map((p) => ({ ...p }));
  s.account.projects = DEMO_PROJECTS.map((p) => ({ ...p }));
  s.credentials.pat = 'demo-token-not-real';
  s.session = { organization: DEMO_ORG, identityId: DEMO_IDENTITY.id };
  s.lastSyncAt = now - 1000 * 60 * 3;
  s.notifications = seedNotifications(now);
  for (const fixture of DEMO_PRS) {
    const key = watchKey({ organization: DEMO_ORG, projectId: fixture.projectId, repoId: fixture.repoId, prId: fixture.prId });
    const proj = DEMO_PROJECTS.find((p) => p.id === fixture.projectId);
    const origin = fixture.prId === 101 || fixture.prId === 203 ? 'auto' : 'manual';
    s.watches[key] = {
      key,
      organization: DEMO_ORG,
      projectId: fixture.projectId,
      projectName: proj.name,
      repoId: fixture.repoId,
      repoName: fixture.repoName,
      prId: fixture.prId,
      url: buildPrWebUrl({ organization: DEMO_ORG, projectName: proj.name, repoName: fixture.repoName, prId: fixture.prId }),
      title: fixture.title,
      origin,
      eventTypes: null,
      status: fixture.status,
      isDraft: fixture.isDraft,
      addedAt: now - 1000 * 60 * 60 * (10 + fixture.prId % 7),
    };
  }
  return s;
}

function demoApiFor(state) {
  return {
    async connectionData() {
      return { authenticatedUser: { id: DEMO_IDENTITY.id, providerDisplayName: DEMO_IDENTITY.displayName, displayName: DEMO_IDENTITY.displayName, uniqueName: 'demo@contoso.example' } };
    },
    async listProjects() {
      return DEMO_PROJECTS.map((p) => ({ ...p }));
    },
    async listActivePullRequests(projectId, identityId, role = 'creator') {
      if (identityId !== DEMO_IDENTITY.id) return [];
      return DEMO_PRS.filter((p) => p.projectId === projectId && p.status === 'active' && (role === 'reviewer' ? p.reviewers.some((r) => r.id === identityId) : p.creatorId === identityId)).map((p) => ({
        pullRequestId: p.prId,
        title: p.title,
        status: p.status,
        isDraft: p.isDraft,
        repository: { id: p.repoId, name: p.repoName },
      }));
    },
    async getRepository(projectId, repoNameOrId) {
      const match = DEMO_PRS.find((p) => p.projectId === projectId && (p.repoId === repoNameOrId || p.repoName.toLowerCase() === String(repoNameOrId).toLowerCase()));
      const name = match?.repoName || String(repoNameOrId);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return { id: match?.repoId || `demo-repo-${slug}`, name, project: { id: projectId } };
    },
    async getPullRequest(projectId, repoId, prId) {
      const fix = DEMO_PRS.find((p) => p.projectId === projectId && p.repoId === repoId && p.prId === Number(prId));
      if (fix) {
        const proj = DEMO_PROJECTS.find((p) => p.id === projectId);
        return {
          pullRequestId: fix.prId,
          title: fix.title,
          status: fix.status,
          isDraft: fix.isDraft,
          targetRefName: 'refs/heads/main',
          reviewers: fix.reviewers,
          lastMergeSourceCommit: { commitId: `demo-sha-${fix.prId}-abcdef1234567890` },
          repository: { id: fix.repoId, name: fix.repoName },
          project: { id: projectId, name: proj?.name },
        };
      }
      const proj = DEMO_PROJECTS.find((p) => p.id === projectId);
      const repoName = repoId.replace(/^demo-repo-/, '').replace(/-/g, ' ');
      return {
        pullRequestId: Number(prId),
        title: `Demo pull request #${prId}`,
        status: 'active',
        isDraft: false,
        targetRefName: 'refs/heads/main',
        reviewers: [{ id: 'demo-rev-1', displayName: 'Priya Natarajan', vote: 0, isRequired: false, hasDeclined: false }],
        lastMergeSourceCommit: { commitId: `demo-sha-${prId}-0000000000000000` },
        repository: { id: repoId, name: repoName },
        project: { id: projectId, name: proj?.name },
      };
    },
    async getThreads(projectId, repoId, prId) {
      const fix = DEMO_PRS.find((p) => p.projectId === projectId && p.repoId === repoId && p.prId === Number(prId));
      return fix ? fix.threads : [];
    },
    async getStatuses(projectId, repoId, prId) {
      const fix = DEMO_PRS.find((p) => p.projectId === projectId && p.repoId === repoId && p.prId === Number(prId));
      return fix ? fix.statuses : [];
    },
    async getPolicyEvaluations(projectId, prId) {
      const fix = DEMO_PRS.find((p) => p.projectId === projectId && p.prId === Number(prId));
      return fix ? fix.policies : [];
    },
  };
}

export function createDemoBridge() {
  const storage = {
    async get(key) {
      try {
        const raw = globalThis.localStorage?.getItem(DEMO_KEY);
        return raw ? { [key]: JSON.parse(raw) } : {};
      } catch {
        return {};
      }
    },
    async set(items) {
      try {
        const raw = items?.[DEMO_KEY];
        if (raw !== undefined) globalThis.localStorage?.setItem(DEMO_KEY, JSON.stringify(raw));
      } catch {}
    },
  };

  async function getState() {
    const raw = await storage.get('azdoNotifier.demo.v1');
    const stored = raw?.['azdoNotifier.demo.v1'];
    if (stored) return migrateState(stored);
    const seeded = seedState(Date.now());
    await storage.set({ 'azdoNotifier.demo.v1': seeded });
    return seeded;
  }

  const store = {
    load: getState,
    save: async (s) => {
      await storage.set({ 'azdoNotifier.demo.v1': s });
      return s;
    },
  };

  const runPollOp = async ({ forced = false } = {}) => {
    const state = await store.load();
    if (!isConnected(state)) return { skipped: 'disconnected', added: [] };
    if (state.settings.paused && !forced) return { skipped: 'paused', added: [] };
    return runPoll({
      getState: () => store.load(),
      saveState: (s) => store.save(s),
      apiFactory: () => demoApiFor(state),
      emitDesktop: () => {},
      now: Date.now(),
      forced,
    });
  };

  const demoPlaySound = createAudioPlayer({ url: DEMO_SOUND_URL });

  const handler = createHandler({
    getState: () => store.load(),
    saveState: (s) => store.save(s),
    runPoll: runPollOp,
    apiFactory: (s) => demoApiFor(s),
    onStateChanged: async () => {},
    hasNotificationPermission: async () => true,
    playSound: () => demoPlaySound(),
    checkUpdates: async () => ({ update: { checkedAt: Date.now(), version: null, url: null, available: false } }),
  });

  return {
    kind: 'demo',
    async dispatch(msg) {
      if (msg?.type === 'RESET_DEMO') {
        try { globalThis.localStorage?.removeItem(DEMO_KEY); } catch {}
        return { ok: true };
      }
      return handler.dispatch(msg);
    },
    async getPublicState() {
      const state = await store.load();
      return { ok: true, state: publicState(state, { demo: true, desktopPermission: false }) };
    },
  };
}
