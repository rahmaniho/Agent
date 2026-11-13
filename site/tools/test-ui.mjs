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
fullData.skills.push({name:'synthetic-premium-tool',desc:'Synthetic test-only tool.',description_fa:'ابزار آزمایشی داده',level:'beginner'},{name:'configure-ecc',desc:'Synthetic test-only identifier.'});
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
    $('#projectList .project-editor input').value='نام تازه'; $('#projectList .project-editor textarea').value='توضیح تازه'; $('#projectList .project-editor form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
    await waitFor(()=>records[0].version===3 && $('#projectList h3').textContent==='نام تازه'); assert.equal(records[0].description,'توضیح تازه');
    $('#projectList .project-add-step input').value='تهیه نسخه پشتیبان'; $('#projectList .project-add-step').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
    await waitFor(()=>records[0].version===4 && $('#projectList').textContent.includes('تهیه نسخه پشتیبان'));
    await waitFor(()=>$('#projectStatus').textContent==='مرحله افزوده شد.');
    records[0].version=5; records[0].description='تغییر از دستگاه دیگر';
    $('#projectList input[type=checkbox]').click();
    await waitFor(()=>$('#projectStatus').textContent.includes('دستگاه دیگری'));
    assert.equal(records[0].version,5); assert.ok($('#projectList .project-conflict')); $('#projectRefresh').click();
    await waitFor(()=>$('#projectList').textContent.includes('تغییر از دستگاه دیگر')); await delay(50);
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


test('premium Persian metadata supports searching and level filtering without persisting', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s);
  w.fetch=async url=>({ok:true,json:async()=>url.endsWith('playbooks.json')?playbooks:data});w.eval(app);
  try {
    w.location.hash='#/library'; await waitFor(()=>!$('[data-view=library]').hidden && $('#libList li'));
    w.dispatchEvent(new w.CustomEvent('studio:catalog',{detail:{catalog:fullData,playbooks:fullPlaybooks}}));
    await waitFor(()=>$('#libraryPaywall').hidden);
    $('#libSearch').value='ابزار آزمایشی داده'; $('#libSearch').dispatchEvent(new w.Event('input'));
    assert.match($('#libList').textContent,/synthetic-premium-tool/);
    $('#libLevel').value='beginner'; $('#libLevel').dispatchEvent(new w.Event('change')); assert.match($('#libList').textContent,/ابزار آزمایشی داده/);
    $('#libLevel').value='advanced'; $('#libLevel').dispatchEvent(new w.Event('change')); assert.equal($('#libList').children.length,0);
    w.dispatchEvent(new w.CustomEvent('studio:catalog',{detail:null})); await waitFor(()=>!$('#libraryPaywall').hidden);
    assert.doesNotMatch($('#libList').textContent,/synthetic-premium-tool|ابزار آزمایشی داده/);
    assert.doesNotMatch(JSON.stringify(w.localStorage),/synthetic-premium-tool/);
  } finally {dom.window.close();}
});

