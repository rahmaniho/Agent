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
