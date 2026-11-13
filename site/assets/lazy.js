/* Load integrations only when needed, or when Supabase returns an auth callback. */
let workspace, agent;
function loadIntegrations() {
  const route = location.hash.replace(/^#\/?/, '').split('/')[0];
  const authCallback = /(?:^|[&#])(access_token|refresh_token|error_description)=/.test(location.hash) || new URLSearchParams(location.search).has('code');
  if (!workspace) {
    workspace = import('./workspace.js').then(() => {
      const status = document.querySelector('#authStatus');
      if (status.textContent === 'در حال آماده‌سازی فضای شخصی...') status.textContent = '';
    }).catch(() => {
      workspace = null;
      const gate = document.querySelector('#loginGate');
      document.querySelector('#sessionNotice').textContent = 'بارگذاری حساب ممکن نشد؛ صفحه را دوباره بارگذاری کنید.';
      for (const selector of ['#headerLogin', '#openLogin', '#purchaseOpenLogin', '#projectLogin']) document.querySelector(selector).addEventListener('click', () => { gate.hidden = false; document.body.classList.add('login-open'); document.querySelector('#authStatus').textContent = 'بارگذاری حساب ممکن نشد؛ صفحه را دوباره بارگذاری کنید.'; }, {once:true});
      document.querySelector('#guestAccess').addEventListener('click', () => { document.querySelector('#loginGate').hidden = true; document.body.classList.remove('login-open'); for (const node of document.body.children) node.inert = false; }, {once: true});
    });
  }
  if (route === 'fcc' && window.studioCatalog && !agent) {
    agent = import('./agent.js').catch(() => {
      agent = null;
      document.querySelector('#agentStatus').textContent = 'بارگذاری بخش ایجنت ناموفق بود؛ صفحه را دوباره بارگذاری کنید.';
    });
  }
}
window.addEventListener('hashchange', loadIntegrations);
window.addEventListener('studio:catalog', loadIntegrations);
loadIntegrations();