test('restore SQL is private, validates input and rolls back by default', async () => {
  const {mkdtemp,writeFile,readFile,stat,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os'); const {join}=await import('node:path');
  const {spawnSync}=await import('node:child_process');
  const dir=await mkdtemp(join(tmpdir(),'studio-restore-test-'));
  try {
    const input=join(dir,'backup.json'), output=join(dir,'restore.sql');
    await writeFile(input,JSON.stringify({format:'agent-studio-catalog-v1',catalog:data,playbooks,postgres_jsonb_md5:{catalog:'0'.repeat(32),playbooks:'1'.repeat(32)}}));
    const script=new URL('tools/prepare-catalog-restore.mjs',site).pathname;
    let result=spawnSync(process.execPath,[script,'--input',input,'--out',output],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.match(await readFile(output,'utf8'),/rollback;\s*$/); assert.equal((await stat(output)).mode & 0o777,0o600);
    result=spawnSync(process.execPath,[script,'--input',input,'--out',output],{encoding:'utf8'}); assert.notEqual(result.status,0);
    result=spawnSync(process.execPath,[script,'--input',input,'--out',new URL('assets/restore.sql',site).pathname],{encoding:'utf8'}); assert.notEqual(result.status,0);
    await writeFile(input,JSON.stringify({format:'invalid'}));
    result=spawnSync(process.execPath,[script,'--input',input,'--out',join(dir,'bad.sql')],{encoding:'utf8'}); assert.notEqual(result.status,0);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('premium descriptions are rendered as text, not HTML', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s);
  const unsafe=structuredClone(fullData); unsafe.skills.at(-2).description_fa='<img src=x onerror=alert(1)> متن';
  w.fetch=async url=>({ok:true,json:async()=>url.endsWith('playbooks.json')?playbooks:data});w.eval(app);
  try {
    w.location.hash='#/library'; await waitFor(()=>!$('[data-view=library]').hidden && $('#libList li'));
    w.dispatchEvent(new w.CustomEvent('studio:catalog',{detail:{catalog:unsafe,playbooks:fullPlaybooks}})); await waitFor(()=>$('#libraryPaywall').hidden);
    $('#libSearch').value='synthetic-premium-tool';$('#libSearch').dispatchEvent(new w.Event('input'));
    assert.equal($('#libList').querySelector('img'),null); assert.match($('#libList').textContent,/<img src=x onerror=alert\(1\)>/);
  } finally {dom.window.close();}
});

test('catalog export validates output, avoids public paths and does not overwrite backups', async () => {
  const {mkdtemp,writeFile,readFile,stat,chmod,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os'); const {join,delimiter}=await import('node:path');
  const {spawnSync}=await import('node:child_process');
  const dir=await mkdtemp(join(tmpdir(),'studio-export-test-'));
  try {
    const fake=join(dir,'psql'), backup=join(dir,'backup.json');
    const content={format:'agent-studio-catalog-v1',catalog:data,playbooks,postgres_jsonb_md5:{catalog:'0'.repeat(32),playbooks:'1'.repeat(32)}};
    await writeFile(fake,`#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(content))})\n`); await chmod(fake,0o700);
    const script=new URL('tools/export-catalog-backup.mjs',site).pathname;
    const env={...process.env,PATH:`${dir}${delimiter}${process.env.PATH}`};
    let result=spawnSync(process.execPath,[script,'--out',backup],{encoding:'utf8',env});
    assert.equal(result.status,0,result.stderr); assert.equal((await stat(backup)).mode & 0o777,0o600); assert.equal(JSON.parse(await readFile(backup,'utf8')).format,'agent-studio-catalog-v1');
    const restore=join(dir,'restore-from-export.sql');
    result=spawnSync(process.execPath,[new URL('tools/prepare-catalog-restore.mjs',site).pathname,'--input',backup,'--out',restore],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr); assert.match(await readFile(restore,'utf8'),/rollback;\s*$/);
    result=spawnSync(process.execPath,[script,'--out',backup],{encoding:'utf8',env}); assert.notEqual(result.status,0);
    result=spawnSync(process.execPath,[script,'--out',new URL('assets/secret.json',site).pathname],{encoding:'utf8',env}); assert.notEqual(result.status,0);
    await writeFile(fake,'#!/usr/bin/env node\nprocess.stdout.write("invalid")\n');
    result=spawnSync(process.execPath,[script,'--out',join(dir,'invalid.json')],{encoding:'utf8',env}); assert.notEqual(result.status,0);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('catalog editor saves through admin RPC, handles conflicts and clears on sign-out', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s), calls=[];
  const session={user:{id:'admin-1',email:'admin@example.test'}}; let auth, conflict=false;
  const current=structuredClone(fullData);
  const client={auth:{onAuthStateChange:fn=>{auth=fn;},getSession:async()=>({data:{session}})},
    rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==='studio_my_account') return {data:[{is_admin:true,plan:'free'}]};
      if(name==='studio_premium_catalog') return {data:[{catalog:structuredClone(current),playbooks:fullPlaybooks}]};
      if(name==='studio_admin_update_catalog_review') {
        if(conflict) { current.skills.find(x=>x.name===args.item_name).description_fa='تغییر دستگاه دیگر'; return {error:{code:'40001'}}; }
        Object.assign(current[args.kind].find(x=>x.name===args.item_name),{description_fa:args.description,level:args.level}); return {error:null};
      }
      return {data:[],error:null};},
    from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client; w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>!$('#adminContent').hidden && $('#catalogReviewItem option[value="synthetic-premium-tool"]'));
    $('#catalogReviewItem').value='synthetic-premium-tool'; $('#catalogReviewItem').dispatchEvent(new w.Event('change'));
    assert.equal($('#catalogReviewDescription').value,'ابزار آزمایشی داده');
    $('#catalogReviewDescription').value='توضیح تازه'; $('#catalogReviewLevel').value='advanced';
    $('#catalogReviewForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
    await waitFor(()=>$('#catalogReviewStatus').textContent.includes('ذخیره شد'));
    const call=calls.find(c=>c.name==='studio_admin_update_catalog_review');
    assert.equal(call.args.item_name,'synthetic-premium-tool'); assert.equal(call.args.previous_description,'ابزار آزمایشی داده'); assert.equal(call.args.previous_level,'beginner');
    assert.equal(w.studioCatalog.catalog.skills.find(x=>x.name==='synthetic-premium-tool').description_fa,'توضیح تازه');
    conflict=true; $('#catalogReviewDescription').value='نباید ذخیره شود'; $('#catalogReviewForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
    await waitFor(()=>$('#catalogReviewStatus').textContent.includes('هم‌زمان تغییر'));
    assert.equal($('#catalogReviewDescription').value,'نباید ذخیره شود');
    assert.equal($('#catalogReviewConflict').hidden,false); assert.match($('#catalogReviewLatest').textContent,/تغییر دستگاه دیگر/); assert.equal($('#catalogReviewSave').disabled,true);
    $('#catalogReviewRebase').click(); assert.equal($('#catalogReviewConflict').hidden,true); assert.equal($('#catalogReviewDescription').value,'نباید ذخیره شود'); assert.equal($('#catalogReviewSave').disabled,false);
    auth('SIGNED_OUT',null); assert.equal($('#catalogReviewDescription').value,''); assert.equal($('#catalogReviewItem').children.length,0); assert.equal($('#catalogReviewSave').disabled,true);
    await delay(50);
  } finally {dom.window.close();}
});

test('pending catalog edits are locked, errors are visible, and late results cannot leak across accounts', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s); let auth, resolveSave, saves=0;
  const session={user:{id:'admin-1',email:'admin@example.test'}};
  const client={auth:{onAuthStateChange:fn=>{auth=fn;},getSession:async()=>({data:{session}})},
    rpc:async(name)=>{
      if(name==='studio_my_account') return {data:[{is_admin:true,plan:'free'}]};
      if(name==='studio_premium_catalog') return {data:[{catalog:structuredClone(fullData),playbooks:fullPlaybooks}]};
      if(name==='studio_admin_update_catalog_review') { saves++; return new Promise(resolve=>{resolveSave=resolve;}); }
      return {data:[],error:null};},
    from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client; w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>!$('#adminContent').hidden && $('#catalogReviewItem option[value="synthetic-premium-tool"]'));
    $('#catalogReviewItem').value='synthetic-premium-tool'; $('#catalogReviewItem').dispatchEvent(new w.Event('change'));
    $('#catalogReviewForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
    assert.equal($('#catalogReviewItem').disabled,true); assert.equal($('#catalogReviewDescription').disabled,true);
    $('#catalogReviewForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true})); assert.equal(saves,1);
    resolveSave({error:{message:'network error'}}); await waitFor(()=>!$('#catalogReviewSave').disabled); assert.ok($('#catalogReviewStatus').textContent);
    $('#catalogReviewForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true})); assert.equal(saves,2);
    auth('SIGNED_OUT',null); assert.equal($('#adminContent').hidden,true); resolveSave({error:null}); await delay(50);
    assert.equal(w.studioCatalog,null); assert.equal($('#catalogReviewDescription').value,''); assert.equal($('#catalogReviewSave').disabled,true);
  } finally {dom.window.close();}
});

test('catalog drafts survive filtering and account refresh, and remote changes require an explicit decision', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s), calls=[]; let auth;
  const session={user:{id:'admin-1',email:'admin@example.test'}}; const current=structuredClone(fullData);
  const client={auth:{onAuthStateChange:fn=>{auth=fn;},getSession:async()=>({data:{session}})},
    rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==='studio_my_account') return {data:[{is_admin:true,plan:'free'}]};
      if(name==='studio_premium_catalog') return {data:[{catalog:structuredClone(current),playbooks:fullPlaybooks}]};
      if(name==='studio_admin_update_catalog_review') { Object.assign(current[args.kind].find(x=>x.name===args.item_name),{description_fa:args.description,level:args.level}); return {error:null}; }
      return {data:[],error:null};},
    from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client; w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>!$('#adminContent').hidden && $('#catalogReviewItem option[value="synthetic-premium-tool"]'));
    $('#catalogReviewItem').value='synthetic-premium-tool'; $('#catalogReviewItem').dispatchEvent(new w.Event('change'));
    $('#catalogReviewDescription').value='پیش‌نویس محرمانه'; $('#catalogReviewDescription').dispatchEvent(new w.Event('input'));
    $('#catalogReviewSearch').value='configure-ecc'; $('#catalogReviewSearch').dispatchEvent(new w.Event('input'));
    $('#catalogReviewSearch').value='synthetic-premium-tool'; $('#catalogReviewSearch').dispatchEvent(new w.Event('input'));
    assert.equal($('#catalogReviewDescription').value,'پیش‌نویس محرمانه');
    Object.defineProperty(w.document,'hidden',{value:false,configurable:true});
    w.document.dispatchEvent(new w.Event('visibilitychange'));
    await waitFor(()=>!$('#adminContent').hidden && $('#catalogReviewDescription').value==='پیش‌نویس محرمانه');
    assert.equal($('#catalogReviewConflict').hidden,true);
    $('#catalogReviewMissing').checked=true; $('#catalogReviewMissing').dispatchEvent(new w.Event('change'));
    assert.equal($('#catalogReviewDescription').value,'پیش‌نویس محرمانه');
    current.skills.find(x=>x.name==='synthetic-premium-tool').description_fa='ویرایش دیگر';
    w.document.dispatchEvent(new w.Event('visibilitychange'));
    await waitFor(()=>!$('#adminContent').hidden && !$('#catalogReviewConflict').hidden);
    assert.equal($('#catalogReviewDescription').value,'پیش‌نویس محرمانه'); assert.match($('#catalogReviewLatest').textContent,/ویرایش دیگر/);
    $('#catalogReviewForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true})); assert.equal(calls.filter(x=>x.name==='studio_admin_update_catalog_review').length,0);
    $('#catalogReviewRebase').click(); $('#catalogReviewForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
    await waitFor(()=>$('#catalogReviewStatus').textContent.includes('ذخیره شد'));
    assert.equal(calls.find(x=>x.name==='studio_admin_update_catalog_review').args.previous_description,'ویرایش دیگر');
    $('#catalogReviewMissing').checked=false; $('#catalogReviewMissing').dispatchEvent(new w.Event('change'));
    $('#catalogReviewDescription').value='پیش‌نویس دیگر'; $('#catalogReviewDescription').dispatchEvent(new w.Event('input'));
    current.skills.find(x=>x.name==='synthetic-premium-tool').description_fa='نسخهٔ تازه';
    w.document.dispatchEvent(new w.Event('visibilitychange')); await waitFor(()=>!$('#adminContent').hidden && !$('#catalogReviewConflict').hidden);
    $('#catalogReviewUseLatest').click(); assert.equal($('#catalogReviewDescription').value,'نسخهٔ تازه');
    $('#catalogReviewDescription').value='دادهٔ خصوصی'; $('#catalogReviewDescription').dispatchEvent(new w.Event('input'));
    auth('SIGNED_OUT',null); assert.equal($('#catalogReviewDescription').value,'');
    auth('SIGNED_IN',{user:{id:'admin-2',email:'other@example.test'}});
    await waitFor(()=>!$('#adminContent').hidden && $('#catalogReviewItem option[value="synthetic-premium-tool"]'));
    $('#catalogReviewItem').value='synthetic-premium-tool'; $('#catalogReviewItem').dispatchEvent(new w.Event('change'));
    assert.equal($('#catalogReviewDescription').value,'نسخهٔ تازه'); assert.doesNotMatch(JSON.stringify(w.localStorage),/دادهٔ خصوصی/);
    await delay(50);
  } finally {dom.window.close();}
});

test('a save completing during account refresh reloads the committed catalog', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s); let finishSave, count=0;
  const session={user:{id:'admin-1',email:'admin@example.test'}}; const current=structuredClone(fullData);
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session}})}, rpc:async(name,args)=>{
    if(name==='studio_my_account') return {data:[{is_admin:true,plan:'free'}]};
    if(name==='studio_premium_catalog') {count++; return {data:[{catalog:structuredClone(current),playbooks:fullPlaybooks}]};}
    if(name==='studio_admin_update_catalog_review') return new Promise(resolve=>{finishSave=()=>{Object.assign(current[args.kind].find(x=>x.name===args.item_name),{description_fa:args.description,level:args.level}); resolve({error:null});};});
    return {data:[],error:null};}, from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client; w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>!$('#adminContent').hidden && $('#catalogReviewItem option[value="synthetic-premium-tool"]'));
    $('#catalogReviewItem').value='synthetic-premium-tool'; $('#catalogReviewItem').dispatchEvent(new w.Event('change'));
    $('#catalogReviewDescription').value='ویرایش در حال ذخیره'; $('#catalogReviewDescription').dispatchEvent(new w.Event('input'));
    $('#catalogReviewForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
    Object.defineProperty(w.document,'hidden',{value:false,configurable:true}); w.document.dispatchEvent(new w.Event('visibilitychange'));
    await waitFor(()=>count>=2 && !$('#adminContent').hidden); assert.equal($('#catalogReviewItem').disabled,true);
    finishSave(); await waitFor(()=>count>=3 && !$('#adminContent').hidden && $('#catalogReviewDescription').value==='ویرایش در حال ذخیره');
    assert.equal(w.studioCatalog.catalog.skills.find(x=>x.name==='synthetic-premium-tool').description_fa,'ویرایش در حال ذخیره');
    assert.equal($('#catalogReviewDraftNotice').textContent,''); assert.equal($('#catalogReviewSave').disabled,false);
    await delay(30);
  } finally {dom.window.close();}
});

