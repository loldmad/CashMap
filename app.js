const STORAGE_KEY = 'cashmap-state-v1';
const statesByTier = {
  zero: ['TX', 'FL', 'NV', 'TN', 'WY', 'SD', 'AK'],
  low: ['PA', 'MI', 'NC', 'AZ', 'IN'],
  mid: ['SC', 'GA', 'VA', 'MO', 'CO'],
  high: ['CA', 'NY', 'NJ', 'OR', 'HI']
};

const defaultState = {
  activeTab: 'overview',
  incomeStreams: [{ id: crypto.randomUUID(), name: 'Main Job', type: 'hourly', rate: 30, units: 40 }],
  tax: { state: 'TX', under18: false, healthWeekly: 0, retirementPercent: 0, miscWeekly: 0 },
  savingsRate: 20,
  goal: { name: 'Emergency Fund', amount: 3000 }
};

let state = loadState();
const tabs = document.querySelectorAll('.tab-btn');
const panels = document.querySelectorAll('.tab-panel');

tabs.forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab)));

function incomeEngine() {
  const weeklyIncome = state.incomeStreams.reduce((sum, s) => sum + (Number(s.rate) || 0) * (Number(s.units) || 0), 0);
  return { weeklyIncome };
}

function taxEngine(grossWeekly) {
  const annual = grossWeekly * 52;
  let fed = annual < 25000 ? 0.08 : annual < 80000 ? 0.14 : 0.2;
  const st = statesByTier.zero.includes(state.tax.state) ? 0
    : statesByTier.low.includes(state.tax.state) ? 0.04
    : statesByTier.mid.includes(state.tax.state) ? 0.06 : 0.1;
  if (state.tax.under18) fed = Math.max(0, fed - 0.03);
  const payroll = 0.0765;
  const federalTax = grossWeekly * fed;
  const stateTax = grossWeekly * st;
  const payrollTax = grossWeekly * payroll;
  const retirement = grossWeekly * ((Number(state.tax.retirementPercent) || 0) / 100);
  const optional = (Number(state.tax.healthWeekly) || 0) + retirement + (Number(state.tax.miscWeekly) || 0);
  const takeHome = grossWeekly - federalTax - stateTax - payrollTax - optional;
  return { fedRate: fed, stateRate: st, federalTax, stateTax, payrollTax, optional, takeHome };
}

function goalEngine(savedWeekly) {
  const amount = Number(state.goal.amount) || 0;
  const weeksNeeded = savedWeekly > 0 ? amount / savedWeekly : Infinity;
  const end = Number.isFinite(weeksNeeded)
    ? new Date(Date.now() + Math.ceil(weeksNeeded) * 7 * 24 * 3600 * 1000)
    : null;
  const progress = amount > 0 ? Math.min(100, (savedWeekly / amount) * 100) : 0;
  return { weeksNeeded, end, progress };
}

function moneyFlow() {
  const income = incomeEngine();
  const tax = taxEngine(income.weeklyIncome);
  const savedWeekly = Math.max(0, tax.takeHome * ((Number(state.savingsRate) || 0) / 100));
  const goal = goalEngine(savedWeekly);
  return { income, tax, savedWeekly, goal };
}

function render() {
  const flow = moneyFlow();
  renderOverview(flow);
  renderIncome(flow);
  renderPaycheck(flow);
  renderGoals(flow);
  renderCashflow(flow);
  saveState();
}

