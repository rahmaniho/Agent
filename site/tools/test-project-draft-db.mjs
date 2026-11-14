import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const sql=await readFile(new URL('../db/009_project_wizard_drafts.sql',import.meta.url),'utf8');
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sample={version:1,title:'طرح',description:'',type:'website',needs:['data'],plan:['مرحله'],step:2};

test('project draft migration enforces owner isolation, validation and CAS including deletion/recreation', async t=>{
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
    insert into auth.users values ('${A}'),('${B}');`);
  await db.exec(sql);
  const actor=async id=>db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${id || ''}';`);
  const save=async (payload,revision)=>(await db.query('select * from public.studio_save_project_draft($1::jsonb,$2::integer)',[JSON.stringify(payload),revision])).rows[0];
  const del=async revision=>(await db.query('select * from public.studio_delete_project_draft($1::integer)',[revision])).rows[0];
  const rows=async ()=>(await db.query('select user_id,payload,revision from public.studio_project_drafts')).rows;
  await actor(A);
  assert.deepEqual(await save(sample,0),{applied:true,revision:1});
  assert.deepEqual(await save({...sample,title:'stale create'},0),{applied:false,revision:null});
  assert.deepEqual(await save({...sample,title:'second'},1),{applied:true,revision:2});
  assert.deepEqual(await save(sample,1),{applied:false,revision:null});
  await assert.rejects(db.query("update public.studio_project_drafts set revision=1"),/permission denied/i);
  await assert.rejects(db.query("delete from public.studio_project_drafts"),/permission denied/i);
  await assert.rejects(db.query("insert into public.studio_project_drafts (user_id) values ($1)",[B]),/permission denied/i);
  await actor(B); assert.equal((await rows()).length,0);
  assert.deepEqual(await save({...sample,title:'user b'},0),{applied:true,revision:1});
  assert.deepEqual((await rows()).map(row=>row.user_id),[B]);
  assert.deepEqual(await del(2),{applied:false,revision:null});
  await actor(A); assert.deepEqual((await rows()).map(row=>row.user_id),[A]);
  assert.deepEqual(await del(2),{applied:true,revision:3});
  assert.equal((await rows())[0].payload,null);
  assert.deepEqual(await save(sample,0),{applied:false,revision:null});
  assert.deepEqual(await save(sample,3),{applied:true,revision:4});
  assert.deepEqual(await save({...sample,title:'stale after delete'},2),{applied:false,revision:null});
  const invalid=[{...sample,extra:'x'},{...sample,needs:['data','data']},{...sample,needs:['admin']},{...sample,plan:Array(51).fill('x')},{...sample,plan:['x'.repeat(201)]},{...sample,step:4},{...sample,version:2},{...sample,title:'x'.repeat(121)},{...sample,type:''},{...sample,needs:'data'},null];
  for(const value of invalid) await assert.rejects(save(value,4),/Invalid draft/);
  assert.equal((await rows())[0].revision,4);
  // Legacy v1 browser drafts without plan and step remain valid.
  assert.deepEqual(await save({version:1,title:'',description:'',type:'website',needs:[]},4),{applied:true,revision:5});
  const simultaneous=await Promise.all([save({...sample,title:'device one'},5),save({...sample,title:'device two'},5)]);
  assert.equal(simultaneous.filter(result=>result.applied).length,1);
  assert.equal((await rows())[0].revision,6);
  await assert.rejects(db.query('select public.studio_project_draft_valid($1::jsonb)',[JSON.stringify(sample)]),/permission denied/i);
  await actor(''); await assert.rejects(save(sample,0),/Access denied/); assert.deepEqual(await rows(),[]);
  await db.exec("reset role; set role anon; set request.jwt.claim.sub = ''; ");
  await assert.rejects(save(sample,0),/permission denied/i);
  await assert.rejects(db.query('select * from public.studio_project_drafts'),/permission denied/i);
});

