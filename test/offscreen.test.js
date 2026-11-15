import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initOffscreen } from '../src/offscreen.js';
import { AUDIO_TARGET } from '../src/sound.js';

function fakeChrome() {
  const listeners = [];
  return {
    listeners,
    api: { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) } } },
  };
}

test('initOffscreen installs one listener and returns true; missing API returns false', () => {
  const { api, listeners } = fakeChrome();
  assert.equal(initOffscreen(api, { playSound: async () => {} }), true);
  assert.equal(listeners.length, 1);
  assert.equal(initOffscreen({}, { playSound: async () => {} }), false);
  assert.equal(initOffscreen(undefined, { playSound: async () => {} }), false);
  assert.equal(initOffscreen({ runtime: {} }, { playSound: async () => {} }), false);
});

test('unrelated messages return false and never reply', async () => {
  const { api, listeners } = fakeChrome();
  let plays = 0;
  initOffscreen(api, { playSound: async () => { plays++; } });
  const listener = listeners[0];
  let responded = false;
  const send = () => { responded = true; };
  for (const msg of [
    { type: 'GET_STATE' },
    { target: AUDIO_TARGET, type: 'OTHER' },
    { target: 'someone-else', type: 'PLAY_NOTIFICATION_SOUND' },
    null,
    'string',
  ]) {
    assert.equal(listener(msg, {}, send), false, JSON.stringify(msg));
  }
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(responded, false);
  assert.equal(plays, 0);
});

test('matching message returns true and responds ok only after play resolves', async () => {
  const { api, listeners } = fakeChrome();
  let resolvePlay;
  let plays = 0;
  initOffscreen(api, {
    playSound: () => { plays++; return new Promise((r) => { resolvePlay = r; }); },
  });
  const listener = listeners[0];
  let response = null;
  const ret = listener(
    { target: AUDIO_TARGET, type: 'PLAY_NOTIFICATION_SOUND' },
    {},
    (res) => { response = res; },
  );
  assert.equal(ret, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(plays, 1);
  assert.equal(response, null, 'must not respond before play() resolves');
  resolvePlay();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(response, { ok: true });
});

test('rejected play responds ok:false with the generic sound error', async () => {
  const { api, listeners } = fakeChrome();
  initOffscreen(api, { playSound: async () => { throw new Error('internal device detail'); } });
  const listener = listeners[0];
  const response = await new Promise((resolve) => {
    listener({ target: AUDIO_TARGET, type: 'PLAY_NOTIFICATION_SOUND' }, {}, resolve);
  });
  assert.equal(response.ok, false);
  assert.equal(response.error, 'Sound could not be played. Check Chrome and OS audio settings.');
});