function renderOverview({ income, tax, savedWeekly, goal }) {
  document.getElementById('overview').innerHTML = `
    <div class="grid">
      <div class="card"><h3>💰 Weekly Snapshot</h3><div class="kv"><span>Weekly Income</span><strong>$${fmt(income.weeklyIncome)}</strong></div><div class="kv"><span>After-tax</span><strong>$${fmt(tax.takeHome)}</strong></div><div class="kv"><span>Savings/week</span><strong class="value accent">$${fmt(savedWeekly)}</strong></div></div>
      <div class="card"><h3>💼 Income Summary</h3><div class="kv"><span>Total Streams</span><strong>${state.incomeStreams.length}</strong></div><div class="value">$${fmt(income.weeklyIncome)}</div></div>
      <div class="card"><h3>💵 Take-home Preview</h3><div class="kv"><span>Gross</span><strong>$${fmt(income.weeklyIncome)}</strong></div><div class="kv"><span>Taxes + Deductions</span><strong class="value warn">$${fmt(income.weeklyIncome - tax.takeHome)}</strong></div><div class="kv"><span>Final Pay</span><strong class="value accent">$${fmt(tax.takeHome)}</strong></div></div>
      <div class="card"><h3>🎯 Goal Progress</h3><div class="small">${state.goal.name || 'Savings Goal'}</div><div class="progress-wrap" style="margin:8px 0;"><div class="progress" style="width:${goal.progress}%"></div></div><div class="kv"><span>Remaining</span><strong>$${fmt(Math.max(0, (state.goal.amount || 0) - savedWeekly))}</strong></div></div>
    </div>`;
}

function renderIncome({ income }) {
  document.getElementById('income').innerHTML = `
    <div class="card">
      <h3>Income Streams</h3>
      <div id="streams"></div>
      <button class="primary" id="addStream">+ Add Income Stream</button>
      <p class="small" style="margin-top:10px;">Combined Weekly Income: <strong>$${fmt(income.weeklyIncome)}</strong></p>
    </div>`;
  const wrap = document.getElementById('streams');
  state.incomeStreams.forEach((s) => {
    const div = document.createElement('div'); div.className = 'stream';
    div.innerHTML = `<div class="row">
      <div><label>Name</label><input data-id="${s.id}" data-field="name" value="${s.name}" /></div>
      <div><label>Type</label><select data-id="${s.id}" data-field="type"><option value="hourly" ${s.type==='hourly'?'selected':''}>Hourly</option><option value="daily" ${s.type==='daily'?'selected':''}>Daily</option></select></div>
      <div><label>Rate ($)</label><input type="number" min="0" step="0.01" data-id="${s.id}" data-field="rate" value="${s.rate}" /></div>
      <div><label>${s.type==='hourly' ? 'Hours/week' : 'Days/week'}</label><input type="number" min="0" step="0.1" data-id="${s.id}" data-field="units" value="${s.units}" /></div>
      <button class="danger" data-del="${s.id}">Delete</button>
    </div>`;
    wrap.appendChild(div);
  });
  document.querySelectorAll('#income input, #income select').forEach((el) => el.addEventListener('input', onStreamEdit));
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    state.incomeStreams = state.incomeStreams.filter((s) => s.id !== b.dataset.del); render();
  }));
  document.getElementById('addStream').onclick = () => { state.incomeStreams.push({ id: crypto.randomUUID(), name: 'New Stream', type: 'hourly', rate: 0, units: 0 }); render(); };
}

function renderPaycheck({ income, tax }) {
  const options = [...statesByTier.zero, ...statesByTier.low, ...statesByTier.mid, ...statesByTier.high];
  document.getElementById('paycheck').innerHTML = `<div class="card"><h3>Paycheck Breakdown</h3>
    <div class="row">
      <div><label>State</label><select id="stateSel">${options.map((s)=>`<option ${s===state.tax.state?'selected':''}>${s}</option>`).join('')}</select></div>
      <div><label>Age Adjustment</label><select id="ageSel"><option value="no" ${!state.tax.under18?'selected':''}>18+</option><option value="yes" ${state.tax.under18?'selected':''}>Under 18</option></select></div>
      <div><label>Health Insurance ($/week)</label><input id="healthIn" type="number" min="0" value="${state.tax.healthWeekly}"></div>
      <div><label>Retirement (%)</label><input id="retireIn" type="number" min="0" max="100" value="${state.tax.retirementPercent}"></div>
      <div><label>Misc ($/week)</label><input id="miscIn" type="number" min="0" value="${state.tax.miscWeekly}"></div>
    </div>
    <div class="kv"><span>Gross Pay</span><strong>$${fmt(income.weeklyIncome)}</strong></div>
    <div class="kv"><span>Federal Tax (${(tax.fedRate*100).toFixed(1)}%)</span><strong>-$${fmt(tax.federalTax)}</strong></div>
    <div class="kv"><span>State Tax (${(tax.stateRate*100).toFixed(1)}%)</span><strong>-$${fmt(tax.stateTax)}</strong></div>
    <div class="kv"><span>Payroll Tax (7.65%)</span><strong>-$${fmt(tax.payrollTax)}</strong></div>
    <div class="kv"><span>Optional Deductions</span><strong>-$${fmt(tax.optional)}</strong></div>
    <hr style="border-color:#334155">
    <div class="value accent">Final Take-Home: $${fmt(tax.takeHome)}</div>
  </div>`;
  bindTaxControls();
}

