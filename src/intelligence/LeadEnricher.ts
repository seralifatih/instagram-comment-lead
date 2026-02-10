import type { Lead } from '../types/Lead.js';
import type { LeadScore } from './LeadScorer.js';
import type { SentimentResult } from './SentimentScorer.js';

export type BuildLeadParams = {
  username: string;
  text: string;
  score: LeadScore;
  sentiment?: SentimentResult;
  minLeadScore: number;
};

export function buildLead(params: BuildLeadParams): Lead {
  const { username, text, score, minLeadScore } = params;
  const profileUrl = username ? `https://www.instagram.com/${username}/` : null;

  const extracted_keywords = extractKeywords(text, score.matched_keywords);
  const niche = inferNiche(text, extracted_keywords);
  const geo = inferGeo(text);

  const buyer_intent_score = clamp(score.score, 0, 1);
  const engagement_score = computeEngagementScore(text);
  const likely_customer = buyer_intent_score >= Math.max(minLeadScore, 0.6);

  return {
    username,
    profileUrl,
    bio: null,
    niche,
    geo,
    buyer_intent_score,
    likely_customer,
    engagement_score,
    extracted_keywords,
  };
}

function computeEngagementScore(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;

  const lengthScore = Math.min(1, normalized.length / 120) * 0.5;
  let score = lengthScore;

  if (/[?]/.test(normalized)) score += 0.2;
  if (/[!]/.test(normalized)) score += 0.1;
  if (/@|\bdm\b|\bmessage\b/i.test(normalized)) score += 0.1;
  if (/\d/.test(normalized)) score += 0.1;
  if (/[^\x00-\x7F]/.test(normalized)) score += 0.05;

  return clamp(score, 0, 1);
}

function extractKeywords(text: string, matched: string[]): string[] {
  const tokens = (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(
    (t) => !STOPWORDS.has(t),
  );

  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }

  const topTokens = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token)
    .slice(0, 6);

  const combined = [...matched, ...topTokens];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const kw of combined) {
    const k = kw.trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(k);
  }

  return unique.slice(0, 10);
}

function inferNiche(text: string, keywords: string[]): string | null {
  const haystack = `${text.toLowerCase()} ${keywords.join(' ')}`;
  for (const [niche, terms] of Object.entries(NICHE_KEYWORDS)) {
    for (const term of terms) {
      if (haystack.includes(term)) return niche;
    }
  }
  return null;
}

function inferGeo(text: string): string | null {
  const lower = text.toLowerCase();
  for (const geo of GEO_KEYWORDS) {
    if (lower.includes(geo)) return GEO_LABELS[geo] ?? geo;
  }

  const fromMatch = lower.match(/\bfrom\s+([a-z][a-z\s]{2,30})/i);
  if (fromMatch?.[1]) return titleCase(fromMatch[1].trim());

  const inMatch = lower.match(/\bin\s+([a-z][a-z\s]{2,30})/i);
  if (inMatch?.[1]) return titleCase(inMatch[1].trim());

  return null;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => {
      const first = part.charAt(0);
      return first ? first.toUpperCase() + part.slice(1) : part;
    })
    .join(' ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, parseFloat(value.toFixed(3))));
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'have', 'your', 'you', 'are',
  'but', 'not', 'its', 'can', 'from', 'about', 'just', 'please', 'thanks',
  'thank', 'what', 'when', 'where', 'who', 'why', 'how', 'like', 'nice',
  'instagram', 'post', 'page', 'follow', 'following', 'follower', 'dm',
  'message', 'price', 'cost', 'order', 'buy', 'ship', 'shipping', 'info',
  'fiyat', 'ucret', 'kac', 'ne', 'kadar', 'siparis', 'bilgi', 'detay',
]);

const NICHE_KEYWORDS: Record<string, string[]> = {
  beauty: ['beauty', 'makeup', 'skincare', 'cosmetic', 'cosmetics', 'hair', 'nail'],
  fitness: ['gym', 'fitness', 'workout', 'protein', 'supplement', 'training'],
  fashion: ['fashion', 'style', 'dress', 'outfit', 'shirt', 'shoe', 'shoes'],
  food: ['food', 'restaurant', 'recipe', 'meal', 'cafe', 'coffee', 'kitchen'],
  travel: ['travel', 'trip', 'hotel', 'tour', 'vacation', 'flight'],
  tech: ['tech', 'software', 'app', 'website', 'iphone', 'android', 'laptop'],
  real_estate: ['real estate', 'property', 'house', 'apartment', 'rent'],
  ecommerce: ['price', 'buy', 'order', 'shop', 'shipping', 'ship'],
  education: ['course', 'class', 'learn', 'training', 'tutorial'],
};

const GEO_KEYWORDS = [
  'usa', 'united states', 'uk', 'united kingdom', 'canada', 'australia',
  'turkey', 'istanbul', 'ankara', 'izmir', 'london', 'manchester', 'dubai',
  'abu dhabi', 'new york', 'los angeles', 'california', 'texas', 'florida',
];

const GEO_LABELS: Record<string, string> = {
  usa: 'USA',
  uk: 'UK',
};
