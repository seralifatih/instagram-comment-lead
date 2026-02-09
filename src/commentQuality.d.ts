export interface CommentQualityResult {
  is_low_quality: boolean;
  reason: string | null;
}

export interface CommentQualityContext {
  username?: string;
  postShortcode?: string;
}

export function assessCommentQuality(commentText: string, context?: CommentQualityContext): CommentQualityResult;
export function resetCommentQualityCache(): void;
