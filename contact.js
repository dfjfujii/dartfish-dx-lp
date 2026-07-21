const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: JSON_HEADERS
});

const clean = (value, max = 3000) => String(value || '').replace(/\0/g, '').trim().slice(0, max);
const escapeHtml = (value) => clean(value).replace(/[&<>"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
}[char]));

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(value) && value.length <= 254;
const getAll = (form, key) => form.getAll(key).map((value) => clean(value, 100)).filter(Boolean);

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyTurnstile({ token, secret, ip }) {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  body.append('idempotency_key', crypto.randomUUID());

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body
  });
  if (!response.ok) return { success: false };
  return response.json();
}

async function applyRateLimit(env, ip, fingerprint) {
  if (!env.CONTACT_RATE_LIMIT_KV) {
    throw new Error('CONTACT_RATE_LIMIT_KV binding is missing');
  }

  const now = Date.now();
  const tenMinuteBucket = Math.floor(now / 600000);
  const ipHash = await sha256(ip || 'unknown');
  const rateKey = `rate:${ipHash}:${tenMinuteBucket}`;
  const duplicateKey = `duplicate:${fingerprint}`;
  const current = Number(await env.CONTACT_RATE_LIMIT_KV.get(rateKey) || 0);

  if (current >= 3) return { allowed: false, reason: 'rate' };
  if (await env.CONTACT_RATE_LIMIT_KV.get(duplicateKey)) return { allowed: false, reason: 'duplicate' };

  await env.CONTACT_RATE_LIMIT_KV.put(rateKey, String(current + 1), { expirationTtl: 660 });
  return { allowed: true, duplicateKey };
}

async function signRelayRequest(secret, timestamp, body) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${body}`)
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sendEmail(env, payload, idempotencyKey) {
  const endpoint = new URL(env.HETEML_MAIL_RELAY_URL);
  const allowedHosts = new Set(['dartfish.co.jp', 'www.dartfish.co.jp']);
  if (endpoint.protocol !== 'https:' || !allowedHosts.has(endpoint.hostname)) {
    throw new Error('Mail relay URL is not allowed');
  }

  const body = JSON.stringify({ ...payload, message_id: idempotencyKey });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signRelayRequest(env.HETEML_MAIL_RELAY_SECRET, timestamp, body);
  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Dartfish-Timestamp': timestamp,
      'X-Dartfish-Signature': signature
    },
    body
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Mail relay error ${response.status}: ${detail.slice(0, 300)}`);
  }
  const result = await response.json();
  if (!result.ok) throw new Error('Mail relay rejected the message');
  return result;
}

