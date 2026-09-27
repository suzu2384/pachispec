const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../spec-model.js');
const mode=(id,extra={})=>({id,name:id,method:'rate',continuationRate:80,rateConfirmed:true,onMiss:'end',outcomes:[{rate:100,payoutText:'1500',nextStateId:id}],...extra});
const model=(states,entries=[{stateId:states[0].id,rate:100}])=>({version:2,payoutUnit:'payout',states,entries});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const at=(result,payout)=>result.distribution.find(row=>row.payout===payout)?.probability || 0;
test('single-mode geometric distribution and capped tail retain total mass',()=>{
 const r=M.calculate(model([mode('rush')]));assert.deepEqual(r.issues,[]);
 close(at(r,0),20);close(at(r,1500),16);close(at(r,12000),100*.8**8);close(r.distribution.reduce((s,x)=>s+x.probability,0),100);
});
test('ST derives chance from independent draws and returns to same mode',()=>{
 const r=M.calculate(model([mode('st',{method:'st',hitProbability:2,spins:2,stConfirmed:true})]));
 close(at(r,0),25);close(at(r,1500),18.75);
});
test('ST misses can move into a different residual-draw mode',()=>{
 const a=mode('a',{method:'st',hitProbability:2,spins:1,stConfirmed:true,onMiss:'b',outcomes:[{rate:100,payoutText:'1000',nextStateId:'end'}]});
 const b=mode('b',{method:'st',hitProbability:4,spins:1,stConfirmed:true,outcomes:[{rate:100,payoutText:'2000',nextStateId:'end'}]});
 const r=M.calculate(model([a,b]));close(at(r,0),37.5);close(at(r,1000),50);close(at(r,2000),12.5);
});
test('next-hit guarantee includes ending awards and mode-specific upgrade payouts',()=>{
 const a=mode('a',{method:'next',outcomes:[{rate:50,payoutText:'1500',nextStateId:'end'},{rate:50,payoutText:'1500',nextStateId:'lt'}]});
 const lt=mode('lt',{method:'next',outcomes:[{rate:100,payoutText:'3000',nextStateId:'end'}]});
 const r=M.calculate(model([a,lt]));close(at(r,1500),50);close(at(r,4500),50);close(at(r,0),0);
});
test('multiple starting modes use conditional entry weights',()=>{
 const a=mode('a',{method:'next',outcomes:[{rate:100,payoutText:'1000',nextStateId:'end'}]});
 const b=mode('b',{method:'next',outcomes:[{rate:100,payoutText:'2000',nextStateId:'end'}]});
 const r=M.calculate(model([a,b],[{stateId:'a',rate:25},{stateId:'b',rate:75}]));close(at(r,1000),25);close(at(r,2000),75);
});
test('missing, composite or special conditions do not produce fabricated distributions',()=>{
 const cases=[mode('a',{method:'unknown'}),mode('a',{outcomes:[{rate:100,payoutText:'1500～3000',nextStateId:'a'}]}),mode('a',{outcomes:[{rate:90,payoutText:'1500',nextStateId:'a'}]}),mode('a',{method:'st',hitProbability:99,spins:100,stConfirmed:false}),mode('a',{outcomes:[{rate:100,payoutText:'1500',nextStateId:'end'}]})];
 for(const m of cases){const r=M.calculate(model([m]));assert.equal(r.distribution,null);assert.ok(r.issues.length);}
 assert.equal(M.calculate({...model([mode('a')]),payoutUnit:''}).distribution,null);
});
test('non-ending zero-payout cycles fail instead of reporting a partial distribution',()=>{
 const r=M.calculate(model([mode('a',{method:'next',outcomes:[{rate:100,payoutText:'0',nextStateId:'a'}]})]));assert.equal(r.distribution,null);assert.match(r.issues[0],/循環/);
});
test('100 percent awards reaching the cap are supported',()=>{
 const r=M.calculate(model([mode('a',{method:'next'})]));close(at(r,12000),100);
});
test('initial expectation rejects ranges and distinguishes rounded amounts',()=>{
 close(M.initialExpectation([{rate:50,payout:'1500個'},{rate:50,payout:'450個'}]).value,975);
 assert.equal(M.initialExpectation([{rate:100,payout:'約1,500個'}]).kind,'estimate');
 assert.equal(M.initialExpectation([{rate:100,payout:'320〜790個'}]).value,null);
 assert.equal(M.initialExpectation([{rate:null,payout:'1500'}]).value,null);
});
test('model JSON roundtrip preserves mode transitions and conditions',()=>{
 const original=model([mode('a',{method:'next',sourceUrl:'https://example.com',outcomes:[{rate:100,payoutText:'1500',nextStateId:'end'}]})]);
 const restored=M.normalize(JSON.parse(JSON.stringify(original)));close(at(M.calculate(restored),1500),100);assert.equal(restored.states[0].sourceUrl,'https://example.com');
});
