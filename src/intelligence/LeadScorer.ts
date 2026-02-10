import { INTENT_KEYWORDS } from './dictionaries.js';

export type LeadScore = {
  score: number;
  intent: string;
  matched_keywords: string[];
};

export function scoreLead(text: string): LeadScore {
  const normalized = text.toLowerCase();
  const matched: string[] = [];
  let weight = 0;

  for (const [keyword, value] of Object.entries(INTENT_KEYWORDS)) {
    if (normalized.includes(keyword)) {
      matched.push(keyword);
      weight += value;
    }
  }

  const score = normalizeScore(weight, matched.length);
  const intent = score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low';

  return { score, intent, matched_keywords: matched };
}

function normalizeScore(weight: number, hits: number): number {
  if (hits === 0) return 0.1;
  if (weight >= 25 || hits >= 3) return 0.85;
  if (weight >= 15 || hits === 2) return 0.65;
  return 0.45;
}
