import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const site = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', site), 'utf8');
const app = await readFile(new URL('assets/app.js', site), 'utf8');
const agent = await readFile(new URL('assets/agent.js', site), 'utf8');
const data = JSON.parse(await readFile(new URL('assets/data.json', site), 'utf8'));
const playbooks = JSON.parse(await readFile(new URL('assets/playbooks.json', site), 'utf8'));
// Synthetic gated payload: exercises access transitions without storing paid material in Git.
const fullData = structuredClone(data);
fullData.skills.push({name:'synthetic-premium-tool',desc:'Synthetic test-only tool.'},{name:'configure-ecc',desc:'Synthetic test-only identifier.'});
fullData.counts.skills = fullData.skills.length;
const fullPlaybooks = structuredClone(playbooks);
for (const service of fullPlaybooks.services) delete service.sample;
fullPlaybooks.services.find(s=>s.id==='webapp').prompts.push({title:'آزمون',text:'SYNTHETIC PREMIUM PROMPT FOR TEST ONLY'});
fullPlaybooks.services.find(s=>s.id==='harness').skills.push('configure-ecc');
fullPlaybooks.services.find(s=>s.id==='website').skills.push('synthetic-premium-tool');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await delay(10); } throw new Error('Timed out waiting for UI'); }
function page() {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:4173/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.scrollTo = () => {}; dom.window.matchMedia = () => ({ matches:false });
  return dom;
}

test('the removed footer notice is not displayed', () => {
  const dom = page();
  try {
    const text = dom.window.document.body.textContent;
    assert.doesNotMatch(text, /محتوا از ECC نسخهٔ/);
    assert.doesNotMatch(text, /این اپ مستقل است/);
    assert.ok(dom.window.document.querySelector('.foot__meta'));
  } finally { dom.window.close(); }
});

test('route progress persists and is shown on the dashboard', async () => {
  const dom = page(), w = dom.window, $ = s => w.document.querySelector(s);
  w.fetch = async url => ({ ok:true, json:async () => url.endsWith('playbooks.json') ? playbooks : data });
  w.eval(app);
  try {
    await waitFor(() => $('#popularCards').children.length === 4);
    $('#searchOpen').focus(); $('#searchOpen').click();
    assert.equal($('#palette').hidden, false);
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    assert.equal($('#palette').hidden, true); assert.equal(w.document.activeElement, $('#searchOpen'));
    w.location.hash = '#/s/website';
    await waitFor(() => !w.document.querySelector('[data-view=playbook]').hidden);
    $('#favoritePlaybook').click();
    const first = $('#pbSteps input[data-step="0"]'); first.checked = true; first.dispatchEvent(new w.Event('change', { bubbles:true }));
    assert.equal($('#favoritePlaybook').getAttribute('aria-pressed'), 'true');
    assert.match($('#pbProgress').textContent, /۱ از/);
    assert.deepEqual(JSON.parse(w.localStorage.getItem('agent-studio-progress-v1')).website.steps, [0]);
    w.location.hash = '#/';
    await waitFor(() => !w.document.querySelector('[data-view=home]').hidden);
    assert.ok($('#journeyList a[href="#/s/website"]'));
    w.location.hash = '#/s/website';
    await waitFor(() => !w.document.querySelector('[data-view=playbook]').hidden);
    assert.equal($('#pbSteps input[data-step="0"]').checked, true);
  } finally { dom.window.close(); }
});

test('agent lists and opens sessions, sends once and stops using the active run ID', async () => {
  const dom = page(), w = dom.window, $ = s => w.document.querySelector(s);
  const id = '11111111-1111-4111-8111-111111111111', runId = '22222222-2222-4222-8222-222222222222';
  let run = null; const calls = [];
  Object.defineProperty(w.crypto, 'randomUUID', { value: () => '33333333-3333-4333-8333-333333333333' });
  w.fetch = async (url, options = {}) => {
    calls.push({url, options});
    const session = {id, title:'Project', cwd:'/project', revision:1, status:'ready'};
    let payload;
    if (url.endsWith('/bootstrap')) payload = {available:true, epoch:'epoch'};
    else if (url.endsWith('/sessions')) payload = {sessions:[session]};
    else if (url.endsWith('/turns')) { run = {id:runId,status:'running'}; payload = run; }
    else if (url.endsWith('/stop')) { run = {id:runId,status:'interrupted'}; payload = run; }
    else payload = {session,epoch:'epoch',run,items:[],prompts:[]};
    return {ok:true,json:async()=>payload};
  };
  w.eval(agent);
  try {
    await waitFor(() => $('#agentSessionsList button'));
    $('#agentSessionsList button').click();
    await waitFor(() => $('#agentSessionLabel').textContent.includes('/project'));
    $('#agentText').value = 'بررسی پروژه';
    $('#agentSend').dispatchEvent(new w.Event('submit', {bubbles:true,cancelable:true}));
    await waitFor(() => !$('#agentStop').disabled);
    assert.equal(calls.filter(c => c.url.endsWith('/turns')).length, 1);
    $('#agentStop').click();
    await waitFor(() => calls.some(c => c.url.endsWith('/stop')));
    const stop = calls.find(c => c.url.endsWith('/stop'));
    assert.equal(JSON.parse(stop.options.body).operation_id, runId);
    await waitFor(() => $('#agentStop').disabled && $('#agentStatus').textContent.includes('متوقف شده'));
  } finally { dom.window.close(); }
});

