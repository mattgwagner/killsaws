// Saw arms and crushers do their damage per engagement (#10): a held saw bottoms out
// in the spot it is cutting, and a held crusher stops doing work once the beak has
// sunk in. Bounds are stated here, not derived from a run.
import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { rosterById } from '../src/sim/roster';

/** Attacker at the origin facing +x, the target parked nose-on in front of its weapon, nobody driving. */
async function setup(attacker: string, target = 'duck') {
  const m = await Match.create([rosterById(attacker)!, rosterById(target)!], { hazards: false, humans: [true, true] });
  while (m.phase !== 'fight') m.step();
  const [a, t] = m.bots;
  a.body.setTranslation({ x: 0, y: a.pos.y, z: 0 }, true);
  a.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  t.body.setTranslation({ x: a.half.x + t.half.x + 0.08, y: t.pos.y, z: 0 }, true);
  t.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  run(m, 0.5);
  return m;
}
function run(m: Match, seconds: number, weapon = false) {
  for (let i = 0; i < Math.round(seconds * 240); i++) {
    m.setInput(0, { throttle: 0, turn: 0, weapon });
    m.setInput(1, { throttle: 0, turn: 0, weapon: false });
    m.step();
  }
}
const dealt = (m: Match) => m.bots[0].damageDealt;

describe('saw arm (#10)', () => {
  for (const id of ['skorpios', 'sawblaze']) {
    it(`${id}: a 10 s hold on a still target bottoms out in one spot instead of cutting 10 s of wattage`, async () => {
      const m = await setup(id);
      const w = m.bots[0].design.weapon;
      if (w.type !== 'hammer') throw new Error('not a saw arm');
      run(m, 1, true);
      const first = dealt(m);
      expect(first, 'the saw reached the target').toBeGreaterThan(w.energy * 0.9);
      run(m, 9, true);
      // the drop, then at most a few kJ of plunge; the old flat 9 kW was 90 kJ over the same hold
      expect(dealt(m)).toBeLessThan(w.energy + 6000);
      // and the last 5 s of the hold add nearly nothing: the blade is at full depth with no fresh plate
      const before = dealt(m);
      run(m, 5, true);
      expect(dealt(m) - before).toBeLessThan(500);
      m.dispose();
    }, 60_000);
  }

  it('lifting and re-dropping into the same cut lands the drop again but cuts nothing new', async () => {
    const m = await setup('skorpios');
    const w = m.bots[0].design.weapon;
    if (w.type !== 'hammer') throw new Error('not a saw arm');
    run(m, 6, true);
    const held = dealt(m);
    run(m, 1, false);
    run(m, 2, true);
    const again = dealt(m) - held;
    expect(again).toBeGreaterThan(w.energy * 0.5);
    expect(again).toBeLessThan(w.energy * 1.1 + 1000);
    m.dispose();
  }, 60_000);
});

describe('crusher (#10)', () => {
  it('Quantum: a 10 s grip does one bite of work (force × the beak sinking a few cm), not 10 s of wattage', async () => {
    const m = await setup('quantum');
    const w = m.bots[0].design.weapon;
    if (w.type !== 'crusher') throw new Error('not a crusher');
    run(m, 10, true);
    const bite = dealt(m);
    expect(bite, 'the beak closed on the target').toBeGreaterThan(w.force * 0.01);
    // 155 kN through at most 3 cm; the old 9.3 kW for 10 s was 93 kJ
    expect(bite).toBeLessThan(w.force * 0.03);
    // opening the jaw and biting again does another bite's work
    run(m, 1, false);
    run(m, 2, true);
    expect(dealt(m) - bite).toBeGreaterThan(w.force * 0.01);
    expect(dealt(m) - bite).toBeLessThan(w.force * 0.03);
    m.dispose();
  }, 60_000);
});
