import { computeLeadScore, categorizeLeadScore, getFollowerBucketWeight, getCommentLengthWeight } from '../src/leadScore.js';

describe('lead scoring', () => {
  test('computeLeadScore: high score case', () => {
    const result = computeLeadScore(1.0, 250000, 'a'.repeat(120));
    expect(result.category).toBe('HIGH');
    expect(result.score).toBeGreaterThan(0.9);
  });

  test('computeLeadScore: medium score case', () => {
    const result = computeLeadScore(0.5, 5000, 'This is a question about pricing');
    expect(result.category).toBe('MEDIUM');
    expect(result.score).toBeGreaterThanOrEqual(0.4);
    expect(result.score).toBeLessThanOrEqual(0.7);
  });

  test('computeLeadScore: low score case', () => {
    const result = computeLeadScore(0.1, 500, 'ok');
    expect(result.category).toBe('LOW');
    expect(result.score).toBeLessThan(0.4);
  });

  test('categorizeLeadScore boundaries', () => {
    expect(categorizeLeadScore(0.39)).toBe('LOW');
    expect(categorizeLeadScore(0.4)).toBe('MEDIUM');
    expect(categorizeLeadScore(0.7)).toBe('MEDIUM');
    expect(categorizeLeadScore(0.71)).toBe('HIGH');
  });

  test('weights: follower bucket and length', () => {
    expect(getFollowerBucketWeight(999)).toBe(0.1);
    expect(getFollowerBucketWeight(1000)).toBe(0.3);
    expect(getFollowerBucketWeight(10000)).toBe(0.6);
    expect(getFollowerBucketWeight(100001)).toBe(1.0);

    expect(getCommentLengthWeight('a'.repeat(10))).toBe(0.1);
    expect(getCommentLengthWeight('a'.repeat(20))).toBe(0.5);
    expect(getCommentLengthWeight('a'.repeat(101))).toBe(1.0);
  });
});
