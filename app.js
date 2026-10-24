'use strict';
const KEY='personal-wealth-os-v2',RECOVERY_KEY='personal-wealth-os-recovery-v3',SCHEMA=3;
const empty=()=>({version:SCHEMA,accounts:[],observations:[],transactions:[],plans:[],tax:{profiles:[],holdings:[],pensions:[],disposals:[]}});
function validateData(x){
 if(!x||typeof x!=='object'||![2,3].includes(x.version))throw Error('Unsupported data schema');
 for(const k of ['accounts','observations','transactions','plans'])if(!Array.isArray(x[k]))throw Error('Invalid '+k+' collection');
 if(x.accounts.some(a=>typeof a.id!=='string'||typeof a.name!=='string')||x.observations.some(o=>typeof o.accountId!=='string'||!Number.isSafeInteger(o.balance)))throw Error('Invalid financial records');
 return x;
}
let db,startupError='';
try{
 const raw=localStorage.getItem(KEY);
 if(!raw)db=empty();
 else{const saved=validateData(JSON.parse(raw));if(saved.version===2){
  localStorage.setItem(RECOVERY_KEY,raw);
  db={...saved,version:SCHEMA};localStorage.setItem(KEY,JSON.stringify(db));
 }else db=saved}
}catch(err){startupError=String(err.message||err);db=empty()}

const $=id=>document.getElementById(id),today=()=>new Date().toLocaleDateString('en-CA'),money=n=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n/100),escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const minor=n=>Math.round(Number(n)*100),dateMs=s=>new Date(s+'T12:00:00Z').getTime(),yearDays=(a,b)=>(dateMs(b)-dateMs(a))/86400000;
function persist(){if(startupError)throw Error('Data locked: '+startupError);validateData(db);if(!localStorage.getItem(RECOVERY_KEY)){const old=localStorage.getItem(KEY);if(old)localStorage.setItem(RECOVERY_KEY,old)}localStorage.setItem(KEY,JSON.stringify(db));render();if(typeof editsSinceBackup!=='undefined'){editsSinceBackup++;backupStatus('Unsaved changes since last backup. Export after this update.')}}
function toast(s){$('toast').textContent=s;$('toast').style.display='block';setTimeout(()=>$('toast').style.display='none',3000)}
function getForm(form){return Object.fromEntries(new FormData(form))}
function latest(a){return db.observations.filter(o=>o.accountId===a.id).sort((x,y)=>y.date.localeCompare(x.date))[0]}
function balance(a){return latest(a)?.balance||0}
function observed(a){const os=db.observations.filter(o=>o.accountId===a.id).sort((x,y)=>x.date.localeCompare(y.date));if(os.length<2)return null;const start=os[0],end=os[os.length-1],days=yearDays(start.date,end.date);if(days<30||start.balance<=0||end.balance<=0)return null;const flows=db.transactions.filter(t=>t.accountId===a.id&&t.date>start.date&&t.date<=end.date);const net=flows.reduce((s,t)=>s+t.amount,0);const weighted=flows.reduce((s,t)=>s+t.amount*yearDays(t.date,end.date)/days,0);const denom=start.balance+weighted;if(denom<=0)return null;const r=(end.balance-start.balance-net)/denom;if(r<=-1)return null;return Math.max(-.5,Math.min(.5,Math.pow(1+r,365.25/days)-1))}
function rate(a,adjust){let r=a.rate;const o=observed(a);if(o!==null){if(a.model==='historical')r=o;else if(a.model==='blended')r=.7*a.rate+.3*o}if(a.model!=='fixed'&&a.model!=='debt')r+=adjust;return Math.max(-.5,Math.min(.5,r))}
function monthDate(start,m){const d=new Date(start+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+m);return d.toISOString().slice(0,10)}
function forecast(adjust,scenario){const bals=Object.fromEntries(db.accounts.map(a=>[a.id,balance(a)]));const series=[];const start=today();for(let m=0;m<=480;m++){if(m){const d=monthDate(start,m);for(const a of db.accounts)bals[a.id]=Math.round(bals[a.id]*Math.pow(1+rate(a,adjust),1/12));for(const p of db.plans){if(d<p.start||(p.end&&d>p.end))continue;const elapsed=Math.max(0,yearDays(p.start,d)/365.25);bals[p.accountId]=(bals[p.accountId]||0)+Math.round(p.amount*Math.pow(1+p.escalation,elapsed))}if(scenario&&scenario.accountId&&scenario.amount&&m>=scenario.from*12&&m<=scenario.to*12)bals[scenario.accountId]=(bals[scenario.accountId]||0)+scenario.amount}if(m%12===0){let net=0,liquid=0;for(const a of db.accounts){const v=bals[a.id];net+=a.type==='debt'?-Math.abs(v):v;if(a.accessibility==='liquid'&&a.type!=='debt')liquid+=v}series.push({year:m/12,net,liquid})}}return series}
function render(){taxRender();const net=db.accounts.reduce((s,a)=>s+(a.type==='debt'?-Math.abs(balance(a)):balance(a)),0);const liquid=db.accounts.reduce((s,a)=>s+(a.type!=='debt'&&a.accessibility==='liquid'?balance(a):0),0);$('net').textContent=money(net);$('liquid').textContent=money(liquid);$('count').textContent=db.accounts.length;refreshScenarioAccounts();const scenarios=scenarioForecasts();$('future').textContent=money(scenarios[1][20].net);draw(scenarios);renderScenarioSummary(scenarios);renderMonthly();const accountRows=db.accounts.map(a=>`<button type="button" class="account-entry" data-account-id="${escapeHTML(a.id)}"><span><strong>${escapeHTML(a.name)}</strong><br><small>${escapeHTML(a.institution||'')} · ${escapeHTML(a.owner||'')} · ${escapeHTML(a.purpose||a.type)}</small></span><span><strong>${money(a.type==='debt'?-Math.abs(balance(a)):balance(a))}</strong><br><small>Details →</small></span></button>`).join('');$('accountList').innerHTML=accountRows||'<p class="muted">Add your first account above.</p>';$('summaryAccounts').innerHTML=accountRows||'<p class="muted">No accounts yet.</p>';
const opts=db.accounts.map(a=>`<option value="${a.id}">${escapeHTML(a.name)}</option>`).join('');for(const id of ['reviewAccount','planAccount','transferFrom','transferTo']){const el=$(id),prev=el.value;el.innerHTML=opts;if([...el.options].some(o=>o.value===prev))el.value=prev}
$('observations').innerHTML=db.observations.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20).map(o=>`<div class="row"><div><strong>${escapeHTML(db.accounts.find(a=>a.id===o.accountId)?.name||'Deleted')}</strong><br><small>${o.date} · ${escapeHTML(o.notes)}</small></div><strong>${money(o.balance)}</strong></div>`).join('')||'<p class="muted">No observations yet.</p>';
$('planList').innerHTML=db.plans.map(p=>`<div class="row"><div><strong>${escapeHTML(p.name)}</strong><br><small>${escapeHTML(db.accounts.find(a=>a.id===p.accountId)?.name)} · from ${p.start}</small></div><strong>${money(p.amount)}/mo</strong></div>`).join('')||'<p class="muted">No recurring plans yet.</p>'}

