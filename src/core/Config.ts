/**
 * Strict TypeScript types for the Actor input schema.
 *
 * Source of truth: .actor/input_schema.json
 * Any change here MUST be reflected in the JSON schema and vice-versa.
 */

/** Raw input as received from Actor.getInput(). */
export interface InputSchema {
  /** Instagram post or reel URLs to analyse. */
  postUrls: string[];

  /** Instagram sessionid cookie value for authenticated scraping. */
  sessionId: string;

  /** Optional full Cookie header string (overrides sessionId-only cookie). */
  cookie?: string;

  /** Push raw comments to dataset for debugging. @default false */
  debugComments?: boolean;

  /** Max comments to fetch per post. @default 1000 */
  maxCommentsPerPost?: number;

  /** Stop after this many qualified leads. @default 50 */
  targetLeads?: number;

  /** Minimum lead-quality score (0–1) to include in results. @default 0.4 */
  minLeadScore?: number;
}

/**
 * Input with every optional field resolved to a concrete value.
 *
 * Derived from InputSchema via Required<> so the two can never drift:
 * adding an optional field to InputSchema automatically surfaces here.
 */
export type NormalizedInput = Required<InputSchema>;

/**
 * Defaults for optional fields.
 *
 * The `satisfies` clause is a compile-time sync guard:
 * adding an optional field to InputSchema without a matching default
 * here is an immediate type error.
 */
export const INPUT_DEFAULTS = {
  cookie: '',
  debugComments: false,
  maxCommentsPerPost: 1000,
  targetLeads: 50,
  minLeadScore: 0.4,
} as const satisfies Required<Omit<InputSchema, 'postUrls' | 'sessionId'>>;

/**
 * Validation constraints mirroring .actor/input_schema.json.
 *
 * Regex, min/max values must match the JSON schema exactly.
 */
export const INPUT_CONSTRAINTS = {
  postUrls: {
    minItems: 1,
    maxItems: 50,
    pattern: /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+\/?$/,
  },
  cookie: {},
  debugComments: {},
  maxCommentsPerPost: { min: 10, max: 10_000 },
  targetLeads: { min: 1, max: 1_000 },
  minLeadScore: { min: 0, max: 1 },
} as const;
