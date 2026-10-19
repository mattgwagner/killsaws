// A stranded robot is counted out: beached on the rail, or unable to translate.
import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { HALF, RAIL_DEPTH } from '../src/sim/arena';
import { rosterById } from '../src/sim/roster';
import { SimEvent } from '../src/sim/combat';

async function ready(red: string, blue: string) {
  const m = await Match.create([rosterById(red)!, rosterById(blue)!], { hazards: false, humans: [true, true] });
  for (let i = 0; i < 240 * 3.2; i++) m.step();
  return m;
}

/** Step until `bot` is counted, or `seconds` elapse. Returns the fight time of the count. */
function untilCount(m: Match, bot: 0 | 1, seconds: number) {
  let at = -1;
  for (let i = 0; i < 240 * seconds && at < 0; i++) {
    m.step();
    for (const e of m.drainEvents() as SimEvent[]) {
      if (e.type === 'ko-start' && e.bot === bot) at = m.fightTime;
    }
  }
  return at;
}

describe('KO count on a stranded robot', () => {
  it('a robot resting on the spiked rail, not touching its opponent and not moving, is counted', async () => {
    const m = await ready('bite-force', 'duck');
    const b = m.bots[0];
    // centre it on the west rail, clear of DUCK! in the blue square
    b.body.setTranslation({ x: -(HALF - RAIL_DEPTH / 2), y: 0.55, z: 0 }, true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    // wheels off, so the only way it is not airborne is the chassis resting on the rail
    for (let i = 0; i < b.wheels.length; i++) b.detachWheel(i);
    const at = untilCount(m, 0, 6);
    expect(at, 'count never started').toBeGreaterThan(1.5);
    expect(at).toBeLessThan(4);
    expect(b.wheels.some((w) => w.contact)).toBe(false);
    // above the old height cutoff (clearance + body/wheel + 0.12 ≈ 0.22), so the height test would have skipped it
    expect(b.pos.y).toBeGreaterThan(0.3);
    expect(b.airborne(), 'rail is a support').toBe(false);
    expect(m.touching(b, m.bots[1])).toBe(false);
    expect(b.speed).toBeLessThan(0.3);
    m.dispose();
  });

  it('End Game beached on the rail with a wheel down on each side is counted', async () => {
    const m = await ready('end-game', 'duck');
    const b = m.bots[0];
    b.body.setTranslation({ x: -(HALF - RAIL_DEPTH / 2), y: 0.55, z: 0 }, true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 240; i++) m.step();
    m.drainEvents();
    const down = b.wheels.filter((w) => w.attached && w.contact);
    const sides = new Set(down.map((w) => w.side));
    expect(down.length, `y=${b.pos.y.toFixed(2)} down=${down.length}`).toBeGreaterThanOrEqual(2);
    expect(sides.size).toBe(2);
    expect(b.canMove(), 'wheel test still says it can drive').toBe(true);
    expect(b.pos.y).toBeGreaterThan(0.3);
    const t0 = m.fightTime;
    const at = untilCount(m, 0, 5);
    expect(at - t0, 'count never started').toBeGreaterThan(1.5);
    expect(at - t0).toBeLessThan(3);
    expect(m.ko?.reason).toContain('spiked rail');
    expect(b.airborne()).toBe(false);
    expect(m.touching(b, m.bots[1])).toBe(false);
    m.dispose();
  });

  it('a planted robot whose rear overlaps the rail is not counted', async () => {
    const m = await ready('end-game', 'duck');
    const b = m.bots[0];
    // ride height, every wheel down, rear overlapping the west rail by a couple of centimetres
    b.body.setTranslation({ x: -(HALF - RAIL_DEPTH) + 0.35, y: 0.2, z: 3.2 }, true);
    b.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    let started = false;
    for (let i = 0; i < 240 * 4; i++) {
      m.step();
      for (const e of m.drainEvents() as SimEvent[]) if (e.type === 'ko-start' && e.bot === 0) started = true;
    }
    const down = b.wheels.filter((w) => w.attached && w.contact).length;
    let rail = false;
    for (let i = 0; i < b.body.numColliders() && !rail; i++) {
      m.world.contactPairsWith(b.body.collider(i), (o) => {
        if (m.tags.get(o.handle)?.hazardId === 'rail') rail = true;
      });
    }
    expect(down, 'not planted').toBe(b.wheels.length);
    expect(rail, 'rear is not on the rail').toBe(true);
    expect(b.canMove()).toBe(true);
    expect(b.pos.y, 'should be at ride height, not up on the rail').toBeLessThan(0.25);
    expect(started).toBe(false);
    m.dispose();
  });

  it('a 2WD robot with one wheel left, sitting still, is counted after 1.5 s', async () => {
    const m = await ready('valkyrie', 'duck');
    const b = m.bots[0];
    b.body.setTranslation({ x: 0, y: b.pos.y, z: 0 }, true);
    m.bots[1].body.setTranslation({ x: 4, y: 0.4, z: 4 }, true);
    b.detachWheel(0);
    const at = untilCount(m, 0, 6);
    const down = b.wheels.filter((w) => w.attached && w.contact);
    expect(down.length, `wheels down ${down.length}, up.y ${b.up.y.toFixed(2)}`).toBeGreaterThan(0);
    expect(down.length).toBeLessThan(b.wheels.length);
    expect(b.canMove()).toBe(false);
    expect(b.up.y, 'tipped onto its side instead of sitting on one wheel').toBeGreaterThan(0.5);
    expect(at, 'count never started').toBeGreaterThan(1.5);
    expect(at).toBeLessThan(4);
    expect(m.ko?.reason).toBe('Valkyrie lost a wheel and can\'t drive');
    expect(m.touching(b, m.bots[1])).toBe(false);
    m.dispose();
  });

  it('a robot high-centred with fewer than half its wheels down is counted after 1.5 s', async () => {
    const m = await ready('hypershock', 'duck');
    const b = m.bots[0];
    b.body.setTranslation({ x: 0, y: b.pos.y, z: 0 }, true);
    m.bots[1].body.setTranslation({ x: 4, y: 0.4, z: 4 }, true);
    // 4 wheels: leave one. 1 is fewer than half, and only one side.
    b.detachWheel(0);
    b.detachWheel(1);
    b.detachWheel(2);
    const at = untilCount(m, 0, 6);
    const down = b.wheels.filter((w) => w.attached && w.contact).length;
    expect(down, `up.y ${b.up.y.toFixed(2)}`).toBeGreaterThan(0);
    expect(down).toBeLessThan(b.wheels.length / 2);
    expect(b.canMove()).toBe(false);
    expect(b.up.y).toBeGreaterThan(0.5);
    expect(at, 'count never started').toBeGreaterThan(1.5);
    expect(at).toBeLessThan(4);
    expect(m.ko?.reason).toBe('HyperShock lost a wheel and can\'t drive');
    expect(m.touching(b, m.bots[1])).toBe(false);
    m.dispose();
  });
});
