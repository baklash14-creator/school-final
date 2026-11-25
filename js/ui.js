// Shared UI helpers: escaping, toasts, modals, forms, tables, icons, exports
import { CONFIG } from './config.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const pad = (n) => String(n).padStart(2, '0');
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const initials = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export const fmtDate = (d) => {
  if (!d) return '-';
  const x = new Date(String(d).length === 10 ? d + 'T00:00:00' : d);
  return isNaN(x) ? '-' : x.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};
export const fmtDateTime = (d) => {
  if (!d) return '-';
  const x = new Date(d);
  return isNaN(x) ? '-' : x.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
export const fmtMoney = (n) => {
  const v = Number(n || 0);
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: CONFIG.CURRENCY, maximumFractionDigits: 2 }).format(v); }
  catch { return `${CONFIG.CURRENCY} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
};
export const num = (n, d = 1) => (n == null || isNaN(n) ? '-' : Number(n).toFixed(d).replace(/\.0+$/, ''));

export function gradeFor(pct) {
  const g = CONFIG.GRADES.find((x) => pct >= x.min) || CONFIG.GRADES.at(-1);
  return g;
}

export function friendlyError(err) {
  const m = String(err?.message || err || 'Something went wrong');
  if (err?.code === '23505' || /duplicate key/i.test(m)) return 'That record already exists. Check for a duplicate name, code or number.';
  if (err?.code === '23503' || /foreign key/i.test(m)) return 'This record is in use by other records. Remove or reassign them first.';
  if (err?.code === '42501' || /row-level security|permission denied/i.test(m)) return 'You do not have permission to do that.';
  if (err?.code === 'PGRST116') return 'You do not have permission to change this record, or it no longer exists.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Cannot reach the server. Check your internet connection and try again.';
  if (/Invalid login/i.test(m)) return 'Incorrect email or password.';
  return m;
}

/* ---------- icons ---------- */
const I = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.2c2.6.2 4.5 2 4.5 5.3"/>',
  student: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/><path d="M22 9v6"/>',
  teacher: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20l4-4 4 4"/>',
  class: '<path d="M3 21h18"/><path d="M5 21V8l7-4 7 4v13"/><path d="M9 21v-6h6v6"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5V4.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4"/>',
  file: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h7"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l8 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M19 9a4 4 0 0 1 0 6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  logout: '<path d="M9 4H5v16h4"/><path d="M16 8l4 4-4 4M20 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  printer: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.7 1.7-2.5 3-2.5s2.5.8 3 2.5M14 10h4M14 13h3"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16M15 4v16"/>',
  phone: '<path d="M6 3h3l2 5-2 1.5a11 11 0 0 0 5.500 5.500L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h4"/>',
};
export const icon = (name, size = 18) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || I.info}</svg>`;

export const LOGO = `<img src="assets/favicon.png" alt="" class="logo-img" width="64" height="64">`;

/* ---------- toasts ---------- */
export function toast(message, type = 'success', ms = 4200) {
  let stack = $('#toasts');
  if (!stack) { stack = document.createElement('div'); stack.id = 'toasts'; stack.setAttribute('aria-live', 'polite'); document.body.appendChild(stack); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `${icon(type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info', 18)}<span>${esc(message)}</span>`;
  stack.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 250); }, ms);
}
export const fail = (err) => { console.error(err); toast(friendlyError(err), 'error', 6000); };

export function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${label ? esc(label) : ''}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

/* ---------- modal ---------- */
export function modal({ title, html = '', size = 'md', footer = '' }) {
  const root = document.createElement('div');
  root.className = 'modal-root';
  root.innerHTML = `<div class="modal-backdrop" data-close></div>
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></header>
      <div class="modal-body">${html}</div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
    </div>`;
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('open'));
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    root.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => root.remove(), 220);
  }
  root.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  setTimeout(() => root.querySelector('input:not([type=hidden]):not([disabled]),select,textarea')?.focus(), 120);
  return { el: root, body: root.querySelector('.modal-body'), foot: root.querySelector('.modal-foot'), close };
}

