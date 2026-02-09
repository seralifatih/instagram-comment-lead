/**
 * Input validation and normalization utilities
 */

import { log } from 'crawlee';
import type { InputSchema, NormalizedInput } from './types/Input.js';
import { INPUT_DEFAULTS, INPUT_CONSTRAINTS } from './types/Input.js';

/**
 * Validates and normalizes Actor input
 * @throws Error if validation fails
 */
export function validateAndNormalizeInput(input: unknown): NormalizedInput {
  // Type guard: ensure input is an object
  if (!input || typeof input !== 'object') {
    throw new Error('Input must be a non-null object');
  }

  const rawInput = input as Partial<InputSchema>;

  // Validate required field: postUrls
  if (!rawInput.postUrls || !Array.isArray(rawInput.postUrls)) {
    throw new Error('Input field "postUrls" is required and must be an array');
  }

  if (rawInput.postUrls.length < INPUT_CONSTRAINTS.postUrls.minItems) {
    throw new Error(
      `postUrls must contain at least ${INPUT_CONSTRAINTS.postUrls.minItems} URL(s)`
    );
  }

  if (rawInput.postUrls.length > INPUT_CONSTRAINTS.postUrls.maxItems) {
    throw new Error(
      `postUrls must contain at most ${INPUT_CONSTRAINTS.postUrls.maxItems} URLs`
    );
  }

  // Validate each URL
  const validUrls: string[] = [];
  const invalidUrls: string[] = [];

  for (const url of rawInput.postUrls) {
    if (typeof url !== 'string') {
      invalidUrls.push(String(url));
      continue;
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      continue;
    }

    if (!INPUT_CONSTRAINTS.postUrls.pattern.test(trimmedUrl)) {
      invalidUrls.push(trimmedUrl);
      continue;
    }

    validUrls.push(trimmedUrl);
  }

  if (invalidUrls.length > 0) {
    log.warning(`Skipping ${invalidUrls.length} invalid URL(s): ${invalidUrls.slice(0, 3).join(', ')}${invalidUrls.length > 3 ? '...' : ''}`);
  }

  if (validUrls.length === 0) {
    throw new Error('No valid Instagram post or reel URLs provided. URLs must match pattern: https://www.instagram.com/p/ABC123/ or https://www.instagram.com/reel/ABC123/');
  }

  // Validate and normalize optional fields
  const maxCommentsPerPost = normalizeIntegerField(
    rawInput.maxCommentsPerPost,
    'maxCommentsPerPost',
    INPUT_DEFAULTS.maxCommentsPerPost,
    INPUT_CONSTRAINTS.maxCommentsPerPost.min,
    INPUT_CONSTRAINTS.maxCommentsPerPost.max
  );

  const targetLeads = normalizeIntegerField(
    rawInput.targetLeads,
    'targetLeads',
    INPUT_DEFAULTS.targetLeads,
    INPUT_CONSTRAINTS.targetLeads.min,
    INPUT_CONSTRAINTS.targetLeads.max
  );

  const minLeadScore = normalizeNumberField(
    rawInput.minLeadScore,
    'minLeadScore',
    INPUT_DEFAULTS.minLeadScore,
    INPUT_CONSTRAINTS.minLeadScore.min,
    INPUT_CONSTRAINTS.minLeadScore.max
  );

  const normalized: NormalizedInput = {
    postUrls: validUrls,
    maxCommentsPerPost,
    targetLeads,
    minLeadScore,
  };

  // Log normalized input in structured JSON format
  log.info('Input validation successful', {
    input: {
      postUrlsCount: normalized.postUrls.length,
      maxCommentsPerPost: normalized.maxCommentsPerPost,
      targetLeads: normalized.targetLeads,
      minLeadScore: normalized.minLeadScore,
    },
  });

  return normalized;
}

/**
 * Normalizes and validates an integer field
 */
function normalizeIntegerField(
  value: unknown,
  fieldName: string,
  defaultValue: number,
  min: number,
  max: number
): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  const num = Number(value);

  if (!Number.isFinite(num)) {
    log.warning(`Invalid ${fieldName}: ${value}. Using default: ${defaultValue}`);
    return defaultValue;
  }

  const intValue = Math.floor(num);

  if (intValue < min) {
    log.warning(`${fieldName} (${intValue}) is below minimum (${min}). Using minimum.`);
    return min;
  }

  if (intValue > max) {
    log.warning(`${fieldName} (${intValue}) exceeds maximum (${max}). Using maximum.`);
    return max;
  }

  return intValue;
}

/**
 * Normalizes and validates a number field
 */
function normalizeNumberField(
  value: unknown,
  fieldName: string,
  defaultValue: number,
  min: number,
  max: number
): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  const num = Number(value);

  if (!Number.isFinite(num)) {
    log.warning(`Invalid ${fieldName}: ${value}. Using default: ${defaultValue}`);
    return defaultValue;
  }

  if (num < min) {
    log.warning(`${fieldName} (${num}) is below minimum (${min}). Using minimum.`);
    return min;
  }

  if (num > max) {
    log.warning(`${fieldName} (${num}) exceeds maximum (${max}). Using maximum.`);
    return max;
  }

  return num;
}
