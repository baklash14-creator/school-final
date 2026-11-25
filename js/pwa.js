// Registers the service worker and shows an "Install app" button when the browser offers one.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferred = e;
  const bar = document.querySelector('.top-actions');
  if (!bar || document.getElementById('pwa-install')) return;
  const b = document.createElement('button');
  b.id = 'pwa-install'; b.className = 'btn ghost sm'; b.type = 'button'; b.textContent = 'Install app';
  b.onclick = async () => { b.hidden = true; deferred.prompt(); try { await deferred.userChoice; } catch { /* ignore */ } deferred = null; };
  bar.prepend(b);
});
window.addEventListener('appinstalled', () => document.getElementById('pwa-install')?.remove());
