import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeLeadScore,
  categorizeLeadScore,
  getFollowerBucketWeight,
  getCommentLengthWeight
} from '../src/leadScore.js';

test('computeLeadScore: high score case', () => {
  const result = computeLeadScore(1.0, 250000, 'a'.repeat(120));
  assert.equal(result.category, 'HIGH');
  assert.ok(result.score > 0.9);
});

test('computeLeadScore: medium score case', () => {
  const result = computeLeadScore(0.5, 5000, 'This is a question about pricing');
  assert.equal(result.category, 'MEDIUM');
  assert.ok(result.score >= 0.4 && result.score <= 0.7);
});

test('computeLeadScore: low score case', () => {
  const result = computeLeadScore(0.1, 500, 'ok');
  assert.equal(result.category, 'LOW');
  assert.ok(result.score < 0.4);
});

test('categorizeLeadScore boundaries', () => {
  assert.equal(categorizeLeadScore(0.39), 'LOW');
  assert.equal(categorizeLeadScore(0.4), 'MEDIUM');
  assert.equal(categorizeLeadScore(0.7), 'MEDIUM');
  assert.equal(categorizeLeadScore(0.71), 'HIGH');
});

test('weights: follower bucket and length', () => {
  assert.equal(getFollowerBucketWeight(999), 0.1);
  assert.equal(getFollowerBucketWeight(1000), 0.3);
  assert.equal(getFollowerBucketWeight(10000), 0.6);
  assert.equal(getFollowerBucketWeight(100001), 1.0);

  assert.equal(getCommentLengthWeight('a'.repeat(10)), 0.1);
  assert.equal(getCommentLengthWeight('a'.repeat(20)), 0.5);
  assert.equal(getCommentLengthWeight('a'.repeat(101)), 1.0);
});
