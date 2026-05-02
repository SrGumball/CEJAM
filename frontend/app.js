// ═══════════════════════════════════════════
// CEJAM — App Principal
// ═══════════════════════════════════════════
import { fb } from './firebase-config.js';
let currentUser = null;
let STATE = { pacientes: [], prescricoes: [], relatorios: [], historico: [], funcionarios: [] };
let _altaId = null, _dispId = null, _admId = null;
let _pendingEmail = null;

// ── HELPERS ────────────────────────────────
const $ = id => document.getElementById(id);
function show(id, d='flex'){ const e=$(id); if(e) e.style.display=d; }
function hide(id){ const e=$(id); if(e) e.style.display='none'; }
function om(id){ $(id).classList.add('open'); }
function cm(id){ $(id).classList.remove('open'); }

function renderHistory(){
  const body = $('hist-body');
  if(!body) return;
  body.innerHTML = '';
  
  // Todos os cargos clínicos podem ver o histórico para supervisão
  const podeVer = ['admin', 'medico', 'enfermagem', 'tecnico', 'farmacia'].includes(currentUser?.cargo);
  if(!podeVer) return;

  STATE.historico.forEach(h => {
    const div = document.createElement('div');
    div.className = 'hist-item';
    div.innerHTML = `
      <div class="hist-time">${h.criado_em}</div>
      <div class="hist-info">
        <strong>${tipoHist(h.tipo)}</strong> — ${h.pac_nome}<br>
        <small>${h.medicamento} | Por: ${h.responsavel}</small>
      </div>
    `;
    body.appendChild(div);
  });
}

function renderAdmList(){
  const list = $('adm-list');
  if(!list) return;
  list.innerHTML = '';
  
  // Permite que médicos e enfermeiros visualizem o trabalho dos técnicos
  const disp = STATE.prescricoes.filter(p => p.status === 'dispensada');
  
  disp.forEach(p => {
    const div = document.createElement('div');
    div.className = 'adm-item';
    div.innerHTML = `
      <div>
        <strong>${p.pac_nome}</strong><br>
        <small>${p.medicamento} - ${p.dose}</small>
      </div>
      ${sbadge(p.status)}
    `;
    list.appendChild(div);
  });
}


function toast(msg, icon='✓', type=''){
  const a=$('toast-area'), t=document.createElement('div');
  t.className='toast'+(type?' toast-'+type:'');
  t.innerHTML=`<span>${icon}</span>${msg}`;
  a.appendChild(t); setTimeout(()=>t.remove(),3500);
}

function dias(admStr){
  const [d,m,a]=admStr.split('/').map(Number);
  return Math.floor((Date.now()-new Date(a,m-1,d))/86400000);
}
function dBadge(admStr){
  const d=dias(admStr);
  return `<span class="dias-badge ${d<=7?'d-ok':d<=20?'d-med':'d-long'}">${d}d</span>`;
}
function sbadge(s){
  const m={ativa:'b-blue',dispensada:'b-green',administrada:'b-purple',alta:'b-gray'};
  const l={ativa:'Ativa',dispensada:'Dispensada',administrada:'Administrada',alta:'Alta'};
  return `<span class="badge ${m[s]||'b-gray'}">${l[s]||s}</span>`;
}
function estadoBadge(e){
  if(e.includes('BEG')) return '<span class="badge b-green">BEG</span>';
  if(e.includes('REG')) return '<span class="badge b-yellow">REG</span>';
  return '<span class="badge b-red">MEG</span>';
}
function tipoHist(t){
  const m={'Prescrição':'b-blue','Dispensação':'b-green','Administração':'b-purple','Alta':'b-orange'};
  return `<span class="badge ${m[t]||'b-gray'}">${t}</span>`;
}
function cargoLabel(c){return {medico:'Médico',farmacia:'Farmacêutico',enfermagem:'Enfermeiro',tecnico:'Técnico',admin:'Admin'}[c]||c;}
function cargoColor(c){return {medico:'var(--blue-dim)',farmacia:'var(--green-dim)',enfermagem:'var(--purple-dim)',tecnico:'var(--purple-dim)',admin:'var(--yellow-dim)'}[c]||'var(--surface2)';}
function tipoHistCor(t){
  return {'Prescrição':'var(--blue)','Dispensação':'var(--green)','Administração':'var(--purple)','Alta':'var(--orange)'}[t]||'var(--text3)';
}

// Clock
function updateClock(){
  const e=$('sb-clock');
  if(e) e.textContent='● Online · '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}
setInterval(updateClock,30000);

// ── AUTH & CORE ─────────────────────────────
async function doLogin(){
  const email=$('l-email').value.trim();
  const senha=$('l-senha').value;
  const btn=$('btn-login');
  const errBox=$('login-err');

  if(!email || !senha) {
    toast("Preencha todos os campos", "⚠", "b-red");
    return;
  }

  errBox.classList.remove('show');
  btn.disabled=true; 
  btn.innerHTML='<div class="spinner spinner-sm"></div> Entrando...';
  
  // Helper: timeout como Promise rejeitada
  const timeout = (ms, msg) => new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));

  try {
    console.log("1. Autenticando com Firebase Auth...");
    
    // Configura debug para ajudar
    firebase.setLogLevel('debug');

    // Autenticação padrão do Firebase
    let userCred;
    try {
      userCred = await Promise.race([
        fb.auth.signInWithEmailAndPassword(email, senha),
        timeout(15000, "Tempo limite excedido ao autenticar. Verifique sua conexão.")
      ]);
    } catch (err) {
      console.error("Erro Auth:", err.code || err);
      if (err.message && err.message.includes("Tempo limite")) throw err;
      throw new Error("E-mail ou senha incorretos.");
    }
    
    const uid = userCred.user.uid;
    console.log("2. Autenticado com sucesso. UID:", uid);

    // Passo 3: Busca perfil do usuário no Firestore
    console.log("5. Buscando perfil...");
    const userDoc = await Promise.race([
      fb.db.collection("funcionarios").doc(email).get(),
      timeout(8000, "Tempo limite ao consultar banco de dados.")
    ]);
    
    if (userDoc.exists) {
      currentUser = userDoc.data();
      currentUser.id = uid;
      console.log("6. Login concluído para:", currentUser.nome);
      await entrarNoSistema();
    } else {
      // Caso especial: cria perfil admin se for o email do dono
      if (email === "alefdias44@cejam.com") {
        currentUser = { id: uid, nome: "Alef Dias", email, cargo: "admin", ativo: true, primeiro_acesso: false };
        await fb.db.collection("funcionarios").doc(email).set({ ...currentUser, criado_em: fb.serverTimestamp() });
        await entrarNoSistema();
      } else {
        throw new Error("Perfil não encontrado no sistema.");
      }
    }
  } catch(e){
    console.error("FALHA NO LOGIN:", e);
    
    // Sempre reseta o botão
    if(btn) { btn.disabled=false; btn.innerText='Entrar'; }
    
    const errorMsg = typeof e === 'string' ? e : (e.message || "Erro desconhecido");
    const errorCode = e.code || '';

    // Mostra erro técnico no painel vermelho
    const dBox = $('debug-box');
    const dMsg = $('debug-msg');
    if(dBox && dMsg) {
      dBox.style.display = 'block';
      dMsg.innerHTML = `<strong>Erro:</strong> ${errorMsg}<br><strong>Código:</strong> ${errorCode || 'N/A'}`;
    }

    let userMsg = errorMsg;
    if(errorCode === 'auth/invalid-credential' || errorCode === 'auth/wrong-password') userMsg = "E-mail ou senha incorretos.";
    if(errorCode === 'auth/invalid-custom-token') userMsg = "Erro interno de autenticação. Contate o suporte.";
    if(errorCode === 'auth/network-request-failed') userMsg = "Sem conexão com o servidor.";
    if(errorMsg.includes('E-mail ou senha')) userMsg = "E-mail ou senha incorretos.";
    
    toast(userMsg, "!", "b-red");
  }
}

// Captura erros globais (ex: se o Firebase nem carregar)
window.onerror = function(msg, url, lineNo, columnNo, error) {
  const dBox = $('debug-box');
  const dMsg = $('debug-msg');
  if(dBox && dMsg) {
    dBox.style.display = 'block';
    dMsg.innerHTML += `<br><br><strong>GLOBAL ERROR:</strong><br>${msg}<br>em ${url}:${lineNo}`;
  }
  return false;
};

