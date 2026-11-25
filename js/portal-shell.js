// Dashboard shell shared by all four portals: sidebar, topbar, hash router, notification bell
import { sb } from './supabase.js';
import { CONFIG } from './config.js';
import { guard, signOut, ROLE_LABEL, hasPerm } from './auth.js';
import { $, $$, esc, icon, LOGO, initials, toast, loadingBlock, errorBlock, fmtDateTime } from './ui.js';
import { must } from './api.js';
import './pwa.js';

export async function startPortal({ roles, nav, home }) {
  const { user, profile } = await guard(roles);
  const ctx = { user, profile };
  const items = nav.filter((n) => !n.perm || hasPerm(profile, n.perm));

  let lastGroup = null;
  const navHtml = items.map((n) => {
    const head = n.group && n.group !== lastGroup ? `<div class="nav-group">${esc(n.group)}</div>` : '';
    lastGroup = n.group || lastGroup;
    return `${head}<a class="nav-link" href="#/${n.id}" data-id="${n.id}">${icon(n.icon, 18)}<span>${esc(n.label)}</span></a>`;
  }).join('');

  $('#app').innerHTML = `
    <aside class="sidebar" id="sidebar">
      <a class="side-brand" href="index.html" title="Public website"><span class="logo">${LOGO}</span><span><b>${esc(CONFIG.SCHOOL.name)}</b><small>${esc(ROLE_LABEL[profile.role])}</small></span></a>
      <nav class="side-nav" aria-label="Main">${navHtml}</nav>
      <div class="side-user">
        <span class="avatar">${esc(initials(profile.full_name || profile.email))}</span>
        <span class="who"><b>${esc(profile.full_name || 'User')}</b><small>${esc(profile.email || '')}</small></span>
        <button class="icon-btn" id="logout" title="Sign out" aria-label="Sign out">${icon('logout')}</button>
      </div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <div class="main-col">
      <header class="topbar">
        <button class="icon-btn menu-btn" id="menu" aria-label="Open menu">${icon('menu')}</button>
        <h1 id="page-title"></h1>
        <div class="top-actions">
          <div class="bell-wrap">
            <button class="icon-btn bell" id="bell" aria-label="Notifications">${icon('bell')}<span class="dot" id="bell-dot" hidden>0</span></button>
            <div class="bell-panel" id="bell-panel" hidden>
              <div class="bell-head"><b>Notifications</b><button class="link" id="mark-all">Mark all read</button></div>
              <div id="bell-list"></div>
            </div>
          </div>
        </div>
      </header>
      <main class="content" id="main" tabindex="-1"></main>
    </div>`;

  /* ---- sidebar behaviour ---- */
  const body = document.body;
  $('#menu').onclick = () => body.classList.toggle('nav-open');
  $('#scrim').onclick = () => body.classList.remove('nav-open');
  $('#logout').onclick = () => signOut('You have been signed out.');

  /* ---- router ---- */
  const main = $('#main');
  let token = 0;
  async function route() {
    const [id, ...params] = (location.hash.replace(/^#\/?/, '') || home).split('/');
    const item = items.find((i) => i.id === id) || items.find((i) => i.id === home) || items[0];
    const my = ++token;
    $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.id === item.id));
    $('#page-title').textContent = item.label;
    document.title = `${item.label} | ${CONFIG.SCHOOL.name}`;
    body.classList.remove('nav-open');
    main.innerHTML = '';
    const view = document.createElement('div');
    view.className = 'view';
    view.innerHTML = loadingBlock();
    main.appendChild(view);
    try {
      await item.render(view, { ...ctx, params, navigate: (r) => { location.hash = `#/${r}`; } });
    } catch (e) {
      if (my !== token) return;
      console.error(e);
      view.innerHTML = errorBlock(e);
      view.querySelector('[data-retry]')?.addEventListener('click', route);
    }
  }
  window.addEventListener('hashchange', route);

  /* ---- notifications ---- */
  const dot = $('#bell-dot'), panel = $('#bell-panel'), list = $('#bell-list');
  async function loadNotifs() {
    try {
      const rows = await must(sb.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(25));
      const unread = rows.filter((r) => !r.is_read).length;
      dot.hidden = !unread; dot.textContent = unread > 9 ? '9+' : unread;
      list.innerHTML = rows.length
        ? rows.map((n) => `<button class="notif ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${esc(n.link || '')}">
            <b>${esc(n.title)}</b><span>${esc(n.body || '')}</span><small>${fmtDateTime(n.created_at)}</small></button>`).join('')
        : `<p class="muted pad">You are all caught up.</p>`;
    } catch (e) { list.innerHTML = `<p class="muted pad">Could not load notifications.</p>`; }
  }
  $('#bell').onclick = (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; if (!panel.hidden) loadNotifs(); };
  document.addEventListener('click', (e) => { if (!e.target.closest('.bell-wrap')) panel.hidden = true; });
  $('#mark-all').onclick = async () => {
    await sb.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
    loadNotifs();
  };
  list.onclick = async (e) => {
    const b = e.target.closest('.notif'); if (!b) return;
    await sb.from('notifications').update({ is_read: true }).eq('id', b.dataset.id);
    const link = b.dataset.link;
    panel.hidden = true;
    if (link) {
      const [file, hash] = link.split('#');
      if (!file || location.pathname.endsWith(file)) { location.hash = hash || ''; route(); } else location.href = link;
    }
    loadNotifs();
  };
  sb.channel(`notif-${user.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
      (p) => { toast(p.new.title, 'info'); loadNotifs(); })
    .subscribe();
  loadNotifs();

  /* ---- go ---- */
  if (!location.hash) history.replaceState(null, '', `#/${home}`);
  await route();
  const boot = $('#boot');
  if (boot) { boot.classList.add('done'); setTimeout(() => boot.remove(), 700); }
  return ctx;
}
