// Lock-Jaw's bar is a swept cylinder that skims the floor. Upside down that
// cylinder used to be the lowest point, so the wheels never reached.
import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { rosterById } from '../src/sim/roster';

describe('inverted drive', () => {
  it('Lock-Jaw rests on its wheels upside down and drives', async () => {
    const m = await Match.create([rosterById('lock-jaw')!, rosterById('duck')!], { hazards: false, humans: [true, true] });
    for (let i = 0; i < 240 * 3.2; i++) m.step();
    const b = m.bots[0];
    expect(b.stats.invertible).toBe(true);
    b.body.setTranslation({ x: 0, y: 0.6, z: 0 }, true);
    b.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 240 * 2; i++) m.step();
    const down = b.wheels.filter((w) => w.attached && w.contact);
    expect(b.up.y, `up.y=${b.up.y.toFixed(2)} y=${b.pos.y.toFixed(3)}`).toBeLessThan(-0.8);
    expect(down.length, `wheels down ${down.length}/4 at y=${b.pos.y.toFixed(3)}`).toBe(4);
    expect(b.canMove()).toBe(true);
    const x0 = b.pos.x, z0 = b.pos.z;
    for (let i = 0; i < 240 * 2; i++) {
      m.setInput(0, { throttle: 1, turn: 0, weapon: false });
      m.step();
    }
    expect(Math.hypot(b.pos.x - x0, b.pos.z - z0), 'did not drive').toBeGreaterThan(0.5);
    expect(b.up.y).toBeLessThan(-0.5);
    // roll it onto its side while the bar still overlaps the floor: that overlap must not launch it
    b.body.setRotation({ x: 0.7071, y: 0, z: 0, w: 0.7071 }, true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    let peak = b.pos.y;
    for (let i = 0; i < 240; i++) {
      m.step();
      peak = Math.max(peak, b.pos.y);
    }
    expect(peak, 'swept bar launched the chassis').toBeLessThan(1.2);
    m.dispose();
  });
});