function monthEnd(ym){const [y,m]=ym.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)}
function monthlyPosition(date){
 const groups={cash:0,investment:0,pension:0,property:0,private:0,other:0,debt:0};let net=0,covered=0;
 for(const a of db.accounts){const o=db.observations.filter(x=>x.accountId===a.id&&x.date<=date).sort((x,y)=>y.date.localeCompare(x.date))[0];if(!o)continue;covered++;const v=a.type==='debt'?-Math.abs(o.balance):o.balance;net+=v;groups[a.type in groups?a.type:'other']+=v}
 return {net,covered,groups}
}
function renderMonthly(){
 const input=$('reviewMonth');if(!input)return;if(!input.value)input.value=today().slice(0,7);
 const end=monthEnd(input.value),prev=monthEnd(new Date(Date.UTC(Number(input.value.slice(0,4)),Number(input.value.slice(5,7))-2,1)).toISOString().slice(0,7));
 const now=monthlyPosition(end),before=monthlyPosition(prev);
 $('monthNet').textContent=money(now.net);$('monthChange').textContent=now.covered===db.accounts.length&&before.covered===db.accounts.length?money(now.net-before.net):'Insufficient history';
 $('monthCoverage').textContent=now.covered+' of '+db.accounts.length+' accounts';
 const rows=db.accounts.map(a=>{const obs=db.observations.filter(o=>o.accountId===a.id&&o.date<=end).sort((x,y)=>y.date.localeCompare(x.date))[0];const old=db.observations.filter(o=>o.accountId===a.id&&o.date<=prev).sort((x,y)=>y.date.localeCompare(x.date))[0];
 const flows=old&&obs?db.transactions.filter(t=>t.accountId===a.id&&t.date>old.date&&t.date<=obs.date).reduce((n,t)=>n+t.amount,0):null;
 const change=old&&obs?obs.balance-old.balance:null;const residual=change!==null&&flows!==null?change-flows:null;
 const status=!obs?'Missing':obs.date.slice(0,7)===input.value?'Updated':'Carried forward';
 return '<div class="row"><div><strong>'+escapeHTML(a.name)+'</strong><br><small>'+status+(obs?' · '+obs.date:'')+'</small></div><div style="text-align:right"><strong>'+(obs?money(obs.balance):'—')+'</strong><br><small>'+(change===null?'No comparable history':'Change '+money(change)+' · Flows '+money(flows)+' · Unexplained '+money(residual))+'</small></div></div>'}).join('');
 $('monthAccounts').innerHTML=rows||'<p class="muted">Add an account to begin.</p>';
 const points=[];for(let i=11;i>=0;i--){const [y,m]=input.value.split('-').map(Number);const d=new Date(Date.UTC(y,m-1-i,1));const key=d.toISOString().slice(0,7);const pos=monthlyPosition(monthEnd(key));points.push({month:key,net:pos.covered===db.accounts.length&&db.accounts.length?pos.net:null})}
 const valid=points.filter(x=>x.net!==null);$('monthHistory').innerHTML=valid.length?valid.map(x=>'<div class="row"><small>'+x.month+'</small><strong>'+money(x.net)+'</strong></div>').join(''):'<p class="muted">History appears once every account has a balance at a month-end.</p>';
 $('monthNote').textContent='Changes minus recorded cash flows are unexplained movements, not verified investment returns. Carried-forward balances may be stale.';
}
$('reviewMonth').addEventListener('change',renderMonthly);

