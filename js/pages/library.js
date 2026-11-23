// School library.
//  * Administrators keep the book catalogue, lend books to students and teachers, take them back and send overdue reminders.
//  * Students and teachers see their own loans and can browse what is on the shelf.
//  * Parents see the books their child has borrowed.
import { sb } from '../supabase.js';
import { must, lookup } from '../api.js';
import { crudPage } from '../crud.js';
import {
  $, $$, esc, icon, toast, fail, modal, setBusy, badge, tableHtml, emptyState, loadingBlock, errorBlock, formHtml, readForm, resolveFields,
  fmtDate, fmtMoney, today, debounce, pad,
} from '../ui.js';

const LOAN_DAYS = 14;
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isOverdue = (l) => !l.returned_on && l.due_on < today();
const daysLate = (l) => Math.max(0, Math.round((new Date(`${today()}T00:00:00`) - new Date(`${l.due_on}T00:00:00`)) / 86400000));
const loanBadge = (l) => (l.returned_on ? badge('returned', 'muted') : isOverdue(l) ? badge(`overdue ${daysLate(l)}d`, 'bad') : badge('on loan', 'info'));
const loanError = (e) => (e?.code === '23505' ? new Error('This borrower already has this book on loan.') : e);

/* =========================================================================
   Administrator
   ========================================================================= */
export function adminLibrary() {
  return async (view, ctx) => {
    view.innerHTML = `<div class="tabs" id="lib-tabs"><button class="tab active" data-t="books">Books</button><button class="tab" data-t="loans">Loans</button></div><div id="lib-pane"></div>`;
    const pane = $('#lib-pane', view);
    const show = async (t) => {
      $$('#lib-tabs .tab', view).forEach((b) => b.classList.toggle('active', b.dataset.t === t));
      pane.innerHTML = loadingBlock();
      try { await (t === 'books' ? booksPane(pane, ctx) : loansPane(pane)); } catch (e) { pane.innerHTML = errorBlock(e); }
    };
    $('#lib-tabs', view).onclick = (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.t); };
    await show('books');
  };
}

const booksPane = (pane, ctx) => crudPage({
  table: 'library_books', title: 'Library books', singular: 'book', plural: 'books', exportName: 'Library books',
  description: 'The catalogue. Lend a book with the arrow button; the count of copies on the shelf updates by itself.',
  select: '*, library_loans(id,returned_on)', search: ['title', 'author', 'isbn', 'category'], order: { col: 'title', asc: true },
  columns: [
    { label: 'Book', key: 'title', render: (r) => `<b>${esc(r.title)}</b><span class="sub">${esc(r.author || 'Unknown author')}${r.isbn ? ` | ISBN ${esc(r.isbn)}` : ''}</span>` },
    { label: 'Category', render: (r) => esc(r.category || '-') },
    { label: 'Shelf', render: (r) => esc(r.shelf || '-') },
    { label: 'Copies', cls: 'num', key: 'copies', render: (r) => r.copies },
    { label: 'On the shelf', cls: 'num', render: (r) => { const n = Math.max(0, r.copies - r.library_loans.filter((l) => !l.returned_on).length); return badge(`${n} of ${r.copies}`, n ? 'ok' : 'bad'); } },
  ],
  exportMap: (r) => ({ Title: r.title, Author: r.author || '', ISBN: r.isbn || '', Category: r.category || '', Shelf: r.shelf || '', Copies: r.copies, 'Out on loan': r.library_loans.filter((l) => !l.returned_on).length }),
  fields: [
    { name: 'title', label: 'Title', required: true, full: true, maxlength: 200 },
    { name: 'author', label: 'Author', maxlength: 150 },
    { name: 'isbn', label: 'ISBN', maxlength: 20 },
    { name: 'category', label: 'Category', maxlength: 60, placeholder: 'e.g. Fiction, Science, Reference' },
    { name: 'shelf', label: 'Shelf or location', maxlength: 40 },
    { name: 'copies', label: 'Copies owned', type: 'number', min: 0, max: 1000, required: true, value: 1 },
  ],
  deleteMessage: (r) => `Delete "${r.title}" and its loan history? This cannot be undone.`,
  rowActions: (r) => `<button class="icon-btn" data-act="lend" data-id="${r.id}" title="Lend this book" aria-label="Lend this book">${icon('send', 16)}</button>`,
  onAction: (act, row, { reload }) => { if (act === 'lend') lendBook(row, reload); },
})(pane, ctx);