export function confirmBox({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const m = modal({
      title, size: 'sm', html: `<p class="muted">${esc(message)}</p>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cb-yes">${esc(confirmText)}</button>`,
    });
    let done = false;
    m.el.querySelector('#cb-yes').onclick = () => { done = true; resolve(true); m.close(); };
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

/* ---------- states ---------- */
export const loadingBlock = (t = 'Loading...') => `<div class="state"><span class="spin lg"></span><p>${esc(t)}</p></div>`;
export const emptyState = (title, text = '', ic = 'inbox') =>
  `<div class="state empty">${icon(ic, 34)}<h4>${esc(title)}</h4>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
export const errorBlock = (err) =>
  `<div class="state error">${icon('alert', 34)}<h4>Could not load this page</h4><p>${esc(friendlyError(err))}</p><button class="btn ghost sm" data-retry>${icon('refresh', 15)} Try again</button></div>`;

const STATUS = {
  active: 'ok', present: 'ok', accepted: 'ok', enrolled: 'ok', paid: 'ok', published: 'ok', graduated: 'info',
  pending: 'warn', late: 'warn', reviewing: 'info', on_leave: 'warn', suspended: 'warn', draft: 'muted',
  absent: 'bad', rejected: 'bad', withdrawn: 'bad', resigned: 'bad', inactive: 'bad', transferred: 'muted',
};
export const badge = (text, kind) =>
  `<span class="badge ${kind || STATUS[String(text).toLowerCase()] || 'muted'}">${esc(String(text).replace(/_/g, ' '))}</span>`;

/* ---------- forms ---------- */
// Field: {name,label,type,required,options,placeholder,min,max,step,maxlength,pattern,help,full,readonly,value}
export async function resolveFields(fields) {
  return Promise.all(fields.map(async (f) => (typeof f.options === 'function' ? { ...f, options: await f.options() } : f)));
}

function fieldHtml(f, v) {
  const id = `f_${f.name}`;
  const req = f.required ? ' required' : '';
  const ro = f.readonly ? ' readonly' : '';
  const help = f.help ? `<small class="help">${esc(f.help)}</small>` : '';
  const label = `<label for="${id}">${esc(f.label)}${f.required ? ' <i class="req">*</i>' : ''}</label>`;
  let ctl;
  if (f.type === 'checkbox') {
    return `<div class="field ${f.full ? 'full' : ''}"><label class="check" for="${id}"><input type="checkbox" id="${id}" name="${f.name}" ${v ? 'checked' : ''}><span>${esc(f.label)}</span></label>${help}</div>`;
  }
  if (f.type === 'textarea') {
    ctl = `<textarea class="input" id="${id}" name="${f.name}" rows="${f.rows || 3}" maxlength="${f.maxlength || 2000}" placeholder="${esc(f.placeholder || '')}"${req}${ro}>${esc(v)}</textarea>`;
  } else if (f.type === 'select') {
    const opts = (f.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    ctl = `<select class="input" id="${id}" name="${f.name}"${req}${f.disabled ? ' disabled' : ''}><option value="">${esc(f.blank ?? 'Select...')}</option>${opts}</select>`;
  } else if (f.type === 'multiselect') {
    const sel = Array.isArray(v) ? v : [];
    ctl = `<div class="chips" id="${id}">${(f.options || []).map((o) => `<label class="chip"><input type="checkbox" name="${f.name}" value="${esc(o.value)}" ${sel.includes(o.value) ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div>`;
  } else {
    const t = f.type || 'text';
    ctl = `<input class="input" id="${id}" name="${f.name}" type="${t}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}"
      ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''}
      maxlength="${f.maxlength || 200}" ${f.pattern ? `pattern="${f.pattern}"` : ''} autocomplete="${t === 'password' ? 'new-password' : 'off'}"${req}${ro}>`;
  }
  return `<div class="field ${f.full ? 'full' : ''}">${label}${ctl}${help}<small class="err" data-err="${f.name}"></small></div>`;
}

export function formHtml(fields, values = {}) {
  return `<form class="form-grid" novalidate autocomplete="off">${fields.filter((f) => !f.hidden).map((f) => fieldHtml(f, values[f.name] ?? f.value ?? '')).join('')}</form>`;
}

export function readForm(form, fields) {
  const values = {}; let ok = true;
  $$('.input.invalid', form).forEach((e) => e.classList.remove('invalid'));
  $$('[data-err]', form).forEach((e) => (e.textContent = ''));
  const bad = (f, msg) => { ok = false; const el = form.elements[f.name]; el?.classList?.add('invalid'); const s = form.querySelector(`[data-err="${f.name}"]`); if (s) s.textContent = msg; };
  for (const f of fields.filter((x) => !x.hidden)) {
    const el = form.elements[f.name];
    if (!el) continue;
    let v;
    if (f.type === 'checkbox') v = el.checked;
    else if (f.type === 'multiselect') v = $$(`input[name="${f.name}"]:checked`, form).map((x) => x.value);
    else { v = (el.value ?? '').trim(); if (v === '') v = null; }
    if (f.required && (v == null || (Array.isArray(v) && !v.length))) { bad(f, `${f.label} is required`); continue; }
    if (v != null && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { bad(f, 'Enter a valid email address'); continue; }
    if (v != null && f.type === 'number') {
      const n = Number(v);
      if (isNaN(n)) { bad(f, 'Enter a number'); continue; }
      if (f.min != null && n < f.min) { bad(f, `Must be at least ${f.min}`); continue; }
      if (f.max != null && n > f.max) { bad(f, `Must be at most ${f.max}`); continue; }
      v = n;
    }
    if (v != null && f.minlength && String(v).length < f.minlength) { bad(f, `Use at least ${f.minlength} characters`); continue; }
    if (v != null && f.pattern && !new RegExp(`^${f.pattern}$`).test(v)) { bad(f, f.patternMsg || 'Invalid format'); continue; }
    if (v != null && f.type === 'tel' && !/^[0-9+()\-\s]{5,30}$/.test(v)) { bad(f, 'Enter a valid phone number'); continue; }
    values[f.name] = v;
  }
  if (!ok) form.querySelector('.invalid')?.focus();
  return { ok, values };
}

/* ---------- tables ---------- */
export function tableHtml({ columns, rows, empty = 'Nothing here yet', emptyText = '', cls = '' }) {
  if (!rows.length) return emptyState(empty, emptyText);
  return `<div class="table-wrap"><table class="table ${cls}"><thead><tr>${columns.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.cls || ''}" data-label="${esc(c.label)}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* ---------- exports (SheetJS and jsPDF are loaded by the portal pages) ---------- */
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function exportExcel(name, rows) {
  if (!window.XLSX) return toast('Excel library did not load. Check your connection.', 'error');
  if (!rows.length) return toast('There is nothing to export.', 'info');
  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Report');
  window.XLSX.writeFile(wb, `${slug(name)}-${today()}.xlsx`);
}
export function exportPDF(title, rows) {
  if (!window.jspdf) return toast('PDF library did not load. Check your connection.', 'error');
  if (!rows.length) return toast('There is nothing to export.', 'info');
  const keys = Object.keys(rows[0]);
  const doc = new window.jspdf.jsPDF({ orientation: keys.length > 6 ? 'landscape' : 'portrait' });
  doc.setFontSize(15); doc.text(`${CONFIG.SCHOOL.name} - ${title}`, 14, 16);
  doc.setFontSize(9); doc.setTextColor(110); doc.text(`Generated ${new Date().toLocaleString()}`, 14, 22);
  doc.autoTable({ head: [keys], body: rows.map((r) => keys.map((k) => String(r[k] ?? ''))), startY: 27, styles: { fontSize: 8 }, headStyles: { fillColor: [14, 77, 74] } });
  doc.save(`${slug(title)}-${today()}.pdf`);
}
export const exportButtons = () =>
  `<button class="btn ghost sm" data-export="xlsx">${icon('download', 15)} Excel</button><button class="btn ghost sm" data-export="pdf">${icon('download', 15)} PDF</button>`;
export function wireExports(root, title, getRows) {
  root.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', async () => {
    try { const rows = await getRows(); b.dataset.export === 'xlsx' ? exportExcel(title, rows) : exportPDF(title, rows); } catch (e) { fail(e); }
  }));
}
