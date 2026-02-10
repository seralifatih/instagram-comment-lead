/**
 * SentimentScorer — lightweight keyword-based sentiment analysis.
 *
 * Returns a sentiment label (positive / negative / neutral) plus a
 * confidence value (0–1) and the matched signal words so callers can
 * surface them in the UI without re-running analysis.
 *
 * Design rationale: no external ML dependency, works offline inside
 * Apify Docker images, deterministic, cheap to run per-comment.
 */

export type SentimentLabel = 'positive' | 'negative' | 'neutral';

export type SentimentResult = {
    /** Dominant sentiment bucket. */
    sentiment: SentimentLabel;
    /**
     * Confidence in the dominant label, 0–1.
     * 0.5 means equal positive/negative signals (still labelled neutral).
     */
    sentiment_score: number;
    /** Raw positive signal weight before normalisation. */
    positive_weight: number;
    /** Raw negative signal weight before normalisation. */
    negative_weight: number;
    /** Signal words that contributed to positive score. */
    positive_signals: string[];
    /** Signal words that contributed to negative score. */
    negative_signals: string[];
};

// ── signal dictionaries ───────────────────────────────────────────────────
// Weights reflect purchase-intent context (e.g. "love" matters more than
// "ok").  Turkish ASCII variants are included to match the existing
// dictionaries.ts pattern.

const POSITIVE_SIGNALS: Readonly<Record<string, number>> = {
    // Strong positive purchase signals
    love: 10, amazing: 10, perfect: 10, excellent: 10, outstanding: 9,
    'must have': 10, 'need this': 10, 'want this': 9, 'need one': 9,
    beautiful: 8, gorgeous: 8, stunning: 8, incredible: 8, fantastic: 8,
    awesome: 7, 'great product': 9, 'great quality': 9, 'best ever': 9,
    recommend: 8, recommended: 8, 'highly recommend': 10,
    // Moderate positive
    good: 5, nice: 5, cool: 5, like: 5, liked: 5, wonderful: 7,
    brilliant: 7, superb: 7, solid: 6, helpful: 6, useful: 6,
    // Turkish positive
    mukemmel: 10, harika: 9, guzel: 8, super: 8, cok iyi: 9,
    seviyorum: 10, sevdim: 8, begendim: 8, kaliteli: 9,
};

const NEGATIVE_SIGNALS: Readonly<Record<string, number>> = {
    // Strong negative signals
    scam: 12, fake: 11, fraud: 12, 'rip off': 11, ripoff: 11,
    terrible: 10, horrible: 10, awful: 10, disgusting: 10, worst: 10,
    'waste of money': 11, 'waste of time': 9, useless: 9, worthless: 10,
    'do not buy': 11, 'dont buy': 11, 'stay away': 10, avoid: 8,
    broken: 9, defective: 9, damaged: 9, 'never arrived': 10,
    // Moderate negative
    bad: 7, poor: 7, disappointing: 8, disappointed: 8, cheap: 6,
    overpriced: 8, slow: 5, late: 5, problem: 6, issue: 5, wrong: 6,
    misleading: 8, false: 7, lie: 8, lied: 8,
    // Turkish negative
    sahte: 11, dolandirici: 12, berbat: 10, rezalet: 10, kotu: 8,
    hayal: 7, aldatici: 9, yaniltici: 9,
};

// ── public API ────────────────────────────────────────────────────────────

/**
 * Score the sentiment of a single comment text.
 *
 * @param text - Raw comment text (any case, any language).
 * @returns SentimentResult with label, confidence, weights, and matched signals.
 */
export function scoreSentiment(text: string): SentimentResult {
    const normalised = text.toLowerCase();

    let positiveWeight = 0;
    let negativeWeight = 0;
    const positiveSignals: string[] = [];
    const negativeSignals: string[] = [];

    for (const [phrase, weight] of Object.entries(POSITIVE_SIGNALS)) {
        if (normalised.includes(phrase)) {
            positiveSignals.push(phrase);
            positiveWeight += weight;
        }
    }

    for (const [phrase, weight] of Object.entries(NEGATIVE_SIGNALS)) {
        if (normalised.includes(phrase)) {
            negativeSignals.push(phrase);
            negativeWeight += weight;
        }
    }

    const totalWeight = positiveWeight + negativeWeight;

    if (totalWeight === 0) {
        return {
            sentiment: 'neutral',
            sentiment_score: 0.5,
            positive_weight: 0,
            negative_weight: 0,
            positive_signals: [],
            negative_signals: [],
        };
    }

    const positiveRatio = positiveWeight / totalWeight;
    const negativeRatio = negativeWeight / totalWeight;

    let sentiment: SentimentLabel;
    let sentiment_score: number;

    if (positiveRatio > 0.6) {
        sentiment = 'positive';
        // Scale confidence: ratio 0.6 → score 0.6; ratio 1.0 → score 1.0
        sentiment_score = Math.min(1, 0.3 + positiveRatio * 0.7);
    } else if (negativeRatio > 0.6) {
        sentiment = 'negative';
        sentiment_score = Math.min(1, 0.3 + negativeRatio * 0.7);
    } else {
        // Mixed signals → neutral with moderate confidence
        sentiment = 'neutral';
        sentiment_score = 0.5;
    }

    return {
        sentiment,
        sentiment_score: parseFloat(sentiment_score.toFixed(3)),
        positive_weight: positiveWeight,
        negative_weight: negativeWeight,
        positive_signals: positiveSignals,
        negative_signals: negativeSignals,
    };
}