test('all project paths have plain-language needs and library categories show mapped tools', async () => {
  const dom = page(), w = dom.window, $ = s => w.document.querySelector(s);
  w.fetch = async url => ({ ok:true, json:async () => url.endsWith('playbooks.json') ? playbooks : data });
  w.eval(app);
  try {
    await waitFor(() => $('#libCategory').options.length === playbooks.services.length + 2);
    for (const service of playbooks.services) {
      w.location.hash = `#/s/${service.id}`;
      await waitFor(() => $('#pbTitle').textContent === service.title);
      assert.ok($('#pbNeeds').textContent.length > 20, service.id);
      assert.ok(service.steps.every(step => step.simpleTitle));
    }
    w.location.hash = '#/library';
    await waitFor(() => !$('[data-view=library]').hidden);
    $('#libCategory').value = 'website'; $('#libCategory').dispatchEvent(new w.Event('change'));
    const visible = [...$('#libList').querySelectorAll('button[data-copy-text]')].map(el => el.dataset.copyText);
    assert.deepEqual(visible.sort(), playbooks.services.find(s => s.id === 'website').skills.slice().sort());
    assert.equal(w.document.querySelectorAll('a[href*="github.com"]').length, 0);
  } finally { dom.window.close(); }
});

const workspaceSource = await readFile(new URL('src/workspace.js', site), 'utf8');
test('home opens without login and authentication opens only on request', async () => {
  const dom = page(), w = dom.window, $ = s => w.document.querySelector(s);
  const session = {user:{id:'user-1',email:'person@example.test'}};
  let onAuth; const calls = [];
  const client = {
    auth:{onAuthStateChange: fn => { onAuth=fn; }, getSession: async () => ({data:{session:null}}), signInWithPassword: async () => {onAuth('SIGNED_IN',session); return {error:null};}, signUp: async () => ({data:{session:null}}), signOut: async()=>({error:null})},
    rpc: async name => {calls.push(name); return {data:[{is_admin:false,plan:'free',expires_at:null}]};},
    from: () => ({select: () => ({order: () => ({order: () => ({range: async () => ({data:[],error:null})})})})})
  };
  w.__client=client;
  w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(() => $('#authStatus').textContent === '');
    assert.equal($('#loginGate').hidden, true);
    $('#headerLogin').click(); assert.equal($('#loginGate').hidden, false);
    $('#guestAccess').click(); assert.equal($('#loginGate').hidden, true);
    $('#openLogin').click(); assert.equal($('#loginGate').hidden, false);
    $('#authEmail').value='person@example.test'; $('#authPassword').value='password';
    $('#authForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
    await waitFor(() => $('#accountPlan').textContent === 'رایگان');
    await waitFor(() => $('#loginGate').hidden); assert.equal($('#adminContent').hidden,true);
    assert.equal(calls.includes('studio_admin_users'),false);
  } finally {dom.window.close();}
});

test('admin can submit a manual subscription change through the authorized RPC', async () => {
  const dom = page(), w=dom.window, $=s=>w.document.querySelector(s);
  const session={user:{id:'admin-1',email:'admin@example.test'}}; const calls=[];
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session}})},
    rpc:async(name,args)=>{calls.push({name,args}); if(name==='studio_my_account') return {data:[{is_admin:true,plan:'free'}]}; if(name==='studio_admin_users') return {data:[{user_id:'user-1',email:'member@example.test',plan:'free',expires_at:null}]}; return {data:null,error:null};},
    from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client; w.confirm=()=>true;
  w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>!$('#adminContent').hidden);
    $('#adminUsers input').value='2099-01-01'; $('#adminUsers button').click();
    await waitFor(()=>calls.some(c=>c.name==='studio_set_subscription'));
    const call=calls.find(c=>c.name==='studio_set_subscription');
    assert.equal(call.args.target_user,'user-1'); assert.equal(call.args.target_plan,'plus'); assert.match(call.args.target_expiry,/2099-01-01/);
    await waitFor(() => calls.filter(c => c.name === 'studio_admin_users').length === 2 && !$('#adminContent').hidden);
  } finally {dom.window.close();}
});

test('public assets include only the intended samples and no premium catalog content', async () => {
  assert.equal(data.skills.length, 16);
  assert.equal(playbooks.services.reduce((n,s)=>n+s.prompts.length,0),2);
  const premiumPrompt = fullPlaybooks.services.find(s=>s.id==='webapp').prompts[0].text;
  assert.ok(!JSON.stringify(playbooks).includes(premiumPrompt));
  assert.ok(playbooks.services.every(s=>s.sample));
  await assert.rejects(readFile(new URL('../catalog/data.json', site), 'utf8'), {code:'ENOENT'});
  await assert.rejects(readFile(new URL('../catalog/playbooks.json', site), 'utf8'), {code:'ENOENT'});
});

test('authorized catalog replaces the sample and sign-out resets the visible view', async () => {
  const dom = page(), w=dom.window, $=s=>w.document.querySelector(s);
  w.fetch = async url => ({ok:true,json:async()=>url.endsWith('playbooks.json') ? playbooks : data});
  w.eval(app);
  try {
    w.location.hash='#/s/webapp';
    await waitFor(()=>$('#pbTitle').textContent === 'ساخت برنامه و داشبورد');
    assert.equal($('#pbPaywall').hidden,false); assert.equal(w.document.querySelectorAll('#pbPrompts .prompt').length,0);
    w.dispatchEvent(new w.CustomEvent('studio:catalog',{detail:{catalog:fullData,playbooks:fullPlaybooks}}));
    await waitFor(()=>$('#pbPaywall').hidden === true && w.document.querySelectorAll('#pbPrompts .prompt').length > 0);
    w.location.hash = '#/fcc';
    await waitFor(() => !$('[data-view=fcc]').hidden);
    w.dispatchEvent(new w.CustomEvent('studio:catalog',{detail:null}));
    await waitFor(() => !$('[data-view=paywall]').hidden);
    assert.equal($('[data-view=fcc]').hidden, true);
    w.location.hash = '#/s/webapp';
    await waitFor(()=>$('#pbPaywall').hidden === false && w.document.querySelectorAll('#pbPrompts .prompt').length === 0);
  } finally { dom.window.close(); }
});

