/* Public-spec inputs and conditional RUSH payout calculations. No network access. */
(function (root) {
  'use strict';
  const num = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
  const amount = text => {
    const value = String(text ?? '').trim().replaceAll(',', '');
    const match = value.match(/^(約)?\s*(\d+(?:\.\d+)?)\s*(?:個|発|玉)?$/);
    return match ? { value: Number(match[2]), approximate: Boolean(match[1]) } : null;
  };
  const sum100 = rows => rows.length > 0 && rows.every(row => num(row.rate) !== null && num(row.rate) >= 0) && Math.abs(rows.reduce((total, row) => total + Number(row.rate), 0) - 100) < .01;
  function initialExpectation(rows) {
    if (!sum100(rows)) return { kind: 'unavailable', value: null, note: '初当り振り分けの割合が未入力、または合計100%ではありません。' };
    let value = 0, approximate = false;
    for (const row of rows) {
      if (Number(row.rate) === 0) continue;
      const parsed = amount(row.payout);
      if (!parsed) return { kind: 'unavailable', value: null, note: '出球の範囲・＋α・平均値だけでは初当りの分布を特定できません。' };
      value += Number(row.rate) / 100 * parsed.value;
      approximate ||= parsed.approximate;
    }
    return { kind: approximate ? 'estimate' : 'exact', value, note: '初当り振り分けから算出（入力した出球の単位・範囲に準拠）' };
  }
  function normalize(model) {
    return { ...model, version: 2, cap: 12000,
      entries: (model.entries || []).map(item => ({ stateId: String(item.stateId || ''), rate: num(item.rate) })),
      states: (model.states || []).map(item => ({ ...item, id: String(item.id || ''), name: String(item.name || ''),
        hitProbability: num(item.hitProbability), spins: num(item.spins), continuationRate: num(item.continuationRate),
        outcomes: (item.outcomes || []).map(row => ({ ...row, rate: num(row.rate), payoutText: String(row.payoutText ?? ''), nextStateId: String(row.nextStateId || '') }))
      })) };
  }
  function inspect(model) {
    const issues = [], probabilities = new Map();
    if (!model || model.version !== 2) return { issues: ['質問形式でRUSHの条件を確認してください。'], probabilities, approximate: true };
    const modes = new Map(model.states.map(item => [item.id, item]));
    if (!['payout','net'].includes(model.payoutUnit)) issues.push('出球の基準（払出／差玉）を確認してください。');
    if (model.entries.some(entry => !modes.has(entry.stateId))) issues.push('RUSH開始先のモードを選んでください。');
    if (modes.size !== model.states.length || modes.has('end') || modes.has('')) issues.push('モード名・識別子の重複または不正があります。');
    if (!model.entries.length || !sum100(model.entries)) issues.push('RUSH開始モードの内訳を合計100%で入力してください。');
    let approximate = false;
    const pending = model.entries.filter(item => Number(item.rate) > 0).map(item => item.stateId), reached = new Set();
    while (pending.length) {
      const id = pending.pop();
      if (id === 'end' || reached.has(id)) continue;
      reached.add(id);
      const mode = modes.get(id);
      if (!mode) { issues.push('開始先または移行先のモードが未指定です。'); continue; }
      const label = mode.name || '名称未入力のモード';
      let chance = null;
      if (mode.method === 'st') {
        if (!(mode.hitProbability >= 1) || !Number.isInteger(mode.spins) || mode.spins < 0) issues.push(`${label}：当り確率の分母と抽選回数が必要です。`);
        else if (!mode.stConfirmed) issues.push(`${label}：毎回同じ確率で抽選し、途中転落がない条件を確認してください。`);
        else chance = -Math.expm1(mode.spins * Math.log1p(-1 / mode.hitProbability));
        if (mode.spins === 0) chance = 0;
      } else if (mode.method === 'next') chance = 1;
      else if (mode.method === 'rate') {
        approximate = true;
        if (mode.continuationRate == null || mode.continuationRate < 0 || mode.continuationRate > 100 || !mode.rateConfirmed) issues.push(`${label}：掲載継続率と、単一モードの目安として使うことの確認が必要です。`);
        else chance = mode.continuationRate / 100;
        if (mode.outcomes.some(row => Number(row.rate) > 0 && row.nextStateId !== id) || mode.onMiss !== 'end') issues.push(`${label}：掲載継続率による概算は、当り後は同じモード・非継続時は終了する場合のみ対応します。`);
      } else issues.push(`${label}：転落式・特殊条件・不明な方式はまだ分布を計算できません。`);
      if (!mode.name.trim()) issues.push('モード名を入力してください。');
      if (chance !== null) probabilities.set(id, chance);
      if (chance !== 0) {
        if (!sum100(mode.outcomes)) issues.push(`${label}：当り時の振り分けを合計100%で入力してください。`);
        for (const row of mode.outcomes) {
          if (Number(row.rate) === 0) continue;
          const parsed = amount(row.payoutText);
          if (!parsed) issues.push(`${label}：各振り分けの出球が必要です（範囲・平均・＋αだけでは計算しません）。`);
          approximate ||= Boolean(parsed?.approximate);
          if (!row.nextStateId || (row.nextStateId !== 'end' && !modes.has(row.nextStateId))) issues.push(`${label}：当り後の移行先を選んでください。`);
          else pending.push(row.nextStateId);
        }
      }
      if (chance !== 1) {
        if (!mode.onMiss || (mode.onMiss !== 'end' && !modes.has(mode.onMiss))) issues.push(`${label}：当らず終了した後の移行先を選んでください。`);
        else pending.push(mode.onMiss);
      }
    }
    if (!reached.size) issues.push('RUSH開始先を選んでください。');
    return { issues: [...new Set(issues)], probabilities, approximate };
  }
  function calculate(input) {
    const model = normalize(input);
    const info = inspect(model);
    if (info.issues.length) return { ...info, distribution: null };
    const modes = new Map(model.states.map(mode => [mode.id, mode]));
    const completed = new Map();
    let active = new Map(), operations = 0, remainder = 0;
    const put = (map, id, total, mass) => {
      if (mass === 0) return;
      total = Math.round(total * 1000) / 1000;
      if (total >= model.cap || id === 'end') {
        const key = Math.min(total, model.cap);
        completed.set(key, (completed.get(key) || 0) + mass);
      } else {
        const key = JSON.stringify([id, total]);
        map.set(key, (map.get(key) || 0) + mass);
      }
    };
    model.entries.forEach(entry => put(active, entry.stateId, 0, entry.rate / 100));
    for (let step = 0; step < 2000 && active.size; step++) {
      const next = new Map();
      for (const [key, mass] of active) {
        const [id, total] = JSON.parse(key), mode = modes.get(id), hit = info.probabilities.get(id);
        if (++operations > 300000) return { ...info, distribution: null, issues: ['組み合わせ数が計算上限を超えました。分布は表示せず入力内容を保存します。'] };
        put(next, mode.onMiss, total, mass * (1 - hit));
        for (const outcome of mode.outcomes) {
          if (!hit || !outcome.rate) continue;
          put(next, outcome.nextStateId, total + amount(outcome.payoutText).value, mass * hit * outcome.rate / 100);
        }
      }
      active = next;
      remainder = [...active.values()].reduce((a, b) => a + b, 0);
      if (remainder < 1e-10) break;
    }
    if (remainder > 1e-8) return { ...info, distribution: null, issues: ['終了しない循環、または収束しない条件があります。移行先・出球を確認してください。'] };
    return { ...info, issues: [], remainder, distribution: [...completed].map(([payout, probability]) => ({ payout, probability: probability * 100, capped: payout === model.cap })).sort((a,b) => a.payout - b.payout) };
  }
  const api = { num, amount, sum100, initialExpectation, normalize, inspect, calculate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PachiSpecModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
