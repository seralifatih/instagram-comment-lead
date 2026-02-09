export interface CommercialValueInput {
  username?: string | null;
  bio?: string | null;
  followerCount?: number | null;
  engagementRatio?: number | null;
}

export function estimateCommercialValue(input: CommercialValueInput): number;
