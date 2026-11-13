#!/usr/bin/env node
// Export only the protected catalog using an already configured psql connection.
// The backup contains no account, project, payment or receipt data.
import { realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve, basename, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

function fail(message) { console.error(message); process.exit(1); }
const args=process.argv.slice(2), pos=args.indexOf('--out'), output=pos>=0 ? args[pos+1] : null;
if (!output || output.startsWith('--')) fail('Usage: node site/tools/export-catalog-backup.mjs --out PRIVATE_BACKUP.json');
const root=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'../..'));
const dest=resolve(output);
let actual;
try { actual=resolve(realpathSync(dirname(dest)),basename(dest)); } catch { fail('Output directory must already exist.'); }
const rel=relative(root,actual);
if (!rel || (!isAbsolute(rel) && rel!=='..' && !rel.startsWith('..'+sep))) fail('Output must be outside the public repository.');
const query=`select jsonb_build_object('format','agent-studio-catalog-v1','captured_at',now(),'postgres_jsonb_md5',jsonb_build_object('catalog',md5(catalog::text),'playbooks',md5(playbooks::text)),'catalog',catalog,'playbooks',playbooks)::text from public.studio_catalog where id=true;`;
const result=spawnSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8',maxBuffer:10*1024*1024,env:{...process.env,PGCONNECT_TIMEOUT:process.env.PGCONNECT_TIMEOUT || '15'}});
if (result.error || result.status!==0) fail('Catalog export failed. Check the configured private database connection and permissions.');
let data;
try { data=JSON.parse(result.stdout); } catch { fail('Catalog export did not return exactly one valid JSON object.'); }
const isList = x => Array.isArray(x) && x.length>0 && x.every(item=>item && typeof item==='object' && !Array.isArray(item));
if (data?.format!=='agent-studio-catalog-v1' || !isList(data.catalog?.skills) || !isList(data.catalog?.commands) || !isList(data.catalog?.agents) || !isList(data.playbooks?.services) || !/^[a-f0-9]{32}$/.test(data.postgres_jsonb_md5?.catalog || '') || !/^[a-f0-9]{32}$/.test(data.postgres_jsonb_md5?.playbooks || '')) fail('Catalog export failed validation; no backup created.');
try { writeFileSync(dest,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'}); }
catch { fail('Unable to create a new output file; check permissions or choose a different name.'); }
console.log(`Private catalog backup created: ${dest}`);
