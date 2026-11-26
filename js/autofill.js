// Smart apply: turn a pasted message into admission-form values.
// Uses the optional ai-fill edge function; falls back to a simple on-device reader.
import { sb } from './supabase.js';
import { CONFIG, isConfigured } from './config.js';

const iso = (s) => {
  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/), y, mo, d;
  if (m) [, y, mo, d] = m;
  else if ((m = s.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/))) [, d, mo, y] = m;
  else return null;
  const v = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, t = new Date(v + 'T00:00:00Z');
  return !isNaN(t) && t.toISOString().slice(0, 10) === v && t < new Date() ? v : null;
};

export function localParse(text) {
  const f = {}, t = text.replace(/\r/g, '');
  const lab = (re) => { const m = t.match(new RegExp(`(?:^|\\n)\\s*(?:${re})\\s*[:\\-]\\s*(.+)`, 'i')); return m ? m[1].trim() : ''; };
  const email = t.match(/[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/); if (email) f.parent_email = email[0];
  const ph = t.match(/(?:\+?\d[\d\s-]{6,16}\d)/); if (ph && !/^\d{4}-\d{2}-\d{2}$/.test(ph[0].trim())) f.parent_phone = ph[0].replace(/\s+/g, ' ').trim();
  const name = lab("child(?:'s)? name|pupil|student|applicant|name"); if (name) f.applicant_name = name.slice(0, 120);
  const par = lab('parent|guardian|father|mother|parent name'); if (par) f.parent_name = par.slice(0, 120);
  const dob = lab('date of birth|dob|born'); const d = iso(dob || t); if (d) f.date_of_birth = d;
  const g = lab('gender|sex') || (/\b(?:girl|daughter|female)\b/i.test(t) ? 'female' : /\b(?:boy|son|male)\b/i.test(t) ? 'male' : '');
  if (/^f/i.test(g)) f.gender = 'female'; else if (/^m|^b/i.test(g)) f.gender = 'male';
  const addr = lab('address|live at|lives at|location'); if (addr) f.address = addr.slice(0, 300);
  const prev = lab('previous school|last school|school') || (t.match(/[Ff]rom\s+([A-Z][\w' .&-]{2,60}(?:School|Academy|College))/) || [])[1]; if (prev) f.previous_school = prev.trim().slice(0, 150);
  const lvl = lab('class|level|grade|applying for');
  const hay = (lvl || t).toLowerCase();
  const alias = [[/\b(?:jss|junior)\b/, 'Junior Secondary'], [/\b(?:sss|senior)\b/, 'Senior Secondary'], [/\bnursery\b/, 'Nursery'], [/\b(?:primary|class [1-6])\b/, 'Primary']];
  const hit = CONFIG.LEVELS.find((l) => hay.includes(l.name.toLowerCase())) || CONFIG.LEVELS.find((l) => alias.some(([re, n]) => n === l.name && re.test(hay)));
  if (hit) f.grade_applying = hit.name;
  return f;
}

export async function parseApplication(text) {
  text = text.trim().slice(0, 1500);
  let source = 'basic', fields = {};
  if (isConfigured()) {
    try {
      const { data, error } = await sb.functions.invoke('ai-fill', { body: { text, levels: CONFIG.LEVELS.map((l) => l.name) } });
      if (!error && data?.fields) { fields = data.fields; source = 'ai'; }
    } catch { /* fall back */ }
  }
  if (source === 'basic') fields = localParse(text);
  // keep only known keys, validated; never trust the reply blindly
  const ok = {}, str = (k, n) => { if (typeof fields[k] === 'string' && fields[k].trim()) ok[k] = fields[k].trim().slice(0, n); };
  str('applicant_name', 120); str('previous_school', 150); str('parent_name', 120); str('parent_phone', 30); str('address', 300); str('message', 1500);
  if (typeof fields.parent_email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.parent_email.trim())) ok.parent_email = fields.parent_email.trim().slice(0, 150);
  if (['male', 'female'].includes(fields.gender)) ok.gender = fields.gender;
  if (typeof fields.date_of_birth === 'string') { const d = iso(fields.date_of_birth); if (d) ok.date_of_birth = d; }
  const lv = CONFIG.LEVELS.find((l) => l.name === fields.grade_applying); if (lv) ok.grade_applying = lv.name;
  return { fields: ok, source };
}
