import { scoreLead } from '../src/intelligence/LeadScorer.js';

describe('lead scoring metadata', () => {
  test('returns matched keywords', () => {
    const result = scoreLead('dm me price details');
    expect(result.matched_keywords.length).toBeGreaterThan(0);
  });
});
