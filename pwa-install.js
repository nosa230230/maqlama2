/* PWA install prompt + SW registration helper */
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) =>
        console.warn('SW registration failed:', err)
      );
    });
  }

  let deferredPrompt = null;
  const BTN_ID = 'pwaInstallBtn';

  function createBtn() {
    if (document.getElementById(BTN_ID)) return document.getElementById(BTN_ID);
    const b = document.createElement('button');
    b.id = BTN_ID;
    b.type = 'button';
    b.innerHTML = '<i class="fas fa-download"></i> تثبيت التطبيق';
    Object.assign(b.style, {
      position: 'fixed', bottom: '20px', left: '20px', zIndex: '9998',
      background: 'linear-gradient(135deg,#4f46e5,#06b6d4)', color: '#fff',
      border: 'none', padding: '12px 18px', borderRadius: '999px',
      fontFamily: 'Cairo, system-ui, sans-serif', fontWeight: '700', fontSize: '14px',
      boxShadow: '0 8px 24px rgba(20,24,50,.25)', cursor: 'pointer', display: 'none'
    });
    b.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch {}
      deferredPrompt = null;
      b.style.display = 'none';
    });
    document.body.appendChild(b);
    return b;
  }

  // window.addEventListener('beforeinstallprompt', (e) => {
  //   e.preventDefault();
  //   deferredPrompt = e;
  //   const b = createBtn();
  //   b.style.display = 'inline-flex';
  // });

  window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = null;
});

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const b = document.getElementById(BTN_ID);
    if (b) b.style.display = 'none';
  });
})();
