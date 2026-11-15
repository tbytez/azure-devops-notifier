import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNotificationUrl } from '../src/urls.js';
import { createStorageState, defaultState, migrateState, publicState } from '../src/state.js';

const PR = 'https://dev.azure.com/contoso/Project/_git/repo/pullrequest/12';
const KEY = 'contoso/project-id/repo-id/12';
const comment = (thread = 42) => ({
  key: KEY, category: 'comments', id: `${KEY}|comments|comment:${thread}:7|1`,
});

test('comment and thread events link to their discussion, not the comment ID', () => {
  assert.equal(buildNotificationUrl(PR, comment()), `${PR}?_a=overview&discussionId=42`);
  assert.equal(buildNotificationUrl(PR, comment(91)), `${PR}?_a=overview&discussionId=91`);
  assert.equal(buildNotificationUrl(PR, {
    category: 'threads', entityKey: 'thread:42:status',
  }), `${PR}?_a=overview&discussionId=42`);
});

test('inline comments retain safely encoded file context, without inventing reply anchors', () => {
  const path = '/src/a # & \u00e9.ts';
  const url = new URL(buildNotificationUrl(PR, { ...comment(), target: { filePath: path } }));
  assert.equal(url.searchParams.get('_a'), 'files');
  assert.equal(url.searchParams.get('discussionId'), '42');
  assert.equal(url.searchParams.get('path'), path);
  assert.equal(url.searchParams.has('commentId'), false);
  assert.equal(url.hash, '');
});

test('legacy recovery only accepts whole matching event IDs and safe positive integers', () => {
  for (const id of [
    `${KEY}|comments|comment:0:7|1`, `${KEY}|comments|comment:42:7|0`,
    `${KEY}|comments|comment:42:7|1|extra`, `other|comments|comment:42:7|1`,
    `${KEY}|comments|comment:9007199254740992:7|1`, 'demo-n-1',
  ]) assert.equal(buildNotificationUrl(PR, { ...comment(), id }), PR, id);
});

test('stored deep links survive sanitization; mismatched or unsafe destinations cannot override them', () => {
  const valid = `${PR}?_a=files&discussionId=42&path=%2Fsrc%2Fa.ts`;
  assert.equal(buildNotificationUrl(PR, { ...comment(), url: valid }), valid);
  for (const url of [
    'javascript:alert(1)', 'http://dev.azure.com/contoso/Project/_git/repo/pullrequest/12',
    `${PR.replace('contoso', 'other')}?discussionId=42`,
    `${PR.replace('dev.azure.com', 'dev.azure.com.evil.test')}?discussionId=42`,
    `${PR.replace('https://', 'https://user:pass@')}?discussionId=42`,
    `${PR.replace('dev.azure.com', 'dev.azure.com:444')}?discussionId=42`,
    `${PR}?discussionId=99`, `${PR}/../../pullrequest/12?discussionId=42`,
  ]) assert.equal(buildNotificationUrl(PR, { ...comment(), url }), `${PR}?_a=overview&discussionId=42`, url);
});

test('new commit and Azure build-check events target their details; unsupported external checks fall back', () => {
  const sha = 'a'.repeat(40);
  const commitUrl = PR.replace('/pullrequest/12', `/commit/${sha}`);
  assert.equal(buildNotificationUrl(PR, { category: 'commits', target: { commitId: sha } }), commitUrl);
  assert.equal(buildNotificationUrl(PR, { category: 'commits', url: commitUrl }), commitUrl);
  assert.equal(buildNotificationUrl(PR, { category: 'commits' }), `${PR}?_a=commits`);
  const build = 'https://dev.azure.com/contoso/Project/_build/results?buildId=123';
  assert.equal(buildNotificationUrl(PR, { category: 'checks', target: { url: `${build}&view=results` } }), build);
  for (const url of [build.replace('contoso', 'other'), build.replace('Project', 'Other'), 'https://ci.example.com/check/123']) {
    assert.equal(buildNotificationUrl(PR, { category: 'checks', target: { url } }), PR);
  }
});

test('historical discussions upgrade without a watch, preserving history and read state through storage', async () => {
  const raw = defaultState();
  raw.notifications = [{
    ...comment(), url: PR, prId: 12, title: 'New comment', createdAt: 123,
    read: true, readAt: 456, body: 'Existing history',
  }];
  let stored = raw;
  const store = createStorageState({
    get: async (key) => ({ [key]: stored }),
    set: async (items) => { stored = items[store.key]; },
  });
  const state = await store.load();
  assert.equal(state.notifications[0].url, `${PR}?_a=overview&discussionId=42`);
  assert.equal(state.notifications[0].prUrl, PR);
  assert.equal(state.notifications[0].id, raw.notifications[0].id);
  assert.equal(state.notifications[0].readAt, 456);
  assert.equal(state.notifications[0].createdAt, 123);
  await store.save(state);
  assert.deepEqual(await store.load(), state);
  assert.deepEqual(migrateState(state), state);
  assert.equal(publicState(state).notifications[0].url, state.notifications[0].url);
});
