/**
 * Instagram Comment Lead Intelligence API — main entry point.
 *
 * Boot sequence (synchronous, before Actor.init):
 *   1. Verify build artifacts exist on disk    → FATAL if missing
 *   2. Read package version from package.json  → "unknown" on failure
 *   3. Log node version, build version, pid    → structured JSON to stdout
 *
 * Runtime sequence (async, after Actor.init):
 *   4. Actor.getInput  → validate  → log  → processLeads  → exit
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Actor } from 'apify';
import { HttpCrawler, log } from 'crawlee';
import type { NormalizedInput } from './types/Input.js';
import { INPUT_DEFAULTS, INPUT_CONSTRAINTS } from './types/Input.js';

// ── structured pre-init logger ───────────────────────────────────────────
// Before Actor.init(), crawlee's log isn't configured yet.  Emit newline-
// delimited JSON directly so Apify's log collector (and any external
// aggregator) can parse these boot lines without custom formatting.

function emit(
  level: 'INFO' | 'FATAL',
  msg: string,
  data?: Record<string, unknown>,
): void {
  const entry = { level, ts: new Date().toISOString(), msg, ...data };
  (level === 'FATAL' ? console.error : console.log)(JSON.stringify(entry));
}

// ── boot-time sanity checks ──────────────────────────────────────────────
// Run synchronously at module load, before any async work.  Goal: surface
// misconfiguration immediately instead of failing deep in the pipeline.

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// 1. Verify the compiled entrypoint exists at the expected path.
//    This catches wrong-cwd launches, missing builds, and Docker COPY
//    mistakes that would otherwise produce a cryptic MODULE_NOT_FOUND.
const distEntry = join(PROJECT_ROOT, 'dist', 'index.js');
if (!existsSync(distEntry)) {
  emit('FATAL', 'BUILD_MISSING', {
    error: 'dist/index.js not found on disk.',
    resolution: 'Run "npm run build" before starting the Actor.',
    checked: distEntry,
  });
  process.exit(1);
}

// 2. Verify peer build artifacts (catches partial / interrupted tsc).
const peerArtifact = join(__dirname, 'types', 'Input.js');
if (!existsSync(peerArtifact)) {
  emit('FATAL', 'BUILD_INCOMPLETE', {
    error: 'dist/types/Input.js is missing — build output is incomplete.',
    resolution: 'Delete dist/ and run "npm run build".',
    checked: peerArtifact,
  });
  process.exit(1);
}

// 3. Read build version from package.json (best-effort, never throws).
function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    return typeof pkg['version'] === 'string' ? pkg['version'] : 'unknown';
  } catch {
    return 'unknown';
  }
}

const BUILD_VERSION = readPackageVersion();

// 4. Log startup environment — every field is a first-class key so log
//    aggregators can filter runs by node version, build, etc.
emit('INFO', 'Boot', {
  nodeVersion: process.version,
  buildVersion: BUILD_VERSION,
  pid: process.pid,
  platform: process.platform,
  cwd: process.cwd(),
});

// ── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await Actor.init();

  try {
    // 1. Load raw input
    const raw: unknown = await Actor.getInput();

    // 2. Validate required fields, apply defaults, fail fast on mismatch
    const input = validateInput(raw);

    // 3. Structured log of validated input — every field a first-class key
    log.info('Input validated', {
      buildVersion: BUILD_VERSION,
      postUrls: input.postUrls,
      postUrlCount: input.postUrls.length,
      maxCommentsPerPost: input.maxCommentsPerPost,
      targetLeads: input.targetLeads,
      minLeadScore: input.minLeadScore,
    });

    // 4. Business logic
    await processLeads(input);

    log.info('Actor finished', { buildVersion: BUILD_VERSION });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Actor failed', { error: msg, buildVersion: BUILD_VERSION });
    throw err;
  } finally {
    await Actor.exit();
  }
}

// ── input validation (fail-fast, no external libs) ───────────────────────

function validateInput(raw: unknown): NormalizedInput {
  // ── must be a plain object ──────────────────────────────────────────
  if (raw === null || raw === undefined) {
    throw new Error(
      'INPUT_MISSING: No input provided. Supply at least { "postUrls": ["…"] }.',
    );
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      'INPUT_INVALID: Input must be a JSON object, received ' +
        (Array.isArray(raw) ? 'array' : typeof raw) +
        '.',
    );
  }

  const obj = raw as Record<string, unknown>;

  // ── postUrls (required) ─────────────────────────────────────────────
  const rawUrls: unknown = obj['postUrls'];

  if (!Array.isArray(rawUrls)) {
    throw new Error(
      'INPUT_MISSING_FIELD: "postUrls" is required and must be a string array.',
    );
  }

  if (rawUrls.length < INPUT_CONSTRAINTS.postUrls.minItems) {
    throw new Error(
      `INPUT_EMPTY: "postUrls" must contain at least ${INPUT_CONSTRAINTS.postUrls.minItems} URL.`,
    );
  }

  if (rawUrls.length > INPUT_CONSTRAINTS.postUrls.maxItems) {
    throw new Error(
      `INPUT_OVERFLOW: "postUrls" has ${rawUrls.length} items (max ${INPUT_CONSTRAINTS.postUrls.maxItems}).`,
    );
  }

  const postUrls: string[] = [];

  for (let i = 0; i < rawUrls.length; i++) {
    const entry: unknown = rawUrls[i];

    if (typeof entry !== 'string') {
      throw new Error(
        `INPUT_TYPE: postUrls[${i}] must be a string, received ${typeof entry}.`,
      );
    }

    const url = entry.trim();

    if (!INPUT_CONSTRAINTS.postUrls.pattern.test(url)) {
      throw new Error(
        `INPUT_PATTERN: postUrls[${i}] ("${url.slice(0, 120)}") is not a valid ` +
          'Instagram URL. Expected https://www.instagram.com/p/<code>/ or /reel/<code>/',
      );
    }

    postUrls.push(url);
  }

  // ── optional numeric fields ─────────────────────────────────────────
  const maxCommentsPerPost = resolveInt(
    obj['maxCommentsPerPost'],
    'maxCommentsPerPost',
    INPUT_DEFAULTS.maxCommentsPerPost,
    INPUT_CONSTRAINTS.maxCommentsPerPost,
  );

  const targetLeads = resolveInt(
    obj['targetLeads'],
    'targetLeads',
    INPUT_DEFAULTS.targetLeads,
    INPUT_CONSTRAINTS.targetLeads,
  );

  const minLeadScore = resolveNum(
    obj['minLeadScore'],
    'minLeadScore',
    INPUT_DEFAULTS.minLeadScore,
    INPUT_CONSTRAINTS.minLeadScore,
  );

  return { postUrls, maxCommentsPerPost, targetLeads, minLeadScore };
}

// ── field resolvers ──────────────────────────────────────────────────────

/** Resolve an optional integer: missing → default, wrong type or range → throw. */
function resolveInt(
  value: unknown,
  name: string,
  fallback: number,
  range: Readonly<{ min: number; max: number }>,
): number {
  if (value === undefined || value === null) return fallback;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `INPUT_TYPE: "${name}" must be a finite number, received ${JSON.stringify(value)}.`,
    );
  }

  const n = Math.floor(value);

  if (n < range.min || n > range.max) {
    throw new Error(
      `INPUT_RANGE: "${name}" must be between ${range.min} and ${range.max}, received ${n}.`,
    );
  }

  return n;
}

