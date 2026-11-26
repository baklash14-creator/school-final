// Sign-in page: animated panel, role tabs, sign in, password reset, success transition
import { CONFIG, isConfigured } from './config.js';
import { sb } from './supabase.js';
import { signIn, getProfile, homeFor, ROLE_LABEL } from './auth.js';
import { warmGeo } from './login-log.js';
warmGeo();
import { $, $$, icon, LOGO, friendlyError, esc } from './ui.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- static bits ---------- */
$$('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon, 18); if (el.tagName === 'SPAN') el.style.display = 'contents'; });
$$('[data-logo]').forEach((el) => (el.innerHTML = LOGO));
$$('[data-school]').forEach((el) => (el.textContent = CONFIG.SCHOOL.name));
$('#yr').textContent = new Date().getFullYear();
document.title = `Sign in | ${CONFIG.SCHOOL.name}`;

/* ---------- rotating message ---------- */
const slides = $$('#slides p'); let si = 0;
if (slides.length > 1 && !reduce) setInterval(() => { slides[si].classList.remove('on'); si = (si + 1) % slides.length; slides[si].classList.add('on'); }, 4200);

/* ---------- animated network canvas ---------- */
function network() {
  const c = $('#net'); if (!c || reduce) return;
  const g = c.getContext('2d'); let w, h, pts = [], raf;
  const resize = () => {
    const r = c.parentElement.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    w = r.width; h = r.height; c.width = w * dpr; c.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(70, (w * h) / 15000));
    pts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35 }));
  };
  const tick = () => {
    g.clearRect(0, 0, w, h);
    for (const p of pts) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1; }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        if (d < 130) { g.strokeStyle = `rgba(233,168,32,${.35 * (1 - d / 130)})`; g.lineWidth = 1; g.beginPath(); g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[j].x, pts[j].y); g.stroke(); }
      }
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(pts[i].x, pts[i].y, 1.6, 0, 7); g.fill();
    }
    raf = requestAnimationFrame(tick);
  };
  resize(); tick();
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { cancelAnimationFrame(raf); if (!document.hidden) tick(); });
}
network();

