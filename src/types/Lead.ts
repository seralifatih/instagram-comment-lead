export type Lead = {
  username: string;
  profileUrl: string | null;
  bio: string | null;
  niche: string | null;
  geo: string | null;
  buyer_intent_score: number;
  likely_customer: boolean;
  engagement_score: number;
  extracted_keywords: string[];
};
