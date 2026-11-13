import { createClient } from '@supabase/supabase-js';

// Publishable key, intentionally public. Access to data is controlled by RLS.
const authCallbackError = /(?:[&#?])error(?:_code|_description)?=/.test(location.hash + location.search);
// Sessions are browser-scoped unless the user explicitly chooses to remember them.
let rememberSession = false;
try { rememberSession = localStorage.getItem('studio-remember-session') === '1'; } catch {}
const authStorage = {
  getItem(key) { try { return sessionStorage.getItem(key) ?? localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { const target = rememberSession ? localStorage : sessionStorage; const other = rememberSession ? sessionStorage : localStorage; target.setItem(key, value); other.removeItem(key); } catch {} },
  removeItem(key) { try { sessionStorage.removeItem(key); localStorage.removeItem(key); } catch {} },
};
const supabaseUrl = 'https://asxyjxxgpfsgfmabqqdw.supabase.co';
const publishableKey = 'sb_publishable_djAPhLTPBob4-C1pcbN_OA__vFHmeif';
const supabase = createClient(supabaseUrl, publishableKey, {auth:{storage:authStorage,persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
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
let authBusy = false, recoveryMode = false, intentionalSignOut = false, gateTrigger = null;
function authPanel(panel) {
  for (const name of ['Login','Forgot','Reset','Success']) $(`#auth${name}Panel`).hidden = name.toLowerCase() !== panel;
  gate.setAttribute('aria-labelledby', {login:'loginTitle',forgot:'forgotTitle',reset:'resetTitle',success:'successTitle'}[panel]);
  authStatus.textContent = ''; authStatus.dataset.kind = '';
}
function setGate(open, focusEmail = false) {
  if (open && gate.hidden) gateTrigger = document.activeElement;
  gate.hidden = !open;
  document.body.classList.toggle('login-open', open);
  for (const node of document.body.children) if (node !== gate && node.tagName !== 'SCRIPT') node.inert = open;
  if (open) setTimeout(() => { if (!gate.hidden) $(recoveryMode ? '#newPassword' : focusEmail ? '#authEmail' : '#guestAccess').focus(); }, 0);
  else { $('#authPassword').value = ''; $('#authPassword').type = 'password'; $('#togglePassword').setAttribute('aria-pressed', 'false'); $('#togglePassword').setAttribute('aria-label', 'نمایش رمز عبور'); $('#resetForm').reset(); if (gateTrigger?.isConnected) gateTrigger.focus(); gateTrigger = null; }
}
function openLogin() { recoveryMode = false; $('#authLoggedOut').hidden = false; authPanel('login'); setGate(true, true); }
$('#guestAccess').addEventListener('click', () => { if (!authBusy) { recoveryMode = false; setGate(false); } });
$('#headerLogin').addEventListener('click', openLogin);
$('#purchaseOpenLogin').addEventListener('click', openLogin);
$('#openLogin').addEventListener('click', openLogin);
$('#projectLogin').addEventListener('click', openLogin);
$('#togglePassword').addEventListener('click', () => {
  const input = $('#authPassword'), visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  $('#togglePassword').setAttribute('aria-pressed', String(visible));
  $('#togglePassword').setAttribute('aria-label', visible ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور');
});
$('#forgotPassword').addEventListener('click', () => { authPanel('forgot'); $('#recoveryEmail').value = $('#authEmail').value; $('#recoveryEmail').focus(); });
$('#backToLogin').addEventListener('click', () => { authPanel('login'); $('#authEmail').focus(); });
gate.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !authBusy) { recoveryMode = false; setGate(false); return; }
  if (event.key !== 'Tab') return;
  const controls = Array.from(gate.querySelectorAll('input:not(:disabled),button:not(:disabled),a[href]')).filter(el => el.offsetParent !== null);
  if (!controls.length) return;
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
if (window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches && !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
  gate.addEventListener('pointermove', e => {
    const box = gate.getBoundingClientRect();
    const x = (e.clientX / box.width - .5), y = (e.clientY / box.height - .5);
    gate.style.setProperty('--glow-x', `${e.clientX}px`); gate.style.setProperty('--glow-y', `${e.clientY}px`);
    gate.style.setProperty('--sphere-x', `${x * 14}px`); gate.style.setProperty('--sphere-y', `${y * 10}px`);
    gate.style.setProperty('--card-x', `${-y * 2}deg`); gate.style.setProperty('--card-y', `${x * 2}deg`);
  }, {passive:true});
  gate.addEventListener('pointerleave', () => { for (const key of ['--sphere-x','--sphere-y','--card-x','--card-y','--glow-x','--glow-y']) gate.style.removeProperty(key); });
}
let accountGeneration = 0, adminRows = [], expiryTimer, projectGeneration = 0, adminPurchaseGeneration = 0, adminPurchaseOffset = 0, catalogEditorAdmin = false, catalogReviewBusy = false;
const catalogDrafts = new Map();
let catalogSelection = null, catalogSave = null;
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
  const {data, error} = await supabase.rpc('studio_my_purchases_v2');
  if (user?.id !== who) return;
  if (error) { report(purchaseStatus, error); return; }
  for (const row of data || []) {
    const item = document.createElement('li');
    const names = {pending:'در انتظار بررسی',approved:'تأیید شده',rejected:'رد شده'};
    const details = document.createElement('span');
    details.textContent = `${names[row.status] || 'نامشخص'} — ${row.payment_reference}${row.status === 'rejected' && row.rejection_reason ? ` · دلیل: ${row.rejection_reason}` : ''}`;
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
  const paid = new Date(`${$('#purchaseDate').value}T${$('#purchaseTime').value}`);
  const receipt = $('#purchaseReceipt').files[0];
  if (!receipt || !['image/jpeg', 'image/png', 'image/webp'].includes(receipt.type) || receipt.size < 1 || receipt.size > 5 * 1024 * 1024) { purchaseStatus.textContent = 'فیش باید تصویر JPG، PNG یا WebP و حداکثر ۵ مگابایت باشد.'; return; }
  if (Number.isNaN(paid.getTime()) || paid.getTime() > Date.now() + 5 * 60 * 1000) { purchaseStatus.textContent = 'تاریخ و ساعت واریز باید در گذشته باشد.'; return; }
  const who = user.id, accountEmail = user.email;
  const button = purchaseForm.querySelector('button'); button.disabled = true;
  purchaseStatus.textContent = 'در حال ثبت درخواست...'; purchaseEmail.hidden = true;
  try {
    const prepared = await supabase.rpc('studio_prepare_receipt');
    if (user?.id !== who) return;
    if (prepared.error || !prepared.data) {
      purchaseStatus.textContent = prepared.error?.code === '23505' ? 'یک درخواست در انتظار بررسی دارید.' : 'آماده‌سازی فیش ممکن نشد؛ دوباره تلاش کنید.';
      return;
    }
    const path = prepared.data, bucket = supabase.storage.from('studio-payment-receipts');
    // Remove an abandoned staged upload from a previous interrupted attempt before retrying.
    const removed = await bucket.remove([path]);
    if (user?.id !== who) return;
    if (removed.error) { purchaseStatus.textContent = 'آماده‌سازی فیش ممکن نشد؛ دوباره تلاش کنید.'; return; }
    const upload = await bucket.upload(path, receipt, {contentType:receipt.type, upsert:false});
    if (user?.id !== who) return;
    if (upload.error) { purchaseStatus.textContent = 'بارگذاری فیش ممکن نشد؛ تصویر و اتصال را بررسی کنید.'; return; }
    purchaseStatus.textContent = 'فیش بارگذاری شد؛ در حال ارسال درخواست به مدیر...';
    const {error} = await supabase.rpc('studio_submit_purchase_with_receipt', {reference, payer_email:payerEmail, paid_at:paid.toISOString(), receipt:path});
    if (user?.id !== who) return;
    if (error) {
      // Deletion is allowed only if the upload was not attached to a submitted request.
      await bucket.remove([path]);
      purchaseStatus.textContent = error.code === '23505' ? 'یک درخواست در انتظار بررسی دارید.' : 'ثبت درخواست ممکن نشد؛ پیش از تلاش دوباره وضعیت درخواست‌ها را بررسی کنید.';
      await loadPurchases();
    } else {
      purchaseEmail.href = paymentMailto({payment_reference:reference,payer_email:payerEmail,paid_at:paid.toISOString(),amount_toman:990000},accountEmail);
      purchaseEmail.hidden = false; purchaseForm.reset();
      purchaseStatus.textContent = 'درخواست و فیش برای بررسی به پنل مدیر ارسال شد. ایمیل اختیاری است و خودکار ارسال نمی‌شود.';
      await loadPurchases();
    }
  } catch { if (user?.id === who) purchaseStatus.textContent = 'ثبت درخواست ممکن نشد؛ اتصال را بررسی کنید.'; }
  finally { button.disabled = false; }
});
async function loadAdminPurchases(generation) {
  const requestGeneration = ++adminPurchaseGeneration;
  const host = $('#adminPurchases'); host.replaceChildren(); $('#adminPurchaseStatus').textContent = 'در حال دریافت درخواست‌ها...';
  $('#adminPurchasesPrev').disabled = true; $('#adminPurchasesNext').disabled = true;
  const {data,error} = await supabase.rpc('studio_admin_purchases_v3', {filter_status: $('#adminPurchaseFilter').value, page_offset:adminPurchaseOffset});
  if (generation !== accountGeneration || requestGeneration !== adminPurchaseGeneration) return;
  if (error) { report($('#adminPurchaseStatus'), error); return; }
  $('#adminPurchaseStatus').textContent = data?.length ? `درخواست‌های ${faNumber(adminPurchaseOffset+1)} تا ${faNumber(adminPurchaseOffset+data.length)}` : 'درخواستی در این صفحه یافت نشد.';
  $('#adminPurchasesPrev').disabled = adminPurchaseOffset===0; $('#adminPurchasesNext').disabled = (data?.length || 0)<50;
  for (const request of data || []) {
    const row = document.createElement('div'); row.className = 'pending-row';
    const text = document.createElement('div'); text.className = 'pending-details';
    const heading = document.createElement('strong'); heading.textContent = `حساب: ${request.email || 'بدون ایمیل'}`;
    const details = document.createElement('span');
    const parsed = request.paid_at ? new Date(request.paid_at) : null;
    const time = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString('fa-IR') : 'ثبت نشده';
    details.textContent = `کد پیگیری: ${request.payment_reference} | واریز: ${time} (زمان محلی مدیر) | ایمیل پرداخت‌کننده: ${request.payer_email || 'ثبت نشده'} | مبلغ: ${Number(request.amount_toman || 990000).toLocaleString('fa-IR')} تومان`;
    text.append(heading, details);
    const stateLine = document.createElement('span'); stateLine.textContent = `وضعیت: ${{pending:'در انتظار بررسی',approved:'تأیید شده',rejected:'رد شده'}[request.status] || 'نامشخص'}${request.review_note ? ` | یادداشت مدیر: ${request.review_note}` : ''}${request.rejection_reason ? ` | دلیل رد: ${request.rejection_reason}` : ''}`; text.append(stateLine);
    const receiptButton = document.createElement('button'); receiptButton.type = 'button'; receiptButton.className = 'receipt-action'; receiptButton.textContent = 'دریافت پیوند فیش';
    receiptButton.addEventListener('click', async () => {
      receiptButton.disabled = true;
      try {
        const {data:path, error} = await supabase.rpc('studio_admin_receipt', {request_id:request.id});
        if (generation !== accountGeneration) return;
        if (error) throw error;
        if (!path) { receiptButton.textContent = 'برای این درخواست فیشی ثبت نشده است'; return; }
        const signed = await supabase.storage.from('studio-payment-receipts').createSignedUrl(path, 60);
        if (generation !== accountGeneration) return;
        if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error('No receipt URL');
        const link = document.createElement('a'); link.href = signed.data.signedUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'باز کردن فیش (معتبر تا یک دقیقه)';
        text.append(link);
        receiptButton.textContent = 'دریافت دوباره پیوند فیش';
        setTimeout(() => link.remove(), 60000);
      } catch { $('#adminPurchaseStatus').textContent = 'دریافت فیش ممکن نشد؛ دوباره تلاش کنید.'; }
      finally { receiptButton.disabled = false; }
    });
    text.append(receiptButton);
    const note = document.createElement('textarea'); note.placeholder = 'یادداشت داخلی بررسی (اختیاری)'; note.maxLength=2000; note.setAttribute('aria-label','یادداشت داخلی بررسی');
    const reason = document.createElement('textarea'); reason.placeholder = 'دلیل رد (برای رد درخواست ضروری و برای کاربر قابل مشاهده)'; reason.maxLength=1000; reason.setAttribute('aria-label','دلیل رد درخواست');
    const date = document.createElement('input'); date.type = 'date';
    const nextYear = new Date(); nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1); date.value = nextYear.toISOString().slice(0, 10); date.setAttribute('aria-label', `پایان اشتراک ${request.email || 'کاربر'}`);
    const approve = document.createElement('button'); approve.type = 'button'; approve.textContent = 'تأیید و فعال‌سازی';
    const reject = document.createElement('button'); reject.type = 'button'; reject.textContent = 'رد درخواست';
    async function review(decision) {
      const expiry = decision === 'approved' && date.value ? new Date(`${date.value}T23:59:59Z`) : null;
      if (decision === 'approved' && (!expiry || Number.isNaN(expiry.getTime()) || expiry <= new Date())) { $('#adminPurchaseStatus').textContent = 'تاریخ پایان در آینده را انتخاب کنید.'; return; }
      if (decision === 'rejected' && !reason.value.trim()) { $('#adminPurchaseStatus').textContent = 'برای رد درخواست، دلیل رد را بنویسید.'; reason.focus(); return; }
      if (!window.confirm(decision === 'approved' ? 'پرداخت را بررسی کرده‌اید و می‌خواهید اشتراک را فعال کنید؟' : 'این درخواست رد شود؟')) return;
      approve.disabled = true; reject.disabled = true;
      const {error} = await supabase.rpc('studio_review_purchase_v2', {request_id:request.id,decision,target_expiry:expiry?.toISOString() || null,note:note.value.trim(),reason:reason.value.trim()});
      if (error) { report($('#adminPurchaseStatus'), error); approve.disabled = false; reject.disabled = false; }
      else await refreshAccount();
    }
    approve.addEventListener('click', () => review('approved')); reject.addEventListener('click', () => review('rejected'));
    row.append(text); if (request.status === 'pending') row.append(note,reason,date,approve,reject); host.append(row);
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
    const history = document.createElement('button'); history.type='button'; history.textContent='تاریخچه';
    history.addEventListener('click', async () => {
      history.disabled=true; const generation=accountGeneration;
      try { const {data,error}=await supabase.rpc('studio_admin_subscription_history',{target_user:row.user_id}); if (generation!==accountGeneration) return; if(error) throw error; const lines=(data||[]).map(x => `${new Date(x.changed_at).toLocaleString('fa-IR')} · ${x.previous_plan || 'بدون طرح'} ← ${x.new_plan}${x.new_expiry ? ` · پایان: ${new Date(x.new_expiry).toLocaleDateString('fa-IR')}` : ''}`); window.alert(lines.length ? lines.join('\n') : 'تاریخچه‌ای پس از فعال‌سازی این قابلیت ثبت نشده است.'); } catch { $('#adminStatus').textContent='دریافت تاریخچه ممکن نشد.'; } finally { history.disabled=false; }
    });
    actions.append(date, plus, free, history); tr.append(actions); body.append(tr);
  });
}
function catalogReviewControls(busy) {
  catalogReviewBusy=busy;
  for (const id of ['catalogReviewKind','catalogReviewSearch','catalogReviewMissing','catalogReviewItem','catalogReviewDescription','catalogReviewLevel','catalogReviewUseLatest','catalogReviewRebase','catalogReviewRefresh']) $(`#${id}`).disabled=busy;
  const item=currentReviewItem(), draft=item && catalogDrafts.get(reviewKey($('#catalogReviewKind').value,item.name));
  $('#catalogReviewSave').disabled=busy || !item || !!(draft && reviewConflict(draft,item));
}
function reviewKey(kind,name) { return JSON.stringify([kind,name]); }
function reviewConflict(draft,item) {
  return draft.conflict || draft.previous_description !== (item.description_fa ?? null) || draft.previous_level !== (item.level ?? null);
}
function clearCatalogEditor() {
  catalogEditorAdmin=false; catalogReviewControls(!!catalogSave); $('#catalogReviewItem').replaceChildren(); $('#catalogReviewDescription').value=''; $('#catalogReviewOriginal').textContent='';
  $('#catalogReviewSummary').textContent=''; $('#catalogReviewStatus').textContent=''; $('#catalogReviewDraftNotice').textContent=''; $('#catalogReviewConflict').hidden=true; $('#catalogReviewLatest').textContent=''; $('#catalogReviewSave').disabled=true;
}
function currentReviewItem() {
  if (!catalogEditorAdmin) return null;
  const kind=$('#catalogReviewKind').value, name=$('#catalogReviewItem').value;
  return window.studioCatalog?.catalog?.[kind]?.find(item => item.name===name) || null;
}
function rememberCatalogDraft(force=false) {
  const item=currentReviewItem(); if (!item) return;
  const kind=$('#catalogReviewKind').value, key=reviewKey(kind,item.name), prior=catalogDrafts.get(key);
  const description=$('#catalogReviewDescription').value, level=$('#catalogReviewLevel').value;
  if (!force && !prior && description === (item.description_fa || '') && level === (['beginner','advanced','unknown'].includes(item.level) ? item.level : 'unknown')) return;
  catalogDrafts.set(key,{description,level,previous_description:prior ? prior.previous_description : item.description_fa ?? null,previous_level:prior ? prior.previous_level : item.level ?? null,conflict:prior?.conflict || false});
  const option=$('#catalogReviewItem').selectedOptions[0]; if (option) option.textContent=`${item.name} ✎`;
  $('#catalogReviewDraftNotice').textContent='پیش‌نویس فقط در حافظهٔ همین صفحه است و با خروج، بازخوانی یا بستن صفحه از بین می‌رود؛ هنوز ذخیره نشده است.';
}
function showCatalogReviewItem() {
  const item=currentReviewItem(), kind=$('#catalogReviewKind').value;
  catalogSelection=item ? {kind,name:item.name} : null;
  const draft=item && catalogDrafts.get(reviewKey(kind,item.name));
  $('#catalogReviewDescription').value=draft ? draft.description : item?.description_fa || '';
  $('#catalogReviewLevel').value=draft ? draft.level : ['beginner','advanced','unknown'].includes(item?.level) ? item.level : 'unknown';
  $('#catalogReviewOriginal').textContent=item?.desc || '';
  const option=$('#catalogReviewItem').selectedOptions[0]; if (option) option.textContent=`${item.name} ${draft ? '✎' : item.description_fa ? '✓' : '—'}`;
  const conflict=!!(draft && reviewConflict(draft,item));
  $('#catalogReviewConflict').hidden=!conflict;
  $('#catalogReviewLatest').textContent=conflict ? `نسخهٔ ذخیره‌شده: ${item.description_fa || 'بدون توضیح'} | سطح: ${{beginner:'شروع',advanced:'پیشرفته',unknown:'ارزیابی‌نشده'}[item.level] || 'ارزیابی‌نشده'}` : '';
  $('#catalogReviewDraftNotice').textContent=draft ? 'پیش‌نویس فقط در حافظهٔ همین صفحه است و با خروج، بازخوانی یا بستن صفحه از بین می‌رود؛ هنوز ذخیره نشده است.' : '';
  catalogReviewControls(catalogReviewBusy);
}
function renderCatalogEditor(preferredName) {
  const select=$('#catalogReviewItem'), kind=$('#catalogReviewKind').value, prior=preferredName || (catalogSelection?.kind===kind ? catalogSelection.name : select.value);
  select.replaceChildren();
  if (!catalogEditorAdmin || !Array.isArray(window.studioCatalog?.catalog?.[kind])) { $('#catalogReviewSummary').textContent='کاتالوگ محافظت‌شده در دسترس نیست.'; showCatalogReviewItem(); return; }
  const items=window.studioCatalog.catalog[kind], missing=$('#catalogReviewMissing').checked;
  const q=$('#catalogReviewSearch').value.trim().toLocaleLowerCase();
  const filtered=items.filter(item=>typeof item?.name==='string' && (!missing || !String(item.description_fa || '').trim() || catalogDrafts.has(reviewKey(kind,item.name))) && (!q || `${item.name} ${item.desc || ''} ${item.description_fa || ''}`.toLocaleLowerCase().includes(q)));
  for (const item of filtered) { const option=document.createElement('option'); option.value=item.name; option.textContent=`${item.name} ${catalogDrafts.has(reviewKey(kind,item.name)) ? '✎' : item.description_fa ? '✓' : '—'}`; select.append(option); }
  if(filtered.some(item=>item.name===prior)) select.value=prior; else select.selectedIndex=filtered.length ? 0 : -1;
  const unreviewed=items.filter(item=>!String(item.description_fa || '').trim()).length;
  $('#catalogReviewSummary').textContent=`${faNumber(filtered.length)} مورد در فهرست؛ ${faNumber(unreviewed)} مورد بدون توضیح فارسی ذخیره‌شده در کاتالوگ؛ ${faNumber(catalogDrafts.size)} پیش‌نویس در این صفحه.`;
  showCatalogReviewItem();
}
$('#catalogReviewRefresh').addEventListener('click',()=>{ if (!catalogReviewBusy && user) refreshAccount(); });
$('#catalogReviewKind').addEventListener('change',()=>renderCatalogEditor());
$('#catalogReviewSearch').addEventListener('input',()=>renderCatalogEditor());
$('#catalogReviewMissing').addEventListener('change',()=>renderCatalogEditor());
$('#catalogReviewItem').addEventListener('change',showCatalogReviewItem);
$('#catalogReviewDescription').addEventListener('input',()=>rememberCatalogDraft());
$('#catalogReviewLevel').addEventListener('change',()=>rememberCatalogDraft());
$('#catalogReviewUseLatest').addEventListener('click',()=>{ const item=currentReviewItem(); if (!item || catalogReviewBusy) return; catalogDrafts.delete(reviewKey($('#catalogReviewKind').value,item.name)); showCatalogReviewItem(); $('#catalogReviewStatus').textContent='پیش‌نویس کنار گذاشته شد.'; });
$('#catalogReviewRebase').addEventListener('click',()=>{ const item=currentReviewItem(); if (!item || catalogReviewBusy) return; const draft=catalogDrafts.get(reviewKey($('#catalogReviewKind').value,item.name)); if (!draft) return; draft.previous_description=item.description_fa ?? null; draft.previous_level=item.level ?? null; draft.conflict=false; showCatalogReviewItem(); $('#catalogReviewStatus').textContent='پیش‌نویس حفظ شد؛ پیش از ذخیره، نسخهٔ تازه را بررسی کنید.'; });
$('#catalogReviewForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if (catalogReviewBusy) return;
  const item=currentReviewItem(), who=user?.id, generation=accountGeneration;
  const description=$('#catalogReviewDescription').value.trim(), level=$('#catalogReviewLevel').value, kind=$('#catalogReviewKind').value;
  if(!item || !who || !catalogEditorAdmin || !description) { $('#catalogReviewStatus').textContent='یک ابزار و توضیح فارسی معتبر انتخاب کنید.'; return; }
  rememberCatalogDraft(true);
  const key=reviewKey(kind,item.name), draft=catalogDrafts.get(key);
  if(draft && reviewConflict(draft,item)) { showCatalogReviewItem(); $('#catalogReviewStatus').textContent='ابتدا دربارهٔ نسخهٔ تازه تصمیم بگیرید.'; return; }
  const token={who}; catalogSave=token; catalogReviewControls(true); $('#catalogReviewStatus').textContent='در حال ذخیره بازبینی...';
  let refreshAfter=false;
  try {
    const result=await supabase.rpc('studio_admin_update_catalog_review',{kind,item_name:item.name,description,level,previous_description:draft ? draft.previous_description : item.description_fa ?? null,previous_level:draft ? draft.previous_level : item.level ?? null});
    if(catalogSave!==token || user?.id!==who) return;
    if(result.error) {
      if(result.error.code==='40001') {
        if(draft) draft.conflict=true;
        if(generation!==accountGeneration) { refreshAfter=true; return; }
        const fresh=await supabase.rpc('studio_premium_catalog');
        if(catalogSave!==token || user?.id!==who) return;
        if(generation!==accountGeneration) { refreshAfter=true; return; }
        if(!fresh.error && fresh.data?.[0]?.catalog && fresh.data[0].playbooks?.services) { publishCatalog(fresh.data[0]); renderCatalogEditor(item.name); $('#catalogReviewStatus').textContent='این ابزار هم‌زمان تغییر کرده است؛ پیش‌نویس شما حفظ شد. نسخهٔ تازه را بررسی کنید.'; }
        else $('#catalogReviewStatus').textContent='این ابزار تغییر کرده و دریافت نسخهٔ تازه ممکن نشد؛ با دکمهٔ دریافت دوباره تلاش کنید. پیش‌نویس را پیش از بازخوانی صفحه کپی کنید.';
      } else if(generation===accountGeneration) report($('#catalogReviewStatus'),result.error);
      return;
    }
    catalogDrafts.delete(key);
    if(generation!==accountGeneration) { refreshAfter=true; return; }
    const payload=window.studioCatalog, updated=payload.catalog[kind].map(entry=>entry.name===item.name?{...entry,description_fa:description,level}:entry);
    publishCatalog({...payload,catalog:{...payload.catalog,[kind]:updated}});
    renderCatalogEditor(item.name); $('#catalogReviewStatus').textContent='توضیح و سطح ذخیره شد؛ برای محافظت از تغییرات، پشتیبان خصوصی تازه تهیه کنید.';
  } catch { if(catalogSave===token && generation===accountGeneration && user?.id===who) $('#catalogReviewStatus').textContent='ذخیره ممکن نشد؛ اتصال را بررسی کنید.'; }
  finally { if(catalogSave===token) { catalogSave=null; catalogReviewControls(false); if(refreshAfter && user?.id===who) refreshAccount(); } }
});
$('#adminSearch').addEventListener('input', drawAdmin);
$('#adminPurchaseFilter').addEventListener('change', () => { adminPurchaseOffset=0; if (!$('#adminContent').hidden) loadAdminPurchases(accountGeneration); });
$('#adminPurchasesPrev').addEventListener('click', () => { adminPurchaseOffset=Math.max(0,adminPurchaseOffset-50); loadAdminPurchases(accountGeneration); });
$('#adminPurchasesNext').addEventListener('click', () => { adminPurchaseOffset+=50; loadAdminPurchases(accountGeneration); });
async function refreshAccount() {
  const generation = ++accountGeneration;
  clearCatalogEditor();
  $('#adminContent').hidden = true; adminRows = []; $('#adminUsers').replaceChildren(); $('#adminPurchases').replaceChildren();
  if (!user) { $('#accountReminder').textContent = ''; $('#accountExpiry').textContent = ''; resetPremium(); $('#adminStatus').textContent = 'برای بررسی دسترسی، وارد حساب خود شوید.'; $('#accountPlan').textContent = '—'; return; }
  $('#accountPlan').textContent = 'در حال بررسی...';
  const {data, error} = await supabase.rpc('studio_my_account');
  if (generation !== accountGeneration) return;
  if (error || !data?.length) { $('#accountReminder').textContent = ''; $('#accountExpiry').textContent = ''; resetPremium(); $('#accountPlan').textContent = 'وضعیت اشتراک قابل دریافت نیست.'; $('#adminStatus').textContent = 'بررسی دسترسی ممکن نشد. دوباره تلاش کنید.'; return; }
  const account = data[0];
  $('#accountPlan').textContent = account.plan === 'plus' ? 'پلاس فعال' : 'رایگان';
  $('#accountExpiry').textContent = account.plan === 'plus' && account.expires_at ? `تا ${new Date(account.expires_at).toLocaleDateString('fa-IR')}` : '';
  const remainingDays = account.plan === 'plus' && account.expires_at ? Math.ceil((new Date(account.expires_at).getTime() - Date.now()) / 86400000) : null;
  $('#accountReminder').textContent = remainingDays !== null && remainingDays > 0 && remainingDays <= 30 ? `یادآوری: ${faNumber(remainingDays)} روز تا پایان اشتراک باقی مانده است.` : '';
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
  if (!account.is_admin) { catalogDrafts.clear(); catalogSelection=null; $('#adminStatus').textContent = 'این بخش فقط برای مدیر است. اگر مدیر هنوز تعیین نشده، دسترسی فعال نیست.'; return; }
  $('#adminStatus').textContent = 'در حال دریافت حساب‌ها...';
  const result = await supabase.rpc('studio_admin_users');
  if (generation !== accountGeneration) return;
  if (result.error) { report($('#adminStatus'), result.error); return; }
  adminRows = result.data || [];
  $('#adminUserCount').textContent = faNumber(adminRows.length);
  $('#adminPlusCount').textContent = faNumber(adminRows.filter(r => r.plan === 'plus' && new Date(r.expires_at) > new Date()).length);
  $('#adminContent').hidden = false; $('#adminStatus').textContent = 'فهرست حساب‌ها آماده است.'; catalogEditorAdmin=true; renderCatalogEditor(); drawAdmin(); await loadAdminPurchases(generation);
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
async function loadProjects() {
  const request=++projectGeneration, who=user?.id, host=$('#projectList'); host.replaceChildren();
  if (!who) { $('#projectStatus').textContent='برای ذخیره پروژه وارد حساب شوید.'; return; }
  $('#projectStatus').textContent='در حال دریافت پروژه‌ها...';
  try {
    const {data,error}=await supabase.from('studio_projects').select('id,title,description,project_type,checklist,version,updated_at').order('updated_at',{ascending:false}).limit(100);
    if (request!==projectGeneration || user?.id!==who) return;
    if(error) throw error;
    $('#projectStatus').textContent=data?.length ? `${faNumber(data.length)} پروژه نمایش داده شد.` : 'هنوز پروژه‌ای ذخیره نشده است.';
    for (const project of data || []) {
      const card=document.createElement('article'); card.className='project-card';
      const title=document.createElement('h3'); title.textContent=project.title;
      const description=document.createElement('p'); description.textContent=project.description || 'بدون توضیح';
      const link=document.createElement('a'); link.href=`#/s/${encodeURIComponent(project.project_type)}`; link.textContent='باز کردن مسیر مرتبط ←';
      const list=document.createElement('ul');
      for (const [index,step] of (Array.isArray(project.checklist) ? project.checklist : []).entries()) {
        if (!step || typeof step.text!=='string') continue;
        const li=document.createElement('li'), label=document.createElement('label'), check=document.createElement('input'), text=document.createElement('span');
        check.type='checkbox'; check.checked=step.done===true; text.textContent=step.text;
        check.addEventListener('change', async () => {
          check.disabled=true; const next=project.checklist.map((s,i)=>i===index?{text:s.text,done:check.checked}:s);
          try {
            const result=await supabase.from('studio_projects').update({checklist:next,version:project.version+1,updated_at:new Date().toISOString()}).eq('id',project.id).eq('version',project.version).select('version').maybeSingle();
            if(user?.id!==who || request!==projectGeneration) return;
            if(result.error) throw result.error;
            if(!result.data) { await loadProjects(); if(user?.id===who) $('#projectStatus').textContent='پروژه در دستگاه دیگری تغییر کرده است؛ اطلاعات تازه بارگذاری شد. تغییر خود را دوباره اعمال کنید.'; return; }
            project.version=result.data.version; project.checklist=next; $('#projectStatus').textContent='پیشرفت ذخیره شد.';
          } catch { if(user?.id===who) {check.checked=!check.checked; $('#projectStatus').textContent='ذخیره پیشرفت ممکن نشد؛ اتصال را بررسی کنید.';} } finally {check.disabled=false;}
        });
        label.append(check,text);li.append(label);list.append(li);
      }
      const addStep=document.createElement('form'); addStep.className='project-add-step';
      const stepInput=document.createElement('input'); stepInput.placeholder='مرحلهٔ دلخواه'; stepInput.setAttribute('aria-label','مرحلهٔ دلخواه'); stepInput.maxLength=200; stepInput.required=true;
      const addButton=document.createElement('button'); addButton.type='submit'; addButton.className='btn btn--outline'; addButton.textContent='افزودن مرحله';
      addStep.append(stepInput,addButton);
      addStep.addEventListener('submit',async event=>{
        event.preventDefault(); const text=stepInput.value.trim();
        if(!text) { $('#projectStatus').textContent='متن مرحله را وارد کنید.'; return; }
        if(project.checklist.length>=50) { $('#projectStatus').textContent='هر پروژه حداکثر ۵۰ مرحله دارد.'; return; }
        addButton.disabled=true;
        try {
          const next=[...project.checklist,{text,done:false}];
          const result=await supabase.from('studio_projects').update({checklist:next,version:project.version+1,updated_at:new Date().toISOString()}).eq('id',project.id).eq('version',project.version).select('version').maybeSingle();
          if(user?.id!==who || request!==projectGeneration) return;
          if(result.error) throw result.error;
          if(!result.data) { await loadProjects(); if(user?.id===who) $('#projectStatus').textContent='پروژه در دستگاه دیگری تغییر کرده است؛ اطلاعات تازه بارگذاری شد. تغییر خود را دوباره اعمال کنید.'; return; }
          await loadProjects(); if(user?.id===who) $('#projectStatus').textContent='مرحله افزوده شد.';
        } catch { if(user?.id===who) $('#projectStatus').textContent='افزودن مرحله ممکن نشد؛ اتصال را بررسی کنید.'; }
        finally {addButton.disabled=false;}
      });
      const editor=document.createElement('details'); editor.className='project-editor';
      const summary=document.createElement('summary'); summary.textContent='ویرایش نام و توضیح';
      const form=document.createElement('form'); form.className='studio-form';
      const titleLabel=document.createElement('label'); titleLabel.textContent='نام پروژه';
      const titleInput=document.createElement('input'); titleInput.value=project.title; titleInput.required=true; titleInput.maxLength=120; titleLabel.append(titleInput);
      const descriptionLabel=document.createElement('label'); descriptionLabel.textContent='توضیح پروژه';
      const descriptionInput=document.createElement('textarea'); descriptionInput.value=project.description; descriptionInput.maxLength=3000; descriptionInput.rows=3; descriptionLabel.append(descriptionInput);
      const save=document.createElement('button'); save.type='submit'; save.className='btn btn--outline'; save.textContent='ذخیره تغییرات';
      form.append(titleLabel,descriptionLabel,save); editor.append(summary,form);
      form.addEventListener('submit', async event=>{
        event.preventDefault(); const nextTitle=titleInput.value.trim();
        if(!nextTitle) { $('#projectStatus').textContent='نام پروژه را وارد کنید.'; titleInput.focus(); return; }
        save.disabled=true;
        try {
          const result=await supabase.from('studio_projects').update({title:nextTitle,description:descriptionInput.value.trim(),version:project.version+1,updated_at:new Date().toISOString()}).eq('id',project.id).eq('version',project.version).select('version').maybeSingle();
          if(user?.id!==who || request!==projectGeneration) return;
          if(result.error) throw result.error;
          if(!result.data) { await loadProjects(); if(user?.id===who) $('#projectStatus').textContent='پروژه در دستگاه دیگری تغییر کرده است؛ اطلاعات تازه بارگذاری شد. تغییر خود را دوباره اعمال کنید.'; return; }
          project.version=result.data.version; project.title=nextTitle; project.description=descriptionInput.value.trim(); title.textContent=project.title; description.textContent=project.description || 'بدون توضیح'; editor.open=false; $('#projectStatus').textContent='تغییرات پروژه ذخیره شد.';
        } catch { if(user?.id===who) $('#projectStatus').textContent='ذخیره پروژه ممکن نشد؛ اتصال را بررسی کنید.'; }
        finally {save.disabled=false;}
      });
      const remove=document.createElement('button'); remove.type='button'; remove.className='btn btn--outline'; remove.textContent='حذف پروژه';
      remove.addEventListener('click',async()=>{ if(!window.confirm('این پروژه و چک‌لیست آن حذف شود؟')) return; remove.disabled=true; try {const {error}=await supabase.from('studio_projects').delete().eq('id',project.id); if(user?.id!==who) return; if(error) throw error; await loadProjects();} catch {if(user?.id===who) $('#projectStatus').textContent='حذف پروژه ممکن نشد.';} finally {remove.disabled=false;} });
      card.append(title,description,link,list,addStep,editor,remove);host.append(card);
    }
  } catch { if(request===projectGeneration && user?.id===who) $('#projectStatus').textContent='دریافت پروژه‌ها ممکن نشد؛ اتصال را بررسی کنید.'; }
}
$('#projectForm').addEventListener('submit',async event=>{
  event.preventDefault(); if(!user || !event.currentTarget.reportValidity()) return;
  const who=user.id, button=$('#projectCreate'); button.disabled=true; $('#projectStatus').textContent='در حال ذخیره پروژه...';
  try {
    const {error}=await supabase.from('studio_projects').insert({title:$('#projectTitle').value.trim(),description:$('#projectDescription').value.trim(),project_type:$('#projectType').value,checklist:Array.from(document.querySelectorAll('#projectSuggestion li'), node=>({text:node.textContent,done:false}))});
    if(user?.id!==who) return; if(error) throw error;
    $('#projectTitle').value=''; $('#projectDescription').value=''; await loadProjects();
  } catch {if(user?.id===who) $('#projectStatus').textContent='ذخیره پروژه ممکن نشد؛ اتصال و اطلاعات را بررسی کنید.';}
  finally {button.disabled=!user;}
});
$('#projectRefresh').addEventListener('click',loadProjects);
window.addEventListener('studio:projects-open',loadProjects);

function updateSession(session) {
  const previous = user?.id;
  user = session?.user || null;
  if (previous !== user?.id) { ++accountGeneration; adminPurchaseOffset=0; catalogDrafts.clear(); catalogSelection=null; catalogSave=null; clearCatalogEditor(); $('#adminContent').hidden=true; adminRows=[]; $('#adminUsers').replaceChildren(); $('#adminPurchases').replaceChildren(); resetPremium(); }
  $('#purchaseFields').disabled = !user; $('#purchaseLogin').hidden = !!user;
  $('#projectLoginNotice').hidden = !!user; $('#projectCreate').disabled = !user; $('#projectRefresh').disabled = !user;
  if (previous && previous !== user?.id) { $('#projectTitle').value=''; $('#projectDescription').value=''; }
  if (previous !== user?.id) { ++projectGeneration; $('#projectList').replaceChildren(); $('#projectStatus').textContent = user ? 'برای دیدن پروژه‌ها به این صفحه بروید.' : 'برای ذخیره پروژه وارد حساب شوید.'; if (user && location.hash.startsWith('#/projects')) loadProjects(); }
  if (previous !== user?.id) { purchaseStatus.textContent = ''; purchaseEmail.hidden = true; purchaseEmail.removeAttribute('href'); purchaseForm.reset(); loadPurchases(); }
  $('#authLoggedOut').hidden = !!user && !authBusy && !recoveryMode; $('#workspaceLoggedOut').hidden = !!user; $('#authLoggedIn').hidden = !user;
  $('#headerLogin').hidden = !!user; $('#headerAccount').hidden = !user;
  if (user && !authBusy && !recoveryMode && !gate.hidden) setGate(false);
  if (previous && !user && !intentionalSignOut) { $('#sessionNotice').textContent = 'نشست شما پایان یافته است؛ برای ادامه دوباره وارد شوید.'; }
  if (user) $('#sessionNotice').textContent = '';
  $('#accountEmail').textContent = user?.email || '';
  noteControls();
  if (previous !== user?.id) { loadNotes(); setTimeout(refreshAccount, 0); }
}
function setAuthLoading(button, busy, label) {
  button.disabled = busy; button.dataset.loading = String(busy);
  button.querySelector('span').textContent = busy ? 'در حال پردازش...' : label;
}
function authError(error) { authStatus.dataset.kind = 'error'; report(authStatus, error); }
// Keep only a known internal route across the external OAuth redirect.
const oauthRouteKey = 'studio-google-return';
function clearOAuthRoute() { try { sessionStorage.removeItem(oauthRouteKey); } catch {} }
function restoreOAuthRoute(session) {
  if (!session?.user) return;
  try {
    const route = sessionStorage.getItem(oauthRouteKey);
    if (route === '#/subscribe' || route === '#/') { sessionStorage.removeItem(oauthRouteKey); location.hash = route; }
  } catch {}
}
$('#googleSignIn').addEventListener('click', async () => {
  if (authBusy) return;
  authBusy = true; $('#googleSignIn').disabled = true; $('#loginSubmit').disabled = true; $('#signUp').disabled = true;
  authStatus.dataset.kind = ''; authStatus.textContent = 'در حال آماده‌سازی ورود با گوگل...';
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {headers:{apikey:publishableKey}});
    if (!response.ok) throw new Error('Auth settings unavailable');
    const settings = await response.json();
    if (!settings.external?.google) { authStatus.dataset.kind = 'error'; authStatus.textContent = 'ورود با گوگل هنوز فعال نشده است. فعلاً از ایمیل استفاده کنید.'; return; }
    rememberSession = $('#rememberMe').checked;
    try {
      localStorage.setItem('studio-remember-session', rememberSession ? '1' : '0');
      sessionStorage.setItem(oauthRouteKey, location.hash.startsWith('#/subscribe') ? '#/subscribe' : '#/');
    } catch {}
    authStatus.textContent = 'در حال انتقال به گوگل...';
    const {error} = await supabase.auth.signInWithOAuth({provider:'google', options:{redirectTo:location.origin + location.pathname}});
    if (error) { clearOAuthRoute(); authStatus.dataset.kind = 'error'; authStatus.textContent = 'شروع ورود با گوگل ممکن نشد؛ دوباره تلاش کنید.'; }
  } catch { clearOAuthRoute(); authStatus.dataset.kind = 'error'; authStatus.textContent = 'اتصال به سرویس ورود ممکن نشد؛ دوباره تلاش کنید.'; }
  finally { authBusy = false; $('#googleSignIn').disabled = false; $('#loginSubmit').disabled = false; $('#signUp').disabled = false; }
});
$('#authForm').addEventListener('submit', async event => {
  event.preventDefault(); if (authBusy || !event.currentTarget.reportValidity()) return;
  authBusy = true; rememberSession = $('#rememberMe').checked;
  try { localStorage.setItem('studio-remember-session', rememberSession ? '1' : '0'); } catch {}
  setAuthLoading($('#loginSubmit'), true, 'ورود به فضای کاری'); $('#signUp').disabled = true; $('#googleSignIn').disabled = true;
  authStatus.dataset.kind = ''; authStatus.textContent = 'در حال بررسی اطلاعات...';
  try {
    const {data, error} = await supabase.auth.signInWithPassword({ email: $('#authEmail').value.trim(), password: $('#authPassword').value });
    if (error) { authError(error); return; }
    if (data?.session && !user) updateSession(data.session);
    if (!user) { authStatus.dataset.kind = 'error'; authStatus.textContent = 'ورود تأیید نشد؛ دوباره تلاش کنید.'; return; }
    $('#authPassword').value = ''; $('#authLoggedOut').hidden = false; authPanel('success');
    await new Promise(resolve => setTimeout(resolve, window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 0 : 700));
    setGate(false); $('#authLoggedOut').hidden = true;
    if (!location.hash.startsWith('#/subscribe')) location.hash = '#/';
  } catch { authStatus.dataset.kind = 'error'; authStatus.textContent = 'اتصال برقرار نشد؛ دوباره تلاش کنید.'; }
  finally { authBusy = false; setAuthLoading($('#loginSubmit'), false, 'ورود به فضای کاری'); $('#signUp').disabled = false; $('#googleSignIn').disabled = false; }
});
$('#signUp').addEventListener('click', async () => {
  if (authBusy || !$('#authForm').reportValidity()) return;
  authBusy = true; rememberSession = $('#rememberMe').checked;
  try { localStorage.setItem('studio-remember-session', rememberSession ? '1' : '0'); } catch {}
  $('#signUp').disabled = true; $('#loginSubmit').disabled = true; $('#googleSignIn').disabled = true;
  authStatus.dataset.kind = ''; authStatus.textContent = 'در حال ساخت حساب رایگان...';
  try {
    const { data, error } = await supabase.auth.signUp({ email: $('#authEmail').value.trim(), password: $('#authPassword').value, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) authError(error); else { $('#authPassword').value = ''; authStatus.textContent = data.session ? 'حساب ساخته شد.' : 'برای تأیید حساب، ایمیل خود را بررسی کنید.'; if (data.session) { updateSession(data.session); setGate(false); } }
  } catch { authStatus.dataset.kind = 'error'; authStatus.textContent = 'اتصال برقرار نشد؛ دوباره تلاش کنید.'; }
  finally { authBusy = false; $('#signUp').disabled = false; $('#loginSubmit').disabled = false; $('#googleSignIn').disabled = false; }
});
$('#forgotForm').addEventListener('submit', async event => {
  event.preventDefault(); if (authBusy || !event.currentTarget.reportValidity()) return;
  authBusy = true; setAuthLoading($('#recoverySubmit'), true, 'ارسال لینک بازیابی');
  try {
    const {error} = await supabase.auth.resetPasswordForEmail($('#recoveryEmail').value.trim(), {redirectTo: location.origin + location.pathname});
    if (error) { authStatus.dataset.kind = 'error'; authStatus.textContent = 'درخواست بازیابی ارسال نشد؛ اتصال را بررسی کنید و بعداً دوباره تلاش کنید.'; }
    else { authStatus.dataset.kind = ''; authStatus.textContent = 'اگر حسابی با این ایمیل وجود داشته باشد، راهنمای بازیابی برای آن ارسال می‌شود.'; }
  } catch { authStatus.dataset.kind = 'error'; authStatus.textContent = 'درخواست بازیابی ارسال نشد؛ بعداً دوباره تلاش کنید.'; }
  finally { authBusy = false; setAuthLoading($('#recoverySubmit'), false, 'ارسال لینک بازیابی'); }
});
$('#resetForm').addEventListener('submit', async event => {
  event.preventDefault(); if (authBusy || !recoveryMode || !event.currentTarget.reportValidity()) return;
  if ($('#newPassword').value !== $('#confirmPassword').value) { authStatus.dataset.kind = 'error'; authStatus.textContent = 'رمزهای عبور یکسان نیستند.'; return; }
  authBusy = true; setAuthLoading($('#resetSubmit'), true, 'ذخیره رمز جدید');
  try {
    const {error} = await supabase.auth.updateUser({password:$('#newPassword').value});
    if (error) { authStatus.dataset.kind = 'error'; authStatus.textContent = 'تغییر رمز ممکن نشد؛ ممکن است لینک منقضی شده باشد.'; }
    else { $('#resetForm').reset(); recoveryMode = false; setGate(false); $('#sessionNotice').textContent = 'رمز عبور با موفقیت تغییر کرد.'; }
  } catch { authStatus.dataset.kind = 'error'; authStatus.textContent = 'تغییر رمز ممکن نشد؛ دوباره تلاش کنید.'; }
  finally { authBusy = false; setAuthLoading($('#resetSubmit'), false, 'ذخیره رمز جدید'); }
});
$('#signOut').addEventListener('click', async () => { if (catalogDrafts.size && !window.confirm('پیش‌نویس‌های ذخیره‌نشده با خروج از بین می‌روند. خارج شوید؟')) return; intentionalSignOut = true; try { const { error } = await supabase.auth.signOut(); if (error) report(authStatus, error); else { updateSession(null); setGate(false); location.hash = '#/'; $('#sessionNotice').textContent = 'از حساب خارج شدید.'; } } finally { intentionalSignOut = false; } });
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
window.addEventListener('beforeunload', event => { if (user && catalogDrafts.size) { event.preventDefault(); event.returnValue=''; } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && user) refreshAccount(); });
refreshAccount();
let authEventGeneration = 0;
supabase.auth.onAuthStateChange((event, session) => { authEventGeneration++; if (event === 'PASSWORD_RECOVERY') { recoveryMode = true; updateSession(session); $('#authLoggedOut').hidden = false; authPanel('reset'); setGate(true); } else { updateSession(session); restoreOAuthRoute(session); } });
const initialAuthGeneration = authEventGeneration;
supabase.auth.getSession().then(({ data, error }) => { if (initialAuthGeneration !== authEventGeneration) return; if (error) { $('#sessionNotice').textContent = 'دریافت وضعیت حساب ممکن نشد.'; } else { updateSession(data.session); restoreOAuthRoute(data.session); } }).catch(() => { $('#sessionNotice').textContent = 'اتصال به حساب ممکن نشد؛ دسترسی مهمان فعال است.'; });
if (authCallbackError) { let googleCallback = false; try { googleCallback = !!sessionStorage.getItem(oauthRouteKey); } catch {} clearOAuthRoute(); openLogin(); if (googleCallback) { authStatus.dataset.kind = 'error'; authStatus.textContent = 'ورود با گوگل تکمیل نشد؛ دوباره تلاش کنید.'; } else { authPanel('forgot'); authStatus.dataset.kind = 'error'; authStatus.textContent = 'لینک ورود یا بازیابی نامعتبر یا منقضی شده است. می‌توانید لینک تازه درخواست کنید.'; setTimeout(() => { if (!gate.hidden && !$('#authForgotPanel').hidden) $('#recoveryEmail').focus(); }, 0); } }
