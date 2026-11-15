let demoBridgePromise = null;

function isDemoRequested() {
  try {
    return new URLSearchParams(globalThis.location?.search || '').get('demo') === '1';
  } catch {
    return false;
  }
}

function hasExtensionApi() {
  return typeof globalThis.chrome !== 'undefined' && typeof globalThis.chrome?.runtime?.sendMessage === 'function'
    && typeof globalThis.chrome?.runtime?.id === 'string' && globalThis.chrome.runtime.id.length > 0;
}

export async function getBridge() {
  if (isDemoRequested()) {
    if (!demoBridgePromise) {
      demoBridgePromise = import('../demo.js').then((m) => m.createDemoBridge());
    }
    return demoBridgePromise;
  }
  if (!hasExtensionApi()) {
    return {
      kind: 'unavailable',
      async dispatch() {
        return { ok: false, error: 'This page must be opened inside the Chrome extension (add ?demo=1 for the demo).' };
      },
    };
  }
  return {
    kind: 'extension',
    async dispatch(msg) {
      return new Promise((resolve) => {
        try {
          globalThis.chrome.runtime.sendMessage(msg, (res) => {
            if (globalThis.chrome.runtime.lastError) {
              resolve({ ok: false, error: globalThis.chrome.runtime.lastError.message || 'Extension messaging failed.' });
              return;
            }
            resolve(res || { ok: false, error: 'Empty response from extension.' });
          });
        } catch (e) {
          resolve({ ok: false, error: e?.message || 'Messaging failed.' });
        }
      });
    },
  };
}

export function isDemoMode() {
  return isDemoRequested();
}
