#!/usr/bin/env node
// Prepare a private SQL file for psql. No database connection or credentials here.
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, basename, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
function option(name) { const index=args.indexOf(name); return index>=0 ? args[index+1] : null; }
function fail(message) { console.error(message); process.exit(1); }
const input=option('--input'), output=option('--out'), apply=args.includes('--commit');
if (!input || !output || input.startsWith('--') || output.startsWith('--')) fail('Usage: node site/tools/prepare-catalog-restore.mjs --input PRIVATE_BACKUP.json --out PRIVATE_OUTPUT.sql [--commit]');
const root=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const dest=resolve(output);
let actual;
try { actual=resolve(realpathSync(dirname(dest)),basename(dest)); } catch { fail('Output directory must already exist.'); }
const rel=relative(root,actual);
if (!rel || (!isAbsolute(rel) && rel!=='..' && !rel.startsWith('..'+sep))) fail('Output must be outside the public repository.');
let data;
try {
  const raw=readFileSync(resolve(input));
  if(raw.length>10*1024*1024) throw Error('Backup exceeds 10 MiB');
  data=JSON.parse(raw.toString('utf8'));
} catch { fail('Unable to read a valid JSON backup (maximum 10 MiB).'); }
const validArray = x => Array.isArray(x) && x.length>0 && x.every(item => item && typeof item === 'object' && !Array.isArray(item));
if (data?.format!=='agent-studio-catalog-v1' || !validArray(data.catalog?.skills) || !validArray(data.catalog?.commands) || !validArray(data.catalog?.agents) || !validArray(data.playbooks?.services) || !/^[0-9a-f]{32}$/.test(data.postgres_jsonb_md5?.catalog || '') || !/^[0-9a-f]{32}$/.test(data.postgres_jsonb_md5?.playbooks || '')) fail('Backup shape or PostgreSQL checksums are invalid.');
const payload=JSON.stringify({catalog:data.catalog,playbooks:data.playbooks});
let tag; do { tag=`$studio_${randomBytes(16).toString('hex')}$`; } while(payload.includes(tag));
const sql=`-- Sensitive content: keep this file private and delete it after use.\n-- ${apply ? 'WARNING: commits to the connected database; verify the target first.' : 'DRY RUN: rolls back all changes.'}\n\\set ON_ERROR_STOP on\nbegin;\ncreate temp table studio_restore_stage(payload jsonb not null) on commit drop;\ninsert into studio_restore_stage values (${tag}${payload}${tag}::jsonb);\ninsert into public.studio_catalog(id,catalog,playbooks)\n  select true,payload->'catalog',payload->'playbooks' from studio_restore_stage\n  on conflict(id) do update set catalog=excluded.catalog,playbooks=excluded.playbooks;\ndo $check$ begin\n  if not exists(select 1 from public.studio_catalog where id=true and md5(catalog::text)='${data.postgres_jsonb_md5.catalog}' and md5(playbooks::text)='${data.postgres_jsonb_md5.playbooks}') then\n    raise exception 'Backup checksum does not match restored JSONB';\n  end if;\nend $check$;\n${apply ? 'commit' : 'rollback'};\n`;
try { writeFileSync(dest,sql,{mode:0o600,flag:'wx'}); }
catch { fail('Unable to create a new output file; check permissions or choose a different name.'); }
console.log(`Prepared ${apply?'COMMIT':'ROLLBACK'} SQL file: ${dest}`);
