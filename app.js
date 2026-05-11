

/* =========================================================
   API CONFIG (SQL BACKEND)
   ========================================================= */
const API = 'http://localhost:3000/api';

/* =========================================================
   STATE
   ========================================================= */
const S = {
  user: null, role: 'admin', cid: null, v: 'dashboard',
  fbReady: true, db: null, auth: null, fbError: '', // Now reusing fbReady for API status
  company: { name:'My Company', address:'', phone:'', email:'', taxId:'', currency:'AED', accent:'#d97706' },
  users:[], vendors:[], clients:[], quotations:[], lpos:[], grns:[], invoices:[], payments:[]
};

/* =========================================================
   UTILITIES
   ========================================================= */
const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2,5);
const fm = n => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fd = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const td = () => new Date().toISOString().split('T')[0];
const dd = (d=30) => { const x=new Date(); x.setDate(x.getDate()+d); return x.toISOString().split('T')[0] };
const sv = (k,v) => { try { localStorage.setItem('bf_'+k, JSON.stringify(v)) } catch(e){} };
const ld = k => { try { return JSON.parse(localStorage.getItem('bf_'+k)) } catch(e){ return null } };

function toast(m, t='s') {
  const c = document.getElementById('TC');
  if (!c) return;
  const ic = {s:'fa-check-circle',e:'fa-exclamation-circle',i:'fa-info-circle',w:'fa-exclamation-triangle'};
  const x = document.createElement('div');
  x.className = 'tt tt-' + (t==='e'?'e':t==='w'?'w':t==='i'?'i':'s');
  x.innerHTML = '<i class="fas ' + (ic[t]||ic.s) + '"></i><span>' + m + '</span>';
  c.appendChild(x);
  setTimeout(() => { x.style.opacity='0'; x.style.transform='translateX(100%)'; x.style.transition='.3s'; setTimeout(()=>x.remove(),300) }, 3200);
}

function oM(h) { document.getElementById('MC').innerHTML=h; document.getElementById('MO').classList.add('sh') }
function cM() { document.getElementById('MO').classList.remove('sh') }

function tg(s) {
  const m = {draft:'tg-d',pending:'tg-p',approved:'tg-a',rejected:'tg-r',sent:'tg-s',accepted:'tg-a',received:'tg-rc',partially_received:'tg-pa',unpaid:'tg-u',paid:'tg-a',partial:'tg-pa',overdue:'tg-od',awaiting_delivery:'tg-s',confirmed:'tg-a',revision:'tg-r'};
  const l = {partially_received:'Partial',awaiting_delivery:'Awaiting',draft:'Draft',pending:'Pending',approved:'Approved',rejected:'Rejected',sent:'Sent',accepted:'Accepted',received:'Received',unpaid:'Unpaid',paid:'Paid',partial:'Partial',overdue:'Overdue',confirmed:'Confirmed',revision:'Revision'};
  return '<span class="tg '+(m[s]||'tg-d')+'">'+(l[s]||s)+'</span>';
}

function saveAll() {
  sv('company',S.company); sv('vendors',S.vendors); sv('clients',S.clients);
  sv('quotations',S.quotations); sv('lpos',S.lpos); sv('grns',S.grns);
  sv('invoices',S.invoices); sv('payments',S.payments); sv('users',S.users);
}

