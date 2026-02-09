import {
  buildIntentMatchers,
  classifyIntentHeuristic,
  scoreIntentMatches,
  DEFAULT_INTENT_WEIGHTS,
  setIntentMatchersForTests
} from '../src/main.js';

describe('intent detection engine', () => {
  beforeEach(() => {
    setIntentMatchersForTests(buildIntentMatchers(DEFAULT_INTENT_WEIGHTS));
  });

  test('detects buy intent', () => {
    const result = classifyIntentHeuristic('What is the price? Is it available?');
    expect(result.intent).toBe('BUY_INTENT');
    expect(result.intent_score).toBeGreaterThan(0);
  });

  test('detects question intent', () => {
    const result = classifyIntentHeuristic('How does this work?');
    expect(result.intent).toBe('QUESTION');
    expect(result.intent_score).toBeGreaterThan(0);
  });

  test('custom weights influence score', () => {
    const customWeights = {
      BUY_INTENT: { 'special offer': 1.0 },
      QUESTION: { 'what': 0.1 }
    };
    const matchers = buildIntentMatchers(customWeights);
    const scored = scoreIntentMatches('special offer just for you', matchers);
    expect(scored.intent).toBe('BUY_INTENT');
    expect(scored.intent_score).toBeGreaterThan(0.5);
  });
});
