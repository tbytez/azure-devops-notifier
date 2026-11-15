import { createAudioPlayer } from './audio-player.js';
import { AUDIO_TARGET } from './sound.js';

const SOUND_URL = new URL('../assets/sounds/notification.wav', import.meta.url).href;
const play = createAudioPlayer({ url: SOUND_URL });

const PLAY_ERROR = 'Sound could not be played. Check Chrome and OS audio settings.';

export function initOffscreen(chromeApi, { playSound = play } = {}) {
  const runtime = chromeApi?.runtime;
  if (typeof runtime?.onMessage?.addListener !== 'function') return false;
  runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.target !== AUDIO_TARGET || msg?.type !== 'PLAY_NOTIFICATION_SOUND') return false;
    playSound().then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false, error: PLAY_ERROR }),
    );
    return true;
  });
  return true;
}

initOffscreen(globalThis.chrome);
