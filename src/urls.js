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

function positiveId(value) {
  const text = String(value ?? '');
  return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? text : null;
}

function discussionTarget(event) {
  const category = event.category;
  if (category !== 'comments' && category !== 'threads') return null;
  let entity = event.entityKey;
  if (!entity && event.key) {
    const prefix = `${event.key}|${category}|`;
    const id = String(event.id || '');
    if (!id.startsWith(prefix)) return null;
    const tail = id.slice(prefix.length);
    const parts = tail.split('|');
    if (parts.length !== 2 || !positiveId(parts[1])) return null;
    entity = parts[0];
  }
  const match = String(entity || '').match(category === 'comments'
    ? /^comment:([1-9]\d*):([1-9]\d*)$/
    : /^thread:([1-9]\d*):status$/);
  return match && positiveId(match[1]) && (category !== 'comments' || positiveId(match[2]))
    ? match[1] : null;
}

function filePath(value) {
  return typeof value === 'string' && value.startsWith('/') && value.length <= 4096
    && !/[\\\u0000-\u001f\u007f]/.test(value) ? value : null;
}

function safeActivityUrl(raw, base) {
  if (typeof raw !== 'string' || /[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (rawPathOf(raw).split('/').some((s) => ['.', '..'].includes(safeDecode(s)))) return null;
  const parsed = parsePrUrl(raw);
  if (parsed.ok && parsed.canonicalUrl === base.canonicalUrl) {
    const result = new URL(base.canonicalUrl);
    const discussion = positiveId(url.searchParams.get('discussionId'));
    const tab = url.searchParams.get('_a');
    if (tab && ['overview', 'files', 'commits', 'updates'].includes(tab)) result.searchParams.set('_a', tab);
    if (discussion) {
      result.searchParams.set('discussionId', discussion);
      const path = filePath(url.searchParams.get('path'));
      if (path) result.searchParams.set('path', path);
    }
    return result.search ? result.href : null;
  }
  const repositoryPath = new URL(base.canonicalUrl).pathname.replace(/\/pullrequest\/\d+$/, '');
  if (url.hostname === AZURE_HOST && new RegExp(`^${repositoryPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/commit/[a-f0-9]{40,64}$`, 'i').test(url.pathname)) {
    return `${url.origin}${url.pathname}`;
  }
  const buildPath = `/${base.organization}/${encodeURIComponent(base.projectName)}/_build/results`;
  const buildId = positiveId(url.searchParams.get('buildId'));
  if (url.hostname === AZURE_HOST && url.pathname === buildPath && buildId) {
    return `${url.origin}${url.pathname}?buildId=${buildId}`;
  }
  return null;
}

// Watch URLs identify PRs; notification URLs identify the activity within them.
export function buildNotificationUrl(prUrl, event = {}) {
  const base = parsePrUrl(prUrl);
  if (!base.ok) return '';
  const threadId = discussionTarget(event);
  const path = filePath(event.target?.filePath);
  if (threadId && path) {
    const url = new URL(base.canonicalUrl);
    url.searchParams.set('_a', 'files');
    url.searchParams.set('discussionId', threadId);
    url.searchParams.set('path', path);
    return url.href;
  }
  const supplied = safeActivityUrl(event.target?.url || event.url, base);
  if (supplied) {
    const suppliedDiscussion = new URL(supplied).searchParams.get('discussionId');
    if (!threadId || suppliedDiscussion === threadId) return supplied;
  }
  if (threadId) {
    const url = new URL(base.canonicalUrl);
    url.searchParams.set('_a', 'overview');
    url.searchParams.set('discussionId', threadId);
    return url.href;
  }
  const sha = event.target?.commitId;
  if (event.category === 'commits' && typeof sha === 'string' && /^[a-f0-9]{40,64}$/i.test(sha)) {
    return base.canonicalUrl.replace(/\/pullrequest\/\d+$/, `/commit/${sha}`);
  }
  return event.category === 'commits' ? `${base.canonicalUrl}?_a=commits` : base.canonicalUrl;
}

export function watchKey({ organization, projectId, repoId, prId }) {
  return [
    normalizeOrganization(organization) || String(organization || '').toLowerCase(),
    String(projectId || '').toLowerCase(),
    String(repoId || '').toLowerCase(),
    String(prId),
  ].join('/');
}