test('a signed-in customer submits a manual payment reference', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s); let onAuth; const calls=[];
  const session={user:{id:'member-1',email:'member@example.test'}};
  const client={auth:{onAuthStateChange:fn=>{onAuth=fn;},getSession:async()=>({data:{session}})},
    rpc:async(name,args)=>{calls.push({name,args}); if(name==='studio_my_account') return {data:[{is_admin:false,plan:'free'}]}; if(name==='studio_my_purchases_v2') return {data:[]}; if(name==='studio_prepare_receipt') return {data:'member-1/receipt-id',error:null}; return {data:1,error:null};},
    storage:{from:()=>({remove:async()=>({error:null}),upload:async()=>({error:null})})},
    from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client;
  w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>!$('#purchaseFields').disabled);
    $('#purchaseReference').value='receipt 123';
    $('#purchasePayerEmail').value='payer@example.test'; $('#purchaseDate').value='2999-01-02'; $('#purchaseTime').value='09:15';
    $('#purchaseForm').reportValidity=()=>true; Object.defineProperty($('#purchaseReceipt'), 'files', {value:[new w.File(['png'], 'receipt.png', {type:'image/png'})]});
    $('#purchaseForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    assert.match($('#purchaseStatus').textContent,/گذشته/);
    assert.equal(calls.some(c=>c.name==='studio_submit_purchase_with_receipt'),false);
    $('#purchaseDate').value='2024-01-02';
    $('#purchaseForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>$('#purchaseStatus').textContent.includes('برای بررسی به پنل مدیر ارسال شد'));
    const sent=calls.find(c=>c.name==='studio_submit_purchase_with_receipt').args;
    assert.equal(sent.reference,'receipt 123'); assert.equal(sent.receipt,'member-1/receipt-id'); assert.equal(sent.payer_email,'payer@example.test'); assert.ok(!Number.isNaN(Date.parse(sent.paid_at)));
    const email=$('#purchaseEmail'); assert.equal(email.hidden,false);
    const link=new URL(email.href); assert.equal(link.protocol,'mailto:'); assert.equal(link.pathname,'rahmani.hosseine@gmail.com');
    const body=link.searchParams.get('body'); assert.match(body,/receipt 123/); assert.match(body,/payer@example.test/); assert.match(body,/تومان/); assert.match(body,/زمان جهانی/);
    assert.equal(calls.some(c=>c.name==='studio_premium_catalog'),false);
    onAuth('SIGNED_OUT',null); await waitFor(()=>$('#purchaseFields').disabled);
  } finally {dom.window.close();}
});

test('manager reviews a purchase request with an expiry date', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s); const calls=[];
  const session={user:{id:'admin-1',email:'admin@example.test'}};
  let pending=true;
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session}})},
    rpc:async(name,args)=>{calls.push({name,args});
      if(name==='studio_my_account') return {data:[{is_admin:true,plan:'free'}]};
      if(name==='studio_premium_catalog') return {data:[{catalog:data,playbooks}]};
      if(name==='studio_admin_users' || name==='studio_my_purchases_v2') return {data:[]};
      if(name==='studio_admin_purchases_v3') return {data:pending?[{id:1,email:'member@example.test',payment_reference:'receipt 123',payer_email:'payer@example.test',paid_at:'2024-01-02T09:15:00.000Z',amount_toman:990000,status:'pending'}]:[]};
      if(name==='studio_review_purchase_v2'){pending=false;return {error:null};}
      return {data:[],error:null};},
    from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client; w.confirm=()=>true;
  w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>$('#adminPurchases input'));
    assert.match($('#adminPurchases').textContent,/payer@example.test/); assert.match($('#adminPurchases').textContent,/receipt 123/); assert.ok($('#adminPurchases input').value);
    $('#adminPurchases input').value='2099-01-01'; [...$('#adminPurchases').querySelectorAll('button')].find(b=>b.textContent==='تأیید و فعال‌سازی').click();
    await waitFor(()=>calls.some(c=>c.name==='studio_review_purchase_v2'));
    const call=calls.find(c=>c.name==='studio_review_purchase_v2');
    assert.equal(call.args.decision,'approved'); assert.equal(call.args.request_id,1); assert.match(call.args.target_expiry,/2099-01-01/);
    await waitFor(()=>$('#adminPurchaseStatus').textContent.includes('درخواستی در این صفحه'));
  } finally { dom.window.close(); }
});

