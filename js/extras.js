// New public features: School achievements + Alumni (list and registration form)
import { CONFIG, isConfigured } from './config.js';
import { sb } from './supabase.js';
import { $, esc, toast, fail, setBusy, formHtml, readForm } from './ui.js';

const empty = (t) => `<div class="s-empty">${esc(t)}</div>`;
const cooldown = (key, ms) => { try { const t = Number(localStorage.getItem(key) || 0); if (Date.now() - t < ms) return Math.ceil((ms - (Date.now() - t)) / 1000); localStorage.setItem(key, Date.now()); } catch { /* ignore */ } return 0; };
const nice = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const LABEL = { award: 'Award', exam_result: 'Exam result', sports: 'Sports', competition: 'Competition', other: 'Achievement' };

/* ---------- achievements ---------- */
async function achievements() {
  const box = $('#ach-list'); if (!box) return;
  const { data, error } = await sb.from('achievements').select('*').eq('is_published', true).order('achieved_on', { ascending: false, nullsFirst: false }).limit(12);
  if (error) throw error;
  const url = (p) => sb.storage.from('gallery').getPublicUrl(p).data.publicUrl;
  box.innerHTML = data.length ? data.map((a) => `<article class="s-card reveal">
      ${a.image_path ? `<img src="${esc(url(a.image_path))}" alt="" loading="lazy" style="width:100%;border-radius:12px;margin-bottom:12px;aspect-ratio:16/10;object-fit:cover">` : ''}
      <small class="muted">${esc(LABEL[a.category] || 'Achievement')}${a.achieved_on ? ' | ' + esc(nice(a.achieved_on)) : ''}</small>
      <h3>${esc(a.title)}</h3>${a.description ? `<p>${esc(a.description)}</p>` : ''}</article>`).join('')
    : empty('Our prizes, results and awards will appear here.');
  document.querySelectorAll('#ach-list .reveal').forEach((e) => e.classList.add('in'));
}

/* ---------- alumni ---------- */
async function alumniList() {
  const box = $('#alumni-list'); if (!box) return;
  const { data, error } = await sb.rpc('public_alumni');
  if (error) throw error;
  box.innerHTML = data.length ? data.map((a) => `<article class="s-card reveal">
      <h3>${esc(a.full_name)}</h3>
      <p class="muted">${a.graduation_year ? 'Class of ' + esc(String(a.graduation_year)) : ''}${a.current_work ? ' | ' + esc(a.current_work) : ''}</p>
      ${a.message ? `<p>${esc(a.message)}</p>` : ''}</article>`).join('')
    : empty('Be the first former student to join our alumni.');
  document.querySelectorAll('#alumni-list .reveal').forEach((e) => e.classList.add('in'));
}

const alumniFields = [
  { name: 'full_name', label: 'Full name', required: true, full: true, maxlength: 120 },
  { name: 'graduation_year', label: 'Year you left school', type: 'number', min: 1950, max: new Date().getFullYear() },
  { name: 'current_work', label: 'What you do now', maxlength: 150 },
  { name: 'phone', label: 'Phone (not shown publicly)', type: 'tel', maxlength: 30 },
  { name: 'email', label: 'Email (not shown publicly)', type: 'email', maxlength: 150 },
  { name: 'message', label: 'A message to the school and current students', type: 'textarea', rows: 3, full: true, maxlength: 1000 },
];
const host = $('#alumni-form-host');
if (host) {
  host.innerHTML = formHtml(alumniFields) + '<input class="hp" id="hp-al" tabindex="-1" autocomplete="off" aria-hidden="true">';
  $('#alumni-go').onclick = async (e) => {
    if ($('#hp-al').value) return;
    if (!isConfigured()) return toast('The website is not connected to the database yet.', 'error');
    const form = $('#alumni-form-host form'); const { ok, values } = readForm(form, alumniFields);
    if (!ok) return toast('Please fix the highlighted fields.', 'error');
    const wait = cooldown('bk_alumni', 30000); if (wait) return toast(`Please wait ${wait} seconds before submitting again.`, 'info');
    setBusy(e.currentTarget, true, 'Sending');
    try {
      const row = { ...values, graduation_year: values.graduation_year ? Number(values.graduation_year) : null };
      const { error } = await sb.from('alumni').insert(row);
      if (error) throw error;
      form.reset(); toast('Thank you! The school will approve your name soon.');
    } catch (err) { fail(err); } finally { setBusy(e.currentTarget, false); }
  };
}

if (isConfigured()) for (const fn of [achievements, alumniList]) fn().catch((e) => console.warn(fn.name, e));
