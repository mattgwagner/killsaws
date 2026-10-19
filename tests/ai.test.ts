// Driver profiles and the plan overlays. Bounds are stated here, not derived from a run.
import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { BotAI } from '../src/sim/ai';
import { ROSTER, rosterById } from '../src/sim/roster';
import { DRIVERS, clockMode, defaultProfile, driverFor } from '../src/sim/drivers';
import { NO_INPUT } from '../src/sim/bot';
import { HALF, RAIL_DEPTH } from '../src/sim/arena';
import { qAxisAngle, v3 } from '../src/sim/vec';
import type { SimEvent } from '../src/sim/combat';

const DT = 1 / 240;

/** Run `secs` of fight with only bot 0 driven by `ai`; bot 1 sits still. Returns when they first touched (or null). */
async function closeIn(a: string, b: string, secs: number, setup: (m: Match) => void) {
  const m = await Match.create([rosterById(a)!, rosterById(b)!], { seed: 3, humans: [false, false] });
  const ai = new BotAI(0, 'champion', 3);
  while (m.phase !== 'fight') m.step();
  setup(m);
  let touched: number | null = null, fired = false;
  while (m.fightTime < secs && !m.result) {
    const inp = ai.think(m, DT);
    if (inp.weapon) fired = true;
    m.setInput(0, inp);
    m.setInput(1, NO_INPUT);
    m.step();
    if (touched === null && m.touching(m.bots[0], m.bots[1])) touched = m.fightTime;
  }
  const approach = ai.approach;
  m.dispose();
  return { touched, approach, fired };
}

describe('driver profiles', () => {
  it('every roster robot has its own profiled game plan', () => {
    for (const d of ROSTER) expect(DRIVERS[d.id], d.id).toBeDefined();
  });

  it('a robot nobody profiled gets a plan from its weapon type', () => {
    const tomb = rosterById('tombstone')!, duck = rosterById('duck')!;
    expect(driverFor({ ...tomb, id: 'garage-bar' }).respin).toBeGreaterThan(0);
    expect(driverFor({ ...duck, id: 'garage-wedge' }).approach).toBe('wedge-in');
    expect(defaultProfile(duck).follow).toBe(true);
  });

  it('the plans that define the famous robots', () => {
    expect(DRIVERS.tombstone.approach).toBe('square-up');
    expect(DRIVERS.tombstone.respin).toBeGreaterThan(0);
    expect(DRIVERS['bite-force'].respin).toBe(0); // never spins down
    expect(DRIVERS.icewave.approach).toBe('circle');
    expect(DRIVERS.icewave.flipperShy).toBe(true);
    expect(DRIVERS.hydra.follow).toBe(true);
    expect(DRIVERS.gigabyte.cornerSpinUp).toBe(true);
    expect(DRIVERS.quantum.hazardPlay).toBe(1);
  });
});

describe('weapon-gone fallback', () => {
  it('a Tombstone with its bar broken still drives into contact', async () => {
    const r = await closeIn('tombstone', 'duck', 15, (m) => { m.bots[0].internals.weapon = 0; });
    expect(r.approach).toBe('wedge-in');
    expect(r.touched, 'never reached the opponent').not.toBeNull();
    expect(r.touched!).toBeLessThan(8);
  }, 60_000);

  it('a flipper out of gas still closes, and stops pulling the trigger', async () => {
    const armed = await closeIn('bronco', 'tombstone', 15, () => {});
    expect(armed.fired, 'a gassed-up Bronco fires on contact').toBe(true);
    const r = await closeIn('bronco', 'tombstone', 15, (m) => { m.bots[0].actuator!.shots = 0; });
    expect(r.approach).toBe('wedge-in');
    expect(r.fired).toBe(false);
    expect(r.touched, 'never reached the opponent').not.toBeNull();
    expect(r.touched!).toBeLessThan(8);
  }, 60_000);
});

describe('the clock and the cards', () => {
  it('clockMode: plan early, control when ahead late, aggression when behind with 30 s left', () => {
    expect(clockMode(120, 10, 20)).toBe('plan');
    expect(clockMode(50, 20, 10)).toBe('control');
    expect(clockMode(50, 10, 20)).toBe('plan');
    expect(clockMode(25, 10, 20)).toBe('aggress');
    expect(clockMode(25, 20, 10)).toBe('control');
  });

  it('in the last 30 s the same robot flips from control to aggression when it falls behind', async () => {
    // HUGE stands off when it's ahead late; behind, it has to go get it
    const m = await Match.create([rosterById('huge')!, rosterById('duck')!], { seed: 5, humans: [false, false] });
    const ai = new BotAI(0, 'champion', 5);
    while (m.phase !== 'fight') m.step();
    m.fightTime = m.opts.matchSeconds - 25;
    const [me, op] = m.bots;
    me.damageDealt = 60000; me.aggression = 20; me.control = 10;
    op.damageDealt = 5000; op.aggression = 5; op.control = 1;
    ai.think(m, DT);
    expect(ai.mode).toBe('control');
    expect(ai.approach).toBe('stand-off');
    op.damageDealt = 200000; op.aggression = 60; op.control = 40;
    ai.think(m, DT);
    expect(ai.mode).toBe('aggress');
    expect(ai.approach).toBe('square-up');
    m.dispose();
  });

  it('judgesEstimate splits all 33 points and favours whoever did more', async () => {
    const m = await Match.create([rosterById('huge')!, rosterById('duck')!], { seed: 5 });
    const [a, b] = m.judgesEstimate();
    expect(a + b).toBeCloseTo(33, 6);
    expect(a).toBeCloseTo(16.5, 6);
    m.bots[0].damageDealt = 1000;
    expect(m.judgesEstimate()[0]).toBeGreaterThan(m.judgesEstimate()[1]);
    m.dispose();
  });
});