test('prompt builder is gated in the UI, builds safely and clears on subscription loss', async () => {
  const dom = page(), w = dom.window, $ = s => w.document.querySelector(s);
  let copied = '';
  Object.defineProperty(w.navigator, 'clipboard', {value:{writeText:async text => {copied = text;}}});
  w.fetch = async url => ({ok:true, json:async () => url.endsWith('playbooks.json') ? playbooks : data});
  w.eval(app);
  try {
    await waitFor(() => $('#popularCards').children.length === 4);
    w.location.hash = '#/builder/website';
    await waitFor(() => !$('[data-view=paywall]').hidden);
    w.dispatchEvent(new w.CustomEvent('studio:catalog', {detail:{catalog:data,playbooks}}));
    await waitFor(() => !$('[data-view=builder]').hidden);
    assert.equal($('#builderKind').value, 'website');
    $('#builderTask').value = '<img src=x onerror=alert(1)> یک صفحه بساز';
    $('#builderContext').value = 'مخاطب: تازه‌کار';
    $('#builderFormat').value = 'چک‌لیست';
    $('#builderExample').value = 'نمونه ساده';
    $('#builderForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    assert.match($('#builderOutput').textContent, /متخصص طراحی و ساخت سایت/);
    assert.match($('#builderOutput').textContent, /مخاطب: تازه‌کار/);
    assert.match($('#builderOutput').textContent, /چک‌لیست/);
    assert.match($('#builderOutput').textContent, /نمونه ساده/);
    assert.equal($('#builderOutput img'), null);
    $('#builderCopy').click(); await waitFor(() => copied.length > 0);
    assert.equal(copied, $('#builderOutput').textContent);
    $('#builderTask').dispatchEvent(new w.Event('input',{bubbles:true}));
    assert.equal($('#builderCopy').disabled, true);
    w.dispatchEvent(new w.CustomEvent('studio:catalog', {detail:null}));
    await waitFor(() => !$('[data-view=paywall]').hidden);
    assert.equal($('#builderTask').value, '');
    assert.equal($('#builderContext').value, '');
    assert.doesNotMatch($('#builderOutput').textContent, /مخاطب/);
  } finally { dom.window.close(); }
});

test('app-owned screens and sharing metadata omit source names while tool IDs remain copyable', async () => {
  const dom = page(), w = dom.window, $ = s => w.document.querySelector(s);
  let copied = '';
  Object.defineProperty(w.navigator, 'clipboard', {value:{writeText:async text => {copied = text;}}});
  w.fetch = async url => ({ok:true, json:async () => url.endsWith('playbooks.json') ? playbooks : data});
  w.eval(app);
  const names = /\bECC\b|Free Claude Code|Affaan Mustafa|Ali Khokhar|DAIR\.AI|Prompt Engineering Guide/i;
  try {
    await waitFor(() => $('#popularCards').children.length === 4);
    w.dispatchEvent(new w.CustomEvent('studio:catalog', {detail:{catalog:fullData,playbooks:fullPlaybooks}}));
    await waitFor(() => $('#popularCards').children.length === 4 && $('#libraryPaywall').hidden);
    for (const path of ['/', '/workspace', '/fcc', '/plans', '/admin', '/install', '/builder', ...fullPlaybooks.services.map(s=>`/s/${s.id}`)]) {
      w.location.hash = `#${path}`;
      await delay(20);
      const view = [...w.document.querySelectorAll('.view')].find(el=>!el.hidden);
      assert.ok(view, path);
      assert.doesNotMatch(view.textContent, names, path);
    }
    w.location.hash = '#/library'; await waitFor(() => !$('[data-view=library]').hidden);
    for (const tab of w.document.querySelectorAll('.tab[data-lib]')) {
      tab.click(); while (!$('#libMore').hidden) $('#libMore').click();
      assert.doesNotMatch($('[data-view=library]').textContent, names, tab.dataset.lib);
    }
    w.location.hash = '#/s/harness'; await waitFor(() => $('#pbTitle').textContent === fullPlaybooks.services.find(s => s.id === 'harness').title);
    const original = $('#pbToolbox [data-copy-text="configure-ecc"]');
    assert.ok(original); assert.doesNotMatch(original.textContent, names); original.click();
    await waitFor(() => copied === 'configure-ecc');
    assert.doesNotMatch(html, /SUPABASE · فضای خصوصی/);
    assert.doesNotMatch(w.document.querySelector('meta[name=description]').content, names);
    assert.doesNotMatch(w.document.querySelector('meta[property="og:title"]').content, names);
    const og = await readFile(new URL('assets/og.svg', site), 'utf8'); assert.doesNotMatch(og, names);
  } finally {dom.window.close();}
});

test('home links to a separate subscription form and sign-in is explicit', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s);
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:null}})},rpc:async()=>({data:[]}),from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client; w.fetch=async url=>({ok:true,json:async()=>url.endsWith('playbooks.json')?playbooks:data});
  w.eval(app); w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>!$('[data-view=home]').hidden); assert.equal($('#loginGate').hidden,true);
    assert.match($('.home-subscription').textContent,/۹۹۰٬۰۰۰/);
    assert.ok($('[data-view=home] #purchaseForm')); assert.equal($('#purchaseFields').disabled,true);
    assert.equal($('.home-subscription a').getAttribute('href'),'#/subscribe');
    w.location.hash='#/subscribe'; await waitFor(()=>!$('[data-view=subscribe]').hidden);
    assert.ok($('[data-view=subscribe] #purchaseForm')); assert.equal($('[data-view=plans] #purchaseForm'),null);
    $('#purchaseOpenLogin').click(); assert.equal($('#loginGate').hidden,false); assert.match($('#signUp').textContent,/رایگان/);
  } finally {dom.window.close();}
});

test('invalid receipt and upload failures do not submit a purchase', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s), calls=[];
  const session={user:{id:'member-1',email:'member@example.test'}};
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session}})},rpc:async(name,args)=>{calls.push({name,args}); if(name==='studio_my_account') return {data:[{is_admin:false,plan:'free'}]}; if(name==='studio_prepare_receipt') return {data:'member-1/receipt',error:null}; return {data:[]};},storage:{from:()=>({remove:async()=>({error:null}),upload:async()=>({error:{message:'network'}})})},from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client;
  w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>!$('#purchaseFields').disabled); $('#purchaseForm').reportValidity=()=>true;
    $('#purchaseReference').value='ref123'; $('#purchasePayerEmail').value='payer@example.test'; $('#purchaseDate').value='2024-01-02'; $('#purchaseTime').value='09:15';
    let file=new w.File(['bad'],'bad.txt',{type:'text/plain'}); Object.defineProperty($('#purchaseReceipt'),'files',{get:()=>[file]});
    $('#purchaseForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); assert.match($('#purchaseStatus').textContent,/JPG/);
    assert.equal(calls.some(c=>c.name==='studio_prepare_receipt'),false);
    file=new w.File(['img'],'receipt.png',{type:'image/png'});
    $('#purchaseForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>$('#purchaseStatus').textContent.includes('بارگذاری فیش ممکن نشد'));
    assert.equal(calls.some(c=>c.name==='studio_submit_purchase_with_receipt'),false);
  } finally {dom.window.close();}
});

