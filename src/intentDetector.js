const DEFAULT_WEIGHTS = {
    'how much': 0.7,
    'price?': 0.7,
    'price': 0.6,
    'dm me': 0.6,
    'dm': 0.4,
    'where to buy': 0.75,
    'need this': 0.5,
    'interested': 0.5,
    'fiyat': 0.6,
    'ne kadar': 0.7,
    'fiyat nedir': 0.7,
    'nereden al': 0.65,
    'siparis': 0.6,
    'sipariş': 0.6,
    'stok var': 0.5,
    'link': 0.4
};

function normalizeText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function parseCustomWeights(customWeights) {
    if (customWeights && typeof customWeights === 'object') return customWeights;
    try {
        const raw = process.env.LEAD_INTENT_WEIGHTS;
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch {
        return null;
    }
    return null;
}

function mergeWeights(base, custom) {
    if (!custom) return base;
    return {
        ...base,
        ...custom
    };
}

export function detectIntent(commentText, customWeights) {
    const text = normalizeText(commentText);
    if (!text) return 0;

    const merged = mergeWeights(DEFAULT_WEIGHTS, parseCustomWeights(customWeights));

    let score = 0;
    let matched = 0;

    for (const [phrase, weight] of Object.entries(merged)) {
        if (!phrase) continue;
        if (text.includes(phrase)) {
            const w = Math.max(0, Math.min(1, Number(weight) || 0));
            score += w;
            matched += 1;
        }
    }

    if (matched === 0) return 0;
    const normalizedScore = Math.min(1, score / Math.max(1, matched));
    return Math.round(normalizedScore * 1000) / 1000;
}
