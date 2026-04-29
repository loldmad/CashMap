const STORAGE_KEY = 'cashmap-state-v1';
const statesByTier = {
  zero: ['TX', 'FL', 'NV', 'TN', 'WY', 'SD', 'AK'],
  low: ['PA', 'MI', 'NC', 'AZ', 'IN'],
  mid: ['SC', 'GA', 'VA', 'MO', 'CO'],
  high: ['CA', 'NY', 'NJ', 'OR', 'HI']
};

const recommendedDeductions = [
  { name: 'Health Insurance', mode: 'fixed', value: 0 },
  { name: 'Retirement', mode: 'percent', value: 0 },
  { name: 'Transit', mode: 'fixed', value: 0 }
];

const defaultState = {
  activeTab: 'overview',
  incomeStreams: [{ id: crypto.randomUUID(), name: 'Main Job', type: 'hourly', rate: 30, units: 40 }],
  tax: { state: 'TX', under18: false, deductions: structuredClone(recommendedDeductions) },
  savingsRate: 20,
  goals: [{ id: crypto.randomUUID(), name: 'Emergency Fund', amount: 3000, current: 0 }],
  chartWeeks: 26
};

let state = loadState();
if (!state.tax.deductions) state.tax.deductions = structuredClone(recommendedDeductions);
if (!state.goals) state.goals = [{ id: crypto.randomUUID(), name: 'Emergency Fund', amount: 3000, current: 0 }];
const tabs = document.querySelectorAll('.tab-btn');
const panels = document.querySelectorAll('.tab-panel');
tabs.forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab)));

const freq = (weekly) => ({ weekly, biweekly: weekly * 2, monthly: weekly * 52 / 12, yearly: weekly * 52 });
function incomeEngine() { return { weeklyIncome: state.incomeStreams.reduce((s, i) => s + (Number(i.rate)||0) * (Number(i.units)||0), 0) }; }

function taxEngine(grossWeekly) {
  const annual = grossWeekly * 52;
  let fed = annual < 25000 ? 0.08 : annual < 80000 ? 0.14 : 0.2;
  const st = statesByTier.zero.includes(state.tax.state) ? 0 : statesByTier.low.includes(state.tax.state) ? 0.04 : statesByTier.mid.includes(state.tax.state) ? 0.06 : 0.1;
  if (state.tax.under18) fed = Math.max(0, fed - 0.03);
  const federalTax = grossWeekly * fed;
  const stateTax = grossWeekly * st;
  const payrollTax = grossWeekly * 0.0765;

  const deductionRows = state.tax.deductions.map((d) => {
    const amount = d.mode === 'percent' ? grossWeekly * ((Number(d.value) || 0) / 100) : (Number(d.value) || 0);
    return { ...d, amount };
  });
  const optional = deductionRows.reduce((s, d) => s + d.amount, 0);
  const takeHome = grossWeekly - federalTax - stateTax - payrollTax - optional;
  return { fedRate: fed, stateRate: st, federalTax, stateTax, payrollTax, optional, takeHome, deductionRows };
}

function smartGoalPlan(savedWeekly) {
  const goals = state.goals.map((g) => ({ ...g, amount: Number(g.amount) || 0, current: Number(g.current) || 0 })).filter((g) => g.amount > 0);
  const remainingTotal = goals.reduce((s, g) => s + Math.max(0, g.amount - g.current), 0);
  const plan = goals.map((g) => {
    const remaining = Math.max(0, g.amount - g.current);
    const share = remainingTotal > 0 ? remaining / remainingTotal : 0;
    const weeklyAllocation = savedWeekly * share;
    const weeksNeeded = weeklyAllocation > 0 ? remaining / weeklyAllocation : Infinity;
    const end = Number.isFinite(weeksNeeded) ? new Date(Date.now() + Math.ceil(weeksNeeded) * 604800000) : null;
    const progress = g.amount > 0 ? Math.min(100, (g.current / g.amount) * 100) : 0;
    return { ...g, remaining, weeklyAllocation, weeksNeeded, end, progress };
  });
  const soonest = [...plan].sort((a, b) => a.weeksNeeded - b.weeksNeeded)[0] || null;
  return { plan, soonest };
}

function moneyFlow() {
  const income = incomeEngine();
  const tax = taxEngine(income.weeklyIncome);
  const savedWeekly = Math.max(0, tax.takeHome * ((Number(state.savingsRate) || 0) / 100));
  const groupGoals = smartGoalPlan(savedWeekly);
  return { income, tax, savedWeekly, groupGoals, pay: { gross: freq(income.weeklyIncome), takeHome: freq(tax.takeHome), savings: freq(savedWeekly) } };
}

