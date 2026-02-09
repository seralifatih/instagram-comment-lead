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
    'satın al': 0.7,
    'satin al': 0.7,
    'sipariş': 0.6,
    'siparis': 0.6,
    'kargo': 0.5,
    'stok': 0.4,
    'precio': 0.6,
    'comprar': 0.7,
    'compra': 0.6,
    'cuanto': 0.6,
    'cuánto': 0.6,
    'pedido': 0.6,
    'envio': 0.5,
    'envío': 0.5,
    'कीमत': 0.6,
    'दाम': 0.6,
    'कितना': 0.6,
    'खरीद': 0.6,
    'खरीदना': 0.7,
    'ऑर्डर': 0.6,
    'डिलीवरी': 0.5,
    'order': 0.6,
    'in stock': 0.5,
    'available': 0.5,
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
    if (typeof customWeights === 'string') {
        try {
            const parsed = JSON.parse(customWeights);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch {
            return null;
        }
    }
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