function renderGoals({ savedWeekly, goal }) {
  document.getElementById('goals').innerHTML = `<div class="card"><h3>Goals</h3>
    <div class="row"><div><label>Goal Name</label><input id="goalName" value="${state.goal.name}"></div>
    <div><label>Goal Amount ($)</label><input id="goalAmount" type="number" min="0" value="${state.goal.amount}"></div>
    <div><label>Savings Rate (%)</label><input id="saveRate" type="number" min="0" max="100" value="${state.savingsRate}"></div></div>
    <div class="kv"><span>Savings per week</span><strong>$${fmt(savedWeekly)}</strong></div>
    <div class="kv"><span>Weeks needed</span><strong>${Number.isFinite(goal.weeksNeeded) ? goal.weeksNeeded.toFixed(1) : '∞'}</strong></div>
    <div class="kv"><span>Estimated completion</span><strong>${goal.end ? goal.end.toLocaleDateString() : 'N/A'}</strong></div>
    <div class="progress-wrap"><div class="progress" style="width:${goal.progress}%"></div></div>
  </div>`;
  ['goalName','goalAmount','saveRate'].forEach((id)=>document.getElementById(id).addEventListener('input', goalEdit));
}

function renderCashflow({ savedWeekly }) {
  document.getElementById('cashflow').innerHTML = `<div class="card"><h3>Cash Flow Map</h3><canvas id="flowCanvas" width="1000" height="280"></canvas></div>`;
  const canvas = document.getElementById('flowCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = '#1f2937';
  for(let i=0;i<6;i++){ const y=20+i*40; ctx.beginPath(); ctx.moveTo(40,y); ctx.lineTo(970,y); ctx.stroke(); }
  ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3; ctx.beginPath();
  const weeks = 20; let first=true;
  for (let w=0; w<=weeks; w++) {
    const x = 40 + (930/weeks)*w;
    const total = savedWeekly * w;
    const y = 250 - Math.min(220, total/Math.max(1, savedWeekly*weeks) * 220);
    if(first){ctx.moveTo(x,y); first=false;} else ctx.lineTo(x,y);
  }
  ctx.stroke();
}

function onStreamEdit(e) {
  const { id, field } = e.target.dataset;
  const stream = state.incomeStreams.find((s) => s.id === id);
  stream[field] = field === 'name' || field === 'type' ? e.target.value : Number(e.target.value);
  render();
}
function bindTaxControls() {
  document.getElementById('stateSel').oninput = (e)=>{ state.tax.state = e.target.value; render(); };
  document.getElementById('ageSel').oninput = (e)=>{ state.tax.under18 = e.target.value === 'yes'; render(); };
  document.getElementById('healthIn').oninput = (e)=>{ state.tax.healthWeekly = Number(e.target.value); render(); };
  document.getElementById('retireIn').oninput = (e)=>{ state.tax.retirementPercent = Number(e.target.value); render(); };
  document.getElementById('miscIn').oninput = (e)=>{ state.tax.miscWeekly = Number(e.target.value); render(); };
}
function goalEdit() {
  state.goal.name = document.getElementById('goalName').value;
  state.goal.amount = Number(document.getElementById('goalAmount').value);
  state.savingsRate = Number(document.getElementById('saveRate').value);
  render();
}
function fmt(n){ return (Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:2}); }
function setTab(tab) {
  state.activeTab = tab;
  tabs.forEach((b)=>b.classList.toggle('active', b.dataset.tab === tab));
  panels.forEach((p)=>p.classList.toggle('active', p.id === tab));
  saveState();
}
function loadState() {
  try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return defaultState; }
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
setTab(state.activeTab);
render();
