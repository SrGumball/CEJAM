// ═══════════════════════════════════════════
// CEJAM — App Principal
// ═══════════════════════════════════════════
import { fb } from './firebase-config.js';
let currentUser = null;
let unsubscribers = [];
let STATE = { pacientes: [], prescricoes: [], relatorios: [], historico: [], funcionarios: [], alas: [], notificacoes: [] };
let _altaId = null, _dispId = null, _admId = null;
let _pendingEmail = null;
let _isAdmitting = false;
let _isDispensing = false;
let _loteIds = [];
let _loteIsLate = false;
let _loteIsEarly = false;
let _alaTrabalho = localStorage.getItem('cejam_ala') || null;

// ── HELPERS ────────────────────────────────
const $ = id => document.getElementById(id);
function show(id, d='flex'){ const e=$(id); if(e) e.style.display=d; }
function hide(id){ const e=$(id); if(e) e.style.display='none'; }
function om(id){ $(id).classList.add('open'); }
function cm(id){ $(id).classList.remove('open'); }

function calcularProximaDose(freq, desde = new Date()) {
  const horas = {
    '1x ao dia (24/24h)': 24,
    '2x ao dia (12/12h)': 12,
    '2x ao dia (08h - 20h)': 12,
    '3x ao dia (08/08h)': 8,
    '3x ao dia (14h - 22h - 06h) - Contínuo': 8,
    '4x ao dia (06/06h)': 6,
    '4x ao dia (00h - 06h - 12h - 18h)': 6,
    '6x ao dia (04/04h)': 4
  };
  
  let intervalo = 0;
  for (let key in horas) {
    if (freq.includes(key) || freq.includes(key.split('(')[1]?.split(')')[0])) {
      intervalo = horas[key];
      break;
    }
  }
  
  if (intervalo === 0) return null;
  
  const proxima = new Date(desde);
  proxima.setHours(proxima.getHours() + intervalo);
  return proxima.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + 'h';
}

function getAlaFromPresc(p) {
  const pac = STATE.pacientes.find(x => x.id === p.pac_id);
  return pac ? pac.ala : (p.ala || '—');
}

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
  
  if (disp.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">Carregando ou sem prescrições...</div>';
    return;
  }
  
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

// ── NOTIFICAÇÕES ───────────────────────────
function renderNotifications() {
  const count = STATE.notificacoes.filter(n => !n.lida).length;
  const badge = $('notif-count');
  if (badge) {
    badge.style.display = count > 0 ? 'block' : 'none';
    badge.textContent = count;
  }
  const body = $('notif-body');
  if (!body) return;
  body.innerHTML = STATE.notificacoes.length ? STATE.notificacoes.map(n => `
    <div class="notif-item ${n.lida ? '' : 'unread'}" onclick="marcarLida('${n.id}')">
      <div><strong>${n.titulo}</strong><br><small>${n.msg}</small></div>
      <div class="notif-time">${n.data}</div>
    </div>
  `).join('') : '<div style="text-align:center;padding:20px;color:var(--text3)">Nenhuma notificação nova</div>';
}

function registrarNotificacao(titulo, msg, cargos = []) {
  const agora = new Date();
  const dataFormatada = agora.toLocaleDateString('pt-BR') + ' ' + agora.toTimeString().slice(0, 5);
  fb.db.collection("notificacoes").add({
    titulo, msg, lida: false, 
    data: dataFormatada,
    criado_em: fb.serverTimestamp(),
    cargos
  });
}

async function limparNotificacoes() {
  try {
    const snap = await fb.db.collection("notificacoes").get();
    const batch = fb.db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    toast("Notificações limpas!", "✓", "ok");
  } catch(e) { console.error(e); }
}

function marcarLida(id) {
  fb.db.collection("notificacoes").doc(id).update({ lida: true });
}

// Clock
function updateClock(){
  const e=$('sb-clock');
  if(e) e.textContent='● Online · '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}
setInterval(updateClock,30000);

const THEMES = {
  verde:   { c1: '#1E6C36', c2: '#16572A', c3: '#10421F', cl: '#4caf50', dim: '#edf7ee', b: '#c8e6cb', bg: '#F2F7F4', surf: '#FFFFFF', text: '#2d3748', text2: '#4a5568', text3: '#718096' },
  azul:    { c1: '#1E40AF', c2: '#1E3A8A', c3: '#172554', cl: '#3b82f6', dim: '#eff6ff', b: '#bfdbfe', bg: '#F3F4F6', surf: '#FFFFFF', text: '#111827', text2: '#374151', text3: '#6B7280' },
  roxo:    { c1: '#7C3AED', c2: '#6D28D9', c3: '#5B21B6', cl: '#8b5cf6', dim: '#f5f3ff', b: '#ddd6fe', bg: '#F5F3FF', surf: '#FFFFFF', text: '#1E1B4B', text2: '#312E81', text3: '#4338CA' },
  ardosia: { c1: '#475569', c2: '#334155', c3: '#1E293B', cl: '#64748b', dim: '#f1f5f9', b: '#cbd5e1', bg: '#F8FAFC', surf: '#FFFFFF', text: '#0F172A', text2: '#334155', text3: '#64748B' },
  rosa:    { c1: '#DB2777', c2: '#BE185D', c3: '#9D174D', cl: '#ec4899', dim: '#fdf2f8', b: '#fbcfe8', bg: '#FDF2F8', surf: '#FFFFFF', text: '#831843', text2: '#9D174D', text3: '#BE185D' },
  escuro:  { c1: '#1E293B', c2: '#0F172A', c3: '#020617', cl: '#334155', dim: '#0f172a', b: '#334155', bg: '#0F172A', surf: '#1E293B', text: '#F8FAFC', text2: '#CBD5E1', text3: '#94A3B8' }
};

function applyTheme(name) {
  const t = THEMES[name];
  if(!t) return;
  const root = document.documentElement;
  root.style.setProperty('--green', t.c1);
  root.style.setProperty('--green-hover', t.c2);
  root.style.setProperty('--green-dark', t.c3);
  root.style.setProperty('--green-l', t.cl);
  root.style.setProperty('--green-dim', t.dim);
  root.style.setProperty('--green-b', t.b);
  root.style.setProperty('--bg', t.bg);
  root.style.setProperty('--surface', t.surf);
  root.style.setProperty('--text', t.text);
  root.style.setProperty('--text2', t.text2);
  root.style.setProperty('--text3', t.text3);
  
  if (name === 'escuro') {
    root.style.setProperty('--border', '#334155');
    root.style.setProperty('--surface2', '#0F172A');
  } else {
    root.style.setProperty('--border', '#E2E8F0');
    root.style.setProperty('--surface2', '#F8FAFC');
  }
  
  localStorage.setItem('cejam_theme', name);
  cm('m-settings');
}

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

  try {
    console.log("1. Iniciando login...");
    await fb.auth.signInWithEmailAndPassword(email, senha);
    // O fluxo continuará no onAuthStateChanged para evitar duplicidade
  } catch(e){
    console.error("FALHA NO LOGIN:", e);
    const errorMsg = (e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') 
      ? "E-mail ou senha incorretos." 
      : "Falha ao entrar. Verifique sua conexão.";
    
    errBox.innerHTML = errorMsg;
    errBox.classList.add('show');
    toast(errorMsg, "!", "error");
    
    const dBox = $('debug-box');
    const dMsg = $('debug-msg');
    if(dBox && dMsg) {
      dBox.style.display = 'block';
      dMsg.innerHTML = `<strong>Erro:</strong> ${e.message}<br><strong>Código:</strong> ${e.code}`;
    }
  } finally {
    // Se ainda estivermos na tela de login após 2 segundos (falha ou demora), libera o botão
    setTimeout(() => {
       if($('sc-login').style.display !== 'none') {
         btn.disabled = false; 
         btn.innerHTML = 'Entrar';
       }
    }, 2000);
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
    
    if((role === 'tecnico' || role === 'enfermagem') && !_alaTrabalho) {
      fillAlaSel('sel-ala-trabalho');
      om('m-selecionar-ala');
    } else {
      if(role === 'tecnico') showPanel('enf-adm');
      else if(role === 'medico') showPanel('med-dash');
      else if(role === 'admin') showPanel('adm-dash');
      else if(role === 'enfermagem') showPanel('enf-painel');
      else if(role === 'farmacia') showPanel('farm-disp');
      else showPanel('adm-dash');
      show('sc-main');
    }
  }
}

function confirmarAlaTrabalho() {
  const ala = $('sel-ala-trabalho').value;
  if(!ala) return toast('Selecione uma ala', '⚠', 'error');
  _alaTrabalho = ala;
  localStorage.setItem('cejam_ala', ala);
  cm('m-selecionar-ala');
  show('sc-main');
  
  const role = currentUser.cargo;
  if(role === 'tecnico') showPanel('enf-adm');
  else if(role === 'enfermagem') showPanel('enf-painel');
  toast(`Ala ${ala} selecionada para o plantão`, '🏥', 'ok');
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
  console.log("Encerrando sessão...");
  // Limpa todos os listeners ativos para evitar travamentos
  unsubscribers.forEach(unsub => unsub());
  unsubscribers = [];
  
  fb.auth.signOut();
  currentUser = null;
  
  hide('app'); 
  show('sc-login');
  
  // Limpa campos e reseta botão
  $('l-email').value = ''; 
  $('l-senha').value = '';
  const btn = $('btn-login');
  if(btn) { btn.disabled = false; btn.innerHTML = 'Entrar'; }
}

