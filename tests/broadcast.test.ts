import { describe, expect, it } from 'vitest';
import { hitStopSeconds } from '../src/game';

describe('hit-stop', () => {
  it('freezes a Tombstone-sized hit for 60 to 90 ms and ignores a wheel bump', () => {
    const tomb = hitStopSeconds('spinner', 32_000);
    expect(tomb).toBeGreaterThanOrEqual(0.06);
    expect(tomb).toBeLessThanOrEqual(0.09);
    expect(hitStopSeconds('spinner', 14_000)).toBe(0);
    expect(hitStopSeconds('ram', 80_000)).toBe(0);
    expect(hitStopSeconds('wall', 40_000)).toBe(0);
    expect(hitStopSeconds('landing', 40_000)).toBe(0);
    expect(hitStopSeconds('spinner', 80_000)).toBe(0.09);
    expect(hitStopSeconds('spinner', 80_000, true)).toBe(0);
  });
});
