'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function extract(name){
 const start=source.indexOf('function '+name+'(');
 assert.ok(start>=0,'Missing function '+name);
 const open=source.indexOf('{',start);
 let depth=0,quote='',escaped=false;
 for(let i=open;i<source.length;i++){
  const c=source[i];
  if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue}
  if(c==='"'||c==="'"||c==='\x60'){quote=c;continue}
  if(c==='{')depth++;
  if(c==='}'&&--depth===0)return source.slice(start,i+1);
 }
 throw Error('Unclosed function '+name);
}
function engine(names,extra={},prelude=''){
 const ctx={Math,Number,Date,JSON,...extra};
 vm.createContext(ctx);
 vm.runInContext(prelude+'\n'+names.map(extract).join('\n'),ctx);
 return {ctx,call:(name,...args)=>ctx[name](...args)};
}
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/smith-household.json','utf8'));
test('2026/27 tax thresholds and personal allowance taper (independent examples)',()=>{
 const {call}=engine(['taxIncome']);
 const examples=[
  [0,0,12570],[12570,0,12570],[20000,1486,12570],
  [50270,7540,12570],[100000,27432,12570],
  [110000,31432+2000,7570],[125140,42516,0],
  [150000,53703,0]
 ];
 for(const [salary,tax,pa] of examples){
  const actual=call('taxIncome',{salary});
  assert.equal(actual.tax,tax,'salary '+salary);
  assert.equal(actual.pa,pa,'salary '+salary);
 }
});
test('pension taper: boundaries, half reduction, floor and threshold-income gate',()=>{
 const {call}=engine(['pensionAnnualAllowance']);
 const examples=[
  [{thresholdIncome:200000,adjustedIncome:400000},60000],
  [{thresholdIncome:200001,adjustedIncome:260000},60000],
  [{thresholdIncome:200001,adjustedIncome:260002},59999],
  [{thresholdIncome:200001,adjustedIncome:280000},50000],
  [{thresholdIncome:200001,adjustedIncome:360000},10000],
  [{thresholdIncome:200001,adjustedIncome:500000},10000]
 ];
 for(const [input,expected] of examples)assert.equal(call('pensionAnnualAllowance',input),expected);
});
test('CGT aggregates across dates and owners, netting gains and losses once',()=>{
 const db={tax:{profiles:[],holdings:[],pensions:[],disposals:[
  {owner:'self',date:'2026-04-05',cost:1000,proceeds:11000},
  {owner:'self',date:'2026-04-06',cost:2000,proceeds:10000},
  {owner:'self',date:'2026-10-06',cost:9000,proceeds:6000},
  {owner:'spouse',date:'2026-04-06',cost:1000,proceeds:7000}
 ]}};
 const {call}=engine(['taxYear','taxState','taxIncome','incomeEstimate','annualCGT'],{db});
 const prior=call('annualCGT','self',2025);
 assert.equal(prior.count,1);assert.equal(prior.taxable,7000);
 const current=call('annualCGT','self',2026);
 assert.equal(current.count,2);assert.equal(current.gains,8000);
 assert.equal(current.losses,3000);assert.equal(current.taxable,2000);
 assert.equal(current.tax,360);
 assert.equal(call('annualCGT','spouse',2026).taxable,3000);
});
test('pension withdrawal capped by pot and unused tax-free allowance',()=>{
 const {call}=engine(['pensionScenario']);
 const cases=[
  [[100000,0,268275,0],[0,0,100000]],
  [[100000,200000,268275,0],[25000,75000,0]],
  [[100000,40000,268275,260275],[8000,32000,60000]],
  [[100000,40000,268275,268275],[0,40000,60000]]
 ];
 for(const [args,expected] of cases){
  const x=call('pensionScenario',...args);
  assert.deepEqual([x.taxFree,x.taxable,x.remaining],expected);
 }
});
test('backup parser round-trips JSON and portable text with all tax records',()=>{
 const {call}=engine(['validateData','parseBackup'],{},'const BACKUP_START="----- BEGIN PERSONAL WEALTH OS BACKUP JSON -----"; const BACKUP_END="----- END PERSONAL WEALTH OS BACKUP JSON -----";');
 const raw=JSON.stringify(fixture);
 const parsed=call('parseBackup',raw);
 assert.deepEqual(JSON.parse(JSON.stringify(parsed)),fixture);
 const portable='Header\n----- BEGIN PERSONAL WEALTH OS BACKUP JSON -----\n'+raw+'\n----- END PERSONAL WEALTH OS BACKUP JSON -----\n';
 assert.deepEqual(JSON.parse(JSON.stringify(call('parseBackup',portable))),fixture);
});
test('backup parser rejects malformed, unsupported and truncated data',()=>{
 const {call}=engine(['parseBackup'],{},'const BACKUP_START="----- BEGIN PERSONAL WEALTH OS BACKUP JSON -----"; const BACKUP_END="----- END PERSONAL WEALTH OS BACKUP JSON -----";');
 for(const raw of [
  '{not json',JSON.stringify({...fixture,version:99}),
  JSON.stringify({...fixture,observations:'bad'}),
  JSON.stringify({...fixture,observations:[{accountId:'demo-cash',balance:1.5}]}),
  '----- BEGIN PERSONAL WEALTH OS BACKUP JSON -----\n'+JSON.stringify(fixture)
 ])assert.throws(()=>call('parseBackup',raw));
});
test('schema v2 migration keeps all financial records and writes recovery snapshot',()=>{
 const old={...fixture,version:2};delete old.tax;
 const store=new Map([['personal-wealth-os-v2',JSON.stringify(old)]]);
 const localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 const start=source.slice(0,source.indexOf('const $='));
 const ctx={localStorage,JSON,Array,Number,Error,String};
 vm.createContext(ctx);vm.runInContext(start,ctx);
 const migrated=JSON.parse(store.get('personal-wealth-os-v2'));
 assert.equal(migrated.version,3);
 assert.deepEqual(migrated.accounts,old.accounts);
 assert.deepEqual(migrated.observations,old.observations);
 assert.equal(store.get('personal-wealth-os-recovery-v3'),JSON.stringify(old));
});
test('corrupt local storage does not overwrite original data at startup',()=>{
 const original='{invalid json';
 const store=new Map([['personal-wealth-os-v2',original]]);
 const localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 const ctx={localStorage,JSON,Array,Number,Error,String};
 vm.createContext(ctx);vm.runInContext(source.slice(0,source.indexOf('const $=')),ctx);
 assert.equal(store.get('personal-wealth-os-v2'),original);
 assert.match(vm.runInContext('startupError',ctx),/JSON|position|property|token|Expected/i);
});
test('fixture references only fictional IDs and balances use integer pennies',()=>{
 const ids=new Set(fixture.accounts.map(a=>a.id));
 assert.equal(ids.size,fixture.accounts.length);
 assert.ok(fixture.observations.every(o=>ids.has(o.accountId)&&Number.isSafeInteger(o.balance)));
 assert.ok(fixture.tax.holdings.every(h=>ids.has(h.accountId)));
 assert.ok(fixture.tax.pensions.every(p=>ids.has(p.accountId)));
});

