// Data helpers on top of the Supabase client
import { sb } from './supabase.js';
import { CONFIG } from './config.js';

// Run a supabase query and throw on error, returning data
export async function must(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Cached dropdown loader: lookup('classes','name') -> async () => [{value,label}]
const cache = new Map();
export const clearLookups = () => cache.clear();
export function lookup(table, labelCol = 'name', { extra = '', order = labelCol, where, format } = {}) {
  return async () => {
    const key = `${table}|${labelCol}|${extra}|${JSON.stringify(where || {})}`;
    if (!cache.has(key)) {
      let q = sb.from(table).select(`id,${labelCol}${extra ? ',' + extra : ''}`).order(order).limit(1000);
      for (const [k, v] of Object.entries(where || {})) q = q.eq(k, v);
      cache.set(key, must(q));
    }
    const rows = await cache.get(key);
    return rows.map((r) => ({ value: r.id, label: format ? format(r) : r[labelCol] }));
  };
}

export async function nameMap(table, col = 'name') {
  const rows = await must(sb.from(table).select(`id,${col}`).limit(1000));
  return Object.fromEntries(rows.map((r) => [r.id, r[col]]));
}

export const currentYear = async () => {
  const { data } = await sb.from('academic_years').select('*').eq('is_current', true).maybeSingle();
  return data;
};

export async function callFunction(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { /* keep message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// In-app notifications (+ optional email/SMS through the notify-external function)
export async function notifyUsers(userIds, { title, body = '', type = 'general', link = null }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  for (let i = 0; i < ids.length; i += 400) {
    await must(sb.from('notifications').insert(ids.slice(i, i + 400).map((user_id) => ({ user_id, title, body, type, link }))));
  }
  if (CONFIG.EXTERNAL_NOTIFICATIONS) {
    callFunction('notify-external', { user_ids: ids, title, body }).catch((e) => console.warn('External notification failed', e));
  }
  return ids.length;
}

export async function profileIdsByRole(roles) {
  const rows = await must(sb.from('profiles').select('id').in('role', roles).eq('is_active', true).limit(5000));
  return rows.map((r) => r.id);
}

// For a list of student ids: { [id]: { student: profileId|null, parents: [profileId...] } }
// Parents include the primary parent AND any additional guardians.
export async function guardianProfiles(studentIds) {
  const ids = [...new Set((studentIds || []).filter(Boolean))];
  const out = {};
  const studs = [];
  for (let i = 0; i < ids.length; i += 80) {
    studs.push(...await must(sb.from('students').select('id,profile_id,parent_id,student_guardians(parent_id)').in('id', ids.slice(i, i + 80))));
  }
  const pids = new Set();
  studs.forEach((s) => { if (s.parent_id) pids.add(s.parent_id); (s.student_guardians || []).forEach((g) => pids.add(g.parent_id)); });
  const pmap = {};
  const plist = [...pids];
  for (let i = 0; i < plist.length; i += 80) {
    (await must(sb.from('parents').select('id,profile_id').in('id', plist.slice(i, i + 80)))).forEach((p) => { pmap[p.id] = p.profile_id; });
  }
  studs.forEach((s) => {
    const ps = [s.parent_id, ...(s.student_guardians || []).map((g) => g.parent_id)].map((id) => pmap[id]).filter(Boolean);
    out[s.id] = { student: s.profile_id || null, parents: [...new Set(ps)] };
  });
  return out;
}

// Student and parent account ids for a class (or the whole school if no class)
export async function familyProfileIds(classId) {
  let q = sb.from('students').select('id').eq('status', 'active').limit(5000);
  if (classId) q = q.eq('class_id', classId);
  const rows = await must(q);
  const map = await guardianProfiles(rows.map((r) => r.id));
  return Object.values(map).flatMap((m) => [m.student, ...m.parents]).filter(Boolean);
}

export const logEvent = (action, entity, details) => sb.rpc('log_event', { p_action: action, p_entity: entity, p_details: details ?? null }).then(() => {}, () => {});

export const pct = (score, max) => (max > 0 ? (Number(score) / Number(max)) * 100 : 0);

export function downloadBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
