import { extractShortcode } from '../src/extraction/InstagramParser.js';

describe('instagram shortcode extraction', () => {
  test('extracts from post url', () => {
    expect(extractShortcode('https://www.instagram.com/p/ABC123/')).toBe('ABC123');
  });

  test('extracts from reel url', () => {
    expect(extractShortcode('https://www.instagram.com/reel/XYZ789/')).toBe('XYZ789');
  });

  test('returns null for non-instagram url', () => {
    expect(extractShortcode('https://example.com/p/NOPE')).toBeNull();
  });
});
