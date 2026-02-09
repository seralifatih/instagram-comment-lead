/**
 * Instagram Comment Lead Intelligence - Input Schema Types
 * 
 * This file defines the strict TypeScript interface matching the JSON schema
 * defined in .actor/input_schema.json
 */

/**
 * Main input schema interface for the Apify Actor
 */
export interface InputSchema {
  /**
   * List of Instagram post or reel URLs to analyze for leads
   * @minItems 1
   * @maxItems 50
   * @pattern ^https?://(www\.)?instagram\.com/(p|reel)/[A-Za-z0-9_-]+/?$
   */
  postUrls: string[];

  /**
   * Maximum number of comments to retrieve from each post
   * @default 1000
   * @minimum 10
   * @maximum 10000
   */
  maxCommentsPerPost?: number;

  /**
   * Target number of qualified leads to extract
   * Processing stops early when target is reached
   * @default 50
   * @minimum 1
   * @maximum 1000
   */
  targetLeads?: number;

  /**
   * Minimum lead quality score (0.0 to 1.0) required to include in results
   * @default 0.4
   * @minimum 0.0
   * @maximum 1.0
   */
  minLeadScore?: number;
}

/**
 * Input schema with all required defaults applied
 */
export interface NormalizedInput {
  postUrls: string[];
  maxCommentsPerPost: number;
  targetLeads: number;
  minLeadScore: number;
}

/**
 * Default values for optional input fields
 */
export const INPUT_DEFAULTS = {
  maxCommentsPerPost: 1000,
  targetLeads: 50,
  minLeadScore: 0.4,
} as const;

/**
 * Validation constraints
 */
export const INPUT_CONSTRAINTS = {
  postUrls: {
    minItems: 1,
    maxItems: 50,
    pattern: /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+\/?$/,
  },
  maxCommentsPerPost: {
    min: 10,
    max: 10000,
  },
  targetLeads: {
    min: 1,
    max: 1000,
  },
  minLeadScore: {
    min: 0.0,
    max: 1.0,
  },
} as const;
