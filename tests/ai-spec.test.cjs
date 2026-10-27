const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context={URL,Date,console};
context.globalThis=context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ai-spec.js'),'utf8'),context);
const ai=context.PachiSpecAI;
const config={mode:'shared-firebase',model:'gemini-3.5-flash-lite',
 firebase:{apiKey:'demo',appId:'demo',projectId:'demo'},appCheckSiteKey:'demo_site'};
test('availability blocks file: and unconfigured app',()=>{
 assert.equal(ai.available(config,'file:'),false);
 assert.equal(ai.available(config,'https:'),true);
 assert.equal(ai.available({mode:'disabled'},'https:'),false);
});
test('normalizes percentages and preserves unconfirmed basis',()=>{
 const result=ai.normalizeResponse({name:'eテスト',basic:{initialProbability:'1/319.7',rushEntryRate:'50%',rushContinuationRate:81},
  distributions:{special1:[{label:'3R',rate:50,payout:'450個'}]},
  specEvidence:{entryBasisConfirmed:false,sourceUrl:'https://example.com/info'}});
 assert.equal(result.basic.initialProbability,319.7);
 assert.equal(result.basic.rushEntryRate,50);
 assert.equal(result.specEvidence.entryBasisConfirmed,false);
 assert.equal(result.distributions.special1[0].rate,'50%');
 assert.equal(result.specEvidence.sourceUrl,'https://example.com/info');
});
test('rejects empty results and invalid numerics',()=>{
 assert.throws(()=>ai.normalizeResponse({}),/スペック/);
 const r=ai.normalizeResponse({basic:{rushEntryRate:150,initialProbability:319.7}});
 assert.equal(r.basic.rushEntryRate,null);
});
test('parses fenced JSON and rejects unsafe URLs',()=>{
 const fence=String.fromCharCode(96).repeat(3);
 const obj=ai.parseResponse(fence+'json\n'+JSON.stringify({basic:{initialProbability:199.9},specEvidence:{sourceUrl:'javascript:alert(1)'}})+'\n'+fence);
 assert.equal(obj.basic.initialProbability,199.9);
 assert.equal(obj.specEvidence.sourceUrl,'');
});
test('no confirmation flag stops effectiveRush calculation',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 const calc=app.split('function effectiveRush(machine) {')[1].split('\n  }')[0];
 assert.ok(calc.includes('probability / (entryRate / 100)'));
 assert.ok(!calc.includes('entryBasisConfirmed'));
});