test('manager requests a short-lived private receipt link', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s), calls=[];
  const session={user:{id:'admin-1',email:'admin@example.test'}};
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session}})},
    rpc:async(name,args)=>{calls.push({name,args}); if(name==='studio_my_account') return {data:[{is_admin:true,plan:'free'}]}; if(name==='studio_premium_catalog') return {data:[{catalog:data,playbooks}]}; if(name==='studio_admin_purchases_v3') return {data:[{id:3,email:'member@example.test',payment_reference:'ref',amount_toman:990000,status:'pending'}]}; if(name==='studio_admin_receipt') return {data:'member-1/receipt'}; return {data:[]};},
    storage:{from:bucket=>({createSignedUrl:async(path,ttl)=>{calls.push({bucket,path,ttl});return {data:{signedUrl:'https://example.test/private'},error:null};}})},
    from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client;
  w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>$('#adminPurchases .receipt-action')); $('#adminPurchases .receipt-action').click();
    await waitFor(()=>$('#adminPurchases a[href="https://example.test/private"]'));
    assert.equal(calls.find(c=>c.name==='studio_admin_receipt').args.request_id,3); assert.equal(calls.find(c=>c.ttl).ttl,60);
  } finally {dom.window.close();}
});

test('uploaded brand is used in the interface, browser icon and install manifest', async () => {
  const dom = page(), document = dom.window.document;
  try {
    assert.equal(document.querySelector('.login-brand-icon').getAttribute('src'), 'assets/brand-icon-192.png');
    assert.equal(document.querySelector('.studio-logo img').getAttribute('src'), 'assets/brand-icon-192.png');
    assert.equal(document.querySelector('.neural-brand img').getAttribute('src'), 'assets/brand-icon-192.png');
    assert.equal(document.querySelector('.dashboard-brand-visual img').getAttribute('src'), 'assets/brand-logo.jpg');
    assert.equal(document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href'), 'assets/brand-icon-180.png');
    assert.equal(document.querySelector('meta[property="og:image"]').content, 'assets/brand-logo.jpg');
    const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', site), 'utf8'));
    for (const size of [192,512]) {
      const icon = manifest.icons.find(i => i.sizes === `${size}x${size}` && i.purpose === 'any');
      assert.ok(icon);
      const png = await readFile(new URL(icon.src, site));
      assert.equal(png.readUInt32BE(16),size); assert.equal(png.readUInt32BE(20),size);
    }
    const mask = manifest.icons.find(i => i.purpose === 'maskable'); assert.equal(mask.sizes,'512x512');
    const sw = await readFile(new URL('sw.js', site), 'utf8');
    for (const path of [...manifest.icons.map(i=>i.src), 'assets/brand-icon-48.png', 'assets/brand-icon-180.png', 'assets/brand-logo.jpg']) assert.ok(sw.includes(`'./${path}'`), path);
  } finally {dom.window.close();}
});

test('failed sign-in keeps the dialog open and password toggle is accessible', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s), calls=[];
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:null}}),signInWithPassword:async args=>{calls.push(args);return {error:{message:'Invalid login credentials'}};}},rpc:async()=>({data:[]}),from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client; w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await delay(20); assert.equal($('#loginGate').hidden,true); $('#headerLogin').click();
    $('#togglePassword').click(); assert.equal($('#authPassword').type,'text'); assert.equal($('#togglePassword').getAttribute('aria-pressed'),'true');
    $('#authEmail').value='person@example.test'; $('#authPassword').value='password'; $('#authForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>$('#authStatus').textContent.includes('درست نیست')); assert.equal($('#loginGate').hidden,false); assert.equal(calls.length,1);
    $('#guestAccess').click(); assert.equal($('#authPassword').value,''); assert.equal($('#authPassword').type,'password');
  } finally {dom.window.close();}
});

test('recovery uses the backend, generic messaging and a validated password update', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s), calls=[]; let callback;
  const session={user:{id:'user-1',email:'person@example.test'}};
  const client={auth:{onAuthStateChange:fn=>{callback=fn;},getSession:async()=>({data:{session:null}}),resetPasswordForEmail:async(email,opts)=>{calls.push({email,opts});return {error:null};},updateUser:async args=>{calls.push(args);return {error:null};}},rpc:async name=>name==='studio_my_account'?{data:[{is_admin:false,plan:'free'}]}:{data:[]},from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client; w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await delay(20); $('#headerLogin').click(); $('#forgotPassword').click(); assert.equal($('#authForgotPanel').hidden,false);
    $('#recoveryEmail').value='person@example.test'; $('#forgotForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>$('#authStatus').textContent.includes('اگر حسابی')); assert.equal(calls[0].email,'person@example.test');
    callback('PASSWORD_RECOVERY',session); assert.equal($('#loginGate').hidden,false); assert.equal($('#authResetPanel').hidden,false);
    $('#newPassword').value='abcdef'; $('#confirmPassword').value='different'; $('#resetForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    assert.match($('#authStatus').textContent,/یکسان نیستند/); assert.equal(calls.length,1);
    $('#confirmPassword').value='abcdef'; $('#resetForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>$('#loginGate').hidden); assert.equal(calls[1].password,'abcdef'); assert.match($('#sessionNotice').textContent,/موفقیت/);
  } finally {dom.window.close();}
});

test('late initial session cannot replace a newer auth event', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s); let callback, finish;
  const client={auth:{onAuthStateChange:fn=>{callback=fn;},getSession:()=>new Promise(resolve=>{finish=resolve;})},rpc:async name=>name==='studio_my_account'?{data:[{is_admin:false,plan:'free'}]}:{data:[]},from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client; w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    callback('SIGNED_IN',{user:{id:'user-1',email:'person@example.test'}}); finish({data:{session:null}}); await delay(30);
    assert.equal($('#headerAccount').hidden,false); assert.equal($('#headerLogin').hidden,true);
    callback('SIGNED_OUT',null); assert.equal($('#loginGate').hidden,true); assert.match($('#sessionNotice').textContent,/پایان/);
  } finally {dom.window.close();}
});

