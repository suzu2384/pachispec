/* Source-grounded Firebase AI Logic spec lookup. Public Firebase config only. */
(function(root){
 'use strict';
 const ALLOWED=new Set(['gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-3.8-flash','gemini-2.5-flash-lite','gemini-2.5-flash']);
 const str=v=>typeof v==='string'?v.trim():'';
 const link=v=>{try{const u=new URL(str(v));return /^https?:$/.test(u.protocol)?u.href:'';}catch{return '';}};
 const num=(v,min=0,max=Infinity)=>{
  if(v==null||v==='')return null;
  if(typeof v!=='number'&&typeof v!=='string')return null;
  const s=String(v).replace(/[,％%]/g,'').replace(/^(?:約)?1\s*[\/／]\s*/,'');
  const n=Number(s);return Number.isFinite(n)&&n>=min&&n<=max?n:null;
 };
 function isConfigured(c){
  return !!c&&c.mode==='shared-firebase'&&ALLOWED.has(c.model)&&
   !!c.firebase&&['apiKey','appId','projectId'].every(k=>!!str(c.firebase[k]))&&!!str(c.appCheckSiteKey);
 }
 const available=(c,protocol)=>['https:','http:'].includes(protocol)&&isConfigured(c);
 function simpleRows(data,kind){
  return (Array.isArray(data)?data:[]).slice(0,40).flatMap(r=>{
   if(!r||typeof r!=='object')return [];
   if(kind==='flow'){
    const from=str(r.from).slice(0,100),to=str(r.to).slice(0,100);
    return from&&to?[{from,to,rate:str(r.rate).slice(0,60)}]:[];
   }
   const label=str(r.label).slice(0,100);
   if(!label)return [];
   return kind==='custom'?[{label,value:str(r.value).slice(0,240)}]:
    [{label,rate:num(r.rate,0,100)===null?'':String(num(r.rate,0,100))+'%',payout:str(r.payout).slice(0,150)}];
  });
 }
 function validMode(raw){
  if(!raw||raw.version!==2||!Array.isArray(raw.states)||!raw.states.length||raw.states.length>12||!Array.isArray(raw.entries))return null;
  const ids=new Set();
  const states=raw.states.map(m=>{
   if(!m||!str(m.id)||ids.has(m.id))return null;ids.add(m.id);
   return {id:str(m.id),name:str(m.name),method:['st','next','rate'].includes(m.method)?m.method:'unknown',
    hitProbability:num(m.hitProbability,0.000001),spins:num(m.spins,0,10000),drawType:str(m.drawType),
    stConfirmed:m.stConfirmed===true,continuationRate:num(m.continuationRate,0,100),
    rateConfirmed:m.rateConfirmed===true,onMiss:str(m.onMiss),sourceUrl:link(m.sourceUrl),note:str(m.note),
    outcomes:(Array.isArray(m.outcomes)?m.outcomes:[]).slice(0,30).map(r=>({
     label:str(r?.label),rate:num(r?.rate,0,100),payoutText:str(r?.payoutText),nextStateId:str(r?.nextStateId)
    }))};
  });
  if(states.some(x=>!x))return null;
  const entries=raw.entries.slice(0,12).map(e=>({stateId:str(e?.stateId),rate:num(e?.rate,0,100)}));
  if(entries.some(x=>!ids.has(x.stateId)))return null;
  const model={version:2,cap:12000,payoutUnit:['payout','net'].includes(raw.payoutUnit)?raw.payoutUnit:'',
   states,entries};
  try{
   return root.PachiSpecModel.inspect(root.PachiSpecModel.normalize(model)).issues.length===0?model:null;
  }catch{return null;}
 }
 function normalizeResponse(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('AIの回答形式が正しくありません。');
  const b=raw.basic||{},d=raw.distributions||{},e=raw.specEvidence||{},p=raw.initialPayoutExpectation||{};
  const spec={
   researchedName:str(raw.name).slice(0,180),manufacturer:str(raw.manufacturer).slice(0,100),
   type:['e','P'].includes(raw.type)?raw.type:null,lt:typeof raw.lt==='boolean'?raw.lt:null,
   introductionDate:/^\d{4}-\d{2}-\d{2}$/.test(str(raw.introductionDate))?raw.introductionDate:'',
   series:str(raw.series).slice(0,120),
   basic:{initialProbability:num(b.initialProbability,0.000001),rushEntryRate:num(b.rushEntryRate,0,100),
    rushContinuationRate:num(b.rushContinuationRate,0,100),rushHitProbability:num(b.rushHitProbability,0.000001),
    rushHitType:['実質当り確率','図柄揃い確率','大当り確率','普図抽選確率','確変中確率','その他'].includes(b.rushHitType)?b.rushHitType:null,
    rushHitNote:str(b.rushHitNote).slice(0,300)},
   distributions:{special1:simpleRows(d.special1,'distribution'),special2:simpleRows(d.special2,'distribution')},
   flows:simpleRows(raw.flows,'flow'),customSpecs:simpleRows(raw.customSpecs,'custom'),
   specEvidence:{sourceUrl:link(e.sourceUrl),checkedAt:new Date().toISOString().slice(0,10),
    probabilityLabel:str(e.probabilityLabel).slice(0,120),entryBasisConfirmed:e.entryBasisConfirmed===true,
    payoutUnit:['payout','net'].includes(e.payoutUnit)?e.payoutUnit:'',note:str(e.note).slice(0,1400)},
   initialPayoutExpectation:{kind:['exact','estimate','minimum'].includes(p.kind)?p.kind:'auto',
    value:num(p.value,0,100000),note:str(p.note).slice(0,350)},
   rushPayoutModel:validMode(raw.rushPayoutModel)
  };
  if(spec.initialPayoutExpectation.kind!=='auto'&&spec.initialPayoutExpectation.value===null)
   spec.initialPayoutExpectation={kind:'auto',value:null,note:''};
  if(!Object.values(spec.basic).some(v=>typeof v==='number')&&
     !spec.distributions.special1.length&&!spec.distributions.special2.length)
   throw Error('機種のスペックを確認できませんでした。');
  return spec;
 }
 function parseResponse(body){
  const s=str(body).replace(/^\x60{3}(?:json)?\s*/i,'').replace(/\x60{3}$/,'').trim();
  try{return normalizeResponse(JSON.parse(s));}catch(err){
   if(err instanceof SyntaxError){
    const start=s.indexOf('{'),end=s.lastIndexOf('}');
    if(start>=0&&end>start)try{return normalizeResponse(JSON.parse(s.slice(start,end+1)));}catch{}
    throw Error('AIの回答がJSON形式ではありません。');
   }
   throw err;
  }
 }
 function prompt(name,ref){
  return [
   '日本のぱちんこ機種「'+name+'」の公開スペックをGoogle検索で調べ、出典に基づいてJSONに整理してください。',
   ref?'参考ページを優先: '+ref:'',
   'メーカー公式、P-WORLD等で確認。似た名称・旧版・別型式・LT有無の異なる機種を混ぜない。',
   '推測・未掲載・矛盾がある値は必ずnullか空配列にし、存在しない振り分け率を作らない。',
   '初当り確率は1/○○の分母。RUSH突入率・継続率は0〜100の百分率。実質RUSH突入確率は出力不要（アプリ側で計算）。',
   '図柄揃いとチャージ込みの合算確率を混同しない。初当りとRUSH突入率が同じ母集団であることを確認できた時だけentryBasisConfirmed=true。',
   '特図1と特図2の振り分けは別々。払出出球と差玉を混ぜない。振り分けrateは0〜100の数値。',
   '出玉振り分け、導入日、メーカー、機種種別、LT、RUSH当り確率、RUSH継続率、状態遷移、その他のスペックも分かる範囲で。',
   '出球期待値が外部資料に明記される時だけminimum/estimate/exactを使う。振り分け100%があればauto。',
   'rushPayoutModelは各モードの確率、抽選回数、当り振り分け、全移行先が確実に判明した場合だけ記述し、不明ならnull。無理に推定しない。',
   'specEvidence.sourceUrlに出典URL、probabilityLabelに確率の正式名称、noteに未確認条件を記入。',
   'JSONオブジェクトだけ出力（マークダウンなし）。次の項目を全て用意し、不明な値はnull, "", []にする:',
   '{"name":"","manufacturer":"","type":null,"lt":null,"introductionDate":"","series":"",',
   '"basic":{"initialProbability":null,"rushEntryRate":null,"rushContinuationRate":null,"rushHitProbability":null,"rushHitType":null,"rushHitNote":""},',
   '"distributions":{"special1":[{"label":"","rate":null,"payout":""}],"special2":[{"label":"","rate":null,"payout":""}]},',
   '"flows":[{"from":"","to":"","rate":""}],"customSpecs":[{"label":"","value":""}],',
   '"specEvidence":{"sourceUrl":"","probabilityLabel":"","entryBasisConfirmed":false,"payoutUnit":"","note":""},',
   '"initialPayoutExpectation":{"kind":"auto","value":null,"note":""},"rushPayoutModel":null}',
   'rushPayoutModelを出す場合はversion:2,cap:12000,payoutUnit:"payout"または"net",',
   'states:[{id,name,method:"st"|"next"|"rate",hitProbability,spins,drawType,stConfirmed,continuationRate,rateConfirmed,onMiss,outcomes:[{label,rate,payoutText,nextStateId}],sourceUrl,note}],entries:[{stateId,rate}]。',
   '未確認のモデルや当り振り分けを作らない。'
  ].filter(Boolean).join('\n');
 }
 async function sdk(){
  const [app,check,ai]=await Promise.all([
   import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
   import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js'),
   import('https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js')
  ]);
  return {app,check,ai};
 }
 function explainAIError(err,model){
  const message=String(err?.message||err||'');
  const code=String(err?.code||'');
  const details=message+' '+code;
  const name=str(model)||'指定モデル';
  if(/429|quota|resource.exhausted|rate.limit/i.test(details))
   return 'AIの無料利用枠・リクエスト上限に達しました（429）。上限が回復してから再試行してください。';
  if(/503|overloaded|service.unavailable/i.test(details))
   return 'AIが一時的に利用できません（503）。時間をおいて再試行してください。';
  if(/genai config not found/i.test(details))
   return 'Firebase AI Logicの設定が見つかりません（404）。Firebase ConsoleでGemini Developer APIを有効にしてください。';
  if(/404|model.or.resource|not.found|does not have access/i.test(details)){
   if(/^gemini-2\.5-/.test(name))
    return 'モデル「'+name+'」を利用できません（404）。Gemini 2.5は過去に利用実績のあるプロジェクトに限定されています。新しいFirebaseプロジェクトでは利用できない可能性があります。';
   return 'モデル「'+name+'」にアクセスできません（404）。モデル名とFirebaseプロジェクトの利用権限を確認してください。';
  }
  if(/failed to fetch dynamically imported module|importing a module script failed|failed to load module script/i.test(details))
   return 'Firebase SDKを読み込めません。ネットワークやブラウザのコンテンツブロッカーを確認してください。';
  if(/app.?check|recaptcha|attestation|invalid.token/i.test(details))
   return 'Firebase App Checkの認証に失敗しました。reCAPTCHA Enterpriseのドメイン登録とApp Checkの設定を確認してください（'+(code||'認証エラー')+'）。';
  if(/grounding|google.search|googleSearch|search tool/i.test(details)&&/not.available|not.supported|billing|paid|not.allowed|forbidden|403|400/i.test(details))
   return 'このモデル・料金プランではGoogle検索を利用できない可能性があります（'+(code||'検索機能エラー')+'）。';
  if(/403|401|permission.denied|forbidden/i.test(details))
   return 'AIへのアクセスが拒否されました（403/401）。Firebase App Check、プロジェクトの無料枠利用資格、モデルの利用制限を確認してください。';
  if(/400|invalid.argument|bad.request/i.test(details))
   return 'AIがリクエストを受け付けませんでした（400）。モデルとGoogle検索ツールの対応状況を確認してください。';
  return 'AI検索に失敗しました'+(code?'（'+code.slice(0,75)+'）':'')+'。ブラウザの開発者ツールでエラーの詳細を確認してください。';
 }
 function makeClient(config,{loadSDK=sdk}={}){
  let pending=null;
  async function getService(){
   if(!pending)pending=(async()=>{
    const {app,check,ai}=await loadSDK(),fb=app.initializeApp(config.firebase,'pachispec-ai-shared');
    check.initializeAppCheck(fb,{provider:new check.ReCaptchaEnterpriseProvider(config.appCheckSiteKey),isTokenAutoRefreshEnabled:true});
    return {ai,svc:ai.getAI(fb,{backend:new ai.GoogleAIBackend(),useLimitedUseAppCheckTokens:true})};
   })().catch(err=>{pending=null;throw err;});
   return pending;
  }
  return {async research(name,ref=''){
   if(!isConfigured(config))throw Error('組み込みAIが設定されていません。');
   if(!str(name))throw Error('先に機種名を入力してください。');
   if(ref&&!link(ref))throw Error('参照URLを確認してください。');
   let result;
   try{
    const {ai,svc}=await getService();
    const model=ai.getGenerativeModel(svc,{model:config.model,tools:[{googleSearch:{}}],generationConfig:{temperature:0.1}});
    result=(await model.generateContent(prompt(str(name),ref))).response;
   }catch(err){
    console.error('[PachiSpec] Firebase AI request failed',err);
    throw Error(explainAIError(err,config.model));
   }
   const grounding=result?.candidates?.[0]?.groundingMetadata;
   const sources=(grounding?.groundingChunks||[]).map(c=>({title:str(c?.web?.title)||'参照ページ',url:link(c?.web?.uri)}))
    .filter(s=>s.url).slice(0,12);
   if(!sources.length)throw Error('検索結果の出典が確認できないため、入力に反映しません。');
   const spec=parseResponse(result?.text?.());
   const warnings=[];
   if(spec.basic.initialProbability===null)warnings.push('初当り確率が未確認です。');
   if(spec.basic.rushEntryRate===null)warnings.push('RUSH突入率が未確認です。');
   if(spec.basic.initialProbability!==null&&spec.basic.rushEntryRate!==null&&!spec.specEvidence.entryBasisConfirmed)
    warnings.push('初当りと突入率の母集団が一致するか未確認です。');
   if(!spec.rushPayoutModel)warnings.push('詳細なRUSH出球分布は条件不足のため未算出です。');
   return {spec,sources,grounding,warnings};
  }};
 }
 root.PachiSpecAI={isConfigured,available,makeClient,normalizeResponse,parseResponse,prompt,explainAIError};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.PachiSpecAI;
})(globalThis);
