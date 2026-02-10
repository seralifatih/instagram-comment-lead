import { parsePost } from '../src/extraction/InstagramParser.js';
import { scoreLead } from '../src/intelligence/LeadScorer.js';

describe('integration pipeline', () => {
  test('parses and scores leads', () => {
    const json = JSON.stringify({
      graphql: {
        shortcode_media: {
          id: '1',
          shortcode: 'POST',
          edge_media_to_caption: { edges: [] },
          edge_media_preview_like: { count: 0 },
          edge_media_to_parent_comment: {
            count: 2,
            edges: [
              { node: { owner: { username: 'a' }, text: 'price?' } },
              { node: { owner: { username: 'b' }, text: 'nice' } }
            ]
          },
          taken_at_timestamp: 1700000000,
          owner: { username: 'owner' }
        }
      }
    });

    const { comments } = parsePost(json);
    const scored = comments.map((c) => scoreLead(c.text));
    expect(scored.some((s) => s.score >= 0.4)).toBe(true);
  });
});
