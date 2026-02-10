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
 *
 * v2.1 additions (lead gen value layer):
 *   - Every lead record now includes sentiment scoring (positive/negative/neutral)
 *     and a sentiment_score confidence value (0–1).
 *   - Commercial score derived from intent weight + sentiment alignment.
 *   - A full analytics summary is pushed as the final dataset item, covering:
 *       top commenters, intent distribution, sentiment distribution,
 *       top keywords, hourly comment trend, per-post breakdown,
 *       and quality bucket counts (HIGH / MEDIUM / LOW).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Actor } from 'apify';
import { type HttpCrawlingContext, log, gotScraping } from 'crawlee';
import type { NormalizedInput } from './types/Input.js';
import { validateInput as validateInputImpl } from './core/InputValidator.js';
import { parsePost, extractShortcode } from './extraction/InstagramParser.js';
import {
  buildInstagramHeaders as buildInstagramHeadersImpl,
  fetchGraphqlComments as fetchGraphqlCommentsImpl,
  maskSessionId as maskSessionIdImpl,
  toInstagramApiUrl as toInstagramApiUrlImpl,
} from './extraction/InstagramApi.js';
import { scoreLead as scoreLeadImpl } from './intelligence/LeadScorer.js';
import { buildLead } from './intelligence/LeadEnricher.js';
import { scoreSentiment } from './intelligence/SentimentScorer.js';
import { buildSummary, type LeadRecord } from './intelligence/AnalyticsAggregator.js';
import { createCrawler } from './core/CrawlerFactory.js';
import type { Lead } from './types/Lead.js';

// ── structured pre-init logger ───────────────────────────────────────────

function emit(
  level: 'INFO' | 'FATAL',
  msg: string,
  data?: Record<string, unknown>,
): void {
  const entry = { level, ts: new Date().toISOString(), msg, ...data };
  (level === 'FATAL' ? console.error : console.log)(JSON.stringify(entry));
}

// ── boot-time sanity checks ──────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const distEntry = join(PROJECT_ROOT, 'dist', 'index.js');
if (!existsSync(distEntry)) {
  emit('FATAL', 'BUILD_MISSING', {
    error: 'dist/index.js not found on disk.',
    resolution: 'Run "npm run build" before starting the Actor.',
    checked: distEntry,
  });
  process.exit(1);
}

const peerArtifact = join(__dirname, 'types', 'Input.js');
if (!existsSync(peerArtifact)) {
  emit('FATAL', 'BUILD_INCOMPLETE', {
    error: 'dist/types/Input.js is missing — build output is incomplete.',
    resolution: 'Delete dist/ and run "npm run build".',
    checked: peerArtifact,
  });
  process.exit(1);
}

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

emit('INFO', 'Boot', {
  nodeVersion: process.version,
  buildVersion: BUILD_VERSION,
  pid: process.pid,
  platform: process.platform,
  cwd: process.cwd(),
});


// ── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<{
  postsProcessed: number;
  totalComments: number;
  totalLeads: number;
  leads: Lead[];
}> {
  const raw: unknown = await Actor.getInput();
  const input = validateInput(raw);

  log.info('Input validated', {
    buildVersion: BUILD_VERSION,
    postUrls: input.postUrls,
    postUrlCount: input.postUrls.length,
    sessionIdMasked: maskSessionId(input.sessionId),
    debugComments: input.debugComments,
    maxCommentsPerPost: input.maxCommentsPerPost,
    targetLeads: input.targetLeads,
    minLeadScore: input.minLeadScore,
  });

  log.info('Authenticated mode active', {
    sessionIdMasked: maskSessionId(input.sessionId),
  });

  const result = await processLeads(input);

  const comments = Array.isArray(result.comments) ? result.comments : [];
  const leads = Array.isArray(result.leads) ? result.leads : [];

  log.info('About to push dataset', {
    commentsCount: comments.length,
    leadsCount: leads.length,
  });

  try {
    await Actor.pushData({
      meta: {
        postUrl: result.postUrls,
        totalComments: result.totalComments,
        totalLeads: result.totalLeads,
      },
      comments,
      leads,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Dataset push failed', { error: msg });
    await Actor.pushData(comments);
    await Actor.pushData(leads);
  }

  const outputObject = {
    postsProcessed: result.postsProcessed,
    totalComments: result.totalComments,
    totalLeads: result.totalLeads,
    leads,
  };
  await Actor.setValue('RESULT', outputObject);

  log.info('Dataset pushed', { comments: comments.length, leads: leads.length });

  await Actor.exit();
  log.info('Actor finished', { buildVersion: BUILD_VERSION });

  return outputObject;
}

// ── enriched lead type ────────────────────────────────────────────────────


// ── business logic ────────────────────────────────────────────────────────

async function processLeads(input: NormalizedInput): Promise<{
  postUrls: string[];
  postsProcessed: number;
  totalComments: number;
  totalLeads: number;
  comments: Array<{ url: string; username: string; text: string }>;
  leads: Lead[];
}> {
  log.info('Lead pipeline started', { urlCount: input.postUrls.length });

  const requestQueue = await Actor.openRequestQueue();

  let totalComments = 0;
  let totalLeads = 0;
  let commentsPushed = 0;
  let leadsPushed = 0;
  let postsPushed = 0;
  let targetReached = false;
  let status: 'success' | 'failed' = 'success';
  let failureReason: string | undefined;

  let crawler: ReturnType<typeof createCrawler> | null = null;
  const queuedUrls: string[] = [];
  const perPostMeta: Array<Record<string, unknown>> = [];
  const allComments: Array<{ url: string; username: string; text: string }> = [];
  const allLeads: Lead[] = [];

  // Collect ALL scored records (not just qualifying leads) for analytics
  const allScoredRecords: LeadRecord[] = [];
  const qualifiedLeadRecords: LeadRecord[] = [];

  let finalResult: {
    postUrls: string[];
    postsProcessed: number;
    totalComments: number;
    totalLeads: number;
    comments: Array<{ url: string; username: string; text: string }>;
    leads: Lead[];
  } = {
    postUrls: input.postUrls,
    postsProcessed: 0,
    totalComments: 0,
    totalLeads: 0,
    comments: [],
    leads: [],
  };

  try {
    const proxyConfiguration = await Actor.createProxyConfiguration({
      groups: ['RESIDENTIAL'],
    });

    crawler = createCrawler({
      proxyConfiguration,
      requestQueue,
      maxConcurrency: 4,
      maxRequestsPerMinute: 20,
      maxRequestRetries: 5,
      retryOnBlocked: true,
      requestHandlerTimeoutSecs: 60,
      preNavigationHooks: [
        ({ request }) => {
          request.headers = {
            ...(request.headers ?? {}),
            ...buildInstagramHeaders(input.sessionId),
          };
        },
      ],
      requestHandler: async ({
        request,
        body,
        response,
        proxyInfo,
      }: HttpCrawlingContext) => {
        if (targetReached) return;

        const rawBody = typeof body === 'string' ? body : body?.toString() ?? '';
        const statusCode = response?.statusCode ?? null;
        const location = response?.headers?.location;
        const isLoginRedirect = typeof location === 'string' && location.includes('login');
        const blocked =
          statusCode === 403 || statusCode === 429 || (statusCode === 302 && isLoginRedirect);

        if (blocked) {
          log.warning('Blocked response detected', {
            url: request.url,
            statusCode,
            location: location ?? null,
            proxyUrl: proxyInfo?.url ?? null,
            responseHeaders: response?.headers ?? null,
          });
        }

        const responseBytes =
          typeof body === 'string'
            ? Buffer.byteLength(body)
            : body
              ? body.length
              : 0;
        log.info('HTTP response', {
          url: request.url,
          statusCode,
          responseBytes,
        });

        const sourceUrl = (request.userData?.sourceUrl as string | undefined) ?? request.url;
        const { post, comments } = parsePost(rawBody);

        if (comments.length === 0) {
          const key = `DEBUG_HTML_${request.userData.shortcode || 'unknown'}`;
          await Actor.setValue(key, rawBody, { contentType: 'text/html' });
          log.warning(`Zero comments found. Saved HTML to Key-Value Store: ${key}`);
        }

        const shortcode = extractShortcode(sourceUrl);
        let finalComments = comments;

        if (finalComments.length === 0 && shortcode) {
          const graphqlComments = await fetchGraphqlComments({
            shortcode,
            maxComments: input.maxCommentsPerPost,
            sessionId: input.sessionId,
            proxyConfiguration,
          });
          if (graphqlComments.length > 0) {
            log.info('GraphQL fallback returned comments', {
              url: sourceUrl,
              count: graphqlComments.length,
            });
            finalComments = graphqlComments;
          }
        }

        log.info('Handling request', {
          url: request.url,
          sourceUrl,
          uniqueKey: request.uniqueKey,
        });

        const limitedComments = finalComments.slice(0, input.maxCommentsPerPost);
        totalComments += limitedComments.length;

        log.info('Comments scraped', {
          url: sourceUrl,
          count: limitedComments.length,
          totalComments,
        });

        if (limitedComments.length > 0) {
          const rawCommentRecords = limitedComments.map((comment) => ({
            type: 'comment',
            url: sourceUrl,
            username: comment.username,
            text: comment.text,
          }));
          allComments.push(
            ...rawCommentRecords.map((r) => ({
              url: r.url,
              username: r.username,
              text: r.text,
            })),
          );
          if (input.debugComments) {
            await Actor.pushData(rawCommentRecords);
            commentsPushed += rawCommentRecords.length;
          }
        }

        if (post) {
          const postRecord = {
            type: 'post',
            url: sourceUrl,
            ...post,
            commentCount: limitedComments.length,
          };
          perPostMeta.push(postRecord);
          await Actor.pushData(postRecord);
          postsPushed += 1;
        }

        for (const comment of limitedComments) {
          if (targetReached) break;

          // ── score intent ─────────────────────────────────────────────
          const scored = scoreLead(comment.text);

          // ── score sentiment (always, for analytics coverage) ─────────
          const sentimentResult = scoreSentiment(comment.text);

          // Accumulate every record for analytics regardless of score gate
          allScoredRecords.push({
            url: sourceUrl,
            username: comment.username,
            text: comment.text,
            score: scored.score,
            intent: scored.intent,
            matched_keywords: scored.matched_keywords,
            sentiment: sentimentResult.sentiment,
            sentiment_score: sentimentResult.sentiment_score,
          });

          if (scored.score >= input.minLeadScore) {
            qualifiedLeadRecords.push({
              url: sourceUrl,
              username: comment.username,
              text: comment.text,
              score: scored.score,
              intent: scored.intent,
              matched_keywords: scored.matched_keywords,
              sentiment: sentimentResult.sentiment,
              sentiment_score: sentimentResult.sentiment_score,
            });
          }

          if (scored.score < input.minLeadScore) continue;

          totalLeads += 1;

          const lead: Lead = buildLead({
            username: comment.username,
            text: comment.text,
            score: scored,
            sentiment: sentimentResult,
            minLeadScore: input.minLeadScore,
          });

          await Actor.pushData(lead);
          leadsPushed += 1;
          allLeads.push(lead);

          if (totalLeads >= input.targetLeads) {
            targetReached = true;
            crawler?.autoscaledPool?.abort();
            log.info('Target leads reached', { totalLeads });
          }
        }
      },
      failedRequestHandler: async ({ request }: HttpCrawlingContext) => {
        log.warning('Request failed', { url: request.url, uniqueKey: request.uniqueKey });
      },
    });

    if (!crawler) {
      throw new Error('CRAWLER_NOT_INITIALIZED: Expected a HttpCrawler instance.');
    }

    const requests = input.postUrls.map((url) => {
      const apiUrl = toInstagramApiUrl(url);
      return {
        url: apiUrl,
        label: 'POST_API',
        userData: { sourceUrl: url },
        headers: buildInstagramHeaders(input.sessionId),
      };
    });

    if (requests.length === 0) {
      throw new Error('NO_URLS_QUEUED: Input postUrls resolved to an empty queue.');
    }

    await crawler.addRequests(requests);
    for (const entry of requests) {
      queuedUrls.push(entry.url);
      log.info('Queued URL', { url: entry.url, sourceUrl: entry.userData?.sourceUrl });
    }

    await crawler.run();

    if (input.debugComments) {
      await Actor.pushData(allComments);
    }
    await Actor.pushData(allLeads);

    log.info('Lead generation complete', {
      queuedUrls: queuedUrls.length,
      totalComments,
      totalLeads,
      postsPushed,
      leadsPushed,
      commentsPushed,
    });

    finalResult = {
      postUrls: input.postUrls,
      postsProcessed: perPostMeta.length,
      totalComments,
      totalLeads,
      comments: input.debugComments ? allComments : [],
      leads: allLeads,
    };
  } catch (err: unknown) {
    status = 'failed';
    failureReason = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    // ── build and push analytics summary ─────────────────────────────
    const analyticsSummary = buildSummary(allScoredRecords, qualifiedLeadRecords);

    await Actor.pushData(analyticsSummary);

    log.info('Analytics summary pushed', {
      total_comments: analyticsSummary.total_comments_processed,
      total_leads: analyticsSummary.total_leads_found,
      lead_rate_pct: analyticsSummary.lead_rate_pct,
      avg_lead_score: analyticsSummary.avg_lead_score,
      top_keywords: analyticsSummary.top_keywords.slice(0, 5).map((k) => k.keyword),
      sentiment: analyticsSummary.sentiment_distribution,
    });

    log.info('Dataset item counts', {
      postsPushed,
      leadsPushed,
      commentsPushed,
    });

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

  return finalResult;
}

// ── thin wrappers (kept for testability) ─────────────────────────────────

function toInstagramApiUrl(url: string): string {
  return toInstagramApiUrlImpl(url);
}

function buildInstagramHeaders(sessionId: string): Record<string, string> {
  return buildInstagramHeadersImpl(sessionId);
}

function maskSessionId(sessionId: string): string {
  return maskSessionIdImpl(sessionId);
}

async function fetchGraphqlComments(params: {
  shortcode: string;
  maxComments: number;
  sessionId: string;
  proxyConfiguration: Awaited<ReturnType<typeof Actor.createProxyConfiguration>>;
}): Promise<Array<{ username: string; text: string }>> {
  return fetchGraphqlCommentsImpl({
    ...params,
    request: gotScraping,
    logger: log,
  });
}

function scoreLead(text: string): { score: number; intent: string; matched_keywords: string[] } {
  return scoreLeadImpl(text);
}

function validateInput(raw: unknown): NormalizedInput {
  return validateInputImpl(raw);
}

// ── bootstrap ────────────────────────────────────────────────────────────

Actor.main(async () => {
  try {
    return (await main()) as unknown as void;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Actor failed', { error: msg, buildVersion: BUILD_VERSION });
    throw err;
  }
}).catch((err: unknown) => {
  console.error('Unhandled:', err instanceof Error ? err.message : err);
  process.exit(1);
});
