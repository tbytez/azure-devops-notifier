import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredTheme, resolveTheme, systemTheme, THEME_STORAGE_KEY } from '../ui/src/lib/theme-core.ts';

test('parseStoredTheme accepts only light/dark', () => {
  assert.equal(parseStoredTheme('dark'), 'dark');
  assert.equal(parseStoredTheme('light'), 'light');
  assert.equal(parseStoredTheme('system'), null);
  assert.equal(parseStoredTheme('bogus'), null);
  assert.equal(parseStoredTheme(null), null);
  assert.equal(parseStoredTheme(42), null);
});

test('resolveTheme falls back to system when no explicit preference', () => {
  assert.equal(resolveTheme(null, 'dark'), 'dark');
  assert.equal(resolveTheme(null, 'light'), 'light');
  assert.equal(resolveTheme('dark', 'light'), 'dark');
  assert.equal(resolveTheme('light', 'dark'), 'light');
});

test('systemTheme returns light without matchMedia', () => {
  assert.equal(systemTheme(), 'light');
});

test('theme storage key is stable', () => {
  assert.equal(THEME_STORAGE_KEY, 'azdoNotifier.theme.v1');
});
