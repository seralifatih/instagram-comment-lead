const SPAM_PATTERNS = [
    /\bfollow me\b/i,
    /\bcheck my story\b/i,
    /\blink in bio\b/i,
    /\bdm me\b/i,
    /\bsubscribe\b/i
];

const GIVEAWAY_PATTERNS = [
    /\bgiveaway\b/i,
    /\bwin\b/i,
    /\bwinner\b/i,
    /\bfree\b/i,
    /\btag\b/i,
    /\bcomment\b/i
];

const GENERIC_PHRASES = new Set([
    'nice',
    'cool',
    'amazing',
    'great',
    'awesome',
    'love',
    'love it',
    'so good'
]);

const COPY_CACHE = new Map();
const MAX_COPY_CACHE = 50000;
const COPY_TTL_MS = 6 * 60 * 60 * 1000;

function normalizeText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function isEmojiOnly(text) {
    const stripped = text
        .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
        .replace(/\s+/g, '')
        .trim();
    return stripped.length === 0;
}

function isRepeatedChars(text) {
    return /(.)\1{4,}/.test(text);
}

function isGenericPhrase(text) {
    return GENERIC_PHRASES.has(text);
}

function matchesPatterns(text, patterns) {
    return patterns.some((pattern) => pattern.test(text));
}

function getCopyKey(text, username) {
    const base = `${username || ''}|${text}`;
    return base;
}

function checkRepeatedCopy(text, context) {
    if (!text) return false;
    const username = context?.username || '';
    const postShortcode = context?.postShortcode || '';
    if (!username || !postShortcode) return false;

    const key = getCopyKey(text, username);
    const now = Date.now();
    const entry = COPY_CACHE.get(key);
    if (entry && now - entry.ts < COPY_TTL_MS) {
        if (entry.shortcodes.has(postShortcode)) return false;
        entry.shortcodes.add(postShortcode);
        entry.ts = now;
        return true;
    }

    COPY_CACHE.set(key, { shortcodes: new Set([postShortcode]), ts: now });
    if (COPY_CACHE.size > MAX_COPY_CACHE) {
        COPY_CACHE.clear();
    }
    return false;
}

export function resetCommentQualityCache() {
    COPY_CACHE.clear();
}

export function assessCommentQuality(commentText, context = {}) {
    if (!commentText || typeof commentText !== 'string') {
        return { is_low_quality: true, reason: 'empty' };
    }

    const trimmed = commentText.trim();
    if (!trimmed) return { is_low_quality: true, reason: 'empty' };
    if (trimmed.length < 3) return { is_low_quality: true, reason: 'too_short' };

    const normalized = normalizeText(trimmed);

    if (isEmojiOnly(trimmed)) return { is_low_quality: true, reason: 'emoji_only' };
    if (isRepeatedChars(normalized)) return { is_low_quality: true, reason: 'repeated_chars' };
    if (isGenericPhrase(normalized)) return { is_low_quality: true, reason: 'generic_phrase' };
    if (matchesPatterns(normalized, SPAM_PATTERNS)) return { is_low_quality: true, reason: 'spam_phrase' };
    if (matchesPatterns(normalized, GIVEAWAY_PATTERNS)) return { is_low_quality: true, reason: 'giveaway_bot' };
    if (checkRepeatedCopy(normalized, context)) return { is_low_quality: true, reason: 'repeated_copy' };

    return { is_low_quality: false, reason: null };
}
