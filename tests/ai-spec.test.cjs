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

test('multiple URL input is newline separated, validated, deduplicated and capped at 20',()=>{
 const list='https://example.com/a\n https://example.com/b \nhttps://example.com/a';
 assert.equal(ai.parseSourceUrls(list).join(','),'https://example.com/a,https://example.com/b');
 assert.equal(ai.parseSourceUrls('https://example.com/a').length,1);
 assert.equal(ai.parseSourceUrls('').length,0);
 assert.throws(()=>ai.parseSourceUrls('https://example.com/a\nnot-a-url'),/参照URL/);
 assert.equal(ai.parseSourceUrls(Array.from({length:20},(_,i)=>'https://example.com/'+i)).length,20);
 assert.throws(()=>ai.parseSourceUrls(Array.from({length:21},(_,i)=>'https://example.com/'+i)),/最大20件/);
});
test('multi-page extraction identifies machine name without prior entry and shows conflicts',async()=>{
 const urls=['https://example.com/a','https://example.com/b'];
 const prompts=[],options=[];
 const loadSDK=async()=>({
  app:{initializeApp:()=>({})},
  check:{ReCaptchaEnterpriseProvider:class{},initializeAppCheck:()=>{}},
  ai:{GoogleAIBackend:class{},getAI:()=>({}),
   getGenerativeModel:(svc,opts)=>{
    options.push(opts);
    return {generateContent:async p=>{
     prompts.push(p);
     return {response:{
      candidates:[{urlContextMetadata:{urlMetadata:urls.map(url=>({retrievedUrl:url,urlRetrievalStatus:'URL_RETRIEVAL_STATUS_SUCCESS'}))}}],
      text:()=>JSON.stringify({name:'eテスト 2026',basic:{initialProbability:319.7,rushEntryRate:null},conflicts:['RUSH突入率: URL A 50% / URL B 60%']})
     }};
    }};
   }}
 });
 const r=await ai.makeClient(config,{loadSDK}).research('',urls.join('\n'));
 assert.equal(r.spec.researchedName,'eテスト 2026');
 assert.equal(r.sources.map(s=>s.url).join(','),urls.join(','));
 assert.equal(r.spec.specEvidence.sourceUrl,urls[0]);
 assert.equal(r.spec.basic.rushEntryRate,null);
 assert.ok(r.warnings.some(s=>s.includes('資料の不一致:')));
 assert.equal(options[0].tools.length,1);
 assert.ok('urlContext' in options[0].tools[0]);
 assert.ok(prompts[0].includes(urls[0])&&prompts[0].includes(urls[1]));
 assert.ok(prompts[0].includes('機種名は事前入力されていません'));
});
test('partial retrieval retries with only successfully fetched URL and reports failures',async()=>{
 const good='https://example.com/good',bad='https://example.com/bad';
 const prompts=[];
 const loadSDK=async()=>({
  app:{initializeApp:()=>({})},
  check:{ReCaptchaEnterpriseProvider:class{},initializeAppCheck:()=>{}},
  ai:{GoogleAIBackend:class{},getAI:()=>({}),
   getGenerativeModel:()=>({generateContent:async p=>{
    prompts.push(p);
    return {response:{
     candidates:[{urlContextMetadata:{urlMetadata:
      p.includes(bad)?[
       {retrievedUrl:good,urlRetrievalStatus:'URL_RETRIEVAL_STATUS_SUCCESS'},
       {retrievedUrl:bad,urlRetrievalStatus:'URL_RETRIEVAL_STATUS_ERROR'}
      ]:[{retrievedUrl:good,urlRetrievalStatus:'URL_RETRIEVAL_STATUS_SUCCESS'}]}}],
     text:()=>JSON.stringify({name:p.includes(bad)?'混在した仮名':'e確認済み',introductionDate:'2026-10-05',basic:{initialProbability:199.9}})
    }};
   }})}
 });
 const r=await ai.makeClient(config,{loadSDK}).research('',good+'\n'+bad);
 assert.equal(prompts.length,2);
 assert.ok(prompts[0].includes(good)&&prompts[0].includes(bad));
 assert.ok(prompts[1].includes(good)&&!prompts[1].includes(bad));
 assert.equal(r.spec.researchedName,'e確認済み');
 assert.equal(r.sources.map(s=>s.url).join(','),good);
 assert.ok(r.warnings.some(w=>w.includes(bad)));
});
test('without a supplied name, a result that lacks a name cannot be applied',async()=>{
 const loadSDK=async()=>({
  app:{initializeApp:()=>({})},
  check:{ReCaptchaEnterpriseProvider:class{},initializeAppCheck:()=>{}},
  ai:{GoogleAIBackend:class{},getAI:()=>({}),
   getGenerativeModel:()=>({generateContent:async()=>({
    response:{text:()=>JSON.stringify({name:'',basic:{initialProbability:319.7}})}
   })})}
 });
 const client=ai.makeClient(config,{loadSDK});
 await assert.rejects(client.research('','','初当り1/319.7'),/機種名を確認できません/);
 const r=await client.research('e手入力','','初当り1/319.7');
 assert.equal(r.spec.researchedName,'');
});
test('AI import opens without a machine name, fills blank name and preserves existing names',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 assert.ok(app.includes("set('#nameInput',spec.researchedName)"));
 assert.ok(!app.includes("showToast('先に機種名を入力してください')"));
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.ok(html.includes('<textarea id="aiSpecReference"'));
 assert.ok(html.includes('v1.0.7'));
});

