/**
 * AnalyticsAggregator — builds the summary analytics record that is
 * pushed to the Apify Dataset at the end of a run.
 *
 * All computation is pure (no I/O, no side-effects) so it is trivially
 * testable.  The caller collects LeadRecord objects during scraping and
 * passes them to buildSummary() once the crawler finishes.
 */

import type { SentimentLabel } from './SentimentScorer.js';

// ── input type ────────────────────────────────────────────────────────────

/** Minimal fields needed from each processed comment / lead. */
export type LeadRecord = {
    url: string;
    username: string;
    text: string;
    score: number;
    intent: string;
    matched_keywords: string[];
    sentiment?: SentimentLabel;
    sentiment_score?: number;
    postedAt?: string; // ISO 8601
    likeCount?: number;
};

// ── output types ──────────────────────────────────────────────────────────

export type TopCommenter = {
    username: string;
    comment_count: number;
    avg_score: number;
    top_intent: string;
    top_sentiment: SentimentLabel | 'unknown';
};

export type IntentDistribution = {
    intent: string;
    count: number;
    pct: number;
};

export type SentimentDistribution = {
    positive: number;
    negative: number;
    neutral: number;
    positive_pct: number;
    negative_pct: number;
    neutral_pct: number;
};

export type KeywordTrend = {
    keyword: string;
    count: number;
    avg_score: number;
};

export type HourlyTrend = {
    hour: number; // 0–23 UTC
    count: number;
};

export type PostAnalytics = {
    url: string;
    total_comments: number;
    total_leads: number;
    avg_lead_score: number;
    top_intent: string;
    sentiment_distribution: SentimentDistribution;
};

export type AnalyticsSummary = {
    type: 'analytics_summary';
    generated_at: string;
    // volumes
    total_comments_processed: number;
    total_leads_found: number;
    lead_rate_pct: number;
    avg_lead_score: number;
    // top commenters
    top_commenters: TopCommenter[];
    // distributions
    intent_distribution: IntentDistribution[];
    sentiment_distribution: SentimentDistribution;
    // trends
    top_keywords: KeywordTrend[];
    hourly_trend: HourlyTrend[];
    // per-post
    per_post: PostAnalytics[];
    // quality buckets
    high_quality_leads: number; // score >= 0.7
    medium_quality_leads: number; // score 0.4–0.69
    low_quality_leads: number; // score < 0.4
};

// ── helpers ───────────────────────────────────────────────────────────────

function pct(part: number, total: number): number {
    if (total === 0) return 0;
    return parseFloat(((part / total) * 100).toFixed(1));
}

function avg(values: number[]): number {
    if (values.length === 0) return 0;
    return parseFloat((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3));
}

