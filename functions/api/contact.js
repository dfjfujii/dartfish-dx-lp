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

async function sendEmail(env, payload, idempotencyKey) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Email API error ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

export async function onRequestGet({ env }) {
  if (!env.TURNSTILE_SITE_KEY) return json({ message: 'フォーム設定が完了していません。' }, 503);
  return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY });
}

export async function onRequestPost({ request, env }) {
  const requiredSettings = [
    'TURNSTILE_SECRET_KEY',
    'RESEND_API_KEY',
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
      ? '同じ内容はすでに受け付けています。受付確認メールをご確認ください。'
      : '短時間に複数回の送信がありました。10分ほど待ってからお試しください。';
    return json({ message: text }, 429);
  }

  const toEmail = clean(env.CONTACT_TO_EMAIL, 254);
  const fromEmail = clean(env.CONTACT_FROM_EMAIL, 254);
  const fromName = clean(env.CONTACT_FROM_NAME, 100);
  const replyTo = clean(env.CONTACT_REPLY_TO_EMAIL || toEmail, 254);
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

  const autoReplyHtml = `
    <p>${safeName} 様</p>
    <p>このたびは、ダートフィッシュ・ジャパンへお問い合わせいただき、ありがとうございます。</p>
    <p>以下の内容で受け付けました。担当者が確認し、通常2営業日以内を目安にご連絡します。</p>
    <hr>
    <p><strong>学校・団体名：</strong>${safeOrganization}<br>
    <strong>ご希望の内容：</strong>${escapeHtml(selectedRequests)}<br>
    <strong>検討している活用分野：</strong>${escapeHtml(selectedUses)}</p>
    <p><strong>お問い合わせ内容</strong><br>${safeMessage}</p>
    <hr>
    <p>${escapeHtml(fromName)}</p>
    <p style="font-size:12px;color:#667085">このメールは自動送信です。お心当たりがない場合は、このメールへ返信してお知らせください。</p>`;

  const from = `${fromName} <${fromEmail}>`;
  const idPrefix = `contact-${fingerprint.slice(0, 32)}`;

  try {
    await sendEmail(env, {
      from,
      to: [toEmail],
      reply_to: email,
      subject,
      html: adminHtml
    }, `${idPrefix}-admin`);

    await env.CONTACT_RATE_LIMIT_KV.put(limit.duplicateKey, 'sent', { expirationTtl: 3600 });
  } catch (error) {
    console.error('Admin notification failed', error.message);
    return json({ message: '送信処理で問題が発生しました。時間をおいて再度お試しください。' }, 502);
  }

  try {
    await sendEmail(env, {
      from,
      to: [email],
      reply_to: replyTo,
      subject: '【ダートフィッシュ・ジャパン】お問い合わせを受け付けました',
      html: autoReplyHtml
    }, `${idPrefix}-reply`);
  } catch (error) {
    // The inquiry is already safely delivered to the administrator.
    console.error('Auto reply failed', error.message);
  }

  return json({ ok: true, redirect: '/thanks.html' });
}
