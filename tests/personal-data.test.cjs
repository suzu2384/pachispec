const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
const KEY = 'pachinko-spec-library-v1', PERSONAL = 'pachispec-personal-ratings-v1';
const legacy = { schemaVersion: 8, settings: { tags: [], ratingCriteria: [{ id: 'a', name: '演出', weight: 2 }] }, machines: [{ id: 'm', name: '機種', ratings: { a: 4.5 }, updatedAt: '2026-09-01' }] };
function harness(values = {}, failKey = null) {
 const storage = new Map(Object.entries(values));
 const context = { structuredClone, crypto: webcrypto, localStorage: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => { if (key === failKey) throw new Error('quota'); storage.set(key, value); }
 }};
 vm.createContext(context);
 vm.runInContext(source.replace('  const state = {', '  globalThis.api = { loadStores, normalizeData, readPersonalData, ratingsDocument, readPersonalWeights }; return; const state = {'), context);
 return { ...context.api, storage };
}
test('legacy scores move to separate storage without changing machine IDs', () => {
 const h = harness({ [KEY]: JSON.stringify(legacy) });
 const loaded = h.loadStores();
 assert.equal(loaded.ratings.m.a, 4.5);
 assert.equal(loaded.weights.a, 2);
 assert.equal(loaded.data.machines[0].id, 'm');
 assert.equal(Object.hasOwn(loaded.data.machines[0], 'ratings'), false);
 assert.equal(Object.hasOwn(JSON.parse(h.storage.get(KEY)).machines[0], 'ratings'), false);
 assert.equal(JSON.parse(h.storage.get(PERSONAL)).ratings.m.a, 4.5);
 assert.equal(h.loadStores().ratings.m.a, 4.5);
});
test('existing personal storage wins during repeated migration', () => {
 const h = harness({ [KEY]: JSON.stringify(legacy), [PERSONAL]: JSON.stringify({ format: 'pachispec-ratings', schemaVersion: 1, ratings: { m: {} } }) });
 assert.equal(Object.keys(h.loadStores().ratings.m).length, 0);
});
test('failure writing private scores leaves original combined backup intact', () => {
 const original = JSON.stringify(legacy);
 const h = harness({ [KEY]: original }, PERSONAL);
 const loaded = h.loadStores();
 assert.equal(loaded.ratings.m.a, 4.5);
 assert.equal(loaded.weights.a, 2);
 assert.equal(loaded.migrationPending, true);
 assert.equal(h.storage.get(KEY), original);
});
test('public data contains definitions but neither weights nor scores', () => {
 const data = harness().normalizeData(legacy);
 assert.equal(data.format, 'pachispec-catalog');
 assert.equal(Object.hasOwn(data.settings.ratingCriteria[0], 'weight'), false);
 assert.equal(JSON.stringify(data).includes('"ratings"'), false);
});
test('personal data round trips unknown IDs without definitions', () => {
 const h = harness();
 const data = h.readPersonalData({ format: 'pachispec-ratings', schemaVersion: 1, ratings: { unseen: { unknown: 3.5 }, cleared: {} } });
 const restored = h.readPersonalData(JSON.parse(JSON.stringify(h.ratingsDocument(data))));
 assert.equal(restored.unseen.unknown, 3.5);
 assert.equal(Object.keys(restored.cleared).length, 0);
 assert.equal(Object.hasOwn(h.ratingsDocument(data), 'settings'), false);
});
test('old combined files can supply scores explicitly', () => {
 assert.equal(harness().readPersonalData(legacy).m.a, 4.5);
});
test('wrong file kind and invalid scores are rejected before overwrite', () => {
 const h = harness();
 for (const score of [0, 6, 2.2, null, true, {}, 'NaN']) assert.throws(() => h.readPersonalData({ format: 'pachispec-ratings', schemaVersion: 1, ratings: { m: { a: score } } }));
 assert.throws(() => h.readPersonalData(h.normalizeData(legacy)));
 assert.throws(() => h.readPersonalData({ format: 'pachispec-ratings', schemaVersion: 1, ratings: [] }));
});

test('personal v2 retains main/sub weights including zero and default', () => {
 const h = harness();
 const doc = h.ratingsDocument({ m: { a: 4 } }, { main: 2, sub: 0, other: null });
 const restored = h.readPersonalWeights(JSON.parse(JSON.stringify(doc)));
 assert.equal(restored.main, 2);
 assert.equal(restored.sub, 0);
 assert.equal(restored.other, null);
 assert.equal(Object.keys(h.readPersonalWeights({ format: 'pachispec-ratings', schemaVersion: 1, ratings: {} })).length, 0);
 assert.throws(() => h.readPersonalWeights({ format: 'pachispec-ratings', schemaVersion: 2, weights: { main: -1 } }));
});
