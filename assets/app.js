(() => {
  'use strict';

  const API_URL = 'https://script.google.com/macros/s/AKfycbzM4o4WTSWrRAxronWPheQVaUIZnYMNIcJrz6ivOzV2NtvO3JuGRuSH5CHCIBfvRBBdmw/exec';
  const SESSION_KEY = 'PSS_PESAGEM_OTP_SESSION';
  const EMAIL_KEY = 'PSS_PESAGEM_EMAIL';
  const JSONP_TIMEOUT_MS = 30000;

  const $ = id => document.getElementById(id);

  let sessionToken = '';
  let sessionInfo = null;
  let profiles = [];
  let devices = [];
  let selectedProfile = '';
  let weightChart = null;
  let waterChart = null;
  let sessionTimer = null;
  let comparisonTimer = null;

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function fmt1(value) {
    return Number.isFinite(Number(value))
      ? Number(value).toFixed(1).replace('.', ',')
      : '—';
  }

  function fmtDate(value) {
    if (!value) return '—';
    const text = String(value);
    const match = text.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/
    );

    return match
      ? `${match[3]}/${match[2]}/${match[1]}${match[4] ? ` ${match[4]}:${match[5]}` : ''}`
      : text;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]
    );
  }

  function setLoginMessage(text, type = '') {
    const element = $('loginMsg');
    element.textContent = text || '';
    element.className = `notice${type === 'error' ? ' error' : ''}${text ? '' : ' hidden'}`;
  }

  function setAppMessage(text, type = '') {
    const element = $('appMsg');
    element.textContent = text || '';
    element.className = `notice${type === 'error' ? ' error' : ''}${text ? '' : ' hidden'}`;
  }

  function setApiStatus(text, state = '') {
    $('apiStatus').innerHTML =
      `<span class="dot ${state}"></span><span>${escapeHtml(text)}</span>`;
  }

  function errorText(error) {
    const message = String(error?.message || error || 'Falha não identificada.');

    if (/sessão|sessao|token|expirad/i.test(message)) {
      return 'Sua sessão expirou. Solicite um novo código para entrar.';
    }

    return message
      .replace(/^Error:\s*/i, '')
      .replace(/^Firebase:\s*/i, '');
  }

  function jsonp(action, params = {}, timeout = JSONP_TIMEOUT_MS) {
    if (!API_URL || !/^https:\/\/script\.google\.com\//i.test(API_URL)) {
      return Promise.reject(new Error('A URL da API do Apps Script não está configurada.'));
    }

    return new Promise((resolve, reject) => {
      const callbackName =
        `__pssPesagemJsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      const query = new URLSearchParams({
        action,
        callback: callbackName,
        _: String(Date.now())
      });

      Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        query.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      });

      let finished = false;
      const cleanup = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        delete window[callbackName];
        script.remove();
      };

      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('A API demorou para responder. Tente novamente.'));
      }, timeout);

      window[callbackName] = response => {
        cleanup();

        if (!response || response.ok !== true) {
          reject(new Error(response?.msg || 'Resposta inválida da API.'));
          return;
        }

        resolve(response);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error('Não foi possível conectar ao Apps Script.'));
      };

      script.src = `${API_URL}?${query.toString()}`;
      document.head.appendChild(script);
    });
  }

  async function api(action, payload = {}) {
    if (!sessionToken) throw new Error('Sessão ausente.');

    try {
      return await jsonp(action, {
        token: sessionToken,
        payload: JSON.stringify(payload || {})
      });
    } catch (error) {
      const message = errorText(error);

      if (/sessão|sessao|token|expirad|revogad/i.test(message)) {
        clearSession();
        showLogin();
      }

      throw new Error(message);
    }
  }

  function setLoginBusy(busy, text = '') {
    $('btnSendCode').disabled = busy;
    $('btnVerifyCode').disabled = busy;
    $('btnResendCode').disabled = busy;

    if (text) setLoginMessage(text);
  }

  async function sendCode() {
    const email = $('loginEmail').value.trim().toLowerCase();

    if (!email || !$('loginEmail').checkValidity()) {
      setLoginMessage('Informe um e-mail válido cadastrado na planilha.', 'error');
      $('loginEmail').focus();
      return;
    }

    setLoginBusy(true, 'Enviando código por e-mail…');

    try {
      const result = await jsonp('startEmailLogin', { email });
      localStorage.setItem(EMAIL_KEY, email);
      $('codeStep').classList.remove('hidden');
      $('loginCode').value = '';
      $('loginCode').focus();
      $('codeHint').textContent =
        `Código enviado para ${result.maskedEmail || 'o e-mail cadastrado'}. Validade: 10 minutos.`;
      setLoginMessage(result.msg || 'Código enviado.');
    } catch (error) {
      setLoginMessage(errorText(error), 'error');
    } finally {
      setLoginBusy(false);
    }
  }

  async function verifyCode() {
    const email = $('loginEmail').value.trim().toLowerCase();
    const code = $('loginCode').value.replace(/\D/g, '').slice(0, 6);

    if (!email || !$('loginEmail').checkValidity()) {
      setLoginMessage('Informe um e-mail válido.', 'error');
      return;
    }

    if (!/^\d{6}$/.test(code)) {
      setLoginMessage('Informe o código de 6 dígitos recebido por e-mail.', 'error');
      $('loginCode').focus();
      return;
    }

    setLoginBusy(true, 'Validando código…');

    try {
      const result = await jsonp('verifyEmailCode', { email, code });
      sessionToken = String(result.token || '');
      sessionInfo = result.session || null;

      if (!sessionToken || !sessionInfo) {
        throw new Error('A API não devolveu uma sessão válida.');
      }

      localStorage.setItem(SESSION_KEY, sessionToken);
      localStorage.setItem(EMAIL_KEY, email);
      setLoginMessage('');
      enterApp(sessionInfo);
    } catch (error) {
      setLoginMessage(errorText(error), 'error');
    } finally {
      setLoginBusy(false);
    }
  }

  async function restoreSession() {
    const savedEmail = localStorage.getItem(EMAIL_KEY) || '';
    const savedToken = localStorage.getItem(SESSION_KEY) || '';

    if (savedEmail) $('loginEmail').value = savedEmail;
    if (!savedToken) return;

    sessionToken = savedToken;
    setLoginMessage('Validando sessão salva…');

    try {
      const result = await jsonp('getSessionInfo', { token: savedToken });
      sessionInfo = result.session || null;

      if (!sessionInfo) throw new Error('Sessão inválida.');

      enterApp(sessionInfo);
    } catch (_) {
      clearSession();
      setLoginMessage('');
    }
  }

  function clearSession() {
    sessionToken = '';
    sessionInfo = null;
    localStorage.removeItem(SESSION_KEY);

    if (sessionTimer) {
      clearInterval(sessionTimer);
      sessionTimer = null;
    }
  }

  async function logout() {
    const token = sessionToken;
    clearSession();

    if (token) {
      try {
        await jsonp('logout', { token }, 12000);
      } catch (_) {}
    }

    resetApplication();
    showLogin();
    setLoginMessage('Sessão encerrada.');
  }

  function showLogin() {
    $('loginView').classList.remove('hidden');
    $('appView').classList.add('hidden');
  }

  function enterApp(info) {
    sessionInfo = info;
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');

    $('userName').textContent =
      info.nome || info.email || 'Usuário';
    $('userRole').textContent =
      roleLabel(info.role, info.perfilAcesso);

    setApiStatus('Sessão protegida', 'ok');
    applyPermissions();
    startSessionCountdown();
    bootstrapData();
  }

  function roleLabel(role, rawProfile) {
    if (role === 'admin') return 'Administrador';
    if (role === 'editor') return rawProfile || 'Operador';
    return rawProfile || 'Consulta';
  }

  function startSessionCountdown() {
    if (sessionTimer) clearInterval(sessionTimer);

    const tick = () => {
      const expiresAt = Number(sessionInfo?.expiresAt || 0);
      const remaining = expiresAt - Date.now();

      if (remaining <= 0) {
        $('sessionTime').textContent = 'Sessão expirada';
        clearSession();
        resetApplication();
        showLogin();
        setLoginMessage('Sua sessão expirou. Solicite um novo código.', 'error');
        return;
      }

      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);
      $('sessionTime').textContent =
        `Sessão: ${hours}h ${String(minutes).padStart(2, '0')}min`;
    };

    tick();
    sessionTimer = setInterval(tick, 30000);
  }

  function applyPermissions() {
    const canWrite = Boolean(sessionInfo?.canWrite);
    const canConfig = Boolean(sessionInfo?.canConfig);

    $('readOnlyPill').classList.toggle('hidden', canWrite);

    ['pesoBruto', 'obs', 'comCelular'].forEach(id => {
      $(id).disabled = !canWrite;
    });

    $('altura').disabled = !canConfig;
    $('meta').disabled = !canConfig;

    validateWeight();
    enableProfileActions(Boolean(selectedProfile));
  }

  async function bootstrapData() {
    setApiStatus('Conectando à base…');

    try {
      const [profileResult, deviceResult] = await Promise.all([
        api('getPerfis'),
        api('listDevices')
      ]);

      profiles = Array.isArray(profileResult.rows) ? profileResult.rows : [];
      devices = Array.isArray(deviceResult.rows) ? deviceResult.rows : [];

      renderProfiles();
      fillDevices();

      try {
        const suggestion = await api('getDeviceWeight', {
          ua: navigator.userAgent
        });

        if (suggestion?.modelHint || suggestion?.matchKey) {
          $('deviceSuggestion').textContent =
            `Aparelho detectado: ${suggestion.modelHint || suggestion.matchKey}`;

          if (suggestion.pesoKg != null) {
            $('pesoCel').value =
              String(suggestion.pesoKg).replace('.', ',');
          }

          if (suggestion.matchKey) {
            const option = [...$('modeloSel').options]
              .find(item => item.value === suggestion.matchKey);

            if (option) $('modeloSel').value = suggestion.matchKey;
          }
        }
      } catch (_) {}

      setApiStatus('Base conectada', 'ok');
      setAppMessage('');
    } catch (error) {
      setApiStatus('Falha na API', 'bad');
      setAppMessage(errorText(error), 'error');
    }
  }

  function renderProfiles() {
    $('profileCount').textContent = `${profiles.length} perfil(is)`;

    $('profiles').innerHTML = profiles.length
      ? profiles.map(profile => `
        <button class="profile-btn" data-profile="${escapeHtml(profile.nome)}" type="button">
          <b>${escapeHtml(profile.nome)}</b>
          <span>
            Altura: ${profile.altura_m != null ? String(profile.altura_m).replace('.', ',') : '—'} m
            | Meta: ${profile.meta_kg != null ? fmt1(profile.meta_kg) : '—'} kg
          </span>
        </button>
      `).join('')
      : '<div class="notice">Nenhum perfil foi liberado para este acesso.</div>';

    document.querySelectorAll('.profile-btn').forEach(button => {
      button.onclick = () => selectProfile(button.dataset.profile);
    });
  }

  function fillDevices() {
    $('modeloSel').innerHTML =
      '<option value="">Selecione…</option>' +
      devices.map(device => `
        <option
          value="${escapeHtml(device.key)}"
          data-weight="${device.pesoKg}"
        >${escapeHtml(device.key)}</option>
      `).join('');
  }

  async function selectProfile(name) {
    selectedProfile = name;

    document.querySelectorAll('.profile-btn').forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.profile === name
      );
    });

    $('selectedPill').textContent = `Selecionado: ${name}`;
    enableProfileActions(true);

    await Promise.all([
      refreshSummary(),
      refreshComparisons()
    ]);
  }

  function enableProfileActions(hasProfile) {
    const canWrite = Boolean(sessionInfo?.canWrite);
    const canConfig = Boolean(sessionInfo?.canConfig);

    $('btnSaveGoal').disabled = !hasProfile || !canConfig;
    document.querySelectorAll('.waterBtn').forEach(button => {
      button.disabled = !hasProfile || !canWrite;
    });
    $('btnWaterCustom').disabled = !hasProfile || !canWrite;

    validateWeight();
  }

  function updateDeviceUi() {
    const canWrite = Boolean(sessionInfo?.canWrite);
    const enabled = canWrite && $('comCelular').checked;

    $('modeloSel').disabled = !enabled;
    $('pesoCel').disabled = !enabled;
    validateWeight();
  }

  function validateWeight() {
    const canWrite = Boolean(sessionInfo?.canWrite);
    const bruto = num($('pesoBruto').value);
    const withPhone = $('comCelular').checked;
    const phone = num($('pesoCel').value);

    const valid =
      canWrite &&
      Boolean(selectedProfile) &&
      bruto != null &&
      bruto > 0 &&
      (
        !withPhone ||
        (
          $('modeloSel').value &&
          phone != null &&
          phone >= 0 &&
          phone < bruto
        )
      );

    $('btnSaveWeight').disabled = !valid;
    $('netWeightPill').textContent =
      `Peso líquido: ${valid ? `${fmt1(bruto - (withPhone ? phone : 0))} kg` : '—'}`;
  }

  async function saveWeight() {
    const bruto = num($('pesoBruto').value);
    const withPhone = $('comCelular').checked;
    const phone = num($('pesoCel').value) || 0;
    const model = $('modeloSel').value;

    $('btnSaveWeight').disabled = true;
    setAppMessage('Salvando pesagem…');

    try {
      const result = await api('saveWeight', {
        perfil: selectedProfile,
        pesoBruto: bruto,
        comCelular: withPhone,
        pesoCelularKg: withPhone ? phone : 0,
        unidade: 'kg',
        origem: withPhone ? 'foto' : 'manual',
        obs: $('obs').value || '',
        ua: navigator.userAgent,
        modelHint: '',
        matchKey: model
      });

      setAppMessage(`Pesagem salva: ${fmt1(result.pesoLiquido)} kg.`);
      clearWeightForm();

      await Promise.all([
        refreshSummary(),
        refreshComparisons()
      ]);
    } catch (error) {
      setAppMessage(errorText(error), 'error');
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
    const altura = num($('altura').value);
    const meta = num($('meta').value);

    if (!selectedProfile) return;

    try {
      await api('saveGoal', {
        perfil: selectedProfile,
        altura_m: altura,
        meta_kg: meta
      });

      setAppMessage('Meta e altura atualizadas.');
      await refreshSummary();
    } catch (error) {
      setAppMessage(errorText(error), 'error');
    }
  }

  async function addWater(value) {
    const ml = num(value);

    if (!selectedProfile || !ml || ml <= 0) return;

    $('waterStatus').textContent =
      `Registrando ${Math.round(ml)} ml…`;

    try {
      await api('addWater', {
        perfil: selectedProfile,
        ml
      });

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
      const result = await api('getSummary', {
        perfil: selectedProfile
      });

      $('altura').value =
        result.altura_m != null
          ? String(result.altura_m).replace('.', ',')
          : '';
      $('meta').value =
        result.meta_kg != null
          ? String(result.meta_kg).replace('.', ',')
          : '';

      $('kpiLast').textContent = fmt1(result.ultimo_kg);
      $('kpiImc').textContent = fmt1(result.imc);
      $('kpiMin').textContent = fmt1(result.min_kg);
      $('kpiMinDate').textContent = fmtDate(result.dataMin);
      $('kpiMax').textContent = fmt1(result.max_kg);
      $('kpiMaxDate').textContent = fmtDate(result.dataMax);

      $('waterToday').textContent =
        Math.round(Number(result.agua_hoje_ml || 0));
      $('waterGoal').textContent =
        Math.round(Number(result.agua_meta_ml || 0));

      renderHistory(result.historico_tabela || []);
      renderCharts(result.historico_grafico || []);
    } catch (error) {
      setAppMessage(errorText(error), 'error');
    }
  }

  function renderHistory(rows) {
    $('historyBody').innerHTML = rows.length
      ? rows.map(row => `
        <tr>
          <td>${fmtDate(row.dtIso)}</td>
          <td class="num">
            <b>${row.pesoKg != null ? fmt1(row.pesoKg) : '—'}</b>
          </td>
          <td class="num">${Math.round(Number(row.aguaMl || 0))}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="3" style="color:var(--muted)">Sem histórico para o perfil.</td></tr>';
  }

  function renderCharts(rows) {
    if (typeof Chart === 'undefined') return;

    const labels = rows.map(row => fmtDate(row.dtIso).split(' ')[0]);
    const weights = rows.map(row =>
      row.pesoKg != null ? Number(row.pesoKg) : null
    );
    const waters = rows.map(row =>
      Math.round(Number(row.aguaMl || 0))
    );

    if (weightChart) weightChart.destroy();
    if (waterChart) waterChart.destroy();

    weightChart = new Chart($('weightChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Peso (kg)',
          data: weights,
          tension: 0.28,
          spanGaps: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#dbeafe' } }
        },
        scales: {
          x: { ticks: { color: '#94a3b8' } },
          y: { ticks: { color: '#94a3b8' } }
        }
      }
    });

    waterChart = new Chart($('waterChart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Água (ml)',
          data: waters
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#dbeafe' } }
        },
        scales: {
          x: { ticks: { color: '#94a3b8' } },
          y: {
            beginAtZero: true,
            ticks: { color: '#94a3b8' }
          }
        }
      }
    });
  }

  async function refreshComparisons() {
    if (!selectedProfile) return;

    const days = Number($('compareDays').value || 30);
    const fixWeekday = $('fixWeekday').checked;
    const dia = Math.round(num($('compareDay').value) || 0);
    const mes = Math.round(num($('compareMonth').value) || 0);

    try {
      const result = await api('getComparisons', {
        perfil: selectedProfile,
        days,
        fixWeekday,
        dia,
        mes
      });

      const today = result.hoje || {};
      const comparison = result.compDias || {};

      $('bToday').textContent =
        `Hoje: ${today.pesoKg != null ? `${fmt1(today.pesoKg)} kg` : '—'}`;
      $('bTarget').textContent =
        `${comparison.fixWeekday ? 'Mesmo dia' : 'Móvel'}: ` +
        `${comparison.alvoPesoKg != null ? `${fmt1(comparison.alvoPesoKg)} kg` : '—'} ` +
        `(${fmtDate(comparison.alvoDayKey)})`;
      $('bDelta').textContent =
        `Δ: ${comparison.deltaKg != null ? `${fmt1(comparison.deltaKg)} kg` : '—'}`;
      $('bDelta').className =
        `badge ${Number(comparison.deltaKg) > 0 ? 'up' : Number(comparison.deltaKg) < 0 ? 'down' : ''}`;

      $('compareHint').textContent = comparison.fixWeekday
        ? `Mesmo dia da semana dentro de ${comparison.days} dias.`
        : `Exatamente ${comparison.days} dias atrás.`;

      const year = result.compAno;

      if (year?.ok) {
        $('bYearNow').textContent =
          `Ano atual (${fmtDate(year.atual?.dayKey)}): ` +
          `${year.atual?.pesoKg != null ? `${fmt1(year.atual.pesoKg)} kg` : '—'}`;
        $('bYearPrev').textContent =
          `Ano anterior (${fmtDate(year.anterior?.dayKey)}): ` +
          `${year.anterior?.pesoKg != null ? `${fmt1(year.anterior.pesoKg)} kg` : '—'}`;
        $('bYearDelta').textContent =
          `Δ ano: ${year.deltaKg != null ? `${fmt1(year.deltaKg)} kg` : '—'}`;
        $('bYearDelta').className =
          `badge ${Number(year.deltaKg) > 0 ? 'up' : Number(year.deltaKg) < 0 ? 'down' : ''}`;
        $('compareYearHint').textContent =
          'Comparação do mesmo dia e mês entre anos.';
      } else {
        $('bYearNow').textContent = 'Ano atual: —';
        $('bYearPrev').textContent = 'Ano anterior: —';
        $('bYearDelta').textContent = 'Δ ano: —';
        $('compareYearHint').textContent =
          year?.msg || 'Informe dia e mês para comparar.';
      }
    } catch (error) {
      $('compareHint').textContent = errorText(error);
    }
  }

  function scheduleComparisons() {
    clearTimeout(comparisonTimer);
    comparisonTimer = setTimeout(refreshComparisons, 350);
  }

  function resetApplication() {
    profiles = [];
    devices = [];
    selectedProfile = '';

    $('profiles').innerHTML = '';
    $('profileCount').textContent = '0 perfil(is)';
    $('selectedPill').textContent = 'Selecionado: —';
    $('deviceSuggestion').textContent = 'Aparelho detectado: —';
    $('userName').textContent = '';
    $('userRole').textContent = '';
    $('sessionTime').textContent = '';
    $('historyBody').innerHTML =
      '<tr><td colspan="3" style="color:var(--muted)">Selecione um perfil.</td></tr>';

    clearWeightForm();

    if (weightChart) {
      weightChart.destroy();
      weightChart = null;
    }

    if (waterChart) {
      waterChart.destroy();
      waterChart = null;
    }
  }

  $('btnSendCode').onclick = sendCode;
  $('btnResendCode').onclick = sendCode;
  $('btnVerifyCode').onclick = verifyCode;
  $('btnLogout').onclick = logout;

  $('loginEmail').addEventListener('keydown', event => {
    if (event.key === 'Enter') sendCode();
  });

  $('loginCode').addEventListener('input', event => {
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
  });

  $('loginCode').addEventListener('keydown', event => {
    if (event.key === 'Enter') verifyCode();
  });

  $('comCelular').onchange = updateDeviceUi;
  $('pesoBruto').oninput = validateWeight;
  $('pesoCel').oninput = validateWeight;

  $('modeloSel').onchange = () => {
    const option = $('modeloSel').selectedOptions[0];
    const weight = num(option?.dataset?.weight);

    if (weight != null) {
      $('pesoCel').value = String(weight).replace('.', ',');
    }

    $('deviceWeightHint').textContent =
      `Peso do aparelho: ${weight != null ? `${fmt1(weight)} kg` : '—'}`;

    validateWeight();
  };

  $('btnSaveWeight').onclick = saveWeight;
  $('btnClear').onclick = clearWeightForm;
  $('btnSaveGoal').onclick = saveGoal;

  document.querySelectorAll('.waterBtn').forEach(button => {
    button.onclick = () => addWater(button.dataset.ml);
  });

  $('btnWaterCustom').onclick = () =>
    addWater($('waterCustom').value);

  $('waterCustom').addEventListener('input', () => {
    const enabled =
      Boolean(selectedProfile) &&
      Boolean(sessionInfo?.canWrite) &&
      Number($('waterCustom').value) > 0;

    $('btnWaterCustom').disabled = !enabled;
  });

  ['compareDays', 'fixWeekday', 'compareDay', 'compareMonth']
    .forEach(id => {
      $(id).addEventListener(
        id === 'compareDay' || id === 'compareMonth'
          ? 'input'
          : 'change',
        scheduleComparisons
      );
    });

  restoreSession();
})();
