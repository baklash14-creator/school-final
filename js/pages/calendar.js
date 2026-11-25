// School calendar: a month view for everyone, and event management for administrators.
//  * Events can be for everyone or for teachers, students or parents only (the database enforces this).
//  * Tick "Notify" when adding an event to send an in-app notification to its audience.
import { sb } from '../supabase.js';
import { must } from '../api.js';
import { crudPage } from '../crud.js';
import { $, $$, esc, icon, badge, tableHtml, loadingBlock, errorBlock, fmtDate, today, pad } from '../ui.js';

export const KINDS = [['event', 'Event'], ['holiday', 'Holiday'], ['exam', 'Exam'], ['meeting', 'Meeting'], ['deadline', 'Deadline'], ['term', 'Term dates']];
const kindLabel = (k) => (KINDS.find((x) => x[0] === k) || [, k])[1];
const TONE = { event: 'info', holiday: 'ok', exam: 'bad', meeting: 'warn', deadline: 'warn', term: 'muted' };
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const AUD = { all: 'Everyone', teacher: 'Teachers', student: 'Students', parent: 'Parents' };
const audLabel = (a) => (a || ['all']).map((x) => AUD[x] || x).join(', ');

export async function calendarView(view) {
  const now = new Date();
  const st = { y: now.getFullYear(), m: now.getMonth(), pick: today() };
  view.innerHTML = loadingBlock();
  const draw = async () => {
    const first = iso(st.y, st.m, 1), last = iso(st.y, st.m, new Date(st.y, st.m + 1, 0).getDate());
    let events;
    try { events = await must(sb.from('school_events').select('*').lte('starts_on', last).gte('ends_on', first).order('starts_on').limit(500)); }
    catch (e) { view.innerHTML = errorBlock(e); return; }
    const upcoming = await must(sb.from('school_events').select('*').gte('ends_on', today()).order('starts_on').limit(6)).catch(() => []);
    const on = (d) => events.filter((e) => e.starts_on <= d && e.ends_on >= d);
    const lead = (new Date(st.y, st.m, 1).getDay() + 6) % 7; // Monday first
    const days = new Date(st.y, st.m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell blank"></div>');
    for (let d = 1; d <= days; d++) {
      const ds = iso(st.y, st.m, d), ev = on(ds);
      cells.push(`<button class="cal-cell ${ds === today() ? 'today' : ''} ${ds === st.pick ? 'picked' : ''}" data-d="${ds}" aria-label="${fmtDate(ds)}${ev.length ? `, ${ev.length} event${ev.length > 1 ? 's' : ''}` : ''}">
        <span class="n">${d}</span>${ev.slice(0, 2).map((e) => `<span class="cal-ev ${TONE[e.kind] || 'info'}">${esc(e.title)}</span>`).join('')}${ev.length > 2 ? `<span class="cal-more">+${ev.length - 2} more</span>` : ''}</button>`);
    }
    const picked = on(st.pick);
    view.innerHTML = `<div class="page-head"><div><h2>School calendar</h2><p class="muted">Terms, exams, holidays and events.</p></div></div>
      <div class="grid cols-2 cal-wrap"><div class="card">
        <div class="cal-nav"><button class="icon-btn" id="cal-prev" aria-label="Previous month">${icon('up', 16)}</button><b>${new Date(st.y, st.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
          <button class="icon-btn" id="cal-next" aria-label="Next month">${icon('up', 16)}</button><button class="btn ghost sm" id="cal-today">Today</button></div>
        <div class="cal-grid"><div class="cal-dow">Mon</div><div class="cal-dow">Tue</div><div class="cal-dow">Wed</div><div class="cal-dow">Thu</div><div class="cal-dow">Fri</div><div class="cal-dow">Sat</div><div class="cal-dow">Sun</div>${cells.join('')}</div></div>
        <div><div class="card"><div class="card-head"><h3>${esc(fmtDate(st.pick))}</h3></div>${picked.length ? `<div class="list">${picked.map(evItem).join('')}</div>` : '<p class="muted">Nothing planned for this day.</p>'}</div>
          <div class="card"><div class="card-head"><h3>Coming up</h3></div>${upcoming.length ? `<div class="list">${upcoming.map(evItem).join('')}</div>` : '<p class="muted">No upcoming events.</p>'}</div></div></div>`;
    $('#cal-prev', view).onclick = () => { st.m--; if (st.m < 0) { st.m = 11; st.y--; } draw(); };
    $('#cal-next', view).onclick = () => { st.m++; if (st.m > 11) { st.m = 0; st.y++; } draw(); };
    $('#cal-today', view).onclick = () => { st.y = now.getFullYear(); st.m = now.getMonth(); st.pick = today(); draw(); };
    $$('.cal-cell[data-d]', view).forEach((c) => (c.onclick = () => { st.pick = c.dataset.d; draw(); }));
  };
  await draw();
}

const evItem = (e) => `<div class="list-item"><div><b>${esc(e.title)}</b><span class="sub">${e.starts_on === e.ends_on ? fmtDate(e.starts_on) : `${fmtDate(e.starts_on)} to ${fmtDate(e.ends_on)}`}${e.location ? ` | ${esc(e.location)}` : ''}</span>${e.description ? `<span class="sub">${esc(e.description)}</span>` : ''}</div>${badge(kindLabel(e.kind), TONE[e.kind] || 'info')}</div>`;

export function adminCalendar() {
  return async (view, ctx) => {
    view.innerHTML = `<div class="tabs" id="cal-tabs"><button class="tab active" data-t="view">Calendar</button><button class="tab" data-t="manage">Manage events</button></div><div id="cal-pane"></div>`;
    const pane = $('#cal-pane', view);
    const show = async (t) => {
      $$('#cal-tabs .tab', view).forEach((b) => b.classList.toggle('active', b.dataset.t === t));
      pane.innerHTML = loadingBlock();
      try { await (t === 'view' ? calendarView(pane) : manage(pane, ctx)); } catch (e) { pane.innerHTML = errorBlock(e); }
    };
    $('#cal-tabs', view).onclick = (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.t); };
    await show('view');
  };
}

