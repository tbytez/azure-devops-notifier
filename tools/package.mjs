import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const included = ['manifest.json', 'src', 'assets', 'ui-build'];
const missing = included.filter((p) => !existsSync(join(ROOT, p)));
if (missing.length) {
  console.error('missing package inputs:', missing.join(', '));
  process.exit(1);
}

mkdirSync(DIST, { recursive: true });
const zipPath = join(DIST, 'azure-devops-notifier.zip');
try {
  execFileSync('rm', ['-f', zipPath]);
} catch {}
execFileSync('zip', ['-X', '-r', zipPath, ...included], { cwd: ROOT, stdio: 'inherit' });
console.log(`packaged -> ${zipPath}`);
