import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
check(manifest.manifest_version === 3, 'manifest_version must be 3');
check(!manifest.permissions?.includes('tabs'), 'tabs permission must not be requested');
check(!manifest.permissions?.includes('cookies'), 'cookies permission must not be requested');
check(!manifest.permissions?.includes('webRequest'), 'webRequest must not be requested');
check(JSON.stringify(manifest.host_permissions) === JSON.stringify(['https://dev.azure.com/*', 'https://api.github.com/*']), 'host_permissions must be exactly ["https://dev.azure.com/*", "https://api.github.com/*"]');
check((manifest.optional_permissions || []).join(',') === 'notifications', 'optional_permissions should be ["notifications"]');
check(manifest.content_security_policy?.extension_pages?.includes("script-src 'self'"), 'CSP must restrict script-src to self');
check(manifest.background?.type === 'module', 'background must be an ES module service worker');
check(manifest.permissions?.includes('offscreen'), 'offscreen permission required for notification sounds');
check(manifest.minimum_chrome_version === '116', 'minimum_chrome_version must be 116 (offscreen audio APIs)');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
check(manifest.version === pkg.version, `manifest version ${manifest.version} != package.json ${pkg.version}`);
check(pkg.version === lock.version, `package.json ${pkg.version} != package-lock version ${lock.version}`);
check(lock.version === lock.packages?.['']?.version, `package-lock top version ${lock.version} != packages[""] ${lock.packages?.['']?.version}`);

const referenced = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else referenced.push(p);
  }
};
for (const key of ['background.service_worker', 'action.default_popup', 'options_page']) {
  const parts = key.split('.');
  let v = manifest;
  for (const p of parts) v = v?.[p];
  if (v) referenced.push(join(ROOT, v));
}
for (const iconPath of Object.values(manifest.icons || {})) referenced.push(join(ROOT, iconPath));
for (const size of ['16', '20', '24', '32', '48', '128']) {
  const icon = manifest.icons?.[size];
  check(icon && manifest.action?.default_icon?.[size] === icon, `toolbar and extension icons must match at ${size}px`);
}
for (const extra of ['src/offscreen.html', 'src/offscreen.js', 'assets/sounds/notification.wav']) {
  referenced.push(join(ROOT, extra));
}
for (const f of referenced) check(existsSync(f), `manifest-referenced file missing: ${relative(ROOT, f)}`);

const wavPath = join(ROOT, 'assets', 'sounds', 'notification.wav');
if (existsSync(wavPath)) {
  const b = readFileSync(wavPath);
  const wavOk = b.length > 44
    && b.toString('ascii', 0, 4) === 'RIFF'
    && b.toString('ascii', 8, 12) === 'WAVE'
    && b.toString('ascii', 12, 16) === 'fmt '
    && b.readUInt16LE(20) === 1
    && b.readUInt16LE(22) === 1
    && b.readUInt16LE(34) === 16;
  check(wavOk, 'assets/sounds/notification.wav is not a valid PCM16 mono WAV');
}

const pngOk = (file, size) => {
  const b = readFileSync(file);
  return b.length > 24 && b.readUInt32BE(16) === size && b.readUInt32BE(20) === size;
};
for (const [k, p] of Object.entries(manifest.icons || {})) {
  const f = join(ROOT, p);
  if (existsSync(f)) check(pngOk(f, Number(k)), `icon ${p} is not a ${k}px PNG`);
}

const htmlFiles = [];
const collectHtml = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectHtml(p);
    else if (name.endsWith('.html')) htmlFiles.push(p);
  }
};
collectHtml(join(ROOT, 'src'));
const uiBuildDir = join(ROOT, 'ui-build');
check(existsSync(uiBuildDir), 'ui-build/ missing: run npm run build first');
if (existsSync(uiBuildDir)) collectHtml(uiBuildDir);
for (const html of htmlFiles) {
  const text = readFileSync(html, 'utf8');
  check(!/<script(?![^>]*\bsrc=)[^>]*>[^<]/i.test(text), `${relative(ROOT, html)} contains inline script`);
  check(!/(src|href)=["']https?:\/\//i.test(text), `${relative(ROOT, html)} references a remote resource`);
}
if (existsSync(uiBuildDir)) {
  check(existsSync(join(uiBuildDir, 'dashboard.html')), 'ui-build/dashboard.html missing');
  check(existsSync(join(uiBuildDir, 'popup.html')), 'ui-build/popup.html missing');
  check(existsSync(join(uiBuildDir, 'theme-init.js')), 'ui-build/theme-init.js missing');

  const uiJs = [];
  const collectUiJs = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) collectUiJs(p);
      else if (name.endsWith('.js')) uiJs.push(p);
    }
  };
  collectUiJs(uiBuildDir);
  for (const f of uiJs) {
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
      failures.push(`syntax check failed for ${relative(ROOT, f)}: ${e.stderr?.toString() || e.message}`);
    }
  }

  const resolveLocal = (fromFile, ref) => {
    if (!ref || ref.startsWith('data:') || ref.startsWith('#') || /^[a-z]+:/i.test(ref)) return null;
    const clean = ref.split(/[?#]/)[0];
    if (!clean) return null;
    return join(dirname(fromFile), clean);
  };
  for (const html of htmlFiles.filter((f) => f.startsWith(uiBuildDir))) {
    const text = readFileSync(html, 'utf8');
    for (const m of text.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
      const target = resolveLocal(html, m[1]);
      if (target) check(existsSync(target), `${relative(ROOT, html)} references missing asset: ${m[1]}`);
    }
  }
  const uiCss = [];
  const collectUiCss = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) collectUiCss(p);
      else if (name.endsWith('.css')) uiCss.push(p);
    }
  };
  collectUiCss(join(uiBuildDir, 'assets'));
  for (const css of uiCss) {
    const text = readFileSync(css, 'utf8');
    for (const m of text.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
      const target = resolveLocal(css, m[1]);
      if (target) check(existsSync(target), `${relative(ROOT, css)} references missing asset: ${m[1]}`);
    }
  }
}

const srcDir = join(ROOT, 'src');
const srcFiles = [];
const collectJs = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectJs(p);
    else if (name.endsWith('.js') || name.endsWith('.mjs')) srcFiles.push(p);
  }
};
collectJs(srcDir);
for (const f of srcFiles) {
  try {
    await import(f);
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes('chrome')) continue;
    failures.push(`import check failed for ${relative(ROOT, f)}: ${e.message}`);
  }
}
for (const name of ['check.mjs', 'package.mjs', 'generate-icons.mjs', 'generate-sound.mjs']) {
  const f = join(ROOT, 'tools', name);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    failures.push(`syntax check failed for tools/${name}: ${e.stderr?.toString() || e.message}`);
  }
}

for (const bad of ['.env', 'credentials.json', 'secrets.json', 'token.txt']) {
  const p = join(ROOT, bad);
  check(!existsSync(p), `secret-like file present: ${bad}`);
}

if (failures.length) {
  console.error('check FAILED:');
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
console.log(`check OK: ${htmlFiles.length} html, ${srcFiles.length} js files, manifest + icons verified`);
