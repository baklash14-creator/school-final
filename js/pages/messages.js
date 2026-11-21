// In-app messaging between admins, teachers, parents and students.
// Who may write to whom is enforced by the database (can_message_user).
import { sb } from '../supabase.js';
import { must } from '../api.js';
import { ROLE_LABEL } from '../auth.js';
import { $, $$, esc, icon, toast, fail, modal, setBusy, loadingBlock, errorBlock, emptyState, fmtDateTime, initials } from '../ui.js';

let channel = null;

export async function messagesView(view, ctx) {
  const me = ctx.user.id;
  view.innerHTML = `<div class="page-head"><div><h2>Messages</h2><p class="muted">Private messages with teachers, parents and the school office.</p></div>
    <div class="head-actions"><button class="btn primary" id="ms-new">${icon('plus', 16)} New message</button></div></div>
    <div class="msg-layout" id="ms-wrap"><aside class="msg-list card flush" id="ms-list">${loadingBlock()}</aside><section class="msg-thread card flush" id="ms-thread"></section></div>`;
  const wrap = $('#ms-wrap', view), listEl = $('#ms-list', view), threadEl = $('#ms-thread', view);
  let convos = new Map(), openId = null;

  async function load(keepOpen = true) {
    try {
      const rows = await must(sb.from('messages').select('*').or(`sender_id.eq.${me},recipient_id.eq.${me}`).order('created_at', { ascending: true }).limit(1000));
      convos = new Map();
      rows.forEach((m) => {
        const mine = m.sender_id === me, other = mine ? m.recipient_id : m.sender_id;
        const c = convos.get(other) || { id: other, name: mine ? m.recipient_name : m.sender_name, role: mine ? m.recipient_role : m.sender_role, msgs: [], unread: 0 };
        c.msgs.push(m); if (!mine && !m.is_read) c.unread++;
        if (!mine) { c.name = m.sender_name || c.name; c.role = m.sender_role || c.role; }
        convos.set(other, c);
      });
      drawList();
      if (keepOpen && openId && convos.has(openId)) drawThread(openId, false); else if (!openId) threadEl.innerHTML = emptyState('Select a conversation', 'Or start a new message.', 'mail');
    } catch (e) { listEl.innerHTML = errorBlock(e); $('[data-retry]', listEl)?.addEventListener('click', () => load()); }
  }
  function drawList() {
    const items = [...convos.values()].sort((a, b) => b.msgs.at(-1).created_at.localeCompare(a.msgs.at(-1).created_at));
    listEl.innerHTML = items.length ? items.map((c) => { const last = c.msgs.at(-1); return `<button class="msg-item ${c.id === openId ? 'on' : ''} ${c.unread ? 'unread' : ''}" data-c="${c.id}">
      <span class="avatar">${esc(initials(c.name || '?'))}</span><span class="mi-body"><b>${esc(c.name || 'Unknown')}</b><small>${esc(ROLE_LABEL[c.role] || c.role || '')}</small><span class="mi-last">${esc((last.sender_id === me ? 'You: ' : '') + (last.body || '').slice(0, 60))}</span></span>
      <span class="mi-meta"><small>${fmtDateTime(last.created_at).split(',')[0]}</small>${c.unread ? `<i class="dot-n">${c.unread}</i>` : ''}</span></button>`; }).join('')
      : emptyState('No messages yet', 'Press New message to write to someone.', 'mail');
  }
  async function drawThread(id, scroll = true) {
    openId = id; wrap.classList.add('show-thread');
    const c = convos.get(id); if (!c) return;
    $$('.msg-item', listEl).forEach((b) => b.classList.toggle('on', b.dataset.c === id));
    threadEl.innerHTML = `<header class="mt-head"><button class="icon-btn mt-back" id="mt-back" aria-label="Back to conversations">${icon('up', 18)}</button><span class="avatar">${esc(initials(c.name || '?'))}</span><div><b>${esc(c.name || 'Unknown')}</b><small class="muted">${esc(ROLE_LABEL[c.role] || '')}</small></div></header>
      <div class="mt-msgs" id="mt-msgs">${c.msgs.map((m) => `<div class="bubble ${m.sender_id === me ? 'me' : ''}">${m.subject ? `<b class="bs">${esc(m.subject)}</b>` : ''}<span style="white-space:pre-wrap">${esc(m.body)}</span><small>${fmtDateTime(m.created_at)}</small></div>`).join('')}</div>
      <form class="mt-reply" id="mt-reply"><textarea class="input" name="body" rows="2" maxlength="3000" placeholder="Write a reply..." aria-label="Reply" required></textarea><button class="btn primary" type="submit">${icon('send', 16)} Send</button></form>`;
    const box = $('#mt-msgs', threadEl); if (scroll) box.scrollTop = box.scrollHeight; else box.scrollTop = box.scrollHeight;
    const unread = c.msgs.filter((m) => m.recipient_id === me && !m.is_read).map((m) => m.id);
    if (unread.length) { await sb.from('messages').update({ is_read: true }).in('id', unread); c.msgs.forEach((m) => { if (unread.includes(m.id)) m.is_read = true; }); c.unread = 0; drawList(); $$('.msg-item', listEl).forEach((b) => b.classList.toggle('on', b.dataset.c === id)); }
  }
  listEl.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) drawThread(b.dataset.c); });
  threadEl.addEventListener('click', (e) => { if (e.target.closest('#mt-back')) { wrap.classList.remove('show-thread'); openId = null; drawList(); } });
  threadEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, body = f.body.value.trim(); if (!body) return;
    const btn = f.querySelector('button'); setBusy(btn, true, 'Sending');
    try { await must(sb.from('messages').insert({ sender_id: me, recipient_id: openId, body }).select('id')); await load(); } catch (err) { fail(err); setBusy(btn, false); }
  });

  $('#ms-new', view).onclick = async () => {
    let contacts = [];
    try { contacts = (await must(sb.rpc('message_contacts'))) || []; } catch (e) { return fail(e); }
    if (!contacts.length) return toast('There is nobody you can message yet. Messaging opens once you are linked to students or classes.', 'info');
    const groups = {}; contacts.forEach((c) => (groups[c.role] ||= []).push(c));
    const m = modal({ title: 'New message', size: 'md', html: `<form class="form-grid" novalidate>
      <div class="field full"><label for="nm-to">To</label><select id="nm-to" class="input" required><option value="">Choose a person</option>${Object.entries(groups).map(([r, list]) => `<optgroup label="${esc(ROLE_LABEL[r] || r)}">${list.map((c) => `<option value="${c.id}">${esc(c.full_name)}</option>`).join('')}</optgroup>`).join('')}</select></div>
      <div class="field full"><label for="nm-sub">Subject (optional)</label><input id="nm-sub" class="input" maxlength="150"></div>
      <div class="field full"><label for="nm-body">Message</label><textarea id="nm-body" class="input" rows="5" maxlength="3000" required></textarea></div></form>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="nm-send">${icon('send', 16)} Send</button>` });
    $('#nm-send', m.el).onclick = async (e) => {
      const to = $('#nm-to', m.el).value, body = $('#nm-body', m.el).value.trim();
      if (!to) return toast('Choose who to write to', 'error'); if (!body) return toast('Write your message first', 'error');
      setBusy(e.currentTarget, true, 'Sending');
      try { await must(sb.from('messages').insert({ sender_id: me, recipient_id: to, subject: $('#nm-sub', m.el).value.trim() || null, body }).select('id')); m.close(); toast('Message sent'); openId = to; await load(); drawThread(to); }
      catch (err) { fail(err); setBusy(e.currentTarget, false); }
    };
  };

  if (channel) sb.removeChannel(channel);
  channel = sb.channel(`msgs-${me}-${Date.now()}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${me}` }, () => { if (document.body.contains(view)) load(); }).subscribe();
  await load(false);
  const pre = ctx.params?.[0]; if (pre && convos.has(pre)) drawThread(pre);
}