// ── DATA LOADING (REAL-TIME) ────────────────
function calcularProximoTurnoSV(apartirDe = new Date()) {
  const d = new Date(apartirDe);
  const h = d.getHours();
  let next = new Date(d);
  next.setMinutes(0, 0, 0);
  if (h < 7) next.setHours(7);
  else if (h < 19) next.setHours(19);
  else {
    next.setDate(next.getDate() + 1);
    next.setHours(7);
  }
  return next.getTime();
}

function formatarTimestamp(ts) {
  if (!ts) return '';
  if (typeof ts === 'string') return ts;
  let d;
  if (ts.toDate) d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('pt-BR').replace(',', '');
}

function formatarPendenciaSV(ts) {
  if (!ts) return '<span class="badge b-yellow">Pendente (Agendar)</span>';
  const agora = Date.now();
  const d = new Date(ts);
  const hora = d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
  const isHoje = new Date().toDateString() === d.toDateString();
  const diaText = isHoje ? 'Hoje' : d.getDate() + '/' + (d.getMonth()+1);
  
  if (agora >= ts) {
    return `<span class="badge b-red" style="font-size:10px;padding:4px 8px">⏰ Atrasado: ${diaText} às ${hora}</span>`;
  } else {
    return `<span class="badge b-blue" style="font-size:10px;padding:4px 8px;opacity:0.8">Próximo: ${diaText} às ${hora}</span>`;
  }
}

function setupRealtime(){
  // Limpa listeners antigos se houver
  unsubscribers.forEach(unsub => unsub());
  unsubscribers = [];

  // Listeners para atualização automática do STATE e UI usando padrão Compat
  const u1 = fb.db.collection("pacientes").orderBy("criado_em", "desc").onSnapshot(snap => {
    STATE.pacientes = snap.docs.map(d => { 
      let data = d.data(); 
      data.ala = data.ala || data.leito || '—'; 
      data.criado_em = formatarTimestamp(data.criado_em);
      if (!data.proximo_sv && data.status === 'internado') {
        data.proximo_sv = Date.now() - 10000;
      }
      return { id: d.id, ...data }; 
    });
    refreshUI();
  });
  unsubscribers.push(u1);

  const u2 = fb.db.collection("prescricoes").orderBy("criado_em", "desc").onSnapshot(snap => {
    const isFirstLoad = STATE.prescricoes.length === 0;
    const oldPresc = [...STATE.prescricoes];
    STATE.prescricoes = snap.docs.map(d => { let data = d.data(); data.ala = data.ala || data.leito || '—'; data.criado_em = formatarTimestamp(data.criado_em); return { id: d.id, ...data }; });

    if (!isFirstLoad) {
      snap.docChanges().forEach(change => {
        if (change.type === "added") {
          const p = change.doc.data();
          registrarNotificacao("📋 Nova Prescrição", `Paciente: ${p.pac_nome} - ${p.medicamento}`, ['farmacia', 'enfermagem', 'tecnico']);
          toast(`Nova prescrição: ${p.pac_nome}`, "📋", "info");
        }
        if (change.type === "modified") {
          const p = change.doc.data();
          const old = oldPresc.find(o => o.id === change.doc.id);
          if (old && old.status === 'ativa' && p.status === 'dispensada') {
            registrarNotificacao("💊 Medicação Liberada", `${p.medicamento} para ${p.pac_nome} pronto para administrar.`, ['enfermagem', 'tecnico']);
            toast(`Liberado: ${p.medicamento}`, "💊", "ok");
          }
        }
      });
    }
    refreshUI();
  });
  unsubscribers.push(u2);

  const u3 = fb.db.collection("notificacoes").orderBy("criado_em", "desc").limit(20).onSnapshot(snap => {
    STATE.notificacoes = snap.docs.map(d => { let data = d.data(); data.criado_em = formatarTimestamp(data.criado_em); return { id: d.id, ...data }; });
    renderNotifications();
  });
  unsubscribers.push(u3);

  const u4 = fb.db.collection("relatorios").orderBy("criado_em", "desc").onSnapshot(snap => {
    STATE.relatorios = snap.docs.map(d => { let data = d.data(); data.ala = data.ala || data.leito || '—'; data.criado_em = formatarTimestamp(data.criado_em); return { id: d.id, ...data }; });
    refreshUI();
  });
  unsubscribers.push(u4);

  const u5 = fb.db.collection("historico").orderBy("criado_em", "desc").onSnapshot(snap => {
    STATE.historico = snap.docs.map(d => { let data = d.data(); data.ala = data.ala || data.leito || '—'; data.criado_em = formatarTimestamp(data.criado_em); return { id: d.id, ...data }; });
    refreshUI();
  });
  unsubscribers.push(u5);

  // Alas — disponível para todos
  fb.db.collection("alas").orderBy("nome", "asc").onSnapshot(snap => {
    console.log("🔥 Snapshot Alas:", snap.size, "documentos");
    STATE.alas = snap.docs.map(d => { 
      let data = d.data(); 
      return { id: d.id, ...data }; 
    });
    
    // Garantir que as alas padrão existam
    const alasAtuais = STATE.alas.map(a => a.nome.toUpperCase());
    if (!alasAtuais.includes('R2')) {
      console.log("🏥 Criando ala R2 padrão...");
      fb.db.collection("alas").add({ nome: 'R2', descricao: 'Masculino', ativa: true, criado_em: fb.serverTimestamp() });
    }
    if (!alasAtuais.includes('R3')) {
      console.log("🏥 Criando ala R3 padrão...");
      fb.db.collection("alas").add({ nome: 'R3', descricao: 'Feminino', ativa: true, criado_em: fb.serverTimestamp() });
    }
    
    refreshUI();
  }, err => {
    console.error("❌ Erro no snapshot de Alas:", err);
  });

  if (currentUser.cargo === 'admin') {
    fb.db.collection("funcionarios").onSnapshot(snap => {
      STATE.funcionarios = snap.docs.map(d => { let data = d.data(); data.criado_em = formatarTimestamp(data.criado_em); return { id: d.id, ...data }; });
      refreshUI();
    });
  }

  // CORREÇÃO TEMPORÁRIA: Atualizar Marcela Silva para R3
  fb.db.collection("pacientes").where("nome", "==", "marcela silva").get().then(snap => {
    snap.docs.forEach(d => d.ref.update({ ala: "R3", leito: "R3" }));
  }).catch(e => console.error("Erro ao corrigir Marcela:", e));
}

function refreshUI(){
  const act=document.querySelector('.nav-item.active');
  if(act) {
    const panelId = act.id.replace('nav-','');
    $('content').innerHTML = buildPanel(panelId);
  }
  updateBadges();
  fillAlaSel('p-ala');
  fillAlaSel('sel-ala-trabalho');
}