async function persist(table, data) {
  saveAll(); // Keep local storage as a cache
  if (!S.cid) return;
  
  if (table && data) {
    // Single item update
    try {
      await fetch(`${API}/${table}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...data, company_id: S.cid})
      });
    } catch(e) { console.error('SQL Sync Error:', e) }
  } else {
    // Full sync (rarely used now)
    console.log('Full sync requested');
  }
}

function persistAll() {
  saveAll();
  const collections = ['vendors', 'clients', 'quotations', 'lpos', 'grns', 'invoices', 'payments', 'users'];
  collections.forEach(col => {
    S[col].forEach(d => persist(col, d));
  });
  persist('company', S.company);
}
function logAudit(doc_id, action, status, comment='') {
  const log = {
    id: uid(), doc_id, user_name: S.user.name, 
    action, status, comment, timestamp: new Date().toISOString(), 
    company_id: S.cid
  };
  S.audit = S.audit || [];
  S.audit.push(log);
  persist('audit', log);
}
function checkOverdue() {
  const t = td();
  S.invoices.forEach(i => { if ((i.status==='unpaid'||i.status==='partial') && i.dueDate && i.dueDate < t) i.status='overdue' });
}

/* =========================================================
   FIREBASE INIT - BULLETPROOF
   ========================================================= */
function initFB() {
  // Reusing this for API check
  fetch(`${API}/users?cid=primary`)
    .then(() => { S.fbReady = true; console.log('SQL Backend connected') })
    .catch(e => { 
      S.fbReady = false; 
      S.fbError = 'Cannot connect to SQL backend. Make sure npm start is running.';
      console.warn(S.fbError);
    });
  return true;
}

async function loadCloudData() {
  if (S.cid) {
    try {
      const resp = await fetch(`${API}/company/${S.cid}`);
      if (resp.ok) S.company = await resp.json();
      
      const tables = ['vendors', 'clients', 'quotations', 'lpos', 'grns', 'invoices', 'payments', 'users', 'audit'];
      for (const t of tables) {
        const r = await fetch(`${API}/${t}?cid=${S.cid}`);
        if (r.ok) S[t] = await r.json();
      }
    } catch(e) { console.error('SQL load error:', e) }
  }
  checkOverdue();
}

/* =========================================================
   AUTHENTICATION
   ========================================================= */
async function doLogin(e, p) {
  // Master Admin Bypass (Local Logic)
  if (e === 'admin@admin.com' && p === '123ewqasd') {
    const u = {id:'admin_primary', name:'System Admin', email:'admin@admin.com', role:'admin', companyId:'primary'};
    S.user = u; S.role = u.role; S.cid = u.companyId;
    sv('session', {email:e, cid:'primary'});
    await loadCloudData();
    return true;
  }
  if (e === 'johns@admin.com' && p === '123ewqasd') {
    const u = {id:'admin_johns', name:'John Admin', email:'johns@admin.com', role:'admin', company_id:'primary'};
    S.user = u; S.role = u.role; S.cid = u.company_id;
    sv('session', {email:e, cid:'primary'});
    await loadCloudData();
    return true;
  }

  try {
    const r = await fetch(`${API}/login`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email:e, password:p})
    });
    if (r.ok) {
      const u = await r.json();
      S.user = u; S.role = u.role; S.cid = u.company_id || u.companyId;
      sv('session', {email:e, cid: S.cid});
      await loadCloudData();
      return true;
    } else {
      toast('Invalid email or password', 'e');
      return false;
    }
  } catch(x) {
    toast('Server connection failed', 'e');
    return false;
  }
}

async function doRegister(n, e, p, r) {
  try {
    const ci = uid();
    const u = {id: uid(), name:n, email:e, password:p, role:r, company_id:ci};
    const comp = {id:ci, name:n+"'s Company", email:e, currency:'AED', accent:'#d97706'};
    
    await fetch(`${API}/company`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(comp) });
    await fetch(`${API}/users`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(u) });
    
    S.user = u; S.role = r; S.cid = ci;
    sv('session', {email:e, cid:ci});
    return true;
  } catch(x) {
    toast('Registration failed', 'e');
    return false;
  }
}

function doLogout() {
  S.user = null; sv('session', null);
  render();
}

/* =========================================================
   NAVIGATION
   ========================================================= */
const NAV = [
  {s:'Overview', i:[{id:'dashboard',ic:'fa-chart-line',l:'Dashboard'}]},
  {s:'People', i:[{id:'vendors',ic:'fa-truck',l:'Vendors'},{id:'clients',ic:'fa-building',l:'Clients'}]},
  {s:'Sales', i:[{id:'quotations',ic:'fa-file-alt',l:'Quotations'},{id:'invoices',ic:'fa-file-invoice-dollar',l:'Invoices'}]},
  {s:'Procurement', i:[{id:'lpos',ic:'fa-shopping-cart',l:'Purchase Orders'},{id:'grns',ic:'fa-boxes-stacked',l:'Goods Received'}]},
  {s:'Admin', r:['admin'], i:[{id:'company',ic:'fa-cog',l:'Company Profile'},{id:'users',ic:'fa-users',l:'User Management'},{id:'settings',ic:'fa-sliders',l:'Settings'}]}
];

function nav(v) {
  S.v = v; rc();
  document.getElementById('SB')?.classList.remove('mopen');
  document.getElementById('OV')?.classList.remove('sh');
}
function tmSb() {
  document.getElementById('SB')?.classList.toggle('mopen');
  document.getElementById('OV')?.classList.toggle('sh');
}

/* =========================================================
   AUTH SCREEN
   ========================================================= */
function rAuth() {
  const fbStatus = S.fbReady
    ? '<span style="color:var(--ok)"><i class="fas fa-circle" style="font-size:6px;vertical-align:middle"></i> Firebase Connected</span>'
    : '<span style="color:#94a3b8"><i class="fas fa-circle" style="font-size:6px;vertical-align:middle"></i> Offline Mode</span>';

  document.getElementById('AP').innerHTML = `
  <div class="ab"><div style="width:420px;max-width:95%;position:relative;z-index:1">
    <div class="fu" style="text-align:center;margin-bottom:28px">
      <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:6px">
        <div style="width:42px;height:42px;background:var(--ac);border-radius:9px;display:flex;align-items:center;justify-content:center">
          <i class="fas fa-bolt" style="color:#fff;font-size:18px"></i>
        </div>
        <span class="bf" style="font-size:28px;color:#fff;font-weight:800">FinProx</span>
      </div>
      <p style="color:#94a3b8;font-size:13px">Business Management System</p>
    </div>
    <div class="fu" style="animation-delay:.1s;background:rgba(255,255,255,0.95);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.2);border-radius:18px;padding:32px;box-shadow:0 24px 80px rgba(0,0,0,0.3)" id="AF"></div>
    ${S.fbError ? '<div class="fu" style="animation-delay:.2s;margin-top:16px;padding:12px 18px;background:rgba(255,255,255,0.05);border-radius:10px;font-size:12px;color:#94a3b8"><i class="fas fa-info-circle"></i> ' + S.fbError + '</div>' : ''}
  </div></div>`;
  showLogin();
}

function showLogin() {
  const af = document.getElementById('AF');
  if (!af) return;
  af.innerHTML = `
    <h2 style="font-size:20px;font-weight:800;margin-bottom:3px">Welcome back</h2>
    <p style="color:var(--mt);font-size:13px;margin-bottom:20px">Sign in to your account</p>
    <div style="margin-bottom:14px">
      <label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:4px">Email</label>
      <input class="ip" id="le" type="email" placeholder="you@company.com">
    </div>
    <div style="margin-bottom:20px">
      <label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:4px">Password</label>
      <input class="ip" id="lp" type="password" placeholder="Enter password">
    </div>
    <div id="loginErr"></div>
    <button class="bt bp" style="width:100%;justify-content:center;padding:11px" onclick="hLogin()">
      <i class="fas fa-arrow-right"></i> Sign In
    </button>
    <p style="text-align:center;margin-top:14px;font-size:12px;color:var(--mt)">
      No account? <a href="#" onclick="showReg();return false" style="color:var(--ac);font-weight:600;text-decoration:none">Create one</a>
    </p>`;
  // Enter key support
  setTimeout(() => {
    const lpEl = document.getElementById('lp');
    if (lpEl) lpEl.addEventListener('keydown', e => { if (e.key === 'Enter') hLogin() });
  }, 50);
}

function showReg() {
  const af = document.getElementById('AF');
  if (!af) return;
  af.innerHTML = `
    <h2 style="font-size:20px;font-weight:800;margin-bottom:3px">Create account</h2>
    <p style="color:var(--mt);font-size:13px;margin-bottom:20px">${S.fbReady ? 'Account will be created in Firebase' : 'Local account (offline mode)'}</p>
    <div style="margin-bottom:14px">
      <label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:4px">Full Name</label>
      <input class="ip" id="rn" placeholder="John Smith">
    </div>
    <div style="margin-bottom:14px">
      <label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:4px">Email</label>
      <input class="ip" id="re" type="email" placeholder="you@company.com">
    </div>
    <div style="margin-bottom:14px">
      <label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Password</label>
      <input class="ip" id="rp" type="password" placeholder="Min 6 characters">
    </div>
    <div style="margin-bottom:20px">
      <label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Role</label>
      <select class="ip" id="rr"><option value="admin">Admin</option><option value="manager">Manager</option><option value="staff">Staff</option></select>
    </div>
    <div id="regErr"></div>
    <button class="bt bp" style="width:100%;justify-content:center;padding:11px" onclick="hReg()">
      <i class="fas fa-user-plus"></i> Create Account
    </button>
    <p style="text-align:center;margin-top:14px;font-size:12px;color:var(--mt)">
      Have an account? <a href="#" onclick="showLogin();return false" style="color:var(--ac);font-weight:600;text-decoration:none">Sign in</a>
    </p>`;
}

async function hLogin() {
  const e = document.getElementById('le')?.value || '';
  const p = document.getElementById('lp')?.value || '';
  if (!e || !p) {
    const el = document.getElementById('loginErr');
    if (el) el.innerHTML = '<div class="err-box"><i class="fas fa-exclamation-circle"></i> Please enter email and password</div>';
    return;
  }
  const ok = await doLogin(e, p);
  if (ok) { toast('Welcome back!'); render() }
}

async function hReg() {
  const n = document.getElementById('rn')?.value || '';
  const e = document.getElementById('re')?.value || '';
  const p = document.getElementById('rp')?.value || '';
  const r = document.getElementById('rr')?.value || 'admin';
  if (!n || !e || !p) {
    const el = document.getElementById('regErr');
    if (el) el.innerHTML = '<div class="err-box"><i class="fas fa-exclamation-circle"></i> Please fill all fields</div>';
    return;
  }
  if (p.length < 6) {
    const el = document.getElementById('regErr');
    if (el) el.innerHTML = '<div class="err-box"><i class="fas fa-exclamation-circle"></i> Password must be at least 6 characters</div>';
    return;
  }
  const ok = await doRegister(n, e, p, r);
  if (ok) { toast('Account created!'); render() }
}

/* =========================================================
   DEMO LOGIN - GUARANTEED TO WORK
   ========================================================= */
function demoLogin() {
  try {
    // Clear all local data arrays
    S.vendors = []; S.clients = []; S.quotations = []; 
    S.lpos = []; S.grns = []; S.invoices = []; S.payments = [];
    
    // Set requested admin credentials
    S.user = {id:'admin_primary', name:'System Admin', email:'admin@admin.com', role:'admin', companyId:'primary'};
    S.users = [S.user];
    S.role = 'admin'; S.cid = 'primary';
    
    // Default company profile
    S.company = {name:'FinProx Admin', address:'Primary Operations', phone:'', email:'admin@admin.com', taxId:'ADM-001', currency:'AED', accent:'#d97706'};
    
    // Persist clean state
    saveAll();
    sv('session', {email:'admin@admin.com', demo:true});
    
    toast('Data reset. Logged in as Admin.');
    render();
  } catch(e) {
    console.error('Reset error:', e);
    alert('Reset error: ' + e.message);
  }
}

/* =========================================================
   MAIN APP RENDER
   ========================================================= */
function render() {
  if (!S.user) { rAuth(); return }

  // Role-based navigation filtering
  const getAllowedSections = () => {
    const baseNav = [
      {s:'Overview', i:[{id:'dashboard',ic:'fa-chart-line',l:'Dashboard'}]},
      {s:'People', i:[{id:'vendors',ic:'fa-truck',l:'Vendors'},{id:'clients',ic:'fa-building',l:'Clients'}]},
      {s:'Sales', i:[{id:'quotations',ic:'fa-file-alt',l:'Quotations'},{id:'invoices',ic:'fa-file-invoice-dollar',l:'Invoices'}]},
      {s:'Procurement', i:[{id:'lpos',ic:'fa-shopping-cart',l:'Purchase Orders'},{id:'grns',ic:'fa-boxes-stacked',l:'Goods Received'}]},
      {s:'Admin', r:['admin'], i:[{id:'company',ic:'fa-cog',l:'Company Profile'},{id:'users',ic:'fa-users',l:'User Management'},{id:'settings',ic:'fa-sliders',l:'Settings'}]}
    ];

    if (S.role === 'staff') {
      // Staff only see limited modules, but they see all company data in those modules
      return [
        {s:'Overview', i:[{id:'dashboard',ic:'fa-chart-line',l:'Dashboard'}]},
        {s:'Operations', i:[{id:'quotations',ic:'fa-file-alt',l:'Quotations'},{id:'invoices',ic:'fa-file-invoice-dollar',l:'Invoices'},{id:'lpos',ic:'fa-shopping-cart',l:'Purchase Orders'},{id:'grns',ic:'fa-boxes-stacked',l:'Goods Received'}]},
        {s:'People', i:[{id:'vendors',ic:'fa-truck',l:'Vendors'},{id:'clients',ic:'fa-building',l:'Clients'}]},
      ];
    }

    return baseNav;
  };

  const nh = getAllowedSections().map(s => {
    if (s.r && !s.r.includes(S.role)) return '';
    return '<div class="ns">' + s.s + '</div>' +
      s.i.map(x => '<div class="ni ' + (S.v===x.id?'a':'') + '" onclick="nav(\'' + x.id + '\')"><i class="fas ' + x.ic + '" style="width:18px;text-align:center"></i><span class="nl">' + x.l + '</span></div>').join('');
  }).join('');

  document.getElementById('AP').innerHTML = `
  <div class="sb" id="SB">
    <div style="padding:18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,.06)">
      <div style="width:34px;height:34px;background:var(--ac);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-bolt" style="color:#fff;font-size:15px"></i></div>
      <span class="nl" style="font-size:15px;font-weight:800;color:#fff;white-space:nowrap">FinProx</span>
    </div>
    <div style="padding:6px 0;flex:1">${nh}</div>
    <div style="padding:14px;border-top:1px solid rgba(255,255,255,.06)">
      <div class="nl" style="display:flex;align-items:center;gap:9px;cursor:pointer" onclick="doLogout()">
        <div style="width:30px;height:30px;background:var(--gw);border-radius:7px;display:flex;align-items:center;justify-content:center"><i class="fas fa-user" style="color:var(--ac);font-size:11px"></i></div>
        <div style="flex:1;min-width:0"><div style="color:#e2e8f0;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${S.user.name}</div><div style="color:#64748b;font-size:10px;text-transform:capitalize">${S.role}</div></div>
        <i class="fas fa-right-from-bracket" style="color:#64748b;font-size:11px"></i>
      </div>
    </div>
  </div>
  <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column">
    <div style="background:#fff;border-bottom:1px solid var(--bd);padding:10px 22px;display:flex;align-items:center;gap:10px;flex-shrink:0">
      <button onclick="tmSb()" style="display:none;background:none;border:none;font-size:16px;color:var(--tx);cursor:pointer" id="mb"><i class="fas fa-bars"></i></button>
      <h2 style="font-size:17px;font-weight:800;flex:1" id="VT"></h2>
      <div id="VA"></div>
    </div>
    <div style="flex:1;overflow-y:auto;padding:22px" id="CA"></div>
  </div>`;

  const mb = document.getElementById('mb');
  if (mb) mb.style.display = window.innerWidth < 768 ? 'block' : 'none';
  rc();
}

function rc() {
  const t = document.getElementById('VT'), a = document.getElementById('VA'), c = document.getElementById('CA');
  if (!t || !c) return;
  const V = {dashboard:vDash,vendors:vVendors,clients:vClients,quotations:vQuotes,lpos:vLpos,grns:vGrns,invoices:vInv,company:vComp,users:vUsers,settings:vSet};
  const T = {dashboard:'Dashboard',vendors:'Vendors',clients:'Clients',quotations:'Quotations',lpos:'Purchase Orders',grns:'Goods Received',invoices:'Invoices',company:'Company Profile',users:'User Management',settings:'Settings'};
  t.textContent = T[S.v] || 'Dashboard'; a.innerHTML = '';
  try { if (V[S.v]) V[S.v](c,a); else c.innerHTML = '<p>Not found</p>'; } catch(e) { c.innerHTML = '<p>Error: '+e.message+'</p>'; console.error(e); }
  document.querySelectorAll('.ni').forEach(el => { el.classList.toggle('a', el.getAttribute('onclick')?.includes("'"+S.v+"'")) });
}

/* =========================================================
   DASHBOARD
   ========================================================= */
function vDash(e) {
  // All roles see company-wide data (Global visibility)
  const mq = S.quotations;
  const ml = S.lpos;

  // Full financial overview only for admin/manager
  const cur = S.company.currency;

  if (S.role === 'finance') {
    const unp = S.invoices.filter(i=>['unpaid','partial','overdue'].includes(i.status));
    const od = S.invoices.filter(i=>i.status==='overdue');
    const tot = unp.reduce((s,i)=>s+(i.total-i.paidAmount), 0);
    e.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px">'+
      '<div class="cd fu"><div style="font-size:12px;color:var(--mt);font-weight:600">Accounts Receivable</div><div style="font-size:24px;font-weight:800;margin:6px 0">'+cur+' '+fm(tot)+'</div><div style="font-size:11px;color:var(--mt)">'+unp.length+' Pending Invoices</div></div>'+
      '<div class="cd fu" style="border-left:4px solid var(--no)"><div style="font-size:12px;color:var(--mt);font-weight:600">Overdue Amount</div><div style="font-size:24px;font-weight:800;margin:6px 0;color:var(--no)">'+cur+' '+fm(od.reduce((s,i)=>s+(i.total-i.paidAmount),0))+'</div><div style="font-size:11px;color:var(--mt)">'+od.length+' Overdue Documents</div></div>'+
      '</div><div class="cd" style="margin-top:16px"><h4 style="font-size:14px;font-weight:800;margin-bottom:12px">Action Required</h4>'+
      (unp.length ? unp.sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate)).slice(0,10).map(i=>'<div style="display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid var(--bd);align-items:center"><div><div style="font-size:13px;font-weight:700">'+i.id+' — '+i.clientName+'</div><div style="font-size:11px;color:var(--mt)">Due: '+fd(i.dueDate)+'</div></div>'+tg(i.status)+'</div>').join('') : '<p style="text-align:center;padding:20px;color:var(--mt)">No pending actions</p>')+
      '</div>';
    return;
  }

  const oi = isAdminOrManager ? S.invoices.filter(i=>i.status==='overdue') : [];
  const ut = isAdminOrManager ? S.invoices.filter(i=>['unpaid','partial','overdue'].includes(i.status)).reduce((s,i)=>s+i.total-(i.paidAmount||0),0) : 0;
  const pt = isAdminOrManager ? S.payments.reduce((s,p)=>s+p.amount,0) : 0;
  const pq = isAdminOrManager ? S.quotations.filter(q=>q.status==='pending').length : 0;
  const ol = isAdminOrManager ? S.lpos.filter(l=>['sent','awaiting_delivery'].includes(l.status)).length : 0;


  const financialOverview = isAdminOrManager ? `
  <div class="grd" style="margin-bottom:20px">
    <div class="cd kc am fu"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span style="font-size:11px;font-weight:600;color:var(--mt);text-transform:uppercase;letter-spacing:.5px">Revenue Collected</span><div style="width:34px;height:34px;background:#fef3c7;border-radius:7px;display:flex;align-items:center;justify-content:center"><i class="fas fa-coins" style="color:var(--ac);font-size:13px"></i></div></div><div style="font-size:26px;font-weight:900;letter-spacing:-1px">${cur} ${fm(pt)}</div><div style="font-size:11px;color:var(--ok);margin-top:3px"><i class="fas fa-arrow-up"></i> Payments received</div></div>
    <div class="cd kc rd fu" style="animation-delay:.05s"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span style="font-size:11px;font-weight:600;color:var(--mt);text-transform:uppercase;letter-spacing:.5px">Outstanding</span><div style="width:34px;height:34px;background:#fee2e2;border-radius:7px;display:flex;align-items:center;justify-content:center"><i class="fas fa-exclamation-triangle" style="color:var(--no);font-size:13px"></i></div></div><div style="font-size:26px;font-weight:900;letter-spacing:-1px">${cur} ${fm(ut)}</div><div style="font-size:11px;color:var(--no);margin-top:3px">${oi.length} overdue</div></div>
    <div class="cd kc cy fu" style="animation-delay:.1s"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span style="font-size:11px;font-weight:600;color:var(--mt);text-transform:uppercase;letter-spacing:.5px">Pending Quotes</span><div style="width:34px;height:34px;background:#cffafe;border-radius:7px;display:flex;align-items:center;justify-content:center"><i class="fas fa-file-alt" style="color:var(--info);font-size:13px"></i></div></div><div style="font-size:26px;font-weight:900;letter-spacing:-1px">${pq}</div><div style="font-size:11px;color:var(--info);margin-top:3px">Awaiting review</div></div>
    <div class="cd kc gr fu" style="animation-delay:.15s"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span style="font-size:11px;font-weight:600;color:var(--mt);text-transform:uppercase;letter-spacing:.5px">Open LPOs</span><div style="width:34px;height:34px;background:#d1fae5;border-radius:7px;display:flex;align-items:center;justify-content:center"><i class="fas fa-truck" style="color:var(--ok);font-size:13px"></i></div></div><div style="font-size:26px;font-weight:900;letter-spacing:-1px">${ol}</div><div style="font-size:11px;color:var(--ok);margin-top:3px">Awaiting delivery</div></div>
  </div>
  ${oi.length ? '<div class="cd fu" style="background:#7f1d1d;color:#fecaca;border:1px solid #991b1b;margin-bottom:18px;padding:14px 18px;display:flex;align-items:center;gap:10px"><i class="fas fa-bell pls" style="font-size:16px"></i><div style="flex:1"><strong>'+oi.length+' Overdue:</strong> '+oi.map(i=>i.id).join(', ')+'</div><button class="bt bsm" style="background:#991b1b;color:#fecaca;border:1px solid #b91c1c" onclick="nav(\'invoices\')">View</button></div>' : ''}` : '';

  const staffMessage = isStaff ? '<div class="cd fu" style="background:#e0f2fe;color:#0277bd;border:1px solid #0277bd;margin-bottom:18px;padding:14px 18px"><i class="fas fa-info-circle" style="font-size:16px;margin-right:10px"></i><div><strong>Staff Access:</strong> You can view and manage documents assigned to you. Contact your manager for broader access.</div></div>' : '';

  e.innerHTML = financialOverview + staffMessage + `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div class="cd fu" style="animation-delay:.2s"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h3 style="font-size:14px;font-weight:700">Recent Quotations</h3><button class="bt bs bsm" onclick="nav('quotations')">All</button></div>${mq.length ? mq.slice(0,5).map(q=>'<div class="tr" style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd);gap:10px"><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600">'+q.id+'</div><div style="font-size:11px;color:var(--mt)">'+q.clientName+'</div></div><div style="text-align:right"><div style="font-size:12px;font-weight:600">'+cur+' '+fm(q.total)+'</div>'+tg(q.status)+'</div></div>').join('') : '<p style="color:var(--mt);font-size:12px;padding:10px 0">None yet</p>'}</div>
    <div class="cd fu" style="animation-delay:.25s"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h3 style="font-size:14px;font-weight:700">Recent LPOs</h3><button class="bt bs bsm" onclick="nav('lpos')">All</button></div>${ml.length ? ml.slice(0,5).map(l=>'<div class="tr" style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd);gap:10px"><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600">'+l.id+'</div><div style="font-size:11px;color:var(--mt)">'+l.vendorName+'</div></div><div style="text-align:right"><div style="font-size:12px;font-weight:600">'+cur+' '+fm(l.total)+'</div>'+tg(l.status)+'</div></div>').join('') : '<p style="color:var(--mt);font-size:12px;padding:10px 0">None yet</p>'}</div>
  </div>
  <div class="cd fu" style="margin-top:16px;animation-delay:.3s"><h3 style="font-size:14px;font-weight:700;margin-bottom:14px">Recent Payments</h3>${S.payments.length ? '<table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:2px solid var(--bd)"><th style="text-align:left;padding:7px 10px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Invoice</th><th style="text-align:left;padding:7px 10px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Amount</th><th style="text-align:left;padding:7px 10px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Method</th><th style="text-align:left;padding:7px 10px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Date</th></tr></thead><tbody>'+S.payments.slice(-5).reverse().map(p=>'<tr class="tr" style="border-bottom:1px solid var(--bd)"><td style="padding:8px 10px;font-size:12px;font-weight:600">'+p.invoiceId+'</td><td style="padding:8px 10px;font-size:12px;font-weight:600;color:var(--ok)">'+cur+' '+fm(p.amount)+'</td><td style="padding:8px 10px;font-size:12px">'+p.method+'</td><td style="padding:8px 10px;font-size:12px;color:var(--mt)">'+fd(p.date)+'</td></tr>').join('')+'</tbody></table>' : '<p style="color:var(--mt);font-size:12px;padding:10px 0">None yet</p>'}</div>`;
}

/* =========================================================
   VENDORS
   ========================================================= */
function vVendors(e,a){
  const canEdit = ['admin','manager'].includes(S.role);
  a.innerHTML= canEdit ? '<button class="bt bp" onclick="vForm()"><i class="fas fa-plus"></i> Add Vendor</button>' : '';
  const vendors = S.vendors; // Staff can view all vendors (read-only)
  e.innerHTML='<div style="margin-bottom:14px"><input class="ip" placeholder="Search vendors..." oninput="fTbl(\'vT\',this.value)" style="max-width:280px"></div><div class="cd" style="padding:0;overflow:hidden"><table style="width:100%;border-collapse:collapse" id="vT"><thead><tr style="background:#f8fafc;border-bottom:2px solid var(--bd)"><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Vendor</th><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Email</th><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Phone</th>'+(canEdit?'<th style="text-align:right;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Actions</th>':'')+'</tr></thead><tbody>'+vendors.map(v=>'<tr class="tr" style="border-bottom:1px solid var(--bd)" data-n="'+v.name.toLowerCase()+'"><td style="padding:10px 14px"><div style="font-weight:600;font-size:13px">'+v.name+'</div><div style="font-size:11px;color:var(--mt)">'+(v.address||'')+'</div></td><td style="padding:10px 14px;font-size:12px">'+v.email+'</td><td style="padding:10px 14px;font-size:12px">'+(v.phone||'—')+'</td>'+(canEdit?'<td style="padding:10px 14px;text-align:right"><button class="bt bs bsm" onclick="vForm(\''+v.id+'\')"><i class="fas fa-edit"></i></button> <button class="bt bdd bsm" onclick="delV(\''+v.id+'\')"><i class="fas fa-trash"></i></button></td>':'')+'</tr>').join('')+'</tbody></table>'+( !vendors.length?'<div style="padding:30px;text-align:center;color:var(--mt)"><i class="fas fa-truck" style="font-size:28px;opacity:.3;margin-bottom:6px"></i><p>No vendors yet</p></div>':'')+'</div>'}

function vForm(id){const v=id?S.vendors.find(x=>x.id===id):null;oM('<div style="padding:22px"><h3 style="font-size:17px;font-weight:800;margin-bottom:18px">'+(v?'Edit':'Add')+' Vendor</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div style="grid-column:span 2"><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Company Name *</label><input class="ip" id="vn" value="'+(v?v.name:'')+'"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Email *</label><input class="ip" id="ve" type="email" value="'+(v?v.email:'')+'"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Phone</label><input class="ip" id="vp" value="'+(v?v.phone||'':'')+'"></div><div style="grid-column:span 2"><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Address</label><input class="ip" id="va" value="'+(v?v.address||'':'')+'"></div></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="bt bs" onclick="cM()">Cancel</button><button class="bt bp" onclick="svV(\''+(id||'')+'\')"><i class="fas fa-save"></i> Save</button></div></div>')}

function svV(id){const n=document.getElementById('vn').value.trim(),em=document.getElementById('ve').value.trim();if(!n||!em){toast('Name & email required','e');return}const d={name:n,email:em,phone:document.getElementById('vp').value.trim(),address:document.getElementById('va').value.trim()};if(id){const i=S.vendors.findIndex(v=>v.id===id);if(i>=0){S.vendors[i]={...S.vendors[i],...d};persist('vendors', S.vendors[i])}}else{d.id=uid();S.vendors.push(d);persist('vendors', d)}cM();toast(id?'Updated':'Added');rc()}

async function delV(id){
  if(!confirm('Delete vendor?')) return;
  try {
    await fetch(`${API}/vendors/${id}`, {method:'DELETE'});
    S.vendors=S.vendors.filter(v=>v.id!==id);
    toast('Deleted'); rc();
  } catch(e) { toast('Delete failed','e') }
}

/* =========================================================
   CLIENTS
   ========================================================= */
function vClients(e,a){
  const canEdit = ['admin','manager'].includes(S.role);
  a.innerHTML= canEdit ? '<button class="bt bp" onclick="cForm()"><i class="fas fa-plus"></i> Add Client</button>' : '';
  const clients = S.clients; // Staff can view all clients (read-only)
  e.innerHTML='<div style="margin-bottom:14px"><input class="ip" placeholder="Search clients..." oninput="fTbl(\'cT\',this.value)" style="max-width:280px"></div><div class="cd" style="padding:0;overflow:hidden"><table style="width:100%;border-collapse:collapse" id="cT"><thead><tr style="background:#f8fafc;border-bottom:2px solid var(--bd)"><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Client</th><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Email</th><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Phone</th>'+(canEdit?'<th style="text-align:right;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Actions</th>':'')+'</tr></thead><tbody>'+clients.map(c=>'<tr class="tr" style="border-bottom:1px solid var(--bd)" data-n="'+c.name.toLowerCase()+'"><td style="padding:10px 14px"><div style="font-weight:600;font-size:13px">'+c.name+'</div><div style="font-size:11px;color:var(--mt)">'+(c.address||'')+'</div></td><td style="padding:10px 14px;font-size:12px">'+c.email+'</td><td style="padding:10px 14px;font-size:12px">'+(c.phone||'—')+'</td>'+(canEdit?'<td style="padding:10px 14px;text-align:right"><button class="bt bs bsm" onclick="cForm(\''+c.id+'\')"><i class="fas fa-edit"></i></button> <button class="bt bdd bsm" onclick="delC(\''+c.id+'\')"><i class="fas fa-trash"></i></button></td>':'')+'</tr>').join('')+'</tbody></table>'+( !clients.length?'<div style="padding:30px;text-align:center;color:var(--mt)"><i class="fas fa-building" style="font-size:28px;opacity:.3;margin-bottom:6px"></i><p>No clients yet</p></div>':'')+'</div>'}

function cForm(id){const c=id?S.clients.find(x=>x.id===id):null;oM('<div style="padding:22px"><h3 style="font-size:17px;font-weight:800;margin-bottom:18px">'+(c?'Edit':'Add')+' Client</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div style="grid-column:span 2"><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Company Name *</label><input class="ip" id="cn" value="'+(c?c.name:'')+'"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Email *</label><input class="ip" id="ce" type="email" value="'+(c?c.email:'')+'"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Phone</label><input class="ip" id="cp2" value="'+(c?c.phone||'':'')+'"></div><div style="grid-column:span 2"><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Address</label><input class="ip" id="ca2" value="'+(c?c.address||'':'')+'"></div></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="bt bs" onclick="cM()">Cancel</button><button class="bt bp" onclick="svC(\''+(id||'')+'\')"><i class="fas fa-save"></i> Save</button></div></div>')}

function svC(id){const n=document.getElementById('cn').value.trim(),em=document.getElementById('ce').value.trim();if(!n||!em){toast('Name & email required','e');return}const d={name:n,email:em,phone:document.getElementById('cp2').value.trim(),address:document.getElementById('ca2').value.trim()};if(id){const i=S.clients.findIndex(c=>c.id===id);if(i>=0){S.clients[i]={...S.clients[i],...d};persist('clients', S.clients[i])}}else{d.id=uid();S.clients.push(d);persist('clients', d)}cM();toast(id?'Updated':'Added');rc()}

async function delC(id){
  if(!confirm('Delete client?')) return;
  try {
    await fetch(`${API}/clients/${id}`, {method:'DELETE'});
    S.clients=S.clients.filter(c=>c.id!==id);
    toast('Deleted'); rc();
  } catch(e) { toast('Delete failed','e') }
}

/* =========================================================
   QUOTATIONS
   ========================================================= */
function vQuotes(e,a){
  const isAdminOrManager = ['admin','manager'].includes(S.role);
  a.innerHTML= '<button class="bt bp" onclick="qForm()"><i class="fas fa-plus"></i> New Quotation</button>';
  const ls = S.quotations;
  const cur = S.company.currency;
e.innerHTML='<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap"><input class="ip" placeholder="Search..." oninput="fTbl(\'qT\',this.value)" style="max-width:240px"><select class="ip" style="max-width:140px" onchange="fTblS(\'qT\',this.value)"><option value="">All Status</option><option value="pending">Pending</option><option value="revision">Revision</option><option value="approved">Approved</option><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select></div><div class="cd" style="padding:0;overflow:hidden"><table style="width:100%;border-collapse:collapse" id="qT"><thead><tr style="background:#f8fafc;border-bottom:2px solid var(--bd)"><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Quote #</th><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Client</th><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Date</th><th style="text-align:right;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Amount</th><th style="text-align:center;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Status</th><th style="text-align:right;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Actions</th></tr></thead><tbody>'+ls.map(q=>'<tr class="tr" style="border-bottom:1px solid var(--bd)" data-n="'+(q.clientName||'').toLowerCase()+'" data-s="'+q.status+'"><td style="padding:10px 14px;font-weight:600;font-size:13px">'+q.id+'</td><td style="padding:10px 14px;font-size:12px">'+q.clientName+'</td><td style="padding:10px 14px;font-size:12px;color:var(--mt)">'+fd(q.createdAt)+'</td><td style="padding:10px 14px;font-size:12px;font-weight:600;text-align:right">'+cur+' '+fm(q.total)+'</td><td style="padding:10px 14px;text-align:center">'+tg(q.status)+'</td><td style="padding:10px 14px;text-align:right;white-space:nowrap">'+
  (q.status==='pending' && isAdminOrManager ? '<button class="bt bgg bsm" title="Approve" onclick="appQ(\''+q.id+'\')"><i class="fas fa-check"></i></button><button class="bt bdd bsm" title="Reject" onclick="rejQ(\''+q.id+'\')"><i class="fas fa-times"></i></button><button class="bt bs bsm" title="Request Changes" onclick="reqQ(\''+q.id+'\')"><i class="fas fa-undo"></i></button>':'')+
  ((q.status==='pending' || q.status==='rejected' || q.status==='revision') && (S.role==='staff' || isAdminOrManager) ? '<button class="bt bs bsm" title="Edit" onclick="qForm(\''+q.id+'\')"><i class="fas fa-edit"></i></button>':'')+
  (q.status==='approved' && isAdminOrManager ? '<button class="bt bp bsm" title="Send to Client" onclick="sendQ(\''+q.id+'\')"><i class="fas fa-paper-plane"></i></button>':'')+
  (q.status==='sent' && isAdminOrManager ? '<button class="bt bgg bsm" title="Client Accepted" onclick="accQ(\''+q.id+'\')"><i class="fas fa-check-double"></i></button>':'')+
  (q.status==='accepted' ? '<button class="bt bs bsm" title="View Linked Invoice" onclick="vL(\'invoices\')"><i class="fas fa-link"></i></button>':'')+
  (q.status==='sent' || q.status==='accepted' ? '<button class="bt bs bsm" title="PDF" onclick="genPDF(\'quotation\',\''+q.id+'\')"><i class="fas fa-file-pdf"></i></button>':'')+
  '<button class="bt bs bsm" title="History" onclick="vHist(\''+q.id+'\')"><i class="fas fa-history"></i></button>'+
  '</td></tr>').join('')+'</tbody></table>'+( !ls.length?'<div style="padding:30px;text-align:center;color:var(--mt)"><i class="fas fa-file-alt" style="font-size:28px;opacity:.3;margin-bottom:6px"></i><p>No quotations yet</p></div>':'')+'</div>'}

function liRow(it){return'<div style="display:grid;grid-template-columns:1fr 70px 90px 30px;gap:6px;margin-bottom:6px;align-items:center" class="lir"><input class="ip" placeholder="Description" data-f="d" value="'+(it.desc||'')+'"><input class="ip" placeholder="Qty" type="number" data-f="q" value="'+(it.qty||1)+'" min="1"><input class="ip" placeholder="Rate" type="number" data-f="r" value="'+(it.rate||0)+'" min="0" step="0.01"><button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--no);cursor:pointer;font-size:13px"><i class="fas fa-times-circle"></i></button></div>'}
function addLI(){document.getElementById('LI').insertAdjacentHTML('beforeend',liRow({desc:'',qty:1,rate:0}))}
function getLI(){const it=[];document.querySelectorAll('.lir').forEach(r=>{const d=r.querySelector('[data-f="d"]').value.trim(),q=parseFloat(r.querySelector('[data-f="q"]').value)||0,rt=parseFloat(r.querySelector('[data-f="r"]').value)||0;if(d)it.push({desc:d,qty:q,rate:rt,amount:q*rt})});return it}

function qForm(id){
  const q=id?S.quotations.find(x=>x.id===id):null;
  const nx='QUO-'+String(S.quotations.length+1).padStart(3,'0');
  oM('<div style="padding:22px"><h3 style="font-size:17px;font-weight:800;margin-bottom:18px">'+(q?'Edit':'New')+' Quotation</h3>'+
  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">'+
    '<div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Quote #</label><input class="ip" id="qNo" value="'+(q?q.id:nx)+'" '+(q?'readonly':'')+'></div>'+
    '<div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Client *</label><select class="ip" id="qCl">'+S.clients.map(c=>'<option value="'+c.id+'" '+(q&&q.clientId===c.id?'selected':'')+'>'+c.name+'</option>').join('')+'</select></div>'+
    '<div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Valid Until</label><input class="ip" id="qVu" type="date" value="'+(q?q.validUntil:dd(14))+'"></div>'+
    '<div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Tax %</label><input class="ip" id="qTx" type="number" value="'+(q?((q.tax/(q.subtotal-q.discount))*100).toFixed(1):'5')+'" step="0.1"></div>'+
    '<div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Discount %</label><input class="ip" id="qDs" type="number" value="'+(q?((q.discount/q.subtotal)*100).toFixed(1):'0')+'" step="0.1"></div>'+
  '</div>'+
  '<h4 style="font-size:13px;font-weight:700;margin-bottom:6px">Line Items</h4><div id="LI">'+(q?q.items:[{desc:'',qty:1,rate:0}]).map(it=>liRow(it)).join('')+'</div>'+
  '<button class="bt bs bsm" onclick="addLI()" style="margin-top:6px"><i class="fas fa-plus"></i> Add Item</button>'+
  '<div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
    '<div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Notes</label><textarea class="ip" id="qNt" rows="3">'+(q?q.notes||'':'')+'</textarea></div>'+
    '<div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Attachments</label><input type="file" id="qAt" multiple class="ip" style="padding:4px"><div id="AL" style="font-size:11px;color:var(--mt);margin-top:5px">'+(q?.attachments?.map(a=>'<div><i class="fas fa-paperclip"></i> '+a.name+'</div>').join('')||'No files')+'</div></div>'+
  '</div>'+
  '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="bt bs" onclick="cM()">Cancel</button><button class="bt bp" onclick="svQ(\''+(id||'')+'\')"><i class="fas fa-save"></i> Save Quotation</button></div></div>')
}

async function svQ(id){
  const items=getLI(); if(!items.length){toast('Add items','e');return}
  const cl=document.getElementById('qCl').value, clt=S.clients.find(c=>c.id===cl);
  const sub=items.reduce((s,i)=>s+i.amount,0);
  const dsr=parseFloat(document.getElementById('qDs')?.value)||0, ds=sub*dsr/100;
  const txr=parseFloat(document.getElementById('qTx').value)||0, tx=(sub-ds)*txr/100, tot=sub-ds+tx;
  
  // Handle attachments
  const files = document.getElementById('qAt').files;
  const attachments = [];
  for (let f of files) {
    const data = await new Promise(res => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(f);
    });
    attachments.push({name: f.name, type: f.type, data});
  }

  const d={
    id:document.getElementById('qNo').value,
    clientId:cl, clientName:clt?clt.name:'Unknown',
    items, subtotal:sub, discount:ds, tax:tx, total:tot,
    attachments: attachments.length ? attachments : (id ? S.quotations.find(x=>x.id===id)?.attachments : []),
    validUntil:document.getElementById('qVu').value,
    notes:document.getElementById('qNt').value.trim(),
    createdBy:S.user.name, status:'pending', createdAt:td(), company_id: S.cid
  };
  if(id){
    const i=S.quotations.findIndex(q=>q.id===id);
    if(i>=0){ S.quotations[i]={...S.quotations[i], ...d, status:'pending'}; persist('quotations', S.quotations[i]) }
  } else { S.quotations.push(d); persist('quotations', d) }
  cM(); toast('Quotation saved for approval'); rc();
}

function appQ(id){
  oM('<div style="padding:22px"><h3 style="font-size:17px;font-weight:800;margin-bottom:12px">Approve Quotation</h3><textarea class="ip" id="aCm" placeholder="Approval comments (optional)" rows="3"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="bt bs" onclick="cM()">Cancel</button><button class="bt bgg" onclick="hAppQ(\''+id+'\')">Confirm Approval</button></div></div>');
}
function hAppQ(id){
  const q=S.quotations.find(x=>x.id===id), c=document.getElementById('aCm').value;
  if(q){ q.status='approved'; persist('quotations', q); logAudit(id, 'Approved', 'approved', c); toast('Approved'); cM(); rc(); }
}
function rejQ(id){
  oM('<div style="padding:22px"><h3 style="font-size:17px;font-weight:800;margin-bottom:12px">Reject Quotation</h3><textarea class="ip" id="rCm" placeholder="Reason for rejection (mandatory)" rows="3"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="bt bs" onclick="cM()">Cancel</button><button class="bt bdd" onclick="hRejQ(\''+id+'\')">Confirm Rejection</button></div></div>');
}
function hRejQ(id){
  const q=S.quotations.find(x=>x.id===id), c=document.getElementById('rCm').value.trim();
  if(!c){toast('Reason required','e');return}
  if(q){ q.status='rejected'; persist('quotations', q); logAudit(id, 'Rejected', 'rejected', c); toast('Rejected','w'); cM(); rc(); }
}
function reqQ(id){
  oM('<div style="padding:22px"><h3 style="font-size:17px;font-weight:800;margin-bottom:12px">Request Changes</h3><textarea class="ip" id="rcCm" placeholder="Specify required changes (mandatory)" rows="3"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="bt bs" onclick="cM()">Cancel</button><button class="bt bp" onclick="hReqQ(\''+id+'\')">Send Request</button></div></div>');
}
function hReqQ(id){
  const q=S.quotations.find(x=>x.id===id), c=document.getElementById('rcCm').value.trim();
  if(!c){toast('Details required','e');return}
  if(q){ q.status='revision'; persist('quotations', q); logAudit(id, 'Requested Changes', 'revision', c); toast('Revision requested','i'); cM(); rc(); }
}
function sendQ(id){const q=S.quotations.find(x=>x.id===id);if(q){q.status='sent';persist('quotations', q);logAudit(id, 'Sent to Client', 'sent');genPDF('quotation',id);emailDoc('quotation',id);toast('Sent to client');rc()}}
function accQ(id){const q=S.quotations.find(x=>x.id===id);if(!q)return;q.status='accepted';persist('quotations', q);logAudit(id, 'Client Accepted', 'accepted');const ino='INV-'+String(S.invoices.length+1).padStart(3,'0');const inv={id:ino,quotationId:q.id,clientId:q.clientId,clientName:q.clientName,items:q.items,subtotal:q.subtotal,discount:q.discount,tax:q.tax,total:q.total,status:'unpaid',paidAmount:0,dueDate:dd(30),createdAt:td(),createdBy:S.user.name, company_id: S.cid};S.invoices.push(inv);persist('invoices', inv);logAudit(ino, 'Auto-created from '+q.id, 'unpaid');toast('Accepted — Invoice '+ino+' auto-created');rc()}
function revQ(id){const q=S.quotations.find(x=>x.id===id);if(q){q.status='pending';persist('quotations', q);logAudit(id, 'Reopened', 'pending');toast('Reopened for revision');rc()}}

/* =========================================================
   PURCHASE ORDERS
   ========================================================= */
function vLpos(e,a){
  const isAdminOrManager = ['admin','manager'].includes(S.role);
  a.innerHTML= '<button class="bt bp" onclick="lForm()"><i class="fas fa-plus"></i> New LPO</button>';
  const ls = S.lpos;
  const cur = S.company.currency;
e.innerHTML='<div style="margin-bottom:14px"><input class="ip" placeholder="Search..." oninput="fTbl(\'lT\',this.value)" style="max-width:280px"></div><div class="cd" style="padding:0;overflow:hidden"><table style="width:100%;border-collapse:collapse" id="lT"><thead><tr style="background:#f8fafc;border-bottom:2px solid var(--bd)"><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">LPO #</th><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Vendor</th><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Delivery</th><th style="text-align:right;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Amount</th><th style="text-align:center;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Status</th><th style="text-align:right;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Actions</th></tr></thead><tbody>'+ls.map(l=>'<tr class="tr" style="border-bottom:1px solid var(--bd)" data-n="'+(l.vendorName||'').toLowerCase()+'" data-s="'+l.status+'"><td style="padding:10px 14px;font-weight:600;font-size:13px">'+l.id+'</td><td style="padding:10px 14px;font-size:12px">'+l.vendorName+'</td><td style="padding:10px 14px;font-size:12px;color:var(--mt)">'+fd(l.deliveryDate)+'</td><td style="padding:10px 14px;font-size:12px;font-weight:600;text-align:right">'+cur+' '+fm(l.total)+'</td><td style="padding:10px 14px;text-align:center">'+tg(l.status)+'</td><td style="padding:10px 14px;text-align:right;white-space:nowrap">'+
  (l.status==='pending' && isAdminOrManager ? '<button class="bt bgg bsm" title="Approve" onclick="appL(\''+l.id+'\')"><i class="fas fa-check"></i></button><button class="bt bdd bsm" title="Reject" onclick="rejL(\''+l.id+'\')"><i class="fas fa-times"></i></button>':'')+
  ((l.status==='pending' || l.status==='rejected') && (S.role==='staff' || isAdminOrManager) ? '<button class="bt bs bsm" title="Edit" onclick="lForm(\''+l.id+'\')"><i class="fas fa-edit"></i></button>':'')+
  (l.status==='approved' && isAdminOrManager ? '<button class="bt bp bsm" title="Send to Vendor" onclick="sendL(\''+l.id+'\')"><i class="fas fa-paper-plane"></i></button>':'')+
  (l.status==='awaiting_delivery' ? '<button class="bt bs bsm" title="Create GRN" onclick="gFormFromLPO(\''+l.id+'\')"><i class="fas fa-boxes-stacked"></i></button>':'')+
  (S.grns.some(g=>g.lpoId===l.id) ? '<button class="bt bs bsm" title="View Linked GRN" onclick="nav(\'grns\')"><i class="fas fa-truck-loading"></i></button>':'')+
  ((l.status==='awaiting_delivery' || l.status==='received') ? '<button class="bt bs bsm" title="PDF" onclick="genPDF(\'lpo\',\''+l.id+'\')"><i class="fas fa-file-pdf"></i></button>':'')+
  '<button class="bt bs bsm" title="History" onclick="vHist(\''+l.id+'\')"><i class="fas fa-history"></i></button>'+
  '</td></tr>').join('')+'</tbody></table>'+( !ls.length?'<div style="padding:30px;text-align:center;color:var(--mt)"><i class="fas fa-shopping-cart" style="font-size:28px;opacity:.3;margin-bottom:6px"></i><p>No purchase orders yet</p></div>':'')+'</div>'}

function appL(id){
  oM('<div style="padding:22px"><h3 style="font-size:17px;font-weight:800;margin-bottom:12px">Approve LPO</h3><textarea class="ip" id="lAppCm" placeholder="Approval comments (optional)" rows="3"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="bt bs" onclick="cM()">Cancel</button><button class="bt bgg" onclick="hAppL(\''+id+'\')">Confirm Approval</button></div></div>');
}
function hAppL(id){
  const l=S.lpos.find(x=>x.id===id), c=document.getElementById('lAppCm').value;
  if(l){ l.status='approved'; persist('lpos', l); logAudit(id, 'Approved LPO', 'approved', c); toast('LPO approved'); cM(); rc(); }
}
function rejL(id){
  oM('<div style="padding:22px"><h3 style="font-size:17px;font-weight:800;margin-bottom:12px">Reject LPO</h3><textarea class="ip" id="lRejCm" placeholder="Reason for rejection (mandatory)" rows="3"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="bt bs" onclick="cM()">Cancel</button><button class="bt bdd" onclick="hRejL(\''+id+'\')">Confirm Rejection</button></div></div>');
}
function hRejL(id){
  const l=S.lpos.find(x=>x.id===id), c=document.getElementById('lRejCm').value.trim();
  if(!c){toast('Reason required','e');return}
  if(l){ l.status='rejected'; persist('lpos', l); logAudit(id, 'Rejected LPO', 'rejected', c); toast('LPO rejected','w'); cM(); rc(); }
}
function sendL(id){const l=S.lpos.find(x=>x.id===id);if(l){l.status='awaiting_delivery';persist('lpos', l);logAudit(id, 'Sent to Vendor', 'awaiting_delivery');genPDF('lpo',id);emailDoc('lpo',id);toast('LPO sent to vendor');rc()}}
function lForm(id){const l=id?S.lpos.find(x=>x.id===id):null;const nx='LPO-'+String(S.lpos.length+1).padStart(3,'0');
oM('<div style="padding:22px"><h3 style="font-size:17px;font-weight:800;margin-bottom:18px">'+(l?'Edit':'New')+' Purchase Order</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px"><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">LPO #</label><input class="ip" id="lNo" value="'+(l?l.id:nx)+'" '+(l?'readonly':'')+'></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Vendor *</label><select class="ip" id="lVn">'+S.vendors.map(v=>'<option value="'+v.id+'" '+(l&&l.vendorId===v.id?'selected':'')+'>'+v.name+'</option>').join('')+'</select></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Delivery Date</label><input class="ip" id="lDd" type="date" value="'+(l?l.deliveryDate:dd(14))+'"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Tax %</label><input class="ip" id="lTx" type="number" value="'+(l?((l.tax/l.subtotal)*100).toFixed(1):'5')+'" step="0.1"></div></div><h4 style="font-size:13px;font-weight:700;margin-bottom:6px">Line Items</h4><div id="LI">'+(l?l.items:[{desc:'',qty:1,rate:0}]).map(it=>liRow(it)).join('')+'</div><button class="bt bs bsm" onclick="addLI()" style="margin-top:6px"><i class="fas fa-plus"></i> Add Item</button><div style="margin-top:14px"><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Notes</label><textarea class="ip" id="lNt" rows="2">'+(l?l.notes||'':'')+'</textarea></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="bt bs" onclick="cM()">Cancel</button><button class="bt bp" onclick="svL(\''+(id||'')+'\')"><i class="fas fa-save"></i> Save</button></div></div>')}

function svL(id){
  const items=getLI(); if(!items.length){toast('Add items','e');return}
  const vn=document.getElementById('lVn').value, vdr=S.vendors.find(v=>v.id===vn);
  const sub=items.reduce((s,i)=>s+i.amount,0), txr=parseFloat(document.getElementById('lTx').value)||0, tx=sub*txr/100, tot=sub+tx;
  const d={
    id:document.getElementById('lNo').value,
    vendorId:vn, vendorName:vdr?vdr.name:'Unknown',
    items, subtotal:sub, tax:tx, total:tot,
    deliveryDate:document.getElementById('lDd').value,
    notes:document.getElementById('lNt').value.trim(),
    createdBy:S.user.name, status:'pending', createdAt:td(), company_id: S.cid
  };
  if(id){
    const i=S.lpos.findIndex(l=>l.id===id);
    if(i>=0){ S.lpos[i]={...S.lpos[i], ...d, status:'pending'}; persist('lpos', S.lpos[i]) }
  } else { S.lpos.push(d); persist('lpos', d) }
  cM(); toast('LPO saved for approval'); rc();
}

function appL(id){const l=S.lpos.find(x=>x.id===id);if(l){l.status='approved';persist('lpos', l);toast('LPO approved');rc()}}
function rejL(id){const l=S.lpos.find(x=>x.id===id);if(l){l.status='rejected';persist('lpos', l);toast('LPO rejected','w');rc()}}
function sendL(id){const l=S.lpos.find(x=>x.id===id);if(l){l.status='awaiting_delivery';persist('lpos', l);genPDF('lpo',id);emailDoc('lpo',id);toast('LPO sent to vendor');rc()}}

/* =========================================================
   GOODS RECEIVED
   ========================================================= */
function vGrns(e,a){
  a.innerHTML= '<button class="bt bp" onclick="gForm()"><i class="fas fa-plus"></i> New GRN</button>';

  // All roles see company-wide data
  const grns = S.grns;

  e.innerHTML='<div class="cd" style="padding:0;overflow:hidden"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f8fafc;border-bottom:2px solid var(--bd)"><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">GRN #</th><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">LPO</th><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Vendor</th><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Date</th><th style="text-align:center;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Status</th><th style="text-align:right;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Actions</th></tr></thead><tbody>'+grns.map(g=>'<tr class="tr" style="border-bottom:1px solid var(--bd)"><td style="padding:10px 14px;font-weight:600;font-size:13px">'+g.id+'</td><td style="padding:10px 14px;font-size:12px">'+g.lpoNo+'</td><td style="padding:10px 14px;font-size:12px">'+g.vendorName+'</td><td style="padding:10px 14px;font-size:12px;color:var(--mt)">'+fd(g.createdAt)+'</td><td style="padding:10px 14px;text-align:center">'+tg(g.status)+(g.discrepancy?'<div style="font-size:10px;color:var(--no);font-weight:700;margin-top:4px"><i class="fas fa-exclamation-triangle"></i> DISCREPANCY</div>':'')+'</td><td style="padding:10px 14px;text-align:right"><button class="bt bs bsm" title="PDF" onclick="genPDF(\'grn\',\''+g.id+'\')"><i class="fas fa-file-pdf"></i></button></td></tr>').join('')+'</tbody></table>'+( !grns.length?'<div style="padding:30px;text-align:center;color:var(--mt)"><i class="fas fa-boxes-stacked" style="font-size:28px;opacity:.3;margin-bottom:6px"></i><p>No GRNs yet</p></div>':'')+'</div>'}

function gForm(){const nx='GRN-'+String(S.grns.length+1).padStart(3,'0');const ol=S.lpos.filter(l=>['sent','awaiting_delivery','partially_received'].includes(l.status));
oM('<div style="padding:22px"><h3 style="font-size:17px;font-weight:800;margin-bottom:18px">New Goods Received Note</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px"><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">GRN #</label><input class="ip" id="gNo" value="'+nx+'" readonly></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">LPO *</label><select class="ip" id="gLp" onchange="loadLpoI()">'+(ol.length?ol.map(l=>'<option value="'+l.id+'">'+l.id+' — '+l.vendorName+'</option>'):'<option value="">No open LPOs</option>')+'</select></div></div><h4 style="font-size:13px;font-weight:700;margin-bottom:6px">Items Received</h4><div id="GI"></div><div style="margin-top:10px"><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Discrepancy Notes</label><textarea class="ip" id="gDi" rows="2" placeholder="Short delivery, damages, etc."></textarea></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="bt bs" onclick="cM()">Cancel</button><button class="bt bp" onclick="svG()"><i class="fas fa-save"></i> Save GRN</button></div></div>');setTimeout(loadLpoI,80)}

function gFormFromLPO(lid){setTimeout(()=>{const s=document.getElementById('gLp');if(s){s.value=lid;loadLpoI()}},250)}

function loadLpoI(){const lid=document.getElementById('gLp')?.value;const lpo=S.lpos.find(l=>l.id===lid);const c=document.getElementById('GI');if(!lpo||!c){if(c)c.innerHTML='<p style="color:var(--mt);font-size:12px;padding:8px 0">Select an open LPO above</p>';return}
c.innerHTML='<div style="display:grid;grid-template-columns:1fr 60px 70px 100px;gap:5px;margin-bottom:3px"><span style="font-size:10px;font-weight:600;color:var(--mt)">Description</span><span style="font-size:10px;font-weight:600;color:var(--mt);text-align:center">Ordered</span><span style="font-size:10px;font-weight:600;color:var(--mt);text-align:center">Recvd</span><span style="font-size:10px;font-weight:600;color:var(--mt)">Condition</span></div>'+lpo.items.map(it=>'<div style="display:grid;grid-template-columns:1fr 60px 70px 100px;gap:5px;margin-bottom:5px;align-items:center" class="gir"><input class="ip" value="'+it.desc+'" data-f="d" readonly style="background:#f8fafc;font-size:12px;padding:6px"><input class="ip" value="'+it.qty+'" data-f="o" readonly style="background:#f8fafc;text-align:center;font-size:12px;padding:6px"><input class="ip" type="number" data-f="r" value="'+it.qty+'" min="0" oninput="this.style.color=parseInt(this.value)<'+it.qty+'?\'var(--no)\':\'\'" style="text-align:center;font-size:12px;padding:6px"><select class="ip" data-f="c" style="font-size:12px;padding:6px" onchange="this.style.color=this.value!==\'Good\'?\'var(--no)\':\'\'"><option value="Good">Good</option><option value="Damaged">Damaged</option><option value="Shortage">Shortage</option><option value="Wrong Item">Wrong Item</option></select></div>').join('')}

function svG(){
  const lid=document.getElementById('gLp').value;
  const lpo=S.lpos.find(l=>l.id===lid);
  if(!lpo){toast('Select an LPO','e');return}
  
  const items=[]; let disc=false;
  document.querySelectorAll('.gir').forEach(r=>{
    const d=r.querySelector('[data-f="d"]').value, o=parseInt(r.querySelector('[data-f="o"]').value)||0, rc2=parseInt(r.querySelector('[data-f="r"]').value)||0, cn=r.querySelector('[data-f="c"]').value;
    const shortage = Math.max(0, o - rc2);
    if(rc2 < o || cn !== 'Good') disc=true;
    items.push({desc:d, ordered:o, received:rc2, shortage, condition:cn});
  });
  
  const discrepancy=document.getElementById('gDi').value.trim();
  if (disc && !discrepancy) { toast('Please specify discrepancy details in notes','e'); return }

  const grn = {
    id:document.getElementById('gNo').value,
    lpoId:lid, lpoNo:lpo.id, vendorName:lpo.vendorName,
    items, discrepancy: discrepancy || (disc ? 'Quantity/Condition mismatch' : ''),
    status:'confirmed', createdAt:td(), createdBy:S.user.name, company_id: S.cid
  };
  
  S.grns.push(grn); persist('grns', grn);
  const allR = items.every(i => i.received >= i.ordered && i.condition === 'Good');
  lpo.status = allR ? 'received' : 'partially_received';
  persist('lpos', lpo);
  
  cM(); toast(disc ? 'GRN saved with discrepancy' : 'Goods received confirmed'); rc();
}

/* =========================================================
   INVOICES
   ========================================================= */
function vInv(e){
  const canRecordPayments = ['admin','manager'].includes(S.role);
  const cur = S.company.currency;

  // All roles see company-wide data
  const invoices = S.invoices;

  e.innerHTML='<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">' +
    '<input class="ip" placeholder="Search..." oninput="fTbl(\'iT\',this.value)" style="max-width:240px">' +
    '<select class="ip" style="max-width:140px" onchange="fTblS(\'iT\',this.value)">' +
      '<option value="">All Status</option>' +
      '<option value="unpaid">Unpaid</option>' +
      '<option value="partial">Partial</option>' +
      '<option value="paid">Paid</option>' +
      '<option value="overdue">Overdue</option>' +
    '</select>' +
  '</div>' +
  '<div class="cd" style="padding:0;overflow:hidden">' +
    '<table style="width:100%;border-collapse:collapse" id="iT">' +
      '<thead>' +
        '<tr style="background:#f8fafc;border-bottom:2px solid var(--bd)">' +
          '<th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Invoice #</th>' +
          '<th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Client</th>' +
          '<th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Quote</th>' +
          '<th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Due</th>' +
          '<th style="text-align:right;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Total</th>' +
          '<th style="text-align:right;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Balance</th>' +
          '<th style="text-align:center;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Status</th>' +
          (canRecordPayments ? '<th style="text-align:right;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Actions</th>' : '') +
        '</tr>' +
      '</thead>' +
      '<tbody>' +
        invoices.map(inv => {
        const bal = inv.total - (inv.paidAmount || 0);
        return '<tr class="tr" style="border-bottom:1px solid var(--bd)" data-n="' + (inv.clientName || '').toLowerCase() + '" data-s="' + inv.status + '">' +
          '<td style="padding:10px 14px;font-weight:600;font-size:13px">' + inv.id + '</td>' +
          '<td style="padding:10px 14px;font-size:12px">' + inv.clientName + '</td>' +
          '<td style="padding:10px 14px;font-size:12px;color:var(--mt)">' + (inv.quotationId || '—') + '</td>' +
          '<td style="padding:10px 14px;font-size:12px;color:var(--mt)">' + fd(inv.dueDate) + '</td>' +
          '<td style="padding:10px 14px;font-size:12px;font-weight:600;text-align:right">' + cur + ' ' + fm(inv.total) + '</td>' +
          '<td style="padding:10px 14px;font-size:12px;font-weight:600;text-align:right;color:' + (bal > 0 ? 'var(--no)' : 'var(--ok)') + '">' + cur + ' ' + fm(bal) + '</td>' +
          '<td style="padding:10px 14px;text-align:center">' + tg(inv.status) + '</td>' +
          '<td style="padding:10px 14px;text-align:right;white-space:nowrap">' +
            (canRecordPayments ? '<button class="bt bp bsm" title="Record Payment" onclick="recPay(\'' + inv.id + '\')"><i class="fas fa-dollar-sign"></i></button> ' : '') +
            '<button class="bt bgg bsm" title="Send to Client" onclick="emailDoc(\'invoice\',\'' + inv.id + '\')"><i class="fas fa-paper-plane"></i></button> ' +
            '<button class="bt bs bsm" title="PDF" onclick="genPDF(\'invoice\',\'' + inv.id + '\')"><i class="fas fa-file-pdf"></i></button>' +
          '</td>' +
        '</tr>';
      }).join('') +
    '</tbody>' +
  '</table>' +
  (invoices.length ? '' : '<div style="padding:30px;text-align:center;color:var(--mt)"><i class="fas fa-file-invoice-dollar" style="font-size:28px;opacity:.3;margin-bottom:6px"></i><p>No invoices yet</p></div>') +
'</div>';
} // ← closes vInv

function recPay(iid){const inv=S.invoices.find(i=>i.id===iid);if(!inv)return;const bal=inv.total-(inv.paidAmount||0);
oM('<div style="padding:22px"><h3 style="font-size:17px;font-weight:800;margin-bottom:3px">Record Payment</h3><p style="color:var(--mt);font-size:12px;margin-bottom:18px">'+inv.id+' — Balance: '+S.company.currency+' '+fm(bal)+'</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Amount *</label><input class="ip" id="pAm" type="number" value="'+bal+'" max="'+bal+'" step="0.01"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Date</label><input class="ip" id="pDt" type="date" value="'+td()+'"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Method</label><select class="ip" id="pMt"><option>Bank Transfer</option><option>Cheque</option><option>Cash</option><option>Card</option><option>Online</option></select></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Reference</label><input class="ip" id="pRf" placeholder="Transaction ref"></div></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="bt bs" onclick="cM()">Cancel</button><button class="bt bp" onclick="svPay(\''+iid+'\')"><i class="fas fa-save"></i> Record</button></div></div>')}

function svPay(iid){const inv=S.invoices.find(i=>i.id===iid);if(!inv)return;const am=parseFloat(document.getElementById('pAm').value)||0;if(am<=0){toast('Enter amount','e');return}const bal=inv.total-(inv.paidAmount||0);if(am>bal+0.01){toast('Exceeds balance','e');return}
const pay = {id:uid(),invoiceId:iid,amount:am,date:document.getElementById('pDt').value,method:document.getElementById('pMt').value,reference:document.getElementById('pRf').value.trim(), company_id: S.cid};
S.payments.push(pay);inv.paidAmount=(inv.paidAmount||0)+am;inv.status=Math.abs(inv.paidAmount-inv.total)<0.01?'paid':'partial';
persist('payments', pay); persist('invoices', inv);
cM();toast('Payment recorded');rc()}

/* =========================================================
   COMPANY / USERS / SETTINGS
   ========================================================= */
function vComp(e){
  if (S.role !== 'admin') {
    e.innerHTML='<div class="cd fu" style="max-width:600px;text-align:center"><i class="fas fa-lock" style="font-size:48px;color:var(--mt);margin-bottom:16px"></i><h3 style="font-size:16px;font-weight:800;margin-bottom:8px">Admin Access Required</h3><p style="color:var(--mt)">Company profile management is restricted to administrators only.</p></div>';
    return;
  }

  const c=S.company;e.innerHTML='<div class="cd fu" style="max-width:600px"><h3 style="font-size:16px;font-weight:800;margin-bottom:18px">Company Profile</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div style="grid-column:span 2"><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Company Name</label><input class="ip" id="cpN" value="'+c.name+'"></div><div style="grid-column:span 2"><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Address</label><input class="ip" id="cpAd" value="'+(c.address||'')+'"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Phone</label><input class="ip" id="cpPh" value="'+(c.phone||'')+'"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Email</label><input class="ip" id="cpEm" value="'+(c.email||'')+'"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Tax ID / TRN</label><input class="ip" id="cpTx" value="'+(c.taxId||'')+'"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Currency</label><select class="ip" id="cpCu"><option '+(c.currency==='AED'?'selected':'')+'>AED</option><option '+(c.currency==='USD'?'selected':'')+'>USD</option><option '+(c.currency==='EUR'?'selected':'')+'>EUR</option><option '+(c.currency==='GBP'?'selected':'')+'>GBP</option><option '+(c.currency==='SAR'?'selected':'')+'>SAR</option><option '+(c.currency==='INR'?'selected':'')+'>INR</option></select></div><div style="grid-column:span 2"><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Terms & Conditions (PDF Footer)</label><textarea class="ip" id="cpTe" rows="3">'+(c.terms||'')+'</textarea></div></div><div style="margin-top:18px"><button class="bt bp" onclick="svComp()"><i class="fas fa-save"></i> Save</button></div></div>'}

function svComp(){S.company.name=document.getElementById('cpN').value.trim();S.company.address=document.getElementById('cpAd').value.trim();S.company.phone=document.getElementById('cpPh').value.trim();S.company.email=document.getElementById('cpEm').value.trim();S.company.taxId=document.getElementById('cpTx').value.trim();S.company.currency=document.getElementById('cpCu').value;S.company.terms=document.getElementById('cpTe').value.trim();persist('company', S.company);toast('Profile saved')}

function vHist(doc_id){const h=S.audit.filter(a=>a.doc_id===doc_id).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));oM('<div style="padding:22px;min-width:400px"><h3 style="font-size:17px;font-weight:800;margin-bottom:18px">Audit Trail: '+doc_id+'</h3><div style="display:flex;flex-direction:column;gap:12px">'+(h.length?h.map(l=>'<div style="border-left:2px solid var(--ac);padding-left:12px"><div><span style="font-size:12px;font-weight:800">'+l.action+'</span> — <span style="font-size:11px;color:var(--mt)">'+l.user_name+'</span></div><div style="font-size:10px;color:var(--mt);margin-bottom:4px">'+new Date(l.timestamp).toLocaleString()+'</div>'+(l.comment?'<div style="font-size:12px;background:#f8fafc;padding:6px 10px;border-radius:6px;margin-top:4px">"'+l.comment+'"</div>':'')+'</div>').join(''):'<p style="color:var(--mt);text-align:center;padding:20px">No history found</p>')+'</div><div style="display:flex;justify-content:flex-end;margin-top:22px"><button class="bt bp" onclick="cM()">Close</button></div></div>')}

function vUsers(e,a){
  if (S.role !== 'admin') {
    e.innerHTML='<div class="cd fu" style="max-width:600px;text-align:center"><i class="fas fa-users" style="font-size:48px;color:var(--mt);margin-bottom:16px"></i><h3 style="font-size:16px;font-weight:800;margin-bottom:8px">Admin Access Required</h3><p style="color:var(--mt)">User management is restricted to administrators only.</p></div>';
    a.innerHTML = '';
    return;
  }

  a.innerHTML='<button class="bt bp" onclick="uForm()"><i class="fas fa-plus"></i> Add User</button>';
  e.innerHTML='<div class="cd" style="padding:0;overflow:hidden"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f8fafc;border-bottom:2px solid var(--bd)"><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Name</th><th style="text-align:left;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Email</th><th style="text-align:center;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Role</th><th style="text-align:right;padding:12px 14px;font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase">Actions</th></tr></thead><tbody>'+S.users.map(u=>'<tr class="tr" style="border-bottom:1px solid var(--bd)"><td style="padding:10px 14px;font-weight:600;font-size:13px">'+u.name+'</td><td style="padding:10px 14px;font-size:12px">'+u.email+'</td><td style="padding:10px 14px;text-align:center"><span class="tg '+(u.role==='admin'?'tg-a':u.role==='manager'?'tg-s':'tg-d')+'" style="text-transform:capitalize">'+u.role+'</span></td><td style="padding:10px 14px;text-align:right"><button class="bt bs bsm" onclick="uForm(\''+u.id+'\')"><i class="fas fa-edit"></i></button></td></tr>').join('')+'</tbody></table></div>'}

function uForm(id){const u=id?S.users.find(x=>x.id===id):null;oM('<div style="padding:22px"><h3 style="font-size:17px;font-weight:800;margin-bottom:18px">'+(u?'Edit':'Add')+' User</h3><div style="display:grid;gap:10px"><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Name *</label><input class="ip" id="un" value="'+(u?u.name:'')+'"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Email *</label><input class="ip" id="ue" type="email" value="'+(u?u.email:'')+'"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Password '+(u?'(leave blank to keep)':'*')+'</label><input class="ip" id="up" type="password" placeholder="'+(u?'********':'Set password')+'"></div><div><label style="font-size:11px;font-weight:600;color:var(--mt);display:block;margin-bottom:3px">Role</label><select class="ip" id="ur"><option value="admin" '+(u&&u.role==='admin'?'selected':'')+'>Admin</option><option value="manager" '+(u&&u.role==='manager'?'selected':'')+'>Manager</option><option value="finance" '+(u&&u.role==='finance'?'selected':'')+'>Finance</option><option value="staff" '+(u&&u.role==='staff'?'selected':'')+'>Staff</option></select></div></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="bt bs" onclick="cM()">Cancel</button><button class="bt bp" onclick="svU(\''+(id||'')+'\')"><i class="fas fa-save"></i> Save</button></div></div>')}

function svU(id){const n=document.getElementById('un').value.trim(),em=document.getElementById('ue').value.trim(),p=document.getElementById('up').value.trim(),r=document.getElementById('ur').value;if(!n||!em||(!id && !p)){toast('Fill all required fields','e');return}if(id){const i=S.users.findIndex(u=>u.id===id);if(i>=0){S.users[i]={...S.users[i],name:n,email:em,role:r};if(p) S.users[i].password=p;persist('users', S.users[i])}}else{const u={id:uid(),name:n,email:em,password:p,role:r,company_id:S.cid};S.users.push(u);persist('users', u)}cM();toast('Saved');rc()}

function vSet(e){
e.innerHTML='<div style="max-width:600px;display:flex;flex-direction:column;gap:16px"><div class="cd fu"><h3 style="font-size:15px;font-weight:800;margin-bottom:14px"><i class="fas fa-plug" style="color:var(--ac);margin-right:6px"></i>Firebase Connection</h3><div style="display:flex;align-items:center;gap:6px;margin-bottom:10px"><span style="width:8px;height:8px;border-radius:50%;display:inline-block;background:'+(S.fbReady?'var(--ok)':'#94a3b8')+';'+(S.fbReady?'animation:pls 2s infinite':'')+'"></span><span style="font-size:12px;font-weight:600;color:'+(S.fbReady?'var(--ok)':'var(--mt)')+'">'+(S.fbReady?'Connected to lpo-manager-johnzz-2026':'Offline Mode — Firebase unavailable')+'</span></div>'+(S.fbError?'<div class="err-box" style="margin-top:8px"><i class="fas fa-exclamation-circle"></i> '+S.fbError+'</div>':'')+'<p style="font-size:11px;color:var(--mt);margin-top:8px">'+(S.fbReady?'Firebase Authentication and Firestore are active. All data syncs to the cloud automatically.':'The app is running in offline mode. Data is stored in your browser only. To enable cloud sync, make sure Firebase Authentication is enabled in your Firebase Console.')+'</p></div><div class="cd fu" style="animation-delay:.05s"><h3 style="font-size:15px;font-weight:800;margin-bottom:14px"><i class="fas fa-database" style="color:var(--ac);margin-right:6px"></i>Data Management</h3><p style="font-size:11px;color:var(--mt);margin-bottom:10px">Export or clear all business data.</p><div style="display:flex;gap:8px"><button class="bt bs" onclick="exportData()"><i class="fas fa-download"></i> Export JSON</button><button class="bt bdd" onclick="clearData()"><i class="fas fa-trash"></i> Clear All Data</button></div></div><div class="cd fu" style="animation-delay:.1s"><h3 style="font-size:15px;font-weight:800;margin-bottom:14px"><i class="fas fa-info-circle" style="color:var(--ac);margin-right:6px"></i>System Info</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;font-size:12px"><div>Version:</div><div>1.0.0</div><div>User:</div><div>'+(S.user?.name||'None')+'</div><div>Role:</div><div style="text-transform:capitalize">'+(S.role||'None')+'</div><div>Company:</div><div>'+(S.company?.name||'None')+'</div><div>Firebase:</div><div>'+(S.fbReady?'Enabled':'Disabled')+'</div><div>Data Sync:</div><div>'+(S.fbReady?'Active':'Local Only')+'</div></div></div>'}

function exportData(){const d={company:S.company,vendors:S.vendors,clients:S.clients,quotations:S.quotations,lpos:S.lpos,grns:S.grns,invoices:S.invoices,payments:S.payments,users:S.users};const b=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='bizflow-backup-'+td()+'.json';a.click();toast('Data exported')}

function clearData(){oM('<div style="padding:22px;text-align:center"><i class="fas fa-exclamation-triangle" style="font-size:32px;color:var(--no);margin-bottom:10px"></i><h3 style="font-size:17px;font-weight:800;margin-bottom:6px">Clear All Data?</h3><p style="color:var(--mt);font-size:13px;margin-bottom:18px">This deletes all local data permanently.</p><div style="display:flex;gap:8px;justify-content:center"><button class="bt bs" onclick="cM()">Cancel</button><button class="bt bdd" onclick="Object.keys(localStorage).filter(k=>k.startsWith(\'bf_\')).forEach(k=>localStorage.removeItem(k));cM();doLogout()"><i class="fas fa-trash"></i> Clear Everything</button></div></div>')}

/* =========================================================
   AI BUSINESS ASSISTANT
   ========================================================= */


/* =========================================================
   TABLE FILTERS
   ========================================================= */
function fTbl(id,q){q=(q||'').toLowerCase();document.querySelectorAll('#'+id+' tbody tr').forEach(r=>{r.style.display=(r.dataset.n||'').includes(q)?'':'none'})}
function fTblS(id,s){document.querySelectorAll('#'+id+' tbody tr').forEach(r=>{r.style.display=(!s||r.dataset.s===s)?'':'none'})}

/* =========================================================
   PDF GENERATION
   ========================================================= */
function genPDF(type,id){
if(typeof window.jspdf==='undefined'){toast('PDF library not loaded yet','e');return}
const{jsPDF}=window.jspdf;const doc=new jsPDF();const c=S.company;const cur=c.currency;
const titleMap={quotation:'QUOTATION',lpo:'LOCAL PURCHASE ORDER',grn:'GOODS RECEIVED NOTE',invoice:'INVOICE'};
const d={quotation:S.quotations,lpo:S.lpos,grn:S.grns,invoice:S.invoices}[type]?.find(x=>x.id===id);
if(!d){toast('Document not found','e');return}

doc.setFillColor(26,31,58);doc.rect(0,0,210,42,'F');
doc.setTextColor(255,255,255);doc.setFontSize(22);doc.setFont('helvetica','bold');doc.text(c.name||'Company',20,22);
doc.setFontSize(9);doc.setFont('helvetica','normal');let hdrInfo=c.address||'';if(c.phone)hdrInfo+=(hdrInfo?' | ':'')+c.phone;if(c.email)hdrInfo+=(hdrInfo?' | ':'')+c.email;doc.text(hdrInfo,20,32);if(c.taxId)doc.text('TRN: '+c.taxId,20,38);

doc.setTextColor(217,119,6);doc.setFontSize(18);doc.setFont('helvetica','bold');doc.text(titleMap[type],20,56);

doc.setTextColor(40,40,40);doc.setFontSize(10);doc.setFont('helvetica','normal');let y=66;
const meta=type==='quotation'?[['Quote #',d.id],['Date',fd(d.createdAt)],['Valid Until',fd(d.validUntil)],['Status',d.status.toUpperCase()]]:type==='lpo'?[['LPO #',d.id],['Date',fd(d.createdAt)],['Delivery By',fd(d.deliveryDate)],['Status',d.status.toUpperCase()]]:type==='grn'?[['GRN #',d.id],['Date',fd(d.createdAt)],['LPO Reference',d.lpoNo],['Status',d.status.toUpperCase()]]:[['Invoice #',d.id],['Date',fd(d.createdAt)],['Due Date',fd(d.dueDate)],['Quote Ref',d.quotationId||'—'],['Status',d.status.toUpperCase()]];
meta.forEach(([k,v])=>{doc.setFont('helvetica','bold');doc.text(k+':',20,y);doc.setFont('helvetica','normal');doc.text(String(v),70,y);y+=7});

y+=4;const pName=type==='lpo'||type==='grn'?'Vendor':'Client';const pEmail=type==='lpo'||type==='grn'?S.vendors.find(v=>v.id===d.vendorId)?.email:S.clients.find(c2=>c2.id===d.clientId)?.email;
doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text('To ('+pName+'): ',20,y);y+=6;doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(d.clientName||d.vendorName||'',20,y);y+=5;if(pEmail){doc.text(pEmail,20,y);y+=5}

y+=6;const items=d.items||[];
const cols=type==='grn'?[{header:'Description',dataKey:'desc'},{header:'Ordered',dataKey:'ordered'},{header:'Received',dataKey:'received'},{header:'Condition',dataKey:'condition'}]:[{header:'Description',dataKey:'desc'},{header:'Qty',dataKey:'qty'},{header:'Rate',dataKey:'rate'},{header:'Amount',dataKey:'amount'}];
const rows=items.map(it=>type==='grn'?{desc:it.desc,ordered:String(it.ordered||''),received:String(it.received||''),condition:it.condition||''}:{desc:it.desc,qty:String(it.qty||''),rate:cur+' '+fm(it.rate),amount:cur+' '+fm(it.amount||it.qty*it.rate)});
doc.autoTable({startY:y,columns:cols,body:rows,theme:'grid',headStyles:{fillColor:[26,31,58],textColor:[255,255,255],fontStyle:'bold',fontSize:9},bodyStyles:{fontSize:9},alternateRowStyles:{fillColor:[248,250,252]},margin:{left:20,right:20}});
y=doc.lastAutoTable.finalY+10;

if(type!=='grn'){
  const rX=140;doc.setFont('helvetica','normal');doc.setFontSize(10);
  doc.text('Subtotal:',rX,y);doc.text(cur+' '+fm(d.subtotal),rX+50,y,{align:'right'});y+=6;
  if(d.discount > 0){
    doc.text('Discount:',rX,y);doc.text('-'+cur+' '+fm(d.discount),rX+50,y,{align:'right'});y+=6;
  }
  doc.text('Tax:',rX,y);doc.text(cur+' '+fm(d.tax),rX+50,y,{align:'right'});y+=6;
  doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text('TOTAL:',rX,y);doc.text(cur+' '+fm(d.total),rX+50,y,{align:'right'});y+=8;
  if(type==='invoice'&&(d.paidAmount||0)>0){
    doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text('Paid:',rX,y);doc.text(cur+' '+fm(d.paidAmount),rX+50,y,{align:'right'});y+=6;
    doc.setFont('helvetica','bold');doc.setTextColor(220,38,38);doc.text('BALANCE DUE:',rX,y);doc.text(cur+' '+fm(d.total-(d.paidAmount||0)),rX+50,y,{align:'right'});y+=6;doc.setTextColor(40,40,40)
  }
}
if(type==='grn'&&d.discrepancy){doc.setFont('helvetica','bold');doc.setTextColor(220,38,38);doc.setFontSize(10);doc.text('DISCREPANCY: '+d.discrepancy,20,y);y+=8;doc.setTextColor(40,40,40)}
if(d.notes){doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text('Notes: '+d.notes,20,y);y+=10}
if(c.terms){doc.setFont('helvetica','italic');doc.setFontSize(8);doc.setTextColor(100,100,100);doc.text('Terms & Conditions:',20,y);y+=4;const splitTerms=doc.splitTextToSize(c.terms,170);doc.text(splitTerms,20,y)}
doc.setFontSize(8);doc.setTextColor(150,150,150);doc.text('Generated by FinProx | '+new Date().toLocaleString(),105,290,{align:'center'});
doc.save(type.toUpperCase()+'-'+id+'.pdf');toast('PDF generated')}

/* =========================================================
   EMAIL DELIVERY
   ========================================================= */
function emailDoc(type,id){
const d={quotation:S.quotations,lpo:S.lpos,grn:S.grns,invoice:S.invoices}[type]?.find(x=>x.id===id);
if(!d){toast('Not found','e');return}
const party=type==='lpo'||type==='grn'?S.vendors.find(v=>v.id===d.vendorId):S.clients.find(c=>c.id===d.clientId);
const toEmail=party?.email||'';
if(!toEmail){toast('No email address found','w');return}

genPDF(type,id);
logAudit(id, 'Email Sent', d.status, 'Automated email trigger to ' + toEmail);

// Use mailto for now (upgrade to Cloud Functions later)
const titles={quotation:'Quotation',lpo:'Local Purchase Order',grn:'Goods Received Note',invoice:'Invoice'};
const subj=titles[type]+' '+d.id+' from '+S.company.name;
const body='Dear '+(d.clientName||d.vendorName)+',\n\nPlease find '+titles[type]+' '+d.id+' for '+S.company.currency+' '+fm(d.total)+'.\n\nBest regards,\n'+S.company.name;
setTimeout(()=>{window.open('mailto:'+toEmail+'?subject='+encodeURIComponent(subj)+'&body='+encodeURIComponent(body),'_blank')},300);
toast('PDF generated — email client opened');
}

/* =========================================================
   APP INITIALIZATION — RUNS LAST, SURVIVES FIREBASE ERRORS
   ========================================================= */
(function init() {
  initFB(); // Initialize SQL connection check

  const session = ld('session');
  if (session && session.email && session.cid) {
    (async () => {
      S.cid = session.cid;
      await loadCloudData();
      const u = S.users.find(x => x.email === session.email) || (session.email === 'admin@admin.com' ? {id:'admin_primary', name:'System Admin', email:'admin@admin.com', role:'admin'} : null);
      if (u) { S.user = u; S.role = u.role; render() }
      else { rAuth() }
    })();
  } else {
    rAuth();
  }
})();