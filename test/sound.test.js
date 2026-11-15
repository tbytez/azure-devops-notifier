import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSoundPlayer, AUDIO_TARGET } from '../src/sound.js';
import { createAudioPlayer } from '../src/audio-player.js';

const OFFSCREEN_URL = 'chrome-extension://test/src/offscreen.html';

function fakeChrome(over = {}) {
  const calls = { getContexts: [], createDocument: [], sendMessage: [] };
  const api = {
    runtime: {
      getURL: (p) => `chrome-extension://test/${p}`,
      getContexts: over.getContexts || (async (q) => { calls.getContexts.push(q); return over.contexts || []; }),
      sendMessage: over.sendMessage || (async (m) => { calls.sendMessage.push(m); return { ok: true }; }),
    },
    ...(over.noOffscreen ? {} : {
      offscreen: {
        createDocument: over.createDocument || (async (o) => { calls.createDocument.push(o); }),
      },
    }),
  };
  return { api, calls };
}

test('AUDIO_TARGET is the offscreen audio message target', () => {
  assert.equal(AUDIO_TARGET, 'azdo-notifier-audio');
});

test('play creates offscreen document with AUDIO_PLAYBACK when none exists, then sends message', async () => {
  const { api, calls } = fakeChrome();
  const player = createSoundPlayer(api);
  await player.play();
  assert.equal(calls.getContexts.length, 1);
  assert.deepEqual(calls.getContexts[0], {
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL],
  });
  assert.equal(calls.createDocument.length, 1);
  assert.equal(calls.createDocument[0].url, 'src/offscreen.html');
  assert.deepEqual(calls.createDocument[0].reasons, ['AUDIO_PLAYBACK']);
  assert.equal(calls.createDocument[0].justification, 'Play notification sounds for new Azure DevOps pull request activity.');
  assert.equal(calls.sendMessage.length, 1);
  assert.deepEqual(calls.sendMessage[0], { target: AUDIO_TARGET, type: 'PLAY_NOTIFICATION_SOUND' });
});

test('play reuses existing offscreen document at the exact URL without creating', async () => {
  const { api, calls } = fakeChrome({
    contexts: [{ contextType: 'OFFSCREEN_DOCUMENT', documentUrl: OFFSCREEN_URL }],
  });
  const player = createSoundPlayer(api);
  await player.play();
  await player.play();
  assert.equal(calls.createDocument.length, 0);
  assert.equal(calls.sendMessage.length, 2);
});

test('concurrent play calls create only one offscreen document', async () => {
  let resolveCreate;
  const { api, calls } = fakeChrome({
    createDocument: () => new Promise((r) => { resolveCreate = r; calls.createDocument.push({ url: 'src/offscreen.html' }); }),
  });
  const player = createSoundPlayer(api);
  const p1 = player.play();
  const p2 = player.play();
  const p3 = player.play();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.createDocument.length, 1);
  resolveCreate();
  await Promise.all([p1, p2, p3]);
  assert.equal(calls.sendMessage.length, 3);
});

test('creation failure rejects play and permits retry', async () => {
  let attempts = 0;
  const { api, calls } = fakeChrome({
    createDocument: async () => { attempts++; if (attempts === 1) throw new Error('cannot create'); },
  });
  const player = createSoundPlayer(api);
  await assert.rejects(() => player.play(), /cannot create/);
  await player.play();
  assert.equal(attempts, 2);
  assert.equal(calls.sendMessage.length, 1);
});

test('missing or false sendMessage response rejects with friendly error', async () => {
  const { api } = fakeChrome({ sendMessage: async () => undefined });
  const player = createSoundPlayer(api);
  await assert.rejects(() => player.play(), /Sound could not be played/);

  const { api: api2 } = fakeChrome({ sendMessage: async () => ({ ok: false, error: 'device muted' }) });
  const player2 = createSoundPlayer(api2);
  await assert.rejects(() => player2.play(), /device muted/);
});

test('sendMessage rejection propagates as friendly error', async () => {
  const { api } = fakeChrome({
    contexts: [{ documentUrl: OFFSCREEN_URL }],
    sendMessage: async () => { throw new Error('message channel closed'); },
  });
  const player = createSoundPlayer(api);
  await assert.rejects(() => player.play(), /message channel closed/);
});

test('missing Chrome audio APIs throw Chrome 116 reload error', async () => {
  const player = createSoundPlayer({ runtime: {} });
  await assert.rejects(() => player.play(), /Chrome 116/);
  const player2 = createSoundPlayer(undefined);
  await assert.rejects(() => player2.play(), /Chrome 116/);
});

test('runtime messaging present but chrome.offscreen absent fails friendly', async () => {
  const { api } = fakeChrome({ noOffscreen: true });
  assert.equal(typeof api.runtime.getContexts, 'function');
  assert.equal(typeof api.runtime.sendMessage, 'function');
  assert.equal(api.runtime.createDocument, undefined, 'real Chrome has no runtime.createDocument');
  const player = createSoundPlayer(api);
  await assert.rejects(() => player.play(), /Chrome 116/);
});

test('audio player factory is lazy, sets volume, restarts on replay, propagates play rejection', async () => {
  const instances = [];
  class FakeAudio {
    constructor(url) { this.url = url; this.volume = 1; this.paused = true; this.currentTime = 0; instances.push(this); }
    pause() { this.paused = true; }
    async play() { this.paused = false; }
  }
  const play = createAudioPlayer({ url: 'sound.wav', AudioCtor: FakeAudio, volume: 0.35 });
  assert.equal(instances.length, 0, 'Audio must not be constructed before first play');
  await play();
  assert.equal(instances.length, 1);
  assert.equal(instances[0].url, 'sound.wav');
  assert.equal(instances[0].volume, 0.35);
  instances[0].currentTime = 0.2;
  await play();
  assert.equal(instances.length, 1, 'replay reuses the same Audio instance');
  assert.equal(instances[0].currentTime, 0, 'replay resets currentTime');

  class FailAudio {
    constructor() {}
    pause() {}
    async play() { throw new Error('autoplay blocked'); }
  }
  const failPlay = createAudioPlayer({ url: 'x.wav', AudioCtor: FailAudio });
  await assert.rejects(() => failPlay(), /autoplay blocked/);
});
