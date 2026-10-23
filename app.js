'use strict';
const KEY='personal-wealth-os-v2',RECOVERY_KEY='personal-wealth-os-recovery-v3',SCHEMA=3;
const empty=()=>({version:SCHEMA,accounts:[],observations:[],transactions:[],plans:[],tax:{profiles:[],holdings:[],pensions:[]}});
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
function forecast(adjust){const bals=Object.fromEntries(db.accounts.map(a=>[a.id,balance(a)]));const series=[];const start=today();for(let m=0;m<=480;m++){if(m){const d=monthDate(start,m);for(const a of db.accounts)bals[a.id]=Math.round(bals[a.id]*Math.pow(1+rate(a,adjust),1/12));for(const p of db.plans){if(d<p.start||(p.end&&d>p.end))continue;const elapsed=Math.max(0,yearDays(p.start,d)/365.25);bals[p.accountId]=(bals[p.accountId]||0)+Math.round(p.amount*Math.pow(1+p.escalation,elapsed))}}if(m%12===0){let net=0,liquid=0;for(const a of db.accounts){const v=bals[a.id];net+=a.type==='debt'?-Math.abs(v):v;if(a.accessibility==='liquid'&&a.type!=='debt')liquid+=v}series.push({year:m/12,net,liquid})}}return series}
function render(){taxRender();const net=db.accounts.reduce((s,a)=>s+(a.type==='debt'?-Math.abs(balance(a)):balance(a)),0);const liquid=db.accounts.reduce((s,a)=>s+(a.type!=='debt'&&a.accessibility==='liquid'?balance(a):0),0);$('net').textContent=money(net);$('liquid').textContent=money(liquid);$('count').textContent=db.accounts.length;const scenarios=[forecast(-.025),forecast(0),forecast(.025)];$('future').textContent=money(scenarios[1][20].net);draw(scenarios);renderMonthly();const accountRows=db.accounts.map(a=>`<div class="row"><div><strong>${escapeHTML(a.name)}</strong><br><small>${escapeHTML(a.type)} · ${escapeHTML(a.model)} · ${(a.rate*100).toFixed(1)}%</small></div><div style="text-align:right"><strong>${money(balance(a))}</strong><br><small>${observed(a)===null?'No return history':(observed(a)*100).toFixed(1)+'% observed p.a.'}</small></div></div>`).join('');$('accountList').innerHTML=accountRows||'<p class="muted">Add your first account above.</p>';$('summaryAccounts').innerHTML=accountRows||'<p class="muted">No accounts yet.</p>';
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

function draw(series){const svg=$('chart');const vals=series.flatMap(s=>s.map(x=>x.net));let lo=Math.min(0,...vals),hi=Math.max(1,...vals);if(hi===lo)hi++;const colors=['#f59e72','#6ca6ff','#5dd6a2'];svg.innerHTML=series.map((s,i)=>`<polyline fill="none" stroke="${colors[i]}" stroke-width="2.5" points="${s.map((p,j)=>`${(j/40*330+5).toFixed(1)},${(210-(p.net-lo)/(hi-lo)*195).toFixed(1)}`).join(' ')}"/>`).join('')+`<text x="5" y="218" fill="#9fb0c7" font-size="11">Today</text><text x="302" y="218" fill="#9fb0c7" font-size="11">+40y</text>`}
function validateDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(dateMs(s)))throw Error('Invalid date')}
function handle(id,fn){$(id).addEventListener('submit',e=>{e.preventDefault();try{fn(getForm(e.target));persist();e.target.reset();defaults();toast('Saved on this device')}catch(err){toast('Error: '+err.message)}})}
handle('accountForm',d=>{validateDate(d.date);if(!d.name.trim()||!Number.isFinite(Number(d.balance))||Number(d.balance)<0)throw Error('Invalid account');const id=crypto.randomUUID();db.accounts.push({id,name:d.name.trim(),type:d.type,accessibility:d.accessibility,model:d.model,rate:Number(d.rate)/100});db.observations.push({id:crypto.randomUUID(),accountId:id,date:d.date,balance:minor(d.balance),notes:'Opening balance'})});
handle('reviewForm',d=>{const a=db.accounts.find(a=>a.id===d.accountId);if(!a)throw Error('Choose an account');validateDate(d.date);const prev=latest(a);if(prev&&d.date<=prev.date)throw Error('Observation must be later than latest');if(Number(d.balance)<0)throw Error('Balance must be nonnegative');const f=minor(d.flow||0);if(f){validateDate(d.flowDate||d.date);if(prev&&(d.flowDate||d.date)<=prev.date)throw Error('Cash flow must be after previous observation');if((d.flowDate||d.date)>d.date)throw Error('Cash flow cannot be after observation')}db.observations.push({id:crypto.randomUUID(),accountId:a.id,date:d.date,balance:minor(d.balance),notes:d.notes||''});if(f)db.transactions.push({id:crypto.randomUUID(),accountId:a.id,date:d.flowDate||d.date,amount:f,kind:'external'})});
handle('planForm',d=>{if(!db.accounts.some(a=>a.id===d.accountId))throw Error('Choose account');validateDate(d.start);if(d.end){validateDate(d.end);if(d.end<d.start)throw Error('End before start')}db.plans.push({id:crypto.randomUUID(),name:d.name,accountId:d.accountId,amount:minor(d.amount),start:d.start,end:d.end,escalation:Number(d.escalation)/100})});
handle('transferForm',d=>{if(d.from===d.to)throw Error('Choose two different accounts');if(!db.accounts.some(a=>a.id===d.from)||!db.accounts.some(a=>a.id===d.to))throw Error('Choose accounts');validateDate(d.date);const amt=minor(d.amount);if(amt<=0)throw Error('Amount must be positive');const group=crypto.randomUUID();db.transactions.push({id:crypto.randomUUID(),group,accountId:d.from,date:d.date,amount:-amt,kind:'transfer'},{id:crypto.randomUUID(),group,accountId:d.to,date:d.date,amount:amt,kind:'transfer'})});
function defaults(){document.querySelectorAll('input[type="date"]').forEach(el=>{if(!el.value&&!['end','flowDate'].includes(el.name))el.value=today()})}
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('main section').forEach(s=>s.classList.add('hide'));$(b.dataset.tab).classList.remove('hide');document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');window.scrollTo(0,0)}));
// Portable text backups are JSON wrapped in readable headings. They can be pasted into Google Docs.