function refreshScenarioAccounts(){
 const el=$('scenarioAccount');if(!el)return;
 const previous=el.value;
 el.innerHTML=db.accounts.map(a=>'<option value="'+escapeHTML(a.id)+'">'+escapeHTML(a.name)+'</option>').join('');
 if(db.accounts.some(a=>a.id===previous))el.value=previous;
 else{const liquid=db.accounts.find(a=>a.accessibility==='liquid'&&a.type!=='debt');if(liquid)el.value=liquid.id}
}
function scenarioInput(){
 const account=$('scenarioAccount'),amount=$('scenarioAmount'),from=$('scenarioFrom'),to=$('scenarioTo');
 if(!account||!amount||!from||!to)return null;
 const monthly=Number(amount.value),start=Number(from.value),end=Number(to.value);
 if(!db.accounts.some(a=>a.id===account.value)||!Number.isFinite(monthly)||!Number.isInteger(start)||!Number.isInteger(end)||start<1||end>40||end<start)return null;
 return {accountId:account.value,amount:Math.round(monthly*100),from:start,to:end};
}
function scenarioForecasts(){const s=scenarioInput();return [forecast(-.025,s),forecast(0,s),forecast(.025,s)]}
function renderScenarioSummary(series){
 const el=$('scenarioSummary');if(!el)return;
 if(!db.accounts.length){el.textContent='Add an account to explore a scenario.';return}
 const s=scenarioInput();if(!s){el.textContent='Enter valid years from 1 to 40, with the end no earlier than the start.';return}
 const baseline=forecast(0),delta=series[1][20].net-baseline[20].net;
 const negative=series[1].find(x=>x.liquid<0);
 el.textContent='20-year net worth change versus existing plans: '+money(delta)+(negative?' · Warning: projected accessible balance falls below zero by year '+negative.year+'.':'')+' · Illustrative only: no funding, tax or access constraints are enforced.';
}
function updateScenario(){const series=scenarioForecasts();$('future').textContent=money(series[1][20].net);draw(series);renderScenarioSummary(series)}
function setupScenario(){for(const id of ['scenarioAmount','scenarioFrom','scenarioTo','scenarioAccount'])$(id).addEventListener('input',updateScenario)}
let selectedProjectionYear=20,latestProjectionSeries=null;
function projectionAtYear(series,year){return series.map(s=>s[year]?.net??0)}
function selectProjectionYear(year){
 selectedProjectionYear=Math.max(0,Math.min(40,Math.round(year)));
 if(latestProjectionSeries)draw(latestProjectionSeries);
}
function draw(series){
 latestProjectionSeries=series;
 const svg=$('chart'),vals=series.flatMap(s=>s.map(x=>x.net));
 let lo=Math.min(0,...vals),hi=Math.max(1,...vals);if(hi===lo)hi++;
 const colors=['#f59e72','#6ca6ff','#5dd6a2'],x=selectedProjectionYear/40*330+5;
 const y=v=>210-(v-lo)/(hi-lo)*195;
 svg.innerHTML=series.map((s,i)=>`<polyline fill="none" stroke="${colors[i]}" stroke-width="2.5" points="${s.map((p,j)=>`${(j/40*330+5).toFixed(1)},${y(p.net).toFixed(1)}`).join(' ')}"/>`).join('')+
 `<line x1="${x}" x2="${x}" y1="8" y2="210" stroke="#dce8f8" stroke-dasharray="4 4" stroke-width="1.5"/>`+
 series.map((s,i)=>`<circle cx="${x}" cy="${y(s[selectedProjectionYear].net)}" r="4" fill="${colors[i]}" stroke="#0c1421" stroke-width="1.5"/>`).join('')+
 `<text x="5" y="218" fill="#9fb0c7" font-size="11">Today</text><text x="302" y="218" fill="#9fb0c7" font-size="11">+40y</text>`;
 const values=projectionAtYear(series,selectedProjectionYear);
 $('projectionYear').textContent=selectedProjectionYear===0?'Today':'Year '+selectedProjectionYear;
 for(let n=0;n<3;n++)$('projectionValue'+n).textContent=money(values[n]);
 $('projectionYearSlider').value=selectedProjectionYear;
}
function initProjectionSelection(){
 const svg=$('chart');
 const pick=e=>{const rect=svg.getBoundingClientRect();if(!rect.width)return;const x=(e.clientX-rect.left)/rect.width*340;selectProjectionYear((x-5)/330*40)};
 svg.addEventListener('pointerdown',e=>{pick(e);if(svg.setPointerCapture)svg.setPointerCapture(e.pointerId)});
 svg.addEventListener('pointermove',e=>{if(e.buttons||e.pressure>0)pick(e)});
 $('projectionYearSlider').addEventListener('input',e=>selectProjectionYear(Number(e.target.value)));
}
function validateDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(dateMs(s)))throw Error('Invalid date')}
function handle(id,fn){$(id).addEventListener('submit',e=>{e.preventDefault();try{fn(getForm(e.target));persist();e.target.reset();defaults();toast('Saved on this device')}catch(err){toast('Error: '+err.message)}})}
handle('accountForm',d=>{validateDate(d.date);if(!d.name.trim()||!Number.isFinite(Number(d.balance))||Number(d.balance)<0)throw Error('Invalid account');const id=crypto.randomUUID();db.accounts.push({id,name:d.name.trim(),type:d.type,accessibility:d.accessibility,model:d.model,rate:Number(d.rate)/100});db.observations.push({id:crypto.randomUUID(),accountId:id,date:d.date,balance:minor(d.balance),notes:'Opening balance'})});
handle('reviewForm',d=>{const a=db.accounts.find(a=>a.id===d.accountId);if(!a)throw Error('Choose an account');validateDate(d.date);const prev=latest(a);if(prev&&d.date<=prev.date)throw Error('Observation must be later than latest');if(Number(d.balance)<0)throw Error('Balance must be nonnegative');const f=minor(d.flow||0);if(f){validateDate(d.flowDate||d.date);if(prev&&(d.flowDate||d.date)<=prev.date)throw Error('Cash flow must be after previous observation');if((d.flowDate||d.date)>d.date)throw Error('Cash flow cannot be after observation')}db.observations.push({id:crypto.randomUUID(),accountId:a.id,date:d.date,balance:minor(d.balance),notes:d.notes||''});if(f)db.transactions.push({id:crypto.randomUUID(),accountId:a.id,date:d.flowDate||d.date,amount:f,kind:'external'})});
handle('planForm',d=>{if(!db.accounts.some(a=>a.id===d.accountId))throw Error('Choose account');validateDate(d.start);if(d.end){validateDate(d.end);if(d.end<d.start)throw Error('End before start')}db.plans.push({id:crypto.randomUUID(),name:d.name,accountId:d.accountId,amount:minor(d.amount),start:d.start,end:d.end,escalation:Number(d.escalation)/100})});
handle('transferForm',d=>{if(d.from===d.to)throw Error('Choose two different accounts');if(!db.accounts.some(a=>a.id===d.from)||!db.accounts.some(a=>a.id===d.to))throw Error('Choose accounts');validateDate(d.date);const amt=minor(d.amount);if(amt<=0)throw Error('Amount must be positive');const group=crypto.randomUUID();db.transactions.push({id:crypto.randomUUID(),group,accountId:d.from,date:d.date,amount:-amt,kind:'transfer'},{id:crypto.randomUUID(),group,accountId:d.to,date:d.date,amount:amt,kind:'transfer'})});
function defaults(){document.querySelectorAll('input[type="date"]').forEach(el=>{if(!el.value&&!['end','flowDate'].includes(el.name))el.value=today()})}
let accountReturnTab='overview',selectedAccountId=null;
function showTab(tab){document.querySelectorAll('main section').forEach(s=>s.classList.add('hide'));$(tab).classList.remove('hide');document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));window.scrollTo(0,0)}
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
function accountDeletionImpact(id){
 const groups=new Set(db.transactions.filter(t=>t.accountId===id&&t.kind==='transfer'&&t.group).map(t=>t.group));
 return {groups,transactions:db.transactions.filter(t=>t.accountId===id||t.kind==='transfer'&&groups.has(t.group))};
}
function openAccount(id){
 const account=db.accounts.find(a=>a.id===id);if(!account)return;
 const active=document.querySelector('nav button.active');if(active)accountReturnTab=active.dataset.tab;
 selectedAccountId=id;const f=$('accountDetailForm');
 for(const key of ['name','institution','owner','purpose','type','accessibility','model'])f.elements[key].value=account[key]||({type:'other',accessibility:'restricted',model:'assumed'}[key]||'');
 f.elements.rate.value=(Number(account.rate)||0)*100;
 $('detailHeading').textContent=account.name;
 $('detailBalance').textContent=money(account.type==='debt'?-Math.abs(balance(account)):balance(account));
 $('detailHistory').innerHTML=db.observations.filter(o=>o.accountId===id).sort((x,y)=>y.date.localeCompare(x.date)).map(o=>'<div class="row"><small>'+escapeHTML(o.date)+' · '+escapeHTML(o.notes||'')+'</small><strong>'+money(o.balance)+'</strong></div>').join('')||'<p class="muted">No valuations recorded.</p>';
 $('detailFlows').textContent=db.transactions.filter(t=>t.accountId===id).length+' recorded transaction entries';
 showTab('accountDetail');
}
for(const id of ['summaryAccounts','accountList'])$(id).addEventListener('click',e=>{const b=e.target.closest('[data-account-id]');if(b)openAccount(b.dataset.accountId)});
$('detailBack').addEventListener('click',()=>showTab(accountReturnTab));
$('accountDetailForm').addEventListener('submit',e=>{e.preventDefault();try{
 const account=db.accounts.find(a=>a.id===selectedAccountId);if(!account)throw Error('Account not found');
 const d=getForm(e.target),rate=Number(d.rate);
 if(!d.name.trim()||!Number.isFinite(rate)||rate< -50||rate>100)throw Error('Check name and rate');
 if(!['cash','investment','pension','property','debt','private','other'].includes(d.type)||!['liquid','restricted'].includes(d.accessibility)||!['blended','fixed','assumed','historical','debt'].includes(d.model))throw Error('Invalid account properties');
 Object.assign(account,{name:d.name.trim(),institution:d.institution.trim(),owner:d.owner.trim(),purpose:d.purpose.trim(),type:d.type,accessibility:d.accessibility,model:d.model,rate:rate/100});
 persist();openAccount(account.id);toast('Account updated');
 }catch(err){toast(err.message)}});
