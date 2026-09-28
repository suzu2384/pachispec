const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const context={crypto:webcrypto,structuredClone,PachiSpecModel:require('../spec-model.js')};
vm.createContext(context);
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
vm.runInContext(source.replace('  const state = {','  globalThis.api = {normalizeMachine, initialPayoutExpectation}; return; const state = {'),context);
test('new machine-category tags do not recreate the retired P/e category',()=>{
 const m=context.api.normalizeMachine({id:'e',type:'e',tags:['機種：e機']});
 assert.equal(m.type,'e');assert.equal(m.tags.length,1);assert.equal(m.tags[0],'機種：e機');
});
test('an explicitly unknown public-spec expectation does not silently average a different event population',()=>{
 const m={specEvidence:{entryBasisConfirmed:false},initialPayoutExpectation:{kind:'unavailable',value:null,note:'母数が異なる'},distributions:{special1:[{rate:'100%',payout:'1500個'}]}};
 assert.equal(context.api.initialPayoutExpectation(m).value,null);
 m.initialPayoutExpectation.kind='auto';assert.equal(context.api.initialPayoutExpectation(m).value,1500);
});
