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
test('login is first; guest can browse and a non-admin cannot see management controls', async () => {
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
    assert.equal($('#loginGate').hidden, false);
    $('#guestAccess').click(); assert.equal($('#loginGate').hidden, true);
    $('#openLogin').click(); assert.equal($('#loginGate').hidden, false);
    $('#authEmail').value='person@example.test'; $('#authPassword').value='password';
    $('#authForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
    await waitFor(() => $('#accountPlan').textContent === 'رایگان');
    assert.equal($('#loginGate').hidden,true); assert.equal($('#adminContent').hidden,true);
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
  const fullData = JSON.parse(await readFile(new URL('../catalog/data.json', site), 'utf8'));
  const fullPlaybooks = JSON.parse(await readFile(new URL('../catalog/playbooks.json', site), 'utf8'));
  assert.equal(data.skills.length, 16);
  assert.equal(fullData.skills.length, 314);
  assert.equal(playbooks.services.reduce((n,s)=>n+s.prompts.length,0),2);
  assert.equal(fullPlaybooks.services.reduce((n,s)=>n+s.prompts.length,0),38);
  const premiumPrompt = fullPlaybooks.services.find(s=>s.id==='webapp').prompts[0].text;
  assert.ok(!JSON.stringify(playbooks).includes(premiumPrompt));
  assert.ok(playbooks.services.every(s=>s.sample));
});

test('authorized catalog replaces the sample and sign-out resets the visible view', async () => {
  const dom = page(), w=dom.window, $=s=>w.document.querySelector(s);
  const fullData = JSON.parse(await readFile(new URL('../catalog/data.json', site), 'utf8'));
  const fullPlaybooks = JSON.parse(await readFile(new URL('../catalog/playbooks.json', site), 'utf8'));
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
    rpc:async(name,args)=>{calls.push({name,args}); if(name==='studio_my_account') return {data:[{is_admin:false,plan:'free'}]}; if(name==='studio_my_purchases') return {data:[]}; return {data:1,error:null};},
    from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client;
  w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>!$('#purchaseForm').hidden);
    $('#purchaseReference').value='receipt 123';
    $('#purchasePayerEmail').value='payer@example.test'; $('#purchasePaidAt').value='2999-01-02T09:15';
    $('#purchaseForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    assert.match($('#purchaseStatus').textContent,/گذشته/);
    assert.equal(calls.some(c=>c.name==='studio_submit_purchase'),false);
    $('#purchasePaidAt').value='2024-01-02T09:15';
    $('#purchaseForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>$('#purchaseStatus').textContent.includes('درخواست ثبت شد'));
    const sent=calls.find(c=>c.name==='studio_submit_purchase').args;
    assert.equal(sent.reference,'receipt 123'); assert.equal(sent.payer_email,'payer@example.test'); assert.ok(!Number.isNaN(Date.parse(sent.paid_at)));
    const email=$('#purchaseEmail'); assert.equal(email.hidden,false);
    const link=new URL(email.href); assert.equal(link.protocol,'mailto:'); assert.equal(link.pathname,'rahmani.hosseine@gmail.com');
    const body=link.searchParams.get('body'); assert.match(body,/receipt 123/); assert.match(body,/payer@example.test/); assert.match(body,/تومان/); assert.match(body,/زمان جهانی/);
    assert.equal(calls.some(c=>c.name==='studio_premium_catalog'),false);
    onAuth('SIGNED_OUT',null); await waitFor(()=>$('#purchaseForm').hidden);
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
      if(name==='studio_admin_users' || name==='studio_my_purchases') return {data:[]};
      if(name==='studio_admin_purchases') return {data:pending?[{id:1,email:'member@example.test',payment_reference:'receipt 123',payer_email:'payer@example.test',paid_at:'2024-01-02T09:15:00.000Z',amount_toman:990000}]:[]};
      if(name==='studio_review_purchase'){pending=false;return {error:null};}
      return {data:[],error:null};},
    from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[],error:null})})})})})};
  w.__client=client; w.confirm=()=>true;
  w.eval(workspaceSource.replace("import { createClient } from '@supabase/supabase-js';", '').replace(/const supabase = createClient\([^;]+;/, 'const supabase = window.__client;'));
  try {
    await waitFor(()=>$('#adminPurchases input'));
    assert.match($('#adminPurchases').textContent,/payer@example.test/); assert.match($('#adminPurchases').textContent,/receipt 123/); assert.ok($('#adminPurchases input').value);
    $('#adminPurchases input').value='2099-01-01'; $('#adminPurchases button').click();
    await waitFor(()=>calls.some(c=>c.name==='studio_review_purchase'));
    const call=calls.find(c=>c.name==='studio_review_purchase');
    assert.equal(call.args.decision,'approved'); assert.equal(call.args.request_id,1); assert.match(call.args.target_expiry,/2099-01-01/);
    await waitFor(()=>$('#adminPurchaseStatus').textContent.includes('درخواستی در انتظار'));
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
  const fullData = JSON.parse(await readFile(new URL('../catalog/data.json', site), 'utf8'));
  const fullPlaybooks = JSON.parse(await readFile(new URL('../catalog/playbooks.json', site), 'utf8'));
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