$('detailUpdateBalance').addEventListener('click',()=>{showTab('review');$('reviewAccount').value=selectedAccountId});
$('detailDelete').addEventListener('click',()=>{
 const account=db.accounts.find(a=>a.id===selectedAccountId);if(!account)return;
 const impact=accountDeletionImpact(account.id);
 const observations=db.observations.filter(o=>o.accountId===account.id).length;
 const plans=db.plans.filter(x=>x.accountId===account.id).length;
 const holdings=taxState().holdings.filter(x=>x.accountId===account.id).length;
 const pensions=taxState().pensions.filter(x=>x.accountId===account.id).length;
 if(!confirm('Delete '+account.name+' and '+observations+' valuations, '+impact.transactions.length+' transaction entries (including '+impact.groups.size+' complete linked transfers), '+plans+' plans, '+holdings+' holdings and '+pensions+' pension records? Other accounts\' recorded balances will not change. Export a backup first.'))return;
 db.accounts=db.accounts.filter(x=>x.id!==account.id);
 db.observations=db.observations.filter(x=>x.accountId!==account.id);
 const remove=new Set(impact.transactions.map(x=>x.id));db.transactions=db.transactions.filter(x=>!remove.has(x.id));
 db.plans=db.plans.filter(x=>x.accountId!==account.id);
 taxState().holdings=taxState().holdings.filter(x=>x.accountId!==account.id);
 taxState().pensions=taxState().pensions.filter(x=>x.accountId!==account.id);
 selectedAccountId=null;persist();showTab(accountReturnTab);toast('Account deleted');
});
// Portable text backups are JSON wrapped in readable headings. They can be pasted into Google Docs.

