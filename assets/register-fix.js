(() => {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyA8tO_E2s6R9bYnEW6_5skqCUrBSVLLKkw',
    authDomain: 'pss-bolao-esportivo.firebaseapp.com',
    projectId: 'pss-bolao-esportivo',
    storageBucket: 'pss-bolao-esportivo.firebasestorage.app',
    messagingSenderId: '575209475526',
    appId: '1:575209475526:web:7d2d1efa2d9fd8b600f6c7'
  };

  const ADMIN_EMAIL = 'portalsimonsports@gmail.com';
  const ACCESS_COLLECTION = 'usuarios_pesagem';
  const SECONDARY_APP_NAME = 'pesagemCadastro';

  const emailInput = document.getElementById('loginEmail');
  const codeInput = document.getElementById('loginCode');
  const registerButton = document.getElementById('btnRegister');
  const messageBox = document.getElementById('loginMsg');

  if (!emailInput || !codeInput || !registerButton || !messageBox || !window.firebase) return;

  function setMessage(text, type = '') {
    messageBox.textContent = text || '';
    messageBox.className = `notice${type === 'error' ? ' error' : ''}${text ? '' : ' hidden'}`;
  }

  function errorMessage(error) {
    const code = String(error?.code || '');

    if (code.includes('email-already-in-use')) {
      return 'Este e-mail já possui cadastro. Utilize o botão Entrar com o código criado anteriormente.';
    }
    if (code.includes('invalid-email')) {
      return 'Informe um endereço de e-mail válido.';
    }
    if (code.includes('weak-password')) {
      return 'Crie um código de acesso com pelo menos 6 caracteres.';
    }
    if (code.includes('operation-not-allowed')) {
      return 'O acesso por e-mail e código ainda não foi ativado no Firebase Authentication.';
    }
    if (code.includes('permission-denied')) {
      return 'As regras de acesso do Firestore ainda não foram publicadas para o Sistema de Pesagem.';
    }
    if (code.includes('network-request-failed')) {
      return 'Não foi possível conectar ao Firebase. Verifique sua internet e tente novamente.';
    }
    if (code.includes('too-many-requests')) {
      return 'Muitas tentativas em sequência. Aguarde alguns minutos e tente novamente.';
    }

    return String(error?.message || error || 'Não foi possível criar a solicitação.')
      .replace(/^Firebase:\s*/i, '');
  }

  function getSecondaryApp() {
    try {
      return firebase.app(SECONDARY_APP_NAME);
    } catch (_) {
      return firebase.initializeApp(FIREBASE_CONFIG, SECONDARY_APP_NAME);
    }
  }

  async function requestAccess() {
    const email = emailInput.value.trim().toLowerCase();
    const accessCode = codeInput.value;

    if (!email) {
      setMessage('Informe o e-mail que será usado para acessar o Sistema de Pesagem.', 'error');
      emailInput.focus();
      return;
    }

    if (!emailInput.checkValidity()) {
      setMessage('Informe um endereço de e-mail válido.', 'error');
      emailInput.focus();
      return;
    }

    if (!accessCode) {
      setMessage('Crie um código de acesso antes de solicitar. Ele deve ter no mínimo 6 caracteres.', 'error');
      codeInput.focus();
      return;
    }

    if (accessCode.length < 6) {
      setMessage('O código informado é muito curto. Crie um código com pelo menos 6 caracteres.', 'error');
      codeInput.focus();
      codeInput.select();
      return;
    }

    const originalText = registerButton.textContent;
    registerButton.disabled = true;
    registerButton.textContent = 'Enviando…';
    setMessage('Criando sua solicitação de acesso…');

    const secondaryApp = getSecondaryApp();
    const registrationAuth = secondaryApp.auth();
    const registrationDb = secondaryApp.firestore();

    try {
      const credential = await registrationAuth.createUserWithEmailAndPassword(email, accessCode);
      const user = credential.user;
      const isMaster = email === ADMIN_EMAIL;

      await user.getIdToken(true);
      await registrationDb.collection(ACCESS_COLLECTION).doc(user.uid).set({
        email,
        nome: '',
        ativo: isMaster,
        admin: isMaster,
        perfis: isMaster ? ['*'] : [],
        criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
      });

      await registrationAuth.signOut();
      codeInput.value = '';

      if (isMaster) {
        setMessage('Acesso administrativo criado. Informe novamente o código e clique em Entrar.');
      } else {
        setMessage('Solicitação enviada com sucesso. Aguarde a liberação do administrador e guarde o código criado.');
      }
    } catch (error) {
      try {
        await registrationAuth.signOut();
      } catch (_) {}
      setMessage(errorMessage(error), 'error');
    } finally {
      registerButton.disabled = false;
      registerButton.textContent = originalText;
    }
  }

  registerButton.onclick = requestAccess;
})();