test('unsaved review warns before closing and allows the manager to cancel sign-out', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s); let signOuts=0;
  const session={user:{id:'admin-1',email:'admin@example.test'}};
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session}}),signOut:async()=>{signOuts++; return {error:null};}},rpc:async(name)=>{
    if(name==='studio_my_account') return {data:[{is_admin:true,plan:'free'}]};
    if(name==='studio_premium_catalog') return {data:[{catalog:structuredClone(fullData),playbooks:fullPlaybooks}]};
    return {data:[],error:null};},from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.confirm=()=>false; w.__client=client; w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>!$('#adminContent').hidden && $('#catalogReviewItem option[value="synthetic-premium-tool"]'));
    $('#catalogReviewItem').value='synthetic-premium-tool'; $('#catalogReviewItem').dispatchEvent(new w.Event('change'));
    $('#catalogReviewDescription').value='متن ذخیره‌نشده'; $('#catalogReviewDescription').dispatchEvent(new w.Event('input'));
    const event=new w.Event('beforeunload',{cancelable:true}); w.dispatchEvent(event); assert.equal(event.defaultPrevented,true);
    $('#signOut').click(); assert.equal(signOuts,0); assert.equal($('#catalogReviewDescription').value,'متن ذخیره‌نشده');
    await delay(30);
  } finally {dom.window.close();}
});

