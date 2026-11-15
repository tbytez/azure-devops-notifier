import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestDesktopPermission } from '../src/ui/notifications.js';

test('requestDesktopPermission returns false when chrome permissions API is absent', async () => {
  const prev = globalThis.chrome;
  delete globalThis.chrome;
  try {
    assert.equal(await requestDesktopPermission(), false);
  } finally {
    globalThis.chrome = prev;
  }
});

test('requestDesktopPermission invokes request synchronously and resolves grant', async () => {
  const calls = [];
  const prev = globalThis.chrome;
  globalThis.chrome = {
    permissions: {
      request: (opts) => {
        calls.push(opts);
        return Promise.resolve(true);
      },
    },
  };
  try {
    const p = requestDesktopPermission();
    assert.equal(calls.length, 1, 'permissions.request must be invoked synchronously');
    assert.deepEqual(calls[0], { permissions: ['notifications'] });
    assert.equal(await p, true);
  } finally {
    globalThis.chrome = prev;
  }
});

test('requestDesktopPermission resolves false on denial, throw, and missing request fn', async () => {
  const prev = globalThis.chrome;
  try {
    globalThis.chrome = { permissions: { request: () => Promise.resolve(false) } };
    assert.equal(await requestDesktopPermission(), false);
    globalThis.chrome = { permissions: { request: () => { throw new Error('no gesture'); } } };
    assert.equal(await requestDesktopPermission(), false);
    globalThis.chrome = { permissions: {} };
    assert.equal(await requestDesktopPermission(), false);
    globalThis.chrome = {};
    assert.equal(await requestDesktopPermission(), false);
  } finally {
    globalThis.chrome = prev;
  }
});
