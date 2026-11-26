// Public website: static content from config, live content from Supabase, forms
import { CONFIG, isConfigured } from './config.js';
import { sb } from './supabase.js';
import { parseApplication } from './autofill.js';
import { $, $$, esc, icon, LOGO, toast, fail, modal, setBusy, formHtml, readForm, fmtDate, initials } from './ui.js';

const S = CONFIG.SCHOOL;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- static content ---------- */
$$('[data-ic]').forEach((el) => { el.innerHTML = icon(el.dataset.ic, 20); });
$$('[data-logo]').forEach((el) => (el.innerHTML = LOGO));
$$('[data-school]').forEach((el) => (el.textContent = S.name));
document.title = `${S.name} | ${S.motto}`;
$('#t-motto').textContent = S.motto; $('#f-motto').textContent = S.motto;
$('#t-hours').textContent = S.hours;
$('#t-phone').textContent = S.phone; $('#t-mail').textContent = S.email;
if (!S.email) { $('#t-mail').hidden = true; $('#c-mail').parentElement.parentElement.hidden = true; }
$('#c-addr').textContent = S.address; $('#c-hours').textContent = S.hours;
$('#c-phone').textContent = S.phone; $('#c-mail').innerHTML = `<a href="mailto:${esc(S.email)}">${esc(S.email)}</a>`;
$('#yr').textContent = new Date().getFullYear();
$('#burger').innerHTML = icon('menu', 22);

const colors = ['#e9a820', '#4f7bdc', '#2147a6', '#c23b3b', '#2b69b0'];
$('#levels').innerHTML = CONFIG.LEVELS.map((l, i) => `<article class="s-level reveal" style="--lv:${colors[i % colors.length]}"><h3>${esc(l.name)}</h3><p class="ages">${esc(l.ages)}</p><p>${esc(l.text)}</p></article>`).join('');

/* ---------- header, menu, reveal ---------- */
const head = $('#head');
const onScroll = () => head.classList.toggle('stuck', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true }); onScroll();
$('#burger').onclick = (e) => { const o = $('#nav').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(o)); };
$('#nav').onclick = (e) => { if (e.target.closest('a')) $('#nav').classList.remove('open'); };

function reveal() {
  const els = $$('.reveal:not(.in)');
  if (!('IntersectionObserver' in window) || reduce) return els.forEach((e) => e.classList.add('in'));
  const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: 0.12 });
  els.forEach((e) => io.observe(e));
  setTimeout(() => els.forEach((e) => e.classList.add('in')), 4000); // safety net
}
reveal();

const sections = ['about', 'academics', 'admissions', 'news', 'staff', 'gallery', 'achievements', 'alumni', 'contact'];
if ('IntersectionObserver' in window) {
  const links = Object.fromEntries($$('#nav a').map((a) => [a.getAttribute('href').slice(1), a]));
  const so = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { $$('#nav a').forEach((a) => a.classList.remove('on')); links[x.target.id]?.classList.add('on'); } }), { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((id) => { const el = document.getElementById(id); if (el) so.observe(el); });
}

/* ---------- live content ---------- */
const empty = (t) => `<div class="s-empty">${esc(t)}</div>`;
async function stats() {
  const { data } = await sb.from('public_stats').select('*').single();
  if (!data || !(data.students || data.teachers || data.classes)) return;
  const box = $('#stats'); box.hidden = false;
  box.innerHTML = [['students', 'Students'], ['teachers', 'Teachers'], ['classes', 'Classes'], ['subjects', 'Subjects']].filter(([k]) => data[k]).map(([k, l]) => `<div><dt>${l}</dt><dd>${data[k]}</dd></div>`).join('');
}
async function news() {
  const { data, error } = await sb.from('announcements').select('id,title,body,kind,event_date,created_at').eq('published', true).eq('is_public', true).order('created_at', { ascending: false }).limit(20);
  if (error) throw error;
  const posts = data.filter((a) => a.kind !== 'event').slice(0, 5);
  const events = data.filter((a) => a.kind === 'event' && (!a.event_date || a.event_date >= new Date().toISOString().slice(0, 10))).sort((a, b) => String(a.event_date).localeCompare(String(b.event_date))).slice(0, 5);
  $('#news-list').innerHTML = posts.length ? posts.map((p) => `<article class="s-post reveal"><small>${fmtDate(p.created_at)}</small><h4>${esc(p.title)}</h4><p>${esc(p.body.length > 260 ? p.body.slice(0, 260) + '...' : p.body)}</p></article>`).join('') : empty('No news yet. Check back soon.');
  $('#events-list').innerHTML = events.length ? events.map((e) => { const d = e.event_date ? new Date(e.event_date + 'T00:00:00') : null;
    return `<article class="s-event reveal">${d ? `<div class="s-date"><b>${d.getDate()}</b><span>${d.toLocaleString(undefined, { month: 'short' })}</span></div>` : ''}<div><h4>${esc(e.title)}</h4><p class="muted" style="font-size:14px;white-space:pre-wrap">${esc(e.body.slice(0, 180))}</p></div></article>`; }).join('') : empty('No upcoming events right now.');
  reveal();
}
async function staff() {
  const { data, error } = await sb.from('public_staff').select('*').order('full_name').limit(60);
  if (error) throw error;
  $('#staff-list').innerHTML = data.length ? data.map((t) => `<article class="s-person reveal"><div class="avatar">${t.photo_url ? `<img src="${esc(t.photo_url)}" alt="" loading="lazy">` : esc(initials(t.full_name))}</div><h4>${esc(t.full_name)}</h4><div class="role">${esc(t.job_title || 'Teacher')}</div>${t.qualification ? `<p>${esc(t.qualification)}</p>` : ''}</article>`).join('') : empty('Our staff profiles will appear here soon.');
  reveal();
}
async function gallery() {
  const { data, error } = await sb.from('gallery_items').select('*').order('created_at', { ascending: false }).limit(24);
  if (error) throw error;
  const url = (p) => sb.storage.from('gallery').getPublicUrl(p).data.publicUrl;
  $('#gallery-list').innerHTML = data.length ? data.map((g) => `<figure class="reveal" tabindex="0" role="button" data-src="${esc(url(g.image_path))}" data-cap="${esc(g.title)}"><img src="${esc(url(g.image_path))}" alt="${esc(g.title)}" loading="lazy"><figcaption>${esc(g.title)}</figcaption></figure>`).join('') : empty('Photos from school life will appear here.');
  $('#gallery-list').style.columns = data.length ? '' : '1';
  reveal();
}
const open = (e) => { const f = e.target.closest('figure[data-src]'); if (f && (e.type === 'click' || e.key === 'Enter')) modal({ title: f.dataset.cap, size: 'lg', html: `<div class="lightbox"><img src="${f.dataset.src}" alt="${f.dataset.cap}"></div>` }); };
$('#gallery-list').addEventListener('click', open); $('#gallery-list').addEventListener('keydown', open);

