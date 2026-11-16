import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPr, eventEnabled, effectiveEventTypes, CATEGORIES } from '../src/core.js';

const KEY = 'contoso/p1/r1/1';
const NOW = 1700000000000;

function prData(over = {}) {
  return {
    pr: {
      status: 'active',
      isDraft: false,
      title: 'My PR',
      targetRefName: 'refs/heads/main',
      reviewers: [],
      lastMergeSourceCommit: { commitId: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555' },
      ...over.pr,
    },
    threads: over.threads ?? { value: [] },
    statuses: over.statuses ?? { value: [] },
    policies: over.policies ?? { value: [] },
  };
}

function thread(id, status, comments = []) {
  return { id, status, comments };
}
function comment(id, content, author = { id: 'u1', displayName: 'Alice' }, extra = {}) {
  return {
    id,
    content,
    lastUpdatedDate: '2026-01-01T00:00:00Z',
    publishedDate: '2026-01-01T00:00:00Z',
    author,
    commentType: 'text',
    ...extra,
  };
}
function reviewer(id, name, vote = 0, extra = {}) {
  return { id, displayName: name, vote, isRequired: false, hasDeclined: false, ...extra };
}
function status(id, ctx, state, created = '2026-01-01T00:00:00Z') {
  return { id, context: { genre: 'g', name: ctx }, state, creationDate: created };
}
function policy(cfgId, evalId, st, completed = '2026-01-01T00:00:00Z') {
  return { evaluationId: evalId, status: st, configuration: { id: cfgId, type: { displayName: `Policy ${cfgId}` } }, completedDate: completed };
}

test('first diff baselines quietly per category and marks categories initialized', () => {
  const data = prData({
    threads: { value: [thread(1, 'active', [comment(11, 'hello')])] },
    statuses: { value: [status(1, 'build', 'succeeded')] },
  });
  const { snapshot, events } = diffPr(KEY, null, data, { now: NOW });
  assert.equal(events.length, 0);
  assert.equal(snapshot.comments['1:11'].hash, 'hello');
  assert.equal(snapshot.init.comments, true);
  assert.equal(snapshot.init.checks, true);
  assert.equal(snapshot.init.policies, true);
});

test('identical replay produces no events', () => {
  const data = prData({
    threads: { value: [thread(1, 'active', [comment(11, 'hello')])] },
    statuses: { value: [status(1, 'build', 'succeeded'), status(2, 'lint', 'pending')] },
  });
  const first = diffPr(KEY, null, data, { now: NOW });
  const second = diffPr(KEY, first.snapshot, data, { now: NOW + 1000 });
  assert.equal(second.events.length, 0);
});

test('new and edited comments detected; system/deleted ignored', () => {
  const base = prData({
    threads: {
      value: [
        thread(1, 'active', [comment(11, 'first'), comment(12, 'sys', null, { commentType: 'system' })]),
        thread(2, 'active', [comment(21, 'gone', null, { isDeleted: true })]),
      ],
    },
  });
  const s1 = diffPr(KEY, null, base, { now: NOW }).snapshot;
  const edited = prData({
    threads: {
      value: [
        thread(1, 'active', [comment(11, 'first edited', null, { lastUpdatedDate: '2026-01-02T00:00:00Z' }), comment(13, 'brand new')]),
        thread(2, 'active', [comment(21, 'gone', null, { isDeleted: true })]),
      ],
    },
  });
  const { events } = diffPr(KEY, s1, edited, { now: NOW + 1000 });
  const titles = events.filter((e) => e.category === 'comments').map((e) => e.title);
  assert.deepEqual(titles.sort(), ['Comment edited', 'New comment']);
});

test('thread resolution and reopen produce events', () => {
  const base = prData({ threads: { value: [thread(1, 'active', [comment(11, 'x')])] } });
  const s1 = diffPr(KEY, null, base, { now: NOW }).snapshot;
  const resolved = prData({ threads: { value: [thread(1, 'fixed', [comment(11, 'x')])] } });
  const e1 = diffPr(KEY, s1, resolved, { now: NOW + 1 }).events;
  assert.ok(e1.some((e) => e.category === 'threads' && e.title === 'Thread resolved'));
  const s2 = diffPr(KEY, s1, resolved, { now: NOW + 1 }).snapshot;
  const reopened = prData({ threads: { value: [thread(1, 'active', [comment(11, 'x')])] } });
  const e2 = diffPr(KEY, s2, reopened, { now: NOW + 2 }).events;
  assert.ok(e2.some((e) => e.category === 'threads' && e.title === 'Thread reopened'));
});

test('every review vote and reset produces distinct events', () => {
  const mk = (vote) => prData({ pr: { reviewers: [reviewer('u2', 'Bob', vote)] } });
  let snap = diffPr(KEY, null, mk(0), { now: NOW }).snapshot;
  const seen = [];
  for (const v of [10, 5, 0, -5, -10]) {
    const { snapshot, events } = diffPr(KEY, snap, mk(v), { now: NOW + seen.length + 1 });
    snap = snapshot;
    for (const e of events.filter((x) => x.category === 'reviews')) seen.push(e.body);
  }
  assert.equal(seen.length, 5);
  assert.ok(seen.some((b) => b.includes('approved')));
  assert.ok(seen.some((b) => b.includes('reset their vote')));
  assert.ok(seen.some((b) => b.includes('rejected')));
});

test('approved -> rejected -> approved alerts twice with unique ids', () => {
  const mk = (vote) => prData({ pr: { reviewers: [reviewer('u2', 'Bob', vote)] } });
  let snap = diffPr(KEY, null, mk(10), { now: NOW }).snapshot;
  let r = diffPr(KEY, snap, mk(-10), { now: NOW + 1 });
  snap = r.snapshot;
  const rej = r.events.find((e) => e.category === 'reviews');
  r = diffPr(KEY, snap, mk(10), { now: NOW + 2 });
  snap = r.snapshot;
  const app = r.events.find((e) => e.category === 'reviews');
  assert.ok(rej && app);
  assert.notEqual(rej.id, app.id);
});

test('reviewer added/removed and required flag', () => {
  const base = prData({ pr: { reviewers: [reviewer('u2', 'Bob')] } });
  const s1 = diffPr(KEY, null, base, { now: NOW }).snapshot;
  const added = prData({ pr: { reviewers: [reviewer('u2', 'Bob'), reviewer('u3', 'Cara', 0, { isRequired: true })] } });
  const e1 = diffPr(KEY, s1, added, { now: NOW + 1 }).events;
  assert.ok(e1.some((e) => e.title === 'Reviewer added' && e.body.includes('Cara')));
  const s2 = diffPr(KEY, s1, added, { now: NOW + 1 }).snapshot;
  const req = prData({ pr: { reviewers: [reviewer('u2', 'Bob', 0, { isRequired: true }), reviewer('u3', 'Cara', 0, { isRequired: true })] } });
  const e2 = diffPr(KEY, s2, req, { now: NOW + 2 }).events;
  assert.ok(e2.some((e) => e.title === 'Reviewer required'));
  const removed = prData({ pr: { reviewers: [reviewer('u2', 'Bob', 0, { isRequired: true })] } });
  const s3 = diffPr(KEY, s2, req, { now: NOW + 2 }).snapshot;
  const e3 = diffPr(KEY, s3, removed, { now: NOW + 3 }).events;
  assert.ok(e3.some((e) => e.title === 'Reviewer removed' && e.body.includes('Cara')));
});

test('source commit change produces single summary event', () => {
  const base = prData();
  const s1 = diffPr(KEY, null, base, { now: NOW }).snapshot;
  const moved = prData({ pr: { lastMergeSourceCommit: { commitId: 'ffff0000ffff0000ffff0000ffff0000ffff0000' } } });
  const { events } = diffPr(KEY, s1, moved, { now: NOW + 1 });
  const commitEvents = events.filter((e) => e.category === 'commits');
  assert.equal(commitEvents.length, 1);
  assert.equal(commitEvents[0].title, 'New commits');
});

test('lifecycle: status, draft, title, target changes', () => {
  const base = prData();
  const s1 = diffPr(KEY, null, base, { now: NOW }).snapshot;
  const changed = prData({
    pr: {
      status: 'completed',
      isDraft: true,
      title: 'Renamed PR',
      targetRefName: 'refs/heads/release',
    },
  });
  const { events } = diffPr(KEY, s1, changed, { now: NOW + 1 });
  const titles = events.map((e) => e.title);
  assert.ok(titles.includes('Status changed'));
  assert.ok(titles.includes('Converted to draft'));
  assert.ok(titles.includes('Title changed'));
  assert.ok(titles.includes('Target branch changed'));
});

test('checks: latest wins per context regardless of order/id', () => {
  const s1 = diffPr(KEY, null, prData({ statuses: { value: [status(1, 'build', 'pending', '2026-01-01T00:00:00Z')] } }), { now: NOW }).snapshot;
  const reordered = prData({
    statuses: { value: [
      status(9, 'build', 'succeeded', '2026-01-02T00:00:00Z'),
      status(1, 'build', 'pending', '2026-01-01T00:00:00Z'),
    ] },
  });
  const { events, snapshot } = diffPr(KEY, s1, reordered, { now: NOW + 1 });
  const checkEvents = events.filter((e) => e.category === 'checks');
  assert.equal(checkEvents.length, 1);
  assert.ok(checkEvents[0].body.includes('succeeded'));
  assert.equal(snapshot.checks['g/build'].state, 'succeeded');
});

test('checks: same context newest date wins over higher id and response order', () => {
  const s1 = diffPr(KEY, null, prData({ statuses: { value: [status(5, 'build', 'pending', '2026-01-01T00:00:00Z')] } }), { now: NOW }).snapshot;
  const mixed = prData({
    statuses: { value: [
      status(9, 'build', 'succeeded', '2026-01-04T00:00:00Z'),
      status(8, 'build', 'failed', '2026-01-02T00:00:00Z'),
    ] },
  });
  const { events, snapshot } = diffPr(KEY, s1, mixed, { now: NOW + 1 });
  assert.equal(events.filter((e) => e.category === 'checks').length, 1);
  assert.ok(events.find((e) => e.category === 'checks').body.includes('succeeded'));
  assert.equal(snapshot.checks['g/build'].state, 'succeeded');
});

test('policies: stable config id, new evaluation ids, status changes', () => {
  const s1 = diffPr(KEY, null, prData({ policies: { value: [policy('cfg1', 100, 'queued', '2026-01-01T00:00:00Z')] } }), { now: NOW }).snapshot;
  const updated = prData({ policies: { value: [policy('cfg1', 200, 'approved', '2026-01-02T00:00:00Z')] } });
  const { events } = diffPr(KEY, s1, updated, { now: NOW + 1 });
  const pol = events.filter((e) => e.category === 'policies');
  assert.equal(pol.length, 1);
  assert.ok(pol[0].body.includes('approved'));
});

test('failed categories preserve prior snapshot without events', () => {
  const data = prData({
    threads: { value: [thread(1, 'active', [comment(11, 'x')])] },
    statuses: { value: [status(1, 'build', 'succeeded')] },
  });
  const s1 = diffPr(KEY, null, data, { now: NOW }).snapshot;
  const partial = prData({ threads: null, statuses: null, policies: null });
  partial.threads = null;
  const { snapshot, events } = diffPr(KEY, s1, partial, { now: NOW + 1, failed: new Set(['threads', 'checks', 'policies']) });
  assert.equal(snapshot.comments['1:11'].hash, 'x');
  assert.equal(snapshot.checks['g/build'].state, 'succeeded');
  assert.equal(events.length, 0);
});

test('eventEnabled honors per-watch override and global settings', () => {
  const settings = { eventTypes: Object.fromEntries(CATEGORIES.map((c) => [c, true])) };
  const ev = { category: 'comments' };
  assert.equal(eventEnabled(ev, { eventTypes: null }, settings), true);
  assert.equal(eventEnabled(ev, { eventTypes: ['threads'] }, settings), false);
  assert.equal(eventEnabled(ev, { eventTypes: ['comments'] }, settings), true);
  const off = { eventTypes: { ...settings.eventTypes, comments: false } };
  assert.equal(eventEnabled(ev, { eventTypes: null }, off), false);
  assert.equal(eventEnabled(ev, { eventTypes: [] }, off), false);
  assert.deepEqual(Object.keys(effectiveEventTypes({ eventTypes: null }, settings)), CATEGORIES);
});

test('comment ids are scoped per thread: same id in two threads coexist', () => {
  const data = prData({
    threads: { value: [
      thread(1, 'active', [comment(1, 'first thread comment', { id: 'a', displayName: 'A' })]),
      thread(2, 'active', [comment(1, 'second thread comment', { id: 'b', displayName: 'B' })]),
    ] },
  });
  const { snapshot } = diffPr(KEY, null, data, { now: NOW });
  assert.ok(snapshot.comments['1:1']);
  assert.ok(snapshot.comments['2:1']);
  assert.equal(Object.keys(snapshot.comments).length, 2);
});

test('reordering threads and comments produces no events', () => {
  const c1 = comment(1, 'alpha');
  const c2 = comment(2, 'beta');
  const x = comment(1, 'other thread', { id: 'z', displayName: 'Z' });
  const data1 = prData({ threads: { value: [thread(1, 'active', [c1, c2]), thread(2, 'active', [x])] } });
  const s1 = diffPr(KEY, null, data1, { now: NOW }).snapshot;
  const data2 = prData({ threads: { value: [thread(2, 'active', [x]), thread(1, 'active', [c2, c1])] } });
  const { events } = diffPr(KEY, s1, data2, { now: NOW + 1 });
  assert.equal(events.filter((e) => e.category === 'comments' || e.category === 'threads').length, 0);
});

test('editing comment id 1 in thread 1 does not touch same-id comment in thread 2', () => {
  const data1 = prData({ threads: { value: [
    thread(1, 'active', [comment(1, 'v1', { id: 'a', displayName: 'A' })]),
    thread(2, 'active', [comment(1, 'keep', { id: 'b', displayName: 'B' })]),
  ] } });
  const s1 = diffPr(KEY, null, data1, { now: NOW }).snapshot;
  const data2 = prData({ threads: { value: [
    thread(1, 'active', [comment(1, 'v2 edited', { id: 'a', displayName: 'A' }, { lastUpdatedDate: '2026-01-02T00:00:00Z' })]),
    thread(2, 'active', [comment(1, 'keep', { id: 'b', displayName: 'B' })]),
  ] } });
  const { events } = diffPr(KEY, s1, data2, { now: NOW + 1 });
  const commentEvents = events.filter((e) => e.category === 'comments');
  assert.equal(commentEvents.length, 1);
  assert.equal(commentEvents[0].entityKey, 'comment:1:1');
  assert.equal(commentEvents[0].title, 'Comment edited');
});

test('comment metadata-only timestamp change does not emit edit', () => {
  const data1 = prData({ threads: { value: [thread(1, 'active', [comment(1, 'same text')])] } });
  const s1 = diffPr(KEY, null, data1, { now: NOW }).snapshot;
  const data2 = prData({ threads: { value: [thread(1, 'active', [comment(1, 'same text', null, { lastUpdatedDate: '2026-02-02T00:00:00Z' })])] } });
  const { events } = diffPr(KEY, s1, data2, { now: NOW + 1 });
  assert.equal(events.filter((e) => e.category === 'comments').length, 0);
});

test('policy numeric configuration.id is tracked with GUID evaluation tiebreak', () => {
  const mk = (evalId, st, completed) => prData({ policies: { value: [{
    evaluationId: evalId, status: st,
    configuration: { id: 42, type: { displayName: 'Require reviewers' } },
    completedDate: completed, startedDate: completed,
  }] } });
  const s1 = diffPr(KEY, null, mk('eval-guid-1', 'queued', '2026-01-01T00:00:00Z'), { now: NOW }).snapshot;
  assert.ok(s1.policies['42']);
  assert.equal(s1.policies['42'].status, 'queued');
  const e1 = diffPr(KEY, s1, mk('eval-guid-2', 'approved', '2026-01-02T00:00:00Z'), { now: NOW + 1 });
  const pol1 = e1.events.filter((e) => e.category === 'policies');
  assert.equal(pol1.length, 1);
  const s2 = e1.snapshot;
  const e2 = diffPr(KEY, s2, mk('eval-guid-3', 'approved', '2026-01-02T00:00:00Z'), { now: NOW + 2 });
  assert.equal(e2.events.filter((e) => e.category === 'policies').length, 0);
  const reordered = prData({ policies: { value: [
    { evaluationId: 'eval-guid-9', status: 'rejected', configuration: { id: 42, type: { displayName: 'Require reviewers' } }, completedDate: '2026-01-01T12:00:00Z' },
    { evaluationId: 'eval-guid-2', status: 'approved', configuration: { id: 42, type: { displayName: 'Require reviewers' } }, completedDate: '2026-01-02T00:00:00Z' },
  ] } });
  const e3 = diffPr(KEY, s2, reordered, { now: NOW + 3 });
  assert.equal(e3.events.filter((e) => e.category === 'policies').length, 0);
  assert.equal(e3.snapshot.policies['42'].status, 'approved');
});

test('reviewer removal emits once, re-add yields unique membership ids', () => {
  const withBob = () => prData({ pr: { reviewers: [reviewer('u2', 'Bob')] } });
  const noRev = () => prData({ pr: { reviewers: [] } });
  let snap = diffPr(KEY, null, withBob(), { now: NOW }).snapshot;
  let r = diffPr(KEY, snap, noRev(), { now: NOW + 1 });
  snap = r.snapshot;
  const rem1 = r.events.filter((e) => e.title === 'Reviewer removed');
  assert.equal(rem1.length, 1);
  r = diffPr(KEY, snap, noRev(), { now: NOW + 2 });
  snap = r.snapshot;
  assert.equal(r.events.filter((e) => e.title === 'Reviewer removed').length, 0);
  r = diffPr(KEY, snap, withBob(), { now: NOW + 3 });
  snap = r.snapshot;
  const add = r.events.filter((e) => e.title === 'Reviewer added');
  assert.equal(add.length, 1);
  r = diffPr(KEY, snap, noRev(), { now: NOW + 4 });
  snap = r.snapshot;
  const rem2 = r.events.filter((e) => e.title === 'Reviewer removed');
  assert.equal(rem2.length, 1);
  assert.notEqual(rem1[0].id, rem2[0].id);
});

test('missing reviewers array preserves last-known reviewers without removals', () => {
  const withBob = () => prData({ pr: { reviewers: [reviewer('u2', 'Bob')] } });
  const snap = diffPr(KEY, null, withBob(), { now: NOW }).snapshot;
  const noField = prData();
  delete noField.pr.reviewers;
  const r1 = diffPr(KEY, snap, noField, { now: NOW + 1 });
  assert.equal(r1.events.filter((e) => e.title === 'Reviewer removed').length, 0);
  assert.ok(r1.snapshot.reviewers['u2']);
  assert.equal(r1.snapshot.init.reviewers, true);
  const empty = prData({ pr: { reviewers: [] } });
  const r2 = diffPr(KEY, r1.snapshot, empty, { now: NOW + 2 });
  assert.equal(r2.events.filter((e) => e.title === 'Reviewer removed').length, 1);
});

test('new reviewer with nonzero vote emits membership and reviews events', () => {
  const s1 = diffPr(KEY, null, prData({ pr: { reviewers: [] } }), { now: NOW }).snapshot;
  const data = prData({ pr: { reviewers: [reviewer('u9', 'Zed', 10)] } });
  const { events } = diffPr(KEY, s1, data, { now: NOW + 1 });
  assert.ok(events.some((e) => e.category === 'reviewers' && e.title === 'Reviewer added'));
  assert.ok(events.some((e) => e.category === 'reviews' && e.actorId === 'u9'));
});

test('membership and required events carry null actor; votes carry reviewer actor', () => {
  const s1 = diffPr(KEY, null, prData({ pr: { reviewers: [] } }), { now: NOW }).snapshot;
  const data = prData({ pr: { reviewers: [reviewer('u9', 'Zed', 10, { isRequired: true })] } });
  const { events } = diffPr(KEY, s1, data, { now: NOW + 1 });
  const added = events.find((e) => e.title === 'Reviewer added');
  assert.equal(added.actorId, null);
  assert.equal(added.actorName, null);
  const vote = events.find((e) => e.category === 'reviews');
  assert.equal(vote.actorId, 'u9');
  assert.equal(vote.actorName, 'Zed');
});

test('failed subresource leaves category uninitialized; recovery baselines quietly', () => {
  const data1 = { pr: prData().pr, threads: null, statuses: { value: [status(1, 'build', 'succeeded')] }, policies: null };
  const r1 = diffPr(KEY, null, data1, { now: NOW });
  assert.equal(r1.events.length, 0);
  assert.equal(r1.snapshot.init.comments, false);
  assert.equal(r1.snapshot.init.checks, true);
  assert.equal(r1.snapshot.init.policies, false);
  const data2 = {
    pr: prData().pr,
    threads: { value: [thread(1, 'active', [comment(1, 'old historical')])] },
    statuses: { value: [status(1, 'build', 'succeeded')] },
    policies: { value: [policy('cfg1', 'e1', 'approved')] },
  };
  const r2 = diffPr(KEY, r1.snapshot, data2, { now: NOW + 1 });
  assert.equal(r2.events.filter((e) => ['comments', 'threads', 'policies'].includes(e.category)).length, 0);
  assert.equal(r2.snapshot.init.comments, true);
  assert.equal(r2.snapshot.init.policies, true);
  const data3 = {
    pr: prData().pr,
    threads: { value: [thread(1, 'active', [comment(1, 'old historical'), comment(2, 'brand new')])] },
    statuses: { value: [status(1, 'build', 'succeeded')] },
    policies: { value: [policy('cfg1', 'e1', 'approved')] },
  };
  const r3 = diffPr(KEY, r2.snapshot, data3, { now: NOW + 2 });
  const news = r3.events.filter((e) => e.category === 'comments');
  assert.equal(news.length, 1);
  assert.equal(news[0].title, 'New comment');
});

test('outage after initialization preserves snapshot; recovery emits only genuine changes', () => {
  const good = prData({
    threads: { value: [thread(1, 'active', [comment(1, 'stable')])] },
    statuses: { value: [status(1, 'build', 'succeeded')] },
  });
  const s1 = diffPr(KEY, null, good, { now: NOW }).snapshot;
  const outage = { pr: good.pr, threads: null, statuses: null, policies: null };
  const r1 = diffPr(KEY, s1, outage, { now: NOW + 1, failed: new Set(['threads', 'checks', 'policies']) });
  assert.equal(r1.snapshot.comments['1:1'].hash, 'stable');
  assert.equal(r1.snapshot.init.comments, true);
  const recovered = prData({
    threads: { value: [thread(1, 'active', [comment(1, 'stable'), comment(2, 'after outage')])] },
    statuses: { value: [status(1, 'build', 'succeeded')] },
  });
  const r2 = diffPr(KEY, r1.snapshot, recovered, { now: NOW + 2 });
  const news = r2.events.filter((e) => e.category === 'comments');
  assert.equal(news.length, 1);
  assert.equal(news[0].title, 'New comment');
});