async function sendTeamsNotification(env, payload) {
  const webhookUrl = clean(env.TEAMS_WEBHOOK_URL, 2048);
  if (!webhookUrl) return { skipped: true };

  const endpoint = new URL(webhookUrl);
  if (endpoint.protocol !== 'https:') {
    throw new Error('Teams webhook URL must use HTTPS');
  }

  const teamsPayload = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.2',
          body: [
            {
              type: 'TextBlock',
              size: 'Large',
              weight: 'Bolder',
              color: 'Accent',
              text: '教育・学校向けLPからのお問い合わせ',
              wrap: true
            },
            {
              type: 'FactSet',
              facts: [
                { title: '学校・団体名', value: payload.organization },
                { title: '氏名', value: payload.name },
                { title: '所属・役職', value: payload.role || '未入力' },
                { title: 'メール', value: payload.email },
                { title: '電話番号', value: payload.phone || '未入力' },
                { title: 'ご希望', value: payload.selectedRequests },
                { title: '活用分野', value: payload.selectedUses }
              ]
            },
            {
              type: 'TextBlock',
              weight: 'Bolder',
              text: 'お問い合わせ内容',
              spacing: 'Medium',
              wrap: true
            },
            {
              type: 'TextBlock',
              text: payload.message,
              wrap: true
            }
          ]
        }
      }
    ]
  };

  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(teamsPayload)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Teams webhook error ${response.status}: ${detail.slice(0, 300)}`);
  }

  return { ok: true };
}

export async function onRequestGet({ env }) {
  if (!env.TURNSTILE_SITE_KEY) return json({ message: 'フォーム設定が完了していません。' }, 503);
  return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY });
}

export async function onRequestPost({ request, env }) {
  const requiredSettings = [
    'TURNSTILE_SECRET_KEY',
    'HETEML_MAIL_RELAY_URL',
    'HETEML_MAIL_RELAY_SECRET',
    'CONTACT_TO_EMAIL',
    'CONTACT_FROM_EMAIL',
    'CONTACT_FROM_NAME'
  ];
  if (requiredSettings.some((key) => !env[key]) || !env.CONTACT_RATE_LIMIT_KV) {
    console.error('Contact form environment variables or KV binding are missing');
    return json({ message: '現在フォームをご利用いただけません。時間をおいてお試しください。' }, 503);
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data') && !contentType.includes('application/x-www-form-urlencoded')) {
    return json({ message: '不正な送信形式です。' }, 415);
  }

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return json({ message: '入力内容を読み取れませんでした。' }, 400);
  }

  // Honeypot: bots commonly fill every field. Return a neutral success response.
  if (clean(form.get('company_website'), 200)) return json({ ok: true, redirect: '/thanks.html' });

  const startedAt = Number(form.get('form_started_at'));
  const elapsed = Date.now() - startedAt;
  if (!Number.isFinite(startedAt) || elapsed < 3000 || elapsed > 2 * 60 * 60 * 1000) {
    return json({ message: '送信までの時間が短すぎるか、ページの有効時間が切れています。ページを再読み込みしてください。' }, 400);
  }

  const organization = clean(form.get('organization'), 120);
  const name = clean(form.get('name'), 80);
  const role = clean(form.get('role'), 100);
  const email = clean(form.get('email'), 254).toLowerCase();
  const phone = clean(form.get('phone'), 30);
  const message = clean(form.get('message'), 3000);
  const requestTypes = getAll(form, 'request_types');
  const useCases = getAll(form, 'use_cases');
  const consent = form.get('privacy_consent') === '同意する';
  const turnstileToken = clean(form.get('cf-turnstile-response'), 2048);

  if (!organization || !name || !validEmail(email) || !message || !requestTypes.length || !consent) {
    return json({ message: '必須項目を確認してください。' }, 400);
  }

  const combinedText = `${organization}\n${name}\n${role}\n${email}\n${phone}\n${message}`;
  const urls = combinedText.match(/(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|biz|info|xyz|jp)(?:\/|\b))/giu) || [];
  if (urls.length > 2) return json({ message: 'URLを多く含む内容は送信できません。URLを2件以下にしてください。' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const turnstile = await verifyTurnstile({ token: turnstileToken, secret: env.TURNSTILE_SECRET_KEY, ip });
  if (!turnstile.success || (turnstile.action && turnstile.action !== 'education_contact')) {
    return json({ message: '安全確認に失敗しました。もう一度お試しください。' }, 400);
  }

  const fingerprint = await sha256(`${email}|${organization}|${message}`);
  let limit;
  try {
    limit = await applyRateLimit(env, ip, fingerprint);
  } catch (error) {
    console.error(error.message);
    return json({ message: '現在フォームをご利用いただけません。時間をおいてお試しください。' }, 503);
  }
  if (!limit.allowed) {
    const text = limit.reason === 'duplicate'
      ? '同じ内容はすでに受け付けています。担当者からの連絡をお待ちください。'
      : '短時間に複数回の送信がありました。10分ほど待ってからお試しください。';
    return json({ message: text }, 429);
  }

  const toEmail = clean(env.CONTACT_TO_EMAIL, 254);
  const fromEmail = clean(env.CONTACT_FROM_EMAIL, 254);
  const fromName = clean(env.CONTACT_FROM_NAME, 100);
  const selectedRequests = requestTypes.join('・');
  const selectedUses = useCases.length ? useCases.join('・') : '未選択';
  const subject = `【教育・学校向けLP】${selectedRequests}／${organization}`.slice(0, 180);
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');
  const safeOrganization = escapeHtml(organization);
  const safeName = escapeHtml(name);

  const adminHtml = `
    <h2>教育・学校向けLPからのお問い合わせ</h2>
    <table style="border-collapse:collapse;width:100%;max-width:720px">
      <tr><th style="text-align:left;padding:8px;border:1px solid #ddd">学校・団体名</th><td style="padding:8px;border:1px solid #ddd">${safeOrganization}</td></tr>
      <tr><th style="text-align:left;padding:8px;border:1px solid #ddd">氏名</th><td style="padding:8px;border:1px solid #ddd">${safeName}</td></tr>
      <tr><th style="text-align:left;padding:8px;border:1px solid #ddd">所属・役職</th><td style="padding:8px;border:1px solid #ddd">${escapeHtml(role) || '未入力'}</td></tr>
      <tr><th style="text-align:left;padding:8px;border:1px solid #ddd">メール</th><td style="padding:8px;border:1px solid #ddd">${escapeHtml(email)}</td></tr>
      <tr><th style="text-align:left;padding:8px;border:1px solid #ddd">電話番号</th><td style="padding:8px;border:1px solid #ddd">${escapeHtml(phone) || '未入力'}</td></tr>
      <tr><th style="text-align:left;padding:8px;border:1px solid #ddd">ご希望</th><td style="padding:8px;border:1px solid #ddd">${escapeHtml(selectedRequests)}</td></tr>
      <tr><th style="text-align:left;padding:8px;border:1px solid #ddd">活用分野</th><td style="padding:8px;border:1px solid #ddd">${escapeHtml(selectedUses)}</td></tr>
      <tr><th style="text-align:left;padding:8px;border:1px solid #ddd">内容</th><td style="padding:8px;border:1px solid #ddd">${safeMessage}</td></tr>
    </table>`;

  const idPrefix = `contact-${fingerprint.slice(0, 32)}`;

  try {
    await sendEmail(env, {
      message_type: 'admin',
      from_email: fromEmail,
      from_name: fromName,
      to_email: toEmail,
      reply_to: email,
      subject,
      html: adminHtml
    }, `${idPrefix}-admin`);

    try {
      await sendTeamsNotification(env, {
        organization,
        name,
        role,
        email,
        phone,
        selectedRequests,
        selectedUses,
        message
      });
    } catch (teamsError) {
      console.error('Teams notification failed', teamsError.message);
    }

    await env.CONTACT_RATE_LIMIT_KV.put(limit.duplicateKey, 'sent', { expirationTtl: 3600 });
  } catch (error) {
    console.error('Admin notification failed', error.message);
    return json({ message: '送信処理で問題が発生しました。時間をおいて再度お試しください。' }, 502);
  }

  return json({ ok: true, redirect: '/thanks.html' });
}
