// Design Office (#18). Bounds are stated here, not derived from the code under test:
// the inspection tolerance is ±3% (weight ±1 lb), the weight limit is 250.0 lb.
// Each card formula below is written out the way a player would apply it to the
// numbers printed on the card, and it is checked against the sim itself
// (computeStats, runtimeMinutes, the collider hull), never against briefs.ts.
import { describe, expect, it } from 'vitest';
import { BRIEFS, CardSection, QuantityId, inspect, parseEntry, referenceCard, withinTolerance } from '../src/sim/briefs';
import { BotDesign, computeStats, fitToWeight, runtimeMinutes } from '../src/sim/design';
import { chassisHull } from '../src/sim/bot';
import { MaterialId, MotorId } from '../src/sim/parts';
import { ROSTER } from '../src/sim/roster';
import lore from '../src/data/lore.json';

const REL = 0.03; // ±3%
const LB_TOL = 1; // ±1 lb
const LIMIT_LB = 250;
const KG_PER_LB = 0.45359237;
const M_PER_IN = 0.0254;

const lbOf = (d: BotDesign) => computeStats(d).mass / KG_PER_LB;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A seeded variation on a brief's starter: the kind of thing a player does in the Garage. */
function vary(base: BotDesign, seed: number): BotDesign {
  const r = rng(seed);
  const u = (lo: number, hi: number) => lo + (hi - lo) * r();
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const d = structuredClone(base);
  const mats: MaterialId[] = ['ar500', 'hardox', 'titanium', 'al7075', 'uhmw', 's7'];
  for (const k of ['front', 'rear', 'sides', 'top', 'bottom'] as const) {
    d.chassis.armor[k].thickness = Math.round(d.chassis.armor[k].thickness * u(0.6, 1.3) * 2) / 2;
    if (r() < 0.3) d.chassis.armor[k].material = pick(mats);
  }
  d.chassis.length *= u(0.85, 1.15);
  d.chassis.width *= u(0.85, 1.15);
  d.chassis.height = u(4, 11) * M_PER_IN;
  if (r() < 0.5) { d.chassis.shape = 'wedge'; d.chassis.wedgeLength = u(2, 16) * M_PER_IN; }
  d.drive.wheelDiameter = Math.round(u(4, 10) * 2) / 2 * M_PER_IN;
  d.drive.ratio = Math.round(u(5, 18) * 2) / 2;
  d.drive.motor = pick<MotorId>(['bl63-190', 'bl80-150', 'brushed-35']);
  d.battery = { cellsS: Math.round(u(8, 14)), capacityAh: Math.round(u(3, 8) * 2) / 2, packs: Math.round(u(1, 3)), cRating: 65 };
  if (d.weapon.type === 'spinner') {
    d.weapon.rotorMass = u(10, 45);
    d.weapon.radius *= u(0.75, 1.25);
    d.weapon.ratio = Math.round(u(0.6, 3) * 20) / 20;
    d.weapon.motor = pick<MotorId>(['bl80100-130', 'bl120-70', 'bl160-50', 'etek', 'ice-engine']);
  }
  return d;
}

const cardVals = (card: CardSection[], id: QuantityId) => {
  const s = card.find((c) => c.id === id)!;
  return Object.fromEntries(s.inputs.map((i) => [i.key, i.value])) as Record<string, number>;
};

// ---- the card formulas, applied to the card's printed numbers ----
const motorRpm = (kv: number, cells: number) => kv * cells * 3.85;
const rotorRpmFromCard = (v: Record<string, number>) => (v.governed ? v.governed / v.ratio : (motorRpm(v.kv, v.cells) * 0.93) / v.ratio);
const mphFromWheelRpm = (wheelRpm: number, diaIn: number) => ((wheelRpm * Math.PI * diaIn) / 12) * 60 / 5280 * 0.86;