/** Resolve an optional float: missing → default, wrong type or range → throw. */
function resolveNum(
  value: unknown,
  name: string,
  fallback: number,
  range: Readonly<{ min: number; max: number }>,
): number {
  if (value === undefined || value === null) return fallback;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `INPUT_TYPE: "${name}" must be a finite number, received ${JSON.stringify(value)}.`,
    );
  }

  if (value < range.min || value > range.max) {
    throw new Error(
      `INPUT_RANGE: "${name}" must be between ${range.min} and ${range.max}, received ${value}.`,
    );
  }

  return value;
}

// ── business logic (stub) ────────────────────────────────────────────────

async function processLeads(input: NormalizedInput): Promise<void> {
  log.info('Lead pipeline started', { urlCount: input.postUrls.length });

  const requestQueue = await Actor.openRequestQueue();

  let totalComments = 0;
  let totalLeads = 0;
  let targetReached = false;
  let status: 'success' | 'failed' = 'success';
  let failureReason: string | undefined;

  let crawler: HttpCrawler | null = null;
  const queuedUrls: string[] = [];
  const perPostMeta: Array<Record<string, unknown>> = [];

  try {
    for (const url of input.postUrls) {
      const apiUrl = toInstagramApiUrl(url);
      await requestQueue.addRequest({ url: apiUrl, label: 'POST_API', userData: { sourceUrl: url } });
      queuedUrls.push(apiUrl);
      log.info('Queued URL', { url: apiUrl, sourceUrl: url });
    }

    if (queuedUrls.length === 0) {
      throw new Error('NO_URLS_QUEUED: Input postUrls resolved to an empty queue.');
    }

    crawler = new HttpCrawler({
      requestQueue,
      maxConcurrency: 4,
      requestHandlerTimeoutSecs: 60,
      requestHandler: async ({ request, body, contentType }) => {
        if (targetReached) return;

        const rawBody = typeof body === 'string' ? body : body.toString();
        const { post, comments } = extractInstagramData(rawBody, contentType);
        const sourceUrl = (request.userData?.sourceUrl as string | undefined) ?? request.url;

        const limitedComments = comments.slice(0, input.maxCommentsPerPost);
        totalComments += limitedComments.length;

        log.info('Comments scraped', {
          url: sourceUrl,
          count: limitedComments.length,
          totalComments,
        });

        if (post) {
          const postRecord = {
            type: 'post',
            url: sourceUrl,
            ...post,
            commentCount: limitedComments.length,
          };
          perPostMeta.push(postRecord);
          await Actor.pushData(postRecord);
        }

        for (const comment of limitedComments) {
          if (targetReached) break;

          const score = scoreLead(comment.text);
          if (score < input.minLeadScore) continue;

          totalLeads += 1;
          const lead = {
            type: 'lead',
            url: sourceUrl,
            username: comment.username,
            text: comment.text,
            score,
          };
          await Actor.pushData(lead);

          if (totalLeads >= input.targetLeads) {
            targetReached = true;
            crawler?.autoscaledPool?.abort();
            log.info('Target leads reached', { totalLeads });
          }
        }
      },
    });

    if (!crawler) {
      throw new Error('CRAWLER_NOT_INITIALIZED: Expected a HttpCrawler instance.');
    }

    await crawler.run();

    log.info('Lead generation complete', {
      queuedUrls: queuedUrls.length,
      totalComments,
      totalLeads,
    });
  } catch (err: unknown) {
    status = 'failed';
    failureReason = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await Actor.pushData({
      type: 'summary',
      status,
      failureReason,
      queuedUrls: queuedUrls.length,
      totalComments,
      totalLeads,
      postsProcessed: perPostMeta.length,
      targetLeads: input.targetLeads,
      minLeadScore: input.minLeadScore,
      completedAt: new Date().toISOString(),
    });
  }
}

