(() => {
  'use strict';

  const STORAGE_KEY = 'pachinko-spec-library-v1';
  const SCHEMA_VERSION = 10;
  const RATINGS_STORAGE_KEY = 'pachispec-personal-ratings-v1';
  const VIEW_STORAGE_KEY = 'pachispec-view-v1';
  const OVERALL_RATING_ID = '__overall__';
  const DEFAULT_RATING_CRITERIA = [
    { id: 'production', name: '演出' },
    { id: 'output', name: '出玉感' },
    { id: 'rush', name: 'RUSH' }
  ];

  const sampleMachine = {
    id: 'sample-machine',
    name: 'e サンプル・フロンティア',
    manufacturer: 'サンプル工房',
    type: 'e',
    introductionDate: '2026-09-07',
    series: 'フロンティアシリーズ',
    tags: ['メーカー：サンプル工房', 'P/e：e機', '仕様：LT', 'スペック：ミドル', '方式：1種2種混合'],
    lt: true,
    basic: {
      initialProbability: 319.7,
      rushEntryRate: 50,
      rushContinuationRate: 81,
      initialPayout: 450,
      rushHitProbability: 99.9,
      rushHitType: '実質当り確率',
      rushHitNote: '図柄揃いを含む実質値'
    },
    distributions: {
      special1: [
        { label: '10R＋RUSH', rate: '50%', payout: '1,500個' },
        { label: '3R 通常', rate: '50%', payout: '450個' }
      ],
      special2: [
        { label: '10R＋LT', rate: '20%', payout: '1,500個' },
        { label: '10R＋RUSH継続', rate: '80%', payout: '1,500個' }
      ]
    },
    flows: [
      { from: '通常時', to: 'RUSH', rate: '50%' },
      { from: 'RUSH', to: 'LT', rate: '20%' }
    ],
    customSpecs: [
      { label: 'RUSH回数', value: '144回' },
      { label: '賞球', value: '1＆5＆15' },
      { label: '大当り出玉', value: '約450 / 1,500個' },
      { label: '時短', value: '通常大当り後なし' }
    ],
    notes: '操作確認用の架空機種です。編集または削除してお使いください。',
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z'
  };

  const defaultData = () => ({
    schemaVersion: SCHEMA_VERSION,
    settings: {
      ratingCriteria: structuredClone(DEFAULT_RATING_CRITERIA),
      tags: [...sampleMachine.tags]
    },
    machines: [structuredClone(sampleMachine)]
  });

  const state = {
    ...loadStores(),
    filters: { search: '', tags: [], sortField: 'date', sortDirection: 'desc', rating: defaultRatingFilter() },
    view: 'library',
    headerCollapsed: false,
    rankingCriterionId: null,
    tagPane: 'filter',
    ratingPane: 'filter',
    editorTags: [],
    machineTagDraft: [],
    machineTagTarget: null,
    comparison: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const el = {
    grid: $('#machineGrid'),
    empty: $('#emptyState'),
    emptyTitle: $('#emptyTitle'),
    emptyText: $('#emptyText'),
    count: $('#machineCount'),
    result: $('#resultSummary'),
    detailDialog: $('#detailDialog'),
    detailContent: $('#detailContent'),
    ratingDialog: $('#ratingDialog'),
    editorDialog: $('#editorDialog'),
    criteriaDialog: $('#criteriaDialog'),
    tagDialog: $('#tagDialog'),
    machineTagDialog: $('#machineTagDialog'),
    form: $('#editorForm'),
    toast: $('#toast')
  };

  function ratingsDocument(ratings, weights = {}, memos = {}) {
    return { format: 'pachispec-ratings', schemaVersion: 3, ratings, weights, memos };
  }

  function readPersonalData(parsed) {
    let source;
    if (parsed?.format === 'pachispec-ratings' && [1, 2, 3].includes(parsed.schemaVersion)) {
      source = parsed.ratings;
    } else if (!parsed?.format && Array.isArray(parsed?.machines)) {
      // Older combined backups can be imported explicitly into either section.
      const scored = parsed.machines.filter(machine => Object.hasOwn(machine, 'ratings'));
      if (!scored.length) throw new Error('このファイルに評価点はありません。');
      if (scored.some(machine => typeof machine.id !== 'string' || !machine.id)) throw new Error('評価対象の機種IDがありません。');
      source = Object.fromEntries(scored.map(machine => [machine.id, machine.ratings]));
    } else {
      throw new Error('自分の評価データのファイルを選んでください。');
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('評価データの形式が正しくありません。');
    return Object.fromEntries(Object.entries(source).map(([machineId, scores]) => {
      if (!machineId || !scores || typeof scores !== 'object' || Array.isArray(scores)) throw new Error('機種ごとの評価の形式が正しくありません。');
      const entries = Object.entries(scores).filter(([id]) => id !== 'overall' && id !== OVERALL_RATING_ID);
      if (entries.some(([id, value]) => !id || !['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < .5 || Number(value) > 5 || !Number.isInteger(Number(value) * 2))) {
        throw new Error('評価点は0.5〜5の0.5刻みで指定してください。');
      }
      return [machineId, Object.fromEntries(entries.map(([id, value]) => [id, Number(value)]))];
    }));
  }

  function weightsFromCriteria(criteria = []) {
    return Object.fromEntries(criteria.flatMap(item => [item, ...(item.children || [])])
      .filter(item => Object.hasOwn(item, 'weight'))
      .map(item => [item.id, normalizeRatingWeight(item.weight)]));
  }

  function readPersonalWeights(parsed) {
    if (parsed?.format !== 'pachispec-ratings') return weightsFromCriteria(parsed?.settings?.ratingCriteria);
    if (parsed.schemaVersion === 1) return {};
    const weights = parsed.weights;
    if (!weights || typeof weights !== 'object' || Array.isArray(weights)) throw new Error('重みの形式が正しくありません。');
    return Object.fromEntries(Object.entries(weights).map(([id, value]) => {
      const normalized = normalizeRatingWeight(value);
      if (!id || (value !== null && value !== '' && normalized === null)) throw new Error('重みは0以上の数値で指定してください。');
      return [id, normalized];
    }));
  }

  function readPersonalMemos(parsed) {
    if (parsed?.format !== 'pachispec-ratings' || parsed.schemaVersion < 3) return {};
    if (!parsed.memos || typeof parsed.memos !== 'object' || Array.isArray(parsed.memos)) throw new Error('評価メモの形式が正しくありません。');
    if (Object.entries(parsed.memos).some(([id, value]) => !id || typeof value !== 'string')) throw new Error('評価メモは文字列で指定してください。');
    return { ...parsed.memos };
  }

  function effectiveCriteria() {
    return state.data.settings.ratingCriteria.map(item => ({ ...item,
      weight: Object.hasOwn(state.weights, item.id) ? state.weights[item.id] : null,
      children: (item.children || []).map(child => ({ ...child,
        weight: Object.hasOwn(state.weights, child.id) ? state.weights[child.id] : null
      }))
    }));
  }

  function visibleCriteria() {
    return effectiveCriteria().filter(item => item.weight !== 0);
  }

  function visibleRatingIds() {
    return visibleCriteria().flatMap(item =>
      item.children.length ? item.children.filter(child => child.weight !== 0).map(child => child.id) : [item.id]);
  }

  function loadStores() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : defaultData();
    if (!Array.isArray(parsed?.machines)) throw new Error('保存された機種データの形式が正しくありません。');
    const data = normalizeData(parsed);
    const personal = localStorage.getItem(RATINGS_STORAGE_KEY);
    let ratings;
    let memos = {};
    let weights = weightsFromCriteria(parsed.settings?.ratingCriteria);
    if (personal !== null) {
      const saved = JSON.parse(personal);
      ratings = readPersonalData(saved);
      memos = readPersonalMemos(saved);
      weights = { ...weights, ...readPersonalWeights(saved) };
    } else {
      ratings = readPersonalData(ratingsDocument(Object.fromEntries(parsed.machines.map((machine, i) => [data.machines[i].id, machine.ratings || {}]))));
    }
    // Persist personal settings before removing them from the shared source.
    try {
      localStorage.setItem(RATINGS_STORAGE_KEY, JSON.stringify(ratingsDocument(ratings, weights, memos)));
    } catch (error) {
      console.warn('評価の分離保存に失敗しました。元のデータを保持しています。', error);
      return { data, ratings, weights, memos, migrationPending: true };
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.warn('機種データの保存に失敗しました。元のデータを保持しています。', error);
    }
    return { data, ratings, weights, memos };
  }

  function machineRatings(machine) {
    return machine && Object.hasOwn(state.ratings, machine.id) ? state.ratings[machine.id] : {};
  }

  function saveRatings(message) {
    localStorage.setItem(RATINGS_STORAGE_KEY, JSON.stringify(ratingsDocument(state.ratings, state.weights, state.memos)));
    recordChange(message || '評価を変更');
    if (message) showToast(message);
  }

  function setMachineRatings(id, scores, memo, persist = true) {
    const previous = Object.hasOwn(state.ratings, id) ? state.ratings[id] : {};
    // Preserve unmatched item IDs until their definitions are loaded again.
    const activeIds = visibleRatingIds();
    const kept = Object.fromEntries(Object.entries(previous).filter(([key]) => !activeIds.includes(key)));
    state.ratings = { ...state.ratings, [id]: { ...kept, ...scores } };
    if (memo !== undefined) state.memos = { ...state.memos, [id]: memo };
    if (persist) saveRatings();
  }

  function normalizeData(data) {
    const incomingVersion = Number(data.schemaVersion) || 1;
    const sourceCriteria = incomingVersion < 2
      ? DEFAULT_RATING_CRITERIA
      : (Array.isArray(data.settings?.ratingCriteria) ? data.settings.ratingCriteria : []);
    const machines = data.machines.map(normalizeMachine);
    const savedTags = Array.isArray(data.settings?.tags) ? data.settings.tags.filter(item => typeof item === 'string' && item.trim()) : [];
    const allTags = [...new Set([...savedTags, ...machines.flatMap(machine => machine.tags)])];
    return {
      format: 'pachispec-catalog',
      schemaVersion: SCHEMA_VERSION,
      settings: {
        ratingCriteria: sourceCriteria
          .filter(item => item && item.id !== 'overall' && item.id !== OVERALL_RATING_ID && String(item.name || '').trim())
          .map(item => ({
            id: item.id || crypto.randomUUID(),
            name: String(item.name).trim(),
            children: (Array.isArray(item.children) ? item.children : [])
              .filter(child => child && String(child.name || '').trim())
              .map(child => ({ id: child.id || crypto.randomUUID(), name: String(child.name).trim() }))
          })),
        tags: allTags
      },
      machines
    };
  }

  function normalizeMachine(machine) {
    const tags = Array.isArray(machine.tags) ? machine.tags.filter(item => typeof item === 'string' && item.trim()) : [];
    if (machine.manufacturer && !tags.some(tag => tagMatchesCategory(tag, 'メーカー'))) tags.push(`メーカー：${machine.manufacturer}`);
    if (machine.type && !tags.some(tag => tagMatchesCategory(tag, 'P/e'))) tags.push(`P/e：${machine.type === 'e' ? 'e機' : 'P機'}`);
    if (machine.lt && !tags.some(tag => splitTag(tag).item === 'LT')) tags.push('仕様：LT');
    const uniqueTags = [...new Set(tags)];
    const manufacturer = tagValue(uniqueTags, 'メーカー') || machine.manufacturer || '';
    const typeValue = tagValue(uniqueTags, 'P/e');
    const type = /^e/i.test(typeValue) ? 'e' : (machine.type === 'e' ? 'e' : 'P');
    const lt = uniqueTags.some(tag => splitTag(tag).item.toLocaleUpperCase('ja') === 'LT');
    return {
      id: machine.id || crypto.randomUUID(),
      name: machine.name || '名称未設定',
      manufacturer,
      type,
      introductionDate: machine.introductionDate || '',
      series: machine.series || '',
      tags: uniqueTags,
      lt,
      basic: {
        initialProbability: numberOrNull(machine.basic?.initialProbability),
        rushEntryRate: numberOrNull(machine.basic?.rushEntryRate),
        rushContinuationRate: numberOrNull(machine.basic?.rushContinuationRate),
        initialPayout: numberOrNull(machine.basic?.initialPayout),
        rushHitProbability: numberOrNull(machine.basic?.rushHitProbability),
        rushHitType: machine.basic?.rushHitType || '実質当り確率',
        rushHitNote: machine.basic?.rushHitNote || ''
      },
      distributions: {
        special1: Array.isArray(machine.distributions?.special1) ? machine.distributions.special1 : [],
        special2: Array.isArray(machine.distributions?.special2) ? machine.distributions.special2 : []
      },
      flows: Array.isArray(machine.flows) ? machine.flows : [],
      customSpecs: Array.isArray(machine.customSpecs) ? machine.customSpecs : [],
      rushPayoutModel: normalizeRushPayoutModel(machine.rushPayoutModel),
      initialPayoutExpectation: normalizePayoutExpectation(machine.initialPayoutExpectation),
      notes: machine.notes || '',
      createdAt: machine.createdAt || new Date().toISOString(),
      updatedAt: machine.updatedAt || new Date().toISOString()
    };
  }

  function numberOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeRushPayoutModel(model) {
    if (!model || !Array.isArray(model.states)) return null;
    return {
      version: Number(model.version) || 1,
      cap: numberOrNull(model.cap) || 12000,
      status: ['exact', 'approximate', 'partial'].includes(model.status) ? model.status : 'partial',
      entryStateId: String(model.entryStateId || 'main'),
      states: model.states.map(state => ({
        id: String(state.id || crypto.randomUUID()),
        name: String(state.name || 'RUSH'),
        drawType: String(state.drawType || ''),
        hitProbability: numberOrNull(state.hitProbability),
        spins: numberOrNull(state.spins),
        spinsDerived: Boolean(state.spinsDerived),
        continuationRate: numberOrNull(state.continuationRate),
        outcomes: Array.isArray(state.outcomes) ? state.outcomes.map(outcome => ({
          label: String(outcome.label || 'RUSH中当り'),
          rate: numberOrNull(outcome.rate),
          payout: outcome.payout && typeof outcome.payout === 'object' ? { ...outcome.payout } : null
        })) : [],
        transitions: state.transitions && typeof state.transitions === 'object' ? { ...state.transitions } : { onHit: state.id || 'main', onMiss: 'end' }
      })),
      specialMechanics: Array.isArray(model.specialMechanics) ? model.specialMechanics.map(String) : [],
      note: String(model.note || '')
    };
  }

  function normalizePayoutExpectation(value) {
    const allowed = new Set(['auto', 'exact', 'minimum', 'estimate', 'unavailable']);
    const kind = allowed.has(value?.kind) ? value.kind : 'auto';
    return {
      kind,
      value: numberOrNull(value?.value),
      note: String(value?.note || '').trim()
    };
  }

  function persistCatalog() {
    if (state.migrationPending) {
      saveRatings();
      state.migrationPending = false;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }

  function saveData(message) {
    persistSnapshot(snapshot());
    state.migrationPending = false;
    recordChange(message || 'データを変更');
    syncSettingsToUrl();
    if (message) showToast(message);
  }

  function bytesToBase64Url(bytes) {
    let binary = '';
    bytes.forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(text) {
    const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - text.length % 4) % 4);
    return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
  }

  let urlSyncVersion = 0;
  async function syncSettingsToUrl() {
    const requestVersion = ++urlSyncVersion;
    const payload = JSON.stringify({ v: 1, tags: [...state.data.settings.tags].sort((a, b) => a.localeCompare(b, 'ja')), criteria: state.data.settings.ratingCriteria });
    let encoded;
    try {
      const stream = new Blob([payload]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      encoded = `z.${bytesToBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
    } catch {
      encoded = `j.${bytesToBase64Url(new TextEncoder().encode(payload))}`;
    }
    if (requestVersion !== urlSyncVersion) return;
    try {
      history.replaceState(null, '', `#cfg=${encoded}`);
    } catch (error) {
      console.warn('URLへ設定を保存できませんでした。', error);
    }
  }

  async function applyUrlSettings() {
    const match = location.hash.match(/(?:^#|&)cfg=([^&]+)/);
    if (!match) return;
    try {
      const [format, body] = decodeURIComponent(match[1]).split('.', 2);
      const bytes = base64UrlToBytes(body || format);
      let text;
      if (format === 'z') {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        text = await new Response(stream).text();
      } else {
        text = new TextDecoder().decode(bytes);
      }
      const settings = JSON.parse(text);
      if (Array.isArray(settings.tags)) state.data.settings.tags = [...new Set([...settings.tags, ...state.data.machines.flatMap(machine => machine.tags)])];
      if (Array.isArray(settings.criteria)) state.data.settings.ratingCriteria = normalizeData({ schemaVersion: SCHEMA_VERSION, settings: { ratingCriteria: settings.criteria, tags: [] }, machines: [] }).settings.ratingCriteria;
      persistCatalog();
    } catch (error) {
      console.warn('URLの設定を読み込めませんでした。', error);
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function splitTag(tag) {
    const text = String(tag || '').trim();
    const match = text.match(/^([^：:]+)[：:](.+)$/);
    return match
      ? { category: match[1].trim(), item: match[2].trim(), grouped: true }
      : { category: 'その他', item: text, grouped: false };
  }

  function tagMatchesCategory(tag, category) {
    return splitTag(tag).grouped && splitTag(tag).category === category;
  }

  function tagValue(tags, category) {
    const tag = tags.find(item => tagMatchesCategory(item, category));
    return tag ? splitTag(tag).item : '';
  }

  function groupedTags(tags = state.data.settings.tags) {
    const groups = new Map();
    [...new Set(tags)].sort((a, b) => a.localeCompare(b, 'ja')).forEach(tag => {
      const parsed = splitTag(tag);
      if (!groups.has(parsed.category)) groups.set(parsed.category, []);
      groups.get(parsed.category).push({ raw: tag, ...parsed });
    });
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === 'その他') return 1;
      if (b === 'その他') return -1;
      return a.localeCompare(b, 'ja');
    });
  }

  function tagChipTemplate(tag) {
    return `<span class="tag-chip">${escapeHtml(tag)}</span>`;
  }

  function cardTagTemplate(tag) {
    return `<span class="tag">${escapeHtml(tag)}</span>`;
  }

  function effectiveRush(machine) {
    const probability = numberOrNull(machine.basic.initialProbability);
    const entryRate = numberOrNull(machine.basic.rushEntryRate);
    if (!probability || !entryRate || entryRate <= 0) return null;
    return probability / (entryRate / 100);
  }

  function formatProbability(value) {
    if (!value) return '—';
    return `約1/${value.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}`;
  }

  function formatPayout(value) {
    return value !== null && value !== undefined ? `${Number(value).toLocaleString('ja-JP')}個` : '—';
  }

  function parseSpecNumber(value) {
    const match = String(value ?? '').replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function calculatedPayoutExpectation(machine) {
    const rows = machine.distributions?.special1 || [];
    if (!rows.length) return null;
    let totalRate = 0;
    let totalPayout = 0;
    for (const row of rows) {
      const rate = parseSpecNumber(row.rate);
      const payoutText = String(row.payout || '').replaceAll(',', '');
      const numbers = payoutText.match(/\d+(?:\.\d+)?/g) || [];
      const variable = /[～~〜＋+α]|平均|以上|以下|超/.test(payoutText) || numbers.length !== 1;
      const payout = variable ? null : Number(numbers[0]);
      if (rate === null || payout === null) return null;
      totalRate += rate;
      totalPayout += rate / 100 * payout;
    }
    return Math.abs(totalRate - 100) < 0.01 ? totalPayout : null;
  }

  function initialPayoutExpectation(machine) {
    const saved = normalizePayoutExpectation(machine.initialPayoutExpectation);
    if (saved.kind !== 'auto' && saved.kind !== 'unavailable' && saved.value !== null) return saved;
    const calculated = calculatedPayoutExpectation(machine);
    if (calculated !== null) return { kind: 'exact', value: calculated, note: '特図1振り分けから自動算出' };
    const legacy = numberOrNull(machine.basic?.initialPayout);
    if (legacy !== null) return { kind: 'estimate', value: legacy, note: '旧データから移行' };
    return { kind: 'unavailable', value: null, note: saved.note };
  }

  function formatPayoutExpectation(info) {
    if (!info || info.value === null || info.value === undefined) return '—';
    const value = `${Number(info.value).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}個`;
    if (info.kind === 'minimum') return `${value}以上`;
    if (info.kind === 'estimate') return `約${value}`;
    return value;
  }

  function rushPayoutDistribution(machine, cap = 12000) {
    const model = machine.rushPayoutModel;
    const stateModel = model?.states?.find(state => state.id === model.entryStateId) || model?.states?.[0];
    const continuation = numberOrNull(stateModel?.continuationRate ?? machine.basic?.rushContinuationRate);
    cap = numberOrNull(model?.cap) || cap;
    let outcomes = [];
    let rateTotal = 0;
    if (stateModel?.outcomes?.length) {
      for (const outcome of stateModel.outcomes) {
        const rate = numberOrNull(outcome.rate);
        const payoutValue = numberOrNull(outcome.payout?.calculationValue ?? outcome.payout?.value);
        if (rate === null || rate <= 0 || payoutValue === null) return null;
        outcomes.push({ payout: payoutValue, rate: rate / 100 });
        rateTotal += rate;
      }
    } else {
      const rows = machine.distributions?.special2 || [];
      for (const row of rows) {
        const rate = parseSpecNumber(row.rate);
        const payoutText = String(row.payout || '').replaceAll(',', '');
        const numbers = payoutText.match(/\d+(?:\.\d+)?/g) || [];
        const variable = /[～~〜＋+α]|平均|以上|以下|超/.test(payoutText) || numbers.length !== 1;
        if (rate === null || rate <= 0 || variable) return null;
        outcomes.push({ payout: Number(numbers[0]), rate: rate / 100 });
        rateTotal += rate;
      }
    }
    if (continuation === null || continuation <= 0 || continuation >= 100 || !outcomes.length) return null;
    if (Math.abs(rateTotal - 100) >= 0.01) return null;

    const hitRate = continuation / 100;
    let active = new Map([[0, 1]]);
    const completed = new Map();
    for (let step = 0; step < 250 && active.size; step += 1) {
      const next = new Map();
      let nextMass = 0;
      for (const [total, probability] of active) {
        completed.set(total, (completed.get(total) || 0) + probability * (1 - hitRate));
        for (const outcome of outcomes) {
          const probabilityNext = probability * hitRate * outcome.rate;
          const payoutNext = total + outcome.payout;
          if (payoutNext >= cap) {
            completed.set(cap, (completed.get(cap) || 0) + probabilityNext);
          } else {
            next.set(payoutNext, (next.get(payoutNext) || 0) + probabilityNext);
            nextMass += probabilityNext;
          }
        }
      }
      active = nextMass < 1e-12 ? new Map() : next;
    }
    const distribution = [...completed.entries()]
      .map(([payout, probability]) => ({ payout, probability: probability * 100, capped: payout === cap }))
      .filter(item => item.probability >= 0.005)
      .sort((a, b) => a.payout - b.payout);
    return distribution.length ? distribution : null;
  }

  function formatDistributionPayout(item) {
    return `${Number(item.payout).toLocaleString('ja-JP')}個${item.capped ? '以上' : ''}`;
  }

  function payoutSummaryTemplate(machine) {
    const distribution = rushPayoutDistribution(machine);
    if (!distribution) {
      return `<div class="payout-summary payout-summary-empty"><div class="payout-summary-head"><span>RUSH出球分布</span><small>12,000個上限</small></div><p>特図2の出球振り分け登録後に表示</p></div>`;
    }
    const items = [...distribution]
      .sort((a, b) => b.probability - a.probability || a.payout - b.payout)
      .slice(0, 4)
      .sort((a, b) => a.payout - b.payout);
    const quality = machine.rushPayoutModel?.status === 'exact' ? '公開振り分け' : '概算';
    return `<div class="payout-summary"><div class="payout-summary-head"><span>主なRUSH出球分布</span><small>${quality}・12,000個以上を集約</small></div><div class="payout-summary-grid">${items.map(item => `<div><span>${formatDistributionPayout(item)}</span><strong>${item.probability.toFixed(1)}%</strong></div>`).join('')}</div></div>`;
  }

  function payoutDistributionDetailTemplate(machine) {
    const distribution = rushPayoutDistribution(machine);
    if (!distribution) return '';
    const quality = machine.rushPayoutModel?.status === 'exact' ? '公開振り分け' : '概算';
    const note = machine.rushPayoutModel?.note || 'RUSH継続率と特図2振り分けから算出。';
    return `<section class="detail-section"><h3>RUSH出球分布 <small>${quality}</small></h3><p class="distribution-note">${escapeHtml(note)} 12,000個以降は「12,000個以上」に集約しています。</p><div class="payout-distribution-table">${distribution.map(item => `<div><span>${formatDistributionPayout(item)}</span><strong>${item.probability.toFixed(1)}%</strong></div>`).join('')}</div></section>`;
  }

  function formatRating(value) {
    return value === null || value === undefined ? '—' : Number(value).toFixed(1);
  }

  function formatDate(value) {
    if (!value) return '導入日未設定';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ja-JP');
  }

  // Empty weights preserve the original equal-weight average. Zero opts out.
  function normalizeRatingWeight(value) {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const weight = Number(value);
    return Number.isFinite(weight) && weight >= 0 ? weight : null;
  }

  function weightedRating(entries) {
    const scored = entries.map(({ value, weight }) => ({ value, weight: normalizeRatingWeight(weight) ?? 1 }))
      .filter(item => Number.isFinite(item.value) && item.weight > 0);
    if (!scored.length) return null;
    // Scaling avoids overflow for large but valid imported weights.
    const scale = scored.reduce((max, item) => Math.max(max, item.weight), 0);
    const totalWeight = scored.reduce((sum, item) => sum + item.weight / scale, 0);
    return scored.reduce((sum, item) => sum + item.value * (item.weight / scale), 0) / totalWeight;
  }

  function overallRatingFromRatings(criteria, ratings) {
    return weightedRating(criteria.map(criterion => ({
      value: criterionRatingFromRatings(criterion, ratings), weight: criterion.weight
    })));
  }

  function ratingValue(machine, criterionId) {
    if (criterionId === OVERALL_RATING_ID) return averageRating(machine);
    const main = effectiveCriteria().find(criterion => criterion.id === criterionId);
    return main ? criterionRatingFromRatings(main, machineRatings(machine)) : directRatingFromObject(machineRatings(machine), criterionId);
  }

  function averageRating(machine) {
    return overallRatingFromRatings(effectiveCriteria(), machineRatings(machine));
  }

  function ratingCriteriaWithOverall() {
    return [{ id: OVERALL_RATING_ID, name: '総合評価' }, ...visibleCriteria()];
  }

  function starsTemplate(value) {
    const score = Math.round((Number(value) || 0) * 2) / 2;
    return `<span class="stars-static" aria-label="5点満点中${value ?? 0}点">${[1,2,3,4,5].map(star => `<span class="${score >= star ? 'full-star' : score >= star - 0.5 ? 'half-star' : 'empty-star'}">★</span>`).join('')}</span>`;
  }

  function searchableText(machine) {
    const parts = [machine.name, ...machine.tags];
    return parts.join(' ').toLocaleLowerCase('ja');
  }

  function renderSortFields() {
    const fixed = [ ['date', '導入日'], ['name', '機種名'], ['rush', '実質RUSH突入率'], ['payout', '初当り出球期待値'] ];
    const ratings = ratingCriteriaWithOverall().map(item => [`rating:${item.id}`, item.name]);
    const options = [...fixed, ...ratings];
    if (!options.some(([value]) => value === state.filters.sortField)) state.filters.sortField = 'date';
    const option = ([value, name]) => `<option value="${escapeHtml(value)}">${escapeHtml(name)}</option>`;
    $('#sortFieldSelect').innerHTML = fixed.map(option).join('') + `<optgroup label="評価">${ratings.map(option).join('')}</optgroup>`;
    $('#sortFieldSelect').value = state.filters.sortField;
  }

  function matchingMachines() {
    const query = state.filters.search.trim().toLocaleLowerCase('ja');
    const machines = state.data.machines.filter(machine => {
      if (query && !searchableText(machine).includes(query)) return false;
      if (state.filters.tags.length && !state.filters.tags.some(tag => machine.tags.includes(tag))) return false;
      const filter = state.filters.rating;
      const value = ratingValue(machine, filter.criterion);
      if (filter.status === 'rated' && value === null) return false;
      if (filter.status === 'unrated' && value !== null) return false;
      if (filter.min !== null && (value === null || value < filter.min)) return false;
      if (filter.max !== null && (value === null || value > filter.max)) return false;
      return true;
    });
    return machines;
  }

  function filteredMachines() {
    const machines = matchingMachines();
    const direction = state.filters.sortDirection === 'asc' ? 1 : -1;
    return machines.sort((a, b) => {
      if (state.filters.sortField.startsWith('rating:')) {
        const id = state.filters.sortField.slice('rating:'.length);
        const aValue = ratingValue(a, id);
        const bValue = ratingValue(b, id);
        if (aValue === null || bValue === null) return aValue === bValue ? a.name.localeCompare(b.name, 'ja') : aValue === null ? 1 : -1;
        return (aValue - bValue) * direction || a.name.localeCompare(b.name, 'ja');
      }
      let comparison = 0;
      switch (state.filters.sortField) {
        case 'name': comparison = a.name.localeCompare(b.name, 'ja'); break;
        case 'rush': {
          const aValue = effectiveRush(a);
          const bValue = effectiveRush(b);
          if (aValue === null || bValue === null) return aValue === bValue ? 0 : aValue === null ? 1 : -1;
          comparison = aValue - bValue;
          break;
        }
        case 'payout': {
          const aValue = initialPayoutExpectation(a).value;
          const bValue = initialPayoutExpectation(b).value;
          if (aValue === null || bValue === null) return aValue === bValue ? 0 : aValue === null ? 1 : -1;
          comparison = aValue - bValue;
          break;
        }
        default: comparison = (a.introductionDate || '').localeCompare(b.introductionDate || '');
      }
      return comparison * direction;
    });
  }

  function render() {
    validateRatingFilter();
    renderSortFields();
    const machines = filteredMachines();
    el.count.textContent = state.data.machines.length.toLocaleString('ja-JP');
    el.result.textContent = `${machines.length}件を表示`;
    el.grid.innerHTML = machines.map(machineCardTemplate).join('');

    const hasMachines = state.data.machines.length > 0;
    el.grid.hidden = machines.length === 0;
    el.empty.hidden = machines.length > 0;
    if (!machines.length) {
      el.emptyTitle.textContent = hasMachines ? '条件に合う機種がありません' : '機種がまだ登録されていません';
      el.emptyText.textContent = hasMachines ? '検索語や絞り込み条件を変えてみてください。' : '最初の機種を追加して、スペックライブラリを作り始めましょう。';
      $('#emptyActionButton').hidden = hasMachines;
      if (!hasMachines) $('#emptyActionButton').textContent = '機種を追加';
    }
    renderRanking();
    rememberView();
  }

  function machineCardTemplate(machine) {
    const rush = effectiveRush(machine);
    return `
      <article class="machine-card" data-machine-id="${escapeHtml(machine.id)}" role="button" tabindex="0" aria-label="${escapeHtml(machine.name)}の詳細を表示">
        <div class="card-accent"></div>
        <div class="card-body">
          <h2 title="${escapeHtml(machine.name)}">${escapeHtml(machine.name)}</h2>
          <div class="metric-pair">
            <div class="metric-box"><span class="metric-label">初当り確率</span><strong class="metric-value">${formatProbability(machine.basic.initialProbability)}</strong></div>
            <div class="metric-box highlight" title="${escapeHtml(initialPayoutExpectation(machine).note)}"><span class="metric-label">初当り出球期待値</span><strong class="metric-value">${formatPayoutExpectation(initialPayoutExpectation(machine))}</strong></div>
            <div class="metric-box"><span class="metric-label">RUSH突入率</span><strong class="metric-value">${machine.basic.rushEntryRate != null ? `${escapeHtml(machine.basic.rushEntryRate)}%` : '—'}</strong></div>
            <div class="metric-box highlight"><span class="metric-label">実質RUSH突入率</span><strong class="metric-value">${formatProbability(rush)}</strong></div>
          </div>
          ${payoutSummaryTemplate(machine)}
          ${cardRatingTemplate(machine)}
          <div class="card-footer">
            <time datetime="${escapeHtml(machine.introductionDate)}">${formatDate(machine.introductionDate)}</time>
            <span class="card-tags-inline" title="${escapeHtml(machine.tags.join(' / '))}">${escapeHtml(machine.tags.join(' / ') || 'タグなし')}</span>
          </div>
        </div>
      </article>`;
  }

  function cardRatingTemplate(machine) {
    const criteria = visibleCriteria();
    const average = averageRating(machine);
    const visible = criteria.slice(0, 6);
    const remaining = criteria.length - visible.length;
    return `<div class="card-evaluation" role="button" tabindex="0" aria-label="${escapeHtml(machine.name)}の評価を編集">
      <div class="card-evaluation-head"><span>総合評価 <small>重みを反映</small></span><div class="card-overall-score">${starsTemplate(average)}${average !== null ? `<strong>${average.toFixed(1)}</strong>` : '<strong class="unrated">未評価</strong>'}</div></div>
      ${visible.length ? `<div class="card-rating-grid">
        ${visible.map(criterion => {
          const value = ratingValue(machine, criterion.id);
          return `<div class="card-rating-item"><span title="${escapeHtml(criterion.name)}">${escapeHtml(criterion.name)}</span><span class="card-stars ${value === null ? 'unrated' : ''}">${starsTemplate(value)}</span></div>`;
        }).join('')}
      </div>` : '<span class="rating-more">評価項目がありません</span>'}
      ${remaining > 0 ? `<span class="rating-more">ほか${remaining}項目は詳細で表示</span>` : ''}
    </div>`;
  }

  function renderRanking() {
    const criteria = ratingCriteriaWithOverall();
    const tabs = $('#rankingCriterionTabs');
    const list = $('#rankingList');
    if (!criteria.length) {
      state.rankingCriterionId = null;
      tabs.innerHTML = '';
      list.innerHTML = '<div class="ranking-empty"><strong>評価項目がありません</strong>ヘッダーの「評価」の管理タブから最初の項目を追加してください。</div>';
      return;
    }

    if (!criteria.some(item => item.id === state.rankingCriterionId)) {
      state.rankingCriterionId = criteria[0].id;
    }
    tabs.innerHTML = criteria.map(item => `
      <button class="criterion-tab ${item.id === state.rankingCriterionId ? 'active' : ''}" type="button" role="tab" aria-selected="${item.id === state.rankingCriterionId}" data-criterion-id="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button>
    `).join('');

    const ranked = matchingMachines()
      .map(machine => ({ machine, score: ratingValue(machine, state.rankingCriterionId) }))
      .filter(item => item.score !== null)
      .sort((a, b) => b.score - a.score || a.machine.name.localeCompare(b.machine.name, 'ja'));

    if (!ranked.length) {
      const criterion = criteria.find(item => item.id === state.rankingCriterionId);
      list.innerHTML = `<div class="ranking-empty"><strong>「${escapeHtml(criterion.name)}」で条件に合う評価がありません</strong>検索・評価の絞り込み条件や、機種の評価を確認してください。</div>`;
      return;
    }

    let previousScore = null;
    let currentRank = 0;
    list.innerHTML = ranked.map((item, index) => {
      if (item.score !== previousScore) currentRank = index + 1;
      previousScore = item.score;
      return `<article class="ranking-row" data-rank="${currentRank}">
        <div class="rank-number">${currentRank}</div>
        <div class="rank-machine"><strong>${escapeHtml(item.machine.name)}</strong><span>${escapeHtml(item.machine.manufacturer || 'メーカー未設定')}</span></div>
        ${starsTemplate(item.score)}
        <div class="rank-score">${item.score.toFixed(1)}</div>
      </article>`;
    }).join('');
  }

  function openTieComparison(machineId) {
    const criterionId = state.rankingCriterionId;
    const selected = state.data.machines.find(machine => machine.id === machineId);
    if (!selected) return;
    const score = ratingValue(selected, criterionId);
    if (score === null) return;
    const machines = state.data.machines.filter(machine => ratingValue(machine, criterionId) === score)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    if (machines.length < 2) return;
    state.comparison = { criterionId, machines, left: machines[0].id, right: machines[1].id };
    const criterion = ratingCriteriaWithOverall().find(item => item.id === criterionId);
    $('#comparisonTitle').textContent = `${criterion?.name || '評価'}の同率比較`;
    $('#comparisonSummary').textContent = `${machines.length}機種 · ${formatRating(score)}点（丸め前の評価値が同じ機種）`;
    const options = machines.map(machine => `<option value="${escapeHtml(machine.id)}">${escapeHtml(machine.name)}</option>`).join('');
    $('#compareLeft').innerHTML = options;
    $('#compareRight').innerHTML = options;
    $('#compareLeft').value = state.comparison.left;
    $('#compareRight').value = state.comparison.right;
    $('#compareDifferencesOnly').checked = false;
    renderComparison();
    $('#comparisonDialog').showModal();
  }

  function renderComparison() {
    const comparison = state.comparison;
    if (!comparison) return;
    const left = comparison.machines.find(machine => machine.id === comparison.left);
    const right = comparison.machines.find(machine => machine.id === comparison.right);
    const rows = [];
    const addRating = (name, id, sub = false) => {
      const values = [ratingValue(left, id), ratingValue(right, id)];
      rows.push({ name, values, text: values.map(formatRating), sub, rating: true });
    };
    addRating('総合評価', OVERALL_RATING_ID);
    visibleCriteria().forEach(criterion => {
      addRating(criterion.name, criterion.id);
      criterion.children.filter(child => child.weight !== 0).forEach(child => addRating(child.name, child.id, true));
    });
    const addSpec = (name, values, text) => rows.push({ name, values, text });
    const machines = [left, right];
    addSpec('初当り確率', machines.map(m => m.basic.initialProbability), machines.map(m => formatProbability(m.basic.initialProbability)));
    const payouts = machines.map(initialPayoutExpectation);
    addSpec('初当り出球期待値', payouts.map(p => `${p.kind}:${p.value}`), payouts.map(formatPayoutExpectation));
    addSpec('RUSH突入率', machines.map(m => m.basic.rushEntryRate), machines.map(m => m.basic.rushEntryRate == null ? '—' : `${m.basic.rushEntryRate}%`));
    addSpec('実質RUSH突入率', machines.map(effectiveRush), machines.map(m => formatProbability(effectiveRush(m))));
    addSpec('RUSH継続率', machines.map(m => m.basic.rushContinuationRate), machines.map(m => m.basic.rushContinuationRate == null ? '—' : `${m.basic.rushContinuationRate}%`));
    const visible = rows.filter(row => !$('#compareDifferencesOnly').checked || row.values[0] !== row.values[1]);
    $('#comparisonTable').innerHTML = `<thead><tr><th scope="col">項目</th><th scope="col">${escapeHtml(left.name)}</th><th scope="col">${escapeHtml(right.name)}</th></tr></thead><tbody>${visible.map(row => {
      const different = row.values[0] !== row.values[1];
      return `<tr class="${different ? 'comparison-different' : ''} ${row.sub ? 'comparison-sub' : ''}"><th scope="row">${escapeHtml(row.name)}</th>${row.text.map((value, i) => {
        const higher = row.rating && row.values[i] !== null && row.values[1-i] !== null && row.values[i] > row.values[1-i];
        return `<td${higher ? ' class="comparison-higher"' : ''}>${escapeHtml(value)}</td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody>`;
    $('#comparisonEmpty').hidden = visible.length > 0;
  }

  function switchView(view) {
    state.view = view === 'ranking' ? 'ranking' : 'library';
    $('#libraryView').hidden = state.view !== 'library';
    $('#rankingView').hidden = state.view !== 'ranking';
    $$('.view-tab').forEach(button => {
      const active = button.dataset.view === state.view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (state.view === 'ranking') renderRanking();
    rememberView();
  }

  function openDetail(id) {
    const machine = state.data.machines.find(item => item.id === id);
    if (!machine) return;
    const rush = effectiveRush(machine);
    el.detailContent.innerHTML = `
      <div class="detail-head">
        <div class="detail-actions"><button class="small-button" type="button" data-detail-action="edit" data-machine-id="${escapeHtml(machine.id)}">編集</button></div>
        <h2>${escapeHtml(machine.name)}</h2>
        <p>${formatDate(machine.introductionDate)}${machine.series ? ` ／ ${escapeHtml(machine.series)}` : ''}</p>
        <div class="tag-row detail-tags">${machine.tags.map(cardTagTemplate).join('')}</div>
      </div>
      ${ratingDetailTemplate(machine)}
      <div class="detail-metrics">
        ${detailMetric('初当り', formatProbability(machine.basic.initialProbability))}
        ${detailMetric('RUSH突入率', machine.basic.rushEntryRate != null ? `${machine.basic.rushEntryRate}%` : '—')}
        ${detailMetric('実質RUSH突入', formatProbability(rush), true)}
        ${detailMetric('初当り出球期待値', formatPayoutExpectation(initialPayoutExpectation(machine)), true, initialPayoutExpectation(machine).note)}
        ${detailMetric('RUSH中当り', formatProbability(machine.basic.rushHitProbability))}
        ${detailMetric('RUSH継続率', machine.basic.rushContinuationRate != null ? `${machine.basic.rushContinuationRate}%` : '—')}
      </div>
      ${payoutDistributionDetailTemplate(machine)}
      ${machine.flows.length ? `<section class="detail-section"><h3>状態遷移</h3><div class="flow">${machine.flows.map(item => `<div class="flow-step"><strong>${escapeHtml(item.from)}</strong><span class="flow-arrow">→</span><strong>${escapeHtml(item.to)}</strong>${item.rate ? `<span class="flow-rate">${escapeHtml(item.rate)}</span>` : ''}</div>`).join('')}</div></section>` : ''}
      ${(machine.distributions.special1.length || machine.distributions.special2.length) ? `<section class="detail-section"><h3>大当り振り分け</h3><div class="distribution-grid">${distributionTemplate('特図1', machine.distributions.special1)}${distributionTemplate('特図2', machine.distributions.special2)}</div></section>` : ''}
      ${machine.customSpecs.length ? `<section class="detail-section"><h3>その他のスペック</h3><div class="spec-list">${machine.customSpecs.map(item => `<div class="spec-item"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</div></section>` : ''}
      ${machine.notes ? `<section class="detail-section"><h3>メモ</h3><div class="detail-note">${escapeHtml(machine.notes)}</div></section>` : ''}
    `;
    el.detailDialog.showModal();
  }

  function detailMetric(label, value, emphasis = false, note = '') {
    return `<div class="detail-metric ${emphasis ? 'emphasis' : ''}"><span>${label}</span><strong>${value}</strong>${note ? `<small class="detail-metric-note">注記：${escapeHtml(note)}</small>` : ''}</div>`;
  }

  function distributionTemplate(title, rows) {
    return `<div class="distribution"><h4>${title}</h4>${rows.length ? rows.map(item => `<div class="distribution-row"><span>${escapeHtml(item.label)}</span><span>${escapeHtml(item.rate)}</span><span>${escapeHtml(item.payout)}</span></div>`).join('') : '<div class="distribution-row"><span>未登録</span></div>'}</div>`;
  }

  function ratingDetailTemplate(machine) {
    const overall = averageRating(machine);
    const rows = visibleCriteria().map(criterion => ({ criterion, value: ratingValue(machine, criterion.id) }));
    return `<section class="detail-section detail-section-first"><h3>10段階評価</h3>
      <div class="detail-overall-rating"><span>総合評価</span>${starsTemplate(overall)}<strong class="${overall === null ? 'unrated' : ''}">${formatRating(overall)}</strong></div>
      ${rows.length ? `<div class="detail-ratings">${rows.map(item => `<div class="detail-rating"><span>${escapeHtml(item.criterion.name)}</span>${starsTemplate(item.value)}<strong class="${item.value === null ? 'unrated' : ''}">${formatRating(item.value)}</strong></div>`).join('')}</div>` : ''}
      ${state.memos[machine.id] ? `<div class="personal-rating-note"><h4>評価メモ（自分用）</h4><div class="detail-note">${escapeHtml(state.memos[machine.id])}</div></div>` : ''}
    </section>`;
  }

  function openEditor(id = null) {
    const machine = id ? state.data.machines.find(item => item.id === id) : null;
    $('#editorTitle').textContent = machine ? '機種を編集' : '機種を追加';
    $('#deleteButton').hidden = !machine;
    $('#machineId').value = machine?.id || '';
    $('#nameInput').value = machine?.name || '';
    $('#introductionDateInput').value = machine?.introductionDate || '';
    $('#seriesInput').value = machine?.series || '';
    state.editorTags = [...(machine?.tags || [])];
    renderEditorTags();
    $('#initialProbabilityInput').value = machine?.basic.initialProbability ?? '';
    $('#rushEntryRateInput').value = machine?.basic.rushEntryRate ?? '';
    $('#rushContinuationRateInput').value = machine?.basic.rushContinuationRate ?? '';
    $('#rushHitProbabilityInput').value = machine?.basic.rushHitProbability ?? '';
    $('#rushHitTypeInput').value = machine?.basic.rushHitType || '実質当り確率';
    $('#rushHitNoteInput').value = machine?.basic.rushHitNote || '';
    $('#initialPayoutKindInput').value = machine?.initialPayoutExpectation?.kind || 'auto';
    $('#initialPayoutValueInput').value = machine?.initialPayoutExpectation?.value ?? '';
    $('#initialPayoutNoteInput').value = machine?.initialPayoutExpectation?.note || '';
    $('#notesInput').value = machine?.notes || '';
    $('#ratingMemoInput').value = state.memos[machine?.id] || '';
    renderRepeater('special1', machine?.distributions.special1 || []);
    renderRepeater('special2', machine?.distributions.special2 || []);
    renderRepeater('flows', machine?.flows || []);
    renderRepeater('customSpecs', machine?.customSpecs || []);
    renderRatingFields(machineRatings(machine));
    updateRushPreview();
    updateInitialPayoutPreview();
    el.editorDialog.showModal();
  }

  function openRatingEditor(id) {
    const machine = state.data.machines.find(item => item.id === id);
    if (!machine) return;
    $('#ratingMachineId').value = machine.id;
    $('#quickRatingMemoInput').value = state.memos[machine.id] || '';
    $('#ratingMachineName').textContent = machine.name;
    renderRatingFields(machineRatings(machine), $('#quickRatingFields'));
    el.ratingDialog.showModal();
  }

  function renderRepeater(type, rows) {
    const container = repeaterContainer(type);
    container.innerHTML = '';
    rows.forEach(row => addRepeaterRow(type, row));
  }

  function repeaterContainer(type) {
    return $({ special1: '#special1Rows', special2: '#special2Rows', flows: '#flowRows', customSpecs: '#customSpecRows' }[type]);
  }

  function addRepeaterRow(type, values = {}) {
    const container = repeaterContainer(type);
    const row = document.createElement('div');
    if (type === 'flows') {
      row.className = 'repeater-row flow-row';
      row.innerHTML = `<input data-key="from" aria-label="遷移元" placeholder="通常時" value="${escapeHtml(values.from || '')}"><span class="row-arrow">→</span><input data-key="to" aria-label="遷移先" placeholder="RUSH" value="${escapeHtml(values.to || '')}"><input data-key="rate" aria-label="遷移率" placeholder="50%" value="${escapeHtml(values.rate || '')}"><button class="remove-row" type="button" aria-label="行を削除">×</button>`;
    } else if (type === 'customSpecs') {
      row.className = 'repeater-row custom-row';
      row.innerHTML = `<input data-key="label" aria-label="項目名" placeholder="項目名" value="${escapeHtml(values.label || '')}"><input data-key="value" aria-label="内容" placeholder="内容" value="${escapeHtml(values.value || '')}"><button class="remove-row" type="button" aria-label="行を削除">×</button>`;
    } else {
      row.className = 'repeater-row';
      row.innerHTML = `<input data-key="label" aria-label="振り分け内容" placeholder="10R＋RUSH" value="${escapeHtml(values.label || '')}"><input data-key="rate" aria-label="割合" placeholder="50%" value="${escapeHtml(values.rate || '')}"><input data-key="payout" aria-label="出球" placeholder="1,500個" value="${escapeHtml(values.payout || '')}"><button class="remove-row" type="button" aria-label="行を削除">×</button>`;
    }
    container.append(row);
  }

  function readRows(type) {
    return $$('.repeater-row', repeaterContainer(type)).map(row => {
      const item = {};
      $$('[data-key]', row).forEach(input => item[input.dataset.key] = input.value.trim());
      return item;
    }).filter(item => Object.values(item).some(Boolean));
  }

  function renderRatingFields(ratings = {}, container = $('#ratingFields')) {
    const criteria = effectiveCriteria();
    const overall = overallRatingFromRatings(criteria, ratings);
    const overallField = `<div class="rating-field rating-field-overall">
      <span>総合評価 <small>各項目の重みを反映して自動計算</small></span>
      <div class="calculated-rating" data-calculated-rating>${starsTemplate(overall)}<strong class="${overall === null ? 'unrated' : ''}">${overall === null ? '—' : overall.toFixed(1)}</strong></div>
    </div>`;
    if (!criteria.length) {
      container.innerHTML = `${overallField}<p class="ratings-empty">評価項目がありません。ヘッダーの「評価項目」から追加できます。</p>`;
      return;
    }
    container.innerHTML = overallField + criteria.filter(criterion => criterion.weight !== 0).map(criterion => {
      const children = criterion.children || [];
      if (!children.length) {
        return `<div class="rating-main-group" data-main-rating="${escapeHtml(criterion.id)}"><div class="rating-field" data-rating-id="${escapeHtml(criterion.id)}" data-value="${directRatingFromObject(ratings, criterion.id) ?? 0}">
          <span>${escapeHtml(criterion.name)}</span>${interactiveStarsTemplate(directRatingFromObject(ratings, criterion.id), criterion.name)}
        </div></div>`;
      }
      const mainValue = criterionRatingFromRatings(criterion, ratings);
      return `<section class="rating-main-group rating-main-with-children" data-main-rating="${escapeHtml(criterion.id)}">
        <div class="rating-parent-calculated"><span>${escapeHtml(criterion.name)} <small>サブ項目の重みを反映</small></span><div data-main-calculated>${starsTemplate(mainValue)}<strong class="${mainValue === null ? 'unrated' : ''}">${mainValue === null ? '—' : mainValue.toFixed(1)}</strong></div></div>
        <div class="rating-subfields">${children.filter(child => child.weight !== 0).map(child => `<div class="rating-field" data-rating-id="${escapeHtml(child.id)}" data-value="${directRatingFromObject(ratings, child.id) ?? 0}"><span>${escapeHtml(child.name)}</span>${interactiveStarsTemplate(directRatingFromObject(ratings, child.id), child.name)}</div>`).join('')}</div>
      </section>`;
    }).join('');
  }

  function directRatingFromObject(ratings, id) {
    const value = Number(ratings?.[id]);
    return value >= 0.5 && value <= 5 && Number.isInteger(value * 2) ? value : null;
  }

  function criterionRatingFromRatings(criterion, ratings) {
    const children = criterion.children || [];
    if (!children.length) return directRatingFromObject(ratings, criterion.id);
    return weightedRating(children.map(child => ({
      value: directRatingFromObject(ratings, child.id), weight: child.weight
    })));
  }

  function interactiveStarsTemplate(value, label) {
    const current = Number(value) || 0;
    return `<div class="star-input" role="group" aria-label="${escapeHtml(label)}の評価">${[1,2,3,4,5].map(star => `<span class="star-choice"><span class="star-visual ${current >= star ? 'full-star' : current >= star - 0.5 ? 'half-star' : 'empty-star'}">★</span><button type="button" data-score="${star - 0.5}" aria-label="${star - 0.5}点" aria-pressed="${current === star - 0.5}"></button><button type="button" data-score="${star}" aria-label="${star}点" aria-pressed="${current === star}"></button></span>`).join('')}</div>`;
  }

  function readRatings(container = $('#ratingFields')) {
    return Object.fromEntries($$('[data-rating-id]', container)
      .map(field => [field.dataset.ratingId, Number(field.dataset.value)])
      .filter(([, value]) => value >= 0.5 && value <= 5 && Number.isInteger(value * 2)));
  }

  function readMachineFromForm() {
    const existingId = $('#machineId').value;
    const existing = state.data.machines.find(item => item.id === existingId);
    const now = new Date().toISOString();
    const special1 = readRows('special1');
    const special2 = readRows('special2');
    const expectation = {
      kind: $('#initialPayoutKindInput').value,
      value: $('#initialPayoutValueInput').value,
      note: $('#initialPayoutNoteInput').value.trim()
    };
    return normalizeMachine({
      id: existingId || crypto.randomUUID(),
      name: $('#nameInput').value.trim(),
      manufacturer: tagValue(state.editorTags, 'メーカー'),
      type: /^e/i.test(tagValue(state.editorTags, 'P/e')) ? 'e' : 'P',
      introductionDate: $('#introductionDateInput').value,
      series: $('#seriesInput').value.trim(),
      tags: [...state.editorTags],
      lt: state.editorTags.some(tag => splitTag(tag).item.toLocaleUpperCase('ja') === 'LT'),
      basic: {
        initialProbability: $('#initialProbabilityInput').value,
        rushEntryRate: $('#rushEntryRateInput').value,
        rushContinuationRate: $('#rushContinuationRateInput').value,
        initialPayout: null,
        rushHitProbability: $('#rushHitProbabilityInput').value,
        rushHitType: $('#rushHitTypeInput').value,
        rushHitNote: $('#rushHitNoteInput').value.trim()
      },
      distributions: { special1, special2 },
      flows: readRows('flows'),
      customSpecs: readRows('customSpecs'),
      rushPayoutModel: existing?.rushPayoutModel || null,
      initialPayoutExpectation: expectation,
      notes: $('#notesInput').value.trim(),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
  }

  function updateRushPreview() {
    const machine = { basic: { initialProbability: $('#initialProbabilityInput').value, rushEntryRate: $('#rushEntryRateInput').value } };
    $('#rushProbabilityPreview').textContent = formatProbability(effectiveRush(machine));
  }

  function updateInitialPayoutPreview() {
    const machine = {
      basic: { initialPayout: null },
      distributions: { special1: readRows('special1') },
      initialPayoutExpectation: {
        kind: $('#initialPayoutKindInput').value,
        value: $('#initialPayoutValueInput').value,
        note: $('#initialPayoutNoteInput').value.trim()
      }
    };
    $('#initialPayoutExpectationPreview').textContent = formatPayoutExpectation(initialPayoutExpectation(machine));
  }

  function syncMachineTagMetadata(machine) {
    machine.manufacturer = tagValue(machine.tags, 'メーカー');
    machine.type = /^e/i.test(tagValue(machine.tags, 'P/e')) ? 'e' : 'P';
    machine.lt = machine.tags.some(tag => splitTag(tag).item.toLocaleUpperCase('ja') === 'LT');
  }

  function renderEditorTags() {
    const container = $('#editorTagChips');
    container.innerHTML = state.editorTags.length
      ? state.editorTags.map(tagChipTemplate).join('')
      : '<span class="tag-empty">タグ未設定</span>';
  }

  function selectionGroupsTemplate(selectedTags) {
    const selected = new Set(selectedTags);
    const groups = groupedTags();
    if (!groups.length) return '<p class="ratings-empty">登録済みのタグがありません。タグ管理から追加してください。</p>';
    return groups.map(([category, tags]) => {
      const selectedCount = tags.filter(tag => selected.has(tag.raw)).length;
      return `<section class="tag-group" data-tag-group="${escapeHtml(category)}">
        <label class="tag-group-head"><input type="checkbox" data-tag-category="${escapeHtml(category)}" ${selectedCount === tags.length ? 'checked' : ''}>${escapeHtml(category)} <span>(${selectedCount}/${tags.length})</span></label>
        <div class="tag-options">${tags.map(tag => `<label class="tag-option"><input type="checkbox" data-tag-value="${escapeHtml(tag.raw)}" ${selected.has(tag.raw) ? 'checked' : ''}>${escapeHtml(tag.item)}</label>`).join('')}</div>
      </section>`;
    }).join('');
  }

  function applyIndeterminateGroups(container, selectedTags) {
    const selected = new Set(selectedTags);
    $$('[data-tag-category]', container).forEach(input => {
      const tags = groupedTags().find(([category]) => category === input.dataset.tagCategory)?.[1] || [];
      const count = tags.filter(tag => selected.has(tag.raw)).length;
      input.indeterminate = count > 0 && count < tags.length;
    });
  }

  function renderTagFilterGroups() {
    const container = $('#tagFilterGroups');
    container.innerHTML = selectionGroupsTemplate(state.filters.tags);
    applyIndeterminateGroups(container, state.filters.tags);
  }

  function renderMachineTagGroups() {
    const container = $('#machineTagGroups');
    container.innerHTML = selectionGroupsTemplate(state.machineTagDraft);
    applyIndeterminateGroups(container, state.machineTagDraft);
  }

  function renderTagManageGroups() {
    const container = $('#tagManageGroups');
    const groups = groupedTags();
    if (!groups.length) {
      container.innerHTML = '<p class="ratings-empty">タグがありません。上の入力欄から追加できます。</p>';
      return;
    }
    container.innerHTML = groups.map(([category, tags]) => `<section class="tag-manage-group"><h3>${escapeHtml(category)}</h3><div class="tag-manage-list">${tags.map(tag => `<div class="tag-edit-chip"><input maxlength="60" data-original-tag="${escapeHtml(tag.raw)}" data-tag-category="${escapeHtml(category)}" data-tag-grouped="${tag.grouped}" aria-label="タグ名" value="${escapeHtml(tag.item)}"><button type="button" data-delete-tag="${escapeHtml(tag.raw)}" aria-label="タグを削除">×</button></div>`).join('')}</div></section>`).join('');
  }

  function switchTagPane(pane) {
    state.tagPane = pane === 'manage' ? 'manage' : 'filter';
    $('#tagFilterPane').hidden = state.tagPane !== 'filter';
    $('#tagManagePane').hidden = state.tagPane !== 'manage';
    $$('[data-tag-pane]').forEach(button => button.classList.toggle('active', button.dataset.tagPane === state.tagPane));
    if (state.tagPane === 'filter') renderTagFilterGroups();
    else renderTagManageGroups();
  }

  function openTagDialog(pane = 'filter') {
    switchTagPane(pane);
    el.tagDialog.showModal();
  }

  function addTagFromInput() {
    const input = $('#newTagInput');
    const tag = input.value.trim();
    if (!tag) return;
    if (state.data.settings.tags.includes(tag)) {
      showToast('同じタグが登録されています');
      return;
    }
    state.data.settings.tags.push(tag);
    input.value = '';
    saveData('タグを追加しました');
    renderTagManageGroups();
    input.focus();
  }

  function renameTag(oldTag, newTag) {
    const next = newTag.trim();
    if (!next || oldTag === next) return;
    state.data.settings.tags = [...new Set(state.data.settings.tags.map(tag => tag === oldTag ? next : tag))];
    state.data.machines.forEach(machine => {
      machine.tags = [...new Set(machine.tags.map(tag => tag === oldTag ? next : tag))];
      syncMachineTagMetadata(machine);
    });
    state.filters.tags = [...new Set(state.filters.tags.map(tag => tag === oldTag ? next : tag))];
    state.editorTags = [...new Set(state.editorTags.map(tag => tag === oldTag ? next : tag))];
    state.machineTagDraft = [...new Set(state.machineTagDraft.map(tag => tag === oldTag ? next : tag))];
    saveData('タグ名を更新しました');
    render();
    renderTagManageGroups();
  }

  function deleteTag(tag) {
    if (!confirm(`「${tag}」を削除しますか？\n機種への割り当ても解除されます。`)) return;
    state.data.settings.tags = state.data.settings.tags.filter(item => item !== tag);
    state.data.machines.forEach(machine => {
      machine.tags = machine.tags.filter(item => item !== tag);
      syncMachineTagMetadata(machine);
    });
    state.filters.tags = state.filters.tags.filter(item => item !== tag);
    state.editorTags = state.editorTags.filter(item => item !== tag);
    state.machineTagDraft = state.machineTagDraft.filter(item => item !== tag);
    saveData('タグを削除しました');
    render();
    renderTagManageGroups();
  }

  function openMachineTagEditor(target) {
    state.machineTagTarget = target;
    if (target === 'editor') {
      state.machineTagDraft = [...state.editorTags];
      $('#machineTagTitle').textContent = $('#nameInput').value.trim() || '編集中の機種';
    } else {
      const machine = state.data.machines.find(item => item.id === target);
      if (!machine) return;
      state.machineTagDraft = [...machine.tags];
      $('#machineTagTitle').textContent = machine.name;
    }
    renderMachineTagGroups();
    el.machineTagDialog.showModal();
  }

  function commitMachineTags() {
    if (state.machineTagTarget === 'editor') {
      state.editorTags = [...state.machineTagDraft];
      renderEditorTags();
    } else {
      const machine = state.data.machines.find(item => item.id === state.machineTagTarget);
      if (machine) {
        machine.tags = [...state.machineTagDraft];
        syncMachineTagMetadata(machine);
        machine.updatedAt = new Date().toISOString();
        saveData('タグを更新しました');
        render();
      }
    }
    closeDialog(el.machineTagDialog);
  }

  function updateTagSelection(event, target) {
    const categoryInput = event.target.closest('[data-tag-category]');
    const tagInput = event.target.closest('[data-tag-value]');
    if (!categoryInput && !tagInput) return;
    const current = new Set(target === 'filter' ? state.filters.tags : state.machineTagDraft);
    if (categoryInput) {
      const group = groupedTags().find(([category]) => category === categoryInput.dataset.tagCategory)?.[1] || [];
      group.forEach(tag => categoryInput.checked ? current.add(tag.raw) : current.delete(tag.raw));
    } else {
      if (tagInput.checked) current.add(tagInput.dataset.tagValue);
      else current.delete(tagInput.dataset.tagValue);
    }
    if (target === 'filter') {
      state.filters.tags = [...current];
      render();
      renderTagFilterGroups();
    } else {
      state.machineTagDraft = [...current];
      renderMachineTagGroups();
    }
  }

  function openCriteriaEditor() {
    const container = $('#criteriaRows');
    container.innerHTML = '';
    effectiveCriteria().forEach(criterion => addCriterionChip(criterion));
    $('#newCriterionInput').value = '';
    showRatingPane('manage');
    if (!el.criteriaDialog.open) el.criteriaDialog.showModal();
  }

  function handleStarClick(event) {
    const star = event.target.closest('[data-score]');
    if (!star) return;
    const field = star.closest('[data-rating-id]');
    const selected = Number(star.dataset.score);
    const next = Number(field.dataset.value) === selected ? 0 : selected;
    field.dataset.value = String(next);
    $$('[data-score]', field).forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.score) === next)));
    $$('.star-visual', field).forEach((visual, index) => {
      const star = index + 1;
      visual.className = `star-visual ${next >= star ? 'full-star' : next >= star - 0.5 ? 'half-star' : 'empty-star'}`;
    });
    updateOverallPreview(star.closest('.rating-fields'));
  }

  function updateOverallPreview(container) {
    if (!container) return;
    const ratings = readRatings(container);
    const criteria = effectiveCriteria();
    $$('[data-main-rating]', container).forEach(group => {
      const criterion = criteria.find(item => item.id === group.dataset.mainRating);
      const value = criterion ? criterionRatingFromRatings(criterion, ratings) : null;
      const mainTarget = $('[data-main-calculated]', group);
      if (mainTarget) mainTarget.innerHTML = `${starsTemplate(value)}<strong class="${value === null ? 'unrated' : ''}">${value === null ? '—' : value.toFixed(1)}</strong>`;
    });
    const overall = overallRatingFromRatings(criteria, ratings);
    const target = $('[data-calculated-rating]', container);
    if (target) target.innerHTML = `${starsTemplate(overall)}<strong class="${overall === null ? 'unrated' : ''}">${overall === null ? '—' : overall.toFixed(1)}</strong>`;
  }

  function ratingWeightInput(weight, isChild = false) {
    return `<label class="criterion-weight"><span>重み</span><input type="number" min="0" step="any" inputmode="decimal" data-${isChild ? 'subcriterion' : 'criterion'}-weight aria-label="${isChild ? 'サブ' : 'メイン'}項目の重み" placeholder="1" value="${normalizeRatingWeight(weight) ?? ''}" title="空欄は1、0は平均から除外"></label>`;
  }

  function addCriterionChip(criterion = {}) {
    const name = String(criterion.name || '').trim();
    if (!name) return;
    const chip = document.createElement('div');
    chip.className = 'criterion-chip';
    chip.dataset.criterionId = criterion.id || crypto.randomUUID();
    chip.innerHTML = `<div class="criterion-main-row"><input maxlength="30" data-criterion-name aria-label="メイン評価項目名" value="${escapeHtml(name)}">${ratingWeightInput(criterion.weight)}${reorderButtons()}<button class="remove-criterion" type="button" aria-label="メイン項目を削除">×</button></div><div class="subcriterion-list"></div>`;
    $('#criteriaRows').append(chip);
    (criterion.children || []).forEach(child => addSubcriterionChip(chip, child));
    updateReorderButtons();
  }

  function addSubcriterionChip(criterionChip, child = {}) {
    const row = document.createElement('div');
    row.className = 'subcriterion-chip';
    row.dataset.criterionId = child.id || crypto.randomUUID();
    row.innerHTML = `<span>↳</span><input maxlength="30" data-subcriterion-name aria-label="サブ評価項目名" value="${escapeHtml(child.name || '')}" placeholder="サブ項目名">${ratingWeightInput(child.weight, true)}${reorderButtons()}<button class="remove-subcriterion" type="button" aria-label="サブ項目を削除">×</button>`;
    $('.subcriterion-list', criterionChip).append(row);
    if (!child.name) $('[data-subcriterion-name]', row).focus();
    updateReorderButtons();
  }

  function addCriterionFromInput() {
    const input = $('#newCriterionInput');
    const raw = input.value.trim();
    if (!raw) return;
    const parsed = splitTag(raw);
    const name = parsed.grouped ? parsed.category : parsed.item;
    const existing = $$('[data-criterion-name]', $('#criteriaRows')).map(item => item.value.trim());
    const existingChip = $$('.criterion-chip', $('#criteriaRows')).find(chip => $('[data-criterion-name]', chip).value.trim() === name);
    if (!parsed.grouped && existing.includes(name)) {
      showToast('同じ名前の評価項目があります');
      return;
    }
    if (parsed.grouped) {
      const chip = existingChip || (() => { addCriterionChip({ name }); return $$('.criterion-chip', $('#criteriaRows')).at(-1); })();
      const childNames = $$('[data-subcriterion-name]', chip).map(item => item.value.trim());
      if (childNames.includes(parsed.item)) {
        showToast('同じサブ項目があります');
        return;
      }
      addSubcriterionChip(chip, { name: parsed.item });
    } else {
      addCriterionChip({ name });
    }
    input.value = '';
    input.focus();
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  function clearFilters() {
    state.filters = { search: '', tags: [], sortField: 'date', sortDirection: 'desc', rating: defaultRatingFilter() };
    $('#searchInput').value = '';
    $('#sortFieldSelect').value = 'date';
    updateSortDirectionButton();
    render();
  }

  function updateSortDirectionButton() {
    const button = $('#sortDirectionButton');
    const ascending = state.filters.sortDirection === 'asc';
    const label = ascending ? '昇順' : '降順';
    const next = ascending ? '降順' : '昇順';
    button.classList.toggle('descending', !ascending);
    button.setAttribute('aria-label', `並び順：${label}。${next}に切り替え`);
    button.title = `${label}（クリックで${next}）`;
  }

  function exportJson(kind = 'catalog') {
    const personal = kind === 'ratings';
    const data = personal ? ratingsDocument(state.ratings, state.weights, state.memos) : normalizeData(state.data);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pachispec-${personal ? 'my-ratings' : 'catalog'}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast(`${personal ? '自分の評価データ' : '機種・設定データ'}をエクスポートしました`);
  }

  async function importJson(file, kind = 'catalog') {
    try {
      const parsed = JSON.parse(await file.text());
      if (kind === 'ratings') {
        const imported = readPersonalData(parsed);
        const next = { ...state.ratings, ...imported };
        const weights = { ...state.weights, ...readPersonalWeights(parsed) };
        const memos = { ...state.memos, ...readPersonalMemos(parsed) };
        localStorage.setItem(RATINGS_STORAGE_KEY, JSON.stringify(ratingsDocument(next, weights, memos)));
        state.ratings = next;
        state.weights = weights;
        state.memos = memos;
        recordChange('評価データをインポート');
        const knownIds = new Set(state.data.machines.map(machine => machine.id));
        const pending = Object.keys(imported).filter(id => !knownIds.has(id)).length;
        showToast(`自分の評価データをインポートしました${pending ? `（未登録の${pending}機種分も保存）` : ''}`);
        render();
      } else {
        if (!parsed || !Array.isArray(parsed.machines) || (parsed.format && parsed.format !== 'pachispec-catalog')) throw new Error('機種・設定データのファイルを選んでください。');
        const next = normalizeData(parsed);
        if (state.migrationPending) { saveRatings(); state.migrationPending = false; }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        state.data = next;
        recordChange('機種・設定をインポート');
        syncSettingsToUrl();
        clearFilters();
        const hasLegacyScores = parsed.machines.some(machine => Object.keys(machine.ratings || {}).length);
        showToast(hasLegacyScores ? '機種・設定を読み込みました。旧ファイルの評価点は「自分の評価データ」から同じファイルをインポートできます。' : '機種・設定データをインポートしました');
      }
    } catch (error) {
      alert(`データをインポートできませんでした。\n${error.message}`);
    } finally {
      $(kind === 'ratings' ? '#ratingsImportInput' : '#importInput').value = '';
    }
  }

  const undoHistory = [];
  let committedSnapshot = null;
  function snapshot() {
    return JSON.stringify({ data: state.data, ratings: state.ratings, weights: state.weights, memos: state.memos });
  }
  function persistSnapshot(serialized) {
    const next = JSON.parse(serialized);
    const previousPersonal = localStorage.getItem(RATINGS_STORAGE_KEY);
    localStorage.setItem(RATINGS_STORAGE_KEY, JSON.stringify(ratingsDocument(next.ratings, next.weights, next.memos)));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next.data)); }
    catch (error) {
      if (previousPersonal === null) localStorage.removeItem(RATINGS_STORAGE_KEY);
      else localStorage.setItem(RATINGS_STORAGE_KEY, previousPersonal);
      throw error;
    }
  }
  function recordChange(label) {
    const next = snapshot();
    if (committedSnapshot !== null && next !== committedSnapshot) {
      undoHistory.push({ value: committedSnapshot, label });
      if (undoHistory.length > 20) undoHistory.shift();
    }
    if (committedSnapshot !== null) committedSnapshot = next;
    updateUndoButton();
  }
  function updateUndoButton() {
    const button = $('#undoButton');
    button.disabled = !undoHistory.length;
    button.title = undoHistory.length ? `${undoHistory.at(-1).label}を取り消す` : 'このページを開いている間の変更を20回まで戻せます';
  }
  function undoChange() {
    const previous = undoHistory.at(-1);
    if (!previous) return;
    try {
      persistSnapshot(previous.value);
      Object.assign(state, JSON.parse(previous.value));
      state.migrationPending = false;
      committedSnapshot = previous.value;
      undoHistory.pop();
      $$('dialog[open]').forEach(closeDialog);
      syncSettingsToUrl(); render(); updateUndoButton();
      showToast(`${previous.label}を取り消しました`);
    } catch (error) { alert(`元に戻せませんでした。\n${error.message}`); }
  }
  function defaultRatingFilter() { return { criterion: OVERALL_RATING_ID, status: 'all', min: null, max: null }; }
  function filterCriteria() {
    return [{ id: OVERALL_RATING_ID, name: '総合評価' }, ...visibleCriteria().flatMap(item => [item, ...item.children.filter(child => child.weight !== 0).map(child => ({ ...child, name: `${item.name}：${child.name}` }))])];
  }
  function validateRatingFilter() {
    if (!filterCriteria().some(item => item.id === state.filters.rating.criterion)) state.filters.rating = defaultRatingFilter();
    state.filters.tags = state.filters.tags.filter(tag => state.data.settings.tags.includes(tag));
    const f = state.filters.rating;
    const active = f.status !== 'all' || f.min !== null || f.max !== null;
    $('#ratingFilterButton').classList.toggle('active-filter', active);
    $('#ratingFilterButton').textContent = '評価';
    $('#ratingFilterButton').setAttribute('aria-label', active ? '評価の絞り込みと管理（絞り込み適用中）' : '評価の絞り込みと管理');
  }
  let switchingRatingPane = false;
  function showRatingPane(pane) {
    state.ratingPane = pane;
    $('#ratingFilterForm').hidden = pane !== 'filter';
    $('#criteriaForm').hidden = pane !== 'manage';
    $$('[data-rating-pane]').forEach(button => {
      const active = button.dataset.ratingPane === pane;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
  }
  function submitRatingPane() {
    const form = $(state.ratingPane === 'manage' ? '#criteriaForm' : '#ratingFilterForm');
    form.requestSubmit();
    return form.checkValidity();
  }
  $$('[data-rating-pane]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.ratingPane === state.ratingPane) return;
    switchingRatingPane = true;
    let valid;
    try { valid = submitRatingPane(); } finally { switchingRatingPane = false; }
    if (valid) button.dataset.ratingPane === 'manage' ? openCriteriaEditor() : openRatingFilter();
  }));
  $('[data-save-rating-tools]').addEventListener('click', submitRatingPane);

  function openRatingFilter() {
    validateRatingFilter();
    $('#ratingFilterCriterion').innerHTML = filterCriteria().map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    const f = state.filters.rating;
    $('#ratingFilterCriterion').value = f.criterion;
    $('#ratingFilterStatus').value = f.status;
    $('#ratingFilterMin').value = f.min ?? '';
    $('#ratingFilterMax').value = f.max ?? '';
    updateRangeInputs(); showRatingPane('filter');
    if (!el.criteriaDialog.open) el.criteriaDialog.showModal();
  }
  function updateRangeInputs() {
    const disabled = $('#ratingFilterStatus').value === 'unrated';
    $('#ratingFilterMin').disabled = disabled; $('#ratingFilterMax').disabled = disabled;
    $('#ratingFilterMax').setCustomValidity('');
  }
  const mobileHeaderQuery = window.matchMedia?.('(max-width: 760px)');
  function updateHeaderCollapse() {
    const collapsed = Boolean(mobileHeaderQuery?.matches && state.headerCollapsed);
    $('#headerTools').hidden = collapsed;
    const button = $('#headerToggleButton');
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? 'ヘッダーの操作を表示する' : 'ヘッダーの操作を折りたたむ');
    button.title = collapsed ? '操作を表示' : '操作を折りたたむ';
    if (collapsed) $('.data-menu').open = false;
  }
  $('#headerToggleButton').addEventListener('click', () => {
    state.headerCollapsed = !state.headerCollapsed;
    updateHeaderCollapse(); rememberView();
  });
  mobileHeaderQuery?.addEventListener('change', updateHeaderCollapse);

  function rememberView() {
    try { localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ filters: state.filters, view: state.view, rankingCriterionId: state.rankingCriterionId, headerCollapsed: state.headerCollapsed })); }
    catch (_) { /* Browsing remains usable when storage is full. */ }
  }
  function restoreView() {
    try {
      const saved = JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY));
      if (!saved || typeof saved !== 'object') return;
      state.headerCollapsed = saved.headerCollapsed === true;
      const f = saved.filters || {};
      if (typeof f.search === 'string') state.filters.search = f.search;
      if (Array.isArray(f.tags)) state.filters.tags = f.tags.filter(tag => typeof tag === 'string');
      if (typeof f.sortField === 'string') state.filters.sortField = f.sortField;
      state.filters.sortDirection = f.sortDirection === 'asc' ? 'asc' : 'desc';
      const rating = f.rating || {};
      state.filters.rating = {
        criterion: typeof rating.criterion === 'string' ? rating.criterion : OVERALL_RATING_ID,
        status: ['all', 'rated', 'unrated'].includes(rating.status) ? rating.status : 'all',
        min: typeof rating.min === 'number' && rating.min >= 0 && rating.min <= 5 ? rating.min : null,
        max: typeof rating.max === 'number' && rating.max >= 0 && rating.max <= 5 ? rating.max : null
      };
      if (state.filters.rating.status === 'unrated') state.filters.rating.min = state.filters.rating.max = null;
      if (state.filters.rating.min !== null && state.filters.rating.max !== null && state.filters.rating.min > state.filters.rating.max) state.filters.rating = defaultRatingFilter();
      state.view = saved.view === 'ranking' ? 'ranking' : 'library';
      state.rankingCriterionId = typeof saved.rankingCriterionId === 'string' ? saved.rankingCriterionId : null;
    } catch (_) { /* Ignore obsolete or damaged display settings. */ }
    $('#searchInput').value = state.filters.search;
    updateSortDirectionButton();
  }
  function reorderButtons() {
    return '<span class="criterion-reorder"><button type="button" data-move="up" aria-label="項目を上へ移動">↑</button><button type="button" data-move="down" aria-label="項目を下へ移動">↓</button></span>';
  }
  function updateReorderButtons() {
    $$('.criterion-chip, .subcriterion-chip', $('#criteriaRows')).forEach(row => {
      const controls = row.matches('.criterion-chip') ? $('.criterion-main-row', row) : row;
      $('[data-move="up"]', controls).disabled = !row.previousElementSibling;
      $('[data-move="down"]', controls).disabled = !row.nextElementSibling;
    });
  }
  $('#undoButton').addEventListener('click', () => { undoChange(); $('.data-menu').open = false; });
  $('#ratingFilterButton').addEventListener('click', openRatingFilter);
  $('#ratingFilterStatus').addEventListener('change', updateRangeInputs);
  ['#ratingFilterMin', '#ratingFilterMax'].forEach(id => $(id).addEventListener('input', () => $('#ratingFilterMax').setCustomValidity('')));
  $('#ratingFilterReset').addEventListener('click', () => { state.filters.rating = defaultRatingFilter(); closeDialog(el.criteriaDialog); render(); });
  $('#ratingFilterForm').addEventListener('submit', event => {
    event.preventDefault();
    const status = $('#ratingFilterStatus').value;
    const min = status === 'unrated' ? null : numberOrNull($('#ratingFilterMin').value);
    const max = status === 'unrated' ? null : numberOrNull($('#ratingFilterMax').value);
    if (min !== null && max !== null && min > max) {
      $('#ratingFilterMax').setCustomValidity('上限は下限以上にしてください。'); $('#ratingFilterMax').reportValidity(); return;
    }
    if (!$('#ratingFilterForm').reportValidity()) return;
    state.filters.rating = { criterion: $('#ratingFilterCriterion').value, status, min, max };
    if (!switchingRatingPane) closeDialog(el.criteriaDialog); render();
  });

  let toastTimer;
  function showToast(message) {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add('show');
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }

  $('#addButton').addEventListener('click', () => openEditor());
  $('#tagsButton').addEventListener('click', () => openTagDialog('filter'));
  $('#editorTagsButton').addEventListener('click', () => openMachineTagEditor('editor'));
  $('#emptyActionButton').addEventListener('click', () => state.data.machines.length ? clearFilters() : openEditor());
  $('#exportButton').addEventListener('click', () => { exportJson(); $('.data-menu').open = false; });
  $('#importButton').addEventListener('click', () => { $('#importInput').click(); $('.data-menu').open = false; });
  $('#importInput').addEventListener('change', event => event.target.files[0] && importJson(event.target.files[0]));
  $('#ratingsExportButton').addEventListener('click', () => { exportJson('ratings'); $('.data-menu').open = false; });
  $('#ratingsImportButton').addEventListener('click', () => { $('#ratingsImportInput').click(); $('.data-menu').open = false; });
  $('#ratingsImportInput').addEventListener('change', event => event.target.files[0] && importJson(event.target.files[0], 'ratings'));

  $('#searchInput').addEventListener('input', event => { state.filters.search = event.target.value; render(); });
  $('#sortFieldSelect').addEventListener('change', event => { state.filters.sortField = event.target.value; render(); });
  $('#sortDirectionButton').addEventListener('click', () => {
    state.filters.sortDirection = state.filters.sortDirection === 'asc' ? 'desc' : 'asc';
    updateSortDirectionButton();
    render();
  });

  $$('.view-tab').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  $('#rankingList').addEventListener('click', event => {
    const button = event.target.closest('[data-compare-tie]');
    if (button) openTieComparison(button.dataset.compareTie);
  });
  ['compareLeft', 'compareRight'].forEach(id => $('#' + id).addEventListener('change', event => {
    const comparison = state.comparison;
    if (!comparison) return;
    const side = id === 'compareLeft' ? 'left' : 'right';
    const other = side === 'left' ? 'right' : 'left';
    const previous = comparison[side];
    comparison[side] = event.target.value;
    if (comparison[side] === comparison[other]) comparison[other] = previous;
    $('#compareLeft').value = comparison.left;
    $('#compareRight').value = comparison.right;
    renderComparison();
  }));
  $('#compareDifferencesOnly').addEventListener('change', renderComparison);

  $('#rankingCriterionTabs').addEventListener('click', event => {
    const button = event.target.closest('[data-criterion-id]');
    if (!button) return;
    state.rankingCriterionId = button.dataset.criterionId;
    rememberView();
    renderRanking();
  });

  el.grid.addEventListener('click', event => {
    const card = event.target.closest('[data-machine-id]');
    if (!card) return;
    const id = card.dataset.machineId;
    if (event.target.closest('.card-evaluation')) openRatingEditor(id);
    else openDetail(id);
  });
  el.grid.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('[data-machine-id]');
    if (!card) return;
    event.preventDefault();
    if (event.target.closest('.card-evaluation')) openRatingEditor(card.dataset.machineId);
    else if (event.target === card) openDetail(card.dataset.machineId);
  });
  el.detailContent.addEventListener('click', event => {
    const button = event.target.closest('[data-detail-action]');
    if (!button) return;
    const id = button.dataset.machineId;
    closeDialog(el.detailDialog);
    if (button.dataset.detailAction === 'edit') openEditor(id);
  });

  $$('[data-tag-pane]').forEach(button => button.addEventListener('click', () => switchTagPane(button.dataset.tagPane)));
  $('#tagFilterGroups').addEventListener('change', event => updateTagSelection(event, 'filter'));
  $('#machineTagGroups').addEventListener('change', event => updateTagSelection(event, 'machine'));
  $('#clearTagFiltersButton').addEventListener('click', () => {
    state.filters.tags = [];
    render();
    renderTagFilterGroups();
  });
  $('#addTagButton').addEventListener('click', addTagFromInput);
  $('#newTagInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTagFromInput();
    }
  });
  $('#tagManageGroups').addEventListener('change', event => {
    const input = event.target.closest('[data-original-tag]');
    if (!input) return;
    if (!input.value.trim()) {
      renderTagManageGroups();
      return;
    }
    const next = input.dataset.tagGrouped === 'true' ? `${input.dataset.tagCategory}：${input.value.trim()}` : input.value.trim();
    renameTag(input.dataset.originalTag, next);
  });
  $('#tagManageGroups').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-tag]');
    if (button) deleteTag(button.dataset.deleteTag);
  });
  $('#tagDialogDoneButton').addEventListener('click', () => closeDialog(el.tagDialog));
  $$('[data-close-machine-tags]').forEach(button => button.addEventListener('click', commitMachineTags));
  $('#machineTagDoneButton').addEventListener('click', commitMachineTags);

  $$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
  $$('.dialog').forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    if (dialog.id === 'machineTagDialog') commitMachineTags();
    else if (dialog.id === 'editorDialog') el.form.requestSubmit();
    else if (dialog.id === 'ratingDialog') $('#ratingForm').requestSubmit();
    else if (dialog.id === 'criteriaDialog') submitRatingPane();
    else closeDialog(dialog);
  }));

  document.addEventListener('click', event => {
    const menu = $('.data-menu');
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });

  $$('[data-add-row]').forEach(button => button.addEventListener('click', () => addRepeaterRow(button.dataset.addRow)));
  el.form.addEventListener('click', event => {
    if (event.target.classList.contains('remove-row')) {
      const special1 = Boolean(event.target.closest('#special1Rows'));
      event.target.closest('.repeater-row').remove();
      if (special1) updateInitialPayoutPreview();
    }
    handleStarClick(event);
  });
  $('#special1Rows').addEventListener('input', updateInitialPayoutPreview);
  $('#initialPayoutKindInput').addEventListener('change', updateInitialPayoutPreview);
  $('#initialPayoutValueInput').addEventListener('input', updateInitialPayoutPreview);
  $('#initialPayoutNoteInput').addEventListener('input', updateInitialPayoutPreview);
  $('#ratingForm').addEventListener('click', handleStarClick);
  $('#initialProbabilityInput').addEventListener('input', updateRushPreview);
  $('#rushEntryRateInput').addEventListener('input', updateRushPreview);

  el.form.addEventListener('submit', event => {
    event.preventDefault();
    if (!el.form.reportValidity()) return;
    const machine = readMachineFromForm();
    setMachineRatings(machine.id, readRatings(), $('#ratingMemoInput').value, false);
    const index = state.data.machines.findIndex(item => item.id === machine.id);
    if (index >= 0) state.data.machines[index] = machine;
    else state.data.machines.push(machine);
    saveData(index >= 0 ? '機種情報を更新しました' : '機種を追加しました');
    closeDialog(el.editorDialog);
    render();
  });

  $('#deleteButton').addEventListener('click', () => {
    const id = $('#machineId').value;
    const machine = state.data.machines.find(item => item.id === id);
    if (!machine || !confirm(`「${machine.name}」を削除しますか？`)) return;
    state.data.machines = state.data.machines.filter(item => item.id !== id);
    saveData('機種を削除しました');
    closeDialog(el.editorDialog);
    render();
  });

  $('#ratingForm').addEventListener('submit', event => {
    event.preventDefault();
    const machine = state.data.machines.find(item => item.id === $('#ratingMachineId').value);
    if (!machine) return;
    setMachineRatings(machine.id, readRatings($('#quickRatingFields')), $('#quickRatingMemoInput').value);
    showToast('評価を保存しました');
    closeDialog(el.ratingDialog);
    render();
  });

  $('#addCriterionButton').addEventListener('click', addCriterionFromInput);
  $('#newCriterionInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addCriterionFromInput();
    }
  });
  $('#criteriaRows').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.move) {
      const row = button.closest('.subcriterion-chip, .criterion-chip');
      const sibling = button.dataset.move === 'up' ? row.previousElementSibling : row.nextElementSibling;
      if (sibling) button.dataset.move === 'up' ? sibling.before(row) : sibling.after(row);
    }
    if (button.classList.contains('add-subcriterion')) addSubcriterionChip(button.closest('.criterion-chip'));
    if (button.classList.contains('remove-subcriterion')) button.closest('.subcriterion-chip').remove();
    if (button.classList.contains('remove-criterion')) button.closest('.criterion-chip').remove();
    updateReorderButtons();
  });
  $('#criteriaForm').addEventListener('submit', event => {
    event.preventDefault();
    const editorRatings = el.editorDialog.open ? readRatings() : null;
    const quickRatings = el.ratingDialog.open ? readRatings($('#quickRatingFields')) : null;
    const seenNames = new Set();
    const criteria = $$('.criterion-chip', $('#criteriaRows')).map(chip => {
      const childNames = new Set();
      const children = $$('.subcriterion-chip', chip).map(child => ({
        id: child.dataset.criterionId,
        name: $('[data-subcriterion-name]', child).value.trim(),
        weight: normalizeRatingWeight($('[data-subcriterion-weight]', child).value)
      })).filter(child => {
        if (!child.name || childNames.has(child.name)) return false;
        childNames.add(child.name);
        return true;
      });
      return { id: chip.dataset.criterionId, name: $('[data-criterion-name]', chip).value.trim(), weight: normalizeRatingWeight($('[data-criterion-weight]', chip).value), children };
    }).filter(item => {
      if (!item.name || seenNames.has(item.name)) return false;
      seenNames.add(item.name);
      return true;
    });
    state.weights = { ...state.weights, ...weightsFromCriteria(criteria) };
    state.data.settings.ratingCriteria = normalizeData({ ...state.data, settings: { ...state.data.settings, ratingCriteria: criteria } }).settings.ratingCriteria;
    // Keep scores for absent criteria separately; reimporting their IDs restores them.
    if (el.editorDialog.open) renderRatingFields(editorRatings);
    if (el.ratingDialog.open) renderRatingFields(quickRatings, $('#quickRatingFields'));
    saveData('評価項目を更新しました');
    if (!switchingRatingPane) closeDialog(el.criteriaDialog);
    render();
  });

  updateSortDirectionButton();
  applyUrlSettings().finally(() => {
    restoreView(); updateHeaderCollapse(); render(); switchView(state.view); syncSettingsToUrl();
    committedSnapshot = snapshot(); updateUndoButton();
  });
})();
