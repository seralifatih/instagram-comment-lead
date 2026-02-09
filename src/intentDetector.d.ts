export type IntentWeights = Record<string, number>;
export function detectIntent(commentText: string, customWeights?: IntentWeights): number;
