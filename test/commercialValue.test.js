import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateCommercialValue } from '../src/commercialValue.js';

test('commercial value: username keyword', () => {
  const score = estimateCommercialValue({ username: 'myshop' });
  assert.ok(score >= 0.1);
});

test('commercial value: bio contact info', () => {
  const score = estimateCommercialValue({ bio: 'contact me at test@example.com' });
  assert.ok(score >= 0.2);
});

test('commercial value: follower and engagement', () => {
  const score = estimateCommercialValue({ followerCount: 20000, engagementRatio: 0.05 });
  assert.ok(score >= 0.3);
});