function render() { const flow = moneyFlow(); renderOverview(flow); renderIncome(flow); renderPaycheck(flow); renderGoals(flow); renderCashflow(flow); saveState(); }

function renderOverview({ income, tax, savedWeekly, groupGoals, pay }) {
  const soon = groupGoals.soonest;
  document.getElementById('overview').innerHTML = `<div class="grid">
    <div class="card"><h3>💰 Weekly Snapshot</h3><div class="kv"><span>Weekly Income</span><strong>$${fmt(income.weeklyIncome)}</strong></div><div class="kv"><span>After-tax</span><strong>$${fmt(tax.takeHome)}</strong></div><div class="kv"><span>Savings/week</span><strong class="value accent">$${fmt(savedWeekly)}</strong></div></div>
    <div class="card"><h3>🗓️ Pay Frequencies</h3><div class="kv"><span>Weekly</span><strong>$${fmt(pay.takeHome.weekly)}</strong></div><div class="kv"><span>Biweekly</span><strong>$${fmt(pay.takeHome.biweekly)}</strong></div><div class="kv"><span>Monthly</span><strong>$${fmt(pay.takeHome.monthly)}</strong></div><div class="kv"><span>Yearly</span><strong>$${fmt(pay.takeHome.yearly)}</strong></div></div>
    <div class="card"><h3>🎯 Group Goal Radar</h3>${soon ? `<div class="small">Next item to buy</div><div class="value accent">${soon.name}</div><div class="kv"><span>Est. buy date</span><strong>${soon.end ? soon.end.toLocaleDateString() : 'N/A'}</strong></div>` : '<div class="small">Add a goal to begin smart plan.</div>'}</div>
    <div class="card"><h3>💵 Take-home Preview</h3><div class="kv"><span>Gross</span><strong>$${fmt(income.weeklyIncome)}</strong></div><div class="kv"><span>Taxes + Deductions</span><strong class="value warn">$${fmt(income.weeklyIncome - tax.takeHome)}</strong></div><div class="kv"><span>Final Pay</span><strong class="value accent">$${fmt(tax.takeHome)}</strong></div></div>
  </div>`;
}

function renderIncome({ income }) {
  document.getElementById('income').innerHTML = `<div class="card"><h3>Income Streams</h3><div id="streams"></div><button class="primary" id="addStream">+ Add Income Stream</button><p class="small" style="margin-top:10px;">Combined Weekly Income: <strong>$${fmt(income.weeklyIncome)}</strong></p></div>`;
  const wrap = document.getElementById('streams');
  state.incomeStreams.forEach((s) => {
    const div = document.createElement('div'); div.className = 'stream';
    div.innerHTML = `<div class="row"><div><label>Name</label><input data-id="${s.id}" data-field="name" value="${s.name}" /></div><div><label>Type</label><select data-id="${s.id}" data-field="type"><option value="hourly" ${s.type==='hourly'?'selected':''}>Hourly</option><option value="daily" ${s.type==='daily'?'selected':''}>Daily</option></select></div><div><label>Rate ($)</label><input type="number" min="0" step="0.01" data-id="${s.id}" data-field="rate" value="${s.rate}" /></div><div><label>${s.type==='hourly' ? 'Hours/week' : 'Days/week'}</label><input type="number" min="0" step="0.1" data-id="${s.id}" data-field="units" value="${s.units}" /></div><button class="danger" data-del="${s.id}">Delete</button></div>`;
    wrap.appendChild(div);
  });
  document.querySelectorAll('#income input, #income select').forEach((el) => el.addEventListener('change', onStreamEdit));
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { state.incomeStreams = state.incomeStreams.filter((s) => s.id !== b.dataset.del); render(); }));
  document.getElementById('addStream').onclick = () => { state.incomeStreams.push({ id: crypto.randomUUID(), name: 'New Stream', type: 'hourly', rate: 0, units: 0 }); render(); };
}

