// Edge Function: notify-external   (OPTIONAL)
// Sends the same message by email (Resend) and/or SMS (Twilio) to chosen users.
// Turn it on by setting EXTERNAL_NOTIFICATIONS: true in js/config.js and adding the secrets
// listed in README.md. If no secrets are set, the function does nothing and reports 0 sent.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: me } = await admin.from('profiles').select('role,is_active').eq('id', user.id).single();
    if (!me?.is_active || !['super_admin', 'school_admin', 'teacher'].includes(me.role)) return json({ error: 'Forbidden' }, 403);

    const payload = await req.json();
    const resendOn = !!Deno.env.get('RESEND_API_KEY');
    const smsOn = !!(Deno.env.get('TWILIO_ACCOUNT_SID') && Deno.env.get('TWILIO_AUTH_TOKEN') && Deno.env.get('TWILIO_FROM'));
    // Settings page: report which channels are configured (admins only), without sending anything
    if (payload.check) {
      if (!['super_admin', 'school_admin'].includes(me.role)) return json({ error: 'Forbidden' }, 403);
      return json({ ok: true, email: resendOn, sms: smsOn });
    }
    const { user_ids, title, body } = payload;
    if (!Array.isArray(user_ids) || !title) return json({ error: 'user_ids and title are required' }, 400);
    const ids = user_ids.slice(0, 500);
    const { data: people } = await admin.from('profiles').select('email,phone,full_name').in('id', ids);

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const from = Deno.env.get('EMAIL_FROM') ?? 'Bakarr School <onboarding@resend.dev>';
    const twSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twFrom = Deno.env.get('TWILIO_FROM');

    let emails = 0, sms = 0; const errors: string[] = [];
    for (const p of people ?? []) {
      if (resendKey && p.email) {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [p.email], subject: title, text: `${body ?? ''}\n\n- Bakarr School` }),
        });
        if (r.ok) emails++; else errors.push('Email: ' + (await r.text()).slice(0, 160));
      }
      if (twSid && twToken && twFrom && p.phone) {
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twSid}/Messages.json`, {
          method: 'POST',
          headers: { Authorization: 'Basic ' + btoa(`${twSid}:${twToken}`), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: p.phone, From: twFrom, Body: `${title}: ${body ?? ''}`.slice(0, 300) }),
        });
        if (r.ok) sms++; else errors.push('SMS: ' + (await r.text()).slice(0, 160));
      }
    }
    return json({ ok: true, emails, sms, errors: errors.slice(0, 3) });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
