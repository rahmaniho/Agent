import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { validatePlanProposal } from './plan-validation.mjs';

// Allows 100 valid legacy projects (including checklist and description limits),
// while bounding memory consumed by an unexpected upstream response.
const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
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

// Bound memory while reading even when Transfer-Encoding: chunked is used.
function readRequestJson(req) {
  return new Promise(resolve => {
    if (req.aborted || req.destroyed) return resolve({ invalid: true });
    const chunks = []; let size = 0, finished = false;
    const finish = value => {
      if (finished) return; finished = true;
      req.removeListener('data', onData); req.removeListener('end', onEnd);
      req.removeListener('error', onError); req.removeListener('aborted', onError);
      resolve(value);
    };
    const onData = chunk => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) { finish({ tooLarge: true }); req.resume(); return; }
      chunks.push(chunk);
    };
    const onEnd = () => {
      try { finish({ value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }); }
      catch { finish({ invalid: true }); }
    };
    const onError = () => finish({ invalid: true });
    req.on('data', onData); req.once('end', onEnd); req.once('error', onError); req.once('aborted', onError);
  });
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
  async function upstream(path, token, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: { apikey: publishableKey, authorization: `Bearer ${token}`, accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response;
  }

  const server = createServer(async (req, res) => {
    // A client can disconnect while authentication or the RLS lookup is in flight.
    req.on('error', () => {});
    const id = randomUUID();
    const fail = (status, code, extra) => send(res, status, { error: { code, request_id: id } }, id, extra);
    try {
      // Only exact allowlisted paths, with no query parameters or cookies as credentials.
      if (!req.url?.startsWith('/') || req.url.includes('?') || req.url.includes('#')) return fail(400, 'invalid_request');
      const path = req.url;
      const projectMatch = /^\/api\/v1\/projects\/([0-9a-f-]{36})(\/(?:plan-validation|manual-plan))?$/i.exec(path);
      if (projectMatch && !UUID.test(projectMatch[1])) return fail(404, 'not_found');
      const kind = projectMatch?.[2]?.toLowerCase() || '', isProject = !!projectMatch;
      const isValidation = kind === '/plan-validation', isManualPlan = kind === '/manual-plan';
      if (!isProject && !['/api/v1/health', '/api/v1/me', '/api/v1/projects'].includes(path)) return fail(404, 'not_found');
      const allowedMethods = isManualPlan ? ['GET', 'POST'] : isValidation ? ['POST'] : ['GET'];
      if (!allowedMethods.includes(req.method)) return fail(405, 'method_not_allowed', { Allow: allowedMethods.join(', ') });
      const hasJsonBody = req.method === 'POST';
      if (!hasJsonBody && (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0'))) return fail(400, 'invalid_request');
      if (hasJsonBody) {
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '') ||
            (req.headers['content-encoding'] && req.headers['content-encoding'].toLowerCase() !== 'identity')) return fail(415, 'unsupported_media_type');
        const length = req.headers['content-length'];
        if (length && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) {
          req.resume(); return fail(413, 'request_too_large', { Connection: 'close' });
        }
      }
      if (path === '/api/v1/health') return send(res, 200, { status: 'ok' }, id);
      const token = bearer(req);
      if (!token) return fail(401, 'unauthorized');
      // Auth server validates the token online; we do not trust client-decoded claims.
      const auth = await upstream('/auth/v1/user', token);
      if (req.aborted || res.destroyed) return;
      if (auth.status === 401 || auth.status === 403) return fail(401, 'unauthorized');
      if (!auth.ok) return fail(503, 'identity_unavailable');
      const user = await readJsonBounded(auth);
      if (!user || typeof user.id !== 'string' || !UUID.test(user.id)) return fail(503, 'identity_unavailable');
      if (path === '/api/v1/me') return send(res, 200, { id: user.id }, id);
      if (isProject) {
        const projectId = projectMatch[1].toLowerCase(), ownerId = user.id.toLowerCase();
        const query = new URLSearchParams({ select: 'id,user_id,title,description,project_type,checklist,version,updated_at',
          id: `eq.${projectId}`, user_id: `eq.${ownerId}`, limit: '1' });
        // Enforce the currently supported single-owner model as well as database RLS.
        const response = await upstream(`/rest/v1/studio_projects?${query}`, token);
        if (req.aborted || res.destroyed) return;
        if (response.status === 401 || response.status === 403) return fail(403, 'access_denied');
        if (!response.ok) return fail(503, 'projects_unavailable');
        const rows = await readJsonBounded(response);
        if (!Array.isArray(rows) || rows.length > 1) return fail(503, 'projects_unavailable');
        if (!rows.length) return fail(404, 'not_found');
        const project = rows[0];
        if (!project || typeof project.id !== 'string' || project.id.toLowerCase() !== projectId ||
            typeof project.user_id !== 'string' || project.user_id.toLowerCase() !== ownerId ||
            !Number.isSafeInteger(project.version) || project.version < 1) return fail(503, 'projects_unavailable');
        if (!kind) {
          const { id: project_id, title, description, project_type, checklist, version, updated_at } = project;
          return send(res, 200, { project: { id: project_id, title, description, project_type, checklist, version, updated_at } }, id);
        }
        if (isManualPlan && req.method === 'GET') {
          const planQuery = new URLSearchParams({ select: 'project_id,user_id,revision,project_version,tasks,created_at',
            project_id: `eq.${projectId}`, user_id: `eq.${ownerId}`, order: 'revision.desc', limit: '1' });
          const planResponse = await upstream(`/rest/v1/studio_manual_plan_revisions?${planQuery}`, token);
          if (req.aborted || res.destroyed) return;
          if (planResponse.status === 401 || planResponse.status === 403) return fail(403, 'access_denied');
          if (!planResponse.ok) return fail(503, 'manual_plans_unavailable');
          const plans = await readJsonBounded(planResponse);
          if (!Array.isArray(plans) || plans.length > 1) return fail(503, 'manual_plans_unavailable');
          if (!plans.length) return send(res, 200, { plan: null, current_project_version: project.version }, id);
          const plan = plans[0];
          if (!plan || typeof plan.project_id !== 'string' || plan.project_id.toLowerCase() !== projectId ||
              typeof plan.user_id !== 'string' || plan.user_id.toLowerCase() !== ownerId ||
              !Number.isSafeInteger(plan.revision) || plan.revision < 1 || plan.revision > 200 ||
              typeof plan.created_at !== 'string' || !Number.isFinite(Date.parse(plan.created_at)) ||
              !validatePlanProposal({ project_version: plan.project_version, tasks: plan.tasks }, { stored: true }).valid) return fail(503, 'manual_plans_unavailable');
          const { revision, project_version, tasks, created_at } = plan;
          return send(res, 200, { plan: { revision, project_version, tasks, created_at },
            current_project_version: project.version, stale: project_version !== project.version }, id);
        }
        const body = await readRequestJson(req);
        if (body.tooLarge) return fail(413, 'request_too_large', { Connection: 'close' });
        if (body.invalid) return fail(400, 'invalid_json');
        let proposal = body.value, expectedRevision;
        if (isManualPlan) {
          if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal) ||
              Object.keys(proposal).some(key => !['project_version', 'expected_revision', 'tasks'].includes(key)) ||
              !Number.isSafeInteger(proposal.expected_revision) || proposal.expected_revision < 0 || proposal.expected_revision > 200)
            return send(res, 422, { error: { code: 'invalid_plan', issue: 'expected_revision', request_id: id } }, id);
          expectedRevision = proposal.expected_revision;
          proposal = { project_version: proposal.project_version, tasks: proposal.tasks };
        }
        const validation = validatePlanProposal(proposal);
        if (!validation.valid) return send(res, 422, { error: { code: 'invalid_plan', issue: validation.issue, request_id: id } }, id);
        if (validation.project_version !== project.version) return fail(409, 'project_version_conflict');
        if (isValidation) return send(res, 200, { validation: { ...validation, project_id: projectId } }, id);
        // No automatic retries: a timeout may follow a committed transaction.
        let saveResponse;
        try {
          saveResponse = await upstream('/rest/v1/rpc/studio_save_manual_plan', token, { method: 'POST', body: {
            target_project: projectId, expected_project_version: validation.project_version,
            expected_revision: expectedRevision, tasks: proposal.tasks,
          } });
        } catch { if (!res.destroyed) return fail(503, 'plan_save_outcome_unknown'); return; }
        if (req.aborted || res.destroyed) return;
        if (saveResponse.status === 401 || saveResponse.status === 403) return fail(403, 'access_denied');
        if (!saveResponse.ok) return fail(503, 'plan_save_outcome_unknown');
        let result;
        try { result = await readJsonBounded(saveResponse); } catch { return fail(503, 'plan_save_outcome_unknown'); }
        if (!Array.isArray(result) || result.length !== 1 || typeof result[0]?.applied !== 'boolean') return fail(503, 'plan_save_outcome_unknown');
        const saved = result[0];
        if (!saved.applied) {
          if (saved.reason === 'not_found') return fail(404, 'not_found');
          if (['project_version_conflict', 'plan_revision_conflict', 'revision_limit'].includes(saved.reason)) return fail(409, saved.reason);
          return fail(503, 'plan_save_outcome_unknown');
        }
        if (saved.reason !== 'saved' || !Number.isSafeInteger(saved.revision) || saved.revision !== expectedRevision + 1 || saved.revision > 200 ||
            saved.project_version !== validation.project_version || typeof saved.created_at !== 'string' || !Number.isFinite(Date.parse(saved.created_at)))
          return fail(503, 'plan_save_outcome_unknown');
        return send(res, 201, { plan: { revision: saved.revision, project_version: saved.project_version, created_at: saved.created_at } }, id);
      }
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