async function entrarNoSistema(){
  hide('sc-login');
  show('app','flex');
  setupRealtime();
  setupSidebar();
  updateClock();

  if(currentUser.primeiro_acesso){
    om('m-primeiro-acesso');
  } else {
    show('sc-main');
    // Carrega view inicial baseada no cargo
    const role = currentUser.cargo;
    console.log("Roteando para cargo:", role);
    
    if(role === 'tecnico') showPanel('enf-adm');
    else if(role === 'medico') showPanel('med-dash');
    else if(role === 'admin') showPanel('adm-dash');
    else if(role === 'enfermagem') showPanel('enf-painel');
    else if(role === 'farmacia') showPanel('farm-disp');
    else showPanel('adm-dash');
  }
}

async function salvarNovaSenha(){
  const s1 = $('pa-senha1').value;
  const s2 = $('pa-senha2').value;
  
  if(s1.length < 6) { toast("A senha deve ter no mínimo 6 caracteres","⚠","error"); return; }
  if(s1 !== s2) { toast("As senhas não coincidem","⚠","error"); return; }
  
  try {
    toast("Atualizando segurança...", "⏳", "info");
    
    // 1. Atualiza no Auth
    await fb.auth.currentUser.updatePassword(s1);
    
    // 2. Atualiza no Firestore
    await fb.db.collection("funcionarios").doc(currentUser.email).update({
      primeiro_acesso: false
    });
    
    currentUser.primeiro_acesso = false;
    cm('m-primeiro-acesso');
    toast("Segurança atualizada! Bem-vindo.", "✓", "ok");
    entrarNoSistema();
  } catch(e) {
    console.error(e);
    if(e.code === 'auth/requires-recent-login') {
      toast("Sessão expirada. Saia e entre novamente para mudar a senha.", "⚠", "error");
    } else {
      toast("Erro ao atualizar senha: " + e.message, "⚠", "error");
    }
  }
}

function doLogout(){
  fb.auth.signOut();
  currentUser=null;
  hide('app'); show('sc-login');
  $('l-email').value=''; $('l-senha').value='';
}

// ── DATA LOADING (REAL-TIME) ────────────────
function setupRealtime(){
  // Listeners para atualização automática do STATE e UI usando padrão Compat
  fb.db.collection("pacientes").orderBy("criado_em", "desc").onSnapshot(snap => {
    STATE.pacientes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refreshUI();
  });

  fb.db.collection("prescricoes").orderBy("criado_em", "desc").onSnapshot(snap => {
    STATE.prescricoes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refreshUI();
  });

  fb.db.collection("relatorios").orderBy("criado_em", "desc").onSnapshot(snap => {
    STATE.relatorios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refreshUI();
  });

  fb.db.collection("historico").orderBy("criado_em", "desc").onSnapshot(snap => {
    STATE.historico = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refreshUI();
  });

  if (currentUser.cargo === 'admin') {
    fb.db.collection("funcionarios").onSnapshot(snap => {
      STATE.funcionarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      refreshUI();
    });
  }
}

function refreshUI(){
  const act=document.querySelector('.nav-item.active');
  if(act) {
    const panelId = act.id.replace('nav-','');
    // Só reconstrói o painel se ele depender de dados dinâmicos
    $('content').innerHTML = buildPanel(panelId);
  }
  updateBadges();
}

// ── SIDEBAR ───────────────────────────────
const navConfig = {
  admin:[
    {sec:'Gestão'},{id:'adm-dash',icon:'⬜',label:'Dashboard'},
    {id:'adm-funcs',icon:'👥',label:'Funcionários'},
    {id:'adm-mon',icon:'👁️',label:'Monitoramento'},
    {id:'adm-pacs',icon:'👤',label:'Pacientes'},
    {sec:'Relatórios'},{id:'adm-hist',icon:'📊',label:'Histórico Geral'},
  ],
  medico:[
    {sec:'Clínico'},{id:'med-dash',icon:'⬜',label:'Dashboard'},
    {id:'med-pacs',icon:'👤',label:'Pacientes'},
    {id:'med-rx',icon:'📋',label:'Prescrições',badge:'presc'},
    {sec:'Consulta'},{id:'med-relats',icon:'📝',label:'Relatórios Enf.'},
    {id:'med-hist',icon:'📊',label:'Histórico'},
  ],
  farmacia:[
    {sec:'Farmácia'},{id:'farm-disp',icon:'💊',label:'Dispensação',badge:'disp'},
    {id:'farm-hist',icon:'📊',label:'Histórico'},
  ],
  enfermagem:[
    {sec:'Enfermagem'},{id:'enf-painel',icon:'⬜',label:'Painel'},
    {id:'enf-pacs',icon:'👤',label:'Pacientes'},
    {id:'enf-adm',icon:'💉',label:'Administrar',badge:'adminPend'},
    {id:'enf-relat',icon:'📝',label:'Relatórios Diários'},
    {id:'enf-sv',icon:'❤️',label:'Sinais Vitais'},
  ],
  tecnico:[
    {sec:'Beira de Leito'},
    {id:'enf-adm',icon:'💉',label:'Administrar',badge:'adminPend'},
    {id:'enf-pacs',icon:'👤',label:'Pacientes'},
  ],
};
const roleInfo={
  admin:{label:'ADMIN',cls:'b-yellow',icon:'📊'},
  medico:{label:'MÉDICO',cls:'b-blue',icon:'👨‍⚕️'},
  farmacia:{label:'FARMÁCIA',cls:'b-green',icon:'💊'},
  enfermagem:{label:'ENFER.',cls:'b-purple',icon:'🩺'},
  tecnico:{label:'TÉCNICO',cls:'b-purple',icon:'👨‍⚕️'},
};

function setupSidebar(){
  const ri=roleInfo[currentUser.cargo];
  $('sb-av').textContent=ri.icon;
  $('sb-name').textContent=currentUser.nome;
  $('sb-role').innerHTML=`<span class="badge ${ri.cls}">${ri.label}</span>`;
  const nav=$('sb-nav'); nav.innerHTML='';
  navConfig[currentUser.cargo].forEach(item=>{
    if(item.sec){nav.innerHTML+=`<div class="nav-sec">${item.sec}</div>`;return;}
    nav.innerHTML+=`<div class="nav-item" id="nav-${item.id}" onclick="showPanel('${item.id}')">
      <span class="nav-icon">${item.icon}</span>${item.label}
      ${item.badge?`<span class="nav-badge" id="badge-${item.badge}">0</span>`:''}
    </div>`;
  });
  updateBadges();
}

function showFirstPanel(){
  const first=navConfig[currentUser.cargo].find(n=>n.id);
  if(first) showPanel(first.id);
}

const panelTitles={
  'adm-dash':'Dashboard Administrativo','adm-funcs':'Gestão de Funcionários',
  'adm-mon':'Monitoramento de Equipe',
  'adm-pacs':'Pacientes','adm-hist':'Histórico Geral',
  'med-dash':'Dashboard Médico','med-pacs':'Pacientes','med-rx':'Prescrições',
  'med-relats':'Relatórios de Enfermagem','med-hist':'Histórico',
  'farm-disp':'Dispensação','farm-hist':'Histórico de Dispensações',
  'enf-painel':'Painel de Enfermagem','enf-pacs':'Pacientes',
  'enf-adm':'Administração de Medicamentos','enf-relat':'Relatórios Diários','enf-sv':'Sinais Vitais',
};

function showPanel(id){
  $('content').innerHTML=buildPanel(id);
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const ni=$('nav-'+id); if(ni) ni.classList.add('active');
  $('topbar-title').textContent=panelTitles[id]||id;
  fillPacSel('rx-pac'); fillPacSel('r-pac');
  updateBadges();
}

function updateBadges(){
  const atv=STATE.prescricoes.filter(p=>p.status==='ativa').length;
  const admP=STATE.prescricoes.filter(p=>p.status==='dispensada').length;
  [['badge-presc',atv],['badge-disp',atv],['badge-adminPend',admP]].forEach(([id,v])=>{
    const el=$(id); if(el) el.textContent=v;
  });
}

function fillPacSel(selId){
  const s=$(selId); if(!s) return;
  s.innerHTML='<option value="">Selecionar...</option>'+
    STATE.pacientes.filter(p=>p.status==='internado')
      .map(p=>`<option value="${p.id}">${p.nome} — ${p.leito}</option>`).join('');
}

function gerarSenhaAuto(){
  const nome=$('f-nome').value.trim();
  const nasc=$('f-nasc').value;
  const prev=$('senha-preview');
  if(!nome||!nasc){prev.textContent='—';return;}
  const primeiro=nome.split(' ')[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const [y,m,d]=nasc.split('-');
  prev.textContent=`${primeiro}${d}${m}${y}`;
}

function handleTopBtn(){
  const c=currentUser?.cargo;
  if(c==='medico') om('m-rx');
  else if(c==='admin') om('m-func');
  else if(c==='enfermagem') om('m-pac');
  else toast('Use os botões de ação da página','ℹ');
}

function handleSearch(){
  const q=$('search-input').value.toLowerCase().trim();
  if(!q) return;
  const found=STATE.pacientes.filter(p=>p.nome.toLowerCase().includes(q));
  if(found.length) toast(`${found.length} paciente(s) encontrado(s)`,'🔍');
  else toast('Nenhum paciente encontrado','⚠','error');
}

// Close modal on backdrop click
document.querySelectorAll('.modal-overlay').forEach(o=>{
  o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('open');});
});

