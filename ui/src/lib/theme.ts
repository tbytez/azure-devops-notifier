import {
  THEME_STORAGE_KEY,
  parseStoredTheme,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  systemTheme,
  type ThemeName,
} from './theme-core';

export type { ThemeName };
export { THEME_STORAGE_KEY };

const listeners = new Set<(theme: ThemeName) => void>();
let mediaBound = false;

export function currentTheme(): ThemeName {
  return resolveTheme(readStoredTheme(), systemTheme());
}

export function applyTheme(theme: ThemeName): void {
  try {
    const root = globalThis.document?.documentElement;
    if (!root) return;
    root.classList.toggle('dark', theme === 'dark');
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
  } catch {}
  for (const fn of listeners) {
    try { fn(theme); } catch {}
  }
}

export function setTheme(theme: ThemeName): void {
  persistTheme(theme);
  applyTheme(theme);
}

export function toggleTheme(): ThemeName {
  const next: ThemeName = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function initThemeSync(): void {
  applyTheme(currentTheme());
  try {
    globalThis.addEventListener?.('storage', (e) => {
      if (!e || e.key !== THEME_STORAGE_KEY) return;
      const stored = parseStoredTheme(e.newValue);
      applyTheme(resolveTheme(stored, systemTheme()));
    });
  } catch {}
  if (!mediaBound && typeof globalThis.matchMedia === 'function') {
    mediaBound = true;
    try {
      const mq = globalThis.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if (readStoredTheme() !== null) return;
        applyTheme(systemTheme());
      };
      mq.addEventListener?.('change', onChange);
    } catch {}
  }
}

export function onThemeChange(fn: (theme: ThemeName) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
