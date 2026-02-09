import { estimateCommercialValue } from '../src/commercialValue.js';

describe('commercial score heuristics', () => {
  test('username keyword boosts score', () => {
    const score = estimateCommercialValue({ username: 'myshop' });
    expect(score).toBeGreaterThanOrEqual(0.15);
  });

  test('bio contact and link boost score', () => {
    const score = estimateCommercialValue({ bio: 'contact me at test@example.com https://linktr.ee/brand' });
    expect(score).toBeGreaterThanOrEqual(0.3);
  });

  test('follower and engagement weights increase score', () => {
    const score = estimateCommercialValue({ followerCount: 20000, engagementRatio: 0.05 });
    expect(score).toBeGreaterThanOrEqual(0.3);
  });

  test('low signal profile stays low', () => {
    const score = estimateCommercialValue({ username: 'user', bio: '' });
    expect(score).toBeLessThan(0.3);
  });
});
