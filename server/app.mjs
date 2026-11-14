import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// Allows 100 valid legacy projects (including checklist and description limits),
// while bounding memory consumed by an unexpected upstream response.
const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deliberately accepts only the public publishable key, not service-role or secret keys.
export function validateConfig({ supabaseUrl, publishableKey }) {
  let url;
  try { url = new URL(supabaseUrl); } catch { throw new Error('SUPABASE_URL must be an HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('SUPABASE_URL must be an HTTPS origin');
  if (typeof publishableKey !== 'string' || !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(publishableKey))
    throw new Error('SUPABASE_PUBLISHABLE_KEY must be a publishable key');
  return { base: url.origin, publishableKey };
}

async function readJsonBounded(response) {
  if (!response.body) throw new Error('empty upstream body');
  const reader = response.body.getReader();
  let size = 0;
  const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPSTREAM_BYTES) { await reader.cancel(); throw new Error('upstream response too large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(parts.map(part => Buffer.from(part))).toString('utf8'));
}

function send(res, code, data, id, extra = {}) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Request-Id': id,
    ...extra,
  });
  res.end(JSON.stringify(data));
}

function bearer(req) {
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === 'authorization') count++;
  if (count !== 1 || typeof req.headers.authorization !== 'string') return null;
  // No credential in query strings, cookies, logs or response.
  const match = /^Bearer ([A-Za-z0-9._~-]{1,8192})$/i.exec(req.headers.authorization);
  return match?.[1] || null;
}

export function createApp(config, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const { base, publishableKey } = validateConfig(config);
  async function upstream(path, token) {
    const response = await fetchImpl(`${base}${path}`, {
      method: 'GET',
      headers: { apikey: publishableKey, authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response;
  }

  const server = createServer(async (req, res) => {
    const id = randomUUID();
    const fail = (status, code, extra) => send(res, status, { error: { code, request_id: id } }, id, extra);
    try {
      // No parameters or mutations are accepted by the first version of this boundary.
      if (!req.url?.startsWith('/') || req.url.includes('?') || req.url.includes('#')) return fail(400, 'invalid_request');
      const path = req.url;
      const routes = ['/api/v1/health', '/api/v1/me', '/api/v1/projects'];
      if (!routes.includes(path)) return fail(404, 'not_found');
      if (req.method !== 'GET') return fail(405, 'method_not_allowed', { Allow: 'GET' });
      if (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0')) return fail(400, 'invalid_request');
      if (path === '/api/v1/health') return send(res, 200, { status: 'ok' }, id);
      const token = bearer(req);
      if (!token) return fail(401, 'unauthorized');
      // Auth server validates the token online; we do not trust client-decoded claims.
      const auth = await upstream('/auth/v1/user', token);
      if (auth.status === 401 || auth.status === 403) return fail(401, 'unauthorized');
      if (!auth.ok) return fail(503, 'identity_unavailable');
      const user = await readJsonBounded(auth);
      if (!user || typeof user.id !== 'string' || !UUID.test(user.id)) return fail(503, 'identity_unavailable');
      if (path === '/api/v1/me') return send(res, 200, { id: user.id }, id);
      // Forward the USER token, never a service-role key: PostgREST enforces RLS.
      const query = new URLSearchParams({ select: 'id,title,description,project_type,checklist,version,updated_at', order: 'updated_at.desc,id.desc', limit: '100' });
      const projects = await upstream(`/rest/v1/studio_projects?${query}`, token);
      if (projects.status === 401 || projects.status === 403) return fail(403, 'access_denied');
      if (!projects.ok) return fail(503, 'projects_unavailable');
      const rows = await readJsonBounded(projects);
      if (!Array.isArray(rows) || rows.length > 100) return fail(503, 'projects_unavailable');
      return send(res, 200, { projects: rows, limit: 100, possibly_more: rows.length === 100 }, id);
    } catch {
      if (!res.headersSent) return fail(503, 'upstream_unavailable');
      res.destroy();
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 64;
  return server;
}