function scoreLead(text: string): number {
  const normalized = text.toLowerCase();
  const keywords = [
    'price',
    'cost',
    'how much',
    'interested',
    'buy',
    'order',
    'details',
    'info',
    'dm',
    'message',
    'ship',
  ];
  let hits = 0;
  for (const keyword of keywords) {
    if (normalized.includes(keyword)) hits += 1;
  }
  if (hits === 0) return 0.1;
  if (hits === 1) return 0.45;
  if (hits === 2) return 0.65;
  return 0.85;
}

function toInstagramApiUrl(url: string): string {
  const trimmed = url.split('?')[0];
  if (trimmed.endsWith('/')) {
    return `${trimmed}?__a=1&__d=dis`;
  }
  return `${trimmed}/?__a=1&__d=dis`;
}

function extractInstagramData(
  body: string,
  contentType?: string,
): { post?: Record<string, unknown>; comments: Array<{ username: string; text: string }> } {
  const normalizedType = contentType?.toLowerCase() ?? '';
  if (normalizedType.includes('application/json') || normalizedType.includes('text/json')) {
    const parsed = safeJsonParse(body);
    return parsed ? parseInstagramJson(parsed) : { comments: [] };
  }

  const json = extractEmbeddedJson(body);
  if (json) return parseInstagramJson(json);

  return { comments: [] };
}

function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractEmbeddedJson(body: string): unknown | null {
  const sharedDataMatch = body.match(/window\._sharedData\s*=\s*(\{[\s\S]*?\});/);
  if (sharedDataMatch?.[1]) {
    return safeJsonParse(sharedDataMatch[1]);
  }

  const nextDataMatch = body.match(
    /<script type="application\/json" id="__NEXT_DATA__">([\s\S]*?)<\/script>/,
  );
  if (nextDataMatch?.[1]) {
    return safeJsonParse(nextDataMatch[1]);
  }

  const additionalDataMatch = body.match(
    /window\.__additionalDataLoaded\([^,]+,\s*([\s\S]*?)\);/,
  );
  if (additionalDataMatch?.[1]) {
    return safeJsonParse(additionalDataMatch[1]);
  }

  return null;
}

function parseInstagramJson(
  data: unknown,
): { post?: Record<string, unknown>; comments: Array<{ username: string; text: string }> } {
  const comments: Array<{ username: string; text: string }> = [];

  const media =
    (data as any)?.graphql?.shortcode_media ??
    (data as any)?.data?.shortcode_media ??
    (data as any)?.items?.[0] ??
    (data as any)?.props?.pageProps?.shortcode_media ??
    (data as any)?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media ??
    (data as any)?.entry_data?.PostPage?.[0]?.items?.[0];

  if (!media) {
    return { comments };
  }

  const post: Record<string, unknown> = {
    id: media.id ?? null,
    shortcode: media.shortcode ?? null,
    caption:
      media?.edge_media_to_caption?.edges?.[0]?.node?.text ??
      media?.caption?.text ??
      null,
    likeCount:
      media?.edge_media_preview_like?.count ??
      media?.like_count ??
      null,
    commentCount:
      media?.edge_media_to_parent_comment?.count ??
      media?.comment_count ??
      null,
    timestamp: media?.taken_at_timestamp ?? media?.taken_at ?? null,
    ownerUsername: media?.owner?.username ?? media?.user?.username ?? null,
  };

  const edges = media?.edge_media_to_parent_comment?.edges ?? media?.comments ?? [];
  for (const edge of edges) {
    const node = edge?.node ?? edge;
    const username = node?.owner?.username ?? node?.user?.username ?? '';
    const text = node?.text ?? '';
    if (username && text) comments.push({ username, text });
  }

  return { post, comments };
}

// ── bootstrap ────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  console.error('Unhandled:', err instanceof Error ? err.message : err);
  process.exit(1);
});
