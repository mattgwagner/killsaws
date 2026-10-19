// Pushing a robot into a hazard earns control by the second and damage by the joule the hazard took off.
import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { rosterById } from '../src/sim/roster';
import { FACES } from '../src/sim/bot';

const DT = 1 / 240;
const SCREW_WATTS = 1800;

/** DUCK! (red) sat on the west screw; Bite Force (blue) tapped out on the far side, so the
 * only control it can earn is hazard credit. Each tick Bite Force is the last robot to touch DUCK!. */
async function onTheScrews(seconds: number, prep?: (m: Match) => void) {
  const m = await Match.create([rosterById('duck')!, rosterById('bite-force')!], { humans: [true, true] });
  for (let i = 0; i < 240 * 3.2; i++) m.step();
  m.drainEvents();
  const [victim, pusher] = m.bots;
  pusher.tappedOut = true;
  pusher.body.setTranslation({ x: 3, y: 0.3, z: 4 }, true);
  const screw = m.layout.screws.find((s) => s.id === 'screw-w0')!;
  victim.body.setTranslation({ x: screw.x, y: 0.25, z: screw.z }, true);
  victim.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  prep?.(m);
  const touch = m as unknown as { lastTouch: (number | null)[]; lastTouchT: number[] };
  const before = { control: pusher.control, damage: pusher.damageDealt, hazard: pusher.hazardDamageDealt };
  for (let i = 0; i < 240 * seconds; i++) {
    touch.lastTouch[0] = 1;
    touch.lastTouchT[0] = m.time;
    m.step();
  }
  m.drainEvents();
  const r = {
    control: pusher.control - before.control,
    damage: pusher.damageDealt - before.damage,
    hazard: pusher.hazardDamageDealt - before.hazard,
  };
  m.dispose();
  return r;
}

describe('hazard credit', () => {
  it('3 s on the screws is at most 3 s of control, not one second per tick', async () => {
    const r = await onTheScrews(3);
    expect(r.hazard, 'DUCK! never reached the screw').toBeGreaterThan(0);
    // wall-clock bound: the pusher can't be credited more control than the time that passed
    expect(r.control).toBeLessThanOrEqual(3 + DT);
    // and it was credited for the time DUCK! was actually on it
    expect(r.control).toBeGreaterThan(0.5);
    // the screw delivers at most its power for the seconds credited
    expect(r.hazard).toBeLessThanOrEqual(SCREW_WATTS * r.control + 1e-6);
    expect(r.damage).toBeLessThanOrEqual(r.hazard);
  });

  it('a robot with no armour or internals left earns its pusher no hazard damage', async () => {
    const r = await onTheScrews(2, (m) => {
      const v = m.bots[0];
      for (const f of FACES) v.panels[f].integrity = 0;
      for (const k of Object.keys(v.internals) as (keyof typeof v.internals)[]) v.internals[k] = 0;
    });
    expect(r.hazard).toBe(0);
    expect(r.damage).toBe(0);
  });
});
