export const AUDIO_TARGET = 'azdo-notifier-audio';

const OFFSCREEN_PATH = 'src/offscreen.html';
const CHROME_116_ERROR = 'Notification sounds need Chrome 116 or newer. Reload the extension to enable them.';
const PLAY_ERROR = 'Sound could not be played. Check Chrome and OS audio settings.';

export function createSoundPlayer(chromeApi) {
  const runtime = chromeApi?.runtime;
  const offscreen = chromeApi?.offscreen;
  let creating = null;

  async function ensureOffscreen() {
    if (typeof runtime?.getContexts !== 'function' || typeof runtime?.sendMessage !== 'function' || typeof offscreen?.createDocument !== 'function') {
      throw new Error(CHROME_116_ERROR);
    }
    const documentUrl = typeof runtime.getURL === 'function' ? runtime.getURL(OFFSCREEN_PATH) : OFFSCREEN_PATH;
    const contexts = await runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [documentUrl],
    });
    const exists = Array.isArray(contexts) && contexts.some((c) => c && (c.documentUrl === documentUrl || c.url === documentUrl));
    if (exists) return;
    await offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play notification sounds for new Azure DevOps pull request activity.',
    });
  }

  function ensure() {
    if (!creating) {
      creating = ensureOffscreen().finally(() => {
        creating = null;
      });
    }
    return creating;
  }

  async function play() {
    await ensure();
    let res;
    try {
      res = await runtime.sendMessage({ target: AUDIO_TARGET, type: 'PLAY_NOTIFICATION_SOUND' });
    } catch (e) {
      throw new Error(e?.message || PLAY_ERROR);
    }
    if (res?.ok !== true) {
      throw new Error(res?.error || PLAY_ERROR);
    }
  }

  return { play };
}
