import { isSpam } from '../src/intelligence/SpamFilter.js';

describe('spam detection', () => {
  test('flags repetitive text', () => {
    expect(isSpam('spam spam spam')).toBe(true);
  });

  test('flags known spam phrases', () => {
    expect(isSpam('promote on my page')).toBe(true);
    expect(isSpam('send pic for details')).toBe(true);
  });

  test('does not flag normal comment', () => {
    expect(isSpam('interested in price, please DM')).toBe(false);
  });
});
