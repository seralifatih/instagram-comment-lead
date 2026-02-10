# Instagram Comment Lead Intelligence

Extract qualified leads from Instagram post comments using AI-powered intent detection and lead scoring.

This Apify Actor analyses comments on Instagram posts and reels, classifies commenter intent (purchase interest, questions, complaints, spam), scores lead quality, and outputs structured lead records to an Apify Dataset.

## Input

The Actor accepts a JSON object with two required fields and four optional fields.

### Required

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `postUrls` | `string[]` | 1–50 items, each matching `instagram.com/p/` or `/reel/` | Instagram post or reel URLs to analyse |
| `sessionId` | `string` | Non-empty | Instagram `sessionid` cookie value for authenticated scraping |

### Optional

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `maxCommentsPerPost` | `integer` | `1000` | 10–10,000 | Maximum comments to fetch per post |
| `targetLeads` | `integer` | `50` | 1–1,000 | Stop early once this many qualified leads are found |
| `minLeadScore` | `number` | `0.4` | 0.0–1.0 | Minimum quality score a lead must reach to appear in results |
| `debugComments` | `boolean` | `false` | - | When enabled, pushes raw comment records to the dataset |

When an optional field is omitted, the default is applied automatically. Extra fields are rejected (`additionalProperties: false`).

### Example input

Full configuration:

```json
{
  "postUrls": [
    "https://www.instagram.com/p/C3xYz1234Ab/",
    "https://www.instagram.com/reel/C3xYz5678Cd/"
  ],
  "sessionId": "123456789%3AABCDEF123456789%3A12",
  "maxCommentsPerPost": 500,
  "targetLeads": 30,
  "minLeadScore": 0.6,
  "debugComments": false
}
```

Minimal valid input (defaults to 1,000 comments, 50 leads, 0.4 score):

```json
{
  "postUrls": ["https://www.instagram.com/p/C3xYz1234Ab/"],
  "sessionId": "123456789%3AABCDEF123456789%3A12"
}
```

### Getting `sessionId`

1. Log in to Instagram in your browser.
2. Open DevTools and go to `Application` (Chrome) or `Storage` (Firefox).
3. Under `Cookies`, select `https://www.instagram.com`.
4. Copy the value of the `sessionid` cookie and paste it into `sessionId`.

### URL format

Accepted patterns:

```
https://www.instagram.com/p/ABC123/
https://www.instagram.com/reel/ABC123/
https://instagram.com/p/ABC123/
https://instagram.com/reel/ABC123/
```

Profile URLs, story URLs, and other platforms are rejected.

## Output

Each qualified lead is pushed to the default Apify Dataset as a JSON object.

### Lead record fields

| Field | Type | Description |
|-------|------|-------------|
| `postUrl` | `string` | Source post URL |
| `source_shortcode` | `string` | Instagram shortcode of the post |
| `username` | `string` | Commenter's Instagram handle |
| `text` | `string` | Full comment text |
| `intent` | `string` | One of `BUY_INTENT`, `QUESTION`, `COMPLAINT`, `PROMOTER_SPAM`, `RANDOM` |
| `intent_score` | `number` | Intent confidence, 0.0–1.0 |
| `detected_language` | `string` | ISO language code (`en`, `es`, `tr`, etc.) |
| `is_lead` | `boolean` | Whether this comment qualifies as a lead |
| `keywords` | `string[]` | Intent keywords detected in the comment |
| `leadScore` | `string` | Quality tier: `HIGH`, `MEDIUM`, or `LOW` |
| `lead_type` | `string` | One of `BUY_INTENT`, `QUESTION`, `PROMOTER_SPAM`, `RANDOM` |
| `commercial_score` | `number` | Commercial value estimate, 0.0–1.0 |
| `audience_qualification` | `object \| null` | `{ followers, bucket, tier }` — see below |
| `user_comment_count` | `integer` | How many comments this user left across all analysed posts |
| `profileUrl` | `string` | `https://www.instagram.com/<username>/` |
| `likeCount` | `integer` | Likes on the comment |
| `postedAt` | `string` | ISO 8601 timestamp when the comment was posted |
| `extractedAt` | `string` | ISO 8601 timestamp when the record was extracted |

