import { detectPromoterSpam } from '../src/main.js';

describe('promoter spam detection', () => {
  test('flags follow me patterns', () => {
    const result = detectPromoterSpam('follow me and check my page');
    expect(result.isSpam).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  test('flags crypto contract addresses', () => {
    const result = detectPromoterSpam('new token address 0x1234567890abcdef1234567890abcdef12345678');
    expect(result.isSpam).toBe(true);
    expect(result.keywords).toContain('crypto_address');
  });

  test('flags referral phrases', () => {
    const result = detectPromoterSpam('use my code for a discount, referral inside');
    expect(result.isSpam).toBe(true);
    expect(result.keywords).toContain('referral');
  });
});