async function lendBook(book, reload) {
  const fields = await resolveFields([
    { name: 'student_id', label: 'Lend to a student', type: 'select', blank: 'Choose a student', options: lookup('students', 'full_name', { extra: 'student_no', where: { status: 'active' }, format: (r) => `${r.full_name} (${r.student_no})` }) },
    { name: 'teacher_id', label: 'or to a teacher', type: 'select', blank: 'Choose a teacher', options: lookup('teachers', 'full_name') },
    { name: 'due_on', label: 'Due back on', type: 'date', required: true },
    { name: 'note', label: 'Note (optional)', full: true, maxlength: 300 },
  ]);
  const m = modal({
    title: `Lend: ${book.title}`, html: formHtml(fields, { due_on: addDays(today(), LOAN_DAYS) }),
    footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="lend-go">Lend book</button>`,
  });
  $('#lend-go', m.el).onclick = async (e) => {
    const { ok, values: v } = readForm($('form', m.el), fields);
    if (!ok) return;
    if (!!v.student_id === !!v.teacher_id) return toast('Choose either a student or a teacher', 'error');
    if (v.due_on < today()) return toast('The due date cannot be in the past', 'error');
    setBusy(e.currentTarget, true, 'Saving');
    try {
      await must(sb.from('library_loans').insert({ book_id: book.id, student_id: v.student_id || null, teacher_id: v.teacher_id || null, borrowed_on: today(), due_on: v.due_on, note: v.note }));
      toast('Book lent'); m.close(); reload();
    } catch (err) { fail(loanError(err)); setBusy(e.currentTarget, false); }
  };
}

async function loansPane(pane) {
  const state = { f: 'open', q: '' };
  pane.innerHTML = `<div class="page-head"><div><h2>Library loans</h2><p class="muted">Books that are out, overdue or returned.</p></div>
      <div class="head-actions"><button class="btn ghost" id="lib-remind">${icon('bell', 16)} Remind overdue borrowers</button></div></div>
    <div class="toolbar"><label class="search">${icon('search', 16)}<input id="lib-q" type="search" placeholder="Search book or borrower..." aria-label="Search loans"></label>
      <select class="input sm" id="lib-f" aria-label="Show"><option value="open">On loan</option><option value="overdue">Overdue</option><option value="returned">Returned</option><option value="all">All loans</option></select></div>
    <div class="card flush"><div id="lib-list">${loadingBlock()}</div></div>`;
  const list = $('#lib-list', pane);
  let rows = [];
  const name = (l) => l.students?.full_name || l.teachers?.full_name || '-';
  const draw = () => {
    const t = state.q.toLowerCase().trim();
    const shown = t ? rows.filter((l) => `${l.library_books?.title} ${name(l)}`.toLowerCase().includes(t)) : rows;
    list.innerHTML = tableHtml({
      columns: [
        { label: 'Book', render: (l) => `<b>${esc(l.library_books?.title || '-')}</b>` },
        { label: 'Borrower', render: (l) => `${esc(name(l))}<span class="sub">${l.students ? `Student ${esc(l.students.student_no || '')}` : 'Teacher'}</span>` },
        { label: 'Borrowed', render: (l) => fmtDate(l.borrowed_on) },
        { label: 'Due', render: (l) => fmtDate(l.due_on) },
        { label: 'Status', render: (l) => `${loanBadge(l)}${l.returned_on ? `<span class="sub">on ${fmtDate(l.returned_on)}${Number(l.fine_amount) ? ` | fine ${esc(fmtMoney(l.fine_amount))}` : ''}</span>` : ''}` },
        { label: '', cls: 'actions', render: (l) => (l.returned_on ? '' : `<button class="btn ghost sm" data-return="${l.id}">${icon('check', 15)} Return</button>`) },
      ],
      rows: shown, empty: t ? 'No matching loans' : 'No loans here', emptyText: t ? 'Try a different search.' : 'Lend a book from the Books tab.',
    });
  };
  const load = async () => {
    list.innerHTML = loadingBlock();
    try {
      let q = sb.from('library_loans').select('*, library_books(title), students(full_name,student_no), teachers(full_name)').order('due_on').limit(500);
      if (state.f === 'open') q = q.is('returned_on', null);
      else if (state.f === 'overdue') q = q.is('returned_on', null).lt('due_on', today());
      else if (state.f === 'returned') q = q.not('returned_on', 'is', null).order('returned_on', { ascending: false });
      rows = await must(q); draw();
    } catch (e) { list.innerHTML = errorBlock(e); $('[data-retry]', list)?.addEventListener('click', load); }
  };
  $('#lib-f', pane).onchange = (e) => { state.f = e.target.value; load(); };
  $('#lib-q', pane).oninput = debounce((e) => { state.q = e.target.value; draw(); }, 200);
  $('#lib-remind', pane).onclick = async (e) => {
    setBusy(e.currentTarget, true, 'Sending');
    try {
      const n = await must(sb.rpc('notify_overdue_loans'));
      toast(n ? `${n} reminder${n === 1 ? '' : 's'} sent` : 'No new reminders to send today', n ? 'success' : 'info');
    } catch (err) { fail(err); } finally { setBusy(e.currentTarget, false); }
  };
  list.onclick = (e) => {
    const b = e.target.closest('[data-return]'); if (!b) return;
    const l = rows.find((x) => x.id === b.dataset.return); if (l) returnBook(l, load);
  };
  await load();
}

function returnBook(loan, reload) {
  const late = isOverdue(loan);
  const fields = [{ name: 'fine_amount', label: 'Fine charged (optional)', type: 'number', min: 0, max: 100000, step: '0.01', help: late ? `This book is ${daysLate(loan)} day${daysLate(loan) === 1 ? '' : 's'} overdue.` : '' }];
  const m = modal({
    title: `Return: ${loan.library_books?.title || 'book'}`, size: 'sm', html: formHtml(fields, { fine_amount: 0 }),
    footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="ret-go">Mark returned</button>`,
  });
  $('#ret-go', m.el).onclick = async (e) => {
    const { ok, values } = readForm($('form', m.el), fields);
    if (!ok) return;
    setBusy(e.currentTarget, true, 'Saving');
    try {
      const done = await must(sb.from('library_loans').update({ returned_on: today(), fine_amount: values.fine_amount || 0 }).eq('id', loan.id).select('id'));
      if (!done.length) throw new Error('You do not have permission to change this loan.');
      toast('Book returned'); m.close(); reload();
    } catch (err) { fail(err); setBusy(e.currentTarget, false); }
  };
}

