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
let accountGeneration = 0, adminRows = [], expiryTimer;
function publishCatalog(payload) {
  window.studioCatalog = payload;
  window.dispatchEvent(new CustomEvent('studio:catalog', {detail: payload}));
}
function resetPremium() { clearTimeout(expiryTimer); publishCatalog(null); }
const purchaseStatus = $('#purchaseStatus');
const purchaseForm = $('#purchaseForm');
const purchaseEmail = $('#purchaseEmail');
function paymentMailto(row, accountEmail) {
  const paymentTime = new Date(row.paid_at);
  if (!row.payer_email || Number.isNaN(paymentTime.getTime())) return null;
  const subject = 'درخواست فعال‌سازی اشتراک یک‌ساله Agent Studio';
  const body = [
    'سلام، لطفاً پرداخت و درخواست اشتراک مرا بررسی کنید.',
    `مبلغ: ${Number(row.amount_toman).toLocaleString('fa-IR')} تومان`,
    'دوره: یک سال',
    `کد پیگیری: ${row.payment_reference}`,
    `تاریخ و ساعت واریز: ${paymentTime.toLocaleString('fa-IR')} (زمان محلی ارسال‌کننده)`,
    `زمان جهانی: ${paymentTime.toISOString()}`,
    `ایمیل پرداخت‌کننده: ${row.payer_email}`,
    `ایمیل حساب: ${accountEmail || 'نامشخص'}`,
  ].join('\n');
  return `mailto:rahmani.hosseine@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
async function loadPurchases() {
  $('#purchaseHistory').replaceChildren();
  if (!user) return;
  const who = user.id;
  const {data, error} = await supabase.rpc('studio_my_purchases');
  if (user?.id !== who) return;
  if (error) { report(purchaseStatus, error); return; }
  for (const row of data || []) {
    const item = document.createElement('li');
    const names = {pending:'در انتظار بررسی',approved:'تأیید شده',rejected:'رد شده'};
    const details = document.createElement('span');
    details.textContent = `${names[row.status] || 'نامشخص'} — ${row.payment_reference}`;
    item.append(details);
    const href = row.status === 'pending' && paymentMailto(row, user.email);
    if (href) { const link = document.createElement('a'); link.href = href; link.textContent = 'نوشتن ایمیل به مدیر'; item.append(link); }
    $('#purchaseHistory').append(item);
  }
}
purchaseForm.addEventListener('submit', async event => {
  event.preventDefault(); if (!user || !purchaseForm.reportValidity()) return;
  const reference = $('#purchaseReference').value.trim();
  const payerEmail = $('#purchasePayerEmail').value.trim().toLowerCase();
  const paid = new Date($('#purchasePaidAt').value);
  if (Number.isNaN(paid.getTime()) || paid.getTime() > Date.now() + 5 * 60 * 1000) { purchaseStatus.textContent = 'تاریخ و ساعت واریز باید در گذشته باشد.'; return; }
  const who = user.id, accountEmail = user.email;
  const button = purchaseForm.querySelector('button'); button.disabled = true;
  purchaseStatus.textContent = 'در حال ثبت درخواست...'; purchaseEmail.hidden = true;
  try {
    const {error} = await supabase.rpc('studio_submit_purchase', {reference, payer_email:payerEmail, paid_at:paid.toISOString()});
    if (user?.id !== who) return;
    if (error) {
      purchaseStatus.textContent = error.code === '23505' ? 'یک درخواست در انتظار بررسی دارید.' : 'ثبت درخواست ممکن نشد؛ اطلاعات و اتصال را بررسی کنید.';
    } else {
      purchaseEmail.href = paymentMailto({payment_reference:reference,payer_email:payerEmail,paid_at:paid.toISOString(),amount_toman:990000},accountEmail);
      purchaseEmail.hidden = false; purchaseForm.reset();
      purchaseStatus.textContent = 'درخواست ثبت شد. برای فرستادن ایمیل، دکمهٔ زیر را بزنید و پیام را ارسال کنید.';
      await loadPurchases();
    }
  } catch { if (user?.id === who) purchaseStatus.textContent = 'ثبت درخواست ممکن نشد؛ اتصال را بررسی کنید.'; }
  finally { button.disabled = false; }
});
async function loadAdminPurchases(generation) {
  const host = $('#adminPurchases'); host.replaceChildren(); $('#adminPurchaseStatus').textContent = 'در حال دریافت درخواست‌ها...';
  const {data,error} = await supabase.rpc('studio_admin_purchases');
  if (generation !== accountGeneration) return;
  if (error) { report($('#adminPurchaseStatus'), error); return; }
  $('#adminPurchaseStatus').textContent = data?.length ? `${faNumber(data.length)} درخواست در انتظار بررسی` : 'درخواستی در انتظار بررسی نیست.';
  for (const request of data || []) {
    const row = document.createElement('div'); row.className = 'pending-row';
    const text = document.createElement('div'); text.className = 'pending-details';
    const heading = document.createElement('strong'); heading.textContent = `حساب: ${request.email || 'بدون ایمیل'}`;
    const details = document.createElement('span');
    const parsed = request.paid_at ? new Date(request.paid_at) : null;
    const time = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString('fa-IR') : 'ثبت نشده';
    details.textContent = `کد پیگیری: ${request.payment_reference} | واریز: ${time} (زمان محلی مدیر) | ایمیل پرداخت‌کننده: ${request.payer_email || 'ثبت نشده'} | مبلغ: ${Number(request.amount_toman || 990000).toLocaleString('fa-IR')} تومان`;
    text.append(heading, details);
    const date = document.createElement('input'); date.type = 'date';
    const nextYear = new Date(); nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1); date.value = nextYear.toISOString().slice(0, 10); date.setAttribute('aria-label', `پایان اشتراک ${request.email || 'کاربر'}`);
    const approve = document.createElement('button'); approve.type = 'button'; approve.textContent = 'تأیید و فعال‌سازی';
    const reject = document.createElement('button'); reject.type = 'button'; reject.textContent = 'رد درخواست';
    async function review(decision) {
      const expiry = decision === 'approved' && date.value ? new Date(`${date.value}T23:59:59Z`) : null;
      if (decision === 'approved' && (!expiry || Number.isNaN(expiry.getTime()) || expiry <= new Date())) { $('#adminPurchaseStatus').textContent = 'تاریخ پایان در آینده را انتخاب کنید.'; return; }
      if (!window.confirm(decision === 'approved' ? 'پرداخت را بررسی کرده‌اید و می‌خواهید اشتراک را فعال کنید؟' : 'این درخواست رد شود؟')) return;
      approve.disabled = true; reject.disabled = true;
      const {error} = await supabase.rpc('studio_review_purchase', {request_id:request.id,decision,target_expiry:expiry?.toISOString() || null});
      if (error) { report($('#adminPurchaseStatus'), error); approve.disabled = false; reject.disabled = false; }
      else await refreshAccount();
    }
    approve.addEventListener('click', () => review('approved')); reject.addEventListener('click', () => review('rejected'));
    row.append(text,date,approve,reject); host.append(row);
  }
}

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
  $('#adminContent').hidden = true; adminRows = []; $('#adminUsers').replaceChildren(); $('#adminPurchases').replaceChildren();
  if (!user) { resetPremium(); $('#adminStatus').textContent = 'برای بررسی دسترسی، وارد حساب خود شوید.'; $('#accountPlan').textContent = '—'; return; }
  $('#accountPlan').textContent = 'در حال بررسی...';
  const {data, error} = await supabase.rpc('studio_my_account');
  if (generation !== accountGeneration) return;
  if (error || !data?.length) { resetPremium(); $('#accountPlan').textContent = 'وضعیت اشتراک قابل دریافت نیست.'; $('#adminStatus').textContent = 'بررسی دسترسی ممکن نشد. دوباره تلاش کنید.'; return; }
  const account = data[0];
  $('#accountPlan').textContent = account.plan === 'plus' ? 'پلاس فعال' : 'رایگان';
  $('#accountExpiry').textContent = account.plan === 'plus' && account.expires_at ? `تا ${new Date(account.expires_at).toLocaleDateString('fa-IR')}` : '';
  if (account.is_admin || account.plan === 'plus') {
    const full = await supabase.rpc('studio_premium_catalog');
    if (generation !== accountGeneration) return;
    if (full.error || !full.data?.[0]?.catalog || !full.data[0].playbooks?.services) { resetPremium(); $('#accountPlan').textContent = 'دریافت محتوای اشتراک ممکن نشد.'; }
    else {
      publishCatalog(full.data[0]);
      clearTimeout(expiryTimer);
      if (!account.is_admin && account.expires_at) {
        const remaining = new Date(account.expires_at).getTime() - Date.now();
        if (remaining <= 0) resetPremium();
        else expiryTimer = setTimeout(() => { resetPremium(); refreshAccount(); }, Math.min(remaining, 2147483647));
      }
    }
  } else resetPremium();
  if (!account.is_admin) { $('#adminStatus').textContent = 'این بخش فقط برای مدیر است. اگر مدیر هنوز تعیین نشده، دسترسی فعال نیست.'; return; }
  $('#adminStatus').textContent = 'در حال دریافت حساب‌ها...';
  const result = await supabase.rpc('studio_admin_users');
  if (generation !== accountGeneration) return;
  if (result.error) { report($('#adminStatus'), result.error); return; }
  adminRows = result.data || [];
  $('#adminUserCount').textContent = faNumber(adminRows.length);
  $('#adminPlusCount').textContent = faNumber(adminRows.filter(r => r.plan === 'plus' && new Date(r.expires_at) > new Date()).length);
  $('#adminContent').hidden = false; $('#adminStatus').textContent = 'فهرست حساب‌ها آماده است.'; drawAdmin(); await loadAdminPurchases(generation);
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
  if (previous !== user?.id) { ++accountGeneration; resetPremium(); }
  purchaseForm.hidden = !user; $('#purchaseLogin').hidden = !!user;
  if (previous !== user?.id) { purchaseStatus.textContent = ''; purchaseEmail.hidden = true; purchaseEmail.removeAttribute('href'); purchaseForm.reset(); loadPurchases(); }
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
document.addEventListener('visibilitychange', () => { if (!document.hidden && user) refreshAccount(); });
refreshAccount();
supabase.auth.onAuthStateChange((_event, session) => { updateSession(session); });
supabase.auth.getSession().then(({ data, error }) => { if (error) report(authStatus, error); else { updateSession(data.session); if (authStatus.textContent === 'در حال آماده‌سازی حساب...') authStatus.textContent = ''; } }).catch(() => { authStatus.textContent = 'اتصال به حساب ممکن نشد؛ دوباره تلاش کنید یا بدون ورود ادامه دهید.'; });
