// Admin: email, SMS and online-payment connection status with a real test send
import { sb } from '../supabase.js';
import { CONFIG } from '../config.js';
import { callFunction } from '../api.js';
import { $, esc, icon, toast, fail, setBusy, badge, loadingBlock } from '../ui.js';

export async function settingsView(view, ctx) {
  view.innerHTML = loadingBlock();
  let status = null, err = null;
  try { status = await callFunction('notify-external', { check: true }); } catch (e) { err = e; }
  const base = CONFIG.SUPABASE_URL.replace(/\/$/, '');
  const row = (name, on, text) => `<div class="list-item"><div><b>${name}</b><small>${text}</small></div>${badge(on ? 'connected' : 'not set up', on ? 'ok' : 'muted')}</div>`;
  view.innerHTML = `<div class="page-head"><div><h2>Email, SMS and online payments</h2><p class="muted">Check that the optional services are connected and send yourself a real test message.</p></div></div>
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h3>Notification channels</h3></div>
        ${err ? `<div class="msg err show">The notification function is not deployed yet, so email and SMS are off. In-app notifications still work. (${esc(err.message)})</div>` : `<div class="list">
          ${row('In-app notifications', true, 'Always on. Shown in the bell at the top of every portal.')}
          ${row('Email (Resend)', status.email, status.email ? 'Messages are also emailed to users who have an email address.' : 'Add the RESEND_API_KEY secret to turn on.')}
          ${row('SMS (Twilio)', status.sms, status.sms ? 'Messages are also texted to users who have a phone number.' : 'Add the TWILIO_* secrets to turn on.')}</div>`}
        ${CONFIG.EXTERNAL_NOTIFICATIONS ? '' : `<div class="msg info show" style="margin-top:12px">The website is set to send in-app notifications only. Set <code>EXTERNAL_NOTIFICATIONS: true</code> in <code>js/config.js</code> to also send email and SMS.</div>`}
        <h4 style="margin:18px 0 8px">Send yourself a test</h4>
        <p class="muted" style="font-size:13px">Goes to <b>${esc(ctx.profile.email || 'your email')}</b>${ctx.profile.phone ? ` and <b>${esc(ctx.profile.phone)}</b>` : ' (add a phone number in My profile to test SMS)'}.</p>
        <p style="margin-top:10px"><button class="btn primary" id="st-test" ${err ? 'disabled' : ''}>${icon('send', 16)} Send test message</button></p><div id="st-res" style="margin-top:10px"></div></div>
      <div class="card"><div class="card-head"><h3>Online payments</h3></div>
        <p class="muted" style="font-size:14px">Parents can already <b>report</b> a mobile-money or bank payment from their portal; you confirm it under School fees &gt; Payment claims. For fully automatic recording, point your payment provider's webhook at the address below.</p>
        <div class="field" style="margin-top:12px"><label>Webhook address</label><input class="input" readonly value="${esc(base)}/functions/v1/payment-webhook" onclick="this.select()"></div>
        <p class="muted" style="font-size:13px;margin-top:10px">Deploy the <code>payment-webhook</code> function with <code>--no-verify-jwt</code> and set the <code>PAYMENT_WEBHOOK_SECRET</code> secret. The provider must send the header <code>x-webhook-secret</code> and the JSON shown in the function's comments. Setup details are in the README.</p></div>
    </div>`;
  $('#st-test', view)?.addEventListener('click', async (e) => {
    setBusy(e.currentTarget, true, 'Sending');
    const out = $('#st-res', view);
    try {
      const r = await callFunction('notify-external', { user_ids: [ctx.user.id], title: 'Test message', body: `This is a test from ${CONFIG.SCHOOL.name}. If you can read this, the channel works.` });
      const parts = [];
      if (r.emails) parts.push(`email sent to ${esc(ctx.profile.email)}`); if (r.sms) parts.push('SMS sent');
      out.innerHTML = parts.length ? `<div class="msg ok show">Delivered to the provider: ${parts.join(' and ')}. Check your inbox or phone.</div>` : `<div class="msg err show">Nothing was sent. ${status?.email || status?.sms ? 'Check that your profile has an email or phone number.' : 'No channel is configured yet.'} ${r.errors?.length ? '<br>' + r.errors.map(esc).join('<br>') : ''}</div>`;
      if (r.errors?.length && parts.length) out.innerHTML += `<div class="msg err show" style="margin-top:8px">${r.errors.map(esc).join('<br>')}</div>`;
    } catch (er) { fail(er); } finally { setBusy(e.currentTarget, false); }
  });
}
