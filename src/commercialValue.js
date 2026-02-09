const BUSINESS_KEYWORDS = [
    'shop', 'store', 'agency', 'studio', 'official', 'boutique', 'brand',
    'media', 'design', 'digital', 'co', 'company', 'market', 'trade',
    'beauty', 'fashion', 'lux', 'retail', 'service', 'consult'
];

const LINK_PATTERNS = [
    /https?:\/\//i,
    /www\./i,
    /linktr\.ee/i,
    /linktree/i,
    /beacons\.ai/i,
    /taplink\.cc/i,
    /lnk\.bio/i,
    /bio\.site/i,
    /carrd\.co/i,
    /bit\.ly/i,
    /t\.co/i,
    /linkin\.bio/i,
    /flow\.page/i,
    /solo\.to/i
];

const WEBSITE_PATTERN = /\b[a-z0-9-]+\.(com|net|org|co|io|me|store|shop|app|ai|dev|info|biz|tv|uk|tr|in|es|de|fr|nl|ca|us|au)\b/i;

const CONTACT_PATTERNS = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /\+?\d[\d\s().-]{7,}\d/i,
    /whatsapp/i,
    /wa\.me/i,
    /api\.whatsapp\.com/i
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

function normalizeUsername(username) {
    return String(username || '')
        .toLowerCase()
        .replace(/[_\-.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function estimateCommercialValue(input = {}) {
    const username = normalizeUsername(input.username);
    const bio = normalize(input.bio);
    const followerCount = Number(input.followerCount);
    const engagementRatio = Number(input.engagementRatio);

    let score = 0;

    if (username && containsKeyword(username, BUSINESS_KEYWORDS)) {
        score += 0.2;
    }

    if (bio) {
        const hasContact = containsAny(bio, CONTACT_PATTERNS);
        const hasLink = containsAny(bio, LINK_PATTERNS) || WEBSITE_PATTERN.test(bio);
        const hasBusiness = containsKeyword(bio, BUSINESS_KEYWORDS);
        const hasEmail = /@/.test(bio) && /[a-z0-9._%+-]+@/i.test(bio);
        const hasWhatsApp = /whatsapp|wa\.me|api\.whatsapp\.com/i.test(bio);
        const hasPhone = /\+?\d[\d\s().-]{7,}\d/.test(bio);

        if (hasLink) score += 0.2;
        if (hasEmail) score += 0.2;
        if (hasWhatsApp) score += 0.15;
        if (hasPhone) score += 0.1;
        if (hasBusiness) score += 0.1;

        if (hasContact && score < 0.2) {
            score += 0.1;
        }
    }

    if (Number.isFinite(followerCount)) {
        if (followerCount > 100000) score += 0.25;
        else if (followerCount >= 10000) score += 0.2;
        else if (followerCount >= 1000) score += 0.1;
        else if (followerCount > 0) score += 0.05;
    }

    if (Number.isFinite(engagementRatio)) {
        if (engagementRatio >= 0.06) score += 0.2;
        else if (engagementRatio >= 0.03) score += 0.15;
        else if (engagementRatio >= 0.015) score += 0.1;
        else if (engagementRatio >= 0.005) score += 0.05;
    }

    const normalizedScore = Math.min(1, Math.max(0, score));
    return Math.round(normalizedScore * 1000) / 1000;
}