// ── PANEL BUILDERS ─────────────────────────
function buildPanel(id){
  switch(id){
    case 'adm-dash':   return pAdmDash();
    case 'adm-funcs':  return pAdmFuncs();
    case 'adm-pacs':   case 'med-pacs': case 'enf-pacs': return pPacientes();
    case 'adm-hist':   case 'med-hist': return pHistorico();
    case 'adm-mon':    return pAdmMon();
    case 'med-dash':   return pMedDash();
    case 'med-rx':     return pRx();
    case 'med-relats': return pRelatsMed();
    case 'farm-disp':  return pDisp();
    case 'farm-hist':  return pHistFarm();
    case 'enf-painel': return pEnfPainel();
    case 'enf-adm':    return pEnfAdm();
    case 'enf-relat':  return pEnfRelat();
    case 'enf-sv':     return pEnfSV();
    default: return '';
  }
}

function pAdmDash(){
  const intern=STATE.pacientes.filter(p=>p.status==='internado').length;
  const altas=STATE.pacientes.filter(p=>p.status==='alta').length;
  const funcs=STATE.funcionarios.filter(f=>f.ativo).length;
  const inat=STATE.funcionarios.filter(f=>!f.ativo).length;
  return `<div class="sec-hdr"><div><div class="sec-title">Dashboard Administrativo</div><div class="sec-sub">Visão geral do sistema</div></div></div>
  <div class="sg4">
    <div class="stat-card"><div class="stat-label">👥 Internados</div><div class="stat-val" style="color:var(--blue)">${intern}</div><div class="stat-sub">Pacientes ativos</div></div>
    <div class="stat-card"><div class="stat-label">🏠 Altas</div><div class="stat-val" style="color:var(--green)">${altas}</div><div class="stat-sub">Registradas no sistema</div></div>
    <div class="stat-card"><div class="stat-label">👨‍⚕️ Funcionários</div><div class="stat-val" style="color:var(--yellow)">${funcs}</div><div class="stat-sub">Equipe ativa</div></div>
    <div class="stat-card"><div class="stat-label">🚫 Inativos</div><div class="stat-val" style="color:var(--red)">${inat}</div><div class="stat-sub">Acessos bloqueados</div></div>
  </div>
  <div class="sg2">
    <div class="tcard"><div class="thead-row"><div class="ttitle">Pacientes — Internação</div></div>
    <table><thead><tr><th>Paciente</th><th>Leito</th><th>Dias</th><th>Diagnóstico</th></tr></thead>
    <tbody>${STATE.pacientes.filter(p=>p.status==='internado').map(p=>`<tr>
      <td><strong>${p.nome}</strong></td><td class="mono">${p.leito}</td>
      <td>${dBadge(p.admissao)}</td><td style="font-size:11px">${p.diagnostico}</td>
    </tr>`).join('')}</tbody></table></div>
    <div class="tcard"><div class="thead-row"><div class="ttitle">Funcionários</div><button class="btn btn-primary btn-sm" onclick="om('m-func')">+ Novo</button></div>
    <table><thead><tr><th>Nome</th><th>Cargo</th><th>1º Acesso</th><th>Status</th></tr></thead>
    <tbody>${STATE.funcionarios.map(f=>`<tr>
      <td><strong onclick="abrirPerfilFunc('${f.email}')" style="cursor:pointer;text-decoration:underline;color:var(--blue)">${f.nome}</strong></td><td>${cargoLabel(f.cargo)}</td>
      <td>${f.primeiro_acesso?'<span class="badge b-yellow">Pendente</span>':'<span class="badge b-gray">Feito</span>'}</td>
      <td>${f.ativo?'<span class="badge b-green">Ativo</span>':'<span class="badge b-gray">Inativo</span>'}</td>
    </tr>`).join('')}</tbody></table></div>
  </div>`;
}

