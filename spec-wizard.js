(function () {
  'use strict';
  const M = window.PachiSpecModel;
  const dialog = document.querySelector('#specWizardDialog');
  const body = document.querySelector('#specWizardBody');
  const form = document.querySelector('#specWizardForm');
  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const q = (s, root=body) => root.querySelector(s);
  const qa = (s, root=body) => [...root.querySelectorAll(s)];
  let draft, step = 0, modeId, apply;
  const steps = ['ページの基本情報', '初当りの出球', 'RUSHの各モード', 'RUSHの開始先', '確認'];
  const field = (label, key, value, attrs='') => `<label class="field"><span>${label}</span><input data-field="${key}" value="${esc(value)}" ${attrs}></label>`;
  const number = 'type="number" min="0" step="any" inputmode="decimal"';
  const select = (label, key, value, options) => `<label class="field"><span>${label}</span><select data-field="${key}">${options.map(([v,n])=>`<option value="${esc(v)}" ${value === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
  const help = text => `<p class="wizard-help">${text}</p>`;
  const modes = () => draft.rushPayoutModel.states;
  const modeOptions = (current, allowEnd=true) => [['','不明・未確認'], ...(allowEnd ? [['end','終了（通常時へ）']] : []), ...modes().map(mode=>[mode.id, mode.id === current ? `${mode.name || '名称未入力'}（同じモード）` : mode.name || '名称未入力'])];
  const mode = () => modes().find(m=>m.id===modeId);
  function newMode() { return { id: crypto.randomUUID(), name: '', method: 'unknown', hitProbability: null, spins: null, continuationRate: null, onMiss: '', outcomes: [], stConfirmed: false, rateConfirmed: false, sourceUrl: '', note: '' }; }
  function checked(key, text, value) { return `<label class="wizard-check"><input type="checkbox" data-field="${key}" ${value ? 'checked' : ''}>${text}</label>`; }
  function readFields(root=body) {
    return Object.fromEntries(qa('[data-field]',root).map(input=>[input.dataset.field, input.type === 'checkbox' ? input.checked : input.type === 'number' ? M.num(input.value) : input.value.trim()]));
  }
  function read() {
    if (step === 0) {
      const f = readFields();
      draft.name=f.name; draft.introductionDate=f.introductionDate;
      draft.basic.initialProbability=f.initialProbability; draft.basic.rushEntryRate=f.rushEntryRate;
      draft.specEvidence={ ...draft.specEvidence, sourceUrl:f.sourceUrl, checkedAt:f.checkedAt, probabilityLabel:f.probabilityLabel, entryBasisConfirmed:f.entryBasisConfirmed, payoutUnit:f.payoutUnit, note:f.note };
      draft.rushPayoutModel.payoutUnit=f.payoutUnit;
    } else if (step === 1) {
      draft.distributions.special1=qa('[data-initial-row]').map(row=>readFields(row));
    } else if (step === 2 && mode()) {
      const m=mode(), f=readFields(q('#wizardModeFields'));
      Object.assign(m, f);
      m.outcomes=qa('[data-outcome-row]').map(row=>readFields(row));
    } else if (step === 3) {
      draft.rushPayoutModel.entries=qa('[data-entry-row]').map(row=>readFields(row));
    }
  }
  function render() {
    document.querySelector('#specWizardStep').textContent=`${step+1} / ${steps.length}　${steps[step]}`;
    document.querySelector('#specWizardBack').hidden=step===0;
    document.querySelector('#specWizardNext').textContent=step===steps.length-1 ? '編集画面に反映' : '次へ';
    let html='';
    if (step===0) {
      const e=draft.specEvidence || {};
      html=help('公式・P-WORLD等のページを別タブで開き、書いてある情報だけ転記してください。未掲載・判断できない項目は空欄のままで進めます。自動取得はしません。')+
      '<div class="form-grid">'+field('機種名','name',draft.name)+field('導入日','introductionDate',draft.introductionDate,'type="date"')+
      field('参照ページURL','sourceUrl',e.sourceUrl,'type="url" placeholder="https://…"')+field('情報を確認した日','checkedAt',e.checkedAt,'type="date"')+
      field('初当りとして使う確率の分母（1/○○）','initialProbability',draft.basic.initialProbability,number)+field('ページ上の確率の名称','probabilityLabel',e.probabilityLabel,'placeholder="例：図柄揃い確率／大当り確率"')+
      field('掲載されているRUSH突入率（%）','rushEntryRate',draft.basic.rushEntryRate,'type="number" min="0" max="100" step="any" inputmode="decimal"')+
      select('転記する出球の基準','payoutUnit',e.payoutUnit || '',[['','不明'],['payout','払出出球（賞球として出る個数）'],['net','差玉・獲得出球（打込分を差し引いた値）']])+'</div>'+
      checked('entryBasisConfirmed','上の初当りとRUSH突入率は、同じ当りを対象にした数値だとページから確認できた',e.entryBasisConfirmed)+
      help('図柄揃い・チャージ等を含む合算確率を混ぜないでください。確認できない場合、実質RUSH突入率は算出しません。出球も払出と差玉を混在させないでください。')+
      field('注記・ほかの参照URL（ページの注意書きを残せます）','note',e.note);
    } else if (step===1) {
      html=help('初当りの「振り分け表」を1行ずつ入力します。「出球×割合」の計算は自動です。合計100%が必要です。範囲・平均・＋αはそのまま記録し、勝手に固定出球へ置き換えません。')+
      draft.distributions.special1.map((row,i)=>`<div class="wizard-outcome" data-initial-row>${field('当りの名前・ラウンド','label',row.label,'placeholder="例：3R通常"')}${field('振り分け（%）','rate',String(row.rate ?? '').replace('%',''),number)}${field('出球（ページの記載）','payout',row.payout,'placeholder="例：450個／約1500個／320～790個"')}<button type="button" class="small-button" data-remove-initial="${i}">この行を削除</button></div>`).join('')+
      '<button class="button button-ghost" type="button" id="wizardAddInitial">＋ 振り分けを追加</button>'+help('特図1がこの初当りの振り分けに対応することを確認してください。初当り後のRUSHで増える出球は、ここには含めません。');
    } else if (step===2) {
      html=help('出球・抽選条件が変わるRUSH／LT／引き戻し区間を別モードとして登録します。演出が違うだけなら分ける必要はありません。最初にモードを追加して名前を付け、各振り分けの移行先を選びます。')+
      `<div class="wizard-mode-tabs">${modes().map(m=>`<button type="button" class="button ${m.id===modeId?'button-primary':'button-ghost'}" data-mode="${esc(m.id)}">${esc(m.name || '新しいモード')}</button>`).join('')}<button type="button" class="button button-ghost" id="wizardAddMode">＋ モード追加</button></div>`;
      const m=mode();
      if(m) {
        html+='<div id="wizardModeFields"><div class="form-grid">'+field('このモードの名前','name',m.name,'placeholder="例：下位RUSH／LT／残保留"')+
        select('この区間は、どの仕組みですか？','method',m.method,[['unknown','不明／転落式／特殊な仕組み'],['st','決まった回数だけ抽選（ST・時短・残保留）'],['next','次の当りまで継続（当り後の振り分けで継続・終了）'],['rate','継続率しか分からない（単一モードの概算）']])+'</div>';
        if(m.method==='st') html+='<div class="form-grid">'+field('この区間の当り確率の分母（1/○○）','hitProbability',m.hitProbability,number)+select('掲載されている確率の種類','drawType',m.drawType || '',[['','不明'],['実質当り確率','実質当り確率'],['図柄揃い確率','図柄揃い確率'],['大当り確率','大当り確率'],['普図抽選確率','普図抽選確率'],['確変中確率','確変中確率']])+field('この確率で抽選する回数','spins',m.spins,'type="number" min="0" step="1" inputmode="numeric"')+'</div>'+checked('stConfirmed','全回転が同じ確率で、途中転落・リセット・別条件の抽選がないことを確認できた',m.stConfirmed)+help('残保留も同じ確率・同じ出球・同じ当り後の移行先なら、合計回数を入力できます。条件が違う残保留や引き戻しは別モードを作り、「当らなかった後」の移行先に指定します。');
        if(m.method==='rate') html+=field('ページ掲載の継続率（%）','continuationRate',m.continuationRate,'type="number" min="0" max="100" step="any"')+checked('rateConfirmed','当り後は同じモードに戻る単一モードとして、掲載継続率による目安を表示する',m.rateConfirmed)+help('モード移行や、当り後の終了振り分けとの組合せには使えません。複数条件を合算した「トータル継続率」は、各モードの継続率として転記しないでください。');
        if(m.method==='unknown') html+=help('記録は保存できますが、転落式・回数リセット・複雑な保証等は、このウィザードでは分布を算出しません。下の注記に仕組みを残してください。');
        if(m.method!=='next') html+=select('当らないまま回数終了／非継続になった後は？','onMiss',m.onMiss,modeOptions(m.id));
        html+=field('このモードの参照URL（基本情報と同じなら空欄）','sourceUrl',m.sourceUrl,'type="url"')+field('確率の種類・注記・未確認の仕組み','note',m.note,'placeholder="普図抽選、引き戻し条件、転落条件など"')+'</div>';
        html+='<h3>当りを引いた場合の振り分け</h3>'+help('1回の当りで払い出される出球と、その当り後の行き先です。終了する当りにも出球があれば入力します。3000個が1500個×2回の保証なら、3000個にまとめるか保証用モードに分けるか、二重計上しない形で入力してください。')+
        m.outcomes.map((row,i)=>`<div class="wizard-outcome" data-outcome-row>${field('当りの名前','label',row.label,'placeholder="例：10R＋LT"')}${field('振り分け（%）','rate',row.rate,number)}${field('この当りの出球','payoutText',row.payoutText,'placeholder="例：1500個／約3000個"')}${select('当り後は？','nextStateId',row.nextStateId,modeOptions(m.id))}<button type="button" class="small-button" data-remove-outcome="${i}">この行を削除</button></div>`).join('')+
        '<div class="wizard-mode-tabs"><button type="button" class="button button-ghost" id="wizardAddOutcome">＋ 当り振り分けを追加</button><button type="button" class="button button-danger" id="wizardRemoveMode">このモードを削除</button></div>';
      }
    } else if(step===3) {
      html=help('RUSHに入った直後、どのモードから始まりますか？開始先が1つなら100%です。複数ある場合は「RUSHに突入したケースの内訳」を転記してください。初当り全体の振り分け率とは異なります。内訳が不明なら空欄で保存できます。')+
      draft.rushPayoutModel.entries.map((entry,i)=>`<div class="wizard-outcome" data-entry-row>${select('RUSH開始モード','stateId',entry.stateId,modeOptions('',false))}${field('RUSH突入時の割合（%）','rate',entry.rate,number)}<button type="button" class="small-button" data-remove-entry="${i}">この行を削除</button></div>`).join('')+
      '<button class="button button-ghost" type="button" id="wizardAddEntry">＋ 開始先を追加</button>'+help('この分布は「RUSHに突入した後の追加出球」です。初当り出球や、RUSHに入らなかった確率は含めません。入力した各当りの出球を足し合わせるもので、抽選中の玉減りは別途差し引きません。');
    } else {
      const result=M.calculate(draft.rushPayoutModel), initial=M.initialExpectation(draft.distributions.special1);
      html=`<h3>${esc(draft.name || '機種名未入力')}</h3><p>初当り出球期待値：<strong>${initial.value===null?'未算出':`${initial.kind==='estimate'?'約':''}${initial.value.toLocaleString('ja-JP',{maximumFractionDigits:1})}個`}</strong></p>`+
      (initial.value===null ? help(esc(initial.note)) : '')+
      `<p>RUSH出球分布：<strong>${result.distribution ? (result.approximate?'概算を表示できます':'入力条件に基づいて算出できます') : '未算出（情報待ち）'}</strong></p>`+
      (result.issues.length?`<ul class="wizard-issues">${result.issues.map(issue=>`<li>${esc(issue)}</li>`).join('')}</ul>`:'')+
      help('不足があっても途中データを保存できます。計算できない項目には理由を表示します。掲載値の丸めや条件省略による誤差は含まれるため、実機の完全再現を保証する表示ではありません。')+
      `<p>出球の基準：${esc({payout:'払出出球',net:'差玉・獲得出球'}[draft.specEvidence.payoutUnit] || '不明')}</p><p>参照URL：${esc(draft.specEvidence.sourceUrl || '未入力')}</p>`+
      help('「編集画面に反映」の後、機種編集の保存でデータを確定します。タグ・評価・既存メモも編集画面で確認できます。');
    }
    body.innerHTML=html;
    body.scrollTop=0;
  }
  function applyDraft() {
    read();
    draft.rushPayoutModel=M.normalize(draft.rushPayoutModel);
    const analysis=M.inspect(draft.rushPayoutModel);
    draft.rushPayoutModel.status=analysis.issues.length ? 'partial' : 'approximate';
    draft.initialPayoutExpectation={kind:'auto',value:null,note:'初当り振り分けから自動計算'};
    // Shared text tables mirror the structured mode data; they are not the calculation input.
    draft.distributions.special1=draft.distributions.special1.map(row=>({...row,rate:row.rate===null?'':`${row.rate}%`}));
    draft.distributions.special2=modes().flatMap(m=>m.outcomes.map(row=>({label:`${m.name || '名称未入力'}：${row.label || '当り'}`,rate:row.rate===null?'':`${row.rate}%`,payout:row.payoutText})));
    draft.flows=modes().flatMap(m=>m.outcomes.filter(row=>row.nextStateId).map(row=>({from:m.name,to:row.nextStateId==='end'?'通常時':modes().find(target=>target.id===row.nextStateId)?.name || '不明',rate:row.rate===null?'':`当り時 ${row.rate}%`})));
    apply(structuredClone(draft)); dialog.close();
  }
  body.addEventListener('change', event=>{if(event.target.matches('[data-field="method"]')){read();render();}});
  body.addEventListener('click', event=>{
    const b=event.target.closest('button');if(!b)return;
    read();
    if(b.dataset.mode) modeId=b.dataset.mode;
    if(b.id==='wizardAddInitial') draft.distributions.special1.push({label:'',rate:null,payout:''});
    if(b.dataset.removeInitial!==undefined) draft.distributions.special1.splice(Number(b.dataset.removeInitial),1);
    if(b.id==='wizardAddMode') {const m=newMode();modes().push(m);modeId=m.id;}
    if(b.id==='wizardRemoveMode') {draft.rushPayoutModel.states=modes().filter(m=>m.id!==modeId);modeId=modes()[0]?.id;}
    if(b.id==='wizardAddOutcome') mode().outcomes.push({label:'',rate:null,payoutText:'',nextStateId:''});
    if(b.dataset.removeOutcome!==undefined) mode().outcomes.splice(Number(b.dataset.removeOutcome),1);
    if(b.id==='wizardAddEntry') draft.rushPayoutModel.entries.push({stateId:'',rate:null});
    if(b.dataset.removeEntry!==undefined) draft.rushPayoutModel.entries.splice(Number(b.dataset.removeEntry),1);
    render();
  });
  form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;read();if(step===steps.length-1)applyDraft();else{step++;render();}});
  document.querySelector('#specWizardBack').addEventListener('click',()=>{read();step=Math.max(0,step-1);render();});
  document.querySelector('#specWizardSaveDraft').addEventListener('click',applyDraft);
  document.querySelector('#specWizardCancel').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog){event.stopImmediatePropagation();applyDraft();}});
  dialog.addEventListener('cancel',event=>{event.preventDefault();applyDraft();});
  window.PachiSpecWizard={open(machine, onApply) {
    draft=structuredClone(machine);apply=onApply;step=0;
    draft.specEvidence={sourceUrl:'',checkedAt:'',payoutUnit:'',entryBasisConfirmed:false,...draft.specEvidence};
    draft.distributions.special1=draft.distributions.special1.map(row=>({...row,rate:M.num(String(row.rate??'').replace('%',''))}));
    if(draft.rushPayoutModel?.version!==2) {
      const old=draft.rushPayoutModel;
      const oldNotes=[old?.note, ...(old?.specialMechanics || [])].filter(Boolean).join(' ／ ');
      if(oldNotes) draft.specEvidence.note=[draft.specEvidence.note, `旧データの注記：${oldNotes}`].filter(Boolean).join('\n');
      const states=old?.states?.length ? old.states.map(m=>({...newMode(),...m, method:m.hitProbability && m.spins ? 'st':'unknown',onMiss:typeof m.transitions?.onMiss==='string'?m.transitions.onMiss:'', outcomes:(m.outcomes||[]).map(row=>({label:row.label,rate:row.rate,payoutText:row.payout?.value==null?'':String(row.payout.value),nextStateId:typeof m.transitions?.onHit==='string'?m.transitions.onHit:''}))})) : [newMode()];
      if(!old && draft.distributions.special2.length) states[0].outcomes=draft.distributions.special2.map(row=>({label:row.label,rate:M.num(String(row.rate??'').replace('%','')),payoutText:row.payout,nextStateId:''}));
      draft.rushPayoutModel={version:2,cap:12000,states,entries:[{stateId:old?.entryStateId || '',rate:100}],payoutUnit:draft.specEvidence.payoutUnit};
    }
    modeId=modes()[0]?.id;render();dialog.showModal();
  }};
})();