test('multiple source URLs are persisted and visible without replacing legacy single-URL fields',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 assert.ok(app.includes('sourceUrls: aiResearch.sources.map(s => s.url)'));
 assert.ok(app.includes('machine.specEvidence.sourceUrls'));
 assert.ok(app.includes("state.editorSpecEvidence?.sourceUrls?.join('\\n')"));
 assert.ok(app.includes('evidenceUrls.map(url =>'));
});
test('if recheck cannot confirm all candidate sources, result is not adopted',async()=>{
 const good='https://example.com/one',bad='https://example.com/two';
 let calls=0;
 const loadSDK=async()=>({
  app:{initializeApp:()=>({})},
  check:{ReCaptchaEnterpriseProvider:class{},initializeAppCheck:()=>{}},
  ai:{GoogleAIBackend:class{},getAI:()=>({}),getGenerativeModel:()=>({
   generateContent:async()=>{
    calls++;
    return {response:{
     candidates:[{urlContextMetadata:{urlMetadata:calls===1?[
      {retrievedUrl:good,urlRetrievalStatus:'URL_RETRIEVAL_STATUS_SUCCESS'},
      {retrievedUrl:bad,urlRetrievalStatus:'URL_RETRIEVAL_STATUS_ERROR'}]:
      [{retrievedUrl:good,urlRetrievalStatus:'URL_RETRIEVAL_STATUS_ERROR'}]}}],
     text:()=>JSON.stringify({name:'e確認',basic:{initialProbability:319.7}})
    }};
   }
  })}
 });
 await assert.rejects(ai.makeClient(config,{loadSDK}).research('',good+'\n'+bad),/再照合中/);
 assert.equal(calls,2);
});

test('normalizes installation date formats and refuses nonexistent or partial dates',()=>{
 const cases=[
  ['2026-10-05','2026-10-05'],['2026/10/5','2026-10-05'],
  ['2026年10月5日','2026-10-05'],['2026年10月05日（月）','2026-10-05'],
  ['導入日：2026年10月5日','2026-10-05'],['２０２６年１０月５日','2026-10-05'],
  ['2026-02-30',''],['2026年10月上旬',''],['2026年10月',''],
  ['2026-10-05～',''],['2026-13-01','']
 ];
 for(const [value,expected] of cases)assert.equal(ai.normalizeIntroductionDate(value),expected,value);
 assert.equal(ai.normalizeResponse({name:'機種',introductionDate:'2026年10月5日',basic:{initialProbability:199.9}}).introductionDate,'2026-10-05');
});
test('AI distribution payout has one clean amount, with RUSH and round descriptions in label',()=>{
 const M=require('../spec-model.js');
 const raw=[
  {label:'10R+RUSH突入',rate:50,payout:'1,500個＋RUSH'},
  {label:'3R 通常',rate:50,payout:'3R 450玉'}
 ];
 const spec=ai.normalizeResponse({name:'テスト',basic:{initialProbability:319},distributions:{special1:raw}});
 assert.equal(spec.distributions.special1[0].payout,'1500個');
 assert.equal(spec.distributions.special1[1].payout,'450個');
 const rows=spec.distributions.special1.map(row=>({...row,rate:parseFloat(row.rate)}));
 assert.equal(M.initialExpectation(rows).value,975);
 assert.equal(M.initialExpectation(rows).kind,'exact');
 assert.equal(ai.normalizeDistributionPayout('約1,500発').payout,'約1500個');
 for(const value of ['300〜790個','1500個＋3000個','10R×10C×15個','RUSH突入','450個＋α']){
  const out=ai.normalizeDistributionPayout(value);
  assert.equal(out.payout,'',value);
  assert.ok(out.detail);
 }
 const unclear=ai.normalizeResponse({name:'機種',basic:{initialProbability:319},distributions:{special1:[{label:'次回RUSH',rate:100,payout:'450個＋α'}]}});
 assert.equal(unclear.distributions.special1[0].payout,'');
 assert.match(unclear.distributions.special1[0].label,/450個＋α/);
 assert.equal(M.initialExpectation(unclear.distributions.special1.map(row=>({...row,rate:parseFloat(row.rate)}))).value,null);
});
test('URL installation date can be recovered with one focused second pass',async()=>{
 const page='https://example.com/spec';
 let calls=0;
 const loadSDK=async()=>({
  app:{initializeApp:()=>({})},
  check:{ReCaptchaEnterpriseProvider:class{},initializeAppCheck:()=>{}},
  ai:{GoogleAIBackend:class{},getAI:()=>({}),
   getGenerativeModel:()=>({generateContent:async prompt=>{
    calls++;
    return {response:{
     candidates:[{urlContextMetadata:{urlMetadata:[{retrievedUrl:page,urlRetrievalStatus:'URL_RETRIEVAL_STATUS_SUCCESS'}]}}],
     text:()=>JSON.stringify(calls===1
       ? {name:'e機種',basic:{initialProbability:199.9}}
       : {introductionDate:'2026年10月5日',sourceUrl:page})
    }};
   }})}
 });
 const r=await ai.makeClient(config,{loadSDK}).research('',page);
 assert.equal(calls,2);
 assert.equal(r.spec.introductionDate,'2026-10-05');
 assert.ok(!r.warnings.some(w=>w.includes('導入日を資料から確認できませんでした')));
 const fromOther=ai.parseIntroductionDateResponse(JSON.stringify({introductionDate:'2026-10-05',sourceUrl:'https://example.org/other'}),[page]);
 assert.equal(fromOther,'');
});
test('AI preview includes a date even if not available',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 assert.match(app,/row\('ホール導入日', spec\.introductionDate \|\| '未確認'\)/);
});

