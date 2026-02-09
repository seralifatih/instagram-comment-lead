import assert from 'node:assert/strict';
import test from 'node:test';
import { detectIntent } from '../src/intentDetector.js';

test('detectIntent: weighted phrases (EN)', () => {
  const score = detectIntent('How much is this? price?');
  assert.ok(score >= 0.6);
});

test('detectIntent: weighted phrases (EN variant)', () => {
  const score = detectIntent('How much is the price?');
  assert.ok(score >= 0.6);
});

test('detectIntent: low signal', () => {
  const score = detectIntent('nice');
  assert.ok(score < 0.3);
});

// Custom weights
process.env.LEAD_INTENT_WEIGHTS = JSON.stringify({
  'interested': 0.9
});

test('detectIntent: custom weights override', () => {
  const score = detectIntent('interested');
  assert.ok(score >= 0.8);
});