// ── SIDEBAR ───────────────────────────────
const navConfig = {
  admin:[
    {sec:'Gestão'},{id:'adm-dash',icon:'📈',label:'Dashboard'},
    {id:'adm-funcs',icon:'👥',label:'Funcionários'},
    {id:'adm-alas',icon:'🏥',label:'Alas'},
    {id:'adm-mon',icon:'👁️',label:'Monitoramento'},
    {id:'adm-pacs',icon:'👤',label:'Pacientes'},
    {sec:'Relatórios'},{id:'adm-hist',icon:'📊',label:'Histórico Geral'},
    {id:'farm-consumo',icon:'📦',label:'Consumo Diário'},
    {id:'farm-pedido',icon:'📋',label:'Pedido de Compra'},
  ],
  medico:[
    {sec:'Clínico'},{id:'med-dash',icon:'📈',label:'Dashboard'},
    {id:'med-pacs',icon:'👤',label:'Pacientes'},
    {id:'med-rx',icon:'📋',label:'Prescrições',badge:'presc'},
    {sec:'Consulta'},{id:'med-relats',icon:'📝',label:'Relatórios Enf.'},
    {id:'med-hist',icon:'📊',label:'Histórico'},
  ],
  farmacia:[
    {sec:'Farmácia'},{id:'farm-disp',icon:'💊',label:'Dispensação',badge:'disp'},
    {id:'farm-hist',icon:'📊',label:'Histórico'},
    {id:'farm-consumo',icon:'📦',label:'Consumo Diário'},
    {id:'farm-pedido',icon:'📋',label:'Pedido de Compra'},
  ],
  enfermagem:[
    {sec:'Enfermagem'},{id:'enf-painel',icon:'📈',label:'Painel'},
    {id:'enf-pacs',icon:'👤',label:'Pacientes'},
    {id:'enf-adm',icon:'💉',label:'Administrar',badge:'adminPend'},
    {id:'enf-relat',icon:'📝',label:'Relatórios Diários'},
    {id:'enf-sv',icon:'❤️',label:'Sinais Vitais'},
  ],
  tecnico:[
    {sec:'Ala'},
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
  
  // Mostrar/Ocultar botão de trocar ala no topo
  const btnAla = $('btn-trocar-ala-top');
  if (btnAla) {
    btnAla.style.display = (currentUser.cargo === 'enfermagem' || currentUser.cargo === 'tecnico') ? 'flex' : 'none';
  }

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
  'farm-consumo':'Consumo Diário',
  'enf-painel':'Painel de Enfermagem','enf-pacs':'Pacientes',
  'enf-adm':'Administração de Medicamentos','enf-relat':'Relatórios Diários','enf-sv':'Sinais Vitais',
};

function showPanel(id){
  if (id === 'trocar-ala') {
    om('m-selecionar-ala');
    fillAlaSel('sel-ala-trabalho');
    return;
  }
  $('content').innerHTML=buildPanel(id);
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const ni=$('nav-'+id); if(ni) ni.classList.add('active');
  $('topbar-title').textContent=panelTitles[id]||id;
  fillPacSel('rx-pac'); fillPacSel('r-pac');
  updateBadges();
}

function updateBadges(){
  const atv = STATE.prescricoes.filter(p => p.status === 'ativa').length;
  let admP = STATE.prescricoes.filter(p => p.status === 'dispensada').length;

  // Filtro por Ala para Enfermagem/Técnico
  if ((currentUser?.cargo === 'enfermagem' || currentUser?.cargo === 'tecnico') && _alaTrabalho) {
    admP = STATE.prescricoes.filter(p => p.status === 'dispensada' && (getAlaFromPresc(p) === _alaTrabalho || getAlaFromPresc(p) === '—')).length;
  }

  [['badge-presc', atv], ['badge-disp', atv], ['badge-adminPend', admP]].forEach(([id, v]) => {
    const el = $(id);
    if (el) {
      el.textContent = v;
      el.style.display = v > 0 ? 'flex' : 'none';
    }
  });
  
  // Notificações no topo
  const notifCount = STATE.notificacoes.filter(n => !n.lida).length;
  const topN = $('top-notif-count');
  if (topN) {
    topN.textContent = notifCount;
    topN.style.display = notifCount > 0 ? 'flex' : 'none';
  }
}

function fillPacSel(selId){
  const s=$(selId); if(!s) return;
  s.innerHTML='<option value="">Selecionar...</option>'+
    STATE.pacientes.filter(p=>p.status==='internado')
      .map(p=>`<option value="${p.id}">${p.nome} — ${p.ala}</option>`).join('');
}

function fillAlaSel(selId){
  const s=$(selId); if(!s) return;
  const optDefault = '<option value="">Selecionar Ala...</option>';
  const optList = STATE.alas.filter(a=>a.ativa).map(a=>`<option value="${a.nome}">${a.nome}${a.descricao ? ' — '+a.descricao : ''}</option>`).join('');
  s.innerHTML = optDefault + optList;
  console.log(`✅ Select ${selId} populado com ${STATE.alas.length} alas`);
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
    case 'adm-alas':   return pAdmAlas();
    case 'adm-pacs':   case 'med-pacs': case 'enf-pacs': return pPacientes();
    case 'adm-hist':   case 'med-hist': return pHistorico();
    case 'adm-mon':    return pAdmMon();
    case 'med-dash':   return pMedDash();
    case 'med-rx':     return pRx();
    case 'med-relats': return pRelatsMed();
    case 'farm-disp':  return pDisp();
    case 'farm-hist':  return pHistFarm();
    case 'farm-consumo': return pFarmConsumo();
    case 'farm-pedido': return pFarmPedido();
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
    <table><thead><tr><th>Paciente</th><th>Ala</th><th>Dias</th><th>Diagnóstico</th></tr></thead>
    <tbody>${STATE.pacientes.filter(p=>p.status==='internado').map(p=>`<tr>
      <td><strong>${p.nome}</strong></td><td class="mono">${p.ala}</td>
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
    <table><thead><tr><th>Data/Hora</th><th>Técnico/Responsável</th><th>Paciente</th><th>Ala</th><th>Medicamento</th><th>Observação</th></tr></thead>
    <tbody>${adms.length===0 ? `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text3)">Nenhuma administração registrada</td></tr>`
      : adms.map(h => `<tr>
        <td class="mono" style="font-size:11px">${h.criado_em}</td>
        <td><strong style="color:var(--purple)">${h.responsavel}</strong></td>
        <td><strong>${h.pac_nome}</strong></td>
        <td class="mono">${h.ala || '—'}</td>
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

function pAdmAlas(){
  return `<div class="sec-hdr"><div><div class="sec-title">Gestão de Alas</div><div class="sec-sub">Configure as alas e leitos disponíveis</div></div>
  <button class="btn btn-primary" onclick="om('m-nova-ala')">+ Nova Ala</button></div>
  <div class="tcard"><table><thead><tr><th>Ala</th><th>Descrição</th><th>Status</th><th>Ações</th></tr></thead>
  <tbody>${STATE.alas.map(a=>`<tr>
    <td><strong>${a.nome}</strong></td>
    <td style="font-size:11px">${a.descricao||'—'}</td>
    <td>${a.ativa?'<span class="badge b-green">Ativa</span>':'<span class="badge b-red">Inativa</span>'}</td>
    <td>
      ${a.ativa?`<button class="btn btn-outline btn-sm" onclick="toggleAla('${a.id}')">Desativar</button>`
               :`<button class="btn btn-green btn-sm" onclick="toggleAla('${a.id}')">Ativar</button>`}
    </td>
  </tr>`).join('')}</tbody></table></div>`;
}

function pPacientes(){
  let intern=STATE.pacientes.filter(p=>p.status==='internado');
  const role = currentUser.cargo;
  if ((role === 'enfermagem' || role === 'tecnico') && _alaTrabalho) {
    intern = intern.filter(p => p.ala === _alaTrabalho);
  }
  const altas=STATE.pacientes.filter(p=>p.status==='alta');
  const canAdmit=['admin','medico','enfermagem'].includes(currentUser?.cargo);
  const canAlta=['admin','medico'].includes(currentUser?.cargo);
  const canRelat=['admin','medico','enfermagem'].includes(currentUser?.cargo);
  return `<div class="sec-hdr"><div><div class="sec-title">Pacientes</div><div class="sec-sub">${intern.length} internados · ${altas.length} altas</div></div>
    ${canAdmit?`<button class="btn btn-primary" onclick="om('m-pac')">+ Admitir Paciente</button>`:''}</div>
  
  <div style="margin-bottom:16px; display:flex; gap:10px; align-items:center">
    <div class="fgrp" style="margin:0; flex:1; max-width:400px">
      <input type="text" id="pac-list-search" class="fi" placeholder="🔍 Buscar por nome do paciente..." onkeyup="filtrarTabelaPacientes()"/>
    </div>
    <div style="font-size:12px; color:var(--text3)">Digite o nome para filtrar ou role a lista abaixo.</div>
  </div>

  <div class="tcard"><div class="thead-row"><div class="ttitle">Internados</div></div>
  <table><thead><tr><th>Paciente</th><th>Ala</th><th>Admissão</th><th>Dias</th><th>Diagnóstico</th><th>Alergias</th><th>Ações</th></tr></thead>
  <tbody>${intern.map(p=>`<tr>
    <td><a href="#" style="color:var(--blue);text-decoration:none" onclick="abrirPerfilPaciente('${p.id}')"><strong>${p.nome}</strong></a></td><td class="mono">${p.ala}</td>
    <td class="mono" style="font-size:10px">${p.admissao}</td><td>${dBadge(p.admissao)}</td>
    <td style="font-size:11px">${p.diagnostico}</td>
    <td class="mono" style="font-size:10px;color:var(--red)">${p.alergias}</td>
    <td style="display:flex; gap:4px">
      ${canRelat?`<button class="btn btn-outline btn-xs" onclick="abrirRelat('${p.id}')">Relatório</button>`:''}
      <button class="btn btn-outline btn-xs" onclick="verRelatsPac('${p.id}')">Ver</button>
      ${canAlta?`<button class="btn btn-red btn-xs" onclick="abrirAlta('${p.id}')">Alta</button>`:''}
    </td>
  </tr>`).join('')}</tbody></table></div>
  ${altas.length?`<div class="tcard"><div class="thead-row"><div class="ttitle">Altas Recentes</div></div>
  <table><thead><tr><th>Paciente</th><th>Ala</th><th>Data Alta</th><th>Tipo</th></tr></thead>
  <tbody>${altas.map(p=>`<tr><td><a href="#" style="color:var(--text);text-decoration:none" onclick="abrirPerfilPaciente('${p.id}')">${p.nome}</a></td><td class="mono">${p.ala}</td>
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
        ${canAlta ? `<button class="btn btn-red" onclick="abrirAlta('${p.id}')">Dar Alta</button>` : ''}
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
        <div class="pac-name" style="color:var(--text2)">Ala</div>
        <div class="mono" style="font-size:16px;color:var(--blue)">${p.ala}</div>
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
      <div class="thead-row"><div class="ttitle">📈 Sinais Vitais & Evolução</div></div>
      <table>
        <thead><tr><th>Data/Turno</th><th>Sinais Vitais (PA / FC / Temp / SpO2)</th><th>Estado</th><th>Enfermeiro</th></tr></thead>
        <tbody>
          ${rels.length ? rels.map(r => `<tr>
            <td style="font-size:11px">${r.data} <br/> <span class="mono" style="font-size:10px;color:var(--text3)">${r.turno}</span></td>
            <td class="mono" style="font-size:11px">
              <strong>${r.pa || '—'}</strong> mmHg · 
              <strong>${r.fc || '—'}</strong> bpm · 
              <strong>${r.temperatura || '—'}</strong>°C · 
              <strong>${r.spo2 || '—'}</strong>%
            </td>
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
                  ${h.ala ? `<span>🏥 Ala: ${h.ala}</span>` : ''}
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
    <td><button class="btn btn-outline btn-sm" onclick="verRelatsPac('${r.pac_id}')">Ver</button></td>
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

function groupPrescByPac(prescList) {
  const groups = {};
  prescList.forEach(p => {
    if (!groups[p.pac_id]) {
      const pac = STATE.pacientes.find(x => x.id === p.pac_id);
      groups[p.pac_id] = {
        pac: pac || { nome: p.pac_nome, ala: p.ala, alergias: 'NKDA' },
        items: []
      };
    }
    groups[p.pac_id].items.push(p);
  });
  return Object.values(groups);
}

function pDisp(){
  const pend = STATE.prescricoes.filter(p => p.status === 'ativa' || p.status === 'dispensada');
  const grouped = groupPrescByPac(pend);
  const ativasCount = pend.filter(p => p.status === 'ativa').length;
  
  return `<div class="sec-hdr"><div><div class="sec-title">Fila de Dispensação</div><div class="sec-sub">${ativasCount} aguardando dispensação imediata</div></div></div>
  <div class="alert a-warn">⚠️ Confira alergias do paciente antes de dispensar. As prescrições já dispensadas aparecerão como "Com a Enfermagem" até o próximo horário.</div>
  
  <div class="bulk-container">
    ${grouped.length === 0 ? `<div class="tcard" style="text-align:center;padding:48px;color:var(--green)">✓ Tudo em dia. Nenhuma medicação pendente no momento.</div>`
    : grouped.map(g => {
      const ativasPac = g.items.filter(i => i.status === 'ativa');
      return `
      <div class="tcard" style="margin-bottom:20px; border-left: 4px solid var(--blue)">
        <div class="thead-row" style="background: var(--bg2); padding: 12px 16px; border-radius: 8px 8px 0 0; display: flex; align-items: center; gap: 15px;">
          <div class="pac-av" style="width: 32px; height: 32px; font-size: 14px;">${g.pac.nome[0]}</div>
          <div style="flex:1">
            <div style="font-weight: 700; color: var(--text1); font-size: 15px;">${g.pac.nome}</div>
            <div style="font-size: 11px; color: var(--text3)">Ala: ${g.pac.ala || '—'} · Alergias: <strong style="color:var(--red)">${g.pac.alergias || 'NKDA'}</strong></div>
          </div>
          ${ativasPac.length > 0 ? `<button class="btn btn-primary btn-sm" onclick="abrirDispLote('${g.pac.id}')">Dispensar Selecionados (${ativasPac.length})</button>` : ''}
        </div>
        <table style="margin:0">
          <thead>
            <tr>
              <th style="width:40px"><input type="checkbox" checked onchange="togglePacCheck('${g.pac.id}', this.checked)"></th>
              <th>Medicamento</th>
              <th>Dose / Via</th>
              <th>Próxima</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="group-disp-${g.pac.id}">
            ${g.items.map(p => {
              const timing = checkTimingStatus(p.proxima_dose);
              return `
              <tr style="${p.status === 'dispensada' ? 'opacity:0.6' : ''}">
                <td>
                  ${p.status === 'ativa' 
                    ? `<input type="checkbox" class="check-pac-${g.pac.id}" value="${p.id}" checked ${timing.isEarly ? 'disabled' : ''}>` 
                    : '✓'}
                </td>
                <td>
                  <strong>${p.medicamento}</strong><br/>
                  <small style="color:var(--text3); font-size:10px">${p.medico}</small>
                </td>
                <td class="mono">${p.dose} · ${p.via}</td>
                <td>
                  ${p.proxima_dose ? `<span class="badge ${timing.isEarly ? 'b-gray' : (timing.isLateOver15 ? 'b-red' : 'b-blue')}" style="font-size:10px">${p.proxima_dose}</span>` : '—'}
                </td>
                <td>
                  ${p.status === 'ativa' 
                    ? (timing.isEarly ? '<span class="badge b-gray">Aguardar Horário</span>' : '<span class="badge b-yellow">Pendente</span>')
                    : '<span class="badge b-purple">Enfermagem</span>'}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
    }).join('')}
  </div>`;
}

function togglePacCheck(pacId, isChecked) {
  const checks = document.querySelectorAll(`.check-pac-${pacId}`);
  checks.forEach(c => {
    if (!c.disabled) {
      c.checked = isChecked;
    }
  });
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

function getDosesPorDia(freq) {
  if (!freq) return 0;
  const f = freq.toLowerCase();
  if (f.includes('1x ao dia') || f.includes('24/24h')) return 1;
  if (f.includes('2x ao dia') || f.includes('12/12h') || f.includes('08h - 20h')) return 2;
  if (f.includes('3x ao dia') || f.includes('08/08h') || f.includes('14h - 22h - 06h')) return 3;
  if (f.includes('4x ao dia') || f.includes('06/06h') || f.includes('00h - 06h - 12h - 18h')) return 4;
  if (f.includes('6x ao dia') || f.includes('04/04h')) return 6;
  if (f.includes('se necessário') || f.includes('sn')) return 1; 
  if (f.includes('dose única') || f.includes('agora')) return 1;
  return 1;
}

function pFarmPedido() {
  return `<div class="sec-hdr"><div><div class="sec-title">📋 Pedido de Compra</div><div class="sec-sub">Projeção de medicamentos para estoque futuro com base nas prescrições ativas</div></div></div>
  
  <div class="tcard" style="margin-bottom:16px">
    <div class="thead-row"><div class="ttitle">⚙️ Configurar Projeção</div></div>
    <div style="padding:16px;display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap">
      <div class="fgrp" style="flex:1;min-width:180px">
        <label class="flabel">Dias de Projeção (ex: 30 para um mês)</label>
        <input class="fi" type="number" id="pedido-dias" value="30" min="1" max="90"/>
      </div>
      <button class="btn btn-primary" onclick="calcularPedidoFarmacia()" style="height:38px;padding:0 20px">
        Gerar Relação de Pedido
      </button>
    </div>
  </div>

  <div id="pedido-resultado">
    <div style="text-align:center;padding:40px;color:var(--text3);font-size:14px">
      📑 Defina a quantidade de dias e clique em <strong>Gerar Relação</strong> para calcular as necessidades totais dos pacientes.
    </div>
  </div>`;
}

function calcularPedidoFarmacia() {
  const dias = parseInt(document.getElementById('pedido-dias')?.value) || 30;
  const res = document.getElementById('pedido-resultado');
  if (!res) return;

  const ativas = STATE.prescricoes.filter(p => p.status === 'ativa' || p.status === 'dispensada');
  const mapa = {};

  ativas.forEach(p => {
    const med = p.medicamento;
    const dosesDia = getDosesPorDia(p.frequencia);
    const totalDoses = dosesDia * dias;
    
    if (!mapa[med]) {
      mapa[med] = { total: 0, pacientes: new Set(), dosesDia: 0 };
    }
    mapa[med].total += totalDoses;
    mapa[med].dosesDia += dosesDia;
    mapa[med].pacientes.add(p.pac_nome);
  });

  const lista = Object.entries(mapa).sort((a, b) => a[0].localeCompare(b[0]));

  if (lista.length === 0) {
    res.innerHTML = '<div class="alert a-info">Nenhuma prescrição ativa no momento para gerar pedido.</div>';
    return;
  }

  res.innerHTML = `
    <div class="tcard">
      <div class="thead-row">
        <div class="ttitle">Necessidades para ${dias} dias</div>
        <div style="display:flex; gap:8px">
          <button class="btn btn-outline btn-sm" onclick="imprimirPedido()">🖨️ Imprimir</button>
          <button class="btn btn-primary btn-sm" onclick="exportarPedidoPDF()">📄 Exportar PDF</button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Medicamento</th>
            <th style="text-align:center">Doses/Dia (Total)</th>
            <th style="text-align:center">Qtd p/ ${dias} dias</th>
            <th style="text-align:center">Nº Pacientes</th>
          </tr>
        </thead>
        <tbody>
          ${lista.map(([med, info]) => `
            <tr>
              <td><strong>${med}</strong></td>
              <td style="text-align:center">${info.dosesDia}</td>
              <td style="text-align:center"><span class="badge b-blue" style="font-size:12px; font-weight:bold">${info.total}</span></td>
              <td style="text-align:center; font-weight:bold">${info.pacientes.size}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function imprimirPedido() {
  const div = document.getElementById('pedido-resultado');
  if (!div) return;
  const win = window.open('', '', 'height=700,width=900');
  if (!win) {
    alert("A janela de impressão foi bloqueada. Por favor, utilize o botão 'Exportar PDF' que é mais seguro e profissional.");
    return;
  }
  win.document.write('<html><head><title>Pedido de Medicamentos - CEJAM</title>');
  win.document.write('<style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f2f2f2}h2,h3{text-align:center;margin:5px}.badge{background:#eff6ff;color:#1e40af;padding:2px 6px;border-radius:4px;font-weight:bold}.btn{display:none}</style>');
  win.document.write('</head><body>');
  win.document.write('<h2>CEJAM — Sistema Hospitalar</h2>');
  win.document.write('<h3>Relatório de Projeção para Pedido</h3>');
  win.document.write('<p style="text-align:center;font-size:12px">Data do Relatório: ' + new Date().toLocaleString('pt-BR') + '</p>');
  win.document.write(div.innerHTML);
  win.document.write('</body></html>');
  win.document.close();
  win.print();
}

async function exportarPedidoPDF() {
  const dias = document.getElementById('pedido-dias')?.value || "30";
  const ativas = STATE.prescricoes.filter(p => p.status === 'ativa' || p.status === 'dispensada');
  const mapa = {};

  ativas.forEach(p => {
    const med = p.medicamento;
    const dosesDia = getDosesPorDia(p.frequencia);
    const totalDoses = dosesDia * parseInt(dias);
    if (!mapa[med]) mapa[med] = { total: 0, pacientes: new Set(), dosesDia: 0 };
    mapa[med].total += totalDoses;
    mapa[med].dosesDia += dosesDia;
    mapa[med].pacientes.add(p.pac_nome);
  });

  const itens = Object.entries(mapa).map(([med, info]) => ({
    medicamento: med,
    doses_dia: info.dosesDia.toString(),
    total: info.total.toString(),
    pacientes_count: info.pacientes.size.toString()
  })).sort((a, b) => a.medicamento.localeCompare(b.medicamento));

  try {
    const b64 = await window.__TAURI__.core.invoke('cmd_gerar_pedido_pdf', { 
      data: {
        dias: dias.toString(),
        itens: itens,
        responsavel: currentUser.nome,
        data: new Date().toLocaleString('pt-BR')
      }
    });

    const link = document.createElement('a');
    link.href = `data:application/pdf;base64,${b64}`;
    link.download = `Pedido_Medicamentos_${new Date().toISOString().split('T')[0]}.pdf`;
    link.click();
  } catch (err) {
    console.error(err);
    alert("Erro ao gerar PDF: " + err);
  }
}

function filtrarTabelaPacientes() {
  const q = $('pac-list-search').value.toLowerCase().trim();
  const rows = document.querySelectorAll('.tcard table tbody tr');
  rows.forEach(row => {
    // Busca o nome do paciente na primeira coluna (que contém o <strong>)
    const nomeEl = row.querySelector('td strong');
    if (nomeEl) {
      const nome = nomeEl.textContent.toLowerCase();
      row.style.display = nome.includes(q) ? '' : 'none';
    }
  });
}

function pFarmConsumo(){
  // Datas padrão: início do mês atual até hoje
  const hoje = new Date();
  const inicioPadrao = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().split('T')[0];
  const fimPadrao = hoje.toISOString().split('T')[0];

  return `<div class="sec-hdr"><div><div class="sec-title">📦 Consumo de Medicamentos</div><div class="sec-sub">Quantidade real dispensada por período — sem identificação de paciente</div></div></div>

  <div class="tcard" style="margin-bottom:16px">
    <div class="thead-row"><div class="ttitle">🔍 Filtrar Período</div></div>
    <div style="padding:16px;display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap">
      <div class="fgrp" style="flex:1;min-width:140px">
        <label class="flabel">Data Início</label>
        <input class="fi" type="date" id="consumo-inicio" value="${inicioPadrao}"/>
      </div>
      <div class="fgrp" style="flex:1;min-width:140px">
        <label class="flabel">Data Fim</label>
        <input class="fi" type="date" id="consumo-fim" value="${fimPadrao}"/>
      </div>
      <button class="btn btn-primary" onclick="aplicarFiltroConsumo()" style="height:38px;padding:0 20px">
        Gerar Relatório
      </button>
    </div>
  </div>

  <div id="consumo-resultado">
    <!-- Resultado será inserido aqui ao clicar em Gerar -->
    <div style="text-align:center;padding:40px;color:var(--text3);font-size:14px">
      📅 Selecione o período e clique em <strong>Gerar Relatório</strong>
    </div>
  </div>`;
}

function aplicarFiltroConsumo() {
  const inicioStr = document.getElementById('consumo-inicio')?.value;
  const fimStr    = document.getElementById('consumo-fim')?.value;
  const resultado = document.getElementById('consumo-resultado');
  if (!resultado) return;

  if (!inicioStr || !fimStr) {
    resultado.innerHTML = '<div class="alert a-warn">Selecione as datas de início e fim.</div>';
    return;
  }

  // Converte as strings para Date sem timezone offset (trata como data local)
  const [aI, mI, dI] = inicioStr.split('-').map(Number);
  const [aF, mF, dF] = fimStr.split('-').map(Number);
  const dtInicio = new Date(aI, mI - 1, dI, 0, 0, 0, 0);
  const dtFim    = new Date(aF, mF - 1, dF, 23, 59, 59, 999);

  if (dtInicio > dtFim) {
    resultado.innerHTML = '<div class="alert a-warn">A data de início deve ser anterior à data fim.</div>';
    return;
  }

  // Filtra apenas dispensações (saídas reais do estoque) no período
  const dispensadas = STATE.historico.filter(h => {
    if (h.tipo !== 'Dispensação') return false;
    if (!h.criado_em) return false;
    // criado_em pode ser Timestamp Firebase ou string
    let dt;
    if (h.criado_em.toDate) {
      dt = h.criado_em.toDate();
    } else if (h.criado_em.seconds) {
      dt = new Date(h.criado_em.seconds * 1000);
    } else {
      dt = new Date(h.criado_em);
    }
    return dt >= dtInicio && dt <= dtFim;
  });

  if (dispensadas.length === 0) {
    resultado.innerHTML = `
      <div class="tcard">
        <div style="text-align:center;padding:40px;color:var(--text3)">
          Nenhuma dispensação encontrada no período de <strong>${inicioStr.split('-').reverse().join('/')}</strong>
          até <strong>${fimStr.split('-').reverse().join('/')}</strong>.
        </div>
      </div>`;
    return;
  }

  // Agrupa por medicamento → { total, porDia: { 'DD/MM/YYYY': count } }
  const mapa = {};
  dispensadas.forEach(h => {
    const med = (h.medicamento || '(sem nome)').toUpperCase().trim();
    if (!mapa[med]) mapa[med] = { total: 0, porDia: {} };
    mapa[med].total++;

    // Determina a data do evento para o breakdown diário
    let dt;
    if (h.criado_em.toDate) dt = h.criado_em.toDate();
    else if (h.criado_em.seconds) dt = new Date(h.criado_em.seconds * 1000);
    else dt = new Date(h.criado_em);

    const diaKey = dt.toLocaleDateString('pt-BR'); // ex: "14/05/2026"
    mapa[med].porDia[diaKey] = (mapa[med].porDia[diaKey] || 0) + 1;
  });

  const totalGeral = dispensadas.length;
  const qtdMeds = Object.keys(mapa).length;

  // Coleta todos os dias do período que tiveram movimento para montar as colunas
  const diasSet = new Set();
  Object.values(mapa).forEach(v => Object.keys(v.porDia).forEach(d => diasSet.add(d)));
  // Ordena os dias cronologicamente
  const diasOrdenados = Array.from(diasSet).sort((a, b) => {
    const [da, ma, aa] = a.split('/').map(Number);
    const [db, mb, ab] = b.split('/').map(Number);
    return new Date(aa, ma-1, da) - new Date(ab, mb-1, db);
  });

  // Resumo por medicamento (tabela principal)
  const rowsResumo = Object.keys(mapa).sort().map(med => {
    const info = mapa[med];
    const breakdown = diasOrdenados
      .filter(d => info.porDia[d])
      .map(d => `<span class="badge b-blue" style="font-size:10px;margin:1px">${d}: ${info.porDia[d]} cp</span>`)
      .join(' ');
    return `<tr>
      <td><strong style="font-size:13px">${med}</strong></td>
      <td class="mono" style="font-size:20px;font-weight:700;color:var(--blue);text-align:center">${info.total}</td>
      <td style="font-size:11px;line-height:1.8">${breakdown || '—'}</td>
    </tr>`;
  }).join('');

  // Período formatado
  const periodoFmt = `${inicioStr.split('-').reverse().join('/')} → ${fimStr.split('-').reverse().join('/')}`;

  resultado.innerHTML = `
    <div class="sg3" style="margin-bottom:16px">
      <div class="stat-card">
        <div class="stat-label">Total de Comprimidos Saídos</div>
        <div class="stat-val" style="color:var(--blue)">${totalGeral}</div>
        <div class="stat-sub">No período selecionado</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Medicamentos Diferentes</div>
        <div class="stat-val" style="color:var(--green)">${qtdMeds}</div>
        <div class="stat-sub">Tipos únicos dispensados</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Período</div>
        <div class="stat-val" style="font-size:13px;color:var(--yellow)">${periodoFmt}</div>
        <div class="stat-sub">${diasOrdenados.length} dia(s) com movimento</div>
      </div>
    </div>
    <div class="tcard">
      <div class="thead-row">
        <div class="ttitle">💊 Comprimidos Dispensados por Medicamento</div>
        <span class="badge b-green">${totalGeral} unidades no total</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Medicamento</th>
            <th style="text-align:center;width:120px">Total Saído</th>
            <th>Distribuição Diária</th>
          </tr>
        </thead>
        <tbody>${rowsResumo}</tbody>
      </table>
    </div>`;
}

function pEnfPainel(){
  const hoje=new Date().toLocaleDateString('pt-BR');
  const relatHoje=id=>STATE.relatorios.some(r=>r.pac_id===id&&r.data===hoje);
  
  let pacs = STATE.pacientes.filter(p=>p.status==='internado');
  if (_alaTrabalho) {
    pacs = pacs.filter(p => p.ala === _alaTrabalho);
  }
  
  const totalMeds = STATE.prescricoes.filter(p => p.status === 'dispensada').length;
  // Note: We might want to filter totalMeds too, but let's keep it simple for now or filter it if needed.
  
  return `<div class="sec-hdr"><div><div class="sec-title">Painel de Enfermagem ${(_alaTrabalho ? ' — Ala ' + _alaTrabalho : '')}</div></div>
    <button class="btn btn-primary" onclick="om('m-pac')">+ Admitir Paciente</button></div>
  <div class="sg3">
    <div class="stat-card"><div class="stat-label">Internados</div><div class="stat-val" style="color:var(--blue)">${pacs.length}</div></div>
    <div class="stat-card"><div class="stat-label">Meds Pendentes</div><div class="stat-val" style="color:var(--yellow)">${STATE.prescricoes.filter(p => p.status === 'dispensada' && (!_alaTrabalho || p.ala === _alaTrabalho || p.ala === '—')).length}</div></div>
    <div class="stat-card"><div class="stat-label">Relatórios Hoje</div><div class="stat-val" style="color:var(--purple)">${STATE.relatorios.filter(r => r.data === hoje && (!_alaTrabalho || r.ala === _alaTrabalho || r.ala === '—')).length}</div></div>
  </div>
  <div class="tcard"><table><thead><tr><th>Paciente</th><th>Ala</th><th>Dias</th><th>Diagnóstico</th><th>Alergias</th><th>Relat. hoje</th><th>Ações</th></tr></thead>
  <tbody>${pacs.map(p=>`<tr>
    <td><strong>${p.nome}</strong></td><td class="mono">${p.ala}</td>
    <td>${dBadge(p.admissao)}</td><td style="font-size:11px">${p.diagnostico}</td>
    <td class="mono" style="font-size:10px;color:var(--red)">${p.alergias}</td>
    <td>${relatHoje(p.id)?'<span class="badge b-green">✓ Feito</span>':'<span class="badge b-yellow">Pendente</span>'}</td>
    <td style="display:flex;gap:4px">
      <button class="btn btn-outline btn-sm" onclick="abrirRelat('${p.id}')">Relatório</button>
      <button class="btn btn-outline btn-sm" onclick="verRelatsPac('${p.id}')">Ver</button>
    </td></tr>`).join('')}</tbody></table></div>`;
}

function pEnfAdm(){
  let disp = STATE.prescricoes.filter(p => p.status === 'dispensada' || p.status === 'ativa');
  if (_alaTrabalho) {
    disp = disp.filter(p => {
      const ala = getAlaFromPresc(p);
      return ala === _alaTrabalho || ala === '—';
    });
  }
  if (STATE.prescricoes.length === 0) {
    return `<div class="sec-hdr"><div><div class="sec-title">Administração de Medicamentos</div></div></div>
    <div class="tcard" style="text-align:center;padding:48px;color:var(--text3)">
      <div class="loading-spinner" style="margin:0 auto 15px"></div>
      Carregando prescrições...
    </div>`;
  }

  const grouped = groupPrescByPac(disp);
  const totalGeralDisp = STATE.prescricoes.filter(p => p.status === 'dispensada').length;
  const emOutrasAlas = totalGeralDisp - (disp.filter(p => p.status === 'dispensada').length);
  
  return `<div class="sec-hdr"><div><div class="sec-title">Administração de Medicamentos ${(_alaTrabalho ? ' — Ala ' + _alaTrabalho : '')}</div></div></div>
  <div class="alert a-info">🩺 Confirme identificação do paciente e ala antes de administrar.</div>
  
  <div class="bulk-container">
    ${grouped.length === 0 ? `
      <div class="tcard" style="text-align:center;padding:48px;color:var(--green)">
        <div style="font-size:32px;margin-bottom:15px">✅</div>
        <div style="font-weight:700;font-size:16px">Nenhum medicamento pendente para a Ala ${_alaTrabalho || 'selecionada'}.</div>
        ${emOutrasAlas > 0 ? `<div style="margin-top:12px;padding:10px;background:var(--bg2);border-radius:8px;display:inline-block;font-size:12px;color:var(--text2)">
          💡 Existem <strong>${emOutrasAlas}</strong> medicações pendentes em outras alas. <br>
          Use o botão 🔄 ao lado do seu nome para trocar de ala.
        </div>` : ''}
      </div>`
    : grouped.map(g => {
      const dispPac = g.items.filter(i => i.status === 'dispensada');
      return `
      <div class="tcard" style="margin-bottom:20px; border-left: 4px solid var(--purple)">
        <div class="thead-row" style="background: var(--bg2); padding: 12px 16px; border-radius: 8px 8px 0 0; display: flex; align-items: center; gap: 15px;">
          <div class="pac-av" style="width: 32px; height: 32px; font-size: 14px; background:var(--purple)">${g.pac.nome[0]}</div>
          <div style="flex:1">
            <div style="font-weight: 700; color: var(--text1); font-size: 15px;">${g.pac.nome}</div>
            <div style="font-size: 11px; color: var(--text3)">Ala: ${g.pac.ala || '—'} · Alergias: <strong style="color:var(--red)">${g.pac.alergias || 'NKDA'}</strong></div>
          </div>
          ${dispPac.length > 0 ? `<button class="btn btn-primary btn-sm" onclick="abrirAdmLote('${g.pac.id}')">Administrar Selecionados (${dispPac.length})</button>` : ''}
        </div>
        <table style="margin:0">
          <thead>
            <tr>
              <th style="width:40px"><input type="checkbox" checked onchange="togglePacCheck('${g.pac.id}', this.checked)"></th>
              <th>Medicamento</th>
              <th>Dose / Via / Freq</th>
              <th>Próxima</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${g.items.map(p => {
              const timing = checkTimingStatus(p.proxima_dose);
              return `
              <tr style="${p.status === 'ativa' ? 'opacity:0.6' : ''}">
                <td>
                  ${p.status === 'dispensada' 
                    ? `<input type="checkbox" class="check-pac-${g.pac.id}" value="${p.id}" checked ${timing.isEarly ? 'disabled' : ''}>` 
                    : '—'}
                </td>
                <td>
                  <strong>${p.medicamento}</strong><br/>
                  <small style="color:var(--text3); font-size:10px">${p.doses_adm || 0}/${p.total_doses || '∞'} doses realizadas</small>
                </td>
                <td class="mono" style="font-size:11px">${p.dose} · ${p.via}<br/>${p.frequencia}</td>
                <td>
                  ${p.proxima_dose ? `<span class="badge ${timing.isEarly ? 'b-gray' : (timing.isLateOver15 ? 'b-red' : 'b-blue')}" style="font-size:10px">${p.proxima_dose}</span>` : '—'}
                </td>
                <td>
                  ${p.status === 'dispensada' 
                    ? (timing.isEarly ? '<span class="badge b-gray">Aguardar Horário</span>' : '<span class="badge b-green">Pronto</span>')
                    : '<span class="badge b-gray">Na Farmácia</span>'}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
    }).join('')}
  </div>`;
}

function abrirAdm(id) {
  const p = STATE.prescricoes.find(x => x.id === id);
  if (p) abrirAdmLote(p.pac_id, [id]);
}

function abrirAdmLote(pacId, specificIds = null) {
  if (specificIds) _loteIds = specificIds;
  else {
    const checks = document.querySelectorAll(`.check-pac-${pacId}:checked`);
    _loteIds = Array.from(checks).map(c => c.value);
  }
  
  if (_loteIds.length === 0) return toast('Selecione ao menos um medicamento!', '⚠️', 'warn');
  
  const pac = STATE.pacientes.find(x => x.id === pacId);
  const meds = _loteIds.map(id => STATE.prescricoes.find(x => x.id === id));
  _loteIsLate = meds.some(m => checkTimingStatus(m.proxima_dose).isLateOver15);
  
  let bodyHTML = `
    <div class="alert a-info">🩺 Confirme a identidade do paciente.</div>
    <div class="pac-hdr" style="margin-bottom:15px"><div class="pac-av" style="background:var(--purple)">${pac.nome[0]}</div><div><div class="pac-name">${pac.nome}</div><div class="pac-info">Ala: ${pac.ala} · Alergias: <strong style="color:var(--red)">${pac.alergias}</strong></div></div></div>
    <div style="font-size:13px; margin-bottom:10px">Administrando <strong>${_loteIds.length}</strong> item(ns):</div>
    <div style="max-height: 180px; overflow-y: auto; background: var(--bg2); border-radius: 8px; padding: 10px; border: 1px solid var(--border)">
      ${meds.map(m => `<div style="padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 12px;">💊 <strong>${m.medicamento}</strong> (${m.dose})</div>`).join('')}
    </div>
    <div style="margin-top:12px"><div class="fg">
      <div class="fgrp"><label class="flabel">Enfermeiro(a)</label><input class="fi" value="${currentUser.nome}" id="adm-enf-lote"/></div>
      <div class="fgrp"><label class="flabel">Data</label><input class="fi" type="date" id="adm-data-lote" value="${new Date().toISOString().split('T')[0]}"/></div>
      <div class="fgrp"><label class="flabel">Horário</label><input class="fi" type="time" id="adm-hora-lote" value="${new Date().toTimeString().slice(0,5)}"/></div>
      ${_loteIsLate ? `<div class="fgrp ff"><label class="flabel" style="color:var(--red)">Justificativa do Atraso *</label><input class="fi" id="lote-adm-justif" placeholder="Motivo do atraso coletivo" style="border-color:var(--red)"/></div>` : ''}
      <div class="fgrp ff"><label class="flabel">Intercorrências (Opcional)</label><input class="fi" id="adm-obs-lote" placeholder="Ex: Algum recusado?"/></div>
    </div></div>`;

  $('adm-body').innerHTML = bodyHTML;
  const btnConf = document.querySelector("#m-adm .btn-primary");
  if (btnConf) {
    btnConf.onclick = confirmarAdmLote;
    btnConf.textContent = '✓ Confirmar Administração';
  }
  om('m-adm');
}

async function confirmarAdmLote() {
  if (_isAdmitting) return;
  
  let justificativa = '';
  if (_loteIsLate) {
    const el = $('lote-adm-justif');
    if (!el || !el.value.trim()) return toast('Justificativa de atraso é obrigatória!', '⚠', 'error');
    justificativa = ` [ATRASO EM LOTE: ${el.value.trim()}]`;
  }

  _isAdmitting = true;
  const btn = document.querySelector("#m-adm .btn-primary");
  if (btn) btn.textContent = 'Aguarde...';

  try {
    const batch = fb.db.batch();
    for (const id of _loteIds) {
      const p = STATE.prescricoes.find(x => x.id === id);
      const novasDoses = (p.doses_adm || 0) + 1;
      const finalizou = p.total_doses && novasDoses >= p.total_doses;
      const proxima = calcularProximaDose(p.frequencia);
      
      const dataSel = $('adm-data-lote').value;
      const horaSel = $('adm-hora-lote').value;
      const dataHoraFmt = `${dataSel.split('-').reverse().join('/')} ${horaSel}`;
      
      const ref = fb.db.collection("prescricoes").doc(id);
      batch.update(ref, { 
        status: finalizou ? 'concluida' : 'ativa',
        doses_adm: fb.increment(1),
        ultima_adm: dataHoraFmt,
        proxima_dose: proxima
      });
      
      const obs = $('adm-obs-lote')?.value || 'Administrado em lote';
      await logAction('Administração', p.pac_nome, p.medicamento, `${obs}${justificativa} (Dose ${novasDoses}/${p.total_doses || '?'})`);
    }
    await batch.commit();
    
    cm('m-adm'); toast(`${_loteIds.length} medicações administradas!`, '🩺', 'ok');
  } catch(e) { 
    console.error(e);
    toast("Erro ao administrar lote", '⚠', 'error'); 
  } finally {
    _isAdmitting = false;
    if (btn) btn.textContent = '✓ Registrar';
  }
}

function pEnfRelat(){
  return `<div class="sec-hdr"><div><div class="sec-title">Relatórios Diários</div><div class="sec-sub">${STATE.relatorios.length} registros totais</div></div>
    <button class="btn btn-primary" onclick="abrirRelat(null)">+ Novo Relatório</button></div>
  ${STATE.relatorios.length===0?`<div class="tcard"><div style="text-align:center;padding:40px;color:var(--text3)">Nenhum relatório registrado</div></div>`
  :`<div class="tcard"><table><thead><tr><th>Data</th><th>Turno</th><th>Paciente</th><th>Ala</th><th>Estado</th><th>PA</th><th>FC</th><th>Temp</th><th>Enfermeiro</th><th>Ver</th></tr></thead>
  <tbody>${STATE.relatorios.map(r=>`<tr>
    <td class="mono" style="font-size:10px">${r.data}</td>
    <td style="font-size:11px">${r.turno}</td>
    <td><strong>${r.pac_nome}</strong></td><td class="mono">${r.ala}</td>
    <td>${estadoBadge(r.estado_geral)}</td>
    <td class="mono" style="font-size:10px">${r.pa||'—'}</td>
    <td class="mono" style="font-size:10px">${r.fc||'—'}</td>
    <td class="mono" style="font-size:10px">${r.temperatura||'—'}</td>
    <td style="font-size:11px">${r.responsavel}</td>
    <td><button class="btn btn-outline btn-sm" onclick="verRelatsPac('${r.pac_id}')">Ver</button></td>
  </tr>`).join('')}</tbody></table></div>`}`;
}

function pEnfSV(){
  // Ordena os pacientes pelo horário do próximo sinal vital (os mais atrasados primeiro)
  const pacs = STATE.pacientes
    .filter(p => p.status === 'internado')
    .sort((a, b) => (a.proximo_sv || 0) - (b.proximo_sv || 0));

  return `<div class="sec-hdr"><div><div class="sec-title">Sinais Vitais</div><div class="sec-sub">Pendências baseadas no esquema 07h / 19h</div></div></div>
  <div class="tcard"><table><thead><tr><th>Paciente</th><th>Ala</th><th>Alergias</th><th>Próxima Aferição</th><th>Último Registro</th><th>Ação</th></tr></thead>
  <tbody>${pacs.length === 0 ? `<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text3)">Nenhum paciente internado</td></tr>` 
  : pacs.map(p => {
    const rels = STATE.relatorios.filter(r => r.pac_id === p.id);
    const ult = rels[0] || null;
    return`<tr>
      <td><strong>${p.nome}</strong></td><td class="mono">${p.ala}</td>
      <td class="mono" style="font-size:10px;color:var(--red)">${p.alergias||'NKDA'}</td>
      <td>
        <div style="margin-bottom:4px">${formatarPendenciaSV(p.proximo_sv)}</div>
      </td>
      <td style="font-size:11px;color:var(--text3)">
        ${ult ? `${ult.pa} / ${ult.fc} bpm / ${ult.temperatura}°C / ${ult.spo2}%` : 'Sem registros'}
      </td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="abrirSV('${p.id}')">Aferir</button>
      </td>
    </tr>`;
  }).join('')}</tbody></table></div>`;
}

let _svId = null;
function abrirSV(pacId) {
  _svId = pacId;
  const p = STATE.pacientes.find(x => x.id === pacId);
  if (!p) return;
  $('sv-pac-nome').textContent = p.nome;
  $('sv-ala').textContent = p.ala;
  
  // Limpar os campos
  ['sv-pa', 'sv-fc', 'sv-temp', 'sv-spo2', 'sv-obs'].forEach(id => {
    const el = $(id);
    if (el) el.value = '';
  });
  
  om('m-sv');
}

let _isSavingSV = false;
async function salvarSV() {
  if (_isSavingSV) return;
  if (!_svId) return;

  _isSavingSV = true;
  const btn = document.querySelector("#m-sv .btn-primary");
  const originalText = btn ? btn.textContent : '';
  if (btn) btn.textContent = 'Aguarde...';

  try {
    const p = STATE.pacientes.find(x => x.id === _svId);
    
    // 1. Salvar os Sinais Vitais no Histórico (podemos usar a coleção historico para isso ou relatorios, vou usar historico para ser mais direto)
    const svData = {
      tipo: 'Sinais Vitais',
      pac_id: _svId,
      pac_nome: p.nome,
      ala: p.ala,
      enfermeiro: currentUser.nome,
      pa: $('sv-pa').value,
      fc: $('sv-fc').value,
      temperatura: $('sv-temp').value,
      spo2: $('sv-spo2').value,
      observacoes: $('sv-obs').value,
      criado_em: fb.serverTimestamp()
    };
    
    await fb.db.collection("historico").add(svData);
    
    // 2. Atualizar o Próximo Sinais Vitais (Pula para o próximo turno 07h/19h)
    const prox = calcularProximoTurnoSV(new Date());
    await fb.db.collection("pacientes").doc(_svId).update({ proximo_sv: prox });
    
    cm('m-sv'); 
    toast('Sinais Vitais aferidos!','✓','success');
  } catch(e) {
    console.error("Erro em salvarSV:", e);
    toast("Erro ao salvar Sinais Vitais", '⚠', 'error');
  } finally {
    _isSavingSV = false;
    if (btn) btn.textContent = originalText;
  }
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

let _isSavingPac = false;
async function salvarPac(){
  if (_isSavingPac) return;
  
  const nome=$('p-nome').value.trim();
  const ala=$('p-ala').value;
  if(!nome||!ala){toast('Preencha nome e ala','⚠','error');return;}
  
  _isSavingPac = true;
  const btn = document.querySelector("#m-pac .btn-primary");
  const originalText = btn ? btn.textContent : '';
  if (btn) btn.textContent = 'Aguarde...';

  try {
    const pacData = {
      nome, ala,
      nascimento:$('p-nasc').value||null,
      diagnostico:$('p-diag').value,
      alergias:$('p-alerg').value||'NKDA',
      observacoes:$('p-obs').value||'',
      status: 'internado',
      admissao: new Date().toLocaleDateString('pt-BR'),
      proximo_sv: calcularProximoTurnoSV(new Date()),
      criado_em: fb.serverTimestamp()
    };
    await fb.db.collection("pacientes").add(pacData);
    
    await logAction('Admissão', nome, null, `Admitido na ala ${ala}`);
    
    ['p-nome','p-ala','p-alerg','p-obs'].forEach(i=>{const e=$(i);if(e)e.value='';});
    cm('m-pac'); toast(`${nome} admitido!`,'✓','ok');
  } catch(e) { 
    console.error(e);
    toast("Erro ao salvar paciente",'⚠','error'); 
  } finally {
    _isSavingPac = false;
    if (btn) btn.textContent = originalText;
  }
}

async function salvarAla(){
  const nome = $('a-nome').value.trim().toUpperCase();
  const descricao = $('a-desc').value.trim();
  if(!nome) { toast('Preencha o nome da ala', '⚠', 'error'); return; }
  
  if (STATE.alas.find(a => a.nome === nome)) {
    toast('Já existe uma ala com este nome', '⚠', 'error');
    return;
  }
  
  try {
    await fb.db.collection("alas").add({
      nome, descricao, ativa: true, criado_em: fb.serverTimestamp()
    });
    $('a-nome').value = ''; $('a-desc').value = '';
    cm('m-nova-ala');
    toast(`Ala ${nome} cadastrada!`, '🏥', 'ok');
  } catch(e) { toast("Erro ao cadastrar ala", '⚠', 'error'); }
}

async function toggleAla(id){
  try {
    const a = STATE.alas.find(x => x.id === id);
    await fb.db.collection("alas").doc(id).update({ ativa: !a.ativa });
    toast('Status da ala atualizado!', '✓', 'ok');
  } catch(e) { toast("Erro ao atualizar status", '⚠', 'error'); }
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
    const freq = $('rx-freq').value;
    const isAgora = freq.includes('AGORA');
    
    const rxData = {
      pac_id: pacId, pac_nome: pac.nome, ala: pac.ala,
      medicamento: med, via: $('rx-via').value,
      dose: $('rx-dose').value || '—', frequencia: freq,
      duracao: isAgora ? 'Dose Única' : ($('rx-dur').value || '—'),
      total_doses: isAgora ? 1 : null,
      proxima_dose: isAgora ? new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + 'h' : null,
      observacoes: $('rx-obs').value || '',
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
    <div class="pac-info">Ala ${p.ala} · ${dias(p.admissao)} dias internado</div></div></div>`;
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

function checkTimingStatus(proxima_dose) {
  if (!proxima_dose) return { isEarly: false, isLate: false, isLateOver15: false, diffMins: 0 };
  
  const [hStr, mStr] = proxima_dose.replace('h','').split(':');
  const targetH = parseInt(hStr, 10);
  const targetM = parseInt(mStr, 10);
  
  const now = new Date();
  const target = new Date();
  target.setHours(targetH, targetM, 0, 0);
  
  if (target.getTime() > now.getTime() + 12 * 60 * 60 * 1000) {
    target.setDate(target.getDate() - 1);
  } else if (target.getTime() < now.getTime() - 12 * 60 * 60 * 1000) {
    target.setDate(target.getDate() + 1);
  }
  
  const diffMs = now.getTime() - target.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  return {
    isEarly: diffMins < 0,
    isLate: diffMins > 0,
    isLateOver15: diffMins > 15,
    diffMins: diffMins
  };
}

function abrirDisp(id) {
  // Redireciona para o fluxo de lote com apenas um ID
  const p = STATE.prescricoes.find(x => x.id === id);
  if (p) abrirDispLote(p.pac_id, [id]);
}

function abrirDispLote(pacId, specificIds = null) {
  const pac = STATE.pacientes.find(x => x.id === pacId);
  if (specificIds) {
    _loteIds = specificIds;
  } else {
    const checks = document.querySelectorAll(`.check-pac-${pacId}:checked`);
    _loteIds = Array.from(checks).map(c => c.value);
  }
  
  if (_loteIds.length === 0) return toast('Selecione ao menos um medicamento!', '⚠️', 'warn');
  
  const meds = _loteIds.map(id => STATE.prescricoes.find(x => x.id === id));
  _loteIsLate = meds.some(m => checkTimingStatus(m.proxima_dose).isLateOver15);
  
  let bodyHTML = `
    <div class="alert a-warn">⚠️ Alergias: <strong>${pac?.alergias||'NKDA'}</strong></div>
    <div style="margin:10px 0; font-size:13px; color:var(--text3)">Dispensando <strong>${_loteIds.length}</strong> item(ns) para:</div>
    <div class="pac-hdr" style="margin-bottom:15px"><div class="pac-av">${pac.nome[0]}</div><div><div class="pac-name">${pac.nome}</div><div class="pac-info">${pac.ala} · Data: ${new Date().toLocaleDateString('pt-BR')}</div></div></div>
    <div style="max-height: 200px; overflow-y: auto; background: var(--bg2); border-radius: 8px; padding: 10px; border: 1px solid var(--border)">
      ${meds.map(m => `<div style="padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 12px;">💊 ${m.medicamento} (${m.dose})</div>`).join('')}
    </div>`;

  if (_loteIsLate) {
    bodyHTML += `
      <div class="alert a-error" style="margin-top:12px">⏰ <strong>Atraso Detectado:</strong> Algumas medicações estão atrasadas. Justificativa obrigatória:</div>
      <div class="fgrp ff" style="margin-top:8px"><input class="fi" id="lote-justif" placeholder="Motivo do atraso para este lote" style="border-color:var(--red)"/></div>`;
  }

  $('disp-body').innerHTML = bodyHTML;
  const btnConf = document.querySelector("#m-disp .btn-green");
  if (btnConf) {
    btnConf.onclick = confirmarDispLote;
    btnConf.textContent = '✓ Confirmar Dispensação';
  }
  om('m-disp');
}

async function confirmarDispLote() {
  if (_isDispensing) return;
  
  let justificativa = '';
  if (_loteIsLate) {
    const el = $('lote-justif');
    if (!el || !el.value.trim()) return toast('Justificativa de atraso é obrigatória!', '⚠', 'error');
    justificativa = ` [ATRASO EM LOTE: ${el.value.trim()}]`;
  }

  _isDispensing = true;
  const btn = document.querySelector("#m-disp .btn-green");
  if (btn) btn.textContent = 'Aguarde...';

  try {
    const batch = fb.db.batch();
    for (const id of _loteIds) {
      const p = STATE.prescricoes.find(x => x.id === id);
      const ref = fb.db.collection("prescricoes").doc(id);
      batch.update(ref, { status: 'dispensada' });
      
      // Log individual no histórico (para auditoria completa)
      const logData = {
        tipo: 'Dispensação',
        pac_nome: p.pac_nome,
        medicamento: p.medicamento,
        responsavel: currentUser.nome,
        observacoes: `Liberado em Lote${justificativa}`,
        criado_em: fb.serverTimestamp()
      };
      await fb.db.collection("historico").add(logData);
    }
    await batch.commit();
    
    cm('m-disp'); toast(`${_loteIds.length} medicamentos dispensados!`,'💊','ok');
  } catch(e) { 
    console.error(e);
    toast("Erro ao dispensar lote",'⚠','error'); 
  } finally {
    _isDispensing = false;
    if (btn) btn.textContent = '✓ Dispensar';
  }
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
      pac_id: pacId, pac_nome: pac.nome, ala: pac.ala,
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
    <div class="pac-info">Ala ${p.ala} · ${dias(p.admissao)} dias internado</div></div></div>
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
    <div><div class="pac-name">${p.pac_name}</div><div class="pac-info">Ala ${p.ala} · ${p.id}</div></div>
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
        ala: p.ala,
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
      // Evita carregar duas vezes se já estiver dentro
      if ($('app').style.display === 'flex' && currentUser) return;
      
      const userDoc = await fb.db.collection("funcionarios").doc(user.email).get();
      if (userDoc.exists) {
        currentUser = userDoc.data();
        currentUser.id = user.uid;
        await entrarNoSistema();
      } else if (user.email === "alefdias44@cejam.com") {
        // Cria perfil automático para o administrador mestre
        currentUser = { id: user.uid, nome: "Alef Dias", email: user.email, cargo: "admin", ativo: true, primeiro_acesso: false };
        await fb.db.collection("funcionarios").doc(user.email).set({ ...currentUser, criado_em: fb.serverTimestamp() });
        await entrarNoSistema();
      } else {
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
  confirmarAlta, confirmarDispLote, confirmarAdmLote, salvarRelat,
  calcularPedidoFarmacia, imprimirPedido, exportarPedidoPDF,
  filtrarTabelaPacientes,
  salvarFunc, gerarSenhaAuto, abrirPerfilPaciente, abrirAlta,
  verRx, imprimirPrescricaoPDF,
  abrirAlterarRx, filtRx, toggleFunc, abrirPerfilFunc, confirmarAlterarSenhaManual,
  salvarNovaSenha, applyTheme, abrirAdm, abrirDisp, limparNotificacoes, marcarLida,
  abrirRelat, verRelatsPac, aplicarFiltroConsumo, salvarAla, toggleAla, abrirSV, salvarSV, abrirDispLote, abrirAdmLote, togglePacCheck, confirmarAlaTrabalho
});

// Inicialização
window.addEventListener('DOMContentLoaded', () => {
  console.log("🚀 Cejam App iniciado");
  
  // Garantir que os botões funcionem mesmo com módulos
  const btnLogin = $('btn-login');
  if (btnLogin) btnLogin.onclick = doLogin;

  const btnLogout = document.querySelector('button[onclick="doLogout()"]');
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
  
  const savedTheme = localStorage.getItem('cejam_theme');
  if(savedTheme) applyTheme(savedTheme);
});
