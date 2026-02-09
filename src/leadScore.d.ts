export type LeadScoreCategory = 'LOW' | 'MEDIUM' | 'HIGH';

export interface LeadScoreResult {
  score: number;
  category: LeadScoreCategory;
}

export function getFollowerBucketWeight(followerCount: number | null | undefined): number;
export function getCommentLengthWeight(commentText: string | null | undefined): number;
export function categorizeLeadScore(score: number): LeadScoreCategory;
export function computeLeadScore(intentScore: number, followerCount: number | null | undefined, commentText: string | null | undefined): LeadScoreResult;
