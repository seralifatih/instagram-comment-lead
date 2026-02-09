export function getFollowerBucketWeight(followerCount) {
    if (!Number.isFinite(followerCount)) return 0.1;
    if (followerCount < 1000) return 0.1;
    if (followerCount < 10000) return 0.3;
    if (followerCount < 100000) return 0.6;
    return 1.0;
}

export function getCommentLengthWeight(commentText) {
    if (!commentText) return 0.1;
    const length = String(commentText).trim().length;
    if (length < 20) return 0.1;
    if (length <= 100) return 0.5;
    return 1.0;
}

export function categorizeLeadScore(score) {
    if (score > 0.7) return 'HIGH';
    if (score >= 0.4) return 'MEDIUM';
    return 'LOW';
}

export function computeLeadScore(intentScore, followerCount, commentText) {
    const normalizedIntent = Math.max(0, Math.min(1, Number(intentScore) || 0));
    const followerWeight = getFollowerBucketWeight(followerCount);
    const lengthWeight = getCommentLengthWeight(commentText);

    const score = (normalizedIntent * 0.6) + (followerWeight * 0.2) + (lengthWeight * 0.2);
    const rounded = Math.round(score * 1000) / 1000;

    return {
        score: rounded,
        category: categorizeLeadScore(rounded)
    };
}