function playerAnswer(card: CardSection[], id: QuantityId): number {
  const v = cardVals(card, id);
  switch (id) {
    case 'weightLb': return Object.values(v).reduce((s, x) => s + x, 0) / KG_PER_LB;
    case 'armorMm': {
      const plateKg = v.targetLb * KG_PER_LB - v.restKg;
      return (plateKg / (v.areaIn2 * M_PER_IN * M_PER_IN * v.density)) * 1000;
    }
    case 'topSpeedMph': return mphFromWheelRpm(motorRpm(v.kv, v.cells) / v.ratio, v.wheelIn);
    case 'weaponRpm': return rotorRpmFromCard(v);
    case 'tipSpeedMph': {
      const rpm = v.rpm ?? playerAnswer(card, 'weaponRpm');
      return (Math.PI * v.diaIn * rpm) / 12 / 5280 * 60;
    }
    case 'driveRatio': return mphFromWheelRpm(motorRpm(v.kv, v.cells), v.wheelIn) / v.target;
    case 'weaponRatio': return v.governed ? v.governed / v.target : (motorRpm(v.kv, v.cells) * 0.93) / v.target;
    case 'energyKJ': {
      const rpm = v.rpm ?? playerAnswer(card, 'weaponRpm');
      const I = v.k * v.massLb * KG_PER_LB * ((v.diaIn / 2) * M_PER_IN) ** 2;
      const w = (rpm * 2 * Math.PI) / 60;
      return (0.5 * I * w * w) / 1000;
    }
    case 'runtimeMin': {
      const usableWh = v.cells * 3.7 * v.ah * v.packs * 0.8;
      return (usableWh / (v.driveW + v.weaponW + v.elecW)) * 60;
    }
    case 'slope': return (v.topY - v.tipY) / (v.tipX - v.topX);
    case 'topMm':
    case 'sideMm': {
      const s = cardVals(card, 'sideMm');
      const plates = s.targetLb * KG_PER_LB - s.restKg;
      const perMmTop = (s.sideAreaIn2 * M_PER_IN ** 2 * s.sideDensity * s.ratio + s.topAreaIn2 * M_PER_IN ** 2 * s.topDensity) / 1000;
      const t = plates / perMmTop;
      return id === 'topMm' ? t : t * s.ratio;
    }
  }
}

// ---- the sim's own answer for each quantity ----
/** Linear in a thickness: solve mass(t) = target from two sim evaluations. */
function thicknessForTarget(d: BotDesign, targetLb: number, set: (x: BotDesign, t: number) => void) {
  const at = (t: number) => { const x = structuredClone(d); set(x, t); return lbOf(x); };
  const m0 = at(0), m1 = at(1);
  return (targetLb - m0) / (m1 - m0);
}
function hullSlope(d: BotDesign) {
  const h = chassisHull(d);
  let tipX = -Infinity, tipY = Infinity, topX = -Infinity, topY = -Infinity;
  for (let i = 0; i < h.length; i += 3) {
    const x = h[i], y = h[i + 1];
    if (x > tipX + 1e-6 || (Math.abs(x - tipX) <= 1e-6 && y < tipY)) { tipX = x; tipY = y; }
    if (y > topY + 1e-6 || (Math.abs(y - topY) <= 1e-6 && x > topX)) { topX = x; topY = y; }
  }
  return (topY - tipY) / (tipX - topX);
}
function simAnswer(d: BotDesign, b: (typeof BRIEFS)[number], id: QuantityId): number {
  const s = computeStats(d);
  switch (id) {
    case 'weightLb': return lbOf(d);
    case 'armorMm': return thicknessForTarget(d, b.targetLb!, (x, t) => { x.chassis.armor.top.thickness = t; });
    case 'topSpeedMph': return s.topSpeedMph;
    case 'weaponRpm': return s.weapon!.maxRpm;
    case 'tipSpeedMph': return s.weapon!.tipSpeedMph;
    case 'energyKJ': return s.weapon!.energyKJ;
    case 'runtimeMin': return runtimeMinutes(d);
    case 'slope': return hullSlope(d);
    case 'topMm': return thicknessForTarget(d, b.targetLb!, (x, t) => { x.chassis.armor.top.thickness = t; x.chassis.armor.sides.thickness = t * b.sideToTop!; });
    case 'sideMm': return simAnswer(d, b, 'topMm') * b.sideToTop!;
    // the ratios are checked by setting them and reading the sim back (below)
    case 'driveRatio': case 'weaponRatio': return NaN;
  }
}

