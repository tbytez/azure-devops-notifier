// Migrates chrome.storage.local data from a path-derived extension ID to the
// pinned-key ID used since v0.1.2. Chrome must be fully quit first.
// Usage: node tools/migrate-extension-storage.mjs [--dry-run]
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const NEW_ID = 'nkecpmdlnlfoflikjcpjkeckdiacgepl';
const STATE_MARKER = 'azdoNotifier';
const DRY_RUN = process.argv.includes('--dry-run');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
if (!manifest.key) {
  console.error('manifest.json has no pinned key; migration is only needed when upgrading to v0.1.2+.');
  process.exit(1);
}

function chromeUserDataDirs() {
  if (process.env.AZDO_CHROME_DIR) return [process.env.AZDO_CHROME_DIR];
  const home = homedir();
  if (platform() === 'darwin') return [join(home, 'Library/Application Support/Google/Chrome')];
  if (platform() === 'linux') return [join(home, '.config/google-chrome')];
  if (platform() === 'win32') return [join(process.env.LOCALAPPDATA || join(home, 'AppData/Local'), 'Google/Chrome/User Data')];
  return [];
}

function isChromeRunning() {
  if (platform() === 'win32') return false;
  try {
    execFileSync('pgrep', ['-x', platform() === 'darwin' ? 'Google Chrome' : 'chrome'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function dirMentionsState(dir) {
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (!statSync(p).isFile()) continue;
      const buf = readFileSync(p);
      if (buf.includes(STATE_MARKER)) return true;
    }
  } catch {}
  return false;
}

const bases = chromeUserDataDirs().filter(existsSync);
if (!bases.length) {
  console.error('Could not find a Chrome user data directory on this system.');
  process.exit(1);
}

if (isChromeRunning() && !DRY_RUN) {
  console.error('Chrome is running. Quit it completely (Cmd+Q), then re-run this script.');
  process.exit(1);
}

let migrated = 0;
for (const base of bases) {
  let profiles;
  try {
    profiles = readdirSync(base).filter((name) => existsSync(join(base, name, 'Local Extension Settings')));
  } catch (e) {
    console.error(`Cannot read ${base}: ${e.message}`);
    console.error('Your terminal may need Full Disk Access (System Settings > Privacy & Security > Full Disk Access).');
    process.exit(1);
  }
  for (const profile of profiles) {
    const lesDir = join(base, profile, 'Local Extension Settings');
    const candidates = [];
    for (const id of readdirSync(lesDir)) {
      const dir = join(lesDir, id);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch { continue; }
      if (id === NEW_ID) continue;
      if (dirMentionsState(dir)) candidates.push({ id, dir, mtime: statSync(dir).mtimeMs });
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => b.mtime - a.mtime);
    const src = candidates[0];
    const dst = join(lesDir, NEW_ID);
    if (existsSync(dst) && readdirSync(dst).length > 0) {
      console.log(`[${profile}] target ${NEW_ID} already has data; skipping (source was ${src.id}).`);
      continue;
    }
    console.log(`[${profile}] copying ${src.id} -> ${NEW_ID}${candidates.length > 1 ? ` (${candidates.length - 1} older candidate(s) ignored)` : ''}`);
    if (!DRY_RUN) cpSync(src.dir, dst, { recursive: true });
    migrated += 1;
  }
}

if (migrated) {
  console.log(DRY_RUN ? 'Dry run: migration would be applied. Re-run without --dry-run while Chrome is quit.' : 'Done. Load or reload the updated extension; your setup should be intact.');
} else {
  console.log('Nothing to migrate: no stored extension data found under any Chrome profile.');
}