/* =========================================================================
   Student, teacher and parent: loans (and, optionally, browse the shelf)
   ========================================================================= */
export async function libraryView(view, { studentId = null, teacherId = null, browse = true } = {}) {
  const base = sb.from('library_loans').select('*, library_books(title,author)').order('borrowed_on', { ascending: false }).limit(200);
  const loans = await must(studentId ? base.eq('student_id', studentId) : base.eq('teacher_id', teacherId));
  const out = loans.filter((l) => !l.returned_on), late = out.filter(isOverdue);
  const who = studentId && !browse ? 'your child' : 'you';
  view.innerHTML = `<div class="page-head"><div><h2>Library</h2><p class="muted">Books ${who === 'you' ? 'you have' : 'your child has'} borrowed${browse ? ' and what is on the shelf' : ''}.</p></div></div>
    <div class="stats">
      <div class="stat info"><span class="ico">${icon('book', 22)}</span><div><b>${out.length}</b><span>On loan</span></div></div>
      <div class="stat ${late.length ? 'bad' : 'ok'}"><span class="ico">${icon('clock', 22)}</span><div><b>${late.length}</b><span>Overdue</span></div></div>
    </div>
    ${browse ? `<div class="tabs" id="lb-tabs"><button class="tab active" data-t="mine">My loans</button><button class="tab" data-t="shelf">Browse books</button></div>` : ''}
    <div id="lb-pane"></div>`;
  const pane = $('#lb-pane', view);
  const mine = () => {
    pane.innerHTML = `<div class="card flush">${tableHtml({
      columns: [
        { label: 'Book', render: (l) => `<b>${esc(l.library_books?.title || '-')}</b><span class="sub">${esc(l.library_books?.author || '')}</span>` },
        { label: 'Borrowed', render: (l) => fmtDate(l.borrowed_on) },
        { label: 'Due back', render: (l) => fmtDate(l.due_on) },
        { label: 'Status', render: (l) => `${loanBadge(l)}${l.returned_on ? `<span class="sub">returned ${fmtDate(l.returned_on)}</span>` : ''}` },
        { label: 'Fine', cls: 'num', render: (l) => (Number(l.fine_amount) ? esc(fmtMoney(l.fine_amount)) : '-') },
      ],
      rows: loans, empty: 'No library loans yet', emptyText: browse ? 'Visit the library to borrow a book. You can browse what is available in the next tab.' : 'Books borrowed from the school library will appear here.',
    })}</div>`;
  };
  const shelf = async () => {
    pane.innerHTML = loadingBlock();
    try {
      const books = await must(sb.from('library_catalog').select('id,title,author,category,shelf,copies,available').order('title').limit(1000));
      pane.innerHTML = `<div class="toolbar"><label class="search">${icon('search', 16)}<input id="lb-q" type="search" placeholder="Search by title, author or category..." aria-label="Search books"></label></div><div class="card flush" id="lb-books"></div>`;
      const draw = (t = '') => {
        const s = t.toLowerCase().trim();
        const shown = s ? books.filter((b) => `${b.title} ${b.author || ''} ${b.category || ''}`.toLowerCase().includes(s)) : books;
        $('#lb-books', pane).innerHTML = tableHtml({
          columns: [
            { label: 'Book', render: (b) => `<b>${esc(b.title)}</b><span class="sub">${esc(b.author || '')}</span>` },
            { label: 'Category', render: (b) => esc(b.category || '-') },
            { label: 'Shelf', render: (b) => esc(b.shelf || '-') },
            { label: 'Available', render: (b) => (b.available > 0 ? badge(`${b.available} on the shelf`, 'ok') : badge('all out', 'bad')) },
          ], rows: shown, empty: s ? 'No matching books' : 'The library has no books yet',
        });
      };
      draw();
      $('#lb-q', pane).oninput = debounce((e) => draw(e.target.value), 200);
    } catch (e) { pane.innerHTML = errorBlock(e); }
  };
  mine();
  const tabs = $('#lb-tabs', view);
  if (tabs) tabs.onclick = (e) => { const b = e.target.closest('.tab'); if (!b) return; $$('.tab', tabs).forEach((x) => x.classList.toggle('active', x === b)); (b.dataset.t === 'shelf' ? shelf : mine)(); };
}
