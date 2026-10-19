import { describe, expect, it } from 'vitest';
import { hazardLoss, opponentLaunch } from '../scripts/roundrobin';
import type { Fight } from '../scripts/roundrobin';

function fight(over: Partial<Fight['bots'][0]>, koReason = 'End Game is high-centred on the spiked rail'): Fight {
  const bot = {
    hazardBeforeCount: Infinity, untouchedAtHazard: 0, wallStuck: 0, untouchedAtCount: 9,
    spunBeforeContact: null, lastBlow: -99, leftFloorAt: -99, beachedAt: -99, ...over,
  };
  const other = { ...bot, untouchedAtCount: 0, lastBlow: -99, leftFloorAt: -99, beachedAt: -99 };
  return {
    ids: ['end-game', 'duck'], seed: 1, winner: 1, method: 'KO', time: 20,
    koReason, noContact: 0, bots: [bot, other],
  };
}

describe('self-inflicted hazard losses', () => {
  it('a beaching with nobody else involved stays self-inflicted', () => {
    const h = hazardLoss(fight({}), 0);
    expect(h.hazard).toBe(true);
    expect(h.launched).toBe(false);
    expect(h.self).toBe(true);
  });

  it('a hit in the 2s before it left the floor is the opponent\'s launch', () => {
    expect(opponentLaunch({ lastBlow: 10, leftFloorAt: 11.6, beachedAt: -99 })).toBe(true);
    const h = hazardLoss(fight({ lastBlow: 10, leftFloorAt: 11.6, untouchedAtHazard: 4, hazardBeforeCount: 1 }), 0);
    expect(h.launched).toBe(true);
    expect(h.self).toBe(false);
  });

  it('a hit in the 2s before it beached is the opponent\'s launch', () => {
    const h = hazardLoss(fight({ lastBlow: 8, beachedAt: 9.5 }), 0);
    expect(h.launched).toBe(true);
    expect(h.self).toBe(false);
  });

  it('a hit more than 2s before it left the floor is not that launch', () => {
    const h = hazardLoss(fight({ lastBlow: 4, leftFloorAt: 7.1, beachedAt: 8 }), 0);
    expect(h.launched).toBe(false);
    expect(h.self).toBe(true);
  });

  it('an opponent still on it when the hazard hit lands is not self-inflicted', () => {
    const h = hazardLoss(fight({ hazardBeforeCount: 0.4, untouchedAtHazard: 0.2, untouchedAtCount: 0.2 }), 0);
    expect(h.hazard).toBe(true);
    expect(h.self).toBe(false);
  });

  it('a judges decision is not a hazard loss', () => {
    const f = fight({});
    f.method = 'Judges';
    expect(hazardLoss(f, 0)).toEqual({ hazard: false, self: false, launched: false });
  });
});
