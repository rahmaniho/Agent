import { createClient } from '@supabase/supabase-js';

// Publishable key, intentionally public. Access to data is controlled by RLS.
const supabase = createClient('https://asxyjxxgpfsgfmabqqdw.supabase.co', 'sb_publishable_djAPhLTPBob4-C1pcbN_OA__vFHmeif');
const $ = (s) => document.querySelector(s);
const authStatus = $('#authStatus');
const noteStatus = $('#noteStatus');
let user = null;
let loadingNotes = 0;
const report = (el, error) => { el.textContent = error?.message || String(error); };

async function loadNotes() {
  const request = ++loadingNotes;
  $('#notesList').replaceChildren();
  if (!user) { noteStatus.textContent = 'برای مشاهده و ذخیره یادداشت وارد شوید.'; return; }
  noteStatus.textContent = 'در حال دریافت یادداشت‌ها...';
  const { data, error } = await supabase.from('workspace_notes').select('id,content,created_at').order('created_at', { ascending: false }).limit(100);
  if (request !== loadingNotes) return;
  if (error) return report(noteStatus, error);
  noteStatus.textContent = data.length ? `${data.length.toLocaleString('fa-IR')} یادداشت` : 'هنوز یادداشتی ندارید.';
  data.forEach((note) => {
    const li = document.createElement('li');
    const text = document.createElement('p'); text.textContent = note.content;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'حذف'; button.setAttribute('aria-label', 'حذف یادداشت');
    button.addEventListener('click', async () => {
      button.disabled = true;
      const { error } = await supabase.from('workspace_notes').delete().eq('id', note.id);
      if (error) { report(noteStatus, error); button.disabled = false; } else await loadNotes();
    });
    li.append(text, button); $('#notesList').append(li);
  });
}
function updateSession(session) {
  const previous = user?.id;
  user = session?.user || null;
  $('#authLoggedOut').hidden = !!user; $('#authLoggedIn').hidden = !user;
  $('#accountEmail').textContent = user?.email || '';
  if (previous !== user?.id) loadNotes();
}
$('#authForm').addEventListener('submit', async (event) => {
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
$('#signOut').addEventListener('click', async () => { const { error } = await supabase.auth.signOut(); if (error) report(authStatus, error); else authStatus.textContent = 'از حساب خارج شدید.'; });
$('#noteForm').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!user) { noteStatus.textContent = 'ابتدا وارد حساب شوید.'; return; }
  const content = $('#noteContent').value.trim(); if (!content) return;
  const button = event.submitter; if (button) button.disabled = true;
  const { error } = await supabase.from('workspace_notes').insert({ content });
  if (button) button.disabled = false;
  if (error) report(noteStatus, error); else { $('#noteContent').value = ''; await loadNotes(); }
});
supabase.auth.onAuthStateChange((_event, session) => { updateSession(session); });
supabase.auth.getSession().then(({ data, error }) => { if (error) report(authStatus, error); else updateSession(data.session); });