function pAdmMon(){
  const adms = STATE.historico.filter(h => h.tipo === 'Administração');
  return `<div class="sec-hdr"><div><div class="sec-title">Monitoramento de Beira de Leito</div><div class="sec-sub">Histórico detalhado de administrações</div></div></div>
  <div class="tcard">
    <div class="thead-row"><div class="ttitle">Ações da Equipe</div><span class="badge b-purple">${adms.length} totais</span></div>
    <table><thead><tr><th>Data/Hora</th><th>Técnico/Responsável</th><th>Paciente</th><th>Leito</th><th>Medicamento</th><th>Observação</th></tr></thead>
    <tbody>${adms.length===0 ? `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text3)">Nenhuma administração registrada</td></tr>`
      : adms.map(h => `<tr>
        <td class="mono" style="font-size:11px">${h.criado_em}</td>
        <td><strong style="color:var(--purple)">${h.responsavel}</strong></td>
        <td><strong>${h.pac_nome}</strong></td>
        <td class="mono">${h.leito || '—'}</td>
        <td>${h.medicamento}</td>
        <td style="font-size:11px;color:var(--text3)">${h.observacoes}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function pAdmFuncs(){
  return `<div class="sec-hdr"><div><div class="sec-title">Gestão de Funcionários</div></div>
  <button class="btn btn-primary" onclick="om('m-func')">+ Cadastrar</button></div>
  ${STATE.funcionarios.map(f=>`<div class="func-card">
    <div class="func-av" style="background:${cargoColor(f.cargo)}">${roleInfo[f.cargo]?.icon||'👤'}</div>
    <div><div class="func-name" onclick="abrirPerfilFunc('${f.email}')" style="cursor:pointer;text-decoration:underline;color:var(--blue)">${f.nome}</div>
    <div class="func-info">${f.email} · ${f.registro} · ${cargoLabel(f.cargo)}</div>
    <div style="margin-top:4px">${f.primeiro_acesso?'<span class="badge b-yellow" style="font-size:9px">Aguard. primeiro acesso</span>':'<span class="badge b-gray" style="font-size:9px">Senha já trocada</span>'}</div></div>
    <div class="func-actions">
      ${f.ativo?`<span class="badge b-green">Ativo</span><button class="btn btn-outline btn-sm" onclick="toggleFunc('${f.id}')">Desativar</button>`
               :`<span class="badge b-gray">Inativo</span><button class="btn btn-green btn-sm" onclick="toggleFunc('${f.id}')">Reativar</button>`}
    </div></div>`).join('')}`;
}

function pPacientes(){
  const intern=STATE.pacientes.filter(p=>p.status==='internado');
  const altas=STATE.pacientes.filter(p=>p.status==='alta');
  const canAdmit=['admin','medico','enfermagem'].includes(currentUser?.cargo);
  const canAlta=['admin','medico'].includes(currentUser?.cargo);
  return `<div class="sec-hdr"><div><div class="sec-title">Pacientes</div><div class="sec-sub">${intern.length} internados · ${altas.length} altas</div></div>
    ${canAdmit?`<button class="btn btn-primary" onclick="om('m-pac')">+ Admitir Paciente</button>`:''}</div>
  <div class="tcard"><div class="thead-row"><div class="ttitle">Internados</div></div>
  <table><thead><tr><th>Paciente</th><th>Leito</th><th>Admissão</th><th>Dias</th><th>Diagnóstico</th><th>Alergias</th>${canAlta?'<th>Ações</th>':''}</tr></thead>
  <tbody>${intern.map(p=>`<tr>
    <td><a href="#" style="color:var(--blue);text-decoration:none" onclick="abrirPerfilPaciente(${p.id})"><strong>${p.nome}</strong></a></td><td class="mono">${p.leito}</td>
    <td class="mono" style="font-size:10px">${p.admissao}</td><td>${dBadge(p.admissao)}</td>
    <td style="font-size:11px">${p.diagnostico}</td>
    <td class="mono" style="font-size:10px;color:var(--red)">${p.alergias}</td>
    ${canAlta?`<td><button class="btn btn-red btn-xs" onclick="abrirAlta(${p.id})">Alta</button></td>`:''}
  </tr>`).join('')}</tbody></table></div>
  ${altas.length?`<div class="tcard"><div class="thead-row"><div class="ttitle">Altas Recentes</div></div>
  <table><thead><tr><th>Paciente</th><th>Leito</th><th>Data Alta</th><th>Tipo</th></tr></thead>
  <tbody>${altas.map(p=>`<tr><td><a href="#" style="color:var(--text);text-decoration:none" onclick="abrirPerfilPaciente(${p.id})">${p.nome}</a></td><td class="mono">${p.leito}</td>
    <td class="mono" style="font-size:10px">${p.data_alta||'—'}</td>
    <td style="font-size:11px">${p.tipo_alta||'—'}</td></tr>`).join('')}
  </tbody></table></div>`:''}`;
}

function abrirPerfilPaciente(id) {
  $('content').innerHTML = pPerfilPaciente(id);
  $('topbar-title').textContent = 'Perfil do Paciente';
}

function pPerfilPaciente(id) {
  const p = STATE.pacientes.find(x => x.id === id);
  if (!p) return '<div class="alert a-warn">Paciente não encontrado.</div>';

  const rx = STATE.prescricoes.filter(x => x.pac_id === id);
  const rels = STATE.relatorios.filter(x => x.pac_id === id);
  const hist = STATE.historico.filter(x => x.pac_nome === p.nome);

  const canAlta = p.status === 'internado' && ['admin','medico'].includes(currentUser?.cargo);

  return `
    <div class="sec-hdr">
      <div>
        <div class="sec-title">Prontuário: ${p.nome}</div>
        <div class="sec-sub">Histórico unificado do paciente</div>
      </div>
      <div class="sec-actions">
        ${canAlta ? `<button class="btn btn-red" onclick="abrirAlta(${p.id})">Dar Alta</button>` : ''}
        <button class="btn btn-outline" onclick="showFirstPanel()">Voltar</button>
      </div>
    </div>

    <!-- Informações do Paciente -->
    <div class="pac-hdr">
      <div class="pac-av">${p.nome.charAt(0).toUpperCase()}</div>
      <div style="flex:1">
        <div class="pac-name">${p.nome} <span class="badge ${p.status==='internado'?'b-green':'b-gray'}">${p.status.toUpperCase()}</span></div>
        <div class="pac-info">
          Admissão: ${p.admissao} ${p.status==='internado' ? `(${dBadge(p.admissao)})` : `— Alta em ${p.data_alta}`}
        </div>
      </div>
      <div style="text-align:right">
        <div class="pac-name" style="color:var(--text2)">Leito</div>
        <div class="mono" style="font-size:16px;color:var(--blue)">${p.leito}</div>
      </div>
    </div>

    <div class="tcard">
      <div class="thead-row"><div class="ttitle">Dados Clínicos</div></div>
      <div style="padding:14px;display:flex;flex-direction:column;gap:10px">
        <div class="drow"><div class="dkey">Nascimento</div><div class="dval mono">${p.nascimento || '—'}</div></div>
        <div class="drow"><div class="dkey">Diagnóstico</div><div class="dval">${p.diagnostico}</div></div>
        <div class="drow"><div class="dkey">Alergias</div><div class="dval mono" style="color:var(--red)">${p.alergias}</div></div>
        ${p.status==='alta' ? `<div class="drow"><div class="dkey">Motivo da Alta</div><div class="dval">${p.tipo_alta} (${p.resumo_alta})</div></div>` : ''}
        <div class="drow"><div class="dkey">Observações da Admissão</div><div class="dval" style="font-weight:normal;max-width:60%;text-align:right">${p.observacoes || 'Sem observações.'}</div></div>
      </div>
    </div>

    <!-- Prescrições do Paciente -->
    <div class="tcard">
      <div class="thead-row"><div class="ttitle">Prescrições Ativas e Histórico</div></div>
      <table>
        <thead><tr><th>Data</th><th>Medicamento</th><th>Dose/Freq</th><th>Via</th><th>Médico</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          ${rx.length ? rx.map(r => `<tr>
            <td class="mono" style="font-size:10px">${r.criado_em.split(' ')[0]}</td>
            <td><strong>${r.medicamento}</strong></td>
            <td class="mono" style="font-size:10px">${r.dose} · ${r.frequencia}</td>
            <td style="font-size:11px">${r.via}</td>
            <td style="font-size:11px">${r.medico}</td>
            <td>${sbadge(r.status)}</td>
            <td>${currentUser?.cargo === 'medico' && r.status !== 'cancelada' ? `<button class="btn btn-outline btn-sm" onclick="abrirAlterarRx('${r.id}')">Alterar</button>` : ''}</td>
          </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text3)">Nenhuma prescrição encontrada.</td></tr>`}
        </tbody>
      </table>
    </div>

    <!-- Relatórios de Enfermagem -->
    <div class="tcard">
      <div class="thead-row"><div class="ttitle">Relatórios de Enfermagem</div></div>
      <table>
        <thead><tr><th>Data/Turno</th><th>Sinais Vitais (PA / Temp / SpO2)</th><th>Estado</th><th>Enfermeiro</th></tr></thead>
        <tbody>
          ${rels.length ? rels.map(r => `<tr>
            <td style="font-size:11px">${r.data} <br/> <span class="mono" style="font-size:10px;color:var(--text3)">${r.turno}</span></td>
            <td class="mono" style="font-size:11px">${r.pa} mmHg · ${r.temperatura}°C · ${r.spo2}%</td>
            <td>${estadoBadge(r.estado_geral)}</td>
            <td style="font-size:11px">${r.responsavel}</td>
          </tr>`).join('') : `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text3)">Nenhum relatório de enfermagem.</td></tr>`}
        </tbody>
      </table>
    </div>

    <!-- Histórico de Movimentações (Timeline Médica) -->
    <div class="tcard">
      <div class="thead-row"><div class="ttitle">Linha do Tempo Médica / Auditoria</div></div>
      <div style="padding: 20px;">
        <div class="m-timeline">
          ${hist.length ? hist.slice(0, 30).map(h => `
            <div class="mt-item">
              <div class="mt-dot" style="background:${tipoHistCor(h.tipo)}"></div>
              <div class="mt-time">${h.criado_em}</div>
              <div class="mt-content">
                <div class="mt-title">${h.tipo}: ${h.medicamento || 'Evento Clínico'}</div>
                <div class="mt-body">${h.observacoes || 'Nenhuma observação registrada.'}</div>
                <div class="mt-meta">
                  <span>👤 Responsável: ${h.responsavel}</span>
                  ${h.leito ? `<span>🏥 Leito: ${h.leito}</span>` : ''}
                </div>
              </div>
            </div>
          `).join('') : '<div style="color:var(--text3);text-align:center;padding:20px;">Nenhum evento registrado nesta linha do tempo.</div>'}
        </div>
      </div>
    </div>
  `;
}

function pMedDash(){
  const intern=STATE.pacientes.filter(p=>p.status==='internado').length;
  const atv=STATE.prescricoes.filter(p=>p.status==='ativa').length;
  const disp=STATE.prescricoes.filter(p=>p.status==='dispensada').length;
  return `<div class="sec-hdr"><div><div class="sec-title">Dashboard Médico</div></div>
    <div class="sec-actions">
      <button class="btn btn-outline" onclick="showPanel('med-pacs')">Pacientes</button>
      <button class="btn btn-primary" onclick="om('m-rx')">+ Prescrição</button>
    </div></div>
  <div class="sg4">
    <div class="stat-card"><div class="stat-label">👤 Internados</div><div class="stat-val" style="color:var(--blue)">${intern}</div><div class="stat-sub">Sob seus cuidados</div></div>
    <div class="stat-card"><div class="stat-label">📋 Prescr. Ativas</div><div class="stat-val" style="color:var(--yellow)">${atv}</div><div class="stat-sub">Aguardando farmácia</div></div>
    <div class="stat-card"><div class="stat-label">💉 Aguard. Adm.</div><div class="stat-val" style="color:var(--purple)">${disp}</div><div class="stat-sub">Prontas para o técnico</div></div>
    <div class="stat-card"><div class="stat-label">📊 Histórico</div><div class="stat-val" style="color:var(--blue)">${STATE.prescricoes.length}</div><div class="stat-sub">Total de registros</div></div>
  </div>
  <div class="tcard"><div class="thead-row"><div class="ttitle">Últimas Prescrições</div><button class="btn btn-outline btn-sm" onclick="showPanel('med-rx')">Ver todas</button></div>
  <table><thead><tr><th>Paciente</th><th>Medicamento</th><th>Via</th><th>Status</th></tr></thead>
  <tbody>${STATE.prescricoes.slice(0,8).map(p=>`<tr>
    <td>${p.pac_nome}</td><td>${p.medicamento}</td>
    <td style="font-size:11px">${p.via}</td><td>${sbadge(p.status)}</td>
  </tr>`).join('')}</tbody></table></div>`;
}

function pRx(){
  return `<div class="sec-hdr"><div><div class="sec-title">Prescrições Médicas</div></div>
    <div class="sec-actions">
      <select class="fs" style="padding:6px 10px;font-size:11px;width:150px" onchange="filtRx(this.value)">
        <option value="">Todos</option><option value="ativa">Ativas</option>
        <option value="dispensada">Dispensadas</option><option value="administrada">Administradas</option>
      </select>
      <button class="btn btn-primary" onclick="om('m-rx')">+ Nova Prescrição</button>
    </div></div>
  <div class="tcard"><table><thead><tr><th>ID</th><th>Paciente</th><th>Medicamento</th><th>Dose/Freq</th><th>Via</th><th>Data</th><th>Status</th><th>Ações</th></tr></thead>
  <tbody id="rx-tbody">${rxRows(STATE.prescricoes)}</tbody></table></div>`;
}

function rxRows(lista){
  if(!lista.length) return `<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--text3)">Nenhuma prescrição</td></tr>`;
  return lista.map(p=>`<tr>
    <td class="mono" style="color:var(--blue)">${p.id}</td>
    <td><strong>${p.pac_nome}</strong></td><td>${p.medicamento}</td>
    <td class="mono" style="font-size:10px">${p.dose} · ${p.frequencia}</td>
    <td style="font-size:11px">${p.via}</td>
    <td class="mono" style="font-size:10px">${p.criado_em}</td>
    <td>${sbadge(p.status)}</td>
    <td style="display:flex;gap:4px">
      <button class="btn btn-outline btn-sm" onclick="verRx('${p.id}')">Ver</button>
      ${currentUser?.cargo==='medico' && p.status!=='cancelada' ? `<button class="btn btn-outline btn-sm" onclick="abrirAlterarRx('${p.id}')">Alterar</button>` : ''}
      ${p.status==='ativa' && currentUser?.cargo==='farmacia' ? `<button class="btn btn-green btn-sm" onclick="abrirDisp('${p.id}')">Disp.</button>`:''}
    </td></tr>`).join('');
}