test('existing project RLS and keyset predicate page equal microsecond timestamps without gaps', async t=>{
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${A}'),('${B}');`);
  const existing=(await readFile(new URL('../db/006_projects_review.sql',import.meta.url),'utf8')).split('alter table public.studio_purchase_requests')[0];
  await db.exec(existing);
  await db.exec(`insert into public.studio_projects (id,user_id,title,project_type,updated_at)
    select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${A}','test','website','2026-11-13T18:19:20.123456+00:00'::timestamptz from generate_series(1,205) i;
    insert into public.studio_projects (user_id,title,project_type) values ('${B}','other','website');
    set role authenticated; set request.jwt.claim.sub='${A}';`);
  let cursor=null, ids=[];
  for(let page=0;page<3;page++) {
    const result=await db.query(`select id, to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') as stamp from public.studio_projects
      where ($1::timestamptz is null or updated_at<$1::timestamptz or (updated_at=$1::timestamptz and id<$2::uuid))
      order by updated_at desc,id desc limit 100`,[cursor?.stamp || null,cursor?.id || null]);
    ids.push(...result.rows.map(row=>row.id)); cursor=result.rows.at(-1); assert.equal(result.rows.length,page===2?5:100);
    assert.equal(cursor.stamp,'2026-11-13T18:19:20.123456+00:00');
  }
  assert.equal(ids.length,205); assert.equal(new Set(ids).size,205);
});

test('Supabase query builder encodes the compound cursor safely and preserves timestamp precision', async ()=>{
  const {createClient}=await import('@supabase/supabase-js'); let captured;
  const client=createClient('https://example.supabase.co','sb_publishable_example',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async url=>{captured=new URL(url);return new Response('[]',{status:200,headers:{'content-type':'application/json'}});}}});
  const filter='updated_at.lt."2026-11-13T18:19:20.123456+00:00",and(updated_at.eq."2026-11-13T18:19:20.123456+00:00",id.lt.00000000-0000-4000-8000-000000000010)';
  const {error}=await client.from('studio_projects').select('id,updated_at').order('updated_at',{ascending:false}).order('id',{ascending:false}).or(filter).limit(100);
  assert.equal(error,null); assert.equal(captured.searchParams.get('or'),`(${filter})`);
  assert.equal(captured.searchParams.get('order'),'updated_at.desc,id.desc'); assert.equal(captured.searchParams.get('limit'),'100');
});

test('additive project CAS RPC enforces ownership, valid patches and atomic expected version', async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    insert into auth.users values ('${A}'),('${B}');`);
  const existing=(await readFile(new URL('../db/006_projects_review.sql',import.meta.url),'utf8')).split('alter table public.studio_purchase_requests')[0];
  await db.exec(existing);await db.exec(await readFile(new URL('../db/010_project_update_cas.sql',import.meta.url),'utf8'));
  const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
  await db.exec(`insert into public.studio_projects(id,user_id,title,description,project_type,checklist) values
    ('${id}','${A}','Original','','website','[{"legacy":"value"}]'),('${other}','${B}','Private','','website','[]');`);
  const actor=async who=>db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${who}';`);
  const update=async (id,version,patch)=>(await db.query('select * from public.studio_update_project_cas($1::uuid,$2::integer,$3::jsonb)',[id,version,JSON.stringify(patch)])).rows[0];
  await actor(A);
  const first=await update(id,1,{title:'Updated'});assert.equal(first.applied,true);assert.equal(first.new_version,2);assert.ok(first.updated_at);
  assert.deepEqual(await update(id,1,{title:'Stale'}),{applied:false,new_version:null,updated_at:null});
  assert.deepEqual(await update(other,1,{title:'Intrusion'}),{applied:false,new_version:null,updated_at:null});
  // Existing checklist formats are preserved; partial patches do not rewrite them.
  assert.deepEqual((await db.query('select checklist from public.studio_projects where id=$1',[id])).rows[0].checklist,[{legacy:'value'}]);
  for(const bad of [{},{user_id:B},{version:99},{updated_at:'2100-01-01'},{title:''},{title:null},{title:' '.repeat(40001)+'x'},{description:null},{project_type:''},{checklist:{}},{checklist:Array(51).fill('x')}])
    await assert.rejects(update(id,2,bad),/Invalid update/);
  const outcomes=await Promise.all([update(id,2,{description:'one'}),update(id,2,{description:'two'})]);
  assert.equal(outcomes.filter(row=>row.applied).length,1);
  assert.equal((await db.query('select version from public.studio_projects where id=$1',[id])).rows[0].version,3);
  await actor(B);assert.deepEqual(await update(id,3,{title:'Cross-user'}),{applied:false,new_version:null,updated_at:null});
  await actor('');await assert.rejects(update(id,3,{title:'No identity'}),/Access denied/);
  await db.exec("reset role; set role anon; set request.jwt.claim.sub='';");
  await assert.rejects(update(id,3,{title:'Anon'}),/permission denied/i);
  // Legacy UPDATE remains granted for compatibility, and is NOT server-enforced CAS.
  await actor(A); await db.query('update public.studio_projects set description=$1 where id=$2',['legacy writer',id]);
  assert.equal((await db.query('select description from public.studio_projects where id=$1',[id])).rows[0].description,'legacy writer');
});
