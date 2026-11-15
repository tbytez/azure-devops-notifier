export type ThemeName = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'azdoNotifier.theme.v1';

export function parseStoredTheme(raw: unknown): ThemeName | null {
  return raw === 'dark' || raw === 'light' ? raw : null;
}

export function systemTheme(): ThemeName {
  try {
    if (typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {}
  return 'light';
}

export function resolveTheme(stored: ThemeName | null, system: ThemeName): ThemeName {
  return stored ?? system;
}

export function readStoredTheme(): ThemeName | null {
  try {
    return parseStoredTheme(globalThis.localStorage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function persistTheme(theme: ThemeName): void {
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
}