### Audience qualification object

| Field | Type | Values |
|-------|------|--------|
| `followers` | `integer \| null` | Follower count, or `null` if unavailable |
| `bucket` | `string \| null` | `<1k`, `1k-10k`, `10k-100k`, `100k+` |
| `tier` | `string` | `HIGH_VALUE_AUDIENCE`, `MID_VALUE_AUDIENCE`, `LOW_VALUE_AUDIENCE` |

### Example output record

```json
{
  "postUrl": "https://www.instagram.com/p/C3xYz1234Ab/",
  "source_shortcode": "C3xYz1234Ab",
  "username": "john_entrepreneur",
  "text": "This is exactly what I need! Do you offer enterprise pricing?",
  "intent": "BUY_INTENT",
  "intent_score": 0.87,
  "detected_language": "en",
  "is_lead": true,
  "keywords": ["enterprise pricing", "need"],
  "leadScore": "HIGH",
  "lead_type": "BUY_INTENT",
  "commercial_score": 0.82,
  "audience_qualification": {
    "followers": 5420,
    "bucket": "1k-10k",
    "tier": "MID_VALUE_AUDIENCE"
  },
  "user_comment_count": 1,
  "profileUrl": "https://www.instagram.com/john_entrepreneur/",
  "likeCount": 12,
  "postedAt": "2024-02-09T14:23:11.000Z",
  "extractedAt": "2024-02-09T15:30:45.000Z"
}
```

## Validation and error handling

The Actor validates input before doing any work. Every violation throws immediately with a prefixed error code. No silent fallbacks.

| Code | Cause | Example message |
|------|-------|-----------------|
| `INPUT_MISSING` | No input provided | `No input provided. Supply at least { "postUrls": ["…"] }.` |
| `INPUT_INVALID` | Input is not a JSON object | `Input must be a JSON object, received array.` |
| `INPUT_MISSING_FIELD` | `postUrls` absent or not an array | `"postUrls" is required and must be a string array.` |
| `INPUT_EMPTY` | `postUrls` is an empty array | `"postUrls" must contain at least 1 URL.` |
| `INPUT_OVERFLOW` | Too many URLs | `"postUrls" has 60 items (max 50).` |
| `INPUT_TYPE` | Wrong type for a field | `"maxCommentsPerPost" must be a finite number, received "fast".` |
| `INPUT_RANGE` | Value outside allowed range | `"minLeadScore" must be between 0 and 1, received 2.5.` |
| `INPUT_PATTERN` | URL doesn't match Instagram pattern | `postUrls[0] ("https://x.com/…") is not a valid Instagram URL.` |

## Running locally

```bash
npm install
npm run build   # compiles TypeScript to dist/
npm start       # runs dist/index.js (prestart hook auto-rebuilds)
```

To iterate during development:

```bash
npm run dev     # build + run in one step
```

## Project structure

```
.actor/
  actor.json            Actor metadata and dataset views
  input_schema.json     Apify UI schema (4 fields)
src/
  index.ts              Entry point: init, validate, process, exit
  types/
    Input.ts            InputSchema interface, defaults, constraints
    Output.ts           LeadOutput and AnalyticsSummary interfaces
dist/                   Compiled JavaScript (generated by tsc)
Dockerfile              Build image: install, compile, prune, run
package.json
tsconfig.json
```

## Build configuration

| Setting | Value |
|---------|-------|
| TypeScript strict mode | Enabled (all flags) |
| Target | ES2022 |
| Module | ES2022 |
| Root directory | `src/` |
| Output directory | `dist/` |
| Source maps | Generated |
| Node.js | >= 18 |

The `prestart` hook runs `tsc` automatically before every `npm start`. A `postbuild` hook verifies `dist/index.js` exists after compilation.

## License

MIT