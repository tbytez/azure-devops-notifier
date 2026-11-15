import { requestDesktopPermission as requestRaw } from '../../../src/ui/notifications.js';

export function requestDesktopPermission(): Promise<boolean> {
  return requestRaw() as Promise<boolean>;
}

export function canRequestDesktopPermission(): boolean {
  try {
    return typeof globalThis.chrome !== 'undefined'
      && typeof globalThis.chrome?.permissions?.request === 'function';
  } catch {
    return false;
  }
}
