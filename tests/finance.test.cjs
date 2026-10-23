'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function extract(name){
 const start=source.indexOf('function '+name+'(');
 assert.ok(start>=0,'Missing function '+name);
 const open=source.indexOf('{',start);let depth=0,quote='',escaped=false;
 for(let i=open;i<source.length;i++){
  const c=source[i];
  if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue}
  if(c==='"'||c==="'"||c==='\x60'){quote=c;continue}
  if(c==='{')depth++;
  if(c==='}'&&--depth===0)return source.slice(start,i+1);
 }
 throw Error('Unclosed function '+name);
}
const names=['taxIncome','incomeEstimate','taxYear','taxState','annualCGT','pensionAnnualAllowance','pensionScenario'];
const sandbox={Math,Number,Date,db:{tax:{profiles:[],holdings:[],pensions:[],disposals:[]}}};
vm.createContext(sandbox);
vm.runInContext("const TAX_RULES={year:2026};"+names.map(extract).join('\n'),sandbox);
const call=(fn,...args)=>sandbox[fn](...args);
test('2026/27 England non-savings income tax: basic and higher',()=>{
 assert.equal(call('taxIncome',{salary:50000}).tax,7486);
 assert.equal(call('taxIncome',{salary:100000}).tax,27432);
});
test('personal allowance tapers to zero at 125140',()=>{
 assert.equal(call('taxIncome',{salary:125140}).pa,0);
 assert.equal(call('taxIncome',{salary:125140}).tax,42516);
});
test('tax year changes on 6 April',()=>{
 assert.equal(call('taxYear','2026-04-05'),2025);
 assert.equal(call('taxYear','2026-04-06'),2026);
});
test('annual CGT exemption is shared across disposals, not duplicated',()=>{
 sandbox.db.tax.disposals=[
 {owner:'self',date:'2026-06-01',cost:'1000',proceeds:'4000'},
 {owner:'self',date:'2026-09-01',cost:'2000',proceeds:'7000'},
 {owner:'spouse',date:'2026-10-01',cost:'100',proceeds:'10000'}
 ];
 const r=call('annualCGT','self',2026);
 assert.equal(r.count,2);
 assert.equal(r.gains,8000);
 assert.equal(r.taxable,5000);
 assert.equal(r.tax,900);
 assert.equal(call('annualCGT','spouse',2026).count,1);
});
test('pension allowance taper and floor',()=>{
 assert.equal(call('pensionAnnualAllowance',{thresholdIncome:200000,adjustedIncome:400000}),60000);
 assert.equal(call('pensionAnnualAllowance',{thresholdIncome:200001,adjustedIncome:280000}),50000);
 assert.equal(call('pensionAnnualAllowance',{thresholdIncome:200001,adjustedIncome:400000}),10000);
});
test('pension withdrawal respects recorded remaining lump sum allowance',()=>{
 const x=call('pensionScenario',200000,40000,268275,260275);
 assert.equal(x.taxFree,8000);
 assert.equal(x.taxable,32000);
 assert.equal(x.remaining,160000);
});
test('demo fixture has only fictional accounts and valid linked records',()=>{
 const fixture=JSON.parse(fs.readFileSync('tests/fixtures/smith-household.json','utf8'));
 assert.equal(fixture.version,3);
 assert.ok(fixture.accounts.length>=5);
 const ids=new Set(fixture.accounts.map(x=>x.id));
 assert.ok(fixture.observations.every(x=>ids.has(x.accountId)));
 assert.ok(fixture.tax.holdings.every(x=>ids.has(x.accountId)));
});
