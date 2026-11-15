export class ApiError extends Error {
  constructor(kind, message, opts = {}) {
    super(message);
    this.kind = kind;
    this.status = opts.status ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

const API_VERSION = '7.1';
const PREVIEW_VERSION = '7.1-preview.1';
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_PAGES = 50;

function base64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function enc(s) {
  return encodeURIComponent(String(s));
}

function retryAfterMs(headers) {
  const raw = headers?.get?.('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function mapError(status, retryMs) {
  if (status === 401) return new ApiError('auth', 'Azure DevOps rejected the credentials (401). Check the PAT and reconnect.', { status, retryAfterMs: retryMs });
  if (status === 403) return new ApiError('forbidden', 'Access denied (403). The PAT may lack required permissions or the organization restricts access.', { status, retryAfterMs: retryMs });
  if (status === 404) return new ApiError('notfound', 'Not found (404). The organization, project, repository, or pull request may not exist or may not be visible to this token.', { status, retryAfterMs: retryMs });
  if (status === 429) return new ApiError('ratelimit', 'Azure DevOps rate limit reached (429). Backing off before retrying.', { status, retryAfterMs: retryMs });
  if (status >= 500) return new ApiError('server', `Azure DevOps server error (${status}).`, { status, retryAfterMs: retryMs });
  return new ApiError('http', `Azure DevOps request failed (${status}).`, { status, retryAfterMs: retryMs });
}

function listItems(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.value)) {
    throw new ApiError('http', 'Azure DevOps returned an unexpected response shape.');
  }
  return body.value;
}

export class AzureApi {
  constructor({ organization, token, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.organization = organization;
    this.token = token;
    this.fetchImpl = fetchImpl || globalThis.fetch?.bind(globalThis);
    this.timeoutMs = timeoutMs;
    this.authHeader = `Basic ${base64Utf8(`:${token}`)}`;
  }

  _url(path, params = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) q.set(k, String(v));
    }
    const qs = q.toString();
    return `https://dev.azure.com/${enc(this.organization)}/${path}${qs ? `?${qs}` : ''}`;
  }

  async _send(path, params = {}) {
    if (!this.fetchImpl) throw new ApiError('network', 'No fetch implementation available.');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this._url(path, params), {
        method: 'GET',
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
        },
        credentials: 'omit',
        redirect: 'error',
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw mapError(res.status, retryAfterMs(res.headers));
      }
      let body;
      try {
        body = await res.json();
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        throw new ApiError('http', 'Azure DevOps returned an unreadable response.');
      }
      return {
        body,
        continuationToken: res.headers?.get?.('x-ms-continuationtoken') ?? null,
      };
    } catch (e) {
      if (e?.name === 'AbortError') throw new ApiError('network', 'Request to Azure DevOps timed out.');
      if (e instanceof ApiError) throw e;
      throw new ApiError('network', 'Network error reaching Azure DevOps.');
    } finally {
      clearTimeout(timer);
    }
  }

  async _request(path, params = {}) {
    const { body } = await this._send(path, params);
    return body;
  }

  async _paged(path, params = {}, { maxPages = MAX_PAGES } = {}) {
    const out = [];
    let skip = 0;
    for (let page = 0; page < maxPages; page++) {
      const p = { ...params, $top: params.$top ?? 100 };
      if (page > 0 || skip > 0) p.$skip = skip;
      const { body } = await this._send(path, p);
      const items = listItems(body);
      out.push(...items);
      if (items.length < (p.$top ?? 100)) return out;
      skip += items.length;
    }
    throw new ApiError('http', `Azure DevOps pagination exceeded ${maxPages} pages; results may be incomplete.`);
  }

  connectionData() {
    return this._request('_apis/connectionData', { 'api-version': PREVIEW_VERSION });
  }

  async listProjects() {
    const items = [];
    let contToken = null;
    const seenTokens = new Set();
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = { 'api-version': API_VERSION, $top: 100 };
      if (contToken) params.continuationToken = contToken;
      const { body, continuationToken } = await this._send('_apis/projects', params);
      items.push(...listItems(body));
      if (!continuationToken) return items;
      if (seenTokens.has(continuationToken)) {
        throw new ApiError('http', 'Azure DevOps returned a repeated pagination token.');
      }
      seenTokens.add(continuationToken);
      contToken = continuationToken;
    }
    throw new ApiError('http', `Azure DevOps pagination exceeded ${MAX_PAGES} pages; results may be incomplete.`);
  }

  async listActivePullRequests(projectId, creatorId) {
    const path = `${enc(projectId)}/_apis/git/pullrequests`;
    const items = [];
    let skip = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { body } = await this._send(path, {
        'api-version': API_VERSION,
        'searchCriteria.creatorId': creatorId,
        'searchCriteria.status': 'active',
        $top: 100,
        $skip: skip,
      });
      const batch = listItems(body);
      items.push(...batch);
      if (batch.length < 100) return items;
      skip += batch.length;
    }
    throw new ApiError('http', `Azure DevOps pagination exceeded ${MAX_PAGES} pages; results may be incomplete.`);
  }

  getRepository(projectId, repoNameOrId) {
    return this._request(`${enc(projectId)}/_apis/git/repositories/${enc(repoNameOrId)}`, { 'api-version': API_VERSION });
  }

  getPullRequest(projectId, repoId, prId) {
    return this._request(`${enc(projectId)}/_apis/git/repositories/${enc(repoId)}/pullRequests/${enc(prId)}`, { 'api-version': API_VERSION });
  }

  async getThreads(projectId, repoId, prId) {
    const body = await this._request(`${enc(projectId)}/_apis/git/repositories/${enc(repoId)}/pullRequests/${enc(prId)}/threads`, { 'api-version': API_VERSION });
    return listItems(body);
  }

  getStatuses(projectId, repoId, prId) {
    return this._paged(`${enc(projectId)}/_apis/git/repositories/${enc(repoId)}/pullRequests/${enc(prId)}/statuses`, { 'api-version': API_VERSION });
  }

  getPolicyEvaluations(projectId, prId) {
    const artifactId = `vstfs:///CodeReview/CodeReviewId/${projectId}/${prId}`;
    return this._paged(`${enc(projectId)}/_apis/policy/evaluations`, {
      'api-version': PREVIEW_VERSION,
      artifactId,
    });
  }
}

export function createApi(state, fetchImpl) {
  return new AzureApi({
    organization: state.settings.organization,
    token: state.credentials.pat,
    fetchImpl,
  });
}