describe('Design Office: reference card agrees with the sim', () => {
  for (const b of BRIEFS) {
    it(`brief ${b.n} (${b.hidden.join(', ')}): card formula on the card's numbers is within ±3% (weight ±1 lb) across 60 seeded designs`, () => {
      let checked = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const d = vary(b.starter(), seed * 7919 + b.n);
        const card = referenceCard(b, d);
        for (const id of b.hidden) {
          const mine = playerAnswer(card, id);
          const where = `brief ${b.n} seed ${seed} ${id}`;
          if (id === 'driveRatio') {
            const x = structuredClone(d); x.drive.ratio = mine;
            expect(Math.abs(computeStats(x).topSpeedMph - b.targetMph!), where).toBeLessThanOrEqual(REL * b.targetMph!);
          } else if (id === 'weaponRatio') {
            const x = structuredClone(d); if (x.weapon.type === 'spinner') x.weapon.ratio = mine;
            expect(Math.abs(computeStats(x).weapon!.maxRpm - b.targetRpm!), where).toBeLessThanOrEqual(REL * b.targetRpm!);
          } else if (id === 'weightLb') {
            expect(Math.abs(mine - simAnswer(d, b, id)), where).toBeLessThanOrEqual(LB_TOL);
          } else {
            const truth = simAnswer(d, b, id);
            expect(Number.isFinite(truth), where).toBe(true);
            expect(Math.abs(mine - truth), `${where}: card ${mine} vs sim ${truth}`).toBeLessThanOrEqual(REL * Math.abs(truth));
          }
          // and the inspector agrees with a player who did the card right
          const ins = inspect(b, d, { [id]: String(mine) });
          expect(ins.entries.find((e) => e.id === id)!.ok, `${where} inspector`).toBe(true);
          checked++;
        }
      }
      expect(checked).toBe(60 * b.hidden.length);
    });
  }

  it('a plate thickness solved on the card lands the robot within 1 lb of the target on the sim scale', () => {
    for (const b of BRIEFS.filter((x) => x.hidden.includes('armorMm') || x.hidden.includes('topMm'))) {
      for (let seed = 1; seed <= 20; seed++) {
        const d = vary(b.starter(), seed * 31 + b.n);
        const card = referenceCard(b, d);
        if (b.hidden.includes('armorMm')) d.chassis.armor.top.thickness = playerAnswer(card, 'armorMm');
        else { d.chassis.armor.top.thickness = playerAnswer(card, 'topMm'); d.chassis.armor.sides.thickness = playerAnswer(card, 'sideMm'); }
        expect(Math.abs(lbOf(d) - b.targetLb!), `brief ${b.n} seed ${seed}`).toBeLessThanOrEqual(LB_TOL);
      }
    }
  });
});

describe('Design Office: weigh-in', () => {
  const b = BRIEFS.find((x) => x.hidden.includes('weightLb'))!;
  it('real mass over 250 lb claimed under is a weigh-in forfeit', () => {
    const heavy = b.starter();
    expect(lbOf(heavy)).toBeGreaterThan(LIMIT_LB);
    const ins = inspect(b, heavy, { weightLb: '249' });
    expect(ins.forfeit).toBe(true);
    const e = ins.entries.find((x) => x.id === 'weightLb')!;
    expect(e.ok).toBe(false);
    expect(e.cost).toMatch(/forfeit/i);
    expect(ins.perfect).toBe(false);
  });
  it('a correct claim on a legal robot passes the weigh-in', () => {
    const legal = fitToWeight(b.starter(), 246 * KG_PER_LB);
    const lb = lbOf(legal);
    expect(lb).toBeLessThanOrEqual(LIMIT_LB);
    const ins = inspect(b, legal, { weightLb: lb.toFixed(1) });
    expect(ins.forfeit).toBe(false);
    expect(ins.entries[0].ok).toBe(true);
    expect(ins.entries[0].cost).toBeUndefined();
  });
  it('an honest claim of an overweight robot still forfeits: the scale decides', () => {
    const heavy = b.starter();
    expect(inspect(b, heavy, { weightLb: lbOf(heavy).toFixed(1) }).forfeit).toBe(true);
  });
});