test('a failed conflict reload retains the draft and can be retried without reloading the page', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s); let failFresh=false;
  const session={user:{id:'admin-1',email:'admin@example.test'}}, current=structuredClone(fullData);
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session}})},rpc:async(name)=>{
    if(name==='studio_my_account') return {data:[{is_admin:true,plan:'free'}]};
    if(name==='studio_premium_catalog') return failFresh ? {error:{message:'unavailable'}} : {data:[{catalog:structuredClone(current),playbooks:fullPlaybooks}]};
    if(name==='studio_admin_update_catalog_review') {current.skills.find(x=>x.name==='synthetic-premium-tool').description_fa='نسخهٔ دیگر'; failFresh=true; return {error:{code:'40001'}};}
    return {data:[],error:null};},from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client; w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>!$('#adminContent').hidden && $('#catalogReviewItem option[value="synthetic-premium-tool"]'));
    $('#catalogReviewItem').value='synthetic-premium-tool'; $('#catalogReviewItem').dispatchEvent(new w.Event('change'));
    $('#catalogReviewDescription').value='متن من'; $('#catalogReviewDescription').dispatchEvent(new w.Event('input'));
    $('#catalogReviewForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
    await waitFor(()=>$('#catalogReviewStatus').textContent.includes('دریافت نسخهٔ تازه ممکن نشد'));
    assert.equal($('#catalogReviewDescription').value,'متن من'); assert.equal($('#catalogReviewSave').disabled,true);
    failFresh=false; $('#catalogReviewRefresh').click();
    await waitFor(()=>!$('#adminContent').hidden && !$('#catalogReviewConflict').hidden);
    assert.equal($('#catalogReviewDescription').value,'متن من'); assert.match($('#catalogReviewLatest').textContent,/نسخهٔ دیگر/);
    await delay(30);
  } finally {dom.window.close();}
});

