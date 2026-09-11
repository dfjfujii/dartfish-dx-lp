// Dedicated to this LP; do not send form values or personal data to Analytics.
(() => {
  const track = (name, params) => {
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, {content_group: 'club_analysis', ...params});
    }
  };
  document.querySelectorAll('.club-updates-links a').forEach(link => {
    link.addEventListener('click', () => track('official_link_click', {
      channel: link.dataset.channel, link_url: link.href
    }));
  });
  document.querySelectorAll('a[href="#contact"]').forEach(link => {
    link.addEventListener('click', () => track('contact_cta_click', {
      link_text: link.textContent.trim()
    }));
  });
  document.querySelectorAll('video').forEach(video => {
    let started = false;
    const title = video.getAttribute('aria-label') || '分析動画';
    video.addEventListener('play', () => {
      if (!started) { started = true; track('video_start', {video_title: title}); }
    });
    video.addEventListener('ended', () => track('video_complete', {video_title: title}));
  });
})();
