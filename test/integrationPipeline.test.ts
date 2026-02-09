import Ajv from 'ajv';
import { jest } from '@jest/globals';
import datasetSchema from '../.actor/dataset_schema.json';
import {
  fetchCommentsIterator,
  classifyIntentHeuristic,
  buildAudienceQualification
} from '../src/main.js';
import { computeLeadScore } from '../src/leadScore.js';

const makeResponse = (data: any) => ({
  ok: true,
  json: async () => data
});

describe('integration: scraping pipeline', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    // @ts-ignore
    global.fetch = originalFetch;
  });

  test('processes comments from mocked network', async () => {
    const responses = [
      { comments: [
        { pk: 1, text: 'price?', user: { username: 'u1', full_name: '', pk: 1 }, created_at: 500, comment_like_count: 2 },
        { pk: 2, text: 'nice', user: { username: 'u2', full_name: '', pk: 2 }, created_at: 500, comment_like_count: 0 }
      ], next_min_id: null }
    ];

    let call = 0;
    // @ts-ignore
    global.fetch = jest.fn().mockImplementation(() => Promise.resolve(makeResponse(responses[call++])));

    const page = { evaluate: (fn: any, args: any) => fn(args), waitForTimeout: async () => {} } as any;
    const records: any[] = [];

    for await (const batch of fetchCommentsIterator(page, { mediaId: '1', appId: 'app', scrapeSince: null, maxPages: null })) {
      for (const comment of batch) {
        const analysis = classifyIntentHeuristic(comment.text);
        const leadScoring = computeLeadScore(analysis.intent_score, 5000, comment.text);
        const audience = buildAudienceQualification(5000, 0.03);
        records.push({
          postUrl: 'https://www.instagram.com/p/abc/',
          source_shortcode: 'abc',
          username: comment.user.username,
          text: comment.text,
          intent: analysis.intent,
          intent_score: analysis.intent_score,
          detected_language: analysis.language,
          is_lead: leadScoring.category !== 'LOW',
          keywords: analysis.keywords,
          leadScore: leadScoring.category,
          lead_type: analysis.intent === 'PROMOTER_SPAM' ? 'PROMOTER_SPAM' : 'BUY_INTENT',
          commercial_score: 0.4,
          audience_qualification: audience,
          profileUrl: `https://www.instagram.com/${comment.user.username}/`,
          likeCount: comment.comment_like_count,
          postedAt: new Date(comment.created_at * 1000).toISOString(),
          extractedAt: new Date().toISOString(),
          user_comment_count: 1
        });
      }
    }

    expect(records.length).toBe(2);
    expect(records[0]).toHaveProperty('intent');
    expect(records[0]).toHaveProperty('leadScore');
  });

  test('validates output schema', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(datasetSchema.fields);

    const record = {
      postUrl: 'https://www.instagram.com/p/abc/',
      source_shortcode: 'abc',
      username: 'user1',
      profileUrl: 'https://www.instagram.com/user1/',
      text: 'price?',
      likeCount: 2,
      postedAt: new Date().toISOString(),
      extractedAt: new Date().toISOString(),
      is_lead: true,
      leadScore: 'HIGH',
      intent: 'BUY_INTENT',
      intent_score: 0.8,
      detected_language: 'en',
      keywords: ['price'],
      audience_qualification: { followers: 4200, bucket: '1k-10k', tier: 'MID_VALUE_AUDIENCE' },
      lead_type: 'BUY_INTENT',
      commercial_score: 0.5,
      user_comment_count: 1
    };

    const valid = validate(record);
    if (!valid) {
      // eslint-disable-next-line no-console
      console.log(validate.errors);
    }
    expect(valid).toBe(true);
  });
});