describe('Design Office: tolerance edges', () => {
  it('weight: ±1 lb, just inside passes and just outside fails', () => {
    expect(withinTolerance('weightLb', 245.99, 245)).toBe(true);
    expect(withinTolerance('weightLb', 244.01, 245)).toBe(true);
    expect(withinTolerance('weightLb', 246.01, 245)).toBe(false);
    expect(withinTolerance('weightLb', 243.99, 245)).toBe(false);
  });
  it('everything else: ±3% of the true value', () => {
    expect(withinTolerance('topSpeedMph', 20.59, 20)).toBe(true); // +2.95%
    expect(withinTolerance('topSpeedMph', 19.41, 20)).toBe(true); // −2.95%
    expect(withinTolerance('topSpeedMph', 20.61, 20)).toBe(false); // +3.05%
    expect(withinTolerance('topSpeedMph', 19.39, 20)).toBe(false); // −3.05%
    expect(withinTolerance('energyKJ', null, 20)).toBe(false);
  });
  it('inspection on a real design: 2.9% off is correct, 3.1% off reveals the true value and its cost', () => {
    const b = BRIEFS.find((x) => x.hidden.includes('topSpeedMph'))!;
    const d = b.starter();
    const truth = computeStats(d).topSpeedMph;
    const inside = inspect(b, d, { topSpeedMph: String(truth * 1.029) }).entries[0];
    expect(inside.ok).toBe(true);
    const outside = inspect(b, d, { topSpeedMph: String(truth * 1.031) }).entries[0];
    expect(outside.ok).toBe(false);
    expect(outside.cost).toContain('you got');
    expect(outside.got).toContain(truth.toFixed(1));
  });
  it('a missed runtime under 3:00 says the pack runs short of the fight', () => {
    const b = BRIEFS.find((x) => x.hidden.includes('runtimeMin'))!;
    const d = b.starter();
    expect(runtimeMinutes(d)).toBeLessThan(3);
    const e = inspect(b, d, { runtimeMin: '3:30', weightLb: '0' }).entries.find((x) => x.id === 'runtimeMin')!;
    expect(e.ok).toBe(false);
    expect(e.cost).toMatch(/fight is 3:00/);
  });
  it('runtime entries take m:ss or decimal minutes', () => {
    expect(parseEntry('runtimeMin', '2:45')).toBeCloseTo(2.75, 9);
    expect(parseEntry('runtimeMin', '2.75')).toBeCloseTo(2.75, 9);
    expect(parseEntry('weightLb', '249.5 lb')).toBe(249.5);
    expect(parseEntry('weightLb', '')).toBeNull();
  });
});

describe('Design Office: the season', () => {
  it('about 8 briefs, each hides 1 to 3 numbers and names a roster opponent', () => {
    expect(BRIEFS.length).toBeGreaterThanOrEqual(7);
    expect(BRIEFS.length).toBeLessThanOrEqual(9);
    for (const b of BRIEFS) {
      expect(b.hidden.length, b.id).toBeGreaterThanOrEqual(1);
      expect(b.hidden.length, b.id).toBeLessThanOrEqual(3);
      expect(ROSTER.some((r) => r.id === b.opponent), b.id).toBe(true);
    }
  });
  it('copy stays generic: no team captain from the robot files appears in a brief', () => {
    // capitalised words from the captain field (Ray, Billings, ...), minus the era labels
    const names = new Set((lore as { captain: string | null }[])
      .flatMap((l) => (l.captain ?? '').match(/\b[A-Z][a-z]+\b/g) ?? [])
      .filter((w) => !['Champions', 'FaceOffs'].includes(w)));
    expect(names.size).toBeGreaterThan(20);
    for (const b of BRIEFS) {
      const d = b.starter();
      const words = new Set([b.team, b.title, b.text, b.think ?? '', d.name, d.team].join(' ').match(/\b[A-Za-z]+\b/g));
      for (const n of names) expect(words.has(n), `${b.id} mentions ${n}`).toBe(false);
    }
  });
});
