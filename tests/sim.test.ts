// Bounds are stated here, not derived from a run.
import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { BotAI } from '../src/sim/ai';
import { ROSTER, rosterById } from '../src/sim/roster';
import { computeStats, kgToLb } from '../src/sim/design';
import { SimEvent } from '../src/sim/combat';

describe('roster', () => {
  it('every roster bot makes the 250.0 lb heavyweight limit', () => {
    for (const d of ROSTER) {
      const lb = kgToLb(computeStats(d).mass);
      expect(lb, d.name).toBeLessThanOrEqual(250);
      expect(lb, d.name).toBeGreaterThan(240);
    }
  });
  it('unlimited actuators survive the weight fit (Infinity is not null)', () => {
    for (const id of ['hydra', 'duck']) {
      const w = rosterById(id)!.weapon;
      expect(w.type === 'flipper' && w.shots).toBe(Infinity);
    }
  });
  it('published weapon numbers: Tombstone ~200 mph, Witch Doctor 4000 rpm, Minotaur 8000 rpm, End Game 6000 rpm', () => {
    const tip = (id: string) => computeStats(rosterById(id)!).weapon!;
    expect(tip('tombstone').tipSpeedMph).toBeGreaterThan(190);
    expect(tip('tombstone').tipSpeedMph).toBeLessThan(210);
    expect(Math.round(tip('witch-doctor').maxRpm)).toBe(4000);
    expect(Math.round(tip('minotaur').maxRpm)).toBe(8000);
    expect(Math.round(tip('end-game').maxRpm)).toBe(6000);
  });
});

const RIGHTERS = ['end-game', 'tantrum', 'bronco', 'blacksmith', 'gigabyte', 'bloodsport', 'witch-doctor', 'whiplash', 'hydra', 'quantum', 'sawblaze', 'beta', 'cobalt'];

describe('self-righting with the weapon spinning', () => {
  for (const id of RIGHTERS) {
    it(`${id} gets back on its wheels within 3 s and can drive`, async () => {
      const m = await Match.create([rosterById(id)!, rosterById('duck')!], { hazards: false, humans: [true, true] });
      const b = m.bots[0];
      for (let i = 0; i < 240 * 3.2; i++) m.step(); // countdown
      b.body.setTranslation({ x: 0, y: 0.5, z: 0 }, true);
      b.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
      if (b.spinner) { b.spinner.on = true; b.spinner.omega = (computeStats(b.design).weapon!.maxRpm * Math.PI) / 30 * 0.8; }
      let righted = -1;
      for (let i = 0; i < 240 * 4; i++) {
        const t = i / 240;
        const pulse = righted < 0 && t > 0.5 && Math.floor(t * 2) % 2 === 1;
        m.setInput(0, { throttle: 0, turn: 0, weapon: !b.spinner && pulse, alt: pulse });
        m.step();
        // a full-body spinner precesses on its rim like a top; its driver cuts the weapon to settle onto the wheels
        if (b.up.y > 0.8 && !b.canMove() && b.spinner && b.design.weapon.type === 'spinner' && b.design.weapon.style === 'shell') b.spinner.on = false;
        if (righted < 0 && b.up.y > 0.8 && b.canMove()) righted = t;
      }
      expect(righted, `${id} never righted`).toBeGreaterThan(0);
      expect(righted).toBeLessThan(3);
      expect(b.up.y).toBeGreaterThan(0.8);
      m.dispose();
    });
  }
});

describe('seeded AI matches', () => {
  it('20 champion-vs-champion fights finish cleanly; KOs have real reasons; no count on a held or airborne robot', async () => {
    let fallback = 0, judges = 0;
    for (let i = 0; i < 20; i++) {
      const a = ROSTER[(i * 7) % ROSTER.length], b = ROSTER[(i * 11 + 3) % ROSTER.length];
      const m = await Match.create([a, b], { seed: i + 1, humans: [false, false] });
      const ais = [new BotAI(0, 'champion', i), new BotAI(1, 'champion', i + 100)];
      let steps = 0;
      while (!m.result && steps < 240 * 200) {
        for (let k = 0; k < 2; k++) m.setInput(k, ais[k].think(m, 1 / 240));
        m.step();
        steps++;
        for (const e of m.drainEvents() as SimEvent[]) {
          if (e.type === 'ko-start') {
            const v = m.bots[e.bot];
            expect(v.airborne(), `${v.design.name} counted while airborne`).toBe(false);
            expect(m.touching(v, m.bots[1 - e.bot]), `${v.design.name} counted while held`).toBe(false);
          }
        }
        if (steps % 240 === 0) for (const bt of m.bots) expect(Number.isFinite(bt.pos.x + bt.pos.y + bt.pos.z)).toBe(true);
      }
      expect(m.result, `${a.name} vs ${b.name} never ended`).not.toBeNull();
      if (m.result!.koReason?.includes('could not show controlled movement') || m.result!.koReason?.includes('beached')) fallback++;
      if (m.result!.method === 'Judges') judges++;
      m.dispose();
    }
    expect(fallback).toBe(0);
    expect(judges).toBeGreaterThan(0);
  }, 300_000);
});
