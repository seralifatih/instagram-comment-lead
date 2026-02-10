import type { NormalizedInput } from './Config.js';
import { INPUT_CONSTRAINTS, INPUT_DEFAULTS } from './Config.js';

// Input validation (fail-fast, no external libs)
export function validateInput(raw: unknown): NormalizedInput {
  // must be a plain object
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

  // postUrls (required)
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

  // sessionId (required)
  const rawSessionId: unknown = obj['sessionId'];
  if (typeof rawSessionId !== 'string' || rawSessionId.trim().length === 0) {
    throw new Error(
      'INPUT_MISSING_FIELD: "sessionId" is required and must be a non-empty string.',
    );
  }
  const sessionId = rawSessionId.trim();

  const cookie = resolveString(
    obj['cookie'],
    'cookie',
    INPUT_DEFAULTS.cookie,
  );

  const debugComments = resolveBool(
    obj['debugComments'],
    'debugComments',
    INPUT_DEFAULTS.debugComments,
  );

  // optional numeric fields
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

  return {
    postUrls,
    sessionId,
    cookie,
    debugComments,
    maxCommentsPerPost,
    targetLeads,
    minLeadScore,
  };
}

// field resolvers

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

/** Resolve an optional boolean: missing → default, wrong type → throw. */
function resolveBool(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;

  if (typeof value !== 'boolean') {
    throw new Error(
      `INPUT_TYPE: "${name}" must be a boolean, received ${JSON.stringify(value)}.`,
    );
  }

  return value;
}

/** Resolve an optional string: missing → default, wrong type → throw. */
function resolveString(value: unknown, name: string, fallback: string): string {
  if (value === undefined || value === null) return fallback;

  if (typeof value !== 'string') {
    throw new Error(
      `INPUT_TYPE: "${name}" must be a string, received ${JSON.stringify(value)}.`,
    );
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}
