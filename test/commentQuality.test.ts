import { isSpam } from '../src/intelligence/SpamFilter.js';

describe('comment quality via spam filter', () => {
  test('flags obvious spam', () => {
    expect(isSpam('promote on this page')).toBe(true);
  });

  test('does not flag normal comment', () => {
    expect(isSpam('Looks great, interested in pricing')).toBe(false);
  });
});