test('Google sign-in reports an unconfigured provider without creating a session', async () => {
  const dom = page(), w = dom.window, $ = s => w.document.querySelector(s); let calls = 0;
  const client = {auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:null}}),signInWithOAuth:async()=>{calls++;return {error:null};}},rpc:async()=>({data:[]}),from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.fetch = async () => ({ok:true,json:async()=>({external:{google:false}})}); w.__client = client;
  w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    $('#headerLogin').click(); $('#googleSignIn').click();
    await waitFor(()=>$('#authStatus').textContent.includes('هنوز فعال نشده'));
    assert.equal(calls,0); assert.equal($('#loginGate').hidden,false); assert.equal($('#googleSignIn').disabled,false);
    assert.equal(w.sessionStorage.getItem('studio-google-return'),null);
  } finally {dom.window.close();}
});

test('Google sign-in uses the real OAuth flow and returns to the subscription form after authentication', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s); const calls=[]; let onAuth;
  const session={user:{id:'google-user',email:'google@example.test'}};
  const client={auth:{onAuthStateChange:fn=>{onAuth=fn;},getSession:async()=>({data:{session:null}}),signInWithOAuth:async args=>{calls.push(args);return {data:{url:'https://accounts.google.com/'},error:null};}},rpc:async(name)=>({data:name==='studio_my_account'?[{is_admin:false,plan:'free',expires_at:null}]:[]}),from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.fetch=async()=>({ok:true,json:async()=>({external:{google:true}})});w.__client=client;w.location.hash='#/subscribe';
  w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    $('#purchaseOpenLogin').click(); $('#rememberMe').checked=true; $('#googleSignIn').click();
    await waitFor(()=>calls.length===1);
    assert.equal(calls[0].provider,'google'); assert.equal(calls[0].options.redirectTo,'http://127.0.0.1:4173/');
    assert.equal(w.localStorage.getItem('studio-remember-session'),'1'); assert.equal(w.sessionStorage.getItem('studio-google-return'),'#/subscribe');
    assert.equal($('#purchaseFields').disabled,true);
    w.location.hash='#access_token=example'; onAuth('SIGNED_IN',session);
    assert.equal(w.location.hash,'#/subscribe'); assert.equal(w.sessionStorage.getItem('studio-google-return'),null);
    assert.equal($('#purchaseFields').disabled,false); await waitFor(()=>$('#accountPlan').textContent==='رایگان');
  } finally {dom.window.close();}
});

test('Google callback failure is shown without reporting a successful sign-in', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s);
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:null}})},rpc:async()=>({data:[]}),from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.sessionStorage.setItem('studio-google-return','#/subscribe'); w.location.hash='#error=access_denied&error_description=cancelled'; w.__client=client;
  w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try { assert.equal($('#loginGate').hidden,false); assert.match($('#authStatus').textContent,/تکمیل نشد/); assert.equal(w.sessionStorage.getItem('studio-google-return'),null); assert.equal($('#purchaseFields').disabled,true); await delay(30); }
  finally {dom.window.close();}
});

test('each existing subject has an icon and library filters follow the selected topic', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s);
  w.fetch=async url=>({ok:true,json:async()=>url.endsWith('playbooks.json')?playbooks:data}); w.eval(app);
  try {
    await waitFor(()=>$('#homeTopics').children.length===playbooks.services.length);
    for (const subject of playbooks.services) {
      const link=$(`#homeTopics a[href="#/s/${subject.id}"]`);
      assert.ok(link && link.querySelector('svg'),subject.id);
      assert.ok($(`#libraryTopics [data-library-topic="${subject.id}"] svg`),subject.id);
    }
    w.location.hash='#/library'; await waitFor(()=>!$('[data-view=library]').hidden);
    const topic=$('#libraryTopics [data-library-topic="website"]'); topic.click();
    assert.equal(topic.getAttribute('aria-pressed'),'true'); assert.equal($('#libCategory').value,'website');
    const shown=[...$('#libList').querySelectorAll('[data-copy-text]')].map(x=>x.dataset.copyText).sort();
    assert.deepEqual(shown,playbooks.services.find(s=>s.id==='website').skills.slice().sort());
    $('[data-lib="commands"]').click();
    assert.deepEqual([...$('#libList').querySelectorAll('[data-copy-text]')].map(x=>x.dataset.copyText).sort(),playbooks.services.find(s=>s.id==='website').commands.map(x=>'/'+x).sort());
    $('#libCategory').value='other'; $('#libCategory').dispatchEvent(new w.Event('change'));
    assert.equal($('#libraryTopics [data-library-topic="other"]').getAttribute('aria-pressed'),'true');
    $('#libraryTopics [data-library-topic="all"]').click(); assert.equal($('#libCategory').value,'all');
    w.location.hash='#/s/security'; await waitFor(()=>$('#pbTitle').textContent===playbooks.services.find(s=>s.id==='security').title);
    assert.ok($('#pbIcon svg')); assert.ok($('#pbRelated svg'));
  } finally {dom.window.close();}
});

