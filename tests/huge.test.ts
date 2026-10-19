// HUGE's stabilizing legs (issue #8): A-frames to the floor fore and aft stop the body pitching around the axle.
import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { rosterById } from '../src/sim/roster';
import { chassisHulls, stabilizerStruts } from '../src/sim/bot';
import { computeStats } from '../src/sim/design';

const pitchDeg = (f: { y: number }) => (Math.asin(Math.max(-1, Math.min(1, f.y))) * 180) / Math.PI;

async function huge() {
  const m = await Match.create([rosterById('huge')!, rosterById('duck')!], { hazards: false, humans: [true, true] });
  for (let i = 0; i < 240 * 3.1; i++) m.step(); // countdown
  const b = m.bots[0];
  b.body.setTranslation({ x: 0, y: b.pos.y, z: 0 }, true);
  m.bots[1].body.setTranslation({ x: 6, y: 0.3, z: -6 }, true);
  return { m, b };
}

describe('HUGE stabilizing legs', () => {
  it('the legs are part of the collider (four struts, tips ahead of and behind the axle) and part of the weigh-in', () => {
    const d = rosterById('huge')!;
    const st = stabilizerStruts(d);
    expect(st.length).toBe(4);
    expect(st.some((s) => s.b.x > 0.3) && st.some((s) => s.b.x < -0.3)).toBe(true);
    expect(chassisHulls(d).length).toBe(5);
    expect(computeStats(d).massItems.some((i) => i.label.includes('Stabilizing legs'))).toBe(true);
    expect(computeStats(d).legal).toBe(true);
  });

  it('spun up to full rpm on a flat floor for 5 s, it ends within 5 degrees of level', async () => {
    const { m, b } = await huge();
    for (let i = 0; i < 240 * 9; i++) { m.setInput(0, { throttle: 0, turn: 0, weapon: i === 1 }); m.step(); }
    expect(Math.abs(b.spinner!.omega) * 9.55).toBeGreaterThan(2400);
    expect(Math.abs(pitchDeg(b.forward))).toBeLessThan(5);
    expect(b.canMove()).toBe(true);
    m.dispose();
  });

  it('a 30 kJ-class bar hit on a wheel rim rocks it and it settles level on its wheels, able to drive', async () => {
    const { m, b } = await huge();
    for (let i = 0; i < 240; i++) m.step();
    // horizontal-spinner hit in the ~30 kJ range: ~900 N·s at the top of the body, from the front
    // a horizontal bar runs a few inches off the floor, so on HUGE it lands on a wheel rim
    const p = b.toWorld({ x: 0.15, y: -0.4, z: 0.42 });
    b.impulse(b.dirWorld({ x: -900, y: 0, z: 0 }), p);
    for (let i = 0; i < 240 * 3; i++) m.step();
    // HUGE is invertible: level on its wheels either way up is a win, standing on end is not
    expect(Math.abs(b.up.y)).toBeGreaterThan(0.9);
    expect(Math.abs(pitchDeg(b.forward))).toBeLessThan(15);
    expect(b.canMove()).toBe(true);
    m.dispose();
  });

  it('inverted, the legs swing over: it drives and its own spin-up settles level on them', async () => {
    const { m, b } = await huge();
    b.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
    for (let i = 0; i < 240 * 1; i++) m.step();
    for (let i = 0; i < 240 * 8; i++) { m.setInput(0, { throttle: 0, turn: 0, weapon: i === 1 }); m.step(); }
    expect(b.inverted).toBe(true);
    expect(Math.abs(pitchDeg(b.forward))).toBeLessThan(8);
    expect(b.canMove()).toBe(true);
    m.dispose();
  });
});
