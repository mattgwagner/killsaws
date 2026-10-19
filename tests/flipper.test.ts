// Flippers and lifters only move what is actually on the plate (issue #5).
// Bounds are stated here, not derived from a run.
import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { rosterById } from '../src/sim/roster';
import { plateOf } from '../src/sim/plate';
import { frameOf } from '../src/sim/blueprint';
import { qAxisAngle, v3 } from '../src/sim/vec';
import type { BotDesign } from '../src/sim/design';
import type { BotRuntime } from '../src/sim/bot';
import type { SimEvent } from '../src/sim/combat';


function place(b: BotRuntime, x: number, y: number, z: number, yaw: number) {
  b.body.setTranslation({ x, y, z }, true);
  b.body.setRotation(qAxisAngle(v3(0, 1, 0), yaw), true);
  b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

/**
 * The flipper sits at the origin facing +x. `where` puts the target, given the flipper and the target.
 * Lets the target settle, fires once and follows the target for 1.5 s: did a flip land on it, how far over did it go, how high did it rise.
 */
async function fire(flipper: BotDesign, where: (f: BotRuntime, t: BotRuntime) => { x: number; y: number; z: number }) {
  const m = await Match.create([flipper, rosterById('tombstone')!], { seed: 1, hazards: false, humans: [true, true] });
  while (m.phase !== 'fight') m.step();
  const [f, t] = m.bots;
  const fy = f.pos.y;
  place(f, 0, fy, 0, 0);
  const p = where(f, t);
  place(t, p.x, p.y, p.z, Math.PI); // facing the flipper
  for (let i = 0; i < 60; i++) m.step(); // let it settle onto whatever it's resting on
  m.drainEvents();
  const y0 = t.pos.y;
  let flips = 0, minUp = 1, rise = 0;
  const lift = flipper.weapon.type === 'flipper' && flipper.weapon.style === 'lifter';
  for (let i = 0; i < 240 * 1.5; i++) {
    m.setInput(0, { throttle: 0, turn: 0, weapon: i < (lift ? 120 : 10) });
    m.setInput(1, { throttle: 0, turn: 0, weapon: false });
    m.step();
    for (const e of m.drainEvents() as SimEvent[]) if (e.type === 'hit' && e.kind === 'flip' && e.target === 1) flips++;
    minUp = Math.min(minUp, t.up.y);
    rise = Math.max(rise, t.pos.y - y0);
  }
  m.dispose();
  return { flips, minUp, rise };
}

/** Resting on the flipper's deck, centred `along` of the way from the plate's hinge to its tip. */
const onDeck = (kind: 'flipper' | 'lifter', along: number) => (f: BotRuntime, t: BotRuntime) => {
  const pl = plateOf(f.design, kind);
  const x = pl.fromX + (pl.tipX(0) - pl.fromX) * along;
  return { x, y: f.pos.y + pl.surface(x) + t.half.y + t.design.chassis.clearance + 0.01, z: 0 };
};

describe('flippers only flip what is on the plate', () => {
  const bronco = rosterById('bronco')!;
  const hydra = rosterById('hydra')!;

  it('a robot 0.3 m to the side of Bronco\'s plate does not flip', async () => {
    const r = await fire(bronco, (f, t) => ({ x: 0.1, y: t.pos.y, z: f.half.z + t.half.z + 0.3 }));
    expect(r.flips).toBe(0);
    expect(r.minUp).toBeGreaterThan(0.9);
  });

  it('a robot with its front half on Bronco\'s plate goes over', async () => {
    // its centre at the plate's tip: the half facing Bronco is over the plate, the other half hangs off the nose
    const r = await fire(bronco, (f, t) => {
      const pl = plateOf(f.design, 'flipper');
      const x = pl.tipX(0);
      return { x, y: f.pos.y + pl.surface(x - t.half.x * 0.5) + t.half.y + t.design.chassis.clearance + 0.01, z: 0 };
    });
    expect(r.flips).toBe(1);
    expect(r.minUp, 'it should go past vertical').toBeLessThan(0);
  });

  it('a robot touching only the front edge of Bronco\'s plate is lifted a little at most and does not invert', async () => {
    const r = await fire(bronco, (f, t) => {
      const front = plateOf(f.design, 'flipper').tipX(0);
      return { x: front + t.half.x + 0.01, y: t.pos.y, z: 0 };
    });
    expect(r.minUp).toBeGreaterThan(0.5);
    expect(r.rise).toBeLessThan(0.15);
  });

  it('a robot resting on Bronco\'s nose wedge, under the flat lid, is not on the plate', async () => {
    const r = await fire(bronco, (f, t) => {
      const fr = frameOf(f.design.chassis.blueprint!);
      const x = fr.maxX - 0.02 + t.half.x; // its tail 2 cm up the wedge from the tip
      return { x, y: f.pos.y + fr.top(fr.maxX - 0.02) + t.half.y + t.design.chassis.clearance + 0.01, z: 0 };
    });
    expect(r.flips).toBe(0);
    expect(r.minUp).toBeGreaterThan(0.5);
  });

  it('Hydra: on the plate flips, beside it does not', async () => {
    const on = await fire(hydra, onDeck('flipper', 0.6));
    expect(on.flips).toBe(1);
    expect(on.minUp).toBeLessThan(0);
    const side = await fire(hydra, (f, t) => ({ x: 0.1, y: t.pos.y, z: f.half.z + t.half.z + 0.3 }));
    expect(side.flips).toBe(0);
  });

  it('a Garage-built lifter lifts what is on its beak, and only that', async () => {
    const duck = rosterById('duck')!;
    const garage: BotDesign = { ...duck, id: 'garage-lifter', name: 'Garage Lifter' };
    // the beak sticks out ahead of the nose: a robot nosed up to the lifter is over it
    const over = await fire(garage, (f, t) => ({ x: f.half.x + t.half.x + 0.01, y: t.pos.y, z: 0 }));
    expect(over.flips).toBe(1);
    expect(over.rise).toBeGreaterThan(0.03);
    const side = await fire(garage, (f, t) => ({ x: f.half.x + t.half.x, y: t.pos.y, z: f.half.z + t.half.z + 0.3 }));
    expect(side.flips).toBe(0);
  });
});
