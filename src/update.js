export const RELEASES_REPO = 'tbytez/azure-devops-notifier';
export const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
export const RELEASES_PAGE_URL = `https://github.com/${RELEASES_REPO}/releases`;

export function parseVersion(input) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i.exec(String(input ?? '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

export function normalizeVersion(input) {
  const v = parseVersion(input);
  return v ? v.join('.') : null;
}

export function isNewerVersion(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function sanitizeReleaseUrl(url) {
  const prefix = `https://github.com/${RELEASES_REPO}/releases/`;
  return typeof url === 'string' && url.startsWith(prefix) ? url : RELEASES_PAGE_URL;
}

export async function checkLatestRelease(fetchImpl, { timeoutMs = 10000 } = {}) {
  if (typeof fetchImpl !== 'function') return null;
  const res = await fetchImpl(LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  const version = normalizeVersion(data?.tag_name || data?.name);
  if (!version) return null;
  return { version, url: sanitizeReleaseUrl(data.html_url) };
}
