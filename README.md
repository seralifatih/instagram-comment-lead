# Instagram Comment Lead Intelligence

AI-powered Instagram comment intelligence. This actor scrapes comments from Instagram posts or profiles, classifies intent, computes lead quality, and (optionally) enriches audience data from user profiles.

## Features
- Post and profile inputs (profiles expand to recent posts).
- Delta mode: stop when comments are older than `scrapeSince`.
- High-signal filtering and deduplication.
- Intent classification with heuristic rules and optional LLM fallback.
- Lead scoring (`LOW` / `MEDIUM` / `HIGH`).
- Optional audience enrichment with follower bucket and tier.
- Output filtering via `minLeadScore`.

## Input
Example:
```json
{
  "targetUrls": [
    "https://www.instagram.com/p/Cush2lzNPk/",
    "https://www.instagram.com/nike/"
  ],
  "sessionId": "YOUR_INSTAGRAM_SESSION_ID",
  "maxComments": 200,
  "maxPostsPerProfile": 3,
  "scrapeSince": "2025-01-01",
  "enrichLeads": true,
  "minLeadScore": "MEDIUM"
}
```

Input fields:
- `targetUrls` (required): Post or profile URLs.
- `sessionId` (required): Instagram `sessionid` cookie value.
- `sessionCookie` (optional): Full browser cookie string (must include `sessionid=...`).
- `maxComments` (default 100): Max comments per post.
- `scrapeSince` (optional): Only process comments after this date (YYYY-MM-DD or ISO).
- `enrichLeads` (default false): Enrich lead comments with follower data.
- `maxPostsPerProfile` (default 3): Posts per profile when a profile URL is provided.
- `minLeadScore` (default LOW): Filter output by `LOW`, `MEDIUM`, or `HIGH`.
- `proxyConfiguration`: Apify proxy settings.

## Output Schema
Each dataset item has the following shape:
```json
{
  "postUrl": "https://www.instagram.com/p/Cush2lzNPk/",
  "source_shortcode": "Cush2lzNPk",
  "username": "customer_john",
  "text": "Price? Do you ship?",
  "intent": "PRICE_INQUIRY",
  "intent_score": 0.84,
  "is_lead": true,
  "keywords": ["price", "ship"],
  "leadScore": "HIGH",
  "lead_type": "BUY_INTENT",
  "audience_qualification": {
    "followers": 4200,
    "bucket": "1k-10k",
    "tier": "qualified"
  },
  "profileUrl": "https://www.instagram.com/customer_john/",
  "likeCount": 3,
  "postedAt": "2026-02-08T15:21:00.000Z",
  "extractedAt": "2026-02-09T14:10:00.000Z"
}
```

Lead rule:
- `is_lead = true` when `intent_score > 0.5` AND follower bucket is at least `1k-10k`.

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
