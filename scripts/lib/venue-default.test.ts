import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultVenue, isVenueOver } from './types';

test('会期前は最初の会場（大阪）を見せる', () => {
  assert.equal(defaultVenue(new Date('2026-08-01T00:00:00Z')), 'osaka');
});

test('大阪の会期中は大阪', () => {
  assert.equal(defaultVenue(new Date('2026-08-15T03:00:00Z')), 'osaka');
});

test('大阪の最終日（8/16）はまだ大阪。JST の日付が変わるまでは終わっていない', () => {
  // 8/16 23:00 JST = 8/16 14:00 UTC
  assert.equal(defaultVenue(new Date('2026-08-16T14:00:00Z')), 'osaka');
  assert.equal(isVenueOver('osaka', new Date('2026-08-16T14:00:00Z')), false);
});

test('大阪が終わったら東京に切り替わる', () => {
  // 8/17 0:00 JST = 8/16 15:00 UTC
  assert.equal(defaultVenue(new Date('2026-08-16T15:00:00Z')), 'tokyo');
  assert.equal(isVenueOver('osaka', new Date('2026-08-16T15:00:00Z')), true);
  assert.equal(defaultVenue(new Date('2026-08-25T00:00:00Z')), 'tokyo');
});

test('東京の会期中も東京', () => {
  assert.equal(defaultVenue(new Date('2026-08-29T03:00:00Z')), 'tokyo');
});

test('全部終わったあとは最後の会場（東京）のまま。空にはしない', () => {
  assert.equal(defaultVenue(new Date('2026-09-10T00:00:00Z')), 'tokyo');
  assert.equal(isVenueOver('tokyo', new Date('2026-09-10T00:00:00Z')), true);
});
