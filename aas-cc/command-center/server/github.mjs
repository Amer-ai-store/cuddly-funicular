/** Read-only GitHub snapshots. Tokens are runtime inputs and never enter URLs. */
const API_ROOT = 'https://api.github.com';
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 10000;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

export class GitHubError extends Error {
  constructor(status, code, message, retryAt) {
    super(message);
    Object.assign(this, { status, code });
    if (retryAt) this.retryAt = retryAt;
  }
}
const unavailable = () => new GitHubError(502, 'github_unavailable', 'تعذر قراءة بيانات GitHub. تحقق من المستودع وصلاحيات الوصول.');
const timedOut = () => new GitHubError(503, 'github_unavailable', 'انتهت مهلة قراءة GitHub. أعد المحاولة لاحقًا.');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateRepositoryName(value) {
  if (typeof value !== 'string' || value.length > 201 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) || value.split('/').some((part) => part.length > 100 || part === '.' || part.includes('..'))) {
    throw new GitHubError(422, 'github_invalid_repository', 'أدخل المستودع بصيغة owner/repository بدون رابط أو مسارات إضافية.');
  }
  return value;
}

function string(value, limit, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string') throw unavailable();
  return value.trim().slice(0, limit);
}
function date(value, nullable = false) {
  if (nullable && value == null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw unavailable();
  return new Date(value).toISOString();
}
function hash(value) {
  if (typeof value !== 'string' || !SHA.test(value)) throw unavailable();
  return value;
}
function githubUrl(value, fullName, expectedPath) {
  if (typeof value !== 'string' || value.length > 2048) throw unavailable();
  let url;
  try { url = new URL(value); } catch { throw unavailable(); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) throw unavailable();
  const path = url.pathname.replace(/\/$/, '').toLowerCase();
  const repoPath = '/' + fullName.toLowerCase();
  if (expectedPath ? path !== (repoPath + expectedPath).toLowerCase() : path !== repoPath) throw unavailable();
  return url.href;
}
function commitRecord(value, fullName) {
  if (!object(value) || !object(value.commit)) throw unavailable();
  const sha = hash(value.sha);
  const author = value.commit.author;
  const committer = value.commit.committer;
  return {
    sha, htmlUrl: githubUrl(value.html_url, fullName, '/commit/' + sha),
    message: string(value.commit.message, 1500),
    authorName: string(author?.name ?? committer?.name ?? value.author?.login, 160, true),
    committedAt: date(committer?.date ?? author?.date),
  };
}
function branchRecord(value) {
  if (!object(value) || !object(value.commit) || typeof value.protected !== 'boolean') throw unavailable();
  const name = string(value.name, 200);
  if (!name) throw unavailable();
  return { name, sha: hash(value.commit.sha), protected: value.protected };
}
function workflowRecord(value, fullName) {
  if (!object(value) || !Number.isSafeInteger(value.id) || value.id <= 0) throw unavailable();
  return {
    id: value.id, name: string(value.name, 200, true), status: string(value.status, 80),
    conclusion: value.conclusion == null ? null : string(value.conclusion, 80),
    htmlUrl: githubUrl(value.html_url, fullName, '/actions/runs/' + value.id), headSha: hash(value.head_sha),
    createdAt: date(value.created_at), updatedAt: date(value.updated_at),
  };
}
function array(value, cap) {
  if (!Array.isArray(value)) throw unavailable();
  return value.slice(0, cap);
}

function retryDate(headers, clock) {
  const retry = headers.get('Retry-After');
  if (retry) {
    let millis;
    if (/^\d+$/.test(retry)) millis = clock().getTime() + Number(retry) * 1000;
    else millis = Date.parse(retry);
    if (Number.isFinite(millis) && millis >= 0 && millis <= 8640000000000000) return new Date(millis).toISOString();
  }
  const reset = headers.get('X-RateLimit-Reset');
  if (reset && /^\d+$/.test(reset)) {
    const millis = Number(reset) * 1000;
    if (Number.isFinite(millis) && millis > 0 && millis <= 8640000000000000) return new Date(millis).toISOString();
  }
  return undefined;
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(timedOut());
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(timedOut()); });
  signal.addEventListener('abort', rejectAbort, { once: true });
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', rejectAbort));
}

async function readText(response, signal) {
  if (Number(response.headers.get('Content-Length')) > MAX_BYTES) {
    response.body?.cancel().catch(() => {});
    throw unavailable();
  }
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) { cancel(); throw timedOut(); }
      const { value, done } = await reader.read();
      if (signal.aborted) throw timedOut();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { cancel(); throw unavailable(); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancel); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
async function readJson(response, signal) {
  try { return JSON.parse(await readText(response, signal)); } catch (error) { if (error instanceof GitHubError) throw error; throw unavailable(); }
}

