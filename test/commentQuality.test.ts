import { assessCommentQuality } from '../src/commentQuality.js';

describe('comment quality filter', () => {
  test('flags emoji-only spam', () => {
    const result = assessCommentQuality('\u{1F525}\u{1F525}');
    expect(result.is_low_quality).toBe(true);
  });

  test('passes meaningful text', () => {
    const result = assessCommentQuality('Can you share the price?');
    expect(result.is_low_quality).toBe(false);
  });
});