function mode<T>(arr: T[]): T | undefined {
    if (arr.length === 0) return undefined;
    const freq = new Map<T, number>();
    for (const item of arr) freq.set(item, (freq.get(item) ?? 0) + 1);
    let best: T | undefined;
    let bestCount = 0;
    for (const [item, count] of freq) {
        if (count > bestCount) { bestCount = count; best = item; }
    }
    return best;
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * Build a full analytics summary from the collected lead records.
 *
 * @param allRecords   Every comment scored during the run (leads AND non-leads).
 * @param leadRecords  Only the records that passed `minLeadScore`.
 */
export function buildSummary(
    allRecords: LeadRecord[],
    leadRecords: LeadRecord[],
): AnalyticsSummary {
    const total = allRecords.length;
    const totalLeads = leadRecords.length;

    // ── top commenters ────────────────────────────────────────────────────
    const byUser = new Map<string, LeadRecord[]>();
    for (const r of leadRecords) {
        const key = r.username || '__anonymous__';
        const existing = byUser.get(key) ?? [];
        existing.push(r);
        byUser.set(key, existing);
    }

    const topCommenters: TopCommenter[] = [...byUser.entries()]
        .map(([username, records]) => ({
            username,
            comment_count: records.length,
            avg_score: avg(records.map((r) => r.score)),
            top_intent: mode(records.map((r) => r.intent)) ?? 'unknown',
            top_sentiment: (mode(records.map((r) => r.sentiment ?? 'neutral')) as SentimentLabel | undefined) ?? 'unknown' as const,
        }))
        .sort((a, b) => b.avg_score - a.avg_score || b.comment_count - a.comment_count)
        .slice(0, 20);

    // ── intent distribution ───────────────────────────────────────────────
    const intentFreq = new Map<string, number>();
    for (const r of leadRecords) {
        intentFreq.set(r.intent, (intentFreq.get(r.intent) ?? 0) + 1);
    }
    const intentDistribution: IntentDistribution[] = [...intentFreq.entries()]
        .map(([intent, count]) => ({ intent, count, pct: pct(count, totalLeads) }))
        .sort((a, b) => b.count - a.count);

    // ── sentiment distribution ────────────────────────────────────────────
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;
    for (const r of leadRecords) {
        if (r.sentiment === 'positive') positiveCount++;
        else if (r.sentiment === 'negative') negativeCount++;
        else neutralCount++;
    }
    const sentimentDistribution: SentimentDistribution = {
        positive: positiveCount,
        negative: negativeCount,
        neutral: neutralCount,
        positive_pct: pct(positiveCount, totalLeads),
        negative_pct: pct(negativeCount, totalLeads),
        neutral_pct: pct(neutralCount, totalLeads),
    };

    // ── keyword trends ────────────────────────────────────────────────────
    const kwFreq = new Map<string, { count: number; scores: number[] }>();
    for (const r of leadRecords) {
        for (const kw of r.matched_keywords) {
            const entry = kwFreq.get(kw) ?? { count: 0, scores: [] };
            entry.count++;
            entry.scores.push(r.score);
            kwFreq.set(kw, entry);
        }
    }
    const topKeywords: KeywordTrend[] = [...kwFreq.entries()]
        .map(([keyword, { count, scores }]) => ({
            keyword,
            count,
            avg_score: avg(scores),
        }))
        .sort((a, b) => b.count - a.count || b.avg_score - a.avg_score)
        .slice(0, 20);

    // ── hourly trend ──────────────────────────────────────────────────────
    const hourFreq = new Array<number>(24).fill(0) as number[];
    for (const r of leadRecords) {
        if (r.postedAt) {
            const d = new Date(r.postedAt);
            if (!isNaN(d.getTime())) {
                const hour = d.getUTCHours();
                if (hour >= 0 && hour <= 23) {
                    (hourFreq as number[])[hour] = ((hourFreq as number[])[hour] ?? 0) + 1;
                }
            }
        }
    }
    const hourlyTrend: HourlyTrend[] = (hourFreq as number[]).map((count, hour) => ({ hour, count }));

    // ── per-post analytics ────────────────────────────────────────────────
    const byUrl = new Map<string, { all: LeadRecord[]; leads: LeadRecord[] }>();
    for (const r of allRecords) {
        const entry = byUrl.get(r.url) ?? { all: [], leads: [] };
        entry.all.push(r);
        byUrl.set(r.url, entry);
    }
    for (const r of leadRecords) {
        const entry = byUrl.get(r.url);
        if (entry) entry.leads.push(r);
    }

    const perPost: PostAnalytics[] = [...byUrl.entries()].map(([url, { all, leads }]) => {
        let pos = 0, neg = 0, neu = 0;
        for (const r of leads) {
            if (r.sentiment === 'positive') pos++;
            else if (r.sentiment === 'negative') neg++;
            else neu++;
        }
        return {
            url,
            total_comments: all.length,
            total_leads: leads.length,
            avg_lead_score: avg(leads.map((r) => r.score)),
            top_intent: mode(leads.map((r) => r.intent)) ?? 'none',
            sentiment_distribution: {
                positive: pos, negative: neg, neutral: neu,
                positive_pct: pct(pos, leads.length),
                negative_pct: pct(neg, leads.length),
                neutral_pct: pct(neu, leads.length),
            },
        };
    });

    // ── quality buckets ───────────────────────────────────────────────────
    const highQuality = leadRecords.filter((r) => r.score >= 0.7).length;
    const mediumQuality = leadRecords.filter((r) => r.score >= 0.4 && r.score < 0.7).length;
    const lowQuality = leadRecords.filter((r) => r.score < 0.4).length;

    return {
        type: 'analytics_summary',
        generated_at: new Date().toISOString(),
        total_comments_processed: total,
        total_leads_found: totalLeads,
        lead_rate_pct: pct(totalLeads, total),
        avg_lead_score: avg(leadRecords.map((r) => r.score)),
        top_commenters: topCommenters,
        intent_distribution: intentDistribution,
        sentiment_distribution: sentimentDistribution,
        top_keywords: topKeywords,
        hourly_trend: hourlyTrend,
        per_post: perPost,
        high_quality_leads: highQuality,
        medium_quality_leads: mediumQuality,
        low_quality_leads: lowQuality,
    };
}