import { scoreLead } from '../src/intelligence/LeadScorer.js';

describe('lead scoring', () => {
  test('high score case', () => {
    const result = scoreLead('price details dm');
    expect(result.intent).toBe('high');
    expect(result.score).toBeGreaterThan(0.6);
  });

  test('low score case', () => {
    const result = scoreLead('ok');
    expect(result.intent).toBe('low');
    expect(result.score).toBeLessThan(0.4);
  });
});