// Parse only GitHub's bounded Atom vocabulary. No DTDs, external entities,
// arbitrary XML namespaces, HTML execution, or content elements are supported.
function xmlText(value) {
  if (typeof value !== 'string') throw unavailable();
  const trimmed = value.trim();
  if (trimmed.startsWith('<![CDATA[') && trimmed.endsWith(']]>')) return trimmed.slice(9, -3).trim();
  if (/<[^>]*>/.test(trimmed) || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(trimmed)) throw unavailable();
  return trimmed.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    if (Object.hasOwn(named, entity)) return named[entity];
    const code = entity.startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) throw unavailable();
    return String.fromCodePoint(code);
  }).trim();
}
function tagText(xml, name) {
  const match = xml.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '\\s*>'));
  return match ? xmlText(match[1]) : null;
}
function attribute(attributes, name) {
  const match = attributes.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1'));
  return match ? xmlText(match[2]) : null;
}
function atomLinks(xml) {
  return [...xml.matchAll(/<link\b([^>]*?)\/?\s*>/g)].map((match) => ({ rel: attribute(match[1], 'rel'), href: attribute(match[1], 'href') }));
}
function atomSnapshot(xml, requestedName, checkedAt, restRetryAt) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !/^\s*(?:<\?xml[\s\S]*?\?>\s*)?<feed\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom["'][^>]*>/.test(xml) || !/<\/feed>\s*$/.test(xml)) throw unavailable();
  const header = xml.split(/<entry\b/, 1)[0];
  const feedId = tagText(header, 'id');
  const feedIdentity = feedId?.match(/^tag:github\.com,2008:\/([^/]+\/[^/]+)\/commits(?:\/(.+))?$/);
  if (!feedIdentity) throw unavailable();
  let fullName;
  try { fullName = validateRepositoryName(feedIdentity[1]); } catch { throw unavailable(); }
  if (fullName.toLowerCase() !== requestedName.toLowerCase()) throw unavailable();
  let defaultBranch = null;
  if (feedIdentity[2]) {
    try { defaultBranch = decodeURIComponent(feedIdentity[2]); } catch { throw unavailable(); }
    if (!defaultBranch || defaultBranch.length > 200 || /[\x00-\x20]/.test(defaultBranch)) throw unavailable();
  }
  for (const link of atomLinks(header)) {
    if (!['self', 'alternate'].includes(link.rel)) continue;
    let url;
    try { url = new URL(link.href); } catch { throw unavailable(); }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || !url.pathname.toLowerCase().startsWith('/' + fullName.toLowerCase() + '/commits')) throw unavailable();
  }
  const commits = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry\s*>/g)].slice(0, 6).map((match) => {
    const entry = match[1];
    const identity = tagText(entry, 'id')?.match(/^tag:github\.com,2008:Grit::Commit\/([a-f0-9]+)$/i);
    if (!identity) throw unavailable();
    const sha = hash(identity[1]);
    const link = atomLinks(entry).find((item) => item.rel === 'alternate');
    const author = entry.match(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author\s*>/);
    return { sha, htmlUrl: githubUrl(link?.href, fullName, '/commit/' + sha), message: string(tagText(entry, 'title'), 1500), authorName: string(author ? tagText(author[1], 'name') : null, 160, true), committedAt: date(tagText(entry, 'updated')) };
  });
  if (/<entry\b/.test(xml) && !commits.length) throw unavailable();
  return {
    fullName, htmlUrl: 'https://github.com/' + fullName, defaultBranch, description: null, private: null,
    createdAt: null, updatedAt: null, pushedAt: null, head: commits[0] ?? null, commits,
    branches: [], branchAccess: 'unavailable', metadataAccess: 'unavailable', workflowRuns: [], workflowAccess: 'unavailable',
    checkedAt, source: 'github-atom', restRetryAt: restRetryAt ? date(restRetryAt) : null,
    partialErrors: ['metadata', 'branches', 'workflowRuns'].map((resource) => ({ resource, code: 'github_api_rate_limited', message: 'سجل الالتزامات العام متاح؛ بيانات المستودع والفروع والبناء تحتاج إلى عودة GitHub API.', ...(restRetryAt ? { retryAt: date(restRetryAt) } : {}) })),
  };
}

/** Public feed only: no credentials are sent, even if REST authentication exists. */
export async function fetchRepositoryAtomSnapshot({ repoFullName, fetchImpl = fetch, now, restRetryAt } = {}) {
  const requestedName = validateRepositoryName(repoFullName);
  const checkedAt = new Date(typeof now === 'function' ? now() : now ?? Date.now());
  if (!Number.isFinite(checkedAt.getTime())) throw new GitHubError(422, 'github_invalid_time', 'توقيت فحص المستودع غير صالح.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await abortable((async () => {
      const response = await fetchImpl('https://github.com/' + requestedName + '/commits.atom', { method: 'GET', headers: { Accept: 'application/atom+xml', 'User-Agent': 'AAS-CC' }, redirect: 'manual', signal: controller.signal });
      if (!response.ok) { response.body?.cancel().catch(() => {}); throw unavailable(); }
      const contentType = response.headers.get('Content-Type') || '';
      if (!/^(application\/atom\+xml|application\/xml|text\/xml)(?:;|$)/i.test(contentType)) { response.body?.cancel().catch(() => {}); throw unavailable(); }
      return atomSnapshot(await readText(response, controller.signal), requestedName, checkedAt.toISOString(), restRetryAt);
    })(), controller.signal);
  } catch (error) {
    if (error instanceof GitHubError) throw error;
    if (controller.signal.aborted || error?.name === 'AbortError') throw timedOut();
    throw unavailable();
  } finally { clearTimeout(timer); }
}