function renderPaycheck({ income, tax, pay }) {
  const options = [...statesByTier.zero, ...statesByTier.low, ...statesByTier.mid, ...statesByTier.high];
  document.getElementById('paycheck').innerHTML = `<div class="card"><h3>Paycheck Breakdown</h3><div class="row"><div><label>State</label><select id="stateSel">${options.map((s)=>`<option ${s===state.tax.state?'selected':''}>${s}</option>`).join('')}</select></div><div><label>Age Adjustment</label><select id="ageSel"><option value="no" ${!state.tax.under18?'selected':''}>18+</option><option value="yes" ${state.tax.under18?'selected':''}>Under 18</option></select></div></div>
  <h3 style="margin-top:12px;">Custom Deductions</h3><div id="deductionRows"></div><button class="ghost" id="addDeduction">+ Add Deduction</button><div class="small" style="margin:8px 0;">Recommended: Health Insurance, Retirement, Transit.</div>
  <div class="kv"><span>Gross Pay (weekly)</span><strong>$${fmt(income.weeklyIncome)}</strong></div><div class="kv"><span>Federal Tax (${(tax.fedRate*100).toFixed(1)}%)</span><strong>-$${fmt(tax.federalTax)}</strong></div><div class="kv"><span>State Tax (${(tax.stateRate*100).toFixed(1)}%)</span><strong>-$${fmt(tax.stateTax)}</strong></div><div class="kv"><span>Payroll Tax (7.65%)</span><strong>-$${fmt(tax.payrollTax)}</strong></div><div class="kv"><span>Optional Deductions</span><strong>-$${fmt(tax.optional)}</strong></div><hr style="border-color:#334155"><div class="value accent">Final Take-Home: $${fmt(tax.takeHome)}</div>
  <div class="grid" style="margin-top:12px;"><div class="card"><h3>Weekly</h3><div class="value">$${fmt(pay.takeHome.weekly)}</div></div><div class="card"><h3>Biweekly</h3><div class="value">$${fmt(pay.takeHome.biweekly)}</div></div><div class="card"><h3>Monthly</h3><div class="value">$${fmt(pay.takeHome.monthly)}</div></div><div class="card"><h3>Yearly</h3><div class="value">$${fmt(pay.takeHome.yearly)}</div></div></div></div>`;

  const dw = document.getElementById('deductionRows');
  state.tax.deductions.forEach((d, i) => {
    const row = document.createElement('div'); row.className = 'row stream';
    row.innerHTML = `<div><label>Name</label><input data-ded="${i}" data-field="name" value="${d.name}"></div><div><label>Type</label><select data-ded="${i}" data-field="mode"><option value="fixed" ${d.mode==='fixed'?'selected':''}>Fixed $/week</option><option value="percent" ${d.mode==='percent'?'selected':''}>% of gross</option></select></div><div><label>Amount</label><input type="number" min="0" step="0.01" data-ded="${i}" data-field="value" value="${d.value}"></div><div class="small" style="align-self:center;">Weekly impact: $${fmt(tax.deductionRows[i]?.amount || 0)}</div><button class="danger" data-del-ded="${i}">Delete</button>`;
    dw.appendChild(row);
  });
  bindTaxControls();
}

function renderGoals({ savedWeekly, groupGoals }) {
  document.getElementById('goals').innerHTML = `<div class="card"><h3>Group Goals</h3><div class="row"><div><label>Savings Rate (%)</label><input id="saveRate" type="number" min="0" max="100" value="${state.savingsRate}"></div></div><div id="goalRows"></div><button class="primary" id="addGoal">+ Add Goal Item</button><p class="small">Smart pricing splits your weekly savings across remaining goal balances so all items progress evenly.</p><div class="kv"><span>Total saved per week</span><strong>$${fmt(savedWeekly)}</strong></div></div>`;
  const gw = document.getElementById('goalRows');
  groupGoals.plan.forEach((g, i) => {
    const row = document.createElement('div'); row.className = 'stream';
    row.innerHTML = `<div class="row"><div><label>Item Label</label><input data-goal="${i}" data-field="name" value="${g.name}"></div><div><label>Total Cost ($)</label><input data-goal="${i}" data-field="amount" type="number" min="0" value="${g.amount}"></div><div><label>Already Saved ($)</label><input data-goal="${i}" data-field="current" type="number" min="0" value="${g.current}"></div><button class="danger" data-del-goal="${g.id}">Delete</button></div><div class="kv"><span>Weekly bucket allocation</span><strong>$${fmt(g.weeklyAllocation)}</strong></div><div class="kv"><span>Estimated buy date</span><strong>${g.end ? g.end.toLocaleDateString() : 'N/A'}</strong></div><div class="progress-wrap"><div class="progress" style="width:${g.progress}%"></div></div>`;
    gw.appendChild(row);
  });
  document.getElementById('saveRate').onchange = (e)=>{ state.savingsRate = Number(e.target.value); render(); };
  document.getElementById('addGoal').onclick = ()=>{ state.goals.push({ id: crypto.randomUUID(), name: 'New Item', amount: 0, current: 0 }); render(); };
  document.querySelectorAll('[data-goal]').forEach((el)=>el.addEventListener('change', onGoalEdit));
  document.querySelectorAll('[data-del-goal]').forEach((b)=>b.onclick=()=>{ state.goals = state.goals.filter((g)=>g.id!==b.dataset.delGoal); render(); });
}