function filtRx(val){
  const l=val?STATE.prescricoes.filter(p=>p.status===val):STATE.prescricoes;
  const tb=$('rx-tbody'); if(tb) tb.innerHTML=rxRows(l);
}

function pRelatsMed(){
  if(!STATE.relatorios.length) return `<div class="sec-hdr"><div class="sec-title">Relatórios de Enfermagem</div></div><div class="tcard"><div style="text-align:center;padding:40px;color:var(--text3)">Nenhum relatório registrado ainda</div></div>`;
  return `<div class="sec-hdr"><div class="sec-title">Relatórios de Enfermagem</div></div>
  <div class="tcard"><table><thead><tr><th>Data</th><th>Paciente</th><th>Turno</th><th>Estado</th><th>Enfermeiro</th><th>Ver</th></tr></thead>
  <tbody>${STATE.relatorios.map(r=>`<tr>
    <td class="mono" style="font-size:10px">${r.data}</td>
    <td><strong>${r.pac_nome}</strong></td><td style="font-size:11px">${r.turno}</td>
    <td>${estadoBadge(r.estado_geral)}</td><td style="font-size:11px">${r.responsavel}</td>
    <td><button class="btn btn-outline btn-sm" onclick="verRelatsPac(${r.pac_id})">Ver</button></td>
  </tr>`).join('')}</tbody></table></div>`;
}

function pHistorico(){
  return `<div class="sec-hdr"><div class="sec-title">Histórico de Movimentações</div></div>
  <div class="tcard"><table><thead><tr><th>Data/Hora</th><th>Tipo</th><th>Paciente</th><th>Medicamento</th><th>Responsável</th><th>Obs.</th></tr></thead>
  <tbody>${STATE.historico.map(h=>`<tr>
    <td class="mono" style="font-size:10px">${h.criado_em}</td><td>${tipoHist(h.tipo)}</td>
    <td>${h.pac_nome}</td><td>${h.medicamento}</td>
    <td style="font-size:11px">${h.responsavel}</td>
    <td style="font-size:11px;color:var(--text3)">${h.observacoes}</td>
  </tr>`).join('')}</tbody></table></div>`;
}

