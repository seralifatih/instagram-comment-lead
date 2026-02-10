import { scoreLead } from '../src/intelligence/LeadScorer.js';

describe('lead value heuristic', () => {
  test('higher score for purchase intent', () => {
    const high = scoreLead('what is the price? dm details');
    const low = scoreLead('nice');
    expect(high.score).toBeGreaterThan(low.score);
    expect(high.intent).toBe('high');
  });
});
