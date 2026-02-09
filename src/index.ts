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
import { log } from 'crawlee';
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

  // TODO: integrate PlaywrightCrawler + scoring pipeline
}

// ── bootstrap ────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  console.error('Unhandled:', err instanceof Error ? err.message : err);
  process.exit(1);
});
