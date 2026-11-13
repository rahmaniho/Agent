import { createClient } from '@supabase/supabase-js';

// Publishable key, intentionally public. Access to data is controlled by RLS.
const supabase = createClient('https://asxyjxxgpfsgfmabqqdw.supabase.co', 'sb_publishable_djAPhLTPBob4-C1pcbN_OA__vFHmeif');
const $ = (s) => document.querySelector(s);
const authStatus = $('#authStatus'), noteStatus = $('#noteStatus');
const PAGE_SIZE = 25;
let user = null, loadingNotes = 0, offset = 0, saving = false;
const report = (el, error) => { el.textContent = error?.message || String(error); };
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
  $('#authLoggedOut').hidden = !!user; $('#authLoggedIn').hidden = !user;
  $('#accountEmail').textContent = user?.email || '';
  noteControls();
  if (previous !== user?.id) loadNotes();
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
$('#signOut').addEventListener('click', async () => { const { error } = await supabase.auth.signOut(); if (error) report(authStatus, error); else authStatus.textContent = 'از حساب خارج شدید.'; });
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
supabase.auth.onAuthStateChange((_event, session) => { updateSession(session); });
supabase.auth.getSession().then(({ data, error }) => { if (error) report(authStatus, error); else updateSession(data.session); });
