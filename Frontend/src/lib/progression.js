// Display-side copy of the on-chain progression rules (UserDatabase.sol).
// The contract is authoritative for level and earned UCN; these helpers only drive the UI
// (progress bars, "next level" hints). v1.0 computed rewards and claims here instead.

export const XP_PER_CONTRIBUTION = 50;
export const MAX_LEVEL = 100;
export const REVIEWER_XP = 21000; // level 20

// 21 titles, index = floor(level / 5); identical to v1.0's list (typo "Conquerer" fixed).
export const TITLES = [
  "Apprentice", "Aspiring", "Novice", "Enthusiastic", "Explorer",
  "Code Craftsman", "Skilled", "Proficient", "Champion", "Quality",
  "Expert", "Professional", "Innovative", "Veteran", "Rising",
  "Master", "Conqueror", "Top Tier", "Insightful", "Legendary", "Supreme",
];

export const xpForLevel = (n) => 50 * n * (n + 1);

export function levelForXp(xp) {
  const m = Math.floor(Math.max(0, xp) / XP_PER_CONTRIBUTION);
  const n = Math.floor((Math.floor(Math.sqrt(4 * m + 1)) - 1) / 2);
  return Math.min(MAX_LEVEL, n);
}

export const titleFor = (level) => TITLES[Math.min(Math.floor(level / 5), TITLES.length - 1)];
export const roleFor = (xp) => (xp >= REVIEWER_XP ? "Reviewer" : "Contributor");
export const rewardForLevel = (level) => (level <= 0 ? 0 : 5 * Math.pow(1.08, level));

export function progressToNext(xp) {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return { level, pct: 100, nextXp: null, remaining: 0 };
  const lo = xpForLevel(level), hi = xpForLevel(level + 1);
  return { level, pct: Math.min(100, ((xp - lo) / (hi - lo)) * 100), nextXp: hi, remaining: hi - xp };
}
