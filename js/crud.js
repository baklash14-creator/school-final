// Reusable list + create/edit/delete page driven by a small config object.
// Used by students, teachers, parents, classes, subjects, fees, announcements and more.
import { sb } from './supabase.js';
import { must, clearLookups } from './api.js';
import {
  $, $$, esc, icon, debounce, toast, fail, modal, confirmBox, setBusy, formHtml, readForm, resolveFields,
  tableHtml, emptyState, loadingBlock, errorBlock, exportButtons, wireExports,
} from './ui.js';

export function crudPage(cfg) {
  const c = {
    select: '*', pageSize: 15, search: [], filters: [], order: { col: 'created_at', asc: false },
    canCreate: true, canEdit: true, canDelete: true, ...cfg,
  };

  return async function render(view, ctx) {
    const state = { page: 0, q: '', filters: {}, count: 0, rows: [] };

    // resolve filter dropdowns once
    const filters = await Promise.all((c.filters || []).map(async (f) => ({ ...f, options: typeof f.options === 'function' ? await f.options() : f.options })));

    view.innerHTML = `
      <div class="page-head">
        <div><h2>${esc(c.title)}</h2>${c.description ? `<p class="muted">${esc(c.description)}</p>` : ''}</div>
        <div class="head-actions">
          ${c.exportName ? exportButtons() : ''}
          ${c.headerExtra || ''}
          ${c.canCreate ? `<button class="btn primary" id="add">${icon('plus', 16)} ${esc(c.createLabel || 'Add ' + (c.singular || 'record'))}</button>` : ''}
        </div>
      </div>
      <div class="toolbar">
        ${c.search.length ? `<label class="search">${icon('search', 16)}<input id="q" type="search" placeholder="${esc(c.searchPlaceholder || 'Search...')}" aria-label="Search"></label>` : ''}
        ${filters.map((f) => `<select class="input sm" data-filter="${f.name}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}</option>${f.options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`).join('')}
        ${c.toolbar || ''}
      </div>
      <div class="card flush"><div id="list">${loadingBlock()}</div></div>
      <div class="pager" id="pager"></div>`;

    const list = $('#list', view);
    const pager = $('#pager', view);

    function buildQuery(all) {
      let q = sb.from(c.table).select(c.select, { count: 'exact' });
      const term = state.q.replace(/[%,()'"\\]/g, ' ').trim();
      if (term && c.search.length) q = q.or(c.search.map((col) => `${col}.ilike.%${term}%`).join(','));
      for (const [k, v] of Object.entries(state.filters)) if (v) q = q.eq(k, v);
      if (c.baseFilter) q = c.baseFilter(q, ctx);
      q = q.order(c.order.col, { ascending: c.order.asc });
      return all ? q.limit(5000) : q.range(state.page * c.pageSize, state.page * c.pageSize + c.pageSize - 1);
    }

    async function load() {
      list.innerHTML = loadingBlock();
      try {
        const { data, error, count } = await buildQuery(false);
        if (error) throw error;
        if (c.afterLoad) await c.afterLoad(data, ctx);
        state.rows = data; state.count = count ?? data.length;
        const cols = [...c.columns];
        if (c.canEdit || c.canDelete || c.rowActions) {
          cols.push({
            label: '', cls: 'actions', render: (r) => `<div class="row-actions">${c.rowActions ? c.rowActions(r, ctx) : ''}
              ${c.canEdit && (!c.editable || c.editable(r, ctx)) ? `<button class="icon-btn" data-act="edit" data-id="${r.id}" title="Edit" aria-label="Edit">${icon('edit', 16)}</button>` : ''}
              ${c.canDelete && (!c.deletable || c.deletable(r, ctx)) ? `<button class="icon-btn danger" data-act="delete" data-id="${r.id}" title="Delete" aria-label="Delete">${icon('trash', 16)}</button>` : ''}</div>`,
          });
        }
        const filtered = state.q || Object.values(state.filters).some(Boolean);
        list.innerHTML = tableHtml({
          columns: cols, rows: data,
          empty: filtered ? 'No matching records' : `No ${(c.plural || c.title).toLowerCase()} yet`,
          emptyText: filtered ? 'Try a different search or clear the filters.' : (c.emptyText || (c.canCreate ? `Use the Add button to create the first one.` : '')),
        });
        const from = state.count ? state.page * c.pageSize + 1 : 0;
        const to = Math.min(state.count, (state.page + 1) * c.pageSize);
        pager.innerHTML = state.count > c.pageSize
          ? `<span class="muted">Showing ${from}-${to} of ${state.count}</span><div><button class="btn ghost sm" data-pg="-1" ${state.page === 0 ? 'disabled' : ''}>Previous</button><button class="btn ghost sm" data-pg="1" ${to >= state.count ? 'disabled' : ''}>Next</button></div>`
          : (state.count ? `<span class="muted">${state.count} ${state.count === 1 ? 'record' : 'records'}</span>` : '');
      } catch (e) {
        console.error(e);
        list.innerHTML = errorBlock(e);
        $('[data-retry]', list)?.addEventListener('click', load);
      }
    }

    async function openForm(row) {
      const fields = (await resolveFields(c.fields)).map((f) => ({
        ...f,
        hidden: (!row && f.hideOnCreate) || (row && f.hideOnEdit),
        readonly: f.readonly || (row && f.lockOnEdit),
        disabled: row && f.lockOnEdit,
      }));
      const initial = row ? (c.toForm ? c.toForm(row) : row) : (c.defaults ? await c.defaults() : {});
      const m = modal({
        title: row ? `Edit ${c.singular || 'record'}` : `Add ${c.singular || 'record'}`,
        size: c.formSize || 'md',
        html: formHtml(fields, initial),
        footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="save">Save</button>`,
      });
      const form = $('form', m.el);
      const save = $('#save', m.el);
      const submit = async () => {
        const { ok, values } = readForm(form, fields);
        if (!ok) return;
        const extras = { ...values };
        fields.filter((f) => f.noSave).forEach((f) => delete values[f.name]);
        setBusy(save, true, 'Saving');
        try {
          const payload = c.beforeSave ? await c.beforeSave(values, row, !row, ctx) : values;
          const saved = row
            ? await must(sb.from(c.table).update(payload).eq('id', row.id).select().single())
            : await must(sb.from(c.table).insert(payload).select().single());
          if (c.afterSave) await c.afterSave(saved, row, !row, ctx, extras);
          toast(`${c.singular || 'Record'} ${row ? 'updated' : 'created'} successfully`);
          clearLookups(); m.close(); load();
        } catch (e) { fail(e); setBusy(save, false); }
      };
      save.onclick = submit;
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    }

    // events
    $('#add', view)?.addEventListener('click', () => openForm(null));
    $('#q', view)?.addEventListener('input', debounce((e) => { state.q = e.target.value; state.page = 0; load(); }, 300));
    $$('[data-filter]', view).forEach((s) => s.addEventListener('change', () => { state.filters[s.dataset.filter] = s.value; state.page = 0; load(); }));
    pager.addEventListener('click', (e) => { const b = e.target.closest('[data-pg]'); if (b) { state.page += Number(b.dataset.pg); load(); } });
    list.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const row = state.rows.find((r) => r.id === b.dataset.id); if (!row) return;
      if (b.dataset.act === 'edit') return openForm(row);
      if (b.dataset.act === 'delete') {
        const ok = await confirmBox({ title: `Delete ${c.singular || 'record'}?`, message: c.deleteMessage ? c.deleteMessage(row) : 'This cannot be undone.', confirmText: 'Delete', danger: true });
        if (!ok) return;
        try {
          if (c.beforeDelete) await c.beforeDelete(row, ctx);
          const gone = await must(sb.from(c.table).delete().eq('id', row.id).select('id'));
          if (!gone.length) throw new Error('You do not have permission to delete this record.');
          clearLookups(); toast(`${c.singular || 'Record'} deleted`); load();
        } catch (err) { fail(err); }
        return;
      }
      c.onAction?.(b.dataset.act, row, { ctx, reload: load, view });
    });
    c.onMount?.(view, { ctx, reload: load, openForm });
    if (c.exportName) {
      wireExports(view, c.exportName, async () => {
        const { data, error } = await buildQuery(true);
        if (error) throw error;
        return data.map(c.exportMap || ((r) => Object.fromEntries(c.columns.filter((col) => col.key).map((col) => [col.label, r[col.key] ?? '']))));
      });
    }
    await load();
  };
}