/* Tax profile and holdings: all amounts are GBP minor units unless otherwise noted. */
function taxState(){if(!db.tax)db.tax={profiles:[],holdings:[],pensions:[]};for(const k of ['profiles','holdings','pensions','disposals'])if(!Array.isArray(db.tax[k]))db.tax[k]=[];return db.tax}
function taxYear(date){const d=new Date(date+'T12:00:00Z'),y=d.getUTCFullYear();return d.getUTCMonth()>3||(d.getUTCMonth()===3&&d.getUTCDate()>=6)?y:y-1}
function pounds(n){return money(Math.round(n*100))}
function taxIncome(profile){
 const gross=Math.max(0,Number(profile.salary)||0)+Math.max(0,Number(profile.bonus)||0)+Math.max(0,Number(profile.other)||0);
 const deductions=Math.max(0,Number(profile.deductions)||0);
 const interest=Math.max(0,Number(profile.interest)||0),dividends=Math.max(0,Number(profile.dividends)||0);
 const ani=Math.max(0,gross+interest+dividends-deductions);
 const pa=Math.max(0,12570-Math.max(0,ani-100000)/2);
 const taxable=Math.max(0,gross-deductions-pa);
 const basic=Math.min(taxable,37700),higher=Math.min(Math.max(0,taxable-37700),87440),additional=Math.max(0,taxable-125140);
 const tax=basic*.2+higher*.4+additional*.45;
 return {gross,ani,pa,tax,taxable,band:ani>125140?'Additional (45%)':ani>100000?'Higher (personal allowance taper)':ani>50270?'Higher (40%)':ani>12570?'Basic (20%)':'No income tax'};
}
function taxRender(){
 const t=taxState(),owner=$('taxOwner');if(!owner)return;
 const current=owner.value||'self',year=Number($('taxYear').value)||taxYear(today());
 const profile=t.profiles.find(x=>x.owner===current&&x.year===year);
 for(const name of ['salary','bonus','other','deductions','interest','dividends']){const el=$('tax'+name[0].toUpperCase()+name.slice(1));if(document.activeElement!==el)el.value=profile?.[name]??0}
 const i=taxIncome(profile||{});
 $('taxIncomeResult').innerHTML='<strong>'+pounds(i.ani)+'</strong> adjusted net income · '+escapeHTML(i.band)+'<br>Indicative non-savings income tax: <strong>'+pounds(i.tax)+'</strong> · personal allowance '+pounds(i.pa);
 const options=db.accounts.map(x=>'<option value="'+escapeHTML(x.id)+'">'+escapeHTML(x.name)+'</option>').join('');
 const select=$('taxAccount'),old=select.value;select.innerHTML=options;if([...select.options].some(x=>x.value===old))select.value=old;const ps=$('taxPensionAccount'),po=ps.value;ps.innerHTML=db.accounts.filter(x=>x.type==='pension').map(x=>'<option value="'+escapeHTML(x.id)+'">'+escapeHTML(x.name)+'</option>').join('');if([...ps.options].some(x=>x.value===po))ps.value=po;
 $('taxHoldings').innerHTML=t.holdings.map(x=>{
 const acc=db.accounts.find(a=>a.id===x.accountId),cost=Number(x.cost)||0,value=Number(x.value)||0,eligible=(x.scheme==='eis'||x.scheme==='seis')&&x.eligible==='yes';
 const reliefRate=x.scheme==='seis'?.5:x.scheme==='eis'?.3:0;
 const relief=eligible?cost*reliefRate:0;
 return '<div class="row"><div><strong>'+escapeHTML(x.name)+'</strong><br><small>'+escapeHTML(acc?.name||'Unlinked')+' · '+escapeHTML(x.wrapper)+' · '+escapeHTML(x.scheme.toUpperCase())+' · '+escapeHTML(x.owner)+'</small></div><div><strong>'+pounds(value)+'</strong><br><small>Cost '+pounds(cost)+' · potential initial relief (unverified) '+pounds(relief)+' · claimed '+pounds(Number(x.reliefClaimed)||0)+'</small></div></div>';
 }).join('')||'<p class="muted">No tax-specific holdings recorded.</p>';
 $('taxPensions').innerHTML=t.pensions.map(x=>{
 const account=db.accounts.find(a=>a.id===x.accountId);
 const remaining=Math.max(0,Number(x.lsa??268275)-(Number(x.used)||0));
 const available=Math.min(remaining,Math.max(0,balance(account||{id:'missing'}))/100*.25);
 return '<div class="row"><div><strong>'+escapeHTML(account?.name||'Unlinked pension')+'</strong><br><small>Tax-free lump sum remaining allowance '+pounds(remaining)+'</small></div><strong>Illustrative available '+pounds(available)+'</strong></div>';
 }).join('')||'<p class="muted">No pension allowances recorded.</p>';
 taxExtraRender();renderDisposals();retirementEstimate();
}

