import { jest } from '@jest/globals';
import { fetchCommentsIterator } from '../src/main.js';

type MockResponse = { ok: boolean; json: () => Promise<any> };

const makeResponse = (data: any): MockResponse => ({
  ok: true,
  json: async () => data
});

describe('comment pagination and limits', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    // @ts-ignore
    global.fetch = originalFetch;
  });

  test('iterates pages and respects maxPages', async () => {
    const responses = [
      { comments: [{ pk: 1, text: 'a', user: { username: 'u1', full_name: '', pk: 1 }, created_at: 200, comment_like_count: 1 }], next_min_id: 'next1' },
      { comments: [{ pk: 2, text: 'b', user: { username: 'u2', full_name: '', pk: 2 }, created_at: 200, comment_like_count: 2 }], next_min_id: 'next2' },
      { comments: [{ pk: 3, text: 'c', user: { username: 'u3', full_name: '', pk: 3 }, created_at: 200, comment_like_count: 3 }], next_min_id: null }
    ];

    let call = 0;
    // @ts-ignore
    global.fetch = jest.fn().mockImplementation(() => Promise.resolve(makeResponse(responses[call++])));

    const page = { evaluate: (fn: any, args: any) => fn(args), waitForTimeout: async () => {} } as any;

    const batches: any[] = [];
    for await (const batch of fetchCommentsIterator(page, { mediaId: '1', appId: 'app', scrapeSince: null, maxPages: 2 })) {
      batches.push(batch);
    }

    const total = batches.flat().length;
    expect(total).toBe(2);
  });

  test('stops when scrapeSince reached', async () => {
    const responses = [
      { comments: [
        { pk: 1, text: 'new', user: { username: 'u1', full_name: '', pk: 1 }, created_at: 500, comment_like_count: 1 },
        { pk: 2, text: 'old', user: { username: 'u2', full_name: '', pk: 2 }, created_at: 100, comment_like_count: 1 }
      ], next_min_id: 'next1' }
    ];

    let call = 0;
    // @ts-ignore
    global.fetch = jest.fn().mockImplementation(() => Promise.resolve(makeResponse(responses[call++])));

    const page = { evaluate: (fn: any, args: any) => fn(args), waitForTimeout: async () => {} } as any;

    const batches: any[] = [];
    for await (const batch of fetchCommentsIterator(page, { mediaId: '1', appId: 'app', scrapeSince: 200, maxPages: null })) {
      batches.push(batch);
    }

    const total = batches.flat().length;
    expect(total).toBe(1);
  });
});
