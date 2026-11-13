import { createClient } from '@supabase/supabase-js';

// Publishable key, intentionally public. Access to data is controlled by RLS.
const supabase = createClient('https://asxyjxxgpfsgfmabqqdw.supabase.co', 'sb_publishable_djAPhLTPBob4-C1pcbN_OA__vFHmeif');
const $ = (s) => document.querySelector(s);
const authStatus = $('#authStatus'), noteStatus = $('#noteStatus');
const PAGE_SIZE = 25;
let user = null, loadingNotes = 0, offset = 0, saving = false;
const report = (el, error) => {
  const message = String(error?.message || error || '');
  if (/invalid login credentials/i.test(message)) el.textContent = 'ایمیل یا رمز عبور درست نیست.';
  else if (/email not confirmed/i.test(message)) el.textContent = 'ابتدا ایمیل تأیید حساب را بررسی کنید.';
  else if (/already registered/i.test(message)) el.textContent = 'این ایمیل قبلاً ثبت شده است؛ وارد شوید.';
  else el.textContent = 'انجام درخواست ممکن نشد. اتصال و اطلاعات را بررسی کنید و دوباره تلاش کنید.';
};
const gate = $('#loginGate');
function setGate(open) {
  gate.hidden = !open;
  document.body.classList.toggle('login-open', open);
  for (const node of document.body.children) if (node !== gate && node.tagName !== 'SCRIPT') node.inert = open;
  if (open) setTimeout(() => $('#authEmail').focus(), 0);
}
$('#guestAccess').addEventListener('click', () => { try { sessionStorage.setItem('studio-guest', '1'); } catch {} setGate(false); });
$('#openLogin').addEventListener('click', () => setGate(true));
gate.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const controls = Array.from(gate.querySelectorAll('input:not(:disabled),button:not(:disabled),a[href]')).filter(el => el.offsetParent !== null);
  if (!controls.length) return;
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
setGate(true);
let accountGeneration = 0, adminRows = [];
const faNumber = n => Number(n).toLocaleString('fa-IR');
function drawAdmin() {
  const body = $('#adminUsers'); body.replaceChildren();
  const query = $('#adminSearch').value.trim().toLowerCase();
  adminRows.filter(row => (row.email || '').toLowerCase().includes(query)).forEach(row => {
    const tr = document.createElement('tr');
    const cell = text => { const td = document.createElement('td'); td.textContent = text; tr.append(td); return td; };
    cell(row.email || 'بدون ایمیل');
    const active = row.plan === 'plus' && row.expires_at && new Date(row.expires_at) > new Date();
    cell(active ? 'پلاس فعال' : row.plan === 'plus' ? 'پلاس پایان‌یافته' : 'رایگان');
    cell(row.expires_at ? new Date(row.expires_at).toLocaleDateString('fa-IR') : '—');
    const actions = document.createElement('td'); actions.className = 'admin-actions';
    const date = document.createElement('input'); date.type = 'date'; date.setAttribute('aria-label', `تاریخ پایان برای ${row.email || 'کاربر'}`);
    const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = 'فعال‌سازی پلاس';
    const free = document.createElement('button'); free.type = 'button'; free.textContent = 'طرح رایگان';
    async function change(plan) {
      const expiry = plan === 'plus' && date.value ? new Date(`${date.value}T23:59:59Z`) : null;
      if (plan === 'plus' && (!expiry || Number.isNaN(expiry.getTime()) || expiry <= new Date())) { $('#adminStatus').textContent = 'یک تاریخ پایان در آینده انتخاب کنید.'; return; }
      if (!window.confirm(`طرح ${row.email || 'این کاربر'} تغییر کند؟`)) return;
      plus.disabled = true; free.disabled = true;
      const { error } = await supabase.rpc('studio_set_subscription', {target_user: row.user_id, target_plan: plan, target_expiry: expiry?.toISOString() || null});
      if (error) { report($('#adminStatus'), error); plus.disabled = false; free.disabled = false; }
      else { $('#adminStatus').textContent = 'تغییر طرح ذخیره شد.'; await refreshAccount(); }
    }
    plus.addEventListener('click', () => change('plus')); free.addEventListener('click', () => change('free'));
    actions.append(date, plus, free); tr.append(actions); body.append(tr);
  });
}
$('#adminSearch').addEventListener('input', drawAdmin);
async function refreshAccount() {
  const generation = ++accountGeneration;
  $('#adminContent').hidden = true; adminRows = []; $('#adminUsers').replaceChildren();
  if (!user) { $('#adminStatus').textContent = 'برای بررسی دسترسی، وارد حساب خود شوید.'; $('#accountPlan').textContent = '—'; return; }
  $('#accountPlan').textContent = 'در حال بررسی...';
  const {data, error} = await supabase.rpc('studio_my_account');
  if (generation !== accountGeneration) return;
  if (error || !data?.length) { $('#accountPlan').textContent = 'وضعیت اشتراک قابل دریافت نیست.'; $('#adminStatus').textContent = 'بررسی دسترسی ممکن نشد. دوباره تلاش کنید.'; return; }
  const account = data[0];
  $('#accountPlan').textContent = account.plan === 'plus' ? 'پلاس فعال' : 'رایگان';
  $('#accountExpiry').textContent = account.plan === 'plus' && account.expires_at ? `تا ${new Date(account.expires_at).toLocaleDateString('fa-IR')}` : '';
  if (!account.is_admin) { $('#adminStatus').textContent = 'این بخش فقط برای مدیر است. اگر مدیر هنوز تعیین نشده، دسترسی فعال نیست.'; return; }
  $('#adminStatus').textContent = 'در حال دریافت حساب‌ها...';
  const result = await supabase.rpc('studio_admin_users');
  if (generation !== accountGeneration) return;
  if (result.error) { report($('#adminStatus'), result.error); return; }
  adminRows = result.data || [];
  $('#adminUserCount').textContent = faNumber(adminRows.length);
  $('#adminPlusCount').textContent = faNumber(adminRows.filter(r => r.plan === 'plus' && new Date(r.expires_at) > new Date()).length);
  $('#adminContent').hidden = false; $('#adminStatus').textContent = 'فهرست حساب‌ها آماده است.'; drawAdmin();
}

