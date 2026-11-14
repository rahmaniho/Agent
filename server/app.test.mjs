import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, validateConfig } from './app.mjs';

const config = { supabaseUrl: 'https://staging.example.test', publishableKey: 'sb_publishable_example' };
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tokens = { 'token-a': userA, 'token-b': userB };
const projects = { [userA]: [{ id: 'project-a', title: 'الف', checklist: [] }], [userB]: [{ id: 'project-b', title: 'ب', checklist: [] }] };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function withApp(t, fetchImpl) {
  const server = createApp(config, { fetchImpl, timeoutMs: 100 });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
function fakeSupabase(calls) {
  return async (url, init) => {
    calls.push({ url: String(url), ...init });
    const token = init.headers.authorization.slice('Bearer '.length);
    const user = tokens[token];
    if (!user) return json({ message: 'bad token' }, 401);
    if (new URL(url).pathname === '/auth/v1/user') return json({ id: user, email: 'private@example.test' });
    if (new URL(url).pathname === '/rest/v1/studio_projects') return json(projects[user]);
    throw new Error('unexpected path');
  };
}
const get = (url, token) => fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });

test('configuration rejects secrets, insecure or non-origin URLs', () => {
  assert.equal(validateConfig(config).base, config.supabaseUrl);
  for (const url of ['http://example.test', 'https://example.test/path', 'https://u:p@example.test', 'https://example.test/?x=1', '', undefined])
    assert.throws(() => validateConfig({ ...config, supabaseUrl: url }));
  for (const key of ['sb_secret_example', 'service_role', 'eyJhbGci.jwt', '', undefined])
    assert.throws(() => validateConfig({ ...config, publishableKey: key }));
});

test('health is liveness only; unknown, mutation, parameters and missing bearer are rejected without upstream', async t => {
  const calls = [];
  const base = await withApp(t, fakeSupabase(calls));
  const health = await get(base + '/api/v1/health');
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.match(health.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  assert.equal((await get(base + '/api/v1/projects')).status, 401);
  assert.equal((await get(base + '/api/v1/projects?user_id=other', 'token-a')).status, 400);
  assert.equal((await get(base + '/api/v1/not-real')).status, 404);
  const mutation = await fetch(base + '/api/v1/projects', { method: 'POST', body: '{}' });
  assert.equal(mutation.status, 405);
  assert.equal(mutation.headers.get('allow'), 'GET');
  assert.equal(calls.length, 0);
});

test('identity is verified online; private profile details are not returned', async t => {
  const calls = [], base = await withApp(t, fakeSupabase(calls));
  const response = await get(base + '/api/v1/me', 'token-a');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: userA });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, config.supabaseUrl + '/auth/v1/user');
  assert.equal(calls[0].headers.authorization, 'Bearer token-a');
  assert.equal(calls[0].headers.apikey, config.publishableKey);
  assert.equal(calls[0].redirect, 'error');
  assert.equal((await get(base + '/api/v1/me', 'invalid')).status, 401);
});

test('parallel users forward their own bearer to RLS; no service key, shared cache or client-specified tenant', async t => {
  const calls = [], base = await withApp(t, fakeSupabase(calls));
  const [ra, rb] = await Promise.all([get(base + '/api/v1/projects', 'token-a'), get(base + '/api/v1/projects', 'token-b')]);
  assert.deepEqual(await ra.json(), { projects: projects[userA], limit: 100, possibly_more: false });
  assert.deepEqual(await rb.json(), { projects: projects[userB], limit: 100, possibly_more: false });
  const rest = calls.filter(c => new URL(c.url).pathname === '/rest/v1/studio_projects');
  assert.equal(rest.length, 2);
  assert.deepEqual(rest.map(c => c.headers.authorization).sort(), ['Bearer token-a', 'Bearer token-b']);
  for (const c of rest) {
    const params = new URL(c.url).searchParams;
    assert.equal(params.get('limit'), '100');
    assert.equal(params.get('order'), 'updated_at.desc,id.desc');
    assert.equal(params.has('user_id'), false);
    assert.equal(c.headers.apikey, config.publishableKey);
  }
});

test('unauthorized, failing and malformed upstream responses fail closed without leaking details', async t => {
  const fake = async (url, init) => {
    const token = init.headers.authorization.slice(7);
    if (token === 'invalid') return json({ secret: 'must-not-leak' }, 401);
    if (token === 'down') throw new Error('must-not-leak');
    if (token === 'bad-profile') return json({ id: 'not-a-uuid', secret: 'must-not-leak' });
    if (token === 'huge') return new Response('x'.repeat(4 * 1024 * 1024 + 1));
    if (new URL(url).pathname.endsWith('/user')) return json({ id: userA });
    if (token === 'denied') return json({ secret: 'must-not-leak' }, 403);
    if (token === 'bad-rows') return json({ secret: 'must-not-leak' });
    return json({}, 500);
  };
  const base = await withApp(t, fake);
  for (const [token, status] of [['invalid', 401], ['down', 503], ['bad-profile', 503], ['huge', 503], ['denied', 403], ['bad-rows', 503]]) {
    const r = await get(base + '/api/v1/projects', token);
    assert.equal(r.status, status, token);
    const body = await r.text();
    assert.ok(!body.includes('must-not-leak') && !body.includes(JSON.stringify(token)));
    assert.equal(JSON.parse(body).error.request_id, r.headers.get('x-request-id'));
  }
});

test('authentication and project requests time out without reporting success', async t => {
  const base = await withApp(t, (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })));
  const response = await get(base + '/api/v1/me', 'token-a');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'upstream_unavailable');
});

test('empty projects and exactly 100 results are distinguished without inventing totals', async t => {
  let count = 0;
  const fake = async url => new URL(url).pathname.endsWith('/user') ? json({ id: userA }) : json(Array.from({ length: count }, (_, i) => ({ id: String(i) })));
  const base = await withApp(t, fake);
  let result = await (await get(base + '/api/v1/projects', 'token-a')).json();
  assert.deepEqual(result, { projects: [], limit: 100, possibly_more: false });
  count = 100;
  result = await (await get(base + '/api/v1/projects', 'token-a')).json();
  assert.equal(result.projects.length, 100);
  assert.equal(result.possibly_more, true);
  count = 101;
  assert.equal((await get(base + '/api/v1/projects', 'token-a')).status, 503);
});
