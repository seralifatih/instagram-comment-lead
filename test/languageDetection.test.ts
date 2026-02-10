import { parsePost } from '../src/extraction/InstagramParser.js';

describe('instagram parser', () => {
  test('parses embedded JSON from HTML', () => {
    const html = '<html><script type="application/json" id="__NEXT_DATA__">' +
      JSON.stringify({
        props: {
          pageProps: {
            shortcode_media: {
              id: '1',
              shortcode: 'ABC',
              edge_media_to_caption: { edges: [{ node: { text: 'caption' } }] },
              edge_media_preview_like: { count: 5 },
              edge_media_to_parent_comment: { count: 1, edges: [{ node: { owner: { username: 'u' }, text: 'price?' } }] },
              taken_at_timestamp: 1700000000,
              owner: { username: 'owner' }
            }
          }
        }
      }) +
      '</script></html>';

    const parsed = parsePost(html);
    expect(parsed.post?.shortcode).toBe('ABC');
    expect(parsed.comments.length).toBe(1);
  });
});
