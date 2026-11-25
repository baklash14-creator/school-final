// Authentication, role routing, route guards and idle timeout
import { sb } from './supabase.js';
import { CONFIG } from './config.js';
import { logEvent } from './api.js';
import { recordLogin } from './login-log.js';

export const ROLE_HOME = {
  super_admin: 'admin.html', school_admin: 'admin.html',
  teacher: 'teacher.html', student: 'student.html', parent: 'parent.html',
};
export const ROLE_LABEL = {
  super_admin: 'Super Administrator', school_admin: 'School Administrator',
  teacher: 'Teacher', student: 'Student', parent: 'Parent',
};
export const homeFor = (role) => ROLE_HOME[role] || 'login.html';

export async function getProfile(userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) { await recordLogin(email, false); throw error; }
  const profile = await getProfile(data.user.id);
  if (!profile) { await sb.auth.signOut(); await recordLogin(email, false); throw new Error('No profile found for this account. Contact the school administrator.'); }
  if (!profile.is_active) { await sb.auth.signOut(); await recordLogin(email, false); throw new Error('This account is not active. Contact the school administrator.'); }
  sb.from('profiles').update({ last_login: new Date().toISOString() }).eq('id', profile.id).then(() => {}, () => {});
  logEvent('login', 'auth', { role: profile.role });
  await recordLogin(email, true);
  return { user: data.user, profile };
}

export async function signOut(message) {
  try { await sb.auth.signOut(); } catch { /* ignore */ }
  try { if (message) sessionStorage.setItem('bakarr_msg', message); } catch { /* ignore */ }
  location.replace('login.html');
}

// Protect a dashboard: returns {user, profile} or redirects.
export async function guard(allowedRoles) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.replace('login.html'); return new Promise(() => {}); }
  let profile;
  try { profile = await getProfile(session.user.id); } catch { profile = null; }
  if (!profile || !profile.is_active) return signOut('Your account is not active. Contact the school administrator.');
  if (!allowedRoles.includes(profile.role)) { location.replace(homeFor(profile.role)); return new Promise(() => {}); }
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.replace('login.html'); });
  startIdleTimer();
  return { user: session.user, profile };
}

let idleTimer;
function startIdleTimer() {
  const limit = CONFIG.IDLE_MINUTES * 60 * 1000;
  const reset = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => signOut('You were signed out after a period of inactivity.'), limit); };
  ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach((e) => window.addEventListener(e, reset, { passive: true }));
  reset();
}

// Most modules are allowed for a school administrator unless switched off. Sensitive ones must be switched on (same rule as the database).
const STRICT_PERMS = new Set(['payroll']);
export const hasPerm = (profile, key) => profile.role === 'super_admin'
  || (profile.role === 'school_admin' && (STRICT_PERMS.has(key) ? profile.permissions?.[key] === true : profile.permissions?.[key] !== false));
