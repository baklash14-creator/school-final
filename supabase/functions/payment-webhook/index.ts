// Edge Function: payment-webhook   (OPTIONAL: automatic online payments)
// A payment provider (mobile money aggregator, card gateway, bank) calls this URL after a
// successful payment and the fee is recorded and the family is notified automatically.
//
// Deploy with "Verify JWT" OFF (the provider has no Supabase login) and set the secret:
//   supabase secrets set PAYMENT_WEBHOOK_SECRET=<long random string>
//   supabase functions deploy payment-webhook --no-verify-jwt
//
// Request:  POST  https://<project>.supabase.co/functions/v1/payment-webhook
//           header  x-webhook-secret: <the secret>
//           JSON    { "student_no": "BKR-2026-0001", "amount": 150000, "reference": "TXN123",
//                     "method": "mobile_money", "paid_on": "2026-09-10", "fee_id": null }
// Providers each use their own payload shape. Put a small adapter in front of this function
// (or in the provider's own "webhook" settings) that maps their fields to the JSON above.
// The same reference is never recorded twice, so provider retries are safe.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const METHODS = ['cash', 'bank_transfer', 'mobile_money', 'card', 'cheque'];

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = Deno.env.get('PAYMENT_WEBHOOK_SECRET');
  if (!secret || secret.length < 16) return json({ error: 'Webhook is not configured' }, 503);
  if (!sameSecret(req.headers.get('x-webhook-secret') ?? '', secret)) return json({ error: 'Unauthorized' }, 401);

  try {
    const b = await req.json();
    const amount = Number(b.amount);
    const reference = String(b.reference ?? '').trim();
    const method = METHODS.includes(b.method) ? b.method : 'mobile_money';
    const paid_on = /^\d{4}-\d{2}-\d{2}$/.test(b.paid_on ?? '') ? b.paid_on : new Date().toISOString().slice(0, 10);
    if (!(amount > 0) || amount > 1e9) return json({ error: 'amount must be a positive number' }, 400);
    if (reference.length < 3 || reference.length > 80) return json({ error: 'reference is required (3-80 characters)' }, 400);

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: dupe } = await db.from('fee_payments').select('id,receipt_no').eq('reference', reference).maybeSingle();
    if (dupe) return json({ ok: true, duplicate: true, receipt_no: dupe.receipt_no });

    const { data: st } = await db.from('students').select('id,full_name,profile_id,parent_id,student_guardians(parent_id)').eq('student_no', String(b.student_no ?? '').trim()).maybeSingle();
    if (!st) return json({ error: 'Unknown student_no' }, 404);

    const { data: pay, error } = await db.from('fee_payments').insert({ student_id: st.id, fee_id: b.fee_id ?? null, amount, method, reference, paid_on, note: 'Online payment' }).select('id,receipt_no').single();
    if (error) return json({ error: error.message }, 400);

    const pids = [st.parent_id, ...(st.student_guardians ?? []).map((g: { parent_id: string }) => g.parent_id)].filter(Boolean);
    const { data: parents } = pids.length ? await db.from('parents').select('profile_id').in('id', pids) : { data: [] };
    const text = `Payment of ${amount} received for ${st.full_name}. Receipt ${pay.receipt_no}.`;
    const rows = [
      ...(parents ?? []).filter((p: { profile_id: string | null }) => p.profile_id).map((p: { profile_id: string }) => ({ user_id: p.profile_id, title: 'Payment received', body: text, type: 'fees', link: 'parent.html#/fees' })),
      ...(st.profile_id ? [{ user_id: st.profile_id, title: 'Payment received', body: text, type: 'fees', link: 'student.html#/fees' }] : []),
    ];
    if (rows.length) await db.from('notifications').insert(rows);
    return json({ ok: true, receipt_no: pay.receipt_no });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
