# Instagram Comment Lead Intelligence API

> **Minimal, production-ready lead generation from Instagram comments using AI**

[![Apify](https://img.shields.io/badge/Apify-Actor-00d4aa)](https://apify.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🎯 Overview

A lightweight, type-safe Apify Actor for extracting qualified leads from Instagram post comments. Uses AI-powered intent detection, lead scoring, and configurable quality thresholds.

### Key Features

- ✅ **Minimal Input Schema** - Only 4 parameters (1 required, 3 optional)
- ✅ **TypeScript Strict Mode** - Full type safety and compile-time validation
- ✅ **Production Logging** - Structured JSON logs with request IDs
- ✅ **Fail-Fast Validation** - Early input validation with clear error messages
- ✅ **Default Values** - Sensible defaults for all optional parameters
- ✅ **Cost Optimization** - Early stopping when target leads reached

---

## 📋 Input Schema

### Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `postUrls` | `string[]` | Instagram post or reel URLs | `["https://www.instagram.com/p/ABC123/"]` |

### Optional Fields with Defaults

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `maxCommentsPerPost` | `number` | `1000` | 10-10000 | Max comments to fetch per post |
| `targetLeads` | `number` | `50` | 1-1000 | Stop processing when this many leads found |
| `minLeadScore` | `number` | `0.4` | 0.0-1.0 | Minimum quality score to include lead |

---

## 📥 Example Input

```json
{
  "postUrls": [
    "https://www.instagram.com/p/C3xYz1234Ab/",
    "https://www.instagram.com/reel/C3xYz5678Cd/"
  ],
  "maxCommentsPerPost": 500,
  "targetLeads": 30,
  "minLeadScore": 0.5
}
```

**Minimal valid input:**
```json
{
  "postUrls": ["https://www.instagram.com/p/ABC123/"]
}
```

---

## 📤 Example Output

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
  "postedAt": "2024-02-09T14:23:11Z",
  "extractedAt": "2024-02-09T15:30:45Z"
}
```

---

## 🚀 Quick Start

### Run on Apify Platform

1. Navigate to [Apify Console](https://console.apify.com)
2. Create new Actor run
3. Configure input parameters
4. Click **Start** and download results

### Run Locally

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run Actor
npm start

# Development mode (auto-rebuild)
npm run dev
```

---

## 🏗️ Project Structure

```
.
├── .actor/
│   ├── actor.json           # Actor metadata
│   └── input_schema.json    # Minimal JSON schema
├── src/
│   ├── index.ts             # Main entry point
│   ├── inputValidator.ts    # Input validation logic
│   └── types/
│       ├── Input.ts         # Input schema types
│       └── Output.ts        # Output schema types
├── dist/                    # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🔧 Development

### Build System

```bash
# Clean build directory
npm run clean

# Compile TypeScript
npm run build

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

### TypeScript Configuration

- **Strict Mode**: ✅ Enabled
- **Target**: ES2022
- **Module**: CommonJS (for Apify compatibility)
- **Source Maps**: ✅ Generated
- **Output**: `dist/` directory

---

## 📊 Input Validation

### URL Validation

✅ Valid formats:
```
https://www.instagram.com/p/ABC123/
https://instagram.com/reel/XYZ789/
https://www.instagram.com/p/ABC123
```

❌ Invalid formats:
```
instagram.com/p/ABC123/          (missing protocol)
https://www.instagram.com/user/  (profile URL, not post)
https://twitter.com/status/123   (wrong platform)
```

### Error Handling

The Actor **fails fast** on validation errors:

```typescript
// Missing required field
throw new Error('Input field "postUrls" is required');

// Invalid URL format
throw new Error('No valid Instagram post or reel URLs provided');

// Out of range value
log.warning('maxCommentsPerPost exceeds maximum. Using 10000.');
```

---

## 🔍 How It Works

1. **Input Loading**: Actor loads input via `Actor.getInput()`
2. **Validation**: Strict validation with pattern matching and range checks
3. **Normalization**: Apply defaults for optional fields
4. **Logging**: Log configuration in structured JSON format
5. **Processing**: Fetch comments and apply lead scoring
6. **Early Stop**: Stop when `targetLeads` reached
7. **Output**: Push results to Apify Dataset

---

## 🎯 Default Behavior

When you provide only `postUrls`:

```json
{
  "postUrls": ["https://www.instagram.com/p/ABC123/"]
}
```

The Actor automatically uses:
- `maxCommentsPerPost`: 1000
- `targetLeads`: 50
- `minLeadScore`: 0.4 (includes medium & high quality leads)

---

## 📈 Cost Optimization

### Early Stopping

Processing stops automatically when `targetLeads` is reached:

```typescript
if (leadsFound >= input.targetLeads) {
  log.info('Target leads reached. Stopping early.');
  break;
}
```

### Comment Limits

Control costs by adjusting `maxCommentsPerPost`:

| Comments | Processing Time | Estimated Cost |
|----------|----------------|----------------|
| 100      | ~30 seconds    | $0.05          |
| 500      | ~2 minutes     | $0.20          |
| 1000     | ~4 minutes     | $0.40          |
| 5000     | ~20 minutes    | $2.00          |

---

## 🔐 Environment Variables

No required environment variables for basic usage. Optional:

```env
# Logging
LOG_LEVEL=info              # debug, info, warn, error
APIFY_LOG_FORMAT=json       # json or text

# Actor runtime
APIFY_HEADLESS=1            # Run browser in headless mode
APIFY_DEFAULT_DATASET_ID    # Auto-configured by Apify
```

---

## 🐛 Troubleshooting

### Common Errors

**Error: "No input provided"**
```bash
Solution: Ensure INPUT.json exists or provide input via Apify Console
```

**Error: "No valid Instagram post URLs"**
```bash
Solution: Check URL format matches: https://www.instagram.com/p/ABC123/
```

**Build fails: "Cannot find module './types/Input.js'"**
```bash
Solution: Run `npm run build` before `npm start`
```

---

## 📚 API Reference

### `validateAndNormalizeInput(input: unknown): NormalizedInput`

Validates and normalizes raw Actor input.

**Throws:**
- `Error` if required fields missing
- `Error` if URL format invalid
- `Error` if array length constraints violated

**Returns:** `NormalizedInput` with all defaults applied

---

## 🔄 Migration from v1.x

**Changes in v2.0:**

1. ❌ **Removed** 25+ enterprise fields (webhooks, AI config, caching, etc.)
2. ✅ **Added** TypeScript strict mode
3. ✅ **Simplified** to 4 input parameters
4. ✅ **Improved** validation and error messages
5. ✅ **Changed** `start` script to run compiled `dist/index.js`

**Breaking changes:**
- Input schema now requires URL pattern validation
- No backward compatibility with v1.x schemas
- Must rebuild with `npm run build` before running

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 🤝 Support

- **Issues**: [GitHub Issues](https://github.com/your-org/ig-comment-lead/issues)
- **Docs**: [Apify Documentation](https://docs.apify.com)
- **Community**: [Apify Discord](https://discord.com/invite/jyEM2PRvMU)

---

**Built with ❤️ using TypeScript + Apify SDK**

[🚀 Try on Apify](https://console.apify.com) | [📖 View Source](https://github.com/your-org/ig-comment-lead)
