import type { BucketSize } from "../types";

const TIERS: BucketSize[] = ["1m", "5m", "1h", "1d"];

// Picks a bucket size that renders as a readable trend rather than noise —
// e.g. 1m buckets over a 24h range would be 1,440 near-empty points. Only
// used to set the *default* for a given range; the user can still override
// it via the Bucket select.
//
// grouped escalates one tier: splitting the same range into several series
// (one line per service/level) means each series gets proportionally fewer
// logs per bucket, so the same bucket size that read fine ungrouped becomes
// a tangle of overlapping near-empty lines once grouped.
export function suggestBucket(rangeMs: number, grouped: boolean): BucketSize {
  const hour = 3_600_000;
  let tier = 0;
  if (rangeMs <= 2 * hour) tier = 0;
  else if (rangeMs <= 2 * 24 * hour) tier = 1;
  else if (rangeMs <= 30 * 24 * hour) tier = 2;
  else tier = 3;

  if (grouped) tier = Math.min(tier + 1, TIERS.length - 1);
  return TIERS[tier];
}