/** Metres of floor left before the spiked rail. The driver's own copy of this must stay inside it. */
const railInset = (x: number, z: number) => HALF - RAIL_DEPTH - Math.max(Math.abs(x), Math.abs(z));

async function atFight(a: string, b: string) {
  const m = await Match.create([rosterById(a)!, rosterById(b)!], { seed: 3, humans: [false, true] });
  while (m.phase !== 'fight') m.step();
  return m;
}

function place(m: Match, i: 0 | 1, x: number, z: number, yaw: number) {
  const b = m.bots[i];
  b.body.setTranslation({ x, y: b.pos.y, z }, true);
  b.body.setRotation(qAxisAngle(v3(0, 1, 0), yaw), true);
  b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

describe('staying off the rail and the deck lip', () => {
  it('an unloaded wheel beside the rail reverses off it', async () => {
    const m = await atFight('end-game', 'duck');
    const inner = HALF - RAIL_DEPTH;
    place(m, 0, -(inner - 0.3), 0, Math.PI); // nose pointed at the west rail
    place(m, 1, 3.5, 3, 0);
    for (const w of m.bots[0].wheels) w.contact = false;
    const inp = new BotAI(0, 'champion', 1).think(m, DT);
    expect(inp.throttle, 'facing the rail, reverse is the way back onto the floor').toBeLessThan(-0.5);
    m.dispose();
  });

  it('wheels down, rear only brushing the rail, does not panic-reverse', async () => {
    const m = await atFight('end-game', 'duck');
    const inner = HALF - RAIL_DEPTH;
    place(m, 0, -(inner - 0.45), 2.4, Math.PI);
    place(m, 1, 0, 2.4, 0);
    for (const w of m.bots[0].wheels) w.contact = true;
    const inp = new BotAI(0, 'champion', 1).think(m, DT);
    // still pointed at the rail, so the ordinary steer pivots (throttle -0.25) rather than reversing off an edge
    expect(inp.throttle).toBeGreaterThan(-0.5);
    m.dispose();
  });

  it('an unloaded wheel on the Upper Deck lip reverses onto the floor', async () => {
    const m = await atFight('duck', 'tombstone');
    const dk = m.layout.deck!;
    place(m, 0, dk.x, dk.z + dk.d / 2 + 0.28, Math.PI / 2); // facing -z, into the deck
    place(m, 1, 3, 3, 0);
    for (const w of m.bots[0].wheels) w.contact = false;
    const inp = new BotAI(0, 'champion', 2).think(m, DT);
    expect(inp.throttle, 'facing the lip, reverse returns to the floor').toBeLessThan(-0.5);
    m.dispose();
  });

  it('still closes on an opponent parked at the screws, and does not count itself out on the rail', async () => {
    const m = await atFight('bite-force', 'duck');
    const inner = HALF - RAIL_DEPTH;
    place(m, 1, -(inner - 0.85), 0.2, 0);
    place(m, 0, -3.2, 0.2, Math.PI);
    const ai = new BotAI(0, 'champion', 4);
    let counted = false;
    let minDist = Infinity;
    const start = Math.hypot(m.bots[0].pos.x - m.bots[1].pos.x, m.bots[0].pos.z - m.bots[1].pos.z);
    for (let i = 0; i < 240 * 10 && !m.result; i++) {
      m.setInput(0, ai.think(m, DT));
      m.setInput(1, NO_INPUT);
      m.step();
      minDist = Math.min(minDist, Math.hypot(m.bots[0].pos.x - m.bots[1].pos.x, m.bots[0].pos.z - m.bots[1].pos.z));
      for (const e of m.drainEvents() as SimEvent[]) {
        if (e.type === 'ko-start' && e.bot === 0 && /rail|deck/i.test(m.ko?.reason ?? '')) counted = true;
      }
    }
    expect(counted, m.ko?.reason).toBe(false);
    expect(railInset(m.bots[0].pos.x, m.bots[0].pos.z), 'beached on the rail').toBeGreaterThan(-0.02);
    expect(minDist, 'never approached the opponent').toBeLessThan(start - 0.8);
    m.dispose();
  }, 30_000);
});