/* ---------- live numbers from the database ---------- */
async function metrics() {
  if (!isConfigured()) return;
  try {
    const { data } = await sb.from('public_stats').select('*').single();
    if (!data) return;
    const items = [['students', 'Students'], ['teachers', 'Teachers'], ['classes', 'Classes']];
    const box = $('#metrics'); box.hidden = false;
    box.innerHTML = items.map(([k, l]) => `<div class="metric"><b data-n="${data[k] || 0}">0</b><span>${l}</span></div>`).join('');
    $$('[data-n]', box).forEach((b) => {
      const to = Number(b.dataset.n); if (reduce || !to) return void (b.textContent = to);
      const t0 = performance.now();
      const step = (t) => { const p = Math.min(1, (t - t0) / 1200); b.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  } catch { /* numbers are optional */ }
}
metrics();

/* ---------- role tabs ---------- */
const ROLE_TEXT = { student: 'Sign in to your student account.', parent: 'Sign in to follow your child\'s progress.', teacher: 'Sign in to manage your classes.', admin: 'Sign in to the school administration.' };
const roles = $('#roles'); const rb = $$('button', roles);
rb.forEach((b, i) => b.addEventListener('click', () => {
  rb.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  roles.style.setProperty('--i', i);
  const line = $('#sub-line'); line.style.opacity = 0;
  setTimeout(() => { line.textContent = ROLE_TEXT[b.dataset.role]; line.style.opacity = 1; }, 160);
  $('#email').focus();
}));

/* ---------- panes ---------- */
const login = $('#login-form'), forgot = $('#forgot-form');
function swap(to) {
  const showing = to === 'forgot' ? forgot : login, hiding = to === 'forgot' ? login : forgot;
  hiding.classList.remove('active'); hiding.classList.toggle('left', to === 'forgot'); hiding.inert = true;
  showing.classList.remove('left'); showing.classList.add('active'); showing.inert = false;
  setTimeout(() => showing.querySelector('input')?.focus(), 350);
}
forgot.inert = true;
$('#to-forgot').onclick = () => { $('#femail').value = $('#email').value; swap('forgot'); };
$('#to-login').onclick = () => swap('login');

const show = (el, type, text) => { el.className = `msg ${type} show`; el.innerHTML = `${icon(type === 'ok' ? 'check' : type === 'info' ? 'info' : 'alert', 18)}<span>${esc(text)}</span>`; };
const hide = (el) => { el.className = 'msg'; el.innerHTML = ''; };

/* ---------- password helpers ---------- */
const pw = $('#password');
$('#peek').onclick = (e) => { const on = pw.type === 'password'; pw.type = on ? 'text' : 'password'; e.currentTarget.setAttribute('aria-label', on ? 'Hide password' : 'Show password'); e.currentTarget.innerHTML = icon('eye', 18); e.currentTarget.style.color = on ? 'var(--brand)' : ''; };
pw.addEventListener('keyup', (e) => $('#caps').classList.toggle('show', e.getModifierState?.('CapsLock')));
pw.addEventListener('blur', () => $('#caps').classList.remove('show'));

/* ---------- setup help when config is missing ---------- */
if (!isConfigured()) {
  const s = $('#setup'); s.hidden = false;
  s.innerHTML = `<div class="notice" style="margin:0">${icon('info', 18)}<span><b>Almost there.</b> Add your Supabase project URL and anon key in <code>js/config.js</code> to enable sign-in.</span></div>`;
}
try { const m = sessionStorage.getItem('aiass_msg'); if (m) { show($('#msg'), 'info', m); sessionStorage.removeItem('aiass_msg'); } } catch { /* ignore */ }

/* ---------- success transition ---------- */
let leaving = false;
function enter(profile, fromEl) {
  if (leaving) return; leaving = true;
  const cur = $('#curtain');
  const r = (fromEl || $('#card')).getBoundingClientRect();
  cur.style.setProperty('--cx', `${r.left + r.width / 2}px`); cur.style.setProperty('--cy', `${r.top + r.height / 2}px`);
  const first = (profile.full_name || '').split(' ')[0];
  $('#curtain-text').innerHTML = `Welcome${first ? ', <b>' + esc(first) + '</b>' : ''}.<br>Opening your ${esc(ROLE_LABEL[profile.role] || '')} dashboard...`;
  cur.setAttribute('aria-hidden', 'false');
  $('#card').classList.add('leave');
  requestAnimationFrame(() => cur.classList.add('on'));
  setTimeout(() => location.replace(homeFor(profile.role)), reduce ? 600 : 1900);
}

/* ---------- lockout after repeated failures ---------- */
let fails = 0, lockUntil = 0;
const locked = () => Date.now() < lockUntil;

login.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#msg'), btn = $('#go'); hide(msg);
  if (!isConfigured()) return show(msg, 'err', 'The site is not connected to Supabase yet. See js/config.js.');
  if (locked()) return show(msg, 'err', `Too many attempts. Try again in ${Math.ceil((lockUntil - Date.now()) / 1000)} seconds.`);
  const email = $('#email').value.trim(), password = pw.value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show(msg, 'err', 'Enter a valid email address.'); return $('#email').focus(); }
  if (!password) { show(msg, 'err', 'Enter your password.'); return pw.focus(); }
  btn.classList.add('loading');
  try {
    const { profile } = await signIn(email, password);
    btn.classList.remove('loading'); btn.classList.add('success');
    setTimeout(() => enter(profile, btn), reduce ? 100 : 650);
  } catch (err) {
    btn.classList.remove('loading');
    if (++fails >= 5) { lockUntil = Date.now() + 30000; fails = 0; show(msg, 'err', 'Too many failed attempts. Please wait 30 seconds before trying again.'); }
    else show(msg, 'err', friendlyError(err));
    const card = $('#card'); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    pw.select();
  }
});

forgot.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#fmsg'), btn = $('#fgo'), email = $('#femail').value.trim(); hide(msg);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return show(msg, 'err', 'Enter a valid email address.');
  if (!isConfigured()) return show(msg, 'err', 'The site is not connected to Supabase yet.');
  btn.classList.add('loading');
  try {
    await sb.auth.resetPasswordForEmail(email, { redirectTo: new URL('reset.html', location.href).href });
    show(msg, 'ok', 'If an account exists for that email, a reset link is on its way. Check your inbox.');
  } catch (err) { show(msg, 'err', friendlyError(err)); } finally { btn.classList.remove('loading'); }
});

/* ---------- already signed in? ---------- */
(async () => {
  if (!isConfigured()) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const p = await getProfile(session.user.id);
    if (p?.is_active) setTimeout(() => enter(p), 400); else await sb.auth.signOut();
  } catch { /* stay on the form */ }
})();