function pDisp(){
  const pend=STATE.prescricoes.filter(p=>p.status==='ativa');
  return `<div class="sec-hdr"><div><div class="sec-title">Fila de Dispensação</div><div class="sec-sub">${pend.length} prescrições aguardando</div></div></div>
  <div class="alert a-warn">⚠️ Confira alergias do paciente antes de dispensar.</div>
  <div class="tcard">
    <div class="thead-row"><div class="ttitle">Prescrições Ativas</div><span class="badge b-yellow">${pend.length} pendentes</span></div>
    <table><thead><tr><th>ID</th><th>Paciente</th><th>Leito</th><th>Alergias</th><th>Medicamento</th><th>Dose/Via</th><th>Médico</th><th>Ação</th></tr></thead>
    <tbody>${pend.length===0?`<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--green)">✓ Sem pendências</td></tr>`
      :pend.map(p=>{const pac=STATE.pacientes.find(x=>x.id===p.pac_id);return`<tr>
        <td class="mono" style="color:var(--blue)">${p.id}</td>
        <td><strong>${p.pac_nome}</strong></td><td class="mono">${p.leito}</td>
        <td class="mono" style="font-size:10px;color:var(--red)">${pac?.alergias||'NKDA'}</td>
        <td>${p.medicamento}</td><td class="mono" style="font-size:10px">${p.dose} · ${p.via}</td>
        <td style="font-size:11px">${p.medico}</td>
        <td><button class="btn btn-green btn-sm" onclick="abrirDisp('${p.id}')">Dispensar</button></td>
      </tr>`;}).join('')}
    </tbody></table></div>`;
}

function pHistFarm(){
  const farm=STATE.historico.filter(h=>h.tipo==='Dispensação');
  return `<div class="sec-hdr"><div class="sec-title">Histórico de Dispensações</div></div>
  <div class="sg3">
    <div class="stat-card"><div class="stat-label">Total</div><div class="stat-val" style="color:var(--green)">${farm.length}</div></div>
    <div class="stat-card"><div class="stat-label">Pendentes</div><div class="stat-val" style="color:var(--yellow)">${STATE.prescricoes.filter(p=>p.status==='ativa').length}</div></div>
    <div class="stat-card"><div class="stat-label">Administradas</div><div class="stat-val" style="color:var(--purple)">${STATE.prescricoes.filter(p=>p.status==='administrada').length}</div></div>
  </div>
  <div class="tcard"><table><thead><tr><th>Data/Hora</th><th>Paciente</th><th>Medicamento</th><th>Farmacêutico</th></tr></thead>
  <tbody>${farm.length?farm.map(h=>`<tr>
    <td class="mono" style="font-size:10px">${h.criado_em}</td><td>${h.pac_nome}</td>
    <td>${h.medicamento}</td><td style="font-size:11px">${h.responsavel}</td>
  </tr>`).join(''):`<tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text3)">Nenhum registro</td></tr>`}
  </tbody></table></div>`;
}

function pEnfPainel(){
  const hoje=new Date().toLocaleDateString('pt-BR');
  const relatHoje=id=>STATE.relatorios.some(r=>r.pac_id===id&&r.data===hoje);
  return `<div class="sec-hdr"><div><div class="sec-title">Painel de Enfermagem</div></div>
    <button class="btn btn-primary" onclick="om('m-pac')">+ Admitir Paciente</button></div>
  <div class="sg3">
    <div class="stat-card"><div class="stat-label">Internados</div><div class="stat-val" style="color:var(--blue)">${STATE.pacientes.filter(p=>p.status==='internado').length}</div></div>
    <div class="stat-card"><div class="stat-label">Meds Pendentes</div><div class="stat-val" style="color:var(--yellow)">${STATE.prescricoes.filter(p=>p.status==='dispensada').length}</div></div>
    <div class="stat-card"><div class="stat-label">Relatórios Hoje</div><div class="stat-val" style="color:var(--purple)">${STATE.relatorios.filter(r=>r.data===hoje).length}</div></div>
  </div>
  <div class="tcard"><table><thead><tr><th>Paciente</th><th>Leito</th><th>Dias</th><th>Diagnóstico</th><th>Alergias</th><th>Relat. hoje</th><th>Ações</th></tr></thead>
  <tbody>${STATE.pacientes.filter(p=>p.status==='internado').map(p=>`<tr>
    <td><strong>${p.nome}</strong></td><td class="mono">${p.leito}</td>
    <td>${dBadge(p.admissao)}</td><td style="font-size:11px">${p.diagnostico}</td>
    <td class="mono" style="font-size:10px;color:var(--red)">${p.alergias}</td>
    <td>${relatHoje(p.id)?'<span class="badge b-green">✓ Feito</span>':'<span class="badge b-yellow">Pendente</span>'}</td>
    <td style="display:flex;gap:4px">
      <button class="btn btn-outline btn-sm" onclick="abrirRelat(${p.id})">Relatório</button>
      <button class="btn btn-outline btn-sm" onclick="verRelatsPac(${p.id})">Ver</button>
    </td></tr>`).join('')}</tbody></table></div>`;
}

function pEnfAdm(){
  const disp=STATE.prescricoes.filter(p=>p.status==='dispensada');
  return `<div class="sec-hdr"><div><div class="sec-title">Administração de Medicamentos</div></div></div>
  <div class="alert a-info">🩺 Confirme identificação do paciente e leito antes de administrar.</div>
  <div class="tcard"><table><thead><tr><th>Paciente</th><th>Leito</th><th>Alergias</th><th>Medicamento</th><th>Dose</th><th>Via</th><th>Frequência</th><th>Ação</th></tr></thead>
  <tbody>${disp.length===0?`<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--green)">✓ Nenhum medicamento pendente</td></tr>`
    :disp.map(p=>{const pac=STATE.pacientes.find(x=>x.id===p.pac_id);return`<tr>
      <td><strong>${p.pac_nome}</strong></td><td class="mono">${p.leito}</td>
      <td class="mono" style="font-size:10px;color:var(--red)">${pac?.alergias||'NKDA'}</td>
      <td>${p.medicamento}</td><td class="mono">${p.dose}</td>
      <td style="font-size:11px">${p.via}</td><td style="font-size:11px">${p.frequencia}</td>
      <td><button class="btn btn-primary btn-sm" onclick="abrirAdm('${p.id}')">Administrar</button></td>
    </tr>`;}).join('')}
  </tbody></table></div>`;
}

function pEnfRelat(){
  return `<div class="sec-hdr"><div><div class="sec-title">Relatórios Diários</div><div class="sec-sub">${STATE.relatorios.length} registros totais</div></div>
    <button class="btn btn-primary" onclick="abrirRelat(null)">+ Novo Relatório</button></div>
  ${STATE.relatorios.length===0?`<div class="tcard"><div style="text-align:center;padding:40px;color:var(--text3)">Nenhum relatório registrado</div></div>`
  :`<div class="tcard"><table><thead><tr><th>Data</th><th>Turno</th><th>Paciente</th><th>Leito</th><th>Estado</th><th>PA</th><th>FC</th><th>Temp</th><th>Enfermeiro</th><th>Ver</th></tr></thead>
  <tbody>${STATE.relatorios.map(r=>`<tr>
    <td class="mono" style="font-size:10px">${r.data}</td>
    <td style="font-size:11px">${r.turno}</td>
    <td><strong>${r.pac_nome}</strong></td><td class="mono">${r.leito}</td>
    <td>${estadoBadge(r.estado_geral)}</td>
    <td class="mono" style="font-size:10px">${r.pa||'—'}</td>
    <td class="mono" style="font-size:10px">${r.fc||'—'}</td>
    <td class="mono" style="font-size:10px">${r.temperatura||'—'}</td>
    <td style="font-size:11px">${r.responsavel}</td>
    <td><button class="btn btn-outline btn-sm" onclick="verRelatsPac(${r.pac_id})">Ver</button></td>
  </tr>`).join('')}</tbody></table></div>`}`;
}

function pEnfSV(){
  return `<div class="sec-hdr"><div class="sec-title">Sinais Vitais — Último Registro</div></div>
  <div class="tcard"><table><thead><tr><th>Paciente</th><th>Leito</th><th>Turno</th><th>PA</th><th>FC</th><th>Temp</th><th>SpO2</th><th>Estado</th></tr></thead>
  <tbody>${STATE.pacientes.filter(p=>p.status==='internado').map(p=>{
    const rels=STATE.relatorios.filter(r=>r.pac_id===p.id);
    const ult=rels[0]||null;
    return`<tr>
      <td><strong>${p.nome}</strong></td><td class="mono">${p.leito}</td>
      <td style="font-size:11px;color:var(--text3)">${ult?ult.turno:'—'}</td>
      <td class="mono" style="font-size:11px">${ult?.pa||'—'}</td>
      <td class="mono" style="font-size:11px">${ult?.fc?ult.fc+' bpm':'—'}</td>
      <td class="mono" style="font-size:11px">${ult?.temperatura?ult.temperatura+'°C':'—'}</td>
      <td class="mono" style="font-size:11px">${ult?.spo2?ult.spo2+'%':'—'}</td>
      <td>${ult?estadoBadge(ult.estado_geral):'<span class="badge b-gray">Sem dados</span>'}</td>
    </tr>`;}).join('')}</tbody></table></div>`;
}

// ── ACTIONS ────────────────────────────────
// Usa window.__TAURI__.core.invoke quando disponível, senão usa api (dev mode)
// ── ACTIONS ────────────────────────────────
async function logAction(tipo, pacNome, med, obs) {
  try {
    await fb.db.collection("historico").add({
      tipo, pac_nome: pacNome, medicamento: med || '—', 
      responsavel: currentUser.nome, observacoes: obs,
      criado_em: fb.serverTimestamp()
    });
  } catch(e) { console.error("Erro log:", e); }
}

async function salvarPac(){
  const nome=$('p-nome').value.trim();
  const leito=$('p-leito').value.trim();
  if(!nome||!leito){toast('Preencha nome e leito','⚠','error');return;}
  try {
    const pacData = {
      nome, leito,
      nascimento:$('p-nasc').value||null,
      diagnostico:$('p-diag').value,
      alergias:$('p-alerg').value||'NKDA',
      observacoes:$('p-obs').value||'',
      status: 'internado',
      admissao: new Date().toLocaleDateString('pt-BR'),
      criado_em: fb.serverTimestamp()
    };
    await fb.db.collection("pacientes").add(pacData);
    
    await logAction('Admissão', nome, null, `Admitido no leito ${leito}`);
    
    ['p-nome','p-leito','p-alerg','p-obs'].forEach(i=>{const e=$(i);if(e)e.value='';});
    cm('m-pac'); toast(`${nome} admitido!`,'✓','ok');
  } catch(e) { toast("Erro ao salvar paciente",'⚠','error'); }
}

function abrirAlterarRx(id) {
  const p = STATE.prescricoes.find(x => x.id === id);
  if(!p) return;
  $('rxe-id').value = id;
  $('rxe-med').value = p.medicamento;
  $('rxe-dose').value = p.dose;
  $('rxe-freq').value = p.frequencia;
  $('rxe-dur').value = p.duracao;
  $('rxe-obs').value = p.observacoes;
  om('m-rx-edit');
}

async function salvarAlteracaoRx() {
  const id = $('rxe-id').value;
  const dose = $('rxe-dose').value.trim();
  const freq = $('rxe-freq').value;
  const dur = $('rxe-dur').value.trim();
  const obs = $('rxe-obs').value.trim();
  if(!dose || !dur) return toast('Preencha Dose e Duração.','⚠');

  try {
    const p = STATE.prescricoes.find(x => x.id === id);
    await fb.db.collection("prescricoes").doc(id).update({
      dose, frequencia: freq, duracao: dur, observacoes: obs, status: 'ativa'
    });
    
    await logAction('Alteração de Prescrição', p.pac_nome, p.medicamento, `Alterado para ${dose} (${freq})`);
    
    toast('Prescrição alterada!','✓','success');
    cm('m-rx-edit');
    if($('topbar-title').textContent === 'Perfil do Paciente') {
      $('content').innerHTML = pPerfilPaciente(p.pac_id);
    }
  } catch(e) { toast("Erro ao alterar",'⚠','error'); }
}

async function salvarRx(){
  const pacId=$('rx-pac').value;
  const med=$('rx-med').value;
  if(!pacId||!med){toast('Selecione paciente e medicamento','⚠','error');return;}
  try {
    const pac = STATE.pacientes.find(x => x.id === pacId);
    const rxData = {
      pac_id: pacId, pac_nome: pac.nome, leito: pac.leito,
      medicamento: med, via: $('rx-via').value,
      dose: $('rx-dose').value || '—', frequencia: $('rx-freq').value,
      duracao: $('rx-dur').value || '—', observacoes: $('rx-obs').value || '',
      status: 'ativa', medico: currentUser.nome,
      criado_em: fb.serverTimestamp()
    };
    await fb.db.collection("prescricoes").add(rxData);
    await logAction('Prescrição', pac.nome, med, 'Prescrita');
    
    cm('m-rx'); toast('Prescrição criada!','📋','ok');
  } catch(e){ toast("Erro ao prescrever",'⚠','error'); }
}

async function salvarFunc(){
  const nome=$('f-nome').value.trim();
  const email=$('f-email').value.trim();
  const cargo=$('f-cargo').value;
  const registro=$('f-reg').value || '—';
  const senha=$('senha-preview').textContent;
  
  if(!nome||!email||senha==='—'){toast('Preencha Nome, E-mail e Data de Nasc.','⚠','error');return;}
  
  try {
    const { createUserWithEmailAndPassword, signOut } = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js');
    
    toast("Criando acesso no Firebase...", "⏳", "info");

    // 1. Criar no Firebase Auth usando a instância secundária (para não deslogar o admin)
    // No modo compat, criamos uma nova instância se necessário
    const secondaryApp = firebase.apps.find(a => a.name === "SecondaryApp") || firebase.initializeApp(firebase.app().options, "SecondaryApp");
    const userCred = await secondaryApp.auth().createUserWithEmailAndPassword(email, senha);
    const uid = userCred.user.uid;
    
    // Desloga a instância secundária imediatamente
    await secondaryApp.auth().signOut();

    // 2. Criar perfil no Firestore usando o e-mail como ID
    await fb.db.collection("funcionarios").doc(email).set({
      nome, email, cargo, registro,
      data_nascimento: $('f-nasc').value, // Salva para permitir resets futuros
      uid, // Salvamos o UID real do Firebase para segurança
      ativo: true,
      criado_em: fb.serverTimestamp(),
      primeiro_acesso: true
    });

    ['f-nome', 'f-email', 'f-reg'].forEach(i => { const e = $(i); if (e) e.value = ''; });
    $('f-nasc').value=''; $('senha-preview').textContent='—';
    cm('m-func');
    toast(`${nome} cadastrado com sucesso!`, '✓', 'ok');
  } catch(e) {
    console.error(e);
    let msg = "Erro ao cadastrar funcionário.";
    if (e.code === 'auth/email-already-in-use') msg = "Este e-mail já está em uso.";
    if (e.code === 'auth/weak-password') msg = "A senha gerada é muito fraca.";
    toast(msg, "⚠", "error");
  }
}

async function toggleFunc(id){
  try {
    const f = STATE.funcionarios.find(x => x.id === id);
    await fb.db.collection("funcionarios").doc(f.email).update({ ativo: !f.ativo });
    toast('Status atualizado!','✓','ok');
  } catch(e){ toast("Erro ao atualizar status",'⚠','error'); }
}

let _funcEditEmail = null;
function abrirPerfilFunc(email){
  const f = STATE.funcionarios.find(x => x.email === email);
  if(!f) return;
  _funcEditEmail = email;
  
  $('funcdet-body').innerHTML = `
    <div class="pac-hdr" style="margin-bottom:20px">
      <div class="pac-av">${f.nome[0]}</div>
      <div>
        <div class="pac-name">${f.nome}</div>
        <div class="pac-info">${f.cargo.toUpperCase()}</div>
      </div>
    </div>
    <div class="drow"><span class="dkey">E-mail</span><span class="dval">${f.email}</span></div>
    <div class="drow"><span class="dkey">Registro</span><span class="dval">${f.registro || '—'}</span></div>
    <div class="drow"><span class="dkey">Status</span><span class="dval">${f.ativo ? '<span class="badge b-green">Ativo</span>' : '<span class="badge b-red">Inativo</span>'}</span></div>
    <div class="drow"><span class="dkey">Cadastrado em</span><span class="dval mono">${f.criado_em?.toDate ? f.criado_em.toDate().toLocaleString() : '—'}</span></div>
    <div class="alert a-info" style="margin-top:20px;display:block">
      Ao resetar a senha, o funcionário receberá um e-mail oficial para criar uma nova senha pessoal.
    </div>
  `;
  om('m-func-det');
}

async function confirmarAlterarSenhaManual(){
  const novaSenha = $('f-nova-senha').value.trim();
  if(novaSenha.length < 6) { toast("A senha deve ter no mínimo 6 dígitos","⚠","error"); return; }
  
  const f = STATE.funcionarios.find(x => x.email === _funcEditEmail);
  if(!confirm(`Deseja alterar a senha de ${f.nome} para: ${novaSenha}?`)) return;

  try {
    toast("Alterando senha no Firebase...", "⏳", "info");

    // Chama o comando Super-Admin do Rust
    const res = await window.__TAURI__.core.invoke('cmd_admin_reset_password', { 
      email: f.email, 
      novaSenha 
    });

    if (res.success) {
      // Como o Admin já definiu a senha final, marcamos como JÁ TROCADA
      await fb.db.collection("funcionarios").doc(f.email).update({ 
        primeiro_acesso: false 
      });
      toast("Senha alterada com sucesso!", "✓", "ok");
      $('f-nova-senha').value = '';
      cm('m-func-det');
    }
  } catch(e) {
    console.error(e);
    toast("Erro: " + e, "⚠", "error");
  }
}

function abrirAlta(pacId){
  const p=STATE.pacientes.find(x=>x.id===pacId);
  _altaId=pacId;
  $('alta-info').innerHTML=`<div class="pac-hdr"><div class="pac-av">${p.nome[0]}</div>
    <div><div class="pac-name">${p.nome}</div>
    <div class="pac-info">Leito ${p.leito} · ${dias(p.admissao)} dias internado</div></div></div>`;
  om('m-alta');
}

async function confirmarAlta(){
  try {
    const p = STATE.pacientes.find(x => x.id === _altaId);
    const tipo = $('alta-tipo').value;
    await fb.db.collection("pacientes").doc(_altaId).update({
      status: 'alta',
      data_alta: new Date().toLocaleDateString('pt-BR'),
      tipo_alta: tipo,
      resumo_alta: $('alta-resumo').value || '—'
    });
    
    await logAction('Alta', p.nome, null, tipo);
    cm('m-alta'); toast(`Alta de ${p.nome} registrada!`,'🏠','ok');
  } catch(e){ toast("Erro ao registrar alta",'⚠','error'); }
}

function abrirDisp(id){
  _dispId=id;
  const p=STATE.prescricoes.find(x=>x.id===id);
  const pac=STATE.pacientes.find(x=>x.id===p.pac_id);
  $('disp-body').innerHTML=`
    <div class="alert a-warn">⚠️ Alergias: <strong>${pac?.alergias||'NKDA'}</strong></div>
    <div class="drow"><span class="dkey">Paciente</span><span class="dval">${p.pac_nome}</span></div>
    <div class="drow"><span class="dkey">Medicamento</span><span class="dval">${p.medicamento}</span></div>
    <div class="drow"><span class="dkey">Dose / Via</span><span class="dval mono">${p.dose} · ${p.via}</span></div>
    <div class="drow"><span class="dkey">Frequência</span><span class="dval">${p.frequencia}</span></div>`;
  om('m-disp');
}

async function confirmarDisp(){
  try {
    const p = STATE.prescricoes.find(x => x.id === _dispId);
    await fb.db.collection("prescricoes").doc(_dispId).update({ status: 'dispensada' });
    await logAction('Dispensação', p.pac_nome, p.medicamento, `Dispensada ${p.id}`);
    cm('m-disp'); toast('Medicamento dispensado!','💊','ok');
  } catch(e){ toast("Erro na dispensação",'⚠','error'); }
}

function abrirAdm(id){
  _admId=id;
  const p=STATE.prescricoes.find(x=>x.id===id);
  const pac=STATE.pacientes.find(x=>x.id===p.pac_id);
  $('adm-body').innerHTML=`
    <div class="alert a-info">🩺 Confirme identificação do paciente.</div>
    <div class="drow"><span class="dkey">Paciente</span><span class="dval">${p.pac_nome}</span></div>
    <div class="drow"><span class="dkey">Alergias</span><span class="dval" style="color:var(--red)">${pac?.alergias||'NKDA'}</span></div>
    <div class="drow"><span class="dkey">Medicamento</span><span class="dval">${p.medicamento}</span></div>
    <div class="drow"><span class="dkey">Dose / Via</span><span class="dval mono">${p.dose} · ${p.via}</span></div>
    <div style="margin-top:12px"><div class="fg">
      <div class="fgrp"><label class="flabel">Enfermeiro(a)</label><input class="fi" value="${currentUser.nome}" id="adm-enf"/></div>
      <div class="fgrp"><label class="flabel">Horário</label><input class="fi" type="time" id="adm-hora" value="${new Date().toTimeString().slice(0,5)}"/></div>
      <div class="fgrp ff"><label class="flabel">Intercorrências</label><input class="fi" id="adm-obs" placeholder="Nenhuma..."/></div>
    </div></div>`;
  om('m-adm');
}

async function confirmarAdm(){
  try {
    const p = STATE.prescricoes.find(x => x.id === _admId);
    await fb.db.collection("prescricoes").doc(_admId).update({ status: 'administrada' });
    
    const obs = $('adm-obs')?.value || 'Sem intercorrências';
    await logAction('Administração', p.pac_nome, p.medicamento, obs);
    
    cm('m-adm'); toast('Administração registrada!','🩺','ok');
  } catch(e){ toast("Erro ao registrar",'⚠','error'); }
}

function abrirRelat(pacId){
  fillPacSel('r-pac');
  setTimeout(()=>{ if(pacId){const s=$('r-pac');if(s)s.value=pacId;} },60);
  om('m-relat');
}

async function salvarRelat(){
  const pacId=$('r-pac').value;
  if(!pacId){toast('Selecione o paciente','⚠','error');return;}
  try {
    const pac = STATE.pacientes.find(x => x.id === pacId);
    const relatData = {
      pac_id: pacId, pac_nome: pac.nome, leito: pac.leito,
      turno: $('r-turno').value, data: new Date().toLocaleDateString('pt-BR'),
      pa: $('r-pa').value || '', fc: $('r-fc').value || '',
      temperatura: $('r-temp').value || '', spo2: $('r-spo2').value || '',
      estado_geral: $('r-estado').value, evolucao: $('r-obs').value || '',
      intercorrencias: $('r-inter').value || '', responsavel: currentUser.nome,
      criado_em: fb.serverTimestamp()
    };
    await fb.db.collection("relatorios").add(relatData);
    cm('m-relat'); toast('Relatório salvo!','📝','ok');
  } catch(e){ toast("Erro ao salvar relatório",'⚠','error'); }
}

async function verRelatsPac(pacId){
  const p=STATE.pacientes.find(x=>x.id===pacId);
  const relats=STATE.relatorios.filter(r=>r.pac_id===pacId);
  $('verrelat-body').innerHTML=`
    <div class="pac-hdr"><div class="pac-av">${p.nome[0]}</div>
    <div><div class="pac-name">${p.nome}</div>
    <div class="pac-info">Leito ${p.leito} · ${dias(p.admissao)} dias internado</div></div></div>
    ${relats.length===0?'<div style="text-align:center;padding:30px;color:var(--text3)">Nenhum relatório para este paciente</div>'
    :relats.map(r=>`<div class="rc">
      <div class="rc-title">📝 ${r.data} — ${r.turno} ${estadoBadge(r.estado_geral)} <span class="badge b-purple">${r.responsavel}</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div class="drow"><span class="dkey">PA</span><span class="dval mono">${r.pa||'—'}</span></div>
        <div class="drow"><span class="dkey">FC</span><span class="dval mono">${r.fc?r.fc+' bpm':'—'}</span></div>
        <div class="drow"><span class="dkey">Temp.</span><span class="dval mono">${r.temperatura?r.temperatura+'°C':'—'}</span></div>
        <div class="drow"><span class="dkey">SpO2</span><span class="dval mono">${r.spo2?r.spo2+'%':'—'}</span></div>
      </div>
      ${r.evolucao?`<div style="font-size:12px;margin-top:6px"><strong>Evolução:</strong> ${r.evolucao}</div>`:''}
      ${r.intercorrencias?`<div style="font-size:12px;margin-top:4px;color:var(--yellow)"><strong>Intercorrências:</strong> ${r.intercorrencias}</div>`:''}
    </div>`).join('')}`;
  om('m-verrelat');
}

function verRx(id){
  const p=STATE.prescricoes.find(x=>x.id===id);
  $('rxdet-body').innerHTML=`
    <div class="pac-hdr"><div class="pac-av">${p.pac_nome[0]}</div>
    <div><div class="pac-name">${p.pac_name}</div><div class="pac-info">Leito ${p.leito} · ${p.id}</div></div>
    <div style="margin-left:auto">${sbadge(p.status)}</div></div>
    <div class="drow"><span class="dkey">Medicamento</span><span class="dval">${p.medicamento}</span></div>
    <div class="drow"><span class="dkey">Via</span><span class="dval">${p.via}</span></div>
    <div class="drow"><span class="dkey">Dose</span><span class="dval">${p.dose}</span></div>
    <div class="drow"><span class="dkey">Frequência</span><span class="dval">${p.frequencia}</span></div>
    <div class="drow"><span class="dkey">Duração</span><span class="dval">${p.duracao}</span></div>
    <div class="drow"><span class="dkey">Médico</span><span class="dval">${p.medico}</span></div>
    <div class="drow"><span class="dkey">Data/Hora</span><span class="dval mono">${p.criado_em}</span></div>
    ${p.observacoes?`<div class="drow"><span class="dkey">Obs.</span><span class="dval">${p.observacoes}</span></div>`:''}
    <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px">
      <div class="flabel" style="margin-bottom:8px;display:block">Linha do tempo</div>
      <div class="tl-item"><div class="tl-dot" style="background:var(--blue)"></div><div class="tl-txt"><strong>Prescrita</strong> — ${p.medico}<br><span class="tl-time">${p.criado_em}</span></div></div>
      ${p.status==='dispensada'||p.status==='administrada'?`<div class="tl-item"><div class="tl-dot" style="background:var(--green)"></div><div class="tl-txt"><strong>Dispensada</strong> — Farmácia</div></div>`:''}
      ${p.status==='administrada'?`<div class="tl-item"><div class="tl-dot" style="background:var(--purple)"></div><div class="tl-txt"><strong>Administrada</strong> — Enfermagem</div></div>`:''}
    </div>
    <div style="margin-top:20px;display:flex;justify-content:center">
      <button class="btn btn-outline" onclick="imprimirPrescricaoPDF('${p.id}')">🖨️ Imprimir Receituário PDF</button>
    </div>`;
  om('m-rxdet');
}

async function imprimirPrescricaoPDF(id) {
  const p = STATE.prescricoes.find(x => x.id === id);
  if (!p) return;

  try {
    toast("Gerando PDF profissional...", "⏳", "info");
    
    // 1. Chamar comando Rust para gerar Base64
    const b64 = await window.__TAURI__.core.invoke('cmd_gerar_prescricao_pdf', { 
      data: {
        paciente: p.pac_nome,
        leito: p.leito,
        medicamento: p.medicamento,
        dose: p.dose,
        via: p.via,
        frequencia: p.frequencia,
        medico: p.medico,
        data: p.criado_em
      }
    });

    // 2. Abrir diálogo de salvamento
    const path = await window.__TAURI__.dialog.save({
      defaultPath: `Prescricao_${p.pac_nome.replace(/ /g,'_')}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });

    if (path) {
      // 3. Salvar o arquivo via Rust (usando fs plugin)
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      await window.__TAURI__.fs.writeBinaryFile(path, bytes);
      toast("PDF salvo com sucesso!", "✓", "ok");
    }
  } catch (e) {
    console.error("ERRO AO GERAR PDF:", e);
    toast("Erro ao gerar PDF: " + e, "⚠", "error");
  }
}