test('project workspace filters, sorts, edits stages and deletes with version checks', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s), records=[
    {id:'a',title:'آلفا',description:'برنامه آموزشی',project_type:'website',version:1,updated_at:'2026-01-01T10:00:00Z',checklist:[{text:'تحقیق',done:false},{text:'تولید',done:false}]},
    {id:'b',title:'بتا',description:'طراحی محصول',project_type:'website',version:1,updated_at:'2026-02-01T10:00:00Z',checklist:[{text:'یک',done:true},{text:'دو',done:false}]},
    {id:'c',title:'گاما',description:'<img src=x onerror=alert(1)>',project_type:'website',version:1,updated_at:'2026-03-01T10:00:00Z',checklist:[{text:'پایان',done:true}]},
  ]; let deleteVersion;
  const session={user:{id:'member-1',email:'member@example.test'}};
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session}})},rpc:async name=>name==='studio_my_account'?{data:[{is_admin:false,plan:'free'}]}:{data:[]},from:table=>{
    if(table!=='studio_projects') return {select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})};
    return {select:()=>({order:()=>({limit:async()=>({data:structuredClone(records),error:null})})}),
      update:patch=>{let id,version; const chain={eq:(key,value)=>{if(key==='id') id=value; if(key==='version') version=value;return chain;},select:()=>({maybeSingle:async()=>{const row=records.find(r=>r.id===id && r.version===version); if(!row)return {data:null,error:null}; Object.assign(row,structuredClone(patch)); return {data:{version:row.version},error:null};}})};return chain;},
      delete:()=>{let id,version; const chain={eq:(key,value)=>{if(key==='id') id=value; if(key==='version') version=value;return chain;},select:()=>({maybeSingle:async()=>{deleteVersion=version; const idx=records.findIndex(r=>r.id===id && r.version===version); if(idx<0)return {data:null,error:null};records.splice(idx,1);return {data:{id},error:null};}})};return chain;}};
  }};
  w.confirm=()=>true; w.__client=client; w.fetch=async url=>({ok:true,json:async()=>url.endsWith('playbooks.json')?playbooks:data});
  w.eval(app); w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    w.location.hash='#/projects'; await waitFor(()=>$('#projectList .project-card[data-project-id="a"]'));
    assert.equal($('#projectStatTotal').textContent,'۳'); assert.equal($('#projectStatActive').textContent,'۱'); assert.equal($('#projectStatDone').textContent,'۱');
    const a=()=>$('#projectList [data-project-id="a"]'), b=()=>$('#projectList [data-project-id="b"]'), c=()=>$('#projectList [data-project-id="c"]');
    assert.equal(b().querySelector('progress').value,50); assert.match(b().querySelector('.project-next').textContent,/دو/);
    assert.equal(c().querySelector('img'),null); assert.match(c().textContent,/<img src=x/);
    $('#projectFilter').value='active'; $('#projectFilter').dispatchEvent(new w.Event('change')); assert.equal(a().hidden,true); assert.equal(b().hidden,false); assert.equal(c().hidden,true);
    $('#projectFilter').value='all'; $('#projectFilter').dispatchEvent(new w.Event('change')); $('#projectSearch').value='آموزشی'; $('#projectSearch').dispatchEvent(new w.Event('input')); assert.equal(a().hidden,false); assert.equal(b().hidden,true);
    $('#projectSearch').value='بی‌نتیجه'; $('#projectSearch').dispatchEvent(new w.Event('input')); assert.equal($('#projectEmpty').hidden,false);
    $('#projectSearch').value=''; $('#projectSearch').dispatchEvent(new w.Event('input')); $('#projectSort').value='progress'; $('#projectSort').dispatchEvent(new w.Event('change')); assert.equal($('#projectList').firstElementChild.dataset.projectId,'c');
    const first=a().querySelector('.project-step'); first.querySelector('.project-step-actions button').click(); first.querySelector('.project-step-edit input').value='پژوهش'; first.querySelector('.project-step-edit').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>records[0].version===2 && first.textContent.includes('پژوهش')); assert.equal(records[0].checklist[0].text,'پژوهش');
    first.querySelectorAll('.project-step-actions button')[1].click(); await waitFor(()=>records[0].version===3 && a().querySelectorAll('.project-step').length===1); assert.equal(records[0].checklist.length,1);
    a().querySelector('.project-step input[type=checkbox]').click(); await waitFor(()=>records[0].version===4 && a().querySelector('progress').value===100); assert.equal(a().querySelector('progress').value,100); assert.equal($('#projectStatDone').textContent,'۲');
    a().querySelector('.project-delete').click(); await waitFor(()=>!$('#projectList [data-project-id="a"]')); assert.equal(deleteVersion,4); assert.equal($('#projectStatTotal').textContent,'۲');
    await delay(50);
  } finally {dom.window.close();}
});

