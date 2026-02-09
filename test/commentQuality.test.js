import assert from 'node:assert/strict';
import test from 'node:test';
import { assessCommentQuality, resetCommentQualityCache } from '../src/commentQuality.js';

test('comment quality: emoji only', () => {
  const result = assessCommentQuality('🔥🔥');
  assert.equal(result.is_low_quality, true);
  assert.equal(result.reason, 'emoji_only');
});

test('comment quality: repeated chars', () => {
  const result = assessCommentQuality('looooolllll');
  assert.equal(result.is_low_quality, true);
  assert.equal(result.reason, 'repeated_chars');
});

test('comment quality: spam phrase', () => {
  const result = assessCommentQuality('follow me for more');
  assert.equal(result.is_low_quality, true);
  assert.equal(result.reason, 'spam_phrase');
});

test('comment quality: giveaway bot', () => {
  const result = assessCommentQuality('giveaway winner!');
  assert.equal(result.is_low_quality, true);
  assert.equal(result.reason, 'giveaway_bot');
});

test('comment quality: repeated copy across posts', () => {
  resetCommentQualityCache();
  const a = assessCommentQuality('love this', { username: 'user1', postShortcode: 'ABC' });
  assert.equal(a.is_low_quality, false);
  const b = assessCommentQuality('love this', { username: 'user1', postShortcode: 'XYZ' });
  assert.equal(b.is_low_quality, true);
  assert.equal(b.reason, 'repeated_copy');
});