function noteControls() {
  $('#noteContent').disabled = !user || saving;
  $('#noteForm button').disabled = !user || saving;
  $('#notesRefresh').disabled = !user;
}
async function loadNotes(reset = true) {
  const request = ++loadingNotes;
  if (reset) { offset = 0; $('#notesList').replaceChildren(); }
  $('#notesMore').hidden = true;
  if (!user) { noteStatus.textContent = 'برای مشاهده و ذخیره یادداشت وارد شوید.'; return; }
  noteStatus.textContent = 'در حال دریافت یادداشت‌ها...';
  const { data, error } = await supabase.from('workspace_notes').select('id,content,created_at').order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
  if (request !== loadingNotes) return;
  if (error) { report(noteStatus, error); $('#notesMore').hidden = offset === 0; return; }
  offset += data.length;
  noteStatus.textContent = offset ? `${offset.toLocaleString('fa-IR')} یادداشت نمایش داده شده است.` : 'هنوز یادداشتی ندارید.';
  $('#notesMore').hidden = data.length < PAGE_SIZE;
  data.forEach(note => {
    const li = document.createElement('li');
    const body = document.createElement('div'); body.className = 'note-body';
    const text = document.createElement('p'); text.textContent = note.content;
    const date = document.createElement('time'); date.dateTime = note.created_at;
    const parsed = new Date(note.created_at); date.textContent = Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('fa-IR');
    body.append(text, date);
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'حذف'; button.setAttribute('aria-label', 'حذف یادداشت');
    button.addEventListener('click', async () => {
      if (!window.confirm('این یادداشت حذف شود؟')) return;
      button.disabled = true;
      const { error } = await supabase.from('workspace_notes').delete().eq('id', note.id);
      if (error) { report(noteStatus, error); button.disabled = false; } else await loadNotes();
    });
    li.append(body, button); $('#notesList').append(li);
  });
}
function updateSession(session) {
  const previous = user?.id;
  user = session?.user || null;
  $('#authLoggedOut').hidden = !!user; $('#workspaceLoggedOut').hidden = !!user; $('#authLoggedIn').hidden = !user;
  if (user) setGate(false);
  else { let guest = false; try { guest = sessionStorage.getItem('studio-guest') === '1'; } catch {} if (guest) setGate(false); }
  $('#accountEmail').textContent = user?.email || '';
  noteControls();
  if (previous !== user?.id) { loadNotes(); setTimeout(refreshAccount, 0); }
}
$('#authForm').addEventListener('submit', async event => {
  event.preventDefault(); authStatus.textContent = 'در حال ورود...';
  const { error } = await supabase.auth.signInWithPassword({ email: $('#authEmail').value.trim(), password: $('#authPassword').value });
  if (error) report(authStatus, error); else { $('#authPassword').value = ''; authStatus.textContent = 'با موفقیت وارد شدید.'; }
});
$('#signUp').addEventListener('click', async () => {
  if (!$('#authForm').reportValidity()) return;
  authStatus.textContent = 'در حال ساخت حساب...';
  const { data, error } = await supabase.auth.signUp({ email: $('#authEmail').value.trim(), password: $('#authPassword').value, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) report(authStatus, error); else { $('#authPassword').value = ''; authStatus.textContent = data.session ? 'حساب ساخته شد.' : 'حساب ساخته شد؛ برای تأیید، ایمیل خود را بررسی کنید.'; }
});
$('#signOut').addEventListener('click', async () => { const { error } = await supabase.auth.signOut(); if (error) report(authStatus, error); else { try { sessionStorage.removeItem('studio-guest'); } catch {} authStatus.textContent = 'از حساب خارج شدید.'; setGate(true); } });
$('#noteForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!user || saving) return;
  const content = $('#noteContent').value.trim(); if (!content) return;
  saving = true; noteControls();
  try {
    const { error } = await supabase.from('workspace_notes').insert({ content });
    if (error) report(noteStatus, error); else { $('#noteContent').value = ''; await loadNotes(); }
  } finally { saving = false; noteControls(); }
});
$('#notesMore').addEventListener('click', () => loadNotes(false));
$('#notesRefresh').addEventListener('click', () => loadNotes());
noteControls();
refreshAccount();
supabase.auth.onAuthStateChange((_event, session) => { updateSession(session); });
supabase.auth.getSession().then(({ data, error }) => { if (error) report(authStatus, error); else { updateSession(data.session); if (authStatus.textContent === 'در حال آماده‌سازی حساب...') authStatus.textContent = ''; } }).catch(() => { authStatus.textContent = 'اتصال به حساب ممکن نشد؛ دوباره تلاش کنید یا بدون ورود ادامه دهید.'; });
