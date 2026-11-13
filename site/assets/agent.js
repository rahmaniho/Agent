/* Local-only bridge to FCC's Code API. Browser requests remain same-origin. */
const $ = (s) => document.querySelector(s);
const status = $('#agentStatus');
const connection = $('#agentConnection');
const createButton = $('#agentCreate button[type="submit"]');
const sendButton = $('#agentSend button[type="submit"]');
const activeStatuses = new Set(['preparing', 'running', 'stopping']);
let session = null, epoch = null, run = null, timer = null;
let available = false, creating = false, sending = false, stopping = false;
let selectionGeneration = 0;

async function api(path, options = {}) {
  const res = await fetch(`api/fcc/${path}`, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data !== 'object') {
    const detail = data?.detail;
    throw new Error(typeof detail === 'string' ? detail : 'اتصال به FCC ناموفق بود. وضعیت سرور محلی را بررسی کنید.');
  }
  return data;
}
function setStatus(text, kind = '') {
  status.textContent = text;
  status.dataset.kind = kind;
}
function controls() {
  createButton.disabled = !available || creating;
  sendButton.disabled = !available || !session?.revision || !epoch || sending || activeStatuses.has(run?.status);
  $('#agentStop').disabled = !available || !session || stopping || !activeStatuses.has(run?.status);
  $('#agentReloadSessions').disabled = !available;
}
async function loadSessions() {
  if (!available) return;
  const list = $('#agentSessionsList');
  try {
    const data = await api('sessions');
    if (!Array.isArray(data.sessions)) throw new Error('پاسخ فهرست جلسه‌ها نامعتبر است.');
    list.replaceChildren();
    if (!data.sessions.length) { const empty = document.createElement('p'); empty.textContent = 'هنوز جلسه‌ای ساخته نشده است.'; list.append(empty); return; }
    data.sessions.forEach((item) => {
      if (!item.id) return;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'agent-session-item';
      if (session?.id === item.id) button.classList.add('is-current');
      const title = document.createElement('strong'); title.textContent = item.title || 'جلسه بدون عنوان';
      const path = document.createElement('small'); path.textContent = item.cwd || '';
      button.append(title, path);
      button.addEventListener('click', () => selectSession(item.id));
      list.append(button);
    });
  } catch (e) { setStatus(e.message, 'error'); }
}
async function bootstrap() {
  $('#agentReconnect').disabled = true;
  setStatus('در حال بررسی اتصال...');
  try {
    const data = await api('bootstrap'); epoch = data.epoch; available = data.available === true;
    connection.textContent = available ? 'متصل · محلی' : 'آماده نیست';
    connection.dataset.connected = String(available);
    setStatus(available ? 'FCC آماده است. پوشه پروژه را وارد کنید یا یک جلسه را باز کنید.' : (data.message || 'FCC هنوز آماده نیست.'));
    controls();
    if (available) { await loadSessions(); if (session) await refresh(session.id, selectionGeneration); }
  } catch {
    available = false; clearTimeout(timer); connection.textContent = 'آفلاین'; connection.dataset.connected = 'false';
    setStatus('اتصال محلی فعال نیست. FCC را اجرا کنید و سایت را با گزینه --fcc-local روی دستگاه خود راه‌اندازی کنید.', 'error');
    controls();
  } finally { $('#agentReconnect').disabled = false; }
}
function renderOutput(items) {
  const output = $('#agentOutput'); output.replaceChildren();
  if (!items.length) { const empty = document.createElement('p'); empty.className = 'agent-output-empty'; empty.textContent = 'هنوز پیامی در این جلسه وجود ندارد. اولین درخواست خود را بنویسید.'; output.append(empty); return; }
  items.forEach(item => {
    const el = document.createElement('div'); el.className = 'agent-message';
    const title = document.createElement('strong'); title.textContent = item.title || item.kind || 'پیام';
    const text = document.createElement('pre'); text.textContent = item.text || item.detail || '';
    el.append(title, text); output.append(el);
  });
}
async function refresh(id, generation) {
  if (!id) return;
  clearTimeout(timer);
  try {
    const data = await api(`sessions/${encodeURIComponent(id)}`);
    if (generation !== selectionGeneration) return;
    if (!data.session || !Array.isArray(data.items)) throw new Error('پاسخ جلسه نامعتبر است.');
    session = data.session; epoch = data.epoch; run = data.run;
    $('#agentSessionLabel').textContent = `${session.title || 'جلسه'} · ${session.cwd || ''}`;
    renderOutput(data.items);
    const labels = {ready:'آماده', preparing:'در حال آماده‌سازی', running:'در حال اجرا', stopping:'در حال توقف', completed:'تکمیل شده', interrupted:'متوقف شده', failed:'ناموفق'};
    setStatus(`وضعیت جلسه: ${labels[run?.status || session.status] || run?.status || session.status}` + (data.prompts?.some(p => p.status === 'pending') ? ' · تأیید در Admin محلی FCC لازم است.' : '') + (run?.error ? ` · ${run.error}` : ''));
    controls();
    if (activeStatuses.has(run?.status)) timer = setTimeout(() => refresh(id, generation), 2000);
  } catch (e) { if (generation === selectionGeneration) { setStatus(`${e.message} برای تلاش دوباره «به‌روزرسانی» را بزنید.`, 'error'); controls(); } }
}
async function selectSession(id) {
  const generation = ++selectionGeneration; clearTimeout(timer);
  session = { id }; run = null; epoch = null;
  $('#agentEmpty').hidden = true; $('#agentSession').hidden = false;
  $('#agentSessionLabel').textContent = 'در حال دریافت جلسه...';
  $('#agentOutput').replaceChildren(); controls();
  await refresh(id, generation);
  if (generation === selectionGeneration) await loadSessions();
}
$('#agentCreate').addEventListener('submit', async e => {
  e.preventDefault(); if (!available || creating) return;
  const cwd = $('#agentCwd').value.trim(); if (!cwd) return;
  creating = true; controls(); setStatus('در حال ساخت جلسه...');
  try {
    const created = await api('sessions', { method:'POST', body:JSON.stringify({ session_id:crypto.randomUUID(), cwd, harness:'codex' }) });
    if (!created.id) throw new Error('شناسه جلسه در پاسخ موجود نیست.');
    await selectSession(created.id);
  } catch(e) { setStatus(e.message, 'error'); } finally { creating = false; controls(); }
});
$('#agentSend').addEventListener('submit', async e => {
  e.preventDefault(); if (!available || !session || !epoch || sending || activeStatuses.has(run?.status)) return;
  const text = $('#agentText').value.trim(); if (!text) return;
  const id = session.id, generation = selectionGeneration;
  sending = true; controls(); setStatus('در حال ارسال درخواست...');
  try {
    const receipt = await api(`sessions/${encodeURIComponent(id)}/turns`, { method:'POST', body:JSON.stringify({ operation_id:crypto.randomUUID(), expected_revision:session.revision, expected_epoch:epoch, text }) });
    if (generation !== selectionGeneration) return;
    run = receipt; $('#agentText').value = ''; await refresh(id, generation);
  } catch(e) { if (generation === selectionGeneration) setStatus(`${e.message} درخواست در کادر باقی مانده است؛ پیش از ارسال دوباره وضعیت جلسه را بررسی کنید.`, 'error'); }
  finally { sending = false; controls(); }
});
$('#agentStop').addEventListener('click', async () => {
  if (!session || !run || stopping || !activeStatuses.has(run.status)) return;
  const id = session.id, generation = selectionGeneration;
  stopping = true; controls();
  try { await api(`sessions/${encodeURIComponent(id)}/stop`, { method:'POST', body:JSON.stringify({ operation_id:run.id }) }); if (generation === selectionGeneration) await refresh(id, generation); }
  catch(e) { if (generation === selectionGeneration) setStatus(e.message, 'error'); }
  finally { stopping = false; controls(); }
});
$('#agentReconnect').addEventListener('click', bootstrap);
$('#agentReloadSessions').addEventListener('click', loadSessions);
$('#agentRefresh').addEventListener('click', () => { if (session) refresh(session.id, selectionGeneration); });
controls(); bootstrap();