test('AI cannot override initial payout with a RUSH-inclusive overall expectation',()=>{
 const imported=ai.normalizeResponse({
  name:'eテスト',
  basic:{initialProbability:319.7},
  distributions:{
   special1:[{label:'10R RUSH',rate:50,payout:'1500個'},{label:'3R 通常',rate:50,payout:'450個'}],
   special2:[{label:'1500 RUSH',rate:100,payout:'9000個'}]
  },
  initialPayoutExpectation:{kind:'exact',value:13500,note:'RUSH込み総期待出玉'}
 });
 assert.equal(imported.initialPayoutExpectation.kind,'auto');
 assert.equal(imported.initialPayoutExpectation.value,null);
 assert.equal(imported.initialPayoutExpectation.note,'');
 assert.ok(ai.prompt('eテスト',[],'初当り出玉').includes('RUSH・LT突入後の当り'));
});
test('initial payout value is strictly first-hit special1 distribution, not total RUSH payout',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 const start=code.indexOf('  function initialPayoutExpectation(machine) {');
 const end=code.indexOf('  function formatPayoutExpectation(info) {',start);
 assert.ok(start>0&&end>start);
 const normalizePayoutExpectation=value=>({
  kind:value?.kind||'auto',value:value?.value??null,note:value?.note||'',
  origin:value?.origin==='manual'?'manual':''
 });
 const parseSpecNumber=v=>{
  const match=String(v??'').replaceAll(',','').match(/-?\d+(?:\.\d+)?/);
  return match?Number(match[0]):null;
 };
 const numberOrNull=v=>v==null||v===''?null:Number(v);
 const calculate=new Function('normalizePayoutExpectation','parseSpecNumber','numberOrNull','PachiSpecModel',
  code.slice(start,end)+'return initialPayoutExpectation;')(
  normalizePayoutExpectation,parseSpecNumber,numberOrNull,require('../spec-model.js'));
 const m={
  specEvidence:{sourceUrl:'https://example.com'},
  initialPayoutExpectation:{kind:'exact',value:18500,note:'RUSH含む可能性'},
  distributions:{
   special1:[{label:'10R RUSH',rate:'50%',payout:'1500個'},{label:'3R 通常',rate:'50%',payout:'450個'}],
   special2:[{label:'連チャン',rate:'100%',payout:'9000個'}]
  },
  rushPayoutModel:{version:2},
  basic:{initialPayout:25000}
 };
 const expected=calculate(m);
 assert.equal(expected.value,975);
 assert.equal(expected.kind,'exact');
 assert.match(expected.note,/RUSH・LT中の出玉は含まない/);
 assert.equal(calculate({...m,distributions:{special1:[]}}).value,null);
 assert.equal(calculate({...m,initialPayoutExpectation:{kind:'exact',value:960,origin:'manual'}}).value,960);
 assert.equal(calculate({...m,initialPayoutExpectation:{kind:'auto',value:null}}).value,975);
 assert.equal(calculate({...m,distributions:{special1:[{label:'10R',rate:'90%',payout:'1500個'}]}}).value,null);
});
test('AI apply always uses automatic special1 mean, manual values explicitly carry provenance',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 assert.ok(app.includes("state.editorPayoutManual = false;"));
 assert.ok(app.includes("$('#initialPayoutKindInput').value = 'auto';"));
 assert.ok(app.includes("origin: state.editorPayoutManual && $('#initialPayoutKindInput').value !== 'auto' ? 'manual' : ''"));
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.match(html,/特図1の初当り分のみ/);
});
