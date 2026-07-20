(() => {
  const menuButton = document.querySelector('.menu-button');
  const nav = document.querySelector('.global-nav');

  if (menuButton && nav) {
    menuButton.addEventListener('click', () => {
      const open = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', String(!open));
      nav.classList.toggle('is-open', !open);
    });

    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        menuButton.setAttribute('aria-expanded', 'false');
        nav.classList.remove('is-open');
      });
    });
  }

  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries, io) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -35px' });
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  document.querySelectorAll('.faq-item').forEach((item) => {
    item.addEventListener('toggle', () => {
      if (!item.open) return;
      document.querySelectorAll('.faq-item[open]').forEach((other) => {
        if (other !== item) other.removeAttribute('open');
      });
    });
  });

  const contactForm = document.querySelector('#contact-form');
  if (contactForm) {
    const status = document.querySelector('#form-status');
    const submitButton = contactForm.querySelector('.form-submit');
    const submitLabel = submitButton.querySelector('.submit-label');
    const submitProgress = submitButton.querySelector('.submit-progress');
    const startedAt = document.querySelector('#form-started-at');
    const message = contactForm.elements.message;
    let turnstileWidgetId;

    startedAt.value = String(Date.now());

    const showStatus = (text, type = 'error') => {
      status.textContent = text;
      status.className = `form-status is-${type}`;
      status.hidden = false;
      status.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const setSending = (sending) => {
      submitButton.disabled = sending;
      submitLabel.hidden = sending;
      submitProgress.hidden = !sending;
    };

    const renderTurnstile = async () => {
      try {
        const response = await fetch('/api/contact', { headers: { Accept: 'application/json' } });
        const config = await response.json();
        if (!response.ok || !config.turnstileSiteKey) throw new Error('config');

        const waitForTurnstile = () => new Promise((resolve, reject) => {
          let tries = 0;
          const timer = setInterval(() => {
            if (window.turnstile) {
              clearInterval(timer);
              resolve();
            } else if (++tries > 50) {
              clearInterval(timer);
              reject(new Error('turnstile'));
            }
          }, 100);
        });

        await waitForTurnstile();
        turnstileWidgetId = window.turnstile.render('#turnstile-widget', {
          sitekey: config.turnstileSiteKey,
          theme: 'light',
          language: 'ja',
          action: 'education_contact'
        });
      } catch (_) {
        showStatus('安全確認機能を読み込めませんでした。ページを再読み込みしてください。');
        submitButton.disabled = true;
      }
    };

    message.addEventListener('input', () => {
      const counter = contactForm.querySelector('[data-count-for="message"]');
      counter.textContent = `${message.value.length} / 3000`;
    });

    contactForm.querySelectorAll('input, textarea').forEach((field) => {
      field.addEventListener('input', () => field.removeAttribute('aria-invalid'));
      field.addEventListener('change', () => field.removeAttribute('aria-invalid'));
    });

    contactForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      status.hidden = true;
      contactForm.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));
      contactForm.querySelectorAll('.is-invalid').forEach((field) => field.classList.remove('is-invalid'));

      if (!contactForm.checkValidity()) {
        contactForm.querySelectorAll(':invalid').forEach((field) => field.setAttribute('aria-invalid', 'true'));
        showStatus('必須項目を確認してください。');
        return;
      }

      const requestGroup = contactForm.querySelector('[data-required-group="request_types"]');
      if (!contactForm.querySelector('input[name="request_types"]:checked')) {
        requestGroup.classList.add('is-invalid');
        showStatus('「ご希望の内容」を1つ以上選択してください。');
        return;
      }

      const turnstileToken = contactForm.querySelector('[name="cf-turnstile-response"]')?.value;
      if (!turnstileToken) {
        showStatus('安全確認が完了していません。少し待ってからもう一度お試しください。');
        return;
      }

      setSending(true);
      try {
        const response = await fetch(contactForm.action, {
          method: 'POST',
          body: new FormData(contactForm),
          headers: { Accept: 'application/json' }
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || '送信できませんでした。時間をおいて再度お試しください。');
        window.location.assign(result.redirect || '/thanks.html');
      } catch (error) {
        showStatus(error.message);
        if (window.turnstile && turnstileWidgetId !== undefined) window.turnstile.reset(turnstileWidgetId);
        startedAt.value = String(Date.now());
      } finally {
        setSending(false);
      }
    });

    renderTurnstile();
  }
})();