const BACKUP_START='----- BEGIN PERSONAL WEALTH OS BACKUP JSON -----';
const BACKUP_END='----- END PERSONAL WEALTH OS BACKUP JSON -----';
let editsSinceBackup=0;
function backupText(){return 'PERSONAL WEALTH OS — PORTABLE BACKUP\nCreated: '+new Date().toISOString()+'\nFormat: Wealth OS v3 JSON. Keep all text between the BEGIN and END markers intact.\n\n'+BACKUP_START+'\n'+JSON.stringify(db,null,2)+'\n'+BACKUP_END+'\n'}
function downloadBackup(contents,extension,mime){const blob=new Blob([contents],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='wealth-os-backup-'+today()+'.'+extension;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);editsSinceBackup=0;backupStatus('Backup prepared — confirm it is saved in Files or Google Docs.')}
function backupStatus(message){$('backupStatus').textContent=message}
function parseBackup(raw){let text=raw.trim();if(text.includes(BACKUP_START)){const start=text.indexOf(BACKUP_START)+BACKUP_START.length;const end=text.indexOf(BACKUP_END,start);if(end<0)throw Error('Backup end marker missing');text=text.slice(start,end).trim()}const incoming=JSON.parse(text);if(![2,3].includes(incoming.version)||!Array.isArray(incoming.accounts)||!Array.isArray(incoming.observations)||!Array.isArray(incoming.transactions)||!Array.isArray(incoming.plans))throw Error('Unrecognised backup format');if(incoming.accounts.some(a=>typeof a.id!=='string'||typeof a.name!=='string')||incoming.observations.some(o=>typeof o.accountId!=='string'||!Number.isSafeInteger(o.balance)))throw Error('Backup contains invalid records');return incoming}
function restoreBackup(raw){const incoming=parseBackup(raw);if(!confirm('Replace ALL data on this device with this backup? Export your current data first if needed.'))return;const previous=db;try{localStorage.setItem(RECOVERY_KEY,JSON.stringify(previous));db={...incoming,version:SCHEMA};startupError='';persist();editsSinceBackup=0;backupStatus('Backup restored. Export a new copy after future edits.');toast('Backup restored')}catch(err){db=previous;throw err}}
$('export').onclick=()=>downloadBackup(JSON.stringify(db,null,2),'json','application/json');
$('exportText').onclick=()=>downloadBackup(backupText(),'txt','text/plain;charset=utf-8');
$('copyBackup').onclick=async()=>{const content=backupText();try{await navigator.clipboard.writeText(content);editsSinceBackup=0;backupStatus('Copied. Paste into Google Docs and ensure the document is saved.');toast('Backup copied')}catch{const field=$('pasteBackup');field.value=content;field.focus();field.select();toast('Select and copy the text below manually')}};
$('import').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;restoreBackup(await file.text())}catch(err){toast('Import failed: '+err.message)}finally{e.target.value=''}};
$('restorePaste').onclick=()=>{try{restoreBackup($('pasteBackup').value)}catch(err){toast('Import failed: '+err.message)}};
$('clear').onclick=()=>{if(startupError){toast('Storage locked; export recovery first');return}if(confirm('Permanently erase all Wealth OS data stored in this browser?')){db=empty();persist();toast('Local data erased')}};
$('schemaStatus').textContent='Schema v'+db.version+(startupError?' — STORAGE LOCKED: '+startupError:'')+(localStorage.getItem(RECOVERY_KEY)?' · Recovery snapshot available':' · No recovery snapshot yet');
$('recoveryExport').onclick=()=>{const raw=localStorage.getItem(RECOVERY_KEY);if(!raw){toast('No recovery snapshot available');return}downloadBackup(raw,'json','application/json')};
$('recoveryRestore').onclick=()=>{const raw=localStorage.getItem(RECOVERY_KEY);if(!raw){toast('No recovery snapshot available');return}if(!confirm('Restore the recovery snapshot? Current data will be replaced. Export your current data first.'))return;try{const recovered=validateData(JSON.parse(raw));localStorage.setItem(KEY,JSON.stringify({...recovered,version:SCHEMA}));location.reload()}catch(err){toast('Recovery failed: '+err.message)}};