/* Tax profile and holdings: all amounts are GBP minor units unless otherwise noted. */
function taxState(){if(!db.tax)db.tax={profiles:[],holdings:[],pensions:[]};for(const k of ['profiles','holdings','pensions'])if(!Array.isArray(db.tax[k]))db.tax[k]=[];return db.tax}
function taxYear(date){const d=new Date(date+'T12:00:00Z'),y=d.getUTCFullYear();return d.getUTCMonth()>3||(d.getUTCMonth()===3&&d.getUTCDate()>=6)?y:y-1}
function pounds(n){return money(Math.round(n*100))}
function taxIncome(profile){
 const gross=Math.max(0,Number(profile.salary)||0)+Math.max(0,Number(profile.bonus)||0)+Math.max(0,Number(profile.other)||0);
 const deductions=Math.max(0,Number(profile.deductions)||0);
 const ani=Math.max(0,gross-deductions),pa=Math.max(0,12570-Math.max(0,ani-100000)/2);
 const taxable=Math.max(0,gross-pa-deductions);
 const basic=Math.min(taxable,37700),higher=Math.min(Math.max(0,taxable-37700),87440),additional=Math.max(0,taxable-125140);
 return {gross,ani,pa,tax:basic*.2+higher*.4+additional*.45,band:ani>125140?'Additional (45%)':ani>100000?'Higher (60% effective taper)':ani>50270?'Higher (40%)':ani>12570?'Basic (20%)':'No income tax'};
}
function taxRender(){
 const t=taxState(),owner=$('taxOwner');if(!owner)return;
 const current=owner.value||'self',year=Number($('taxYear').value)||taxYear(today());
 const profile=t.profiles.find(x=>x.owner===current&&x.year===year);
 for(const name of ['salary','bonus','other','deductions']){const el=$('tax'+name[0].toUpperCase()+name.slice(1));if(document.activeElement!==el)el.value=profile?.[name]??0}
 const i=taxIncome(profile||{});
 $('taxIncomeResult').innerHTML='<strong>'+pounds(i.ani)+'</strong> adjusted net income · '+escapeHTML(i.band)+'<br>Indicative non-savings income tax: <strong>'+pounds(i.tax)+'</strong> · personal allowance '+pounds(i.pa);
 const options=db.accounts.map(x=>'<option value="'+escapeHTML(x.id)+'">'+escapeHTML(x.name)+'</option>').join('');
 const select=$('taxAccount'),old=select.value;select.innerHTML=options;if([...select.options].some(x=>x.value===old))select.value=old;const ps=$('taxPensionAccount'),po=ps.value;ps.innerHTML=db.accounts.filter(x=>x.type==='pension').map(x=>'<option value="'+escapeHTML(x.id)+'">'+escapeHTML(x.name)+'</option>').join('');if([...ps.options].some(x=>x.value===po))ps.value=po;
 $('taxHoldings').innerHTML=t.holdings.map(x=>{
 const acc=db.accounts.find(a=>a.id===x.accountId),cost=Number(x.cost)||0,value=Number(x.value)||0,eligible=(x.scheme==='eis'||x.scheme==='seis')&&x.eligible==='yes';
 const reliefRate=x.scheme==='seis'?.5:x.scheme==='eis'?.3:0;
 const relief=eligible?cost*reliefRate:0;
 return '<div class="row"><div><strong>'+escapeHTML(x.name)+'</strong><br><small>'+escapeHTML(acc?.name||'Unlinked')+' · '+escapeHTML(x.wrapper)+' · '+escapeHTML(x.scheme.toUpperCase())+' · '+escapeHTML(x.owner)+'</small></div><div><strong>'+pounds(value)+'</strong><br><small>Cost '+pounds(cost)+' · potential initial relief '+pounds(relief)+' · claimed '+pounds(Number(x.reliefClaimed)||0)+'</small></div></div>';
 }).join('')||'<p class="muted">No tax-specific holdings recorded.</p>';
 $('taxPensions').innerHTML=t.pensions.map(x=>{
 const account=db.accounts.find(a=>a.id===x.accountId);
 const remaining=Math.max(0,(Number(x.lsa)||268275)-(Number(x.used)||0));
 const available=Math.min(remaining,Math.max(0,balance(account||{id:'missing'}))/100*.25);
 return '<div class="row"><div><strong>'+escapeHTML(account?.name||'Unlinked pension')+'</strong><br><small>Tax-free lump sum remaining allowance '+pounds(remaining)+'</small></div><strong>Illustrative available '+pounds(available)+'</strong></div>';
 }).join('')||'<p class="muted">No pension allowances recorded.</p>';
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


function taxForms(){
 $('taxYear').value=taxYear(today());
 for(const id of ['taxOwner','taxYear'])$(id).addEventListener('change',taxRender);
 $('taxProfileForm').addEventListener('submit',e=>{e.preventDefault();try{const d=getForm(e.target),t=taxState(),year=Number(d.year);if(!Number.isInteger(year)||year<2024||year>2100)throw Error('Invalid tax year');for(const k of ['salary','bonus','other','deductions'])if(!Number.isFinite(Number(d[k]))||Number(d[k])<0)throw Error('Invalid amount');t.profiles=t.profiles.filter(x=>x.owner!==d.owner||x.year!==year);t.profiles.push({...d,year});persist();toast('Tax profile saved')}catch(err){toast(err.message)}});
 $('taxHoldingForm').addEventListener('submit',e=>{e.preventDefault();try{const d=getForm(e.target);if(!db.accounts.some(x=>x.id===d.accountId))throw Error('Choose account');validateDate(d.issueDate);for(const k of ['cost','value','reliefClaimed'])if(!Number.isFinite(Number(d[k]))||Number(d[k])<0)throw Error('Invalid holding amount');taxState().holdings.push({...d,id:crypto.randomUUID()});persist();e.target.reset();toast('Holding recorded')}catch(err){toast(err.message)}});
 $('taxPensionForm').addEventListener('submit',e=>{e.preventDefault();try{const d=getForm(e.target),t=taxState();if(!db.accounts.some(x=>x.id===d.accountId&&x.type==='pension'))throw Error('Choose pension');if(Number(d.lsa)<0||Number(d.used)<0||!Number.isFinite(Number(d.lsa)+Number(d.used)))throw Error('Invalid allowance');t.pensions=t.pensions.filter(x=>x.accountId!==d.accountId);t.pensions.push(d);persist();toast('Pension allowance saved')}catch(err){toast(err.message)}});
}
taxForms();defaults();render();if(startupError)alert('WealthBrain storage error: '+startupError+'. Do not edit or erase data. Export the recovery snapshot or restore a verified backup.');if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