const manage = (pane, ctx) => crudPage({
  table: 'school_events', title: 'Calendar events', singular: 'event', plural: 'events', exportName: 'School events',
  description: 'Add exams, holidays, term dates and school events. Tick "Send a notification" to tell the audience straight away.',
  select: '*', search: ['title', 'location'], order: { col: 'starts_on', asc: false },
  filters: [{ name: 'kind', label: 'All kinds', options: KINDS.map(([value, label]) => ({ value, label })) }],
  columns: [
    { label: 'Event', render: (r) => `<b>${esc(r.title)}</b>${r.location ? `<span class="sub">${esc(r.location)}</span>` : ''}` },
    { label: 'Kind', render: (r) => badge(kindLabel(r.kind), TONE[r.kind] || 'info') },
    { label: 'When', render: (r) => (r.starts_on === r.ends_on ? fmtDate(r.starts_on) : `${fmtDate(r.starts_on)} to ${fmtDate(r.ends_on)}`) },
    { label: 'For', render: (r) => esc(audLabel(r.audience)) },
  ],
  exportMap: (r) => ({ Title: r.title, Kind: kindLabel(r.kind), From: r.starts_on, To: r.ends_on, Location: r.location || '', For: audLabel(r.audience) }),
  fields: [
    { name: 'title', label: 'Title', required: true, full: true, maxlength: 150 },
    { name: 'kind', label: 'Kind', type: 'select', required: true, options: KINDS.map(([value, label]) => ({ value, label })) },
    { name: 'location', label: 'Location', maxlength: 120 },
    { name: 'starts_on', label: 'Starts on', type: 'date', required: true },
    { name: 'ends_on', label: 'Ends on', type: 'date', required: true },
    { name: 'audience', label: 'Who can see it', type: 'multiselect', required: true, full: true, options: Object.entries(AUD).map(([value, label]) => ({ value, label })) },
    { name: 'description', label: 'Details (optional)', type: 'textarea', full: true, maxlength: 1000 },
    { name: 'notify', label: 'Send a notification when saved (new events only)', type: 'checkbox', hideOnEdit: true },
  ],
  defaults: () => ({ kind: 'event', starts_on: today(), ends_on: today(), audience: ['all'], notify: false }),
  beforeSave: (v) => {
    if (!v.ends_on) v.ends_on = v.starts_on;
    if (v.ends_on < v.starts_on) throw new Error('The end date cannot be before the start date.');
    if (v.audience.includes('all')) v.audience = ['all'];
    return v;
  },
  deleteMessage: (r) => `Delete "${r.title}" from the calendar?`,
})(pane, ctx);