/* Tax planning estimates. Enacted 2026/27 England baseline; no future-law projection. */
const TAX_RULES={year:2026,personalAllowance:12570,allowanceTaperStart:100000,allowanceTaperEnd:125140,basicLimit:37700,higherLimit:125140,dividendAllowance:500,savingsAllowanceBasic:1000,savingsAllowanceHigher:500,cgtExemption:3000,cgtBasicRate:.18,cgtHigherRate:.24,pensionAnnualAllowance:60000,standardLSA:268275};
function taxBandSlices(amount,remainingBasic){
 const basic=Math.min(Math.max(0,amount),Math.max(0,remainingBasic));
 return {basic,higher:Math.max(0,amount-basic)};
}
function incomeEstimate(p){
 const base=taxIncome(p),interest=Math.max(0,Number(p.interest)||0),dividends=Math.max(0,Number(p.dividends)||0);
 // Non-savings income uses the bands first; savings then dividends.
 // The starting rate for savings can be available when other income is low.
 const startingRate=Math.max(0,5000-Math.max(0,base.taxable));
 const startingUsed=Math.min(interest,startingRate);
 const remainingInterest=interest-startingUsed;
 const savingsAllowance=base.ani>125140?0:base.ani>50270?500:1000;
 const interestAllowance=Math.min(remainingInterest,savingsAllowance);
 const interestChargeable=Math.max(0,remainingInterest-interestAllowance);
 const savingsBasic=Math.min(interestChargeable,Math.max(0,37700-base.taxable-startingUsed-interestAllowance));
 const savingsHigher=Math.min(Math.max(0,interestChargeable-savingsBasic),Math.max(0,125140-Math.max(37700,base.taxable+interest)-savingsBasic));
 const savingsAdditional=Math.max(0,interestChargeable-savingsBasic-savingsHigher);
 const interestTax=savingsBasic*.2+savingsHigher*.4+savingsAdditional*.45;
 const dividendAllowance=Math.min(dividends,500);
 const dividendChargeable=Math.max(0,dividends-dividendAllowance);
 const occupied=base.taxable+interest;
 const dividendBasic=Math.min(dividendChargeable,Math.max(0,37700-occupied));
 const dividendHigher=Math.min(Math.max(0,dividendChargeable-dividendBasic),Math.max(0,125140-Math.max(37700,occupied)-dividendBasic));
 const dividendAdditional=Math.max(0,dividendChargeable-dividendBasic-dividendHigher);
 const dividendTax=dividendBasic*.1075+dividendHigher*.3575+dividendAdditional*.3935;
 return {...base,interestTax,dividendTax,totalTax:base.tax+interestTax+dividendTax,savingsAllowance,dividendAllowance:500};
}
function disposalEstimate(h,proceeds,cost,yearProfile,losses=0){
 const gain=Math.max(0,proceeds-cost),exempt=Math.max(0,gain-Math.max(0,losses)-TAX_RULES.cgtExemption);
 const tax=incomeEstimate(yearProfile||{}),basicRemaining=Math.max(0,TAX_RULES.basicLimit-Math.max(0,tax.gross-(Number(yearProfile?.deductions)||0)-tax.pa));
 const split=taxBandSlices(exempt,basicRemaining);
 const conditional=(h.wrapper==='isa'||h.wrapper==='sipp'||h.wrapper==='workplace')?'wrapper':(h.scheme==='eis'||h.scheme==='seis')&&h.eligible==='yes'&&h.issueDate&&((dateMs(today())-dateMs(h.issueDate))/86400000)>=365.25*3?'review':'none';
 return {gain,taxable:conditional==='wrapper'?0:exempt,estimate:conditional==='wrapper'?0:split.basic*.18+split.higher*.24,conditional};
}
function pensionScenario(pensionValue,withdrawal,lsa,used){
 const requested=Math.min(Math.max(0,withdrawal),Math.max(0,pensionValue));
 const available=Math.max(0,lsa-used);
 const taxFree=Math.min(requested*.25,available);
 return {taxFree,taxable:requested-taxFree,remaining:Math.max(0,pensionValue-requested)};
}
function taxExtraRender(){
 const t=taxState(),owner=$('taxOwner').value,year=Number($('taxYear').value),p=t.profiles.find(x=>x.owner===owner&&x.year===year)||{};
 const result=incomeEstimate(p),el=$('taxExtendedResult');
 el.innerHTML=(year!==2026?'<strong>Warning: calculations use 2026/27 rates, not the selected tax year.</strong><br>':'')+'Estimated income tax including savings/dividends: <strong>'+pounds(result.totalTax)+'</strong><br><small>Non-savings '+pounds(result.tax)+' · savings '+pounds(result.interestTax)+' · dividends '+pounds(result.dividendTax)+'</small>';
 const list=$('taxHoldingActions');
 list.innerHTML=t.holdings.map(x=>{
 const cost=Number(x.cost)||0,value=Number(x.value)||0,d=disposalEstimate(x,value,cost,p);
 return '<div class="row"><div><strong>'+escapeHTML(x.name)+'</strong><br><small>Illustrative gain '+pounds(d.gain)+' · '+(d.conditional==='wrapper'?'Tax-exempt wrapper':d.conditional==='review'?'EIS/SEIS: review conditions · provisional CGT '+pounds(d.estimate):'Estimated CGT '+pounds(d.estimate))+'</small></div><div><button type="button" data-tax-edit="'+escapeHTML(x.id)+'">Edit</button> <button type="button" data-tax-delete="'+escapeHTML(x.id)+'">Delete</button></div></div>';
 }).join('');
 const selected=$('taxPensionAccount').value,account=db.accounts.find(x=>x.id===selected);
 const record=t.pensions.find(x=>x.accountId===selected)||{};
 const scenario=pensionScenario(account?balance(account)/100:0,Number($('taxWithdrawal').value)||0,Number(record.lsa??268275),Number(record.used)||0);
 $('taxWithdrawalResult').textContent='Illustrative tax-free cash '+pounds(scenario.taxFree)+' · potentially taxable pension withdrawal '+pounds(scenario.taxable)+' · remaining pension '+pounds(scenario.remaining)+'. Taxable withdrawal is not yet converted into an income tax bill.';
}


function annualCGT(owner,year){
 const t=taxState(),items=t.disposals.filter(x=>x.owner===owner&&taxYear(x.date)===year);
 const gains=items.reduce((n,x)=>n+Math.max(0,Number(x.proceeds)-Number(x.cost)),0);
 const losses=items.reduce((n,x)=>n+Math.max(0,Number(x.cost)-Number(x.proceeds)),0);
 const taxable=Math.max(0,gains-losses-3000);
 const profile=t.profiles.find(x=>x.owner===owner&&x.year===year)||{},income=incomeEstimate(profile);
 const basicRemaining=Math.max(0,37700-income.taxable-(Number(profile.interest)||0)-(Number(profile.dividends)||0));
 const basic=Math.min(taxable,basicRemaining);
 return {count:items.length,gains,losses,taxable,tax:basic*.18+(taxable-basic)*.24};
}
function renderDisposals(){
 const owner=$('taxOwner').value,year=Number($('taxYear').value),t=taxState(),result=annualCGT(owner,year);
 $('taxCGTResult').textContent='Disposals '+result.count+' · Gains '+pounds(result.gains)+' · losses '+pounds(result.losses)+' · taxable '+pounds(result.taxable)+' · indicative CGT '+pounds(result.tax);
 $('taxDisposals').innerHTML=t.disposals.filter(x=>x.owner===owner&&taxYear(x.date)===year).map(x=>'<div class="row"><div><strong>'+escapeHTML(x.name)+'</strong><br><small>'+escapeHTML(x.date)+' · proceeds '+pounds(Number(x.proceeds))+' · cost '+pounds(Number(x.cost))+'</small></div><button type="button" data-remove-disposal="'+escapeHTML(x.id)+'">Delete</button></div>').join('')||'<p class="muted">No taxable disposals recorded for this year.</p>';
}
function initDisposals(){
 $('taxDisposalForm').addEventListener('submit',e=>{e.preventDefault();try{
 const d=getForm(e.target);validateDate(d.date);
 if(!d.name.trim()||!['self','spouse'].includes(d.owner))throw Error('Invalid disposal');
 for(const k of ['cost','proceeds'])if(!Number.isFinite(Number(d[k]))||Number(d[k])<0)throw Error('Invalid amount');
 taxState().disposals.push({...d,id:crypto.randomUUID()});persist();e.target.reset();toast('Disposal saved');
 }catch(err){toast(err.message)}});
 $('taxDisposals').addEventListener('click',e=>{const button=e.target.closest('[data-remove-disposal]');if(!button)return;if(!confirm('Delete this disposal?'))return;taxState().disposals=taxState().disposals.filter(x=>x.id!==button.dataset.removeDisposal);persist()});
}