if (isConfigured()) {
  for (const fn of [stats, news, staff, gallery]) fn().catch((e) => console.warn(fn.name, e));
} else {
  $('#news-list').innerHTML = empty('Connect Supabase in js/config.js to show news here.');
  $('#events-list').innerHTML = empty('Upcoming events will appear here.');
  $('#staff-list').innerHTML = empty('Staff profiles will appear here.');
  $('#gallery-list').innerHTML = empty('Photos will appear here.');
}

/* ---------- admission form ---------- */
const adm = [
  { name: 'applicant_name', label: 'Child\'s full name', required: true, full: true, maxlength: 120 },
  { name: 'date_of_birth', label: 'Date of birth', type: 'date', max: new Date().toISOString().slice(0, 10) },
  { name: 'gender', label: 'Gender', type: 'select', options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }] },
  { name: 'grade_applying', label: 'Level applying for', type: 'select', required: true, options: CONFIG.LEVELS.map((l) => ({ value: l.name, label: l.name })) },
  { name: 'previous_school', label: 'Previous school', maxlength: 150 },
  { name: 'parent_name', label: 'Parent / guardian name', required: true, maxlength: 120 },
  { name: 'parent_phone', label: 'Phone number', type: 'tel', required: true, maxlength: 30 },
  { name: 'parent_email', label: 'Email address', type: 'email', maxlength: 150 },
  { name: 'address', label: 'Home address', type: 'textarea', rows: 2, full: true, maxlength: 300 },
  { name: 'message', label: 'Anything else we should know?', type: 'textarea', rows: 3, full: true, maxlength: 1500 },
];
$('#apply-form-host').innerHTML = formHtml(adm) + '<input class="hp" id="hp-site" tabindex="-1" autocomplete="off" aria-hidden="true">';
$('#apply-form-host').insertAdjacentHTML('afterbegin', `<div class="smart-apply"><label for="sa-text"><b>Smart apply</b> <span class="muted">Paste or type the details (for example a message you already wrote) and we fill the form for you. You can still edit everything.</span></label>
  <textarea class="input" id="sa-text" rows="3" maxlength="1500" placeholder="Name: Amina Kamara, born 14/05/2012, girl, applying for JSS 1. Parent: Musa Kamara 076 000 000"></textarea>
  <button class="btn ghost sm" type="button" id="sa-go">Auto-fill the form</button></div>`);