function renderCashflow({ savedWeekly }) {
  document.getElementById('cashflow').innerHTML = `<div class="card"><h3>Cash Flow Map</h3><div class="row"><div><label>Timeline</label><select id="weeksSel"><option value="12" ${state.chartWeeks===12?'selected':''}>12 weeks</option><option value="26" ${state.chartWeeks===26?'selected':''}>26 weeks</option><option value="52" ${state.chartWeeks===52?'selected':''}>52 weeks</option></select></div></div><canvas id="flowCanvas" width="1000" height="320"></canvas><p class="small">Projected savings growth from weekly savings contributions.</p></div>`;
  const canvas = document.getElementById('flowCanvas'); const ctx = canvas.getContext('2d'); const weeks = Number(state.chartWeeks)||26;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const left=56,right=970,top=24,bottom=280,h=bottom-top,w=right-left,max=Math.max(1,savedWeekly*weeks);
  ctx.strokeStyle = '#1f2937'; ctx.fillStyle='#94a3b8'; ctx.font='12px system-ui';
  for(let i=0;i<=5;i++){ const y=top+(h/5)*i; ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(right,y); ctx.stroke(); const val=max-(max/5)*i; ctx.fillText(`$${fmt(val)}`,8,y+4); }
  for(let i=0;i<=4;i++){ const wk=Math.round((weeks/4)*i); const x=left+(w/4)*i; ctx.beginPath(); ctx.moveTo(x,top); ctx.lineTo(x,bottom); ctx.stroke(); ctx.fillText(`W${wk}`,x-10,304); }
  ctx.strokeStyle='#22c55e'; ctx.lineWidth=3; ctx.beginPath();
  for(let wk=0;wk<=weeks;wk++){ const x=left+(w/weeks)*wk; const total=savedWeekly*wk; const y=bottom-(Math.min(max,total)/max)*h; if(wk===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); if(wk%Math.max(1,Math.floor(weeks/12))===0){ ctx.fillStyle='#22c55e'; ctx.beginPath(); ctx.arc(x,y,2.5,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.moveTo(x,y);} }
  ctx.stroke();
  ctx.fillStyle='#cbd5e1'; ctx.fillText('Weeks', right-20, 304); ctx.save(); ctx.translate(12,40); ctx.rotate(-Math.PI/2); ctx.fillText('Savings',0,0); ctx.restore();
  document.getElementById('weeksSel').onchange=(e)=>{ state.chartWeeks = Number(e.target.value); render(); };
}

function onStreamEdit(e){ const {id,field}=e.target.dataset; const s=state.incomeStreams.find((x)=>x.id===id); s[field]=field==='name'||field==='type'?e.target.value:Number(e.target.value); render(); }
function bindTaxControls(){
  document.getElementById('stateSel').onchange=(e)=>{state.tax.state=e.target.value;render();};
  document.getElementById('ageSel').onchange=(e)=>{state.tax.under18=e.target.value==='yes';render();};
  document.querySelectorAll('[data-ded]').forEach((el)=>el.onchange=(e)=>{ const i=Number(e.target.dataset.ded); const field=e.target.dataset.field; state.tax.deductions[i][field]=field==='name'||field==='mode'?e.target.value:Number(e.target.value); render(); });
  document.querySelectorAll('[data-del-ded]').forEach((b)=>b.onclick=()=>{ state.tax.deductions.splice(Number(b.dataset.delDed),1); render(); });
  document.getElementById('addDeduction').onclick=()=>{ state.tax.deductions.push({ name:'Custom Deduction', mode:'fixed', value:0 }); render(); };
}
function onGoalEdit(e){ const i=Number(e.target.dataset.goal); const field=e.target.dataset.field; state.goals[i][field]=field==='name'?e.target.value:Number(e.target.value); render(); }

function fmt(n){ return (Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:2}); }
function setTab(tab){ state.activeTab=tab; tabs.forEach((b)=>b.classList.toggle('active', b.dataset.tab===tab)); panels.forEach((p)=>p.classList.toggle('active', p.id===tab)); saveState(); }
function loadState(){ try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; } catch { return defaultState; } }
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
setTab(state.activeTab); render();
