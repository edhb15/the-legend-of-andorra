/**
 * The cloud's timetable: fraction of Andorra's area covered after `days` days (0..14).
 * Day 1: only the outer edges · Days 2–4: outer valleys · 5–7: large parts of the countryside ·
 * 8–10: forests, villages and paths · 11–13: almost everything · 14: the whole country.
 */
export const DOOM_KEYFRAMES: [number, number][] = [[0, 0], [1, 0.03], [4, 0.2], [7, 0.45], [10, 0.7], [13, 0.93], [14, 1.0]];

export function coverageFraction(days: number): number {
  const pts = DOOM_KEYFRAMES;
  if (days <= 0) return 0;
  if (days >= 14) return 1;
  for (let i = 1; i < pts.length; i++) {
    if (days <= pts[i][0]) {
      const [d0, f0] = pts[i - 1], [d1, f1] = pts[i];
      return f0 + ((f1 - f0) * (days - d0)) / (d1 - d0);
    }
  }
  return 1;
}
