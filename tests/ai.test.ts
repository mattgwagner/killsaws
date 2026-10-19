// Driver profiles and the plan overlays. Bounds are stated here, not derived from a run.
import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { BotAI } from '../src/sim/ai';
import { ROSTER, rosterById } from '../src/sim/roster';
import { DRIVERS, clockMode, defaultProfile, driverFor } from '../src/sim/drivers';
import { NO_INPUT } from '../src/sim/bot';

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