test('account creation remains an explicit action using the existing signup method', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s), calls=[];
  w.__client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:null}}),signUp:async args=>{calls.push(args);return {data:{session:null},error:null};}},rpc:async()=>({data:[]}),from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    $('#headerLogin').click(); assert.equal($('#signUp').type,'button'); assert.ok($('#signUp').classList.contains('neural-signup'));
    $('#authEmail').value='person@example.test'; $('#authPassword').value='test-password'; $('#signUp').click();
    await waitFor(()=>calls.length===1 && $('#authStatus').textContent.includes('ایمیل خود را بررسی کنید'));
    assert.equal(calls[0].email,'person@example.test'); assert.equal(calls[0].options.emailRedirectTo,'http://127.0.0.1:4173/');
    assert.equal($('#loginGate').hidden,false); assert.equal($('#purchaseFields').disabled,true); assert.equal($('#authPassword').value,'');
  } finally {dom.window.close();}
});

test('subject filters keep their selection when access changes and never retain premium items after sign-out', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s);
  w.fetch=async url=>({ok:true,json:async()=>url.endsWith('playbooks.json')?playbooks:data});w.eval(app);
  try {
    await waitFor(()=>$('#libraryTopics [data-library-topic="website"]'));
    w.location.hash='#/library'; await waitFor(()=>!$('[data-view=library]').hidden);
    $('#libraryTopics [data-library-topic="website"]').click();
    w.dispatchEvent(new w.CustomEvent('studio:catalog',{detail:{catalog:fullData,playbooks:fullPlaybooks}}));
    await waitFor(()=>$('#libraryPaywall').hidden);
    assert.equal($('#libCategory').value,'website'); assert.equal($('#libraryTopics [data-library-topic="website"]').getAttribute('aria-pressed'),'true');
    assert.deepEqual([...$('#libList').querySelectorAll('[data-copy-text]')].map(x=>x.dataset.copyText).sort(),fullPlaybooks.services.find(s=>s.id==='website').skills.slice().sort());
    w.dispatchEvent(new w.CustomEvent('studio:catalog',{detail:null}));
    await waitFor(()=>!$('#libraryPaywall').hidden);
    assert.equal($('#libCategory').value,'website');
    assert.deepEqual([...$('#libList').querySelectorAll('[data-copy-text]')].map(x=>x.dataset.copyText).sort(),playbooks.services.find(s=>s.id==='website').skills.slice().sort());
  } finally {dom.window.close();}
});

test('project starter suggests a path, library searches Persian and favorites stay local', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s);
  w.fetch=async url=>({ok:true,json:async()=>url.endsWith('playbooks.json')?playbooks:data});
  w.eval(app);
  try {
    w.location.hash='#/projects'; await waitFor(()=>!$('[data-view=projects]').hidden && $('#projectType').options.length);
    $('#projectType').value='website'; $('#projectType').dispatchEvent(new w.Event('change'));
    assert.match($('#projectSuggestion').textContent,/پیش‌نیازها/); assert.match($('#projectSuggestion').textContent,/نقشه راه/);
    w.location.hash='#/library'; await waitFor(()=>!$('[data-view=library]').hidden);
    $('#libSearch').value='دسترسی'; $('#libSearch').dispatchEvent(new w.Event('input'));
    assert.match($('#libList').textContent,/accessibility/);
    $('#libList [data-favorite="accessibility"]').click();
    assert.match(w.localStorage.getItem('studio-library-favorites-v1'),/skills:accessibility/);
    $('#libSearch').value=''; $('#libSearch').dispatchEvent(new w.Event('input'));
    $('#libFavorites').checked=true; $('#libFavorites').dispatchEvent(new w.Event('change'));
    assert.equal($('#libList').querySelectorAll('li').length,1);
    $('#libLevel').value='advanced'; $('#libLevel').dispatchEvent(new w.Event('change'));
    assert.equal($('#libList').querySelectorAll('li').length,0);
  } finally {dom.window.close();}
});

test('projects create and update a cloud checklist with optimistic versioning', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s), records=[];
  const session={user:{id:'member-1',email:'member@example.test'}};
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session}})},
    rpc:async name=>name==='studio_my_account'?{data:[{is_admin:false,plan:'free'}]}:{data:[]},
    from:table=>{
      if(table!=='studio_projects') return {select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})};
      return {
        select:()=>({order:()=>({limit:async()=>({data:structuredClone(records),error:null})})}),
        insert:async row=>{records.push({...row,id:'project-1',version:1});return {error:null};},
        update:patch=>{let id,version; const chain={eq:(k,v)=>{if(k==='id') id=v; else version=v;return chain;},select:()=>({maybeSingle:async()=>{const r=records.find(r=>r.id===id && r.version===version);if(!r)return {data:null,error:null};Object.assign(r,patch);return {data:{version:r.version},error:null};}})};return chain;},
        delete:()=>({eq:async()=>({error:null})})
      };
    }};
  w.__client=client; w.fetch=async url=>({ok:true,json:async()=>url.endsWith('playbooks.json')?playbooks:data});
  w.eval(app); w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    w.location.hash='#/projects'; await waitFor(()=>!$('#projectCreate').disabled && $('#projectType').options.length);
    $('#projectTitle').value='آزمون'; $('#projectDescription').value='نیاز من';
    $('input[value=accounts]').click(); assert.match($('#projectSuggestion').textContent,/امنیت حساب‌ها/);
    $('#projectForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
    await waitFor(()=>$('#projectList input[type=checkbox]'));
    assert.equal(records[0].description,'نیاز من'); assert.ok(records[0].checklist.some(step=>step.text.includes('امنیت حساب‌ها')));
    $('#projectList input').click(); await waitFor(()=>records[0].version===2);
    assert.equal(records[0].checklist[0].done,true); await waitFor(()=>$('#projectStatus').textContent==='پیشرفت ذخیره شد.');
    $('#projectList details input').value='نام تازه'; $('#projectList details textarea').value='توضیح تازه'; $('#projectList details form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
    await waitFor(()=>records[0].version===3 && $('#projectList h3').textContent==='نام تازه'); assert.equal(records[0].description,'توضیح تازه');
    $('#projectList .project-add-step input').value='تهیه نسخه پشتیبان'; $('#projectList .project-add-step').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
    await waitFor(()=>records[0].version===4 && $('#projectList').textContent.includes('تهیه نسخه پشتیبان'));
    await waitFor(()=>$('#projectStatus').textContent==='مرحله افزوده شد.');
    records[0].version=5; records[0].description='تغییر از دستگاه دیگر';
    $('#projectList input[type=checkbox]').click();
    await waitFor(()=>$('#projectStatus').textContent.includes('دستگاه دیگری'));
    assert.equal(records[0].version,5); assert.match($('#projectList').textContent,/تغییر از دستگاه دیگر/); await delay(50);
  } finally {dom.window.close();}
});