test('deleting an account identifies both sides of linked transfers without unrelated transactions',()=>{
 const {call}=engine(['accountDeletionImpact'],{db:{transactions:[
  {id:'out',accountId:'a',kind:'transfer',group:'pair1'},
  {id:'in',accountId:'b',kind:'transfer',group:'pair1'},
  {id:'other',accountId:'b',kind:'external'},
  {id:'unrelated',accountId:'b',kind:'transfer',group:'pair2'},
  {id:'unrelated2',accountId:'c',kind:'transfer',group:'pair2'}
 ]}});
 const result=call('accountDeletionImpact','a');
 assert.deepEqual(Array.from(result.transactions.map(x=>x.id)).sort(),['in','out']);
 assert.equal(result.groups.size,1);
});

test('child accounts are excluded from monthly household net worth',()=>{
 const db={accounts:[{id:'adult',type:'cash'},{id:'child',type:'investment',childAccount:true}],observations:[{accountId:'adult',date:'2026-10-01',balance:10000},{accountId:'child',date:'2026-10-01',balance:50000}]};
 const {call}=engine(['monthlyPosition'],{db});
 const r=call('monthlyPosition','2026-10-31');
 assert.equal(r.net,10000);assert.equal(r.covered,1);
});
test('account projections preserve fixed-rate starting value',()=>{
 const db={plans:[]};
 const {call}=engine(['accountProjection'],{db,today:()=> '2026-10-24',balance:()=>123400,rate:()=>0.05,monthDate:()=> '2026-11-24'});
 const points=call('accountProjection',{id:'a',type:'investment',model:'fixed'},0);
 assert.equal(points.length,41);assert.equal(points[0],123400);assert.ok(points[1]>points[0]);
});

test('account details form includes the child-account toggle required by openAccount',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const detail=html.split('<form id="accountDetailForm">')[1]?.split('</form>')[0];
 assert.ok(detail,'Missing account details form');
 assert.match(detail,/name="childAccount"/);
 assert.match(html,/id="detailProjectionChart"/);
});
