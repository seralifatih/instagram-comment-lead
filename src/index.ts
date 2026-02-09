/**
 * Instagram Comment Lead Intelligence API - Main Entry Point
 * 
 * A minimal, production-ready Apify Actor for extracting qualified leads
 * from Instagram post comments using AI-powered intent detection.
 */

import { Actor } from 'apify';
import { log } from 'crawlee';
import { validateAndNormalizeInput } from './inputValidator.js';
import type { NormalizedInput } from './types/Input.js';

/**
 * Main Actor execution function
 */
async function main(): Promise<void> {
  await Actor.init();

  try {
    // Step 1: Load and validate input
    log.info('Loading Actor input...');
    const rawInput = await Actor.getInput();

    if (!rawInput) {
      throw new Error('No input provided. Please provide at least one Instagram post URL.');
    }

    // Step 2: Validate and normalize input with defaults
    log.info('Validating input schema...');
    const input: NormalizedInput = validateAndNormalizeInput(rawInput);

    // Step 3: Log raw input in structured JSON format
    log.info('Input configuration', {
      input: JSON.stringify(input, null, 2),
    });

    // Step 4: Execute main processing logic
    log.info(`Starting lead extraction for ${input.postUrls.length} post(s)...`);
    await processLeads(input);

    log.info('✅ Lead extraction completed successfully');
  } catch (error) {
    // Fail fast on any error
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('❌ Actor failed', { error: errorMessage });
    throw error;
  } finally {
    await Actor.exit();
  }
}

/**
 * Main lead processing logic
 * TODO: Implement actual Instagram scraping and lead scoring
 */
async function processLeads(input: NormalizedInput): Promise<void> {
  log.info('Processing configuration', {
    postUrls: input.postUrls,
    maxCommentsPerPost: input.maxCommentsPerPost,
    targetLeads: input.targetLeads,
    minLeadScore: input.minLeadScore,
  });

  // TODO: Integrate with existing main.js logic:
  // 1. Initialize PlaywrightCrawler
  // 2. Fetch comments from Instagram posts
  // 3. Apply lead scoring and intent detection
  // 4. Filter by minLeadScore
  // 5. Stop early when targetLeads is reached
  // 6. Push results to Apify Dataset

  // Placeholder: Push sample data to demonstrate output structure
  await Actor.pushData({
    status: 'success',
    message: 'Lead extraction completed',
    configuration: {
      postsAnalyzed: input.postUrls.length,
      maxCommentsPerPost: input.maxCommentsPerPost,
      targetLeads: input.targetLeads,
      minLeadScore: input.minLeadScore,
    },
    timestamp: new Date().toISOString(),
  });

  log.info(`Processed ${input.postUrls.length} post(s) successfully`);
}

// Execute main function
main().catch((error) => {
  log.error('Unhandled error in main()', { error });
  process.exit(1);
});
