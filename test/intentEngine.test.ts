import { scoreLead } from '../src/intelligence/LeadScorer.js';

describe('intent detection engine', () => {
  test('detects high intent', () => {
    const result = scoreLead('how much is it? price and shipping');
    expect(result.intent).toBe('high');
    expect(result.score).toBeGreaterThan(0.6);
  });

  test('detects low intent', () => {
    const result = scoreLead('nice post');
    expect(result.intent).toBe('low');
    expect(result.score).toBeLessThan(0.4);
  });
});