test('project conflict keeps drafts, confirms refresh, and never leaks a late save to another user', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s), records=[{id:'a',title:'پروژه',description:'اول',project_type:'website',version:1,checklist:[{text:'کار',done:false}]}];
  let auth, allow=false, pending=null, writes=0;
  const session={user:{id:'member-1',email:'one@example.test'}};
  const client={auth:{onAuthStateChange:fn=>{auth=fn;},getSession:async()=>({data:{session}})},rpc:async name=>name==='studio_my_account'?{data:[{is_admin:false,plan:'free'}]}:{data:[]},from:table=>{
    if(table!=='studio_projects') return {select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})};
    return {select:()=>({order:()=>({limit:async()=>({data:structuredClone(records),error:null})})}),update:patch=>{let version; const chain={eq:(key,value)=>{if(key==='version')version=value;return chain;},select:()=>({maybeSingle:async()=>{writes++;if(pending)return new Promise(resolve=>{pending=()=>resolve({data:{version:version+1},error:null});});const row=records.find(r=>r.version===version);if(!row)return {data:null,error:null};Object.assign(row,patch);return {data:{version:row.version},error:null};}})};return chain;}};
  }};
  w.confirm=()=>allow; w.__client=client; w.fetch=async url=>({ok:true,json:async()=>url.endsWith('playbooks.json')?playbooks:data});
  w.eval(app); w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    w.location.hash='#/projects'; await waitFor(()=>$('#projectList .project-card'));
    $('#projectList .project-edit-title').value='پیش‌نویس خصوصی'; records[0].version=2; records[0].description='دستگاه دیگر';
    $('#projectList input[type=checkbox]').click(); await waitFor(()=>$('#projectList .project-conflict'));
    assert.equal($('#projectList .project-edit-title').value,'پیش‌نویس خصوصی'); assert.equal($('#projectList input[type=checkbox]').disabled,true);
    $('#projectRefresh').click(); assert.equal($('#projectList .project-edit-title').value,'پیش‌نویس خصوصی');
    allow=true; $('#projectRefresh').click(); await waitFor(()=>$('#projectList').textContent.includes('دستگاه دیگر'));
    pending=true; $('#projectList input[type=checkbox]').click(); await waitFor(()=>typeof pending==='function');
    assert.equal($('#projectRefresh').disabled,true); $('#projectList .project-editor form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); assert.equal(writes,2);
    auth('SIGNED_OUT',null); assert.equal($('#projectList').children.length,0); pending(); await delay(50);
    assert.equal($('#projectList').children.length,0); assert.equal($('#projectStatTotal').textContent,'—');
  } finally {dom.window.close();}
});

