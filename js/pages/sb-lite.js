// Shared helpers for the Alumni, Payroll and Leave tabs.
// Save as: js/pages/sb-lite.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://piojryombpoyrrfkrgew.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_zIzeeT7lTCErY0131aEPuQ_Iu7-Iwjb'; // publishable key (safe for the browser)

// Put your currency here, e.g. 'Le', 'USD', 'GHS'. Shown next to amounts and on payslips.
export const CURRENCY = '';

// One shared client. It reuses the admin/teacher login session but never refreshes tokens itself.
export const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
});

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export const fmtDate = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }); } catch { return ''; }
};

export const fmtDateTime = (iso) => {
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; }
};

export const money = (n) =>
  `${CURRENCY ? CURRENCY + ' ' : ''}${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const monthLabel = (period) => {
  const [y, m] = String(period).split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
};

export const leaveDays = (start, end) =>
  Math.round((new Date(end) - new Date(start)) / 86400000) + 1;

export async function currentUserId() {
  const { data } = await db.auth.getSession();
  return data?.session?.user?.id || null;
}

export const badge = (text, kind) => {
  const colors = {
    pending: ['#fef3c7', '#92400e'],
    draft: ['#fef3c7', '#92400e'],
    approved: ['#dcfce7', '#166534'],
    paid: ['#dcfce7', '#166534'],
    rejected: ['#fee2e2', '#991b1b'],
  };
  const [bg, fg] = colors[kind || text] || ['#e5e7eb', '#374151'];
  return `<span style="background:${bg};color:${fg};border-radius:999px;padding:3px 10px;font-size:.85em;text-transform:capitalize;white-space:nowrap">${esc(text)}</span>`;
};

// ---- Payslip PDF (loads jsPDF on demand if the page doesn't already have it) ----
export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

export async function ensurePdf() {
  if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const probe = new window.jspdf.jsPDF();
  if (typeof probe.autoTable !== 'function') {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
  }
  return window.jspdf.jsPDF;
}

export async function downloadPayslip({ name, staffNo, jobTitle }, slip) {
  const JsPDF = await ensurePdf();
  const doc = new JsPDF();
  const cur = (n) => money(n);

  doc.setFontSize(20); doc.setFont(undefined, 'bold');
  doc.text('Bakarr School', 14, 20);
  doc.setFontSize(12); doc.setFont(undefined, 'normal');
  doc.text(`Payslip - ${monthLabel(slip.period)}`, 14, 28);

  doc.setFontSize(11);
  doc.text(`Name: ${name || '-'}`, 14, 42);
  doc.text(`Staff no: ${staffNo || '-'}`, 14, 49);
  doc.text(`Position: ${jobTitle || '-'}`, 14, 56);
  doc.text(`Status: ${slip.status === 'paid' ? 'Paid' + (slip.paid_on ? ' on ' + fmtDate(slip.paid_on) : '') : 'Draft'}`, 14, 63);

  doc.autoTable({
    startY: 72,
    head: [['Description', 'Amount']],
    body: [
      ['Basic salary', cur(slip.basic)],
      ['Allowances', cur(slip.allowances)],
      ['Deductions', '-' + cur(slip.deductions)],
    ],
    foot: [['Net pay', cur(slip.net_pay ?? (Number(slip.basic) + Number(slip.allowances) - Number(slip.deductions)))]],
    styles: { fontSize: 11 },
    columnStyles: { 1: { halign: 'right' } },
    footStyles: { fontStyle: 'bold' },
  });

  if (slip.note) {
    const y = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(10);
    doc.text(`Note: ${slip.note}`, 14, y);
  }

  doc.save(`payslip-${String(name || 'staff').replace(/\s+/g, '-').toLowerCase()}-${slip.period}.pdf`);
}
