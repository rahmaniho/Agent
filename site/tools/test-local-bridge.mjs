import http from 'node:http'; import { fileURLToPath } from 'node:url'; import {spawn} from 'node:child_process'; import assert from 'node:assert/strict';
// Run from the repository root: node site/tools/test-local-bridge.mjs
const mock=http.createServer((req,res)=>{res.setHeader('content-type','application/json'); res.end(JSON.stringify({path:req.url,host:req.headers.host,origin:req.headers.origin}));}); await new Promise(r=>mock.listen(18082,'127.0.0.1',r));
const child=spawn('node',[fileURLToPath(new URL('../serve.mjs', import.meta.url)),'--host','127.0.0.1','--port','14173','--fcc-local','--fcc-port','18082']);
await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',reject)});
try { let r=await fetch('http://127.0.0.1:14173/api/fcc/bootstrap'); let d=await r.json(); assert.equal(d.path,'/admin/api/code/bootstrap'); assert.equal(d.host,'127.0.0.1:18082');
r=await fetch('http://127.0.0.1:14173/api/fcc/sessions'); assert.equal(r.status,200);
r=await fetch('http://127.0.0.1:14173/api/fcc/sessions',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'}); assert.equal(r.status,403);
r=await fetch('http://127.0.0.1:14173/api/fcc/sessions',{method:'POST',headers:{origin:'http://127.0.0.1:14173','content-type':'application/json'},body:'{}'}); assert.equal(r.status,200);
r=await fetch('http://127.0.0.1:14173/api/fcc/folder-picker',{method:'POST',headers:{origin:'http://127.0.0.1:14173'}}); assert.equal(r.status,404);
let code = await new Promise((resolve,reject)=>http.get('http://127.0.0.1:14173/',{headers:{host:'evil.example'}},res=>{res.resume();resolve(res.statusCode)}).on('error',reject)); assert.equal(code,403); console.log('Local FCC bridge: forwarding, origin checks, route allowlist and host checks passed'); } finally { child.kill(); mock.close(); }
