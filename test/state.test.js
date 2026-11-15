import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, migrateState, publicState } from '../src/state.js';

test('desktopEnabled defaults to true in defaultState', () => {
  assert.equal(defaultState().settings.desktopEnabled, true);
});

test('missing desktopEnabled migrates to true; explicit false preserved', () => {
  const missing = migrateState({ settings: { organization: 'o' } });
  assert.equal(missing.settings.desktopEnabled, true);
  const explicitFalse = migrateState({ settings: { organization: 'o', desktopEnabled: false } });
  assert.equal(explicitFalse.settings.desktopEnabled, false);
  const explicitTrue = migrateState({ settings: { organization: 'o', desktopEnabled: true } });
  assert.equal(explicitTrue.settings.desktopEnabled, true);
});

test('migration preserves watches, snapshots and PAT; publicState redacts PAT', () => {
  const raw = {
    settings: { organization: 'contoso', identity: { id: 'u1', displayName: 'U' }, desktopEnabled: false },
    credentials: { pat: 'secret-pat' },
    watches: { k1: { key: 'k1', organization: 'contoso', projectId: 'p', projectName: 'P', repoId: 'r', repoName: 'R', prId: 5, url: 'u', title: 't', origin: 'manual', eventTypes: null, status: 'active', isDraft: false, addedAt: 1 } },
    snapshots: { k1: { comments: {} } },
    notifications: [],
  };
  const s = migrateState(raw);
  assert.equal(s.settings.desktopEnabled, false);
  assert.ok(s.watches.k1);
  assert.ok(s.snapshots.k1);
  assert.equal(s.credentials.pat, 'secret-pat');
  const pub = publicState(s);
  assert.equal(JSON.stringify(pub).includes('secret-pat'), false);
  assert.equal(pub.settings.desktopEnabled, false);
});

test('soundEnabled defaults to false; missing migrates false; explicit true/false preserved', () => {
  assert.equal(defaultState().settings.soundEnabled, false);
  const missing = migrateState({ settings: { organization: 'o' } });
  assert.equal(missing.settings.soundEnabled, false);
  const explicitTrue = migrateState({ settings: { organization: 'o', soundEnabled: true } });
  assert.equal(explicitTrue.settings.soundEnabled, true);
  const explicitFalse = migrateState({ settings: { organization: 'o', soundEnabled: false } });
  assert.equal(explicitFalse.settings.soundEnabled, false);
  const truthy = migrateState({ settings: { organization: 'o', soundEnabled: 'yes' } });
  assert.equal(truthy.settings.soundEnabled, false);
});

test('publicState exposes soundEnabled but never the PAT', () => {
  const s = migrateState({
    settings: { organization: 'contoso', soundEnabled: true },
    credentials: { pat: 'secret-pat' },
  });
  const pub = publicState(s);
  assert.equal(pub.settings.soundEnabled, true);
  assert.equal(JSON.stringify(pub).includes('secret-pat'), false);
});
