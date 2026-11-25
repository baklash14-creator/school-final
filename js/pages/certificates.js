// Certificates: administrators issue them, students and parents view and print them.
// Each certificate carries a QR code and a short code that anyone can check on verify.html.
import { sb } from '../supabase.js';
import { must, lookup } from '../api.js';
import { CONFIG } from '../config.js';
import { crudPage } from '../crud.js';
import { showPrintable } from './shared.js';
import { $, esc, icon, toast, fail, badge, tableHtml, loadingBlock, errorBlock, fmtDate, today, LOGO } from '../ui.js';

export const CERT_KINDS = [['merit', 'Certificate of Merit'], ['completion', 'Certificate of Completion'], ['attendance', 'Perfect Attendance'], ['conduct', 'Good Conduct'], ['sports', 'Sports Achievement'], ['custom', 'Certificate']];
const kindLabel = (k) => (CERT_KINDS.find((x) => x[0] === k) || [, 'Certificate'])[1];
const verifyUrl = (code) => new URL(`verify.html?c=${encodeURIComponent(code)}`, location.href).href;

let qrLoading = null;
function loadQr() {
  if (window.qrcode) return Promise.resolve(true);
  if (!qrLoading) {
    qrLoading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
      s.onload = () => resolve(!!window.qrcode); s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  return qrLoading;
}
async function fillQr(root, text) {
  const box = $('.cert-qr', root); if (!box) return;
  if (!(await loadQr())) return; // the printed code and address still work without the picture
  const q = window.qrcode(0, 'M'); q.addData(text); q.make();
  box.innerHTML = q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
}

export function certHtml(c, student) {
  return `<div class="paper print-area cert">
    <div class="cert-in">
      <span class="cert-logo">${LOGO}</span>
      <h3>${esc(CONFIG.SCHOOL.name)}</h3>
      <p class="cert-kind">${esc(kindLabel(c.kind))}</p>
      <p class="cert-small">This is proudly presented to</p>
      <h1 class="cert-name">${esc(student?.full_name || '')}</h1>
      <p class="cert-title">${esc(c.title)}</p>
      ${c.citation ? `<p class="cert-cit">${esc(c.citation)}</p>` : ''}
      <div class="cert-foot"><span><b>${esc(fmtDate(c.issued_on))}</b><small>Date</small></span>
        <span class="cert-verify"><span class="cert-qr" aria-hidden="true"></span><small>Verify: ${esc(verifyUrl(c.code).replace(/^https?:\/\//, ''))}</small><small>Code ${esc(c.code)}</small></span>
        <span><b>&nbsp;</b><small>Head teacher</small></span></div>
    </div></div>`;
}

export function showCertificate(c, student) {
  const m = showPrintable(c.title, certHtml(c, student));
  fillQr(m.el, verifyUrl(c.code));
}

export function adminCertificates() {
  return crudPage({
    table: 'certificates', title: 'Certificates', singular: 'certificate', plural: 'certificates', exportName: 'Certificates',
    description: 'Issue certificates for achievements. Students and parents are notified and can print them; each one can be verified online.',
    select: '*, students(full_name, student_no)', search: ['title', 'code'], order: { col: 'issued_on', asc: false },
    filters: [{ name: 'kind', label: 'All kinds', options: CERT_KINDS.map(([value, label]) => ({ value, label })) }],
    columns: [
      { label: 'Student', render: (r) => `<b>${esc(r.students?.full_name || '-')}</b><span class="sub">${esc(r.students?.student_no || '')}</span>` },
      { label: 'Certificate', render: (r) => `${esc(r.title)}<span class="sub">${esc(kindLabel(r.kind))}</span>` },
      { label: 'Issued', render: (r) => fmtDate(r.issued_on) },
      { label: 'Code', render: (r) => `<code>${esc(r.code)}</code>` },
      { label: 'Status', render: (r) => (r.revoked_at ? badge('revoked', 'bad') : badge('valid', 'ok')) },
    ],
    exportMap: (r) => ({ Student: r.students?.full_name || '', Title: r.title, Kind: kindLabel(r.kind), Issued: r.issued_on, Code: r.code, Status: r.revoked_at ? 'revoked' : 'valid' }),
    fields: [
      { name: 'student_id', label: 'Student', type: 'select', blank: 'Choose a student', required: true, lockOnEdit: true, full: true, options: lookup('students', 'full_name', { extra: 'student_no', where: { status: 'active' }, format: (r) => `${r.full_name} (${r.student_no})` }) },
      { name: 'kind', label: 'Type', type: 'select', required: true, options: CERT_KINDS.map(([value, label]) => ({ value, label })) },
      { name: 'issued_on', label: 'Date', type: 'date', required: true },
      { name: 'title', label: 'Awarded for', required: true, full: true, maxlength: 120, placeholder: 'e.g. Best in Mathematics, Term 1' },
      { name: 'citation', label: 'Citation (optional)', type: 'textarea', full: true, maxlength: 500 },
    ],
    defaults: () => ({ kind: 'merit', issued_on: today() }),
    rowActions: (r) => `<button class="icon-btn" data-act="print" data-id="${r.id}" title="View and print" aria-label="View and print">${icon('printer', 16)}</button>
      <button class="icon-btn" data-act="revoke" data-id="${r.id}" title="${r.revoked_at ? 'Restore' : 'Revoke'}" aria-label="${r.revoked_at ? 'Restore' : 'Revoke'}">${icon(r.revoked_at ? 'refresh' : 'lock', 16)}</button>`,
    onAction: async (act, row, { reload }) => {
      if (act === 'print') return showCertificate(row, row.students);
      if (act === 'revoke') {
        try { await must(sb.from('certificates').update({ revoked_at: row.revoked_at ? null : new Date().toISOString() }).eq('id', row.id)); toast(row.revoked_at ? 'Certificate restored' : 'Certificate revoked'); reload(); } catch (e) { fail(e); }
      }
    },
    deleteMessage: (r) => `Delete the certificate "${r.title}"? Its code will stop working. Revoke it instead if you want the record kept.`,
  });
}

export async function certificatesView(view, student) {
  view.innerHTML = loadingBlock();
  try {
    const rows = await must(sb.from('certificates').select('*').eq('student_id', student.id).is('revoked_at', null).order('issued_on', { ascending: false }).limit(100));
    view.innerHTML = `<div class="page-head"><div><h2>Certificates</h2><p class="muted">Awards from the school. Print them or share the QR code to prove they are real.</p></div></div>
      <div class="card flush" id="ct-list">${tableHtml({
        columns: [
          { label: 'Certificate', render: (c) => `<b>${esc(c.title)}</b><span class="sub">${esc(kindLabel(c.kind))}</span>` },
          { label: 'Issued', render: (c) => fmtDate(c.issued_on) },
          { label: '', cls: 'actions', render: (c) => `<button class="btn ghost sm" data-c="${c.id}">${icon('eye', 15)} View</button>` },
        ], rows, empty: 'No certificates yet', emptyText: 'Certificates the school gives will appear here.',
      })}</div>`;
    $('#ct-list', view).onclick = (e) => { const b = e.target.closest('[data-c]'); const c = b && rows.find((x) => x.id === b.dataset.c); if (c) showCertificate(c, student); };
  } catch (e) { view.innerHTML = errorBlock(e); }
}
