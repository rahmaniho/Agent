// Integration test for an EXCLUSIVELY disposable local PostgreSQL cluster.
// Never point this at Supabase or any cluster containing other databases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const project=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const key=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const tasks=[{id:'design',title:'طراحی 😀',weight:1,depends_on:[]}];

function localUrl() {
  if (!process.env.STUDIO_TEST_PG_URL) throw new Error('STUDIO_TEST_PG_URL is required; use a disposable local PostgreSQL cluster');
  const url=new URL(process.env.STUDIO_TEST_PG_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
      url.pathname !== '/agent_studio_test' || url.search || url.hash)
    throw new Error('Test refuses non-local or non-disposable database URL');
  return url.toString();
}

async function waitForBlocked(admin,pid) {
  const deadline=Date.now()+4000;
  while(Date.now()<deadline) {
    const {rows}=await admin.query('select wait_event_type from pg_catalog.pg_stat_activity where pid=$1',[pid]);
    if(rows[0]?.wait_event_type==='Lock') return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('Second independent transaction did not wait for a database lock');
}

test('independent PostgreSQL transactions serialize plan writes, retries, rollback and project edits', {timeout:30000}, async t=>{
  const connectionString=localUrl(), clients=[];
  const connect=async()=>{const c=new Client({connectionString,ssl:false,connectionTimeoutMillis:3000});await c.connect();clients.push(c);return c;};
  const admin=await connect();
  t.after(async()=>{for(const c of clients) await c.end().catch(()=>{});});
  const check=await admin.query(`select current_database() db, current_setting('server_encoding') encoding,
    (select count(*)::integer from pg_catalog.pg_database where datallowconn and not datistemplate and datname not in ('postgres','agent_studio_test')) other_databases,
    (select count(*)::integer from pg_catalog.pg_roles where rolname in ('anon','authenticated')) existing_roles,
    (select count(*)::integer from pg_catalog.pg_namespace where nspname='auth') auth_schemas,
    (select count(*)::integer from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f','S')) existing_relations`);
  const env=check.rows[0];
  assert.equal(env.db,'agent_studio_test');assert.equal(env.encoding,'UTF8');
  assert.equal(env.other_databases,0,'use a dedicated cluster without other databases');
  assert.equal(env.existing_roles,0,'test roles already exist; refusing to modify cluster');
  assert.equal(env.auth_schemas,0,'auth schema already exists; refusing to modify database');
  assert.equal(env.existing_relations,0,'public schema is not empty');
  await admin.query(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    insert into auth.users values ('${A}'),('${B}');`);
  const sql006=(await readFile(new URL('../db/006_projects_review.sql',import.meta.url),'utf8')).split('alter table public.studio_purchase_requests')[0];
  await admin.query(sql006);
  await admin.query(await readFile(new URL('../db/011_manual_plan_revisions.sql',import.meta.url),'utf8'));
  await admin.query(await readFile(new URL('../db/012_manual_plan_idempotency.sql',import.meta.url),'utf8'));
  await admin.query(`insert into public.studio_projects(id,user_id,title,project_type) values
    ('${project(1)}','${A}','one','website'),('${project(2)}','${A}','two','website'),
    ('${project(3)}','${A}','three','website'),('${project(4)}','${A}','four','website'),('${project(5)}','${A}','five','website');`);
  const one=await connect(), two=await connect();
  for (const client of [one,two]) await client.query(`set role authenticated; set request.jwt.claim.sub='${A}'; set statement_timeout='8s';`);
  const pid=(await two.query('select pg_backend_pid() pid')).rows[0].pid;
  const save=(client,p,k,input=tasks)=>(client.query('select * from public.studio_save_manual_plan($1::uuid,1,0,$2::jsonb,$3::uuid)',[p,JSON.stringify(input),k]));
  const contested=async(p,firstKey,secondKey,endFirst,expected,secondTasks=tasks)=>{
    await one.query('begin');const initial=(await save(one,p,firstKey)).rows[0];assert.equal(initial.reason,'saved');
    // Attach both handlers immediately so a timeout cannot cause an unhandled rejection.
    const pending=save(two,p,secondKey,secondTasks).then(value=>({value}),error=>({error}));
    await waitForBlocked(admin,pid);
    await one.query(endFirst);
    const outcome=await pending;if(outcome.error) throw outcome.error;
    assert.equal(outcome.value.rows[0].reason,expected);
    const revisions=await admin.query('select revision,operation_id from public.studio_manual_plan_revisions where project_id=$1 order by revision',[p]);
    assert.equal(revisions.rowCount,1);assert.equal(revisions.rows[0].revision,1);
    assert.equal(revisions.rows[0].operation_id,endFirst==='rollback' ? secondKey : firstKey);
  };
  await contested(project(1),key(1),key(1),'commit','replayed');
  await contested(project(2),key(2),key(3),'commit','plan_revision_conflict');
  await contested(project(3),key(4),key(5),'rollback','saved');
  await contested(project(5),key(7),key(7),'commit','idempotency_key_conflict',[{...tasks[0],title:'different'}]);
  await one.query('begin');await one.query('update public.studio_projects set version=2 where id=$1',[project(4)]);
  const pending=save(two,project(4),key(6)).then(value=>({value}),error=>({error}));
  await waitForBlocked(admin,pid);await one.query('commit');
  const outcome=await pending;if(outcome.error) throw outcome.error;
  assert.equal(outcome.value.rows[0].reason,'project_version_conflict');
  assert.equal((await admin.query('select count(*)::int n from public.studio_manual_plan_revisions where project_id=$1',[project(4)])).rows[0].n,0);
});
