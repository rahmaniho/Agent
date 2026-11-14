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

const projectA='11111111-1111-4111-8111-111111111111';
const projectB='22222222-2222-4222-8222-222222222222';
const scopedProjects={
  [projectA]:{id:projectA,user_id:userA,title:'پروژه الف',description:'',project_type:'website',checklist:[],version:3,updated_at:'2026-11-13T12:00:00Z'},
  [projectB]:{id:projectB,user_id:userB,title:'پروژه ب',description:'',project_type:'website',checklist:[],version:1,updated_at:'2026-11-13T12:00:00Z'},
};
function scopedSupabase(calls) {
  return async (url,init)=>{
    const parsed=new URL(url); calls.push({url:parsed,...init});
    const who=tokens[init.headers.authorization.slice(7)]; if(!who) return json({},401);
    if(parsed.pathname==='/auth/v1/user') return json({id:who});
    const id=parsed.searchParams.get('id')?.slice(3), owner=parsed.searchParams.get('user_id')?.slice(3), row=scopedProjects[id];
    return json(row && row.user_id===who && owner===who ? [row] : []);
  };
}
const postPlan=(base,id,token,body,headers={})=>fetch(`${base}/api/v1/projects/${id}/plan-validation`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const proposal=()=>({project_version:3,tasks:[{id:'build',title:'ساخت',weight:3,depends_on:['design']},{id:'design',title:'طراحی',weight:1,depends_on:[]}]});

test('project detail binds the verified user to the object query and hides other owners', async t=>{
  const calls=[],base=await withApp(t,scopedSupabase(calls));
  const own=await get(`${base}/api/v1/projects/${projectA}`,'token-a');
  assert.equal(own.status,200); const detail=await own.json(); assert.equal(detail.project.id,projectA); assert.equal(detail.project.title,'پروژه الف'); assert.equal('user_id' in detail.project,false);
  const query=calls.find(call=>call.url.pathname==='/rest/v1/studio_projects');
  assert.equal(query.url.searchParams.get('id'),`eq.${projectA}`); assert.equal(query.url.searchParams.get('user_id'),`eq.${userA}`);
  assert.equal(query.headers.authorization,'Bearer token-a');
  assert.equal((await get(`${base}/api/v1/projects/${projectB}`,'token-a')).status,404);
  assert.equal((await get(`${base}/api/v1/projects/${projectA}`,'token-b')).status,404);
  assert.equal((await get(`${base}/api/v1/projects/${projectA}`)).status,401);
  assert.equal((await get(`${base}/api/v1/projects/11111111-1111-1111-1111-11111111111z`,'token-a')).status,404);
});

test('project detail fails closed if upstream returns a different owner or project', async t=>{
  for(const row of [{...scopedProjects[projectA],user_id:userB},{...scopedProjects[projectA],id:projectB},{...scopedProjects[projectA],version:0}]) {
    const base=await withApp(t,async url=>new URL(url).pathname==='/auth/v1/user'?json({id:userA}):json([row]));
    const response=await get(`${base}/api/v1/projects/${projectA}`,'token-a');assert.equal(response.status,503);
    assert.ok(!(await response.text()).includes('پروژه'));
  }
});

test('plan validation checks RLS scope, task DAG and project version without creating a run', async t=>{
  const calls=[],base=await withApp(t,scopedSupabase(calls));
  const response=await postPlan(base,projectA,'token-a',proposal());assert.equal(response.status,200);
  assert.deepEqual((await response.json()).validation,{valid:true,project_version:3,task_count:2,total_weight:4,topological_order:['design','build'],project_id:projectA});
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await postPlan(base,projectA,'token-b',proposal())).status,404);
  assert.equal((await postPlan(base,projectB,'token-a',proposal())).status,404);
  const stale=proposal();stale.project_version=2;assert.equal((await postPlan(base,projectA,'token-a',stale)).status,409);
  const cyclic=proposal();cyclic.tasks[1].depends_on=['build'];const bad=await postPlan(base,projectA,'token-a',cyclic);
  assert.equal(bad.status,422);assert.equal((await bad.json()).error.issue,'tasks.cycle');
  const forged=proposal();forged.tasks[0].status='succeeded';assert.equal((await postPlan(base,projectA,'token-a',forged)).status,422);
  assert.ok(calls.every(call=>call.method==='GET')); // No model, mutation, or worker invocation.
});

test('plan API rejects unsupported media, malformed or oversized bodies and wrong methods', async t=>{
  const calls=[],base=await withApp(t,scopedSupabase(calls));
  assert.equal((await postPlan(base,projectA,'token-a','{}',{'content-type':'text/plain'})).status,415);
  assert.equal((await postPlan(base,projectA,'token-a','{}',{'content-encoding':'gzip'})).status,415);
  assert.equal((await postPlan(base,projectA,'token-a',' '.repeat(65537))).status,413);
  assert.equal(calls.length,0);
  assert.equal((await postPlan(base,projectA,'token-a','{broken')).status,400);
  assert.equal((await get(`${base}/api/v1/projects/${projectA}/plan-validation`,'token-a')).status,405);
  assert.equal((await fetch(`${base}/api/v1/projects/${projectA}`,{method:'POST'})).status,405);
});

test('plan validation bounds chunked request bodies', async t=>{
  const {request}=await import('node:http'),calls=[],base=await withApp(t,scopedSupabase(calls));
  const code=await new Promise((resolve,reject)=>{
    const req=request(`${base}/api/v1/projects/${projectA}/plan-validation`,{method:'POST',headers:{authorization:'Bearer token-a','content-type':'application/json','transfer-encoding':'chunked'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.write('x'.repeat(40000));req.end('x'.repeat(30000));
  });
  assert.equal(code,413);
});

test('disconnect during authentication does not continue to project data', async t=>{
  const {request}=await import('node:http');let resolveAuth, databaseCalls=0;
  const base=await withApp(t,(url)=>{
    if(new URL(url).pathname==='/auth/v1/user') return new Promise(resolve=>{resolveAuth=resolve;});
    databaseCalls++;return json([]);
  });
  const req=request(`${base}/api/v1/projects/${projectA}/plan-validation`,{method:'POST',headers:{authorization:'Bearer token-a','content-type':'application/json','transfer-encoding':'chunked'}});
  req.on('error',()=>{});req.write('{');
  for(let i=0;i<50 && !resolveAuth;i++) await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(typeof resolveAuth,'function');req.destroy();await new Promise(resolve=>setTimeout(resolve,30));resolveAuth(json({id:userA}));
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(databaseCalls,0);
  assert.equal((await get(`${base}/api/v1/health`)).status,200);
});
