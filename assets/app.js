(() => {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyA8tO_E2s6R9bYnEW6_5skqCUrBSVLLKkw",
    authDomain: "pss-bolao-esportivo.firebaseapp.com",
    projectId: "pss-bolao-esportivo",
    storageBucket: "pss-bolao-esportivo.firebasestorage.app",
    messagingSenderId: "575209475526",
    appId: "1:575209475526:web:7d2d1efa2d9fd8b600f6c7"
  };
  const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzM4o4WTSWrRAxronWPheQVaUIZnYMNIcJrz6ivOzV2NtvO3JuGRuSH5CHCIBfvRBBdmw/exec";
  const ADMIN_EMAIL = "portalsimonsports@gmail.com";
  const ACCESS_COLLECTION = "usuarios_pesagem";
  const BRIDGE_ORIGIN = "https://script.google.com";
  const GAS_CONTENT_ORIGIN = "https://script.googleusercontent.com";

  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();

  const $ = id => document.getElementById(id);
  const loginView = $('loginView'), appView = $('appView');
  let currentUser = null, accessDoc = null, profiles = [], devices = [], selectedProfile = '';
  let bridgeReady = false, requestSeq = 0, weightChart = null, waterChart = null;
  const pending = new Map();

  function num(v){
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  function fmt1(v){ return Number.isFinite(Number(v)) ? Number(v).toFixed(1).replace('.', ',') : '—'; }
  function fmtDate(v){
    if (!v) return '—';
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : s;
  }
  function escapeHtml(s){ return String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function setLoginMsg(text, type=''){
    const el=$('loginMsg'); el.textContent=text||''; el.className=`notice${type==='error'?' error':''}${text?'':' hidden'}`;
  }
  function setAppMsg(text, type=''){
    const el=$('appMsg'); el.textContent=text||''; el.className=`notice${type==='error'?' error':''}${text?'':' hidden'}`;
  }
  function setBridgeStatus(text, state=''){
    const el=$('bridgeStatus'); el.innerHTML=`<span class="dot ${state}"></span><span>${escapeHtml(text)}</span>`;
  }
  function errorText(err){
    const code=String(err?.code||'');
    if(code.includes('wrong-password')||code.includes('invalid-credential')) return 'E-mail ou código de acesso inválido.';
    if(code.includes('email-already-in-use')) return 'Este e-mail já possui cadastro. Use Entrar.';
    if(code.includes('weak-password')) return 'O código deve ter pelo menos 6 caracteres.';
    if(code.includes('too-many-requests')) return 'Muitas tentativas. Aguarde alguns minutos.';
    return String(err?.message||err||'Falha não identificada.').replace(/^Firebase:\s*/,'');
  }

  async function ensureAccessDocument(user){
    const ref=db.collection(ACCESS_COLLECTION).doc(user.uid);
    let snap=await ref.get();
    if(!snap.exists){
      const isMaster=String(user.email||'').toLowerCase()===ADMIN_EMAIL;
      await ref.set({
        email:String(user.email||'').toLowerCase(),
        nome:user.displayName||'',
        ativo:isMaster,
        admin:isMaster,
        perfis:isMaster?['*']:[],
        criadoEm:firebase.firestore.FieldValue.serverTimestamp(),
        atualizadoEm:firebase.firestore.FieldValue.serverTimestamp()
      });
      snap=await ref.get();
    }
    return {id:snap.id,...snap.data()};
  }

  async function login(){
    const email=$('loginEmail').value.trim().toLowerCase();
    const code=$('loginCode').value;
    if(!email||!code){setLoginMsg('Informe o e-mail e o código de acesso.','error');return;}
    setLoginMsg('Validando acesso…');
    try{ await auth.signInWithEmailAndPassword(email,code); }
    catch(err){ setLoginMsg(errorText(err),'error'); }
  }

  async function register(){
    const email=$('loginEmail').value.trim().toLowerCase();
    const code=$('loginCode').value;
    if(!email||code.length<6){setLoginMsg('Informe um e-mail válido e um código com pelo menos 6 caracteres.','error');return;}
    setLoginMsg('Criando solicitação…');
    try{
      const cred=await auth.createUserWithEmailAndPassword(email,code);
      await ensureAccessDocument(cred.user);
      setLoginMsg('Solicitação criada. Aguarde a liberação do administrador.');
    }catch(err){ setLoginMsg(errorText(err),'error'); }
  }

  function loadBridge(){
    bridgeReady=false;
    setBridgeStatus('Conectando à base…');
    const iframe=$('gasBridge');
    iframe.src=WEB_APP_URL+(WEB_APP_URL.includes('?')?'&':'?')+'mode=bridge&v=20260713';
    window.setTimeout(()=>{ if(!bridgeReady) setBridgeStatus('API do Apps Script ainda não atualizada','bad'); },15000);
  }

  window.addEventListener('message',event=>{
    if(event.origin!==BRIDGE_ORIGIN && event.origin!==GAS_CONTENT_ORIGIN) return;
    const data=event.data||{};
    if(data.type==='PSS_BRIDGE_READY'){
      bridgeReady=true; setBridgeStatus('Base conectada','ok'); bootstrapData(); return;
    }
    if(data.type==='PSS_BRIDGE_RESPONSE' && data.id){
      const p=pending.get(data.id); if(!p) return;
      pending.delete(data.id); clearTimeout(p.timer);
      data.ok ? p.resolve(data.result) : p.reject(new Error(data.error||'Falha na API.'));
    }
  });

  async function api(action,payload={}){
    if(!currentUser) throw new Error('Sessão encerrada.');
    if(!bridgeReady) throw new Error('A integração com o Apps Script ainda não está pronta.');
    const token=await currentUser.getIdToken();
    const id=`req_${Date.now()}_${++requestSeq}`;
    const iframe=$('gasBridge');
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Tempo limite da API excedido.'));},30000);
      pending.set(id,{resolve,reject,timer});
      iframe.contentWindow.postMessage({type:'PSS_BRIDGE_CALL',id,request:{token,action,payload}},'*');
    });
  }

  async function bootstrapData(){
    try{
      [profiles,devices]=await Promise.all([api('apiGetPerfis'),api('apiListDevices')]);
      renderProfiles(); fillDevices();
      try{
        const s=await api('apiGetDeviceWeight',{ua:navigator.userAgent});
        if(s?.modelHint||s?.matchKey){
          $('deviceSuggestion').textContent=`Aparelho detectado: ${s.modelHint||s.matchKey}`;
          if(s.pesoKg!=null) $('pesoCel').value=String(s.pesoKg).replace('.',',');
        }
      }catch(_){}
      setAppMsg('');
    }catch(err){ setAppMsg(errorText(err),'error'); }
  }

  function renderProfiles(){
    $('profileCount').textContent=`${profiles.length} perfil(is)`;
    $('profiles').innerHTML=profiles.length?profiles.map(p=>`
      <button class="profile-btn" data-profile="${escapeHtml(p.nome)}">
        <b>${escapeHtml(p.nome)}</b>
        <span>Altura: ${p.altura_m!=null?String(p.altura_m).replace('.',','):'—'} m | Meta: ${p.meta_kg!=null?fmt1(p.meta_kg):'—'} kg</span>
      </button>`).join(''):'<div class="notice">Nenhum perfil foi liberado para este acesso.</div>';
    document.querySelectorAll('.profile-btn').forEach(btn=>btn.onclick=()=>selectProfile(btn.dataset.profile));
  }

  function fillDevices(){
    $('modeloSel').innerHTML='<option value="">Selecione…</option>'+devices.map(d=>`<option value="${escapeHtml(d.key)}" data-weight="${d.pesoKg}">${escapeHtml(d.key)}</option>`).join('');
  }

  async function selectProfile(name){
    selectedProfile=name;
    document.querySelectorAll('.profile-btn').forEach(b=>b.classList.toggle('active',b.dataset.profile===name));
    $('selectedPill').textContent=`Selecionado: ${name}`;
    enableProfileActions(true);
    await Promise.all([refreshSummary(),refreshComparisons()]);
  }

  function enableProfileActions(on){
    $('btnSaveGoal').disabled=!on;
    document.querySelectorAll('.waterBtn').forEach(b=>b.disabled=!on);
    $('btnWaterCustom').disabled=!on;
    validateWeight();
  }

  function updateDeviceUi(){
    const on=$('comCelular').checked;
    $('modeloSel').disabled=!on; $('pesoCel').disabled=!on;
    validateWeight();
  }

  function validateWeight(){
    const bruto=num($('pesoBruto').value), comCel=$('comCelular').checked, cel=num($('pesoCel').value);
    const valid=!!selectedProfile && bruto!=null && bruto>0 && (!comCel||(cel!=null&&cel>=0&&cel<bruto));
    $('btnSaveWeight').disabled=!valid;
    $('netWeightPill').textContent=`Peso líquido: ${valid?fmt1(bruto-(comCel?cel:0))+' kg':'—'}`;
  }

  async function saveWeight(){
    const bruto=num($('pesoBruto').value), comCel=$('comCelular').checked, cel=num($('pesoCel').value)||0;
    const model=$('modeloSel').value;
    $('btnSaveWeight').disabled=true; setAppMsg('Salvando pesagem…');
    try{
      const res=await api('apiSalvarPesagem',{perfil:selectedProfile,pesoBruto:bruto,comCelular:comCel,pesoCelularKg:comCel?cel:0,
        unidade:'kg',origem:comCel?'foto':'manual',obs:$('obs').value||'',ua:navigator.userAgent,modelHint:'',matchKey:model});
      setAppMsg(`Pesagem salva: ${fmt1(res.pesoLiquido)} kg.`);
      clearWeightForm(); await Promise.all([refreshSummary(),refreshComparisons()]);
    }catch(err){setAppMsg(errorText(err),'error');}
    finally{validateWeight();}
  }

  function clearWeightForm(){
    $('pesoBruto').value='';$('obs').value='';$('comCelular').checked=false;$('modeloSel').value='';$('pesoCel').value='';
    updateDeviceUi();
  }

  async function saveGoal(){
    const altura=num($('altura').value), meta=num($('meta').value);
    if(!selectedProfile){return;}
    try{await api('apiSalvarMetaAltura',{perfil:selectedProfile,altura_m:altura,meta_kg:meta});setAppMsg('Meta e altura atualizadas.');await refreshSummary();}
    catch(err){setAppMsg(errorText(err),'error');}
  }

  async function addWater(ml){
    const n=num(ml); if(!selectedProfile||!n||n<=0)return;
    $('waterStatus').textContent=`Registrando ${Math.round(n)} ml…`;
    try{await api('apiAddAgua',{perfil:selectedProfile,ml:n});$('waterCustom').value='';$('waterStatus').textContent='Água registrada.';await refreshSummary();}
    catch(err){$('waterStatus').textContent=errorText(err);}
  }

  async function refreshSummary(){
    if(!selectedProfile)return;
    try{
      const r=await api('apiGetResumoPerfil',{perfil:selectedProfile});
      $('altura').value=r.altura_m!=null?String(r.altura_m).replace('.',','):'';
      $('meta').value=r.meta_kg!=null?String(r.meta_kg).replace('.',','):'';
      $('kpiLast').textContent=fmt1(r.ultimo_kg);$('kpiImc').textContent=fmt1(r.imc);
      $('kpiMin').textContent=fmt1(r.min_kg);$('kpiMinDate').textContent=fmtDate(r.dataMin);
      $('kpiMax').textContent=fmt1(r.max_kg);$('kpiMaxDate').textContent=fmtDate(r.dataMax);
      $('waterToday').textContent=Math.round(Number(r.agua_hoje_ml||0));$('waterGoal').textContent=Math.round(Number(r.agua_meta_ml||0));
      renderHistory(r.historico_tabela||[]);renderCharts(r.historico_grafico||[]);
    }catch(err){setAppMsg(errorText(err),'error');}
  }

  function renderHistory(rows){
    $('historyBody').innerHTML=rows.length?rows.map(x=>`<tr><td>${fmtDate(x.dtIso)}</td><td class="num"><b>${x.pesoKg!=null?fmt1(x.pesoKg):'—'}</b></td><td class="num">${Math.round(Number(x.aguaMl||0))}</td></tr>`).join('')
      :'<tr><td colspan="3" style="color:var(--muted)">Sem histórico para o perfil.</td></tr>';
  }

  function renderCharts(rows){
    const labels=rows.map(x=>fmtDate(x.dtIso).split(' ')[0]);
    const weights=rows.map(x=>x.pesoKg!=null?Number(x.pesoKg):null);
    const waters=rows.map(x=>Math.round(Number(x.aguaMl||0)));
    if(weightChart)weightChart.destroy();if(waterChart)waterChart.destroy();
    weightChart=new Chart($('weightChart'),{type:'line',data:{labels,datasets:[{label:'Peso (kg)',data:weights,tension:.28,spanGaps:true}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#dbeafe'}}},scales:{x:{ticks:{color:'#94a3b8'}},y:{ticks:{color:'#94a3b8'}}}}});
    waterChart=new Chart($('waterChart'),{type:'bar',data:{labels,datasets:[{label:'Água (ml)',data:waters}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#dbeafe'}}},scales:{x:{ticks:{color:'#94a3b8'}},y:{beginAtZero:true,ticks:{color:'#94a3b8'}}}}});
  }

  async function refreshComparisons(){
    if(!selectedProfile)return;
    const days=Number($('compareDays').value||30),fixWeekday=$('fixWeekday').checked;
    const dia=Math.round(num($('compareDay').value)||0),mes=Math.round(num($('compareMonth').value)||0);
    try{
      const r=await api('apiGetComparativosPerfil',{perfil:selectedProfile,days,fixWeekday,dia,mes});
      const h=r.hoje||{},c=r.compDias||{};
      $('bToday').textContent=`Hoje: ${h.pesoKg!=null?fmt1(h.pesoKg)+' kg':'—'}`;
      $('bTarget').textContent=`${c.fixWeekday?'Mesmo dia':'Móvel'}: ${c.alvoPesoKg!=null?fmt1(c.alvoPesoKg)+' kg':'—'} (${fmtDate(c.alvoDayKey)})`;
      $('bDelta').textContent=`Δ: ${c.deltaKg!=null?fmt1(c.deltaKg)+' kg':'—'}`;
      $('bDelta').className='badge '+(Number(c.deltaKg)>0?'up':Number(c.deltaKg)<0?'down':'');
      $('compareHint').textContent=c.fixWeekday?`Mesmo dia da semana dentro de ${c.days} dias.`:`Exatamente ${c.days} dias atrás.`;
      const y=r.compAno;
      if(y?.ok){
        $('bYearNow').textContent=`Ano atual (${fmtDate(y.atual?.dayKey)}): ${y.atual?.pesoKg!=null?fmt1(y.atual.pesoKg)+' kg':'—'}`;
        $('bYearPrev').textContent=`Ano anterior (${fmtDate(y.anterior?.dayKey)}): ${y.anterior?.pesoKg!=null?fmt1(y.anterior.pesoKg)+' kg':'—'}`;
        $('bYearDelta').textContent=`Δ ano: ${y.deltaKg!=null?fmt1(y.deltaKg)+' kg':'—'}`;
        $('bYearDelta').className='badge '+(Number(y.deltaKg)>0?'up':Number(y.deltaKg)<0?'down':'');
        $('compareYearHint').textContent='Comparação do mesmo dia e mês entre anos.';
      }else{
        $('bYearNow').textContent='Ano atual: —';$('bYearPrev').textContent='Ano anterior: —';$('bYearDelta').textContent='Δ ano: —';
        $('compareYearHint').textContent=y?.msg||'Informe dia e mês para comparar.';
      }
    }catch(err){$('compareHint').textContent=errorText(err);}
  }

  async function loadAdminUsers(){
    if(!accessDoc?.admin)return;
    $('adminUsers').innerHTML='<div class="notice">Carregando usuários…</div>';
    try{
      const snap=await db.collection(ACCESS_COLLECTION).orderBy('email').get();
      $('adminUsers').innerHTML='';
      snap.forEach(doc=>{
        const d=doc.data()||{}; const row=document.createElement('div');row.className='admin-user';
        row.innerHTML=`
          <div class="field"><label>E-mail</label><input class="input au-email" value="${escapeHtml(d.email||'')}" disabled></div>
          <label class="checkrow" style="min-height:43px;align-items:center"><input class="au-active" type="checkbox" ${d.ativo?'checked':''}><span>Ativo</span></label>
          <div class="field"><label>Perfis permitidos (* = todos)</label><input class="input au-profiles" value="${escapeHtml((d.perfis||[]).join(', '))}"></div>
          <button class="btn au-save">Salvar</button>`;
        row.querySelector('.au-save').onclick=async()=>{
          const perfis=row.querySelector('.au-profiles').value.split(',').map(x=>x.trim()).filter(Boolean);
          await doc.ref.update({ativo:row.querySelector('.au-active').checked,perfis,atualizadoEm:firebase.firestore.FieldValue.serverTimestamp()});
          row.querySelector('.au-save').textContent='Salvo';setTimeout(()=>row.querySelector('.au-save').textContent='Salvar',1200);
        };
        $('adminUsers').appendChild(row);
      });
    }catch(err){$('adminUsers').innerHTML=`<div class="notice error">${escapeHtml(errorText(err))}</div>`;}
  }

  async function enterApp(user){
    currentUser=user; accessDoc=await ensureAccessDocument(user);
    if(!accessDoc.ativo){
      await auth.signOut(); setLoginMsg('Cadastro localizado, mas ainda não foi liberado pelo administrador.','error'); return;
    }
    loginView.classList.add('hidden');appView.classList.remove('hidden');$('userEmail').textContent=user.email||'Usuário';
    $('btnAdmin').classList.toggle('hidden',!accessDoc.admin);
    loadBridge();
  }

  auth.onAuthStateChanged(async user=>{
    try{
      if(user){await enterApp(user);}
      else{currentUser=null;accessDoc=null;loginView.classList.remove('hidden');appView.classList.add('hidden');}
    }catch(err){await auth.signOut();setLoginMsg(errorText(err),'error');}
  });

  $('btnLogin').onclick=login;$('btnRegister').onclick=register;$('btnLogout').onclick=()=>auth.signOut();
  $('loginCode').addEventListener('keydown',e=>{if(e.key==='Enter')login();});
  $('btnAdmin').onclick=()=>{$('adminPanel').classList.toggle('hidden');if(!$('adminPanel').classList.contains('hidden'))loadAdminUsers();};
  $('btnReloadUsers').onclick=loadAdminUsers;
  $('comCelular').onchange=updateDeviceUi;$('pesoBruto').oninput=validateWeight;$('pesoCel').oninput=validateWeight;
  $('modeloSel').onchange=()=>{const o=$('modeloSel').selectedOptions[0],w=num(o?.dataset?.weight);if(w!=null)$('pesoCel').value=String(w).replace('.',',');$('deviceWeightHint').textContent=`Peso do aparelho: ${w!=null?fmt1(w)+' kg':'—'}`;validateWeight();};
  $('btnSaveWeight').onclick=saveWeight;$('btnClear').onclick=clearWeightForm;$('btnSaveGoal').onclick=saveGoal;
  document.querySelectorAll('.waterBtn').forEach(b=>b.onclick=()=>addWater(b.dataset.ml));$('btnWaterCustom').onclick=()=>addWater($('waterCustom').value);
  ['compareDays','fixWeekday','compareDay','compareMonth'].forEach(id=>$(id).addEventListener(id==='compareDay'||id==='compareMonth'?'input':'change',()=>{clearTimeout(window.__cmpTimer);window.__cmpTimer=setTimeout(refreshComparisons,350);}));
})();
