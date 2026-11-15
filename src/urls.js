const ORG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const AZURE_HOST = 'dev.azure.com';
const LEGACY_HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?\.visualstudio\.com$/;

function fail(msg) {
  return { ok: false, error: msg };
}

function decodeSegment(raw) {
  let s = raw;
  try {
    s = decodeURIComponent(s);
  } catch {
    return null;
  }
  if (s.includes('/') || s.includes('\\') || s.includes('%')) return null;
  if (s === '.' || s === '..') return null;
  if (!s.trim()) return null;
  return s;
}

function safeDecode(seg) {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function rawPathOf(raw) {
  const m = raw.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*/);
  if (!m) return '';
  return raw.slice(m[0].length).split(/[?#]/)[0];
}

function pathSegments(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
  const segs = pathname.slice(1).split('/');
  if (segs.length && segs[segs.length - 1] === '') segs.pop();
  if (segs.some((s) => s === '')) return null;
  return segs;
}

export function normalizeOrganization(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!ORG_RE.test(s)) return null;
  return s;
}

export function parsePrUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return fail('Enter a pull request URL.');
  if (raw.includes('\\')) return fail('Backslashes are not allowed in pull request URLs.');
  const rawPath = rawPathOf(raw);
  for (const seg of rawPath.split('/')) {
    if (seg === '') continue;
    const dec = safeDecode(seg);
    if (dec === '.' || dec === '..') return fail('Path traversal is not allowed in pull request URLs.');
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return fail('That does not look like a valid URL.');
  }
  if (url.protocol !== 'https:') return fail('Only https:// URLs are supported.');
  if (url.username || url.password) return fail('URLs with embedded credentials are not allowed.');
  if (url.port) return fail('URLs with a custom port are not supported.');

  const host = url.hostname.toLowerCase();
  let organization = null;
  let path = url.pathname;

  if (host === AZURE_HOST) {
    const segs = pathSegments(path);
    if (!segs || segs.length < 5) return fail('Expected a URL like https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}');
    organization = normalizeOrganization(segs[0]);
    if (!organization) return fail('The organization name in the URL is not valid.');
    path = '/' + segs.slice(1).join('/');
  } else if (LEGACY_HOST_RE.test(host)) {
    organization = normalizeOrganization(host.split('.')[0]);
    if (!organization) return fail('The organization name in the URL is not valid.');
    if (!pathSegments(path)) return fail('Malformed pull request URL path.');
  } else {
    return fail('Only Azure DevOps Services URLs (dev.azure.com) are supported. Azure DevOps Server is not supported.');
  }

  const m = path.match(/^\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)\/?$/i);
  if (!m) return fail('URL must point to a pull request: /{project}/_git/{repo}/pullrequest/{id}');
  const projectName = decodeSegment(m[1]);
  const repoName = decodeSegment(m[2]);
  const prId = Number(m[3]);
  if (!projectName || !repoName) return fail('The project or repository name in the URL is not valid.');
  if (!Number.isSafeInteger(prId) || prId <= 0) return fail('The pull request id in the URL is not valid.');

  return {
    ok: true,
    organization,
    projectName,
    repoName,
    prId,
    canonicalUrl: `https://${AZURE_HOST}/${organization}/${encodeURIComponent(projectName)}/_git/${encodeURIComponent(repoName)}/pullrequest/${prId}`,
  };
}

export function buildPrWebUrl({ organization, projectName, repoName, prId }) {
  const org = normalizeOrganization(organization) || String(organization || '').toLowerCase();
  return `https://${AZURE_HOST}/${org}/${encodeURIComponent(projectName)}/_git/${encodeURIComponent(repoName)}/pullrequest/${prId}`;
}

export function watchKey({ organization, projectId, repoId, prId }) {
  return [
    normalizeOrganization(organization) || String(organization || '').toLowerCase(),
    String(projectId || '').toLowerCase(),
    String(repoId || '').toLowerCase(),
    String(prId),
  ].join('/');
}