test('project loading locks edits and a failed refresh leaves old data read-only for retry', async () => {
  const dom=page(), w=dom.window, $=s=>w.document.querySelector(s), records=[{id:'a',title:'پروژه',description:'اطلاعات پیشین',project_type:'website',version:1,checklist:[{text:'کار',done:false}]}];
  let resolveLoad, loads=0, writes=0;
  const client={auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:{user:{id:'member-1',email:'one@example.test'}}}})},rpc:async name=>name==='studio_my_account'?{data:[{is_admin:false,plan:'free'}]}:{data:[]},from:table=>{
    if(table!=='studio_projects') return {select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})};
    return {select:()=>({order:()=>({limit:async()=>{loads++; if(loads===2) return new Promise(resolve=>{resolveLoad=resolve}); return {data:structuredClone(records),error:null};}})}), update:()=>{writes++;throw new Error('must not write');}};
  }};
  w.confirm=()=>true; w.__client=client; w.fetch=async url=>({ok:true,json:async()=>url.endsWith('playbooks.json')?playbooks:data});
  w.eval(app); w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    w.location.hash='#/projects'; await waitFor(()=>$('#projectList .project-card'));
    $('#projectList .project-edit-title').value='تغییر ذخیره‌نشده'; $('#projectRefresh').click(); await waitFor(()=>typeof resolveLoad==='function');
    assert.equal($('#projectCreate').disabled,true); assert.equal($('#projectList input[type=checkbox]').disabled,true);
    $('#projectList .project-editor form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); assert.equal(writes,0);
    resolveLoad({error:{message:'offline'}}); await waitFor(()=>$('#projectStatus').textContent.includes('دریافت پروژه‌ها ممکن نشد'));
    assert.equal($('#projectList .project-edit-title').value,'تغییر ذخیره‌نشده'); assert.equal($('#projectList input[type=checkbox]').disabled,true);
    $('#projectRefresh').click(); await waitFor(()=>loads===3 && !$('#projectList input[type=checkbox]').disabled);
    assert.equal($('#projectList .project-edit-title').value,'پروژه'); await delay(30);
  } finally {dom.window.close();}
});
