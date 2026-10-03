(() => {
  'use strict';

  let deferredPrompt = null;

  const installBox = document.getElementById('installBox');
  const installHint = document.getElementById('installHint');
  const installButton = document.getElementById('btnInstallApp');
  const installTopButton = document.getElementById('btnInstallTop');

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = () =>
    /iPad|iPhone|iPod/i.test(navigator.userAgent || '');

  function setInstallVisible(visible) {
    if (installButton) installButton.classList.toggle('hidden', !visible);
    if (installTopButton) installTopButton.classList.toggle('hidden', !visible);
    if (installBox) installBox.classList.toggle('hidden', !visible);
  }

  async function installApp() {
    if (isStandalone()) {
      setInstallVisible(false);
      return;
    }

    if (!deferredPrompt) {
      if (isIOS()) {
        if (installBox) installBox.classList.remove('hidden');
        if (installHint) {
          installHint.textContent =
            'No iPhone/iPad: abra no Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.';
        }
      }
      return;
    }

    deferredPrompt.prompt();

    try {
      await deferredPrompt.userChoice;
    } catch (_) {}

    deferredPrompt = null;
    setInstallVisible(false);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('./sw.js', {
          scope: './',
          updateViaCache: 'none'
        });

        registration.update().catch(() => {});
      } catch (error) {
        console.warn('PWA: falha ao registrar service worker', error);
      }
    });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    setInstallVisible(true);

    if (installHint) {
      installHint.textContent =
        'Instale para abrir em tela cheia, com ícone próprio e acesso direto pela tela inicial.';
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    setInstallVisible(false);
  });

  if (installButton) installButton.addEventListener('click', installApp);
  if (installTopButton) installTopButton.addEventListener('click', installApp);

  if (isStandalone()) {
    setInstallVisible(false);
  } else if (isIOS()) {
    if (installBox) installBox.classList.remove('hidden');
    if (installHint) {
      installHint.textContent =
        'No iPhone/iPad: abra no Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.';
    }
  }
})();