function pensionAnnualAllowance(p){
 const threshold=Number(p.thresholdIncome)||0,adjusted=Number(p.adjustedIncome)||0;
 const reduction=threshold>200000&&adjusted>260000?Math.min(50000,Math.floor((adjusted-260000)/2)):0;
 return Math.max(10000,60000-reduction);
}
function retirementEstimate(){
 const t=taxState(),account=db.accounts.find(x=>x.id===$('taxPensionAccount').value);
 const owner=$('taxOwner').value,year=Number($('taxYear').value);
 const p=t.profiles.find(x=>x.owner===owner&&x.year===year)||{};
 const rec=t.pensions.find(x=>x.accountId===account?.id)||{};
 const amount=Number($('taxWithdrawal').value)||0;
 const split=pensionScenario(account?balance(account)/100:0,amount,Number(rec.lsa??268275),Number(rec.used)||0);
 const without=incomeEstimate(p);
 const withWithdrawal=incomeEstimate({...p,other:(Number(p.other)||0)+split.taxable});
 const additionalTax=Math.max(0,withWithdrawal.totalTax-without.totalTax);
 $('taxRetirementResult').textContent='Illustrative extra Income Tax '+pounds(additionalTax)+' · after-tax withdrawal '+pounds(split.taxFree+split.taxable-additionalTax)+'. Assumes 25% PCLS-style tax-free cash on this withdrawal and no prior crystallisation restrictions beyond the entered allowance.';
 const allowance=pensionAnnualAllowance(rec);
 $('taxAnnualAllowance').textContent='Indicative annual pension allowance '+pounds(allowance)+' before carry-forward, MPAA, defined-benefit adjustments or other restrictions.';
}

function taxForms(){
 $('taxYear').value=taxYear(today());
 for(const id of ['taxOwner','taxYear'])$(id).addEventListener('change',taxRender);
 $('taxProfileForm').addEventListener('submit',e=>{e.preventDefault();try{const d=getForm(e.target),t=taxState(),year=Number(d.year);if(!Number.isInteger(year)||year<2024||year>2100)throw Error('Invalid tax year');for(const k of ['salary','bonus','other','deductions','interest','dividends'])if(!Number.isFinite(Number(d[k]))||Number(d[k])<0)throw Error('Invalid amount');t.profiles=t.profiles.filter(x=>x.owner!==d.owner||x.year!==year);t.profiles.push({...d,year});persist();toast('Tax profile saved')}catch(err){toast(err.message)}});
 $('taxHoldingForm').addEventListener('submit',e=>{e.preventDefault();try{const d=getForm(e.target);if(!db.accounts.some(x=>x.id===d.accountId))throw Error('Choose account');validateDate(d.issueDate);for(const k of ['cost','value','reliefClaimed'])if(!Number.isFinite(Number(d[k]))||Number(d[k])<0)throw Error('Invalid holding amount');const t=taxState(),id=$('taxHoldingEditId').value||crypto.randomUUID();t.holdings=t.holdings.filter(x=>x.id!==id);t.holdings.push({...d,id});persist();e.target.reset();$('taxHoldingEditId').value='';toast('Holding saved')}catch(err){toast(err.message)}});
 $('taxWithdrawal').addEventListener('input',()=>{taxExtraRender();retirementEstimate()});
 $('taxPensionAccount').addEventListener('change',()=>{taxExtraRender();retirementEstimate()});
 $('taxHoldingActions').addEventListener('click',e=>{
  const edit=e.target.closest('[data-tax-edit]'),del=e.target.closest('[data-tax-delete]');if(!edit&&!del)return;
  const id=(edit||del).dataset[edit?'taxEdit':'taxDelete'],t=taxState(),item=t.holdings.find(x=>x.id===id);if(!item)return;
  if(del){if(!confirm('Delete tax metadata for '+item.name+'? This will not remove the linked wealth account.'))return;t.holdings=t.holdings.filter(x=>x.id!==id);persist();return}
  const form=$('taxHoldingForm');for(const [key,value] of Object.entries(item)){const input=form.elements.namedItem(key);if(input)input.value=value}
  $('taxHoldingEditId').value=id;form.scrollIntoView({behavior:'smooth',block:'start'});toast('Editing '+item.name);
 });
 $('taxPensionForm').addEventListener('submit',e=>{e.preventDefault();try{const d=getForm(e.target),t=taxState();if(!db.accounts.some(x=>x.id===d.accountId&&x.type==='pension'))throw Error('Choose pension');if(Number(d.lsa)<0||Number(d.used)<0||!Number.isFinite(Number(d.lsa)+Number(d.used)))throw Error('Invalid allowance');t.pensions=t.pensions.filter(x=>x.accountId!==d.accountId);t.pensions.push(d);persist();toast('Pension allowance saved')}catch(err){toast(err.message)}});
}
taxForms();initDisposals();defaults();setupScenario();initProjectionSelection();render();if(startupError)alert('WealthBrain storage error: '+startupError+'. Do not edit or erase data. Export the recovery snapshot or restore a verified backup.');if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
