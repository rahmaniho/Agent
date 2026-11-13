/* Load integrations only when needed, or when Supabase returns an auth callback. */
let workspace, agent;
function loadIntegrations() {
  const route = location.hash.replace(/^#\/?/, '').split('/')[0];
  const authCallback = /(?:^|[&#])(access_token|refresh_token|error_description)=/.test(location.hash) || new URLSearchParams(location.search).has('code');
  if ((route === 'workspace' || authCallback) && !workspace) {
    workspace = import('./workspace.js').then(() => {
      const status = document.querySelector('#authStatus');
      if (status.textContent === 'در حال آماده‌سازی فضای شخصی...') status.textContent = '';
    }).catch(() => {
      workspace = null;
      document.querySelector('#authStatus').textContent = 'بارگذاری فضای شخصی ناموفق بود؛ اتصال را بررسی و صفحه را دوباره بارگذاری کنید.';
    });
  }
  if (route === 'fcc' && !agent) {
    agent = import('./agent.js').catch(() => {
      agent = null;
      document.querySelector('#agentStatus').textContent = 'بارگذاری بخش ایجنت ناموفق بود؛ صفحه را دوباره بارگذاری کنید.';
    });
  }
}
window.addEventListener('hashchange', loadIntegrations);
loadIntegrations();
