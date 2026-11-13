/* Optional local-only bridge to FCC's Code API. Never calls a localhost URL from the browser. */
const $ = (s) => document.querySelector(s);
const status = $('#agentStatus');
let session = null, epoch = null, run = null, timer = null;
async function api(path, options = {}) {
  const res = await fetch(`api/fcc/${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'اتصال به FCC ناموفق بود.');
  return data;
}
function error(e) { status.textContent = e.message || 'خطای اتصال'; }
async function bootstrap() {
  try { const data = await api('bootstrap'); epoch = data.epoch; status.textContent = data.available ? 'FCC آماده است. پوشه پروژه را وارد کنید.' : (data.message || 'FCC هنوز آماده نیست.'); }
  catch { status.textContent = 'اتصال محلی فعال نیست. FCC را اجرا کنید و سایت را با گزینه --fcc-local روی دستگاه خود راه‌اندازی کنید.'; }
}
async function refresh() {
  if (!session) return;
  try {
    const data = await api(`sessions/${encodeURIComponent(session.id)}`);
    session = data.session; epoch = data.epoch; run = data.run;
    const output = $('#agentOutput'); output.replaceChildren();
    (data.items || []).forEach(item => { const el = document.createElement('div'); const title = document.createElement('strong'); title.textContent = item.title || item.kind; const text = document.createElement('pre'); text.textContent = item.text || item.detail || ''; el.append(title, text); output.append(el); });
    status.textContent = `وضعیت: ${run?.status || session.status}` + (data.prompts?.some(p => p.status === 'pending') ? ' · تأیید در رابط Admin محلی FCC لازم است.' : '');
    if (run?.error) status.textContent += ` · ${run.error}`;
    if (['preparing', 'running', 'stopping'].includes(run?.status)) timer = setTimeout(refresh, 2000);
  } catch (e) { error(e); }
}
$('#agentCreate').addEventListener('submit', async e => {
  e.preventDefault(); clearTimeout(timer);
  try { session = await api('sessions', { method:'POST', body:JSON.stringify({ session_id:crypto.randomUUID(), cwd:$('#agentCwd').value.trim(), harness:'codex' }) }); $('#agentSession').hidden = false; $('#agentSessionLabel').textContent = `جلسه: ${session.title} · ${session.cwd}`; await refresh(); } catch(e) { error(e); }
});
$('#agentSend').addEventListener('submit', async e => {
  e.preventDefault(); if (!session || !epoch) return; if (['preparing','running','stopping'].includes(run?.status)) { status.textContent = 'منتظر پایان اجرای فعلی بمانید.'; return; }
  const text = $('#agentText').value.trim(); if (!text) return;
  try { run = await api(`sessions/${encodeURIComponent(session.id)}/turns`, { method:'POST', body:JSON.stringify({ operation_id:crypto.randomUUID(), expected_revision:session.revision, expected_epoch:epoch, text }) }); $('#agentText').value = ''; await refresh(); } catch(e) { error(e); }
});
$('#agentStop').addEventListener('click', async () => { if (!session || !run || !['preparing','running','stopping'].includes(run.status)) return; try { await api(`sessions/${encodeURIComponent(session.id)}/stop`, { method:'POST', body:JSON.stringify({ operation_id:crypto.randomUUID() }) }); clearTimeout(timer); await refresh(); } catch(e) { error(e); } });
bootstrap();
