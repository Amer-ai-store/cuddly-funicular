(() => {
  'use strict';
  const host = document.getElementById('aman-access-native');
  const section = host?.closest('section.view');
  if (!host || !section) return;
  let generation = 0;
  async function synchronize() {
    const current = ++generation;
    if (section.hidden) { host.replaceChildren(); return; }
    if (host.querySelector('aman-monitor')) return;
    try {
      await import('./central.mjs');
      if (current !== generation || section.hidden) return;
      host.replaceChildren(document.createElement('aman-monitor'));
    } catch {
      if (current === generation) host.textContent = 'تعذّر تحميل المراقبة. أعد تحميل الصفحة.';
    }
  }
  new MutationObserver(synchronize).observe(section, {attributes: true, attributeFilter: ['hidden']});
  window.addEventListener('pagehide', () => { generation++; host.replaceChildren(); });
  window.addEventListener('pageshow', synchronize);
  synchronize();
})();
