const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
// Expose pure helpers only in this VM; no test hooks or DOM stubs in the app.
const source = readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
const context = { structuredClone, crypto: webcrypto };
vm.createContext(context);
vm.runInContext(source.replace('  const state = {', `
  globalThis.api = { normalizeRatingWeight, weightedRating, criterionRatingFromRatings, overallRatingFromRatings, normalizeData };
  return;
  const state = {`), context);
const { normalizeRatingWeight, weightedRating, criterionRatingFromRatings, overallRatingFromRatings, normalizeData } = context.api;
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const criteria = [
  { id: 'main', name: '演出', weight: 2, children: [{ id: 'a', name: '先読み', weight: 3 }, { id: 'b', name: 'リーチ', weight: 1 }] },
  { id: 'other', name: 'RUSH', weight: 1 }
];
test('legacy and blank weights keep the equal average', () => {
  assert.equal(overallRatingFromRatings([{ id: 'a' }, { id: 'b', weight: '' }], { a: 5, b: 1 }), 3);
  assert.equal(criterionRatingFromRatings({ children: [{ id: 'a' }, { id: 'b' }] }, { a: 5, b: 1 }), 3);
});
test('subcriteria and main criteria apply weights independently', () => {
  assert.equal(criterionRatingFromRatings(criteria[0], { a: 5, b: 1 }), 4);
  approx(overallRatingFromRatings(criteria, { a: 5, b: 1, other: 2 }), 10 / 3);
});
test('unscored criteria are excluded from the denominator', () => {
  assert.equal(overallRatingFromRatings(criteria, { a: 5 }), 5);
  assert.equal(overallRatingFromRatings(criteria, { other: 2 }), 2);
  assert.equal(overallRatingFromRatings(criteria, {}), null);
});
test('zero weight excludes from its parent while retaining its own score', () => {
  const c = [{ ...criteria[0], weight: 0 }, criteria[1]];
  assert.equal(criterionRatingFromRatings(c[0], { a: 5, b: 1 }), 4);
  assert.equal(overallRatingFromRatings(c, { a: 5, b: 1, other: 2 }), 2);
  assert.equal(overallRatingFromRatings(c, { a: 5 }), null);
  assert.equal(criterionRatingFromRatings({ children: [{ id: 'a', weight: 0 }] }, { a: 5 }), null);
});
test('decimal weights are supported', () => {
  approx(overallRatingFromRatings([{ id: 'a', weight: .5 }, { id: 'b', weight: 1.5 }], { a: 5, b: 1 }), 2);
});
test('rounding does not collapse distinct ranking scores', () => {
  const a = overallRatingFromRatings([{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }], { a: 3, b: 3.5 });
  const b = overallRatingFromRatings([{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }], { a: 4, b: 3 });
  assert.equal(a, b); // truly identical rational scores remain tied
  const x = weightedRating([{ value: 3, weight: 16 }, { value: 3.5, weight: 34 }]);
  assert.equal(x.toFixed(1), a.toFixed(1));
  assert.ok(x > a); // same displayed 3.3, distinct raw score
});
test('invalid imported weights fall back to equal weighting', () => {
  for (const value of [undefined, null, '', ' ', -1, Infinity, NaN, 'oops', true]) assert.equal(normalizeRatingWeight(value), null);
  assert.equal(normalizeRatingWeight('0'), 0);
  assert.equal(normalizeRatingWeight('2.5'), 2.5);
});
test('extremely large valid weights remain finite', () => {
  assert.equal(weightedRating([{ value: 5, weight: 1e308 }, { value: 1, weight: 1e308 }]), 3);
});
test('import/export and URL settings normalization retain both levels', () => {
  const data = { schemaVersion: 8, machines: [], settings: { ratingCriteria: criteria, tags: [] } };
  const restored = normalizeData(JSON.parse(JSON.stringify(data)));
  assert.equal(restored.settings.ratingCriteria[0].weight, 2);
  assert.equal(restored.settings.ratingCriteria[0].children[0].weight, 3);
  approx(overallRatingFromRatings(restored.settings.ratingCriteria, { a: 5, b: 1, other: 2 }), 10 / 3);
  const old = normalizeData({ schemaVersion: 7, machines: [], settings: { ratingCriteria: [{ id: 'a', name: '既存' }] } });
  assert.equal(old.settings.ratingCriteria[0].weight, null);
  assert.equal(overallRatingFromRatings(old.settings.ratingCriteria, { a: 4 }), 4);
});