test('admin rejection requires a reason and customer sees that reason', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s); const calls=[];
  const session={user:{id:'admin-1',email:'admin@example.test'}};
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session}})},
    rpc:async(name,args)=>{calls.push({name,args});
      if(name==='studio_my_account') return {data:[{is_admin:true,plan:'free'}]};
      if(name==='studio_premium_catalog') return {data:[{catalog:data,playbooks}]};
      if(name==='studio_admin_purchases_v3') return {data:[{id:4,status:'pending',email:'member@example.test',payment_reference:'test'}]};
      if(name==='studio_my_purchases_v2') return {data:[{id:5,status:'rejected',payment_reference:'old',rejection_reason:'فیش ناخوانا است'}]};
      return {data:[],error:null};},
    from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.confirm=()=>true; w.__client=client;
  w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>$('#adminPurchases [aria-label="دلیل رد درخواست"]'));
    assert.match($('#purchaseHistory').textContent,/فیش ناخوانا است/);
    const reject=[...w.document.querySelectorAll('#adminPurchases button')].find(b=>b.textContent==='رد درخواست'); reject.click();
    assert.equal(calls.filter(c=>c.name==='studio_review_purchase_v2').length,0);
    $('#adminPurchases [aria-label="دلیل رد درخواست"]').value='فیش خوانا نیست';
    $('#adminPurchases [aria-label="یادداشت داخلی بررسی"]').value='یادداشت خصوصی'; reject.click();
    await waitFor(()=>calls.some(c=>c.name==='studio_review_purchase_v2'));
    const call=calls.find(c=>c.name==='studio_review_purchase_v2');
    assert.equal(call.args.decision,'rejected'); assert.equal(call.args.reason,'فیش خوانا نیست'); assert.equal(call.args.note,'یادداشت خصوصی');
    await delay(50);
  } finally {dom.window.close();}
});


test('all free sample library items have a reviewed Persian description and level', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s);
  w.fetch=async url=>({ok:true,json:async()=>url.endsWith('playbooks.json')?playbooks:data}); w.eval(app);
  try {
    w.location.hash='#/library'; await waitFor(()=>!$('[data-view=library]').hidden && $('#libList li'));
    assert.equal($('#libLevel').closest('[data-view]').dataset.view,'library'); assert.equal($('#libFavorites').closest('[data-view]').dataset.view,'library');
    for (const tab of w.document.querySelectorAll('[data-lib]')) {
      tab.click(); assert.equal(w.document.querySelectorAll('#libList li').length, data[tab.dataset.lib].length);
      assert.doesNotMatch($('#libList').textContent,/هنوز به فارسی بررسی نشده|ارزیابی‌نشده/);
    }
  } finally { dom.window.close(); }
});

test('manager can page through requests and change the status filter', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s), calls=[];
  const session={user:{id:'admin-1',email:'admin@example.test'}};
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session}})},
    rpc:async(name,args)=>{calls.push({name,args});
      if(name==='studio_my_account') return {data:[{is_admin:true,plan:'free'}]};
      if(name==='studio_premium_catalog') return {data:[{catalog:data,playbooks}]};
      if(name==='studio_admin_purchases_v3') return {data:args.page_offset===0 && args.filter_status==='pending' ? Array.from({length:50},(_,i)=>({id:i,status:'pending',payment_reference:'test'})) : args.page_offset===50 ? [{id:51,status:'pending',payment_reference:'last'}] : []};
      return {data:[],error:null};},
    from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client; w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>!$('#adminPurchasesNext').disabled);
    assert.equal($('#adminPurchasesPrev').disabled,true); $('#adminPurchasesNext').click();
    await waitFor(()=>$('#adminPurchases').textContent.includes('last'));
    assert.equal($('#adminPurchasesNext').disabled,true); assert.equal($('#adminPurchasesPrev').disabled,false);
    $('#adminPurchaseFilter').value='rejected'; $('#adminPurchaseFilter').dispatchEvent(new w.Event('change'));
    await waitFor(()=>calls.some(c=>c.name==='studio_admin_purchases_v3' && c.args.filter_status==='rejected'));
    assert.equal(calls.filter(c=>c.name==='studio_admin_purchases_v3').at(-1).args.page_offset,0);
    await waitFor(()=>$('#adminPurchaseStatus').textContent.includes('درخواستی در این صفحه'));
  } finally {dom.window.close();}
});
