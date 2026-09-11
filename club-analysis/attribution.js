// Fixed campaign labels only; never store or send personal/form data to Analytics.
(() => {
  const key = 'dartfish_club_entry';
  const params = new URLSearchParams(location.search);
  const qr = location.pathname === '/club-analysis/qr/' ||
    (params.get('utm_medium') === 'qr' && params.get('utm_campaign') === 'tokyo_club');
  let entry = 'web';
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (saved?.source === 'qr' && Date.now() - saved.time < 30 * 60 * 1000) entry = 'qr';
    if (params.has('utm_source') && !qr) entry = 'web';
  } catch (_) { /* Storage may be disabled. */ }
  if (qr) entry = 'qr';
  try { sessionStorage.setItem(key, JSON.stringify({source: entry, time: Date.now()})); } catch (_) {}
  window.clubEntrySource = entry;
  if (typeof window.gtag === 'function') {
    window.gtag('set', {content_group: 'club_analysis', entry_source: entry});
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('#contact-form')?.addEventListener('formdata', event => {
      // Reuse the existing validated field and Teams/email delivery without changing the shared API.
      event.formData.append('use_cases', entry === 'qr'
        ? '流入元：部活動LP・QR経由（tokyo_club）' : '流入元：部活動LP・通常WEB');
    });
  });
})();