// ── INIT ───────────────────────────────────
(async function init(){
  fb.auth.onAuthStateChanged(async (user) => {
    if (user) {
      console.log("Sessão ativa:", user.email);
      const userDoc = await fb.db.collection("funcionarios").doc(user.email).get();
      if (userDoc.exists) {
        currentUser = userDoc.data();
        await entrarNoSistema();
      } else {
        // Se autenticado mas sem perfil, volta pro login
        show('sc-login');
      }
    } else {
      show('sc-login');
    }
  });
})();
// ── EXPORTS ────────────────────────────────
// Como o app.js agora é um módulo, precisamos expor as funções para o HTML (onclick)
Object.assign(window, {
  doLogin, doLogout, handleSearch, handleTopBtn,
  showPanel, om, cm, salvarPac, salvarRx, salvarAlteracaoRx,
  confirmarAlta, confirmarDisp, confirmarAdm, salvarRelat,
  salvarFunc, gerarSenhaAuto, abrirPerfilPaciente, abrirAlta,
  verRx, imprimirPrescricaoPDF,
  abrirAlterarRx, filtRx, toggleFunc, abrirPerfilFunc, confirmarAlterarSenhaManual,
  salvarNovaSenha
});

// Inicialização
window.addEventListener('DOMContentLoaded', () => {
  console.log("🚀 Cejam App iniciado");
  
  // Garantir que os botões funcionem mesmo com módulos
  const btnLogin = $('btn-login');
  if (btnLogin) btnLogin.onclick = doLogin;

  const btnLogout = document.querySelector('.sb-logout');
  if (btnLogout) btnLogout.onclick = doLogout;

  const btnTop = $('btn-top');
  if (btnTop) btnTop.onclick = handleTopBtn;

  const searchInput = $('search-input');
  if (searchInput) searchInput.oninput = handleSearch;

  // Melhoria para fechar calendário automaticamente
  document.querySelectorAll('input[type="date"]').forEach(el => {
    el.addEventListener('change', () => el.blur());
    el.addEventListener('input', () => {
      if (el.value.length === 10) el.blur();
    });
  });

  console.log("✓ Listeners anexados");
});
