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

test('Gemini 2.5 Flash and Flash-Lite can be selected via public config',()=>{
 for(const model of ['gemini-2.5-flash-lite','gemini-2.5-flash']){
  assert.equal(ai.isConfigured({...config,model}),true);
  assert.equal(ai.available({...config,model},'https:'),true);
  assert.equal(ai.available({...config,model},'file:'),false);
 }
 assert.equal(ai.isConfigured({...config,model:'gemini-unsupported'}),false);
});

test('Firebase AI failures give actionable diagnostics instead of hiding status codes',()=>{
 const model='gemini-2.5-flash-lite';
 assert.match(ai.explainAIError({message:'404: model was not found or your project does not have access to it'},model),/過去に利用実績/);
 assert.match(ai.explainAIError({message:'404: Firebase AI Logic genai config not found'},model),/Gemini Developer API/);
 assert.match(ai.explainAIError({code:'ai/app-check-error',message:'attestation failed'},model),/App Check/);
 assert.match(ai.explainAIError({message:'429: quota exceeded'},model),/429/);
 assert.match(ai.explainAIError({message:'400: Grounding with Google Search is not supported on Free Tier'},'gemini-3.5-flash-lite'),/Google検索/);
 assert.match(ai.explainAIError({message:'403: PERMISSION_DENIED'},model),/403/);
});

test('requires URL or pasted source material and never uses Google Search',async()=>{
 let calls=0,options=null;
 const loadSDK=async()=>({
  app:{initializeApp:()=>({})},
  check:{ReCaptchaEnterpriseProvider:class{},initializeAppCheck:()=>{}},
  ai:{GoogleAIBackend:class{},getAI:()=>({}),
   getGenerativeModel:(svc,opts)=>{
    options=opts;
    return {generateContent:async()=>{calls++;return {response:{
     text:()=>JSON.stringify({name:'機種',basic:{initialProbability:319.7,rushEntryRate:50}})
    }};}};
   }}
 });
 const client=ai.makeClient(config,{loadSDK});
 await assert.rejects(client.research('機種'),/URLか、スペック文章/);
 const r=await client.research('機種','','初当り1/319.7、突入50%');
 assert.equal(r.sourceMode,'text');
 assert.equal(r.spec.basic.rushEntryRate,50);
 assert.equal(r.sources.length,0);
 assert.equal(calls,1);
 assert.equal(options.tools,undefined);
 assert.ok(r.warnings.some(w=>/Web上の情報との照合は行っていません/.test(w)));
});
test('URL Context is required and fetched URL is the only source',async()=>{
 const page='https://example.com/spec';
 let options=null;
 let responseBody={candidates:[{urlContextMetadata:{
  urlMetadata:[{retrievedUrl:page,urlRetrievalStatus:'URL_RETRIEVAL_STATUS_SUCCESS'}]}}],
  text:()=>JSON.stringify({name:'機種',basic:{initialProbability:199.9},specEvidence:{sourceUrl:'https://attacker.example/'}})
 };
 const loadSDK=async()=>({
  app:{initializeApp:()=>({})},
  check:{ReCaptchaEnterpriseProvider:class{},initializeAppCheck:()=>{}},
  ai:{GoogleAIBackend:class{},getAI:()=>({}),
   getGenerativeModel:(svc,opts)=>{
    options=opts;
    return {generateContent:async()=>({response:responseBody})};
   }}
 });
 const client=ai.makeClient(config,{loadSDK});
 let r=await client.research('機種',page);
 assert.equal(r.sourceMode,'url');
 assert.equal(r.spec.specEvidence.sourceUrl,page);
 assert.equal(r.sources[0].url,page);
 assert.equal(options.tools.length,1);
 assert.ok('urlContext' in options.tools[0]);
 assert.ok(!options.tools.some(t=>'googleSearch' in t));
 responseBody={...responseBody,candidates:[{urlContextMetadata:{urlMetadata:[
  {retrievedUrl:page,urlRetrievalStatus:'URL_RETRIEVAL_STATUS_ERROR'}
 ]}}]};
 await assert.rejects(client.research('機種',page),/ページ本文を取得できません/);
});
test('falls back from unavailable 2.5 to 3.5 Flash-Lite only for model 404',async()=>{
 const used=[];
 const loadSDK=async()=>({
  app:{initializeApp:()=>({})},
  check:{ReCaptchaEnterpriseProvider:class{},initializeAppCheck:()=>{}},
  ai:{GoogleAIBackend:class{},getAI:()=>({}),
   getGenerativeModel:(svc,opts)=>({
    generateContent:async()=>{
     used.push(opts.model);
     if(opts.model==='gemini-2.5-flash-lite')throw Error('404 Model was not found');
     return {response:{text:()=>JSON.stringify({basic:{initialProbability:319.7}})}};
    }
   })}
 });
 const client=ai.makeClient({...config,model:'gemini-2.5-flash-lite'},{loadSDK});
 const result=await client.research('機種','','初当り 1/319.7');
 assert.equal(result.modelUsed,'gemini-3.5-flash-lite');
 assert.equal(used.join(','),'gemini-2.5-flash-lite,gemini-3.5-flash-lite');
 assert.ok(result.warnings.some(w=>/2.5は利用できない/.test(w)));
});
