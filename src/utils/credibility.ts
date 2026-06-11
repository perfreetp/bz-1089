export type CredibilityLevel = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export function calculateCredibilityLevel(score: number): CredibilityLevel {
  if (score < 20) return 'VERY_LOW';
  if (score < 40) return 'LOW';
  if (score < 60) return 'MEDIUM';
  if (score < 80) return 'HIGH';
  return 'VERY_HIGH';
}

export function calculateInitialCredibility(params: {
  witnessCount: number;
  hasMedia: boolean;
  userReputation: number;
  locationDetail: number;
  descriptionLength: number;
  weatherReported: boolean;
}): number {
  let score = 0;

  score += Math.min(params.witnessCount * 5, 20);
  score += params.hasMedia ? 20 : 0;
  score += Math.min(Math.max(params.userReputation * 0.1, 0), 15);
  score += Math.min(params.locationDetail * 5, 10);
  score += Math.min(Math.floor(params.descriptionLength / 50), 15);
  score += params.weatherReported ? 5 : 0;
  score += 15;

  return Math.min(Math.max(score, 0), 100);
}

export function updateCredibilityOnAnalysis(
  currentScore: number,
  analysisConfidence: number,
  isPositive: boolean
): number {
  const delta = analysisConfidence * (isPositive ? 5 : -8);
  return Math.min(Math.max(currentScore + delta, 0), 100);
}

export function updateCredibilityOnReview(
  currentScore: number,
  isVerified: boolean
): number {
  const delta = isVerified ? 25 : -40;
  return Math.min(Math.max(currentScore + delta, 0), 100);
}
