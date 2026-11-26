export const CATEGORIES = [
  'comments',
  'threads',
  'reviews',
  'reviewers',
  'commits',
  'lifecycle',
  'checks',
  'policies',
];

export const VOTE_LABELS = {
  10: 'approved',
  5: 'approved with suggestions',
  0: 'reset their vote',
  '-5': 'waiting for author',
  '-10': 'rejected',
};

export const THREAD_STATUS_LABELS = {
  active: 'active',
  fixed: 'fixed',
  wontFix: "won't fix",
  closed: 'closed',
  byDesign: 'by design',
  pending: 'pending',
};

export const CHECK_STATE_LABELS = {
  notSet: 'not set',
  pending: 'pending',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  error: 'error',
  notApplicable: 'not applicable',
};

export const POLICY_STATUS_LABELS = {
  queued: 'queued',
  approved: 'approved',
  rejected: 'rejected',
  running: 'running',
  notApplicable: 'not applicable',
  notValid: 'not valid',
};

const LIFECYCLE_LABELS = {
  active: 'active',
  completed: 'completed',
  abandoned: 'abandoned',
};

function str(v) {
  return typeof v === 'string' ? v : '';
}

function pickTime(...vals) {
  let best = 0;
  for (const v of vals) {
    const t = Date.parse(v || '');
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best;
}

function shortSha(sha) {
  const s = str(sha);
  return s.length > 10 ? s.slice(0, 10) : s;
}

function excerpt(text, max = 140) {
  const t = str(text).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function isSystemOrDeleted(comment) {
  if (!comment || typeof comment !== 'object') return true;
  if (comment.isDeleted === true) return true;
  const type = str(comment.commentType);
  return type === 'system';
}

function latestByDateThenId(list, dateFn, idFn) {
  let best = null;
  let bestDate = -1;
  let bestId = -1;
  for (const item of list || []) {
    if (!item) continue;
    const d = Date.parse(dateFn(item) || '') || 0;
    const id = Number(idFn(item)) || 0;
    if (d > bestDate || (d === bestDate && id > bestId)) {
      best = item;
      bestDate = d;
      bestId = id;
    }
  }
  return best;
}

function commentIdentities(threads, pr, identity) {
  const names = new Map();
  const add = (person, key) => {
    const name = str(person?.displayName).trim();
    if (!name) return;
    for (const id of [key, person.id]) {
      if (typeof id === 'string' && id) names.set(id.toLowerCase(), name);
    }
  };
  add(identity);
  add(pr?.createdBy);
  for (const reviewer of Array.isArray(pr?.reviewers) ? pr.reviewers : []) add(reviewer);
  for (const thread of threads) {
    for (const comment of Array.isArray(thread?.comments) ? thread.comments : []) add(comment?.author);
    for (const [id, person] of Object.entries(thread?.identities || {})) add(person, id);
  }
  return names;
}

function commentPreview(content, names) {
  // Azure DevOps Markdown stores mentions as @<userID>.
  return excerpt(content.replace(/@<([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})>/gi,
    (_, id) => `@${names?.get(id.toLowerCase()) || 'Unknown user'}`));
}

function normalizeThreads(threadsData, pr, identity) {
  const threads = {};
  const comments = {};
  const list = Array.isArray(threadsData?.value) ? threadsData.value : null;
  if (!list) return { threads, comments, ok: false };
  const names = commentIdentities(list, pr, identity);
  for (const t of list) {
    if (!t || t.id == null) continue;
    const tid = String(t.id);
    const filePath = str(t.threadContext?.filePath) || null;
    threads[tid] = { status: str(t.status) || 'unknown', filePath };
    const cls = Array.isArray(t.comments) ? t.comments : [];
    for (const c of cls) {
      if (!c || c.id == null || isSystemOrDeleted(c)) continue;
      const cid = `${tid}:${c.id}`;
      const author = c.author && typeof c.author === 'object' ? c.author : {};
      const updated = pickTime(c.lastContentUpdatedDate, c.lastUpdatedDate, c.publishedDate);
      comments[cid] = {
        threadId: tid,
        filePath,
        authorId: str(author.id) || null,
        authorName: str(author.displayName) || str(author.uniqueName) || 'Unknown',
        updated,
        publishedAt: Date.parse(c.publishedDate || ''),
        isReply: Number(c.parentCommentId) > 0,
        hash: str(c.content),
        preview: commentPreview(str(c.content), names),
      };
    }
  }
  return { threads, comments, ok: true };
}

function normalizeReviewers(pr) {
  const reviewers = {};
  const list = Array.isArray(pr?.reviewers) ? pr.reviewers : null;
  if (!list) return { reviewers, ok: false };
  for (const r of list) {
    if (!r || r.id == null) continue;
    reviewers[String(r.id)] = {
      vote: Number.isFinite(r.vote) ? r.vote : 0,
      isRequired: r.isRequired === true,
      hasDeclined: r.hasDeclined === true,
      name: str(r.displayName) || 'Unknown',
    };
  }
  return { reviewers, ok: true };
}

function normalizeLifecycle(pr) {
  return {
    status: str(pr?.status) || null,
    isDraft: typeof pr?.isDraft === 'boolean' ? pr.isDraft : null,
    title: str(pr?.title) || null,
    targetRefName: str(pr?.targetRefName) || null,
  };
}

function normalizeCommits(pr) {
  const sha = str(pr?.lastMergeSourceCommit?.commitId);
  return sha ? { sourceCommit: sha } : null;
}

function normalizeChecks(statusesData) {
  const checks = {};
  const list = Array.isArray(statusesData?.value) ? statusesData.value : null;
  if (!list) return { checks, ok: false };
  const byContext = new Map();
  for (const s of list) {
    if (!s || !s.context) continue;
    const ctx = `${str(s.context.genre)}/${str(s.context.name)}`;
    if (!ctx || ctx === '/') continue;
    const cand = { state: str(s.state), created: Date.parse(s.creationDate || '') || 0, id: Number(s.id) || 0, targetUrl: str(s.targetUrl) || null };
    const prev = byContext.get(ctx);
    if (!prev || cand.created > prev.created || (cand.created === prev.created && cand.id > prev.id)) {
      byContext.set(ctx, cand);
    }
  }
  for (const [ctx, v] of byContext) checks[ctx] = v;
  return { checks, ok: true };
}

function policyConfigKey(id) {
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  const s = str(id);
  return s || null;
}

function normalizePolicies(policiesData) {
  const policies = {};
  const list = Array.isArray(policiesData?.value) ? policiesData.value : null;
  if (!list) return { policies, ok: false };
  const byConfig = new Map();
  for (const p of list) {
    const cfgId = policyConfigKey(p?.configuration?.id);
    if (!cfgId) continue;
    const d = Date.parse(p.completedDate || p.startedDate || p.creationDate || '') || 0;
    const evalId = String(p?.evaluationId ?? '');
    const prev = byConfig.get(cfgId);
    if (!prev || d > prev.d || (d === prev.d && evalId > prev.evalId)) {
      byConfig.set(cfgId, { status: str(p.status), d, evalId, name: str(p.configuration?.type?.displayName) || str(p.configuration?.type?.name) || cfgId });
    }
  }
  for (const [cfgId, v] of byConfig) {
    policies[cfgId] = { status: v.status, name: v.name };
  }
  return { policies, ok: true };
}

function emptySnapshot() {
  return {
    comments: {},
    threads: {},
    reviewers: {},
    commits: {},
    lifecycle: {},
    checks: {},
    policies: {},
    revisions: {},
  };
}

function bumpRev(snapshot, entityKey) {
  const rev = (snapshot.revisions[entityKey] || 0) + 1;
  snapshot.revisions[entityKey] = rev;
  return rev;
}

function makeEvent(prKey, category, entityKey, revision, fields) {
  return {
    id: `${prKey}|${category}|${entityKey}|${revision}`,
    category,
    entityKey,
    revision,
    actorId: fields.actorId ?? null,
    actorName: fields.actorName ?? null,
    title: fields.title,
    body: fields.body ?? '',
    ...(fields.target ? { target: fields.target } : {}),
  };
}

function diffComments(prKey, prev, next, events, revs, commentPreviewUpdates, catchUpRepliesSince) {
  const p = prev.comments || {};
  const n = next.comments || {};
  const snap = {};
  for (const cid of Object.keys(n).sort()) {
    const c = n[cid];
    const old = p[cid];
    const rec = {
      threadId: c.threadId,
      filePath: c.filePath,
      authorId: c.authorId,
      authorName: c.authorName,
      updated: c.updated,
      hash: c.hash,
    };
    if (!old) {
      const rev = bumpRev(revs, `comment:${cid}`);
      if (!catchUpRepliesSince || (c.isReply && c.publishedAt > catchUpRepliesSince)) {
        events.push(makeEvent(prKey, 'comments', `comment:${cid}`, rev, {
          actorId: c.authorId,
          actorName: c.authorName,
          title: 'New comment',
          target: { filePath: c.filePath },
          body: c.preview,
        }));
      }
      rec.rev = rev;
    } else {
      const changed = c.hash !== old.hash;
      if (changed) {
        const rev = bumpRev(revs, `comment:${cid}`);
        events.push(makeEvent(prKey, 'comments', `comment:${cid}`, rev, {
          actorId: c.authorId,
          actorName: c.authorName,
          title: 'Comment edited',
          target: { filePath: c.filePath },
          body: c.preview,
        }));
        rec.rev = rev;
      } else {
        rec.rev = old.rev || revs.revisions[`comment:${cid}`] || 1;
        const original = excerpt(c.hash);
        if (c.preview !== original) {
          commentPreviewUpdates.set(`${prKey}|comments|comment:${cid}|${rec.rev}`, {
            original, unresolved: commentPreview(c.hash), preview: c.preview,
          });
        }
      }
    }
    snap[cid] = rec;
  }
  for (const cid of Object.keys(p)) {
    if (!n[cid]) {
      const old = p[cid];
      snap[cid] = { ...old };
      if (revs.revisions[`comment:${cid}`] == null) revs.revisions[`comment:${cid}`] = old.rev || 1;
    }
  }
  return snap;
}

function diffThreads(prKey, prev, next, events, revs) {
  const p = prev.threads || {};
  const n = next.threads || {};
  const snap = {};
  for (const tid of Object.keys(n).sort()) {
    const t = n[tid];
    const old = p[tid];
    const rec = { status: t.status, filePath: t.filePath };
    if (old && old.status !== t.status) {
      const ek = `thread:${tid}:status`;
      const rev = bumpRev(revs, ek);
      let title;
      let body;
      if (old.status === 'active' && t.status !== 'active') {
        title = 'Thread resolved';
        body = `Marked as ${THREAD_STATUS_LABELS[t.status] || t.status}.`;
      } else if (old.status !== 'active' && t.status === 'active') {
        title = 'Thread reopened';
        body = 'A resolved thread was reopened.';
      } else {
        title = 'Thread status changed';
        body = `${THREAD_STATUS_LABELS[old.status] || old.status} → ${THREAD_STATUS_LABELS[t.status] || t.status}.`;
      }
      events.push(makeEvent(prKey, 'threads', ek, rev, { title, body, target: { filePath: t.filePath } }));
      rec.rev = rev;
    } else {
      rec.rev = old?.rev || revs.revisions[`thread:${tid}:status`] || 1;
    }
    snap[tid] = rec;
  }
  for (const tid of Object.keys(p)) {
    if (!n[tid]) snap[tid] = { ...p[tid] };
  }
  return snap;
}

function diffReviewers(prKey, prevNext, events, nextRevs) {
  const p = prevNext.prev;
  const n = prevNext.next;
  const snap = {};
  const pIds = new Set(Object.keys(p));
  const nIds = new Set(Object.keys(n));
  for (const rid of [...nIds].sort()) {
    const r = n[rid];
    const old = p[rid];
    if (!old) {
      const ek = `reviewer:${rid}:membership`;
      const rev = bumpRev(nextRevs, ek);
      events.push(makeEvent(prKey, 'reviewers', ek, rev, {
        actorId: null,
        actorName: null,
        title: 'Reviewer added',
        body: `${r.name} was added as a reviewer.`,
      }));
      let voteRev = nextRevs.revisions[`reviewer:${rid}:vote`] || 1;
      if (r.vote !== 0) {
        const vek = `reviewer:${rid}:vote`;
        voteRev = bumpRev(nextRevs, vek);
        const label = VOTE_LABELS[r.vote] ?? `vote changed to ${r.vote}`;
        events.push(makeEvent(prKey, 'reviews', vek, voteRev, {
          actorId: rid,
          actorName: r.name,
          title: 'Vote recorded',
          body: `${r.name} ${label}.`,
        }));
      }
      snap[rid] = { ...r, rev: rev, voteRev, reqRev: nextRevs.revisions[`reviewer:${rid}:required`] || 1 };
      continue;
    }
    const rec = { ...r, rev: old.rev };
    if (old.vote !== r.vote) {
      const ek = `reviewer:${rid}:vote`;
      const rev = bumpRev(nextRevs, ek);
      const label = VOTE_LABELS[r.vote] ?? `vote changed to ${r.vote}`;
      events.push(makeEvent(prKey, 'reviews', ek, rev, {
        actorId: rid,
        actorName: r.name,
        title: 'Vote changed',
        body: `${r.name} ${label}.`,
      }));
      rec.voteRev = rev;
    } else {
      rec.voteRev = old.voteRev || nextRevs.revisions[`reviewer:${rid}:vote`] || 1;
    }
    if (old.isRequired !== r.isRequired) {
      const ek = `reviewer:${rid}:required`;
      const rev = bumpRev(nextRevs, ek);
      events.push(makeEvent(prKey, 'reviewers', ek, rev, {
        actorId: null,
        actorName: null,
        title: r.isRequired ? 'Reviewer required' : 'Reviewer no longer required',
        body: `${r.name} ${r.isRequired ? 'is now a required reviewer' : 'is no longer a required reviewer'}.`,
      }));
      rec.reqRev = rev;
    } else {
      rec.reqRev = old.reqRev || nextRevs.revisions[`reviewer:${rid}:required`] || 1;
    }
    snap[rid] = rec;
  }
  for (const rid of [...pIds].sort()) {
    if (!nIds.has(rid)) {
      const old = p[rid];
      const ek = `reviewer:${rid}:membership`;
      const rev = bumpRev(nextRevs, ek);
      events.push(makeEvent(prKey, 'reviewers', ek, rev, {
        actorId: null,
        actorName: null,
        title: 'Reviewer removed',
        body: `${old.name} was removed as a reviewer.`,
      }));
    }
  }
  return snap;
}

function diffCommits(prKey, prev, next, events, revs) {
  const p = prev.commits || {};
  const n = next.commits || {};
  const snap = {};
  const pSha = str(p.sourceCommit);
  const nSha = str(n.sourceCommit);
  if (nSha) {
    if (pSha && pSha !== nSha) {
      const rev = bumpRev(revs, 'commit:source');
      events.push(makeEvent(prKey, 'commits', 'commit:source', rev, {
        title: 'New commits',
        target: { commitId: nSha },
        body: `Source branch updated to ${shortSha(nSha)}.`,
      }));
      snap.sourceCommit = nSha;
      snap.rev = rev;
    } else {
      snap.sourceCommit = nSha;
      snap.rev = pSha ? (revs.revisions['commit:source'] || 1) : 1;
    }
  } else if (pSha) {
    snap.sourceCommit = pSha;
    snap.rev = revs.revisions['commit:source'] || 1;
  }
  return snap;
}

function diffLifecycle(prKey, prev, next, events, revs) {
  const p = prev.lifecycle || {};
  const n = next.lifecycle || {};
  const snap = {};
  const emit = (ek, title, body) => {
    const rev = bumpRev(revs, ek);
    events.push(makeEvent(prKey, 'lifecycle', ek, rev, { title, body }));
    return rev;
  };
  let statusRev = revs.revisions['pr:status'] || (p.status ? 1 : 0);
  if (n.status && p.status && n.status !== p.status) {
    statusRev = emit('pr:status', 'Status changed', `Pull request is now ${LIFECYCLE_LABELS[n.status] || n.status}.`);
    events[events.length - 1].category = 'lifecycle';
  } else if (n.status && !p.status) {
    statusRev = 1;
  }
  snap.status = n.status ?? p.status ?? null;
  snap.statusRev = statusRev;
  let draftRev = revs.revisions['pr:draft'] || (p.isDraft != null ? 1 : 0);
  if (n.isDraft != null && p.isDraft != null && n.isDraft !== p.isDraft) {
    draftRev = emit('pr:draft', n.isDraft ? 'Converted to draft' : 'Published for review', n.isDraft ? 'The pull request was converted to a draft.' : 'The pull request was published as ready for review.');
  } else if (n.isDraft != null && p.isDraft == null) {
    draftRev = 1;
  }
  snap.isDraft = n.isDraft ?? p.isDraft ?? null;
  snap.draftRev = draftRev;
  let titleRev = revs.revisions['pr:title'] || (p.title ? 1 : 0);
  if (n.title && p.title && n.title !== p.title) {
    titleRev = emit('pr:title', 'Title changed', `Renamed to “${excerpt(n.title, 80)}”.`);
  } else if (n.title && !p.title) {
    titleRev = 1;
  }
  snap.title = n.title ?? p.title ?? null;
  snap.titleRev = titleRev;
  let targetRev = revs.revisions['pr:target'] || (p.targetRefName ? 1 : 0);
  if (n.targetRefName && p.targetRefName && n.targetRefName !== p.targetRefName) {
    targetRev = emit('pr:target', 'Target branch changed', `Now targets ${n.targetRefName}.`);
  } else if (n.targetRefName && !p.targetRefName) {
    targetRev = 1;
  }
  snap.targetRefName = n.targetRefName ?? p.targetRefName ?? null;
  snap.targetRev = targetRev;
  return snap;
}

function diffChecks(prKey, prev, next, events, revs) {
  const p = prev.checks || {};
  const n = next.checks || {};
  const snap = {};
  const allCtx = new Set([...Object.keys(p), ...Object.keys(n)]);
  for (const ctx of [...allCtx].sort()) {
    const c = n[ctx];
    const old = p[ctx];
    const ek = `check:${ctx}`;
    if (c) {
      if (old && old.state === c.state) {
        snap[ctx] = { ...c };
      } else {
        const rev = bumpRev(revs, ek);
        const label = CHECK_STATE_LABELS[c.state] || c.state || 'updated';
        events.push(makeEvent(prKey, 'checks', ek, rev, {
          title: old ? 'Check updated' : 'New check',
          target: { url: c.targetUrl },
          body: `${ctx}: ${old ? `${CHECK_STATE_LABELS[old.state] || old.state} → ` : ''}${label}.`,
        }));
        snap[ctx] = { ...c, rev };
      }
    } else if (old) {
      snap[ctx] = { ...old };
    }
  }
  return snap;
}

function diffPolicies(prKey, prev, next, events, revs) {
  const p = prev.policies || {};
  const n = next.policies || {};
  const snap = {};
  const allCfg = new Set([...Object.keys(p), ...Object.keys(n)]);
  for (const cfg of [...allCfg].sort()) {
    const c = n[cfg];
    const old = p[cfg];
    const ek = `policy:${cfg}`;
    if (c) {
      if (old && old.status === c.status) {
        snap[cfg] = { ...c };
      } else {
        const rev = bumpRev(revs, ek);
        const label = POLICY_STATUS_LABELS[c.status] || c.status || 'updated';
        const name = c.name && c.name !== cfg ? c.name : 'Policy';
        events.push(makeEvent(prKey, 'policies', ek, rev, {
          title: old ? 'Policy updated' : 'New policy result',
          body: `${name}: ${old ? `${POLICY_STATUS_LABELS[old.status] || old.status} → ` : ''}${label}.`,
        }));
        snap[cfg] = { ...c, rev };
      }
    } else if (old) {
      snap[cfg] = { ...old };
    }
  }
  return snap;
}

export function effectiveEventTypes(watch, settings) {
  const base = settings?.eventTypes || {};
  if (watch?.eventTypes == null) return { ...base };
  const out = {};
  for (const c of CATEGORIES) out[c] = watch.eventTypes.includes(c);
  return out;
}

export function eventEnabled(event, watch, settings) {
  const eff = effectiveEventTypes(watch, settings);
  return eff[event.category] === true;
}

const INIT_CATEGORIES = ['comments', 'threads', 'reviews', 'reviewers', 'commits', 'lifecycle', 'checks', 'policies'];

function previousInitFlags(prev) {
  const out = {};
  if (prev?.init && typeof prev.init === 'object') {
    for (const c of INIT_CATEGORIES) out[c] = prev.init[c] === true;
    return out;
  }
  for (const c of INIT_CATEGORIES) out[c] = Boolean(prev);
  return out;
}

export function diffPr(prKey, prevSnapshot, data, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const failed = ctx.failed || new Set();
  const prev = prevSnapshot || emptySnapshot();
  const snapshot = emptySnapshot();
  snapshot.revisions = { ...(prev.revisions || {}) };
  const events = [];
  const pr = data?.pr && typeof data.pr === 'object' ? data.pr : null;

  const commentPreviewUpdates = new Map();
  const normThreads = normalizeThreads(data?.threads, pr, ctx.identity);
  const normReviewers = normalizeReviewers(pr);
  const normLifecycle = pr ? normalizeLifecycle(pr) : {};
  const normCommits = pr ? normalizeCommits(pr) : null;
  const normChecks = normalizeChecks(data?.statuses);
  const normPolicies = normalizePolicies(data?.policies);

  const threadsFailed = failed.has('threads') || (data?.threads != null && !normThreads.ok) || data?.threads == null;
  const checksFailed = failed.has('checks') || (data?.statuses != null && !normChecks.ok) || data?.statuses == null;
  const policiesFailed = failed.has('policies') || (data?.policies != null && !normPolicies.ok) || data?.policies == null;
  const prFailed = failed.has('pr') || !pr;
  const reviewersOk = !prFailed && normReviewers.ok;

  const initFlags = previousInitFlags(prevSnapshot);
  const nextInit = { ...initFlags };

  if (threadsFailed) {
    snapshot.comments = { ...(prev.comments || {}) };
    snapshot.threads = { ...(prev.threads || {}) };
  } else {
    const evComments = [];
    const evThreads = [];
    const catchUpRepliesSince = initFlags.comments ? 0 : ctx.catchUpRepliesSince;
    snapshot.comments = diffComments(
      prKey, prev, { comments: normThreads.comments }, evComments, snapshot, commentPreviewUpdates, catchUpRepliesSince,
    );
    snapshot.threads = diffThreads(prKey, prev, { threads: normThreads.threads }, evThreads, snapshot);
    if (initFlags.comments || catchUpRepliesSince) events.push(...evComments);
    if (initFlags.threads) events.push(...evThreads);
    nextInit.comments = true;
    nextInit.threads = true;
  }

  if (prFailed) {
    snapshot.reviewers = { ...(prev.reviewers || {}) };
    snapshot.commits = { ...(prev.commits || {}) };
    snapshot.lifecycle = { ...(prev.lifecycle || {}) };
  } else {
    if (reviewersOk) {
      const evReviewers = [];
      snapshot.reviewers = diffReviewers(prKey, { prev: prev.reviewers || {}, next: normReviewers.reviewers }, evReviewers, snapshot);
      for (const e of evReviewers) {
        if (initFlags[e.category]) events.push(e);
      }
      nextInit.reviewers = true;
      nextInit.reviews = true;
    } else {
      snapshot.reviewers = { ...(prev.reviewers || {}) };
    }
    const evCommits = [];
    snapshot.commits = diffCommits(prKey, prev, { commits: normCommits || {} }, evCommits, snapshot);
    if (initFlags.commits) events.push(...evCommits);
    nextInit.commits = true;
    const evLifecycle = [];
    snapshot.lifecycle = diffLifecycle(prKey, prev, { lifecycle: normLifecycle }, evLifecycle, snapshot);
    if (initFlags.lifecycle) events.push(...evLifecycle);
    nextInit.lifecycle = true;
  }

  if (checksFailed) {
    snapshot.checks = { ...(prev.checks || {}) };
  } else {
    const evChecks = [];
    snapshot.checks = diffChecks(prKey, prev, { checks: normChecks.checks }, evChecks, snapshot);
    if (initFlags.checks) events.push(...evChecks);
    nextInit.checks = true;
  }
  if (policiesFailed) {
    snapshot.policies = { ...(prev.policies || {}) };
  } else {
    const evPolicies = [];
    snapshot.policies = diffPolicies(prKey, prev, { policies: normPolicies.policies }, evPolicies, snapshot);
    if (initFlags.policies) events.push(...evPolicies);
    nextInit.policies = true;
  }

  snapshot.init = nextInit;
  snapshot.observedAt = now;
  return { snapshot, events, commentPreviewUpdates };
}
