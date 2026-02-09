# Instagram Comment Lead Intelligence

AI-powered Instagram comment intelligence. This actor scrapes comments from Instagram posts or profiles, classifies intent, computes lead quality, and (optionally) enriches audience data from user profiles.

## Features
- Post and profile inputs (profiles expand to recent posts).
- Delta mode: stop when comments are older than `scrapeSince`.
- High-signal filtering and deduplication.
- Intent classification with heuristic rules and optional LLM fallback.
- Lead scoring (`LOW` / `MEDIUM` / `HIGH`).
- Optional audience enrichment with follower bucket and tier.
- Lead type classification and commercial value scoring.
- Promoter spam detection.
- Webhook notifications for high-intent leads.
- Output filtering via `minLeadScore`.
- Intent groups: `BUY_INTENT`, `QUESTION`, `COMPLAINT`, `PROMOTER_SPAM`, `RANDOM`.

## Input
Example:
```json
{
  "targetUrls": [
    "https://www.instagram.com/p/Cush2lzNPk/",
    "https://www.instagram.com/nike/"
  ],
  "sessionId": "YOUR_INSTAGRAM_SESSION_ID",
  "maxComments": 1000,
  "maxPages": 10,
  "samplingMode": "ALL",
  "samplingProbability": 0.3,
  "minLikes": 5,
  "targetLeadCount": 50,
  "userDefinedLimitMB": 50,
  "maxPostsPerProfile": 3,
  "scrapeSince": "2025-01-01",
  "enrichLeads": true,
  "minLeadScore": "MEDIUM",
  "intentWeights": {
    "BUY_INTENT": {
      "buy": 0.9,
      "order": 0.7
    }
  },
  "languageDetection": {
    "enableFastText": false,
    "fastTextMinChars": 20,
    "fastTextTimeoutMs": 2000
  },
  "webhookUrl": "https://example.com/webhook"
}
```

Input fields:
- `targetUrls` (required): Post or profile URLs.
- `sessionId` (required): Instagram `sessionid` cookie value.
- `sessionCookie` (optional): Full browser cookie string (must include `sessionid=...`).
- `maxComments` (default 1000): Max comments per post.
- `maxPages` (optional): Maximum number of comment pages to paginate.
- `samplingMode` (default ALL): `ALL`, `RANDOM`, or `TOP_LIKED`.
- `samplingProbability` (default 0.3): For `RANDOM`, skip a page with this probability.
- `minLikes` (default 5): For `TOP_LIKED`, only process comments with at least this many likes.
- `targetLeadCount` (default 50): Stop when HIGH intent leads reach this count.
- `userDefinedLimitMB` (optional): Abort when estimated dataset size exceeds this limit.
- `scrapeSince` (optional): Only process comments after this date (YYYY-MM-DD or ISO).
- `enrichLeads` (default false): Enrich lead comments with follower data.
- `intentWeights` (optional): Override intent keyword weights with a JSON dictionary.
- `languageDetection` (optional): Language detection settings (FastText fallback is optional).
- `maxPostsPerProfile` (default 3): Posts per profile when a profile URL is provided.
- `minLeadScore` (default LOW): Filter output by `LOW`, `MEDIUM`, or `HIGH`.
- `webhookUrl` (optional): Send payloads when `leadScore` is `HIGH` and `intent_score > 0.7`.
- `webhookConfig` (optional): Advanced webhook retry/backoff settings.
- `proxyConfiguration`: Apify proxy settings.

## Output Schema
Each dataset item has the following shape:
```json
{
  "postUrl": "https://www.instagram.com/p/Cush2lzNPk/",
  "source_shortcode": "Cush2lzNPk",
  "username": "customer_john",
  "text": "Price? Do you ship?",
  "intent": "BUY_INTENT",
  "intent_score": 0.84,
  "detected_language": "en",
  "user_comment_count": 2,
  "is_lead": true,
  "keywords": ["price", "ship"],
  "leadScore": "HIGH",
  "lead_type": "BUY_INTENT",
  "commercial_score": 0.62,
  "audience_qualification": {
    "followers": 4200,
    "bucket": "1k-10k",
    "tier": "MID_VALUE_AUDIENCE"
  },
  "profileUrl": "https://www.instagram.com/customer_john/",
  "likeCount": 3,
  "postedAt": "2026-02-08T15:21:00.000Z",
  "extractedAt": "2026-02-09T14:10:00.000Z"
}
```

Lead rule:
- `is_lead = true` when `leadScore` is `MEDIUM` or `HIGH`. `LOW` is not a lead.

Webhook rule:
- Notifications fire only when `leadScore` is `HIGH` and `intent_score > 0.7`.

## Deployment (Apify)
1. Push this repository to Git.
2. In Apify Console, create a new Actor from Git:
   - Repository: your Git URL
   - Branch: `master` (or your default)
3. Build and run the Actor.
4. Provide a valid `sessionId` in the input.
5. Use Apify Proxy for larger runs.

## API Usage Examples
Run the Actor:
```bash
curl -X POST \
  "https://api.apify.com/v2/acts/<USERNAME>~<ACTOR_NAME>/runs?token=<APIFY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d @input.json
```

Fetch dataset items:
```bash
curl "https://api.apify.com/v2/datasets/<DATASET_ID>/items?clean=true"
```

Fetch analytics:
```bash
curl "https://api.apify.com/v2/key-value-stores/<STORE_ID>/records/OUTPUT_ANALYTICS"
```

Analytics payload includes:
- `stats.total_comments`
- `stats.leads_count`
- `stats.high_intent_leads`
- `stats.high_value_leads`
- `stats.intent_distribution`
- `stats.top_keywords`

## LLM Fallback (Optional)
Set env vars to enable LLM classification:
- `LEAD_LLM_API_KEY`
- `LEAD_LLM_MODEL` (default `gpt-4o-mini`)
- `LEAD_LLM_BATCH_SIZE`, `LEAD_LLM_BATCH_WAIT_MS`, `LEAD_LLM_MAX_PARALLEL`, `LEAD_LLM_MIN_INTERVAL_MS`

If not set, the actor runs on rule-based classification only.

## Notes
- Instagram blocks unauthenticated access frequently; provide a valid `sessionId`.
- Use proxy for large volumes.
- Output analytics are written to the default KeyValueStore under `OUTPUT_ANALYTICS`.
