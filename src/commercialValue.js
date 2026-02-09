const BUSINESS_KEYWORDS = [
    'shop', 'store', 'agency', 'studio', 'official', 'boutique', 'brand',
    'media', 'design', 'digital', 'co', 'company', 'market', 'trade',
    'beauty', 'fashion', 'lux', 'retail', 'service', 'consult'
];

const LINK_PATTERNS = [
    /https?:\/\//i,
    /www\./i,
    /linktr\.ee/i,
    /beacons\.ai/i,
    /taplink\.cc/i,
    /lnk\.bio/i,
    /bio\.site/i,
    /carrd\.co/i
];

const CONTACT_PATTERNS = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /\+?\d[\d\s().-]{7,}\d/i,
    /whatsapp/i,
    /wa\.me/i
];

function normalize(text) {
    return String(text || '').toLowerCase();
}

function containsAny(text, patterns) {
    return patterns.some((pattern) => pattern.test(text));
}

function containsKeyword(text, keywords) {
    return keywords.some((keyword) => text.includes(keyword));
}

export function estimateCommercialValue(input = {}) {
    const username = normalize(input.username);
    const bio = normalize(input.bio);
    const followerCount = Number(input.followerCount);
    const engagementRatio = Number(input.engagementRatio);

    let score = 0;

    if (username && containsKeyword(username, BUSINESS_KEYWORDS)) {
        score += 0.15;
    }

    if (bio) {
        if (containsAny(bio, CONTACT_PATTERNS)) score += 0.25;
        if (containsAny(bio, LINK_PATTERNS)) score += 0.2;
        if (containsKeyword(bio, BUSINESS_KEYWORDS)) score += 0.1;
    }

    if (Number.isFinite(followerCount)) {
        if (followerCount > 100000) score += 0.25;
        else if (followerCount >= 10000) score += 0.2;
        else if (followerCount >= 1000) score += 0.1;
    }

    if (Number.isFinite(engagementRatio)) {
        if (engagementRatio >= 0.05) score += 0.15;
        else if (engagementRatio >= 0.02) score += 0.1;
        else if (engagementRatio >= 0.01) score += 0.05;
    }

    const normalizedScore = Math.min(1, Math.max(0, score));
    return Math.round(normalizedScore * 1000) / 1000;
}
