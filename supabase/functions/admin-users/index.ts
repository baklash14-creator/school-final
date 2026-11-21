// Edge Function: admin-users
// Creates accounts, resets passwords, changes roles and activates/deactivates users.
// These actions need the service-role key, which must never be shipped to the browser,
// so they run here. Every call first verifies that the caller is an active administrator.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ROLES = ['super_admin', 'school_admin', 'teacher', 'student', 'parent'];
const LINK_TABLES = ['students', 'teachers', 'parents'];
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const caller = createClient(url, anon, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'You are not signed in.' }, 401);

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: me } = await admin.from('profiles').select('role,is_active,permissions').eq('id', user.id).single();
    if (!me?.is_active || !['super_admin', 'school_admin'].includes(me.role)) return json({ error: 'Administrators only.' }, 403);
    if (me.role === 'school_admin' && me.permissions?.users === false) return json({ error: 'You do not have permission to manage users.' }, 403);
    const isSuper = me.role === 'super_admin';

    const body = await req.json();
    const action = body.action as string;

    // Which roles may this caller hand out / touch?
    const canGrant = (role: string) => ROLES.includes(role) && (isSuper || !['super_admin', 'school_admin'].includes(role));
    const targetOf = async (id: string) => {
      const { data } = await admin.from('profiles').select('id,role').eq('id', id).single();
      return data;
    };

    if (action === 'create_user') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const full_name = String(body.full_name ?? '').trim();
      const role = String(body.role ?? '');
      if (!emailRe.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
      if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);
      if (full_name.length < 2) return json({ error: 'Enter the full name.' }, 400);
      if (!canGrant(role)) return json({ error: 'You cannot create an account with that role.' }, 403);

      const link = body.link as { table: string; id: string } | undefined;
      if (link && !LINK_TABLES.includes(link.table)) return json({ error: 'Invalid link.' }, 400);

      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name }, app_metadata: { role },
      });
      if (error) return json({ error: error.message }, 400);

      if (body.phone) await admin.from('profiles').update({ phone: String(body.phone).slice(0, 30) }).eq('id', data.user.id);
      if (link?.id) await admin.from(link.table).update({ profile_id: data.user.id }).eq('id', link.id);
      return json({ ok: true, id: data.user.id });
    }

    if (action === 'reset_password') {
      const password = String(body.password ?? '');
      if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);
      const t = await targetOf(body.user_id);
      if (!t) return json({ error: 'User not found.' }, 404);
      if (!isSuper && ['super_admin', 'school_admin'].includes(t.role)) return json({ error: 'You cannot reset this account.' }, 403);
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'set_active') {
      const t = await targetOf(body.user_id);
      if (!t) return json({ error: 'User not found.' }, 404);
      if (t.id === user.id) return json({ error: 'You cannot deactivate your own account.' }, 400);
      if (!isSuper && ['super_admin', 'school_admin'].includes(t.role)) return json({ error: 'You cannot change this account.' }, 403);
      const active = !!body.active;
      await admin.from('profiles').update({ is_active: active }).eq('id', t.id);
      // Ban blocks token refresh, so a deactivated user is signed out everywhere soon.
      await admin.auth.admin.updateUserById(t.id, { ban_duration: active ? 'none' : '876000h' });
      return json({ ok: true });
    }

    if (action === 'set_role') {
      const role = String(body.role ?? '');
      const t = await targetOf(body.user_id);
      if (!t) return json({ error: 'User not found.' }, 404);
      if (t.id === user.id) return json({ error: 'You cannot change your own role.' }, 400);
      if (!canGrant(role) || (!isSuper && ['super_admin', 'school_admin'].includes(t.role))) return json({ error: 'You cannot assign that role.' }, 403);
      await admin.from('profiles').update({ role }).eq('id', t.id);
      await admin.auth.admin.updateUserById(t.id, { app_metadata: { role } });
      return json({ ok: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unexpected error.' }, 500);
  }
});
