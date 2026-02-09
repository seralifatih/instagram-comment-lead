/**
 * Instagram Comment Lead Intelligence - Output Schema Types
 */

/**
 * Lead intent classification
 */
export type LeadIntent =
  | 'BUY_INTENT'
  | 'QUESTION'
  | 'COMPLAINT'
  | 'PROMOTER_SPAM'
  | 'RANDOM';

/**
 * Lead quality category
 */
export type LeadCategory = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Lead type classification
 */
export type LeadType = 'BUY_INTENT' | 'QUESTION' | 'PROMOTER_SPAM' | 'RANDOM';

/**
 * Audience tier classification
 */
export type AudienceTier = 'HIGH_VALUE_AUDIENCE' | 'MID_VALUE_AUDIENCE' | 'LOW_VALUE_AUDIENCE';

/**
 * Follower count bucket
 */
export type FollowerBucket = '<1k' | '1k-10k' | '10k-100k' | '100k+';

/**
 * Lead record output
 */
export interface LeadOutput {
  /** Original Instagram post URL */
  postUrl: string;

  /** Instagram post shortcode */
  source_shortcode: string;

  /** Instagram username of commenter */
  username: string;

  /** Comment text content */
  text: string;

  /** Detected intent classification */
  intent: LeadIntent;

  /** Intent confidence score (0.0 to 1.0) */
  intent_score: number;

  /** Detected language code (e.g., 'en', 'es', 'tr') */
  detected_language: string;

  /** Whether this comment qualifies as a lead */
  is_lead: boolean;

  /** Extracted intent keywords */
  keywords: string[];

  /** Lead quality category */
  leadScore: LeadCategory;

  /** Lead type classification */
  lead_type: LeadType;

  /** Commercial value score (0.0 to 1.0) */
  commercial_score: number;

  /** Audience qualification details */
  audience_qualification: {
    followers: number | null;
    bucket: FollowerBucket | null;
    tier: AudienceTier;
  } | null;

  /** Number of comments from this user in dataset */
  user_comment_count: number;

  /** Instagram profile URL */
  profileUrl: string;

  /** Number of likes on the comment */
  likeCount: number;

  /** ISO timestamp when comment was posted */
  postedAt: string;

  /** ISO timestamp when data was extracted */
  extractedAt: string;
}

/**
 * Analytics summary output
 */
export interface AnalyticsSummary {
  /** Total comments processed */
  total_comments: number;

  /** Number of qualified leads found */
  leads_count: number;

  /** Number of high-intent leads */
  high_intent_leads: number;

  /** Number of high-value audience leads */
  high_value_leads: number;

  /** Intent distribution breakdown */
  intent_distribution: Record<string, number>;

  /** Top detected keywords */
  top_keywords: Array<{
    keyword: string;
    count: number;
  }>;

  /** Number of comments filtered out */
  filteredComments: number;

  /** Number of duplicate comments removed */
  duplicateComments: number;

  /** Number of LLM classifications performed */
  llmClassifications: number;
}