/** Actual GitHub API reads; no token, prompt, or upstream error body is logged. */
export async function fetchRepositorySnapshot({ repoFullName, token, fetchImpl = fetch, now } = {}) {
  const requestedName = validateRepositoryName(repoFullName);
  const clock = () => {
    const value = new Date(typeof now === 'function' ? now() : now ?? Date.now());
    if (!Number.isFinite(value.getTime())) throw new GitHubError(422, 'github_invalid_time', 'توقيت فحص المستودع غير صالح.');
    return value;
  };
  clock();
  if (token != null && (typeof token !== 'string' || token.length > 4096 || /[\r\n]/.test(token))) throw new GitHubError(503, 'github_unavailable', 'إعداد مصادقة GitHub على الخادم غير صالح.');
  const headers = {
    Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'AAS-CC',
    ...(token?.trim() ? { Authorization: 'Bearer ' + token.trim() } : {}),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const requestJson = async (path) => {
    if (controller.signal.aborted) throw timedOut();
    try {
      return await abortable((async () => {
        const response = await fetchImpl(API_ROOT + path, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
        if (!response.ok) {
          response.body?.cancel().catch(() => {});
          if (response.status === 429 || response.status === 403 && (response.headers.get('X-RateLimit-Remaining') === '0' || response.headers.has('Retry-After'))) {
            throw new GitHubError(503, 'github_rate_limited', 'وصل GitHub إلى حد الطلبات المتاح. أعد المحاولة بعد تجدد الحد.', retryDate(response.headers, clock));
          }
          throw unavailable();
        }
        return await readJson(response, controller.signal);
      })(), controller.signal);
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      if (controller.signal.aborted || error?.name === 'AbortError') throw timedOut();
      throw unavailable();
    }
  };
  try {
    const endpoint = '/repos/' + requestedName;
    const metadata = await requestJson(endpoint);
    if (!object(metadata) || typeof metadata.private !== 'boolean') throw unavailable();
    let fullName;
    try { fullName = validateRepositoryName(metadata.full_name); } catch { throw unavailable(); }
    if (fullName.toLowerCase() !== requestedName.toLowerCase()) throw unavailable();
    const htmlUrl = githubUrl(metadata.html_url, fullName);
    const defaultBranch = string(metadata.default_branch, 200);
    if (!defaultBranch) throw unavailable();
    const createdAt = date(metadata.created_at), updatedAt = date(metadata.updated_at), pushedAt = date(metadata.pushed_at, true);
    const [commitsResult, branchesResult, workflowsResult] = await Promise.allSettled([
      requestJson(endpoint + '/commits?per_page=6'),
      requestJson(endpoint + '/branches?per_page=20'),
      requestJson(endpoint + '/actions/runs?per_page=5'),
    ]);
    if (commitsResult.status === 'rejected') throw commitsResult.reason;
    if (branchesResult.status === 'rejected') throw branchesResult.reason;
    const commits = array(commitsResult.value, 6).map((value) => commitRecord(value, fullName));
    const branches = array(branchesResult.value, 20).map(branchRecord);
    const partialErrors = [];
    let workflowRuns = [], workflowAccess = 'available';
    try {
      if (workflowsResult.status === 'rejected') throw workflowsResult.reason;
      if (!object(workflowsResult.value)) throw unavailable();
      workflowRuns = array(workflowsResult.value.workflow_runs, 5).map((value) => workflowRecord(value, fullName));
    } catch (error) {
      workflowRuns = [];
      workflowAccess = 'unavailable';
      partialErrors.push({ resource: 'workflowRuns', code: error instanceof GitHubError ? error.code : 'github_unavailable', message: 'تعذرت قراءة تشغيلات GitHub Actions؛ لا توجد نتيجة بناء مؤكدة من هذا الفحص.', ...(error?.retryAt ? { retryAt: error.retryAt } : {}) });
    }
    return {
      fullName, htmlUrl, defaultBranch, description: string(metadata.description, 1500, true), private: metadata.private,
      createdAt, updatedAt, pushedAt, head: commits[0] ?? null, commits, branches, workflowRuns, workflowAccess,
      checkedAt: clock().toISOString(), source: 'github-api', metadataAccess: 'available', branchAccess: 'available', ...(partialErrors.length ? { partialErrors } : {}),
    };
  } finally { clearTimeout(timer); }
}
