export function textSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  const s1 = text1.toLowerCase();
  const s2 = text2.toLowerCase();

  const words1 = tokenize(s1);
  const words2 = tokenize(s2);

  const set1 = new Set(words1);
  const set2 = new Set(words2);

  let intersection = 0;
  for (const word of set1) {
    if (set2.has(word)) intersection++;
  }

  const union = set1.size + set2.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const lengthRatio =
    longer.length === 0
      ? 1
      : (longer.length - levenshteinDistance(longer, shorter)) / longer.length;

  return 0.6 * jaccard + 0.4 * lengthRatio;
}

function tokenize(text: string): string[] {
  return text
    .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

export function computeDuplicateScore(params: {
  textSim: number;
  distanceKm: number;
  timeDiffHours: number;
  categoryMatch: boolean;
  distanceThresholdKm: number;
  timeThresholdHours: number;
}): number {
  const {
    textSim,
    distanceKm,
    timeDiffHours,
    categoryMatch,
    distanceThresholdKm,
    timeThresholdHours,
  } = params;

  const distanceScore = Math.max(
    0,
    1 - distanceKm / distanceThresholdKm
  );
  const timeScore = Math.max(
    0,
    1 - timeDiffHours / timeThresholdHours
  );
  const categoryScore = categoryMatch ? 1 : 0.3;

  return (
    0.35 * textSim + 0.3 * distanceScore + 0.2 * timeScore + 0.15 * categoryScore
  );
}
