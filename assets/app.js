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

  const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzM4o4WTSWrRAxronWPheQVaUIZnYMNIcJrz6ivOzV2NtvO3JuGRuSH5CHCIBfvRBBdmw/exec';
  const BRIDGE_ORIGINS = ['https://script.google.com', 'https://script.googleusercontent.com'];

  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();

  const $ = id => document.getElementById(id);
  const loginView = $('loginView');
  const appView = $('appView');

  let currentUser = null;
  let session = null;
  let profiles = [];
  let devices = [];
  let selectedProfile = '';
  let bridgeReady = false;
  let bridgePromiseResolve = null;
  let requestSeq = 0;
  let weightChart = null;
  let waterChart = null;
  const pending = new Map();

  const bridgePromise = new Promise(resolve => {
    bridgePromiseResolve = resolve;
  });

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function fmt1(value) {
    return Number.isFinite(Number(value))
      ? Number(value).toFixed(1).replace('.', ',')
      : '—';
  }

  function fmtDate(value) {
    if (!value) return '—';
    const s = String(value);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : s;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function errorText(error) {
    const code = String(error?.code || '');
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
      return 'E-mail ou código de acesso inválido.';
    }
    if (code.includes('too-many-requests')) return 'Muitas tentativas. Aguarde alguns minutos.';
    if (code.includes('network-request-failed')) return 'Falha de conexão. Verifique a internet.';
    return String(error?.message || error || 'Falha não identificada.').replace(/^Firebase:\s*/i, '');
  }

  function setLoginMsg(text, type = '') {
    const el = $('loginMsg');
    el.textContent = text || '';
    el.className = `notice${type === 'error' ? ' error' : ''}${text ? '' : ' hidden'}`;
  }

  function setAppMsg(text, type = '') {
    const el = $('appMsg');
    el.textContent = text || '';
    el.className = `notice${type === 'error' ? ' error' : ''}${text ? '' : ' hidden'}`;
  }

  function setBridgeStatus(text, state = '') {
    $('bridgeStatus').innerHTML = `<span class="dot ${state}"></span><span>${escapeHtml(text)}</span>`;
  }

  function loadBridge() {
    const iframe = $('gasBridge');
    setBridgeStatus('Conectando à base…');
    iframe.src = `${WEB_APP_URL}${WEB_APP_URL.includes('?') ? '&' : '?'}mode=bridge&v=20260713_2`;
    window.setTimeout(() => {
      if (!bridgeReady) setBridgeStatus('Ponte do Apps Script não respondeu', 'bad');
    }, 15000);
  }

  window.addEventListener('message', event => {
    if (!BRIDGE_ORIGINS.includes(event.origin)) return;
    const data = event.data || {};

    if (data.type === 'PSS_BRIDGE_READY') {
      bridgeReady = true;
      setBridgeStatus('Base conectada', 'ok');
      if (bridgePromiseResolve) bridgePromiseResolve(true);
      return;
    }

    if (data.type === 'PSS_BRIDGE_RESPONSE' && data.id) {
      const item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id);
      clearTimeout(item.timer);
      if (data.ok) item.resolve(data.result);
      else item.reject(new Error(data.error || 'Falha na API.'));
    }
  });

  async function waitBridge() {
    if (bridgeReady) return true;
    await Promise.race([
      bridgePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('A ponte do Apps Script não ficou disponível.')), 18000))
    ]);
    return true;
  }

  async function bridgeCall(action, payload = {}, authenticated = true) {
    await waitBridge();
    const user = auth.currentUser;
    if (authenticated && !user) throw new Error('Sessão encerrada.');

    const token = authenticated ? await user.getIdToken(true) : '';
    const id = `req_${Date.now()}_${++requestSeq}`;
    const iframe = $('gasBridge');

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Tempo limite da API excedido.'));
      }, 35000);

      pending.set(id, { resolve, reject, timer });
      iframe.contentWindow.postMessage({
        type: 'PSS_BRIDGE_CALL',
        id,
        request: { token, action, payload }
      }, '*');
    });
  }

  async function login() {
    const email = $('loginEmail').value.trim().toLowerCase();
    const code = $('loginCode').value;

    if (!email || !$('loginEmail').checkValidity()) {
      setLoginMsg('Informe um e-mail válido.', 'error');
      $('loginEmail').focus();
      return;
    }
    if (!code || code.length < 6) {
      setLoginMsg('Informe o código cadastrado na planilha, com pelo menos 6 caracteres.', 'error');
      $('loginCode').focus();
      return;
    }

    $('btnLogin').disabled = true;
    setLoginMsg('Validando o cadastro na planilha e sincronizando com o Firebase…');

    try {
      await bridgeCall('apiPrepararLogin', { email, codigo: code }, false);
      await auth.signInWithEmailAndPassword(email, code);
      setLoginMsg('Acesso validado. Carregando o sistema…');
    } catch (error) {
      setLoginMsg(errorText(error), 'error');
    } finally {
      $('btnLogin').disabled = false;
    }
  }

  async function enterApp(user) {
    currentUser = user;
    session = await bridgeCall('apiGetSessao');

    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    $('userEmail').textContent = session.nome ? `${session.nome} — ${session.email}` : session.email;
    $('btnAdmin').classList.toggle('hidden', !session.permissaoConfig);
    $('goalPermissionHint').textContent = session.permissaoConfig
      ? 'Você possui permissão para alterar meta e altura.'
      : 'Meta e altura são somente leitura para este acesso.';
    $('altura').disabled = !session.permissaoConfig;
    $('meta').disabled = !session.permissaoConfig;

    await bootstrapData();
  }

  auth.onAuthStateChanged(async user => {
    try {
      if (user) {
        await enterApp(user);
      } else {
        currentUser = null;
        session = null;
        selectedProfile = '';
        loginView.classList.remove('hidden');
        appView.classList.add('hidden');
      }
    } catch (error) {
      try { await auth.signOut(); } catch (_) {}
      setLoginMsg(errorText(error), 'error');
    }
  });

  async function bootstrapData() {
    setAppMsg('Carregando perfis e dispositivos…');
    try {
      [profiles, devices] = await Promise.all([
        bridgeCall('apiGetPerfis'),
        bridgeCall('apiListDevices')
      ]);
      renderProfiles();
      fillDevices();

      try {
        const detected = await bridgeCall('apiGetDeviceWeight', { ua: navigator.userAgent });
        if (detected?.modelHint || detected?.matchKey) {
          $('deviceSuggestion').textContent = `Aparelho detectado: ${detected.modelHint || detected.matchKey}`;
          if (detected.pesoKg != null) $('pesoCel').value = String(detected.pesoKg).replace('.', ',');
        }
      } catch (_) {}

      setAppMsg('');
    } catch (error) {
      setAppMsg(errorText(error), 'error');
    }
  }

  function renderProfiles() {
    $('profileCount').textContent = `${profiles.length} perfil(is)`;
    $('profiles').innerHTML = profiles.length
      ? profiles.map(profile => `
        <button class="profile-btn" data-profile="${escapeHtml(profile.nome)}">
          <b>${escapeHtml(profile.nome)}</b>
          <span>Altura: ${profile.altura_m != null ? String(profile.altura_m).replace('.', ',') : '—'} m | Meta: ${profile.meta_kg != null ? fmt1(profile.meta_kg) : '—'} kg</span>
        </button>`).join('')
      : '<div class="notice">Nenhum perfil foi liberado para este acesso.</div>';

    document.querySelectorAll('.profile-btn').forEach(button => {
      button.onclick = () => selectProfile(button.dataset.profile);
    });
  }

  function fillDevices() {
    $('modeloSel').innerHTML = '<option value="">Selecione…</option>' + devices.map(device =>
      `<option value="${escapeHtml(device.key)}" data-weight="${device.pesoKg}">${escapeHtml(device.key)}</option>`
    ).join('');
  }

  async function selectProfile(name) {
    selectedProfile = name;
    document.querySelectorAll('.profile-btn').forEach(button => {
      button.classList.toggle('active', button.dataset.profile === name);
    });
    $('selectedPill').textContent = `Selecionado: ${name}`;
    enableProfileActions(true);
    await Promise.all([refreshSummary(), refreshComparisons()]);
  }

  function enableProfileActions(enabled) {
    $('btnSaveGoal').disabled = !enabled || !session?.permissaoConfig;
    document.querySelectorAll('.waterBtn').forEach(button => button.disabled = !enabled);
    $('btnWaterCustom').disabled = !enabled;
    validateWeight();
  }

  function updateDeviceUi() {
    const enabled = $('comCelular').checked;
    $('modeloSel').disabled = !enabled;
    $('pesoCel').disabled = !enabled;
    validateWeight();
  }

  function validateWeight() {
    const bruto = num($('pesoBruto').value);
    const comCelular = $('comCelular').checked;
    const celular = num($('pesoCel').value);
    const model = $('modeloSel').value;
    const valid = Boolean(selectedProfile) && bruto != null && bruto > 0 &&
      (!comCelular || (model && celular != null && celular > 0 && celular < bruto));

    $('btnSaveWeight').disabled = !valid;
    $('netWeightPill').textContent = `Peso líquido: ${valid ? `${fmt1(bruto - (comCelular ? celular : 0))} kg` : '—'}`;
  }

  async function saveWeight() {
    const bruto = num($('pesoBruto').value);
    const comCelular = $('comCelular').checked;
    const celular = num($('pesoCel').value) || 0;
    const model = $('modeloSel').value;

    $('btnSaveWeight').disabled = true;
    setAppMsg('Salvando pesagem…');

    try {
      const result = await bridgeCall('apiSalvarPesagem', {
        perfil: selectedProfile,
        pesoBruto: bruto,
        comCelular,
        pesoCelularKg: comCelular ? celular : 0,
        unidade: 'kg',
        origem: comCelular ? 'foto' : 'manual',
        obs: $('obs').value || '',
        ua: navigator.userAgent,
        modelHint: '',
        matchKey: model
      });
      setAppMsg(`Pesagem salva: ${fmt1(result.pesoLiquido)} kg.`);
      clearWeightForm();
      await Promise.all([refreshSummary(), refreshComparisons()]);
    } catch (error) {
      setAppMsg(errorText(error), 'error');
    } finally {
      validateWeight();
    }
  }

  function clearWeightForm() {
    $('pesoBruto').value = '';
    $('obs').value = '';
    $('comCelular').checked = false;
    $('modeloSel').value = '';
    $('pesoCel').value = '';
    $('deviceWeightHint').textContent = 'Peso do aparelho: —';
    updateDeviceUi();
  }

  async function saveGoal() {
    if (!selectedProfile || !session?.permissaoConfig) return;
    try {
      await bridgeCall('apiSalvarMetaAltura', {
        perfil: selectedProfile,
        altura_m: num($('altura').value),
        meta_kg: num($('meta').value)
      });
      setAppMsg('Meta e altura atualizadas.');
      await refreshSummary();
    } catch (error) {
      setAppMsg(errorText(error), 'error');
    }
  }

  async function addWater(value) {
    const ml = num(value);
    if (!selectedProfile || !ml || ml <= 0) return;
    $('waterStatus').textContent = `Registrando ${Math.round(ml)} ml…`;
    try {
      await bridgeCall('apiAddAgua', { perfil: selectedProfile, ml });
      $('waterCustom').value = '';
      $('waterStatus').textContent = 'Água registrada.';
      await refreshSummary();
    } catch (error) {
      $('waterStatus').textContent = errorText(error);
    }
  }

  async function refreshSummary() {
    if (!selectedProfile) return;
    try {
      const result = await bridgeCall('apiGetResumoPerfil', { perfil: selectedProfile });
      $('altura').value = result.altura_m != null ? String(result.altura_m).replace('.', ',') : '';
      $('meta').value = result.meta_kg != null ? String(result.meta_kg).replace('.', ',') : '';
      $('kpiLast').textContent = fmt1(result.ultimo_kg);
      $('kpiImc').textContent = fmt1(result.imc);
      $('kpiMin').textContent = fmt1(result.min_kg);
      $('kpiMinDate').textContent = fmtDate(result.dataMin);
      $('kpiMax').textContent = fmt1(result.max_kg);
      $('kpiMaxDate').textContent = fmtDate(result.dataMax);
      $('waterToday').textContent = Math.round(Number(result.agua_hoje_ml || 0));
      $('waterGoal').textContent = Math.round(Number(result.agua_meta_ml || 0));
      renderHistory(result.historico_tabela || []);
      renderCharts(result.historico_grafico || []);
      $('btnSaveGoal').disabled = !session?.permissaoConfig;
    } catch (error) {
      setAppMsg(errorText(error), 'error');
    }
  }

  function renderHistory(rows) {
    $('historyBody').innerHTML = rows.length
      ? rows.map(row => `<tr><td>${fmtDate(row.dtIso)}</td><td class="num"><b>${row.pesoKg != null ? fmt1(row.pesoKg) : '—'}</b></td><td class="num">${Math.round(Number(row.aguaMl || 0))}</td></tr>`).join('')
      : '<tr><td colspan="3" style="color:var(--muted)">Sem histórico para o perfil.</td></tr>';
  }

  function renderCharts(rows) {
    const labels = rows.map(row => fmtDate(row.dtIso).split(' ')[0]);
    const weights = rows.map(row => row.pesoKg != null ? Number(row.pesoKg) : null);
    const waters = rows.map(row => Math.round(Number(row.aguaMl || 0)));

    if (weightChart) weightChart.destroy();
    if (waterChart) waterChart.destroy();

    weightChart = new Chart($('weightChart'), {
      type: 'line',
      data: { labels, datasets: [{ label: 'Peso (kg)', data: weights, tension: .28, spanGaps: true }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#dbeafe' } } }, scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } } }
    });

    waterChart = new Chart($('waterChart'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Água (ml)', data: waters }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#dbeafe' } } }, scales: { x: { ticks: { color: '#94a3b8' } }, y: { beginAtZero: true, ticks: { color: '#94a3b8' } } } }
    });
  }

  async function refreshComparisons() {
    if (!selectedProfile) return;
    const days = Number($('compareDays').value || 30);
    const fixWeekday = $('fixWeekday').checked;
    const dia = Math.round(num($('compareDay').value) || 0);
    const mes = Math.round(num($('compareMonth').value) || 0);

    try {
      const result = await bridgeCall('apiGetComparativosPerfil', { perfil: selectedProfile, days, fixWeekday, dia, mes });
      const today = result.hoje || {};
      const comp = result.compDias || {};
      $('bToday').textContent = `Hoje: ${today.pesoKg != null ? `${fmt1(today.pesoKg)} kg` : '—'}`;
      $('bTarget').textContent = `${comp.fixWeekday ? 'Mesmo dia' : 'Móvel'}: ${comp.alvoPesoKg != null ? `${fmt1(comp.alvoPesoKg)} kg` : '—'} (${fmtDate(comp.alvoDayKey)})`;
      $('bDelta').textContent = `Δ: ${comp.deltaKg != null ? `${fmt1(comp.deltaKg)} kg` : '—'}`;
      $('bDelta').className = `badge ${Number(comp.deltaKg) > 0 ? 'up' : Number(comp.deltaKg) < 0 ? 'down' : ''}`;
      $('compareHint').textContent = comp.fixWeekday ? `Mesmo dia da semana dentro de ${comp.days} dias.` : `Exatamente ${comp.days} dias atrás.`;

      const year = result.compAno;
      if (year?.ok) {
        $('bYearNow').textContent = `Ano atual (${fmtDate(year.atual?.dayKey)}): ${year.atual?.pesoKg != null ? `${fmt1(year.atual.pesoKg)} kg` : '—'}`;
        $('bYearPrev').textContent = `Ano anterior (${fmtDate(year.anterior?.dayKey)}): ${year.anterior?.pesoKg != null ? `${fmt1(year.anterior.pesoKg)} kg` : '—'}`;
        $('bYearDelta').textContent = `Δ ano: ${year.deltaKg != null ? `${fmt1(year.deltaKg)} kg` : '—'}`;
        $('compareYearHint').textContent = 'Comparação do mesmo dia e mês entre anos.';
      } else {
        $('bYearNow').textContent = 'Ano atual: —';
        $('bYearPrev').textContent = 'Ano anterior: —';
        $('bYearDelta').textContent = 'Δ ano: —';
        $('compareYearHint').textContent = year?.msg || 'Informe dia e mês para comparar.';
      }
    } catch (error) {
      $('compareHint').textContent = errorText(error);
    }
  }

  async function loadAdminUsers() {
    if (!session?.permissaoConfig) return;
    $('adminUsers').innerHTML = '<div class="notice">Carregando usuários…</div>';
    try {
      const users = await bridgeCall('apiListarUsuariosAcesso');
      $('adminUsers').innerHTML = '';
      users.forEach(user => {
        const row = document.createElement('div');
        row.className = 'admin-user';
        row.innerHTML = `
          <div class="field"><label>Nome</label><input class="input au-name" value="${escapeHtml(user.nome || '')}"></div>
          <div class="field"><label>E-mail</label><input class="input au-email" value="${escapeHtml(user.email || '')}"></div>
          <label class="checkrow"><input class="au-active" type="checkbox" ${user.ativo ? 'checked' : ''}><span>Ativo</span></label>
          <div class="field"><label>Perfil de acesso</label><input class="input au-role" value="${escapeHtml(user.perfilAcesso || '')}"></div>
          <div class="field"><label>Setor</label><input class="input au-sector" value="${escapeHtml(user.setor || '')}"></div>
          <label class="checkrow"><input class="au-weigh" type="checkbox" ${user.permissaoPesagem ? 'checked' : ''}><span>Pesagem</span></label>
          <label class="checkrow"><input class="au-config" type="checkbox" ${user.permissaoConfig ? 'checked' : ''}><span>Configuração</span></label>
          <div class="field"><label>Novo código (opcional)</label><input class="input au-code" type="password" placeholder="Não altere após sincronizar"></div>
          <div class="field"><label>UID Firebase</label><input class="input" value="${escapeHtml(user.uidFirebase || '')}" disabled></div>
          <button class="btn au-save">Salvar</button>`;

        row.querySelector('.au-save').onclick = async () => {
          const button = row.querySelector('.au-save');
          button.disabled = true;
          try {
            await bridgeCall('apiAtualizarUsuarioAcesso', {
              row: user.row,
              ativo: row.querySelector('.au-active').checked,
              nome: row.querySelector('.au-name').value,
              email: row.querySelector('.au-email').value,
              codigo: row.querySelector('.au-code').value,
              perfilAcesso: row.querySelector('.au-role').value,
              setor: row.querySelector('.au-sector').value,
              permissaoPesagem: row.querySelector('.au-weigh').checked,
              permissaoConfig: row.querySelector('.au-config').checked,
              uidFirebase: user.uidFirebase,
              obs: user.obs || ''
            });
            button.textContent = 'Salvo';
            setTimeout(() => { button.textContent = 'Salvar'; }, 1200);
          } catch (error) {
            setAppMsg(errorText(error), 'error');
          } finally {
            button.disabled = false;
          }
        };
        $('adminUsers').appendChild(row);
      });
    } catch (error) {
      $('adminUsers').innerHTML = `<div class="notice error">${escapeHtml(errorText(error))}</div>`;
    }
  }

  async function syncUsers() {
    if (!session?.permissaoConfig) return;
    $('btnSyncUsers').disabled = true;
    setAppMsg('Sincronizando os usuários ativos com o Firebase…');
    try {
      const result = await bridgeCall('apiSincronizarUsuariosFirebase');
      const ok = (result.resultados || []).filter(item => item.ok).length;
      const fail = (result.resultados || []).filter(item => !item.ok && item.status !== 'IGNORADO_INCOMPLETO_OU_INATIVO').length;
      setAppMsg(`Sincronização concluída: ${ok} sucesso(s), ${fail} pendência(s).`, fail ? 'error' : '');
      await loadAdminUsers();
    } catch (error) {
      setAppMsg(errorText(error), 'error');
    } finally {
      $('btnSyncUsers').disabled = false;
    }
  }

  $('btnLogin').onclick = login;
  $('loginCode').addEventListener('keydown', event => { if (event.key === 'Enter') login(); });
  $('btnLogout').onclick = () => auth.signOut();
  $('btnAdmin').onclick = () => {
    $('adminPanel').classList.toggle('hidden');
    if (!$('adminPanel').classList.contains('hidden')) loadAdminUsers();
  };
  $('btnReloadUsers').onclick = loadAdminUsers;
  $('btnSyncUsers').onclick = syncUsers;
  $('comCelular').onchange = updateDeviceUi;
  $('pesoBruto').oninput = validateWeight;
  $('pesoCel').oninput = validateWeight;
  $('modeloSel').onchange = () => {
    const option = $('modeloSel').selectedOptions[0];
    const weight = num(option?.dataset?.weight);
    if (weight != null) $('pesoCel').value = String(weight).replace('.', ',');
    $('deviceWeightHint').textContent = `Peso do aparelho: ${weight != null ? `${fmt1(weight)} kg` : '—'}`;
    validateWeight();
  };
  $('btnSaveWeight').onclick = saveWeight;
  $('btnClear').onclick = clearWeightForm;
  $('btnSaveGoal').onclick = saveGoal;
  document.querySelectorAll('.waterBtn').forEach(button => button.onclick = () => addWater(button.dataset.ml));
  $('btnWaterCustom').onclick = () => addWater($('waterCustom').value);
  ['compareDays', 'fixWeekday', 'compareDay', 'compareMonth'].forEach(id => {
    $(id).addEventListener(id === 'compareDay' || id === 'compareMonth' ? 'input' : 'change', () => {
      clearTimeout(window.__pssCompareTimer);
      window.__pssCompareTimer = setTimeout(refreshComparisons, 350);
    });
  });

  loadBridge();
})();