$('#sa-go').onclick = async (e) => {
  const text = $('#sa-text').value;
  if (text.trim().length < 5) return toast('Type or paste some details first.', 'error');
  setBusy(e.currentTarget, true);
  try {
    const { fields, source } = await parseApplication(text);
    const form = $('#apply-form-host form'); let n = 0;
    for (const [k, v] of Object.entries(fields)) { const el = form.elements[k]; if (el && !el.value) { el.value = v; n++; } }
    toast(n ? `Filled ${n} field${n === 1 ? '' : 's'}${source === 'ai' ? ' with AI' : ''}. Please check them before submitting.` : 'Nothing new found. Fields already filled were left alone.', n ? 'success' : 'info');
  } catch (er) { fail(er); } finally { setBusy(e.currentTarget, false); }
};
const cooldown = (key, ms) => { try { const t = Number(localStorage.getItem(key) || 0); if (Date.now() - t < ms) return Math.ceil((ms - (Date.now() - t)) / 1000); localStorage.setItem(key, Date.now()); } catch { /* ignore */ } return 0; };
const refCode = () => 'APP-' + [...crypto.getRandomValues(new Uint8Array(8))].map((n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('');

$('#apply-go').onclick = async (e) => {
  if (!isConfigured()) return toast('The website is not connected to the database yet.', 'error');
  if ($('#hp-site').value) return; // bot
  const { ok, values } = readForm($('#apply-form-host form'), adm);
  if (!ok) return toast('Please fix the highlighted fields.', 'error');
  const wait = cooldown('bk_apply', 30000); if (wait) return toast(`Please wait ${wait} seconds before submitting again.`, 'info');
  setBusy(e.currentTarget, true, 'Submitting');
  try {
    const reference = refCode();
    const documents = [];
    for (const f of [...($('#adm-files')?.files || [])].slice(0, 6)) {
      if (f.size > 5 * 1024 * 1024) throw new Error(`${f.name} is bigger than 5 MB`);
      const path = `${reference}/${Date.now()}-${f.name.replace(/[^\w.\-]/g, '_')}`;
      const up = await sb.storage.from('admission-docs').upload(path, f, { contentType: f.type });
      if (up.error) throw up.error;
      documents.push(path);
    }
    const { error } = await sb.from('admission_applications').insert({ ...values, reference, documents });
    if (error) throw error;
    sb.functions.invoke('application-received', { body: { reference } }).then(() => {}, () => {}); // confirmation email (optional)
    $('#apply-card').innerHTML = `<div class="s-success"><span class="badge ok">Application received</span><h3>Thank you, ${esc(values.parent_name.split(' ')[0])}</h3><p>Your reference code is</p><div class="ref" id="ref">${reference}</div>
      <p class="muted">Keep this code. Use it in "Track an application" to check the status. We will contact you on ${esc(values.parent_phone)}.</p><button class="btn ghost sm" id="copy-ref">Copy code</button></div>`;
    $('#copy-ref').onclick = () => navigator.clipboard?.writeText(reference).then(() => toast('Reference copied'), () => toast(reference, 'info'));
  } catch (err) { fail(err); setBusy(e.currentTarget, false); }
};

/* ---------- track application ---------- */
const STEPS = [['pending', 'Received'], ['reviewing', 'Under review'], ['accepted', 'Accepted'], ['enrolled', 'Enrolled']];
$('#track-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#track-out'), ref = $('#track-ref').value.trim().toUpperCase();
  if (!/^APP-[A-Z0-9]{8}$/.test(ref)) return (out.innerHTML = `<p class="err" style="color:var(--bad)">Enter a code like APP-XXXXXXXX.</p>`);
  if (!isConfigured()) return;
  out.innerHTML = '<span class="spin"></span>';
  try {
    const { data, error } = await sb.rpc('application_status', { p_ref: ref });
    if (error) throw error;
    const a = data?.[0];
    if (!a) return (out.innerHTML = `<p class="muted">No application found with that code. Check it and try again.</p>`);
    const idx = STEPS.findIndex(([k]) => k === a.status);
    out.innerHTML = a.status === 'rejected'
      ? `<p><b>${esc(a.applicant_name)}</b></p><p class="muted">Your application was not successful this time. Please contact the school office for details.</p>`
      : `<p style="margin-bottom:10px"><b>${esc(a.applicant_name)}</b> <span class="muted">for ${esc(a.grade_applying)}</span></p><div class="s-timeline">${STEPS.map(([k, l], i) => `<div class="${i < idx ? 'done' : i === idx ? 'done now' : ''}"><i></i>${l}</div>`).join('')}</div>`;
  } catch (err) { out.innerHTML = ''; fail(err); }
});

/* ---------- contact form ---------- */
const contact = [
  { name: 'name', label: 'Your name', required: true, maxlength: 100 },
  { name: 'email', label: 'Email', type: 'email', required: true, maxlength: 150 },
  { name: 'subject', label: 'Subject', full: true, maxlength: 150 },
  { name: 'message', label: 'Message', type: 'textarea', required: true, full: true, rows: 4, maxlength: 2000 },
];
$('#contact-host').innerHTML = formHtml(contact) + '<input class="hp" id="hp-c" tabindex="-1" autocomplete="off" aria-hidden="true">';
$('#contact-go').onclick = async (e) => {
  if ($('#hp-c').value) return;
  const form = $('#contact-host form'); const { ok, values } = readForm(form, contact);
  if (!ok) return;
  if (!isConfigured()) return toast('The website is not connected to the database yet.', 'error');
  if (values.message.length < 5) return toast('Please write a longer message.', 'error');
  const wait = cooldown('bk_contact', 20000); if (wait) return toast(`Please wait ${wait} seconds before sending another message.`, 'info');
  setBusy(e.currentTarget, true, 'Sending');
  try { const { error } = await sb.from('contact_messages').insert(values); if (error) throw error; form.reset(); toast('Message sent. We will reply by email.'); }
  catch (err) { fail(err); } finally { setBusy(e.currentTarget, false); }
};
