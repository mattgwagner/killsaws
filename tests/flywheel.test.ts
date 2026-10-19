// Flywheel flippers (Blip): no gas limit, a re-spin instead of a lockout, and
// a shot that carries only what the flywheel has stored when the trigger is pulled.
// Bounds are stated here, not derived from a run.
import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { rosterById } from '../src/sim/roster';
import { fitToWeight } from '../src/sim/design';

const RESPIN = 1.5; // s, Blip's stated re-spin to full flywheel speed

async function fight() {
  const m = await Match.create([rosterById('blip')!, rosterById('duck')!], { hazards: false, humans: [true, true] });
  while (m.phase !== 'fight') m.step(); // the flywheel starts spinning with the fight
  return m;
}
const run = (m: Match, seconds: number, weapon = false) => {
  for (let i = 0; i < Math.round(seconds * 240); i++) { m.setInput(0, { throttle: 0, turn: 0, weapon }); m.step(); }
};

/** Park DUCK! nose-to-nose on Blip's plate, wait `delay` s into the fight, fire once, return the flip's hit energy. */
async function flipEnergyAfter(delay: number) {
  const m = await fight();
  const [a, t] = m.bots;
  run(m, delay - 0.05);
  const ay = a.pos.y, ty = t.pos.y;
  a.body.setTranslation({ x: 0, y: ay, z: 0 }, true);
  a.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  t.body.setTranslation({ x: a.design.chassis.length / 2 + t.half.x + 0.02, y: ty, z: 0 }, true);
  t.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  run(m, 0.05);
  m.drainEvents();
  run(m, 0.3, true);
  const hit = m.drainEvents().find((e) => e.type === 'hit' && e.kind === 'flip' && e.attacker === 0);
  m.dispose();
  return hit && hit.type === 'hit' ? hit.energy : 0;
}

describe('flywheel flipper (Blip)', () => {
  it('is a flywheel flipper with unlimited shots, and shots stay Infinity through the weight fit', () => {
    const w = rosterById('blip')!.weapon;
    expect(w.type === 'flipper' && w.actuator).toBe('flywheel');
    expect(w.type === 'flipper' && w.shots).toBe(Infinity);
    expect(w.type === 'flipper' && w.cooldown).toBe(RESPIN);
    const refit = fitToWeight(rosterById('blip')!).weapon;
    expect(refit.type === 'flipper' && refit.shots).toBe(Infinity);
  });

  it(`re-spins to full in ${RESPIN} s, and a damaged weapon motor re-spins slower`, async () => {
    const m = await fight();
    const act = m.bots[0].actuator!;
    run(m, RESPIN / 2);
    expect(act.charge!).toBeGreaterThan(0.45);
    expect(act.charge!).toBeLessThan(0.55);
    run(m, RESPIN / 2 + 0.05);
    expect(act.charge).toBe(1);
    // half a weapon motor: half the charge in the same time
    act.charge = 0;
    m.bots[0].internals.weapon = 0.5;
    run(m, RESPIN);
    expect(act.charge!).toBeGreaterThan(0.45);
    expect(act.charge!).toBeLessThan(0.55);
    m.dispose();
  });

  it('never locks the trigger out: it fires again as soon as the plate is back, and never runs out', async () => {
    const m = await fight();
    const act = m.bots[0].actuator!;
    let fires = 0;
    for (let i = 0; i < 240 * 20; i++) {
      const was = act.phase;
      // tap the trigger every other frame: a new press is always waiting when the plate comes home
      m.setInput(0, { throttle: 0, turn: 0, weapon: i % 2 === 0 });
      m.step();
      if (was === 'rest' && act.phase === 'firing') fires++;
      expect(act.cooldown).toBe(0);
    }
    // one cycle is ~0.07 s up + 0.35 s held + 0.5 s back down, so ~21 shots in 20 s, with no gas to run dry
    expect(fires).toBeGreaterThan(18);
    expect(act.shots).toBe(Infinity);
    m.dispose();
  });

  it('a shot fired before the flywheel is back up to speed is weaker, not blocked', async () => {
    const full = await flipEnergyAfter(RESPIN + 0.5);
    const early = await flipEnergyAfter(RESPIN / 3); // a third of a re-spin: about a third of the energy
    expect(full).toBeGreaterThan(0);
    expect(early).toBeGreaterThan(0);
    expect(early / full).toBeGreaterThan(0.2);
    expect(early / full).toBeLessThan(0.5);
  });

  it('self-rights with the flipper within 3 s and can drive', async () => {
    const m = await fight();
    const b = m.bots[0];
    run(m, RESPIN + 0.1); // flywheel up to speed
    b.body.setTranslation({ x: 0, y: 0.5, z: 0 }, true);
    b.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
    let righted = -1;
    for (let i = 0; i < 240 * 4; i++) {
      const t = i / 240;
      const pulse = righted < 0 && t > 0.5 && Math.floor(t * 2) % 2 === 1;
      m.setInput(0, { throttle: 0, turn: 0, weapon: pulse });
      m.step();
      if (righted < 0 && b.up.y > 0.8 && b.canMove()) righted = t;
    }
    expect(righted, 'blip never righted').toBeGreaterThan(0);
    expect(righted).toBeLessThan(3);
    m.dispose();
  });
});
