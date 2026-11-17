// Design Office: a season of design briefs. The player builds to a spec in the
// Garage with some derived stats hidden, works those numbers out by hand from
// a reference card, and tech inspection checks every claim against the same
// functions the fights use. Nothing here is a second physics model: each true
// value comes from computeStats / runtimeMinutes / ratioFor / weaponRatioFor /
// chassisHull, and each card formula is that function written out for a
// calculator. tests/briefs.test.ts pins the card against the sim.

import { BotDesign, computeStats, kgToLb, panelAreas, ratioFor, rotorInertia, runtimeMinutes, weaponRatioFor } from './design';
import { ENGINE, IN, LB, MATERIALS, MOTORS, WEIGHT_LIMIT_LB } from './parts';
import { chassisHull } from './bot';
import { ROSTER } from './roster';
import type { AILevel } from './ai';

export type QuantityId =
  | 'weightLb' | 'armorMm' | 'topSpeedMph' | 'weaponRpm' | 'tipSpeedMph' | 'driveRatio' | 'weaponRatio'
  | 'energyKJ' | 'runtimeMin' | 'slope' | 'sideMm' | 'topMm';

/** Inspection tolerance: ±3% of the true value; weight ±1 lb. */
export const REL_TOL = 0.03;
export const WEIGHT_TOL_LB = 1;
/** The fight is three minutes. A pack rated for less runs short. */
export const FIGHT_MINUTES = 3;

/** Shared card constants. Every one is a number the sim itself uses. */
export const CARD_CONSTANTS: { label: string; value: string }[] = [
  { label: '1 lb', value: '0.45359237 kg' },
  { label: '1 in', value: '0.0254 m' },
  { label: '1 mile', value: '5280 ft' },
  { label: 'π', value: '3.14159' },
  { label: 'LiPo cell, nominal', value: '3.7 V (for watt-hours)' },
  { label: 'LiPo cell, under load', value: '3.85 V (for motor speed)' },
];

export interface CardInput { key: string; label: string; value: number; unit: string; digits: number }
export interface CardSection { id: QuantityId; title: string; formula: string[]; inputs: CardInput[] }

export interface Brief {
  id: string;
  n: number;
  team: string;
  title: string;
  topic: string;
  text: string;
  /** an ungraded question to think about */
  think?: string;
  hidden: QuantityId[];
  specs: Spec[];
  opponent: string;
  ai: AILevel;
  starter: () => BotDesign;
  /** targets for the solve-for-one-unknown quantities */
  targetLb?: number;
  targetMph?: number;
  targetRpm?: number;
  /** system brief: side plates are this many times as thick as the top plate */
  sideToTop?: number;
}

export interface SpecResult { label: string; ok: boolean; got: string }
export interface Spec { label: string; check: (d: BotDesign) => SpecResult }

const round = (v: number, digits: number) => { const f = 10 ** digits; return Math.round(v * f) / f; };
const inp = (key: string, label: string, raw: number, unit: string, digits: number): CardInput => ({ key, label, value: round(raw, digits), unit, digits });

export function fmtMinutes(min: number) {
  if (!Number.isFinite(min)) return '—';
  const s = Math.round(min * 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------- the quantities ----------------

interface QuantityDef {
  label: string;
  unit: string;
  fmt: (v: number) => string;
  /** absolute tolerance in the quantity's unit, else REL_TOL */
  absTol?: number;
  formula: (b: Brief) => string[];
  inputs: (d: BotDesign, b: Brief) => CardInput[];
  actual: (d: BotDesign, b: Brief) => number;
}

const spinner = (d: BotDesign) => (d.weapon.type === 'spinner' ? d.weapon : null);
const isEngine = (d: BotDesign) => d.weapon.type === 'spinner' && d.weapon.motor === 'ice-engine';
const restKg = (d: BotDesign, without: string[]) =>
  computeStats(d).massItems.filter((i) => !without.some((p) => i.label.startsWith(p))).reduce((s, i) => s + i.kg, 0);
/** Electric weapon motors run at 93% of free speed against windage and belt slip. */
const WEAPON_FACTOR = 0.93;
const DRIVE_FACTOR = 0.86;

/** The nose of the collider hull: the top front edge and the tip, measured in inches from the chassis center (x) and from the floor (y). */
export function noseProfile(d: BotDesign) {
  const h = chassisHull(d);
  const floor = d.chassis.height / 2 + d.chassis.clearance;
  let tip = { x: -Infinity, y: Infinity }, top = { x: -Infinity, y: -Infinity };
  for (let i = 0; i < h.length; i += 3) {
    const x = h[i], y = h[i + 1];
    if (x > tip.x + 1e-6 || (Math.abs(x - tip.x) <= 1e-6 && y < tip.y)) tip = { x, y };
    if (y > top.y + 1e-6 || (Math.abs(y - top.y) <= 1e-6 && x > top.x)) top = { x, y };
  }
  return { topX: top.x / IN, topY: (top.y + floor) / IN, tipX: tip.x / IN, tipY: (tip.y + floor) / IN };
}

export const QUANTITIES: Record<QuantityId, QuantityDef> = {
  weightLb: {
    label: 'Weight', unit: 'lb', absTol: WEIGHT_TOL_LB, fmt: (v) => `${v.toFixed(1)} lb`,
    formula: () => ['weight (lb) = sum of every part (kg) ÷ 0.45359237', 'The limit is 250.0 lb. Over it is a forfeit.'],
    inputs: (d) => computeStats(d).massItems.map((m, i) => inp(`item${i}`, m.label, m.kg, 'kg', 2)),
    actual: (d) => kgToLb(computeStats(d).mass),
  },
  armorMm: {
    label: 'Top plate thickness', unit: 'mm', fmt: (v) => `${v.toFixed(2)} mm`,
    formula: (b) => [
      `target mass (kg) = ${b.targetLb} lb × 0.45359237`,
      'plate mass (kg) = target mass − everything else',
      'plate mass = area (m²) × thickness (m) × density, so thickness = plate mass ÷ (area × density)',
      'area (m²) = area (in²) × 0.0254 × 0.0254; thickness (mm) = thickness (m) × 1000',
    ],
    inputs: (d, b) => [
      inp('targetLb', 'Target weight', b.targetLb ?? 249, 'lb', 1),
      inp('restKg', 'Everything except the top plate', restKg(d, ['Top armor']), 'kg', 2),
      inp('areaIn2', 'Top plate area', panelAreas(d).top / (IN * IN), 'in²', 1),
      inp('density', `${MATERIALS[d.chassis.armor.top.material].name} density`, MATERIALS[d.chassis.armor.top.material].density, 'kg/m³', 0),
    ],
    actual: (d, b) => {
      const plate = (b.targetLb ?? 249) * LB - restKg(d, ['Top armor']);
      return (plate / (panelAreas(d).top * MATERIALS[d.chassis.armor.top.material].density)) * 1000;
    },
  },
  topSpeedMph: {
    label: 'Top speed', unit: 'mph', fmt: (v) => `${v.toFixed(1)} mph`,
    formula: () => [
      'motor rpm = Kv × cells × 3.85 V',
      'wheel rpm = motor rpm ÷ gear reduction',
      'feet per minute = wheel rpm × π × wheel diameter (in) ÷ 12',
      `mph = feet per minute × 60 ÷ 5280 × ${DRIVE_FACTOR} (tire slip and gearbox losses)`,
    ],
    inputs: (d) => [
      inp('kv', `Drive motor Kv (${MOTORS[d.drive.motor].name})`, MOTORS[d.drive.motor].kv, 'rpm/V', 0),
      inp('cells', 'Cells in series', d.battery.cellsS, 'S', 0),
      inp('ratio', 'Gear reduction', d.drive.ratio, ':1', 2),
      inp('wheelIn', 'Wheel diameter', d.drive.wheelDiameter / IN, 'in', 2),
    ],
    actual: (d) => computeStats(d).topSpeedMph,
  },
  weaponRpm: {
    label: 'Weapon rpm', unit: 'rpm', fmt: (v) => `${Math.round(v).toLocaleString()} rpm`,
    formula: () => [
      `electric: rotor rpm = Kv × cells × 3.85 V × ${WEAPON_FACTOR} ÷ belt ratio (${WEAPON_FACTOR} = windage and belt slip at full speed)`,
      `engine: rotor rpm = ${ENGINE.maxRpm} governed rpm ÷ belt ratio`,
    ],
    inputs: (d) => {
      const w = spinner(d);
      if (!w) return [];
      if (isEngine(d)) return [inp('governed', 'Engine governed speed', ENGINE.maxRpm, 'rpm', 0), inp('ratio', 'Belt ratio', w.ratio, ':1', 2)];
      return [
        inp('kv', `Weapon motor Kv (${MOTORS[w.motor].name})`, MOTORS[w.motor].kv, 'rpm/V', 0),
        inp('cells', 'Cells in series', d.battery.cellsS, 'S', 0),
        inp('ratio', 'Belt ratio', w.ratio, ':1', 2),
      ];
    },
    actual: (d) => computeStats(d).weapon?.maxRpm ?? NaN,
  },
  tipSpeedMph: {
    label: 'Tip speed', unit: 'mph', fmt: (v) => `${v.toFixed(0)} mph`,
    formula: (b) => [
      'distance per turn (in) = π × rotor diameter (in)',
      `inches per minute = distance per turn × rotor rpm${b.hidden.includes('weaponRpm') ? ' (use your weapon rpm answer)' : ''}`,
      'mph = inches per minute ÷ 12 ÷ 5280 × 60',
      'BattleBots caps tip speed at 250 mph.',
    ],
    inputs: (d, b) => {
      const w = spinner(d);
      if (!w) return [];
      const out = [inp('diaIn', 'Rotor diameter', (w.radius * 2) / IN, 'in', 2)];
      if (!b.hidden.includes('weaponRpm')) out.push(inp('rpm', 'Rotor rpm', computeStats(d).weapon!.maxRpm, 'rpm', 0));
      return out;
    },
    actual: (d) => computeStats(d).weapon?.tipSpeedMph ?? NaN,
  },
  driveRatio: {
    label: 'Drive gear reduction', unit: ':1', fmt: (v) => `${v.toFixed(2)}:1`,
    formula: (b) => [
      'top speed is proportional to 1 ÷ gear reduction, so solve the top speed formula for the reduction:',
      `gear reduction = Kv × cells × 3.85 × π × wheel diameter (in) ÷ 12 × 60 ÷ 5280 × ${DRIVE_FACTOR} ÷ ${b.targetMph} mph`,
    ],
    inputs: (d, b) => [
      inp('target', 'Target top speed', b.targetMph ?? 15, 'mph', 1),
      inp('kv', `Drive motor Kv (${MOTORS[d.drive.motor].name})`, MOTORS[d.drive.motor].kv, 'rpm/V', 0),
      inp('cells', 'Cells in series', d.battery.cellsS, 'S', 0),
      inp('wheelIn', 'Wheel diameter', d.drive.wheelDiameter / IN, 'in', 2),
    ],
    actual: (d, b) => ratioFor(b.targetMph ?? 15, d.drive.wheelDiameter, d.drive.motor, d.battery.cellsS),
  },
  weaponRatio: {
    label: 'Weapon belt ratio', unit: ':1', fmt: (v) => `${v.toFixed(2)}:1`,
    formula: (b) => [
      'rotor rpm is proportional to 1 ÷ belt ratio, so:',
      `electric: belt ratio = Kv × cells × 3.85 × ${WEAPON_FACTOR} ÷ ${b.targetRpm} rpm`,
      `engine: belt ratio = ${ENGINE.maxRpm} ÷ ${b.targetRpm} rpm`,
    ],
    inputs: (d, b) => {
      const w = spinner(d);
      if (!w) return [];
      const t = inp('target', 'Target rotor speed', b.targetRpm ?? 3000, 'rpm', 0);
      if (isEngine(d)) return [t, inp('governed', 'Engine governed speed', ENGINE.maxRpm, 'rpm', 0)];
      return [t, inp('kv', `Weapon motor Kv (${MOTORS[w.motor].name})`, MOTORS[w.motor].kv, 'rpm/V', 0), inp('cells', 'Cells in series', d.battery.cellsS, 'S', 0)];
    },
    actual: (d, b) => { const sw = spinner(d); return sw ? weaponRatioFor(b.targetRpm ?? 3000, sw.motor, d.battery.cellsS) : NaN; },
  },
  energyKJ: {
    label: 'Stored energy', unit: 'kJ', fmt: (v) => `${v.toFixed(1)} kJ`,
    formula: (b) => [
      'mass (kg) = rotor weight (lb) × 0.45359237; radius (m) = diameter (in) ÷ 2 × 0.0254',
      'moment of inertia I = k × mass × radius²  (k says how much of the mass is out at the rim)',
      `ω (rad/s) = rotor rpm × 2π ÷ 60${b.hidden.includes('weaponRpm') ? ' (use your weapon rpm answer)' : ''}`,
      'energy (J) = ½ × I × ω²; kJ = J ÷ 1000',
    ],
    inputs: (d, b) => {
      const w = spinner(d);
      if (!w) return [];
      const k = rotorInertia({ ...w, rotorMass: 1, radius: 1 });
      const out = [
        inp('k', `Shape factor k (${w.style})`, k, '', 2),
        inp('massLb', 'Rotor weight', w.rotorMass / LB, 'lb', 2),
        inp('diaIn', 'Rotor diameter', (w.radius * 2) / IN, 'in', 2),
      ];
      if (!b.hidden.includes('weaponRpm')) out.push(inp('rpm', 'Rotor rpm', computeStats(d).weapon!.maxRpm, 'rpm', 0));
      return out;
    },
    actual: (d) => computeStats(d).weapon?.energyKJ ?? NaN,
  },
  runtimeMin: {
    label: 'Runtime', unit: 'min', fmt: fmtMinutes,
    formula: () => [
      'watt-hours = cells × 3.7 V × amp-hours × packs',
      'usable watt-hours = 80% of that (LiPos are not run flat)',
      'average draw (W) = drive + weapon + electronics',
      'runtime (minutes) = usable watt-hours ÷ average draw × 60',
    ],
    inputs: (d) => {
      const s = computeStats(d);
      const dm = MOTORS[d.drive.motor];
      const driveW = 2 * d.drive.motorsPerSide * dm.maxCurrent * s.nominalV * 0.12;
      const total = (runtimeMinutes(d) > 0) ? (s.batteryWh * 0.8 * 60) / runtimeMinutes(d) : 0;
      return [
        inp('cells', 'Cells in series', d.battery.cellsS, 'S', 0),
        inp('ah', 'Capacity per pack', d.battery.capacityAh, 'Ah', 1),
        inp('packs', 'Packs in parallel', d.battery.packs, '', 0),
        inp('driveW', 'Average drive draw', driveW, 'W', 0),
        inp('weaponW', 'Average weapon draw', total - driveW - 40, 'W', 0),
        inp('elecW', 'Electronics', 40, 'W', 0),
      ];
    },
    actual: (d) => runtimeMinutes(d),
  },
  slope: {
    label: 'Front wedge slope', unit: '', fmt: (v) => v.toFixed(2),
    formula: () => [
      'slope = rise ÷ run between two points on the wedge',
      'rise = top edge height − tip height; run = tip position − top edge position',
    ],
    inputs: (d) => {
      const n = noseProfile(d);
      return [
        inp('topY', 'Top front edge, height above the floor', n.topY, 'in', 2),
        inp('topX', 'Top front edge, forward of center', n.topX, 'in', 2),
        inp('tipY', 'Wedge tip, height above the floor', n.tipY, 'in', 2),
        inp('tipX', 'Wedge tip, forward of center', n.tipX, 'in', 2),
      ];
    },
    actual: (d) => { const n = noseProfile(d); return (n.topY - n.tipY) / (n.tipX - n.topX); },
  },
  sideMm: {
    label: 'Side plate thickness', unit: 'mm', fmt: (v) => `${v.toFixed(2)} mm`,
    formula: (b) => systemFormula(b),
    inputs: (d, b) => systemInputs(d, b),
    actual: (d, b) => systemSolve(d, b).side,
  },
  topMm: {
    label: 'Top plate thickness', unit: 'mm', fmt: (v) => `${v.toFixed(2)} mm`,
    formula: () => ['(same system: one answer for each unknown)'],
    inputs: () => [],
    actual: (d, b) => systemSolve(d, b).top,
  },
};

function systemFormula(b: Brief) {
  const c = b.sideToTop ?? 2;
  return [
    'Two unknowns, two equations. Let s = side thickness (mm), t = top thickness (mm).',
    `(1) s = ${c} × t`,
    `(2) side area (m²) × side density × s ÷ 1000 + top area (m²) × top density × t ÷ 1000 = ${b.targetLb} lb × 0.45359237 − everything else (kg)`,
    'Substitute (1) into (2), solve for t, then s. Areas: in² × 0.0254 × 0.0254.',
  ];
}
function systemInputs(d: BotDesign, b: Brief): CardInput[] {
  const A = panelAreas(d), arm = d.chassis.armor;
  return [
    inp('targetLb', 'Target weight', b.targetLb ?? 249, 'lb', 1),
    inp('ratio', 'Side to top thickness', b.sideToTop ?? 2, '×', 1),
    inp('restKg', 'Everything except side and top plates', restKg(d, ['Side armor', 'Top armor']), 'kg', 2),
    inp('sideAreaIn2', 'Side plates, total area', A.sides / (IN * IN), 'in²', 1),
    inp('sideDensity', `${MATERIALS[arm.sides.material].name} density`, MATERIALS[arm.sides.material].density, 'kg/m³', 0),
    inp('topAreaIn2', 'Top plate area', A.top / (IN * IN), 'in²', 1),
    inp('topDensity', `${MATERIALS[arm.top.material].name} density`, MATERIALS[arm.top.material].density, 'kg/m³', 0),
  ];
}
function systemSolve(d: BotDesign, b: Brief) {
  const A = panelAreas(d), arm = d.chassis.armor, c = b.sideToTop ?? 2;
  const plates = (b.targetLb ?? 249) * LB - restKg(d, ['Side armor', 'Top armor']);
  const perMm = (A.sides * MATERIALS[arm.sides.material].density * c + A.top * MATERIALS[arm.top.material].density) / 1000;
  const top = plates / perMm;
  return { top, side: top * c };
}

/** The reference card for a brief and a design: one section per hidden quantity. */
export function referenceCard(b: Brief, d: BotDesign): CardSection[] {
  return b.hidden.map((id) => ({ id, title: QUANTITIES[id].label, formula: QUANTITIES[id].formula(b), inputs: QUANTITIES[id].inputs(d, b) }));
}

// ---------------- what the Garage hides ----------------

export interface GarageMask {
  weight?: boolean;
  /** show the mass table in kg instead of lb */
  massKg?: boolean;
  /** mass table rows (by label prefix) shown as ?? */
  massRows?: string[];
  topSpeed?: boolean;
  weaponRpm?: boolean;
  tipSpeed?: boolean;
  energy?: boolean;
  inertia?: boolean;
  runtime?: boolean;
}

export function garageMask(b: Brief): GarageMask {
  const m: GarageMask = {};
  for (const q of b.hidden) {
    if (q === 'weightLb') { m.weight = true; m.massKg = true; }
    if (q === 'armorMm') { m.weight = true; m.massKg = true; m.massRows = [...(m.massRows ?? []), 'Top armor']; }
    if (q === 'sideMm' || q === 'topMm') { m.weight = true; m.massKg = true; m.massRows = [...(m.massRows ?? []), 'Side armor', 'Top armor']; }
    if (q === 'topSpeedMph' || q === 'driveRatio') m.topSpeed = true;
    if (q === 'weaponRpm' || q === 'weaponRatio') { m.weaponRpm = true; m.tipSpeed = true; m.energy = true; }
    if (q === 'tipSpeedMph') m.tipSpeed = true;
    if (q === 'energyKJ') { m.energy = true; m.inertia = true; }
    if (q === 'runtimeMin') m.runtime = true;
  }
  return m;
}

// ---------------- tech inspection ----------------

/** Parse what the player typed. Runtime takes m:ss or decimal minutes. Units and commas are ignored. */
export function parseEntry(id: QuantityId, raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim().replace(/,/g, '');
  if (!s) return null;
  if (id === 'runtimeMin') {
    const m = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(s);
    if (m) return Number(m[1]) + Number(m[2]) / 60;
  }
  const n = parseFloat(s.replace(/^[^\d.-]+/, ''));
  return Number.isFinite(n) ? n : null;
}

/** Is a claim inside the inspection tolerance? Weight: ±1 lb. Everything else: ±3%. */
export function withinTolerance(id: QuantityId, claimed: number | null, actual: number) {
  if (claimed == null || !Number.isFinite(actual)) return false;
  const abs = QUANTITIES[id].absTol;
  const bound = abs ?? REL_TOL * Math.abs(actual);
  return Math.abs(claimed - actual) <= bound + 1e-9;
}

/** Solve-for-the-unknown quantities: the true value is what the brief's target needs, not what the robot has. */
const SOLVED: QuantityId[] = ['armorMm', 'driveRatio', 'weaponRatio', 'sideMm', 'topMm'];

export interface EntryCheck { id: QuantityId; label: string; claimed: number | null; actual: number; ok: boolean; designedFor: string; got: string; cost?: string }
export interface Inspection { entries: EntryCheck[]; specs: SpecResult[]; forfeit: boolean; forfeitReason?: string; perfect: boolean; realLb: number }

export function inspect(b: Brief, d: BotDesign, raw: Partial<Record<QuantityId, string>>): Inspection {
  const realLb = kgToLb(computeStats(d).mass);
  const overweight = realLb > WEIGHT_LIMIT_LB + 1e-9;
  const entries: EntryCheck[] = b.hidden.map((id) => {
    const q = QUANTITIES[id];
    const claimed = parseEntry(id, raw[id]);
    const actual = q.actual(d, b);
    const ok = withinTolerance(id, claimed, actual);
    const e: EntryCheck = {
      id, label: q.label, claimed, actual, ok,
      designedFor: claimed == null ? 'no answer' : q.fmt(claimed),
      got: Number.isFinite(actual) ? q.fmt(actual) : 'n/a',
    };
    if (!ok) {
      if (id === 'weightLb' && overweight) {
        e.cost = `Fails the weigh-in: the scale reads ${realLb.toFixed(1)} lb, over 250.0. Forfeit, no fight.`;
      } else if (id === 'runtimeMin' && actual < FIGHT_MINUTES) {
        e.cost = `The pack is rated for ${fmtMinutes(actual)} and the fight is ${fmtMinutes(FIGHT_MINUTES)}. It fights anyway, on true physics: the pack drains with every amp and its voltage sags as it empties.`;
      } else if (SOLVED.includes(id)) {
        e.cost = `The brief's target needs ${e.got}; you worked out ${e.designedFor}. The robot fights as you built it: ${realLb.toFixed(1)} lb.`;
      } else {
        e.cost = `You designed for ${e.designedFor}, you got ${e.got}. The fight runs on ${e.got}.`;
      }
    }
    return e;
  });
  const specs = b.specs.map((s) => s.check(d));
  const forfeit = overweight;
  return {
    entries, specs, forfeit, realLb,
    forfeitReason: forfeit ? `Weigh-in: ${realLb.toFixed(1)} lb on a 250.0 lb limit. Forfeit.` : undefined,
    perfect: !forfeit && entries.every((e) => e.ok) && specs.every((s) => s.ok),
  };
}

// ---------------- spec lines ----------------

const statSpec = (label: string, get: (d: BotDesign) => number, ok: (v: number) => boolean, fmt: (v: number) => string): Spec => ({
  label,
  check: (d) => { const v = get(d); return { label, ok: Number.isFinite(v) && ok(v), got: Number.isFinite(v) ? fmt(v) : 'n/a' }; },
});
const lb = (d: BotDesign) => kgToLb(computeStats(d).mass);
const mph = (d: BotDesign) => computeStats(d).topSpeedMph;
const w = (d: BotDesign) => computeStats(d).weapon;
const f1 = (u: string) => (v: number) => `${v.toFixed(1)} ${u}`;

export const SPEC = {
  weight: (min: number) => statSpec(`Weight ${min.toFixed(1)}–250.0 lb`, lb, (v) => v >= min && v <= WEIGHT_LIMIT_LB, f1('lb')),
  speedMin: (min: number) => statSpec(`Top speed ≥ ${min} mph`, mph, (v) => v >= min, f1('mph')),
  speedBand: (lo: number, hi: number) => statSpec(`Top speed ${lo}–${hi} mph`, mph, (v) => v >= lo && v <= hi, f1('mph')),
  rpmBand: (lo: number, hi: number) => statSpec(`Weapon ${lo.toLocaleString()}–${hi.toLocaleString()} rpm`, (d) => w(d)?.maxRpm ?? NaN, (v) => v >= lo && v <= hi, (v) => `${Math.round(v).toLocaleString()} rpm`),
  tipBand: (lo: number, hi: number) => statSpec(`Tip speed ${lo}–${hi} mph`, (d) => w(d)?.tipSpeedMph ?? NaN, (v) => v >= lo && v <= hi, (v) => `${v.toFixed(0)} mph`),
  energyMin: (min: number) => statSpec(`Stored energy ≥ ${min} kJ`, (d) => w(d)?.energyKJ ?? NaN, (v) => v >= min, f1('kJ')),
  runtimeMin: (min: number) => statSpec(`Runtime ≥ ${fmtMinutes(min)}`, runtimeMinutes, (v) => v >= min, fmtMinutes),
  slopeMax: (max: number) => statSpec(`Front wedge slope ≤ ${max}`, (d) => QUANTITIES.slope.actual(d, {} as Brief), (v) => v <= max, (v) => v.toFixed(2)),
  vertical: (): Spec => ({
    label: 'Vertical spinner (disk, bar, drum or eggbeater)',
    check: (d) => {
      const s = d.weapon.type === 'spinner' ? d.weapon.style : d.weapon.type;
      return { label: 'Vertical spinner (disk, bar, drum or eggbeater)', ok: ['vertical-disk', 'vertical-bar', 'drum', 'eggbeater'].includes(s), got: s };
    },
  }),
};

// ---------------- the season ----------------

/** A brief's starting chassis: a roster design with its blueprint dropped (so every Garage slider is the real geometry), renamed, armor scaled. */
function starter(rosterId: string, name: string, f?: (d: BotDesign) => void): () => BotDesign {
  return () => {
    const src = ROSTER.find((b) => b.id === rosterId)!;
    const d: BotDesign = structuredClone(src);
    d.chassis.blueprint = undefined;
    d.id = `office-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    d.name = name;
    d.team = 'Design Office';
    d.look = { ...d.look, logo: name.toUpperCase(), features: [] };
    f?.(d);
    return d;
  };
}
const scaleArmor = (d: BotDesign, k: number) => {
  for (const p of Object.values(d.chassis.armor)) p.thickness = Math.round(p.thickness * k * 10) / 10;
};

export const BRIEFS: Brief[] = [
  {
    id: 'b1', n: 1, team: 'Gearhouse Robotics', title: 'Make weight',
    topic: 'Weight budget: an inequality, and pounds to kilograms',
    text: 'Our vertical disk came back from the fab shop heavy, and the shop scale is broken. The parts list is in kilograms. Trim it until the whole robot is between 240 and 250 lb, then tell the inspector what it weighs.',
    think: 'Write the weigh-in rule as an inequality in kilograms. How many kilograms is 250 lb?',
    hidden: ['weightLb'],
    specs: [SPEC.weight(240), SPEC.vertical()],
    opponent: 'bronco', ai: 'rookie',
    starter: starter('witch-doctor', 'Gearhouse GH-1'),
  },
  {
    id: 'b2', n: 2, team: 'Northside Shop Class', title: 'Plate it to the limit',
    topic: 'Solve for one unknown: a linear equation',
    text: 'Every pound under the limit is armor we left on the table. Pick the top plate thickness that puts the robot at exactly 249 lb, set it, and write it on the spec sheet.',
    think: 'Plate mass is area × thickness × density. Which of those three is the unknown?',
    hidden: ['armorMm'], targetLb: 249,
    specs: [SPEC.weight(247)],
    opponent: 'lock-jaw', ai: 'rookie',
    starter: starter('tombstone', 'Northside NS-2', (d) => scaleArmor(d, 0.8)),
  },
  {
    id: 'b3', n: 3, team: 'Ironwood Fab', title: 'Catch the runner',
    topic: 'Rates and unit conversion: rpm to mph',
    text: 'This one is geared for pushing and it can\'t catch anything. We need at least 15 mph. Change the gearing or the wheels, then work out the top speed yourself.',
    think: 'One wheel turn moves the robot one circumference. How far is that in feet?',
    hidden: ['topSpeedMph'],
    specs: [SPEC.speedMin(15), SPEC.weight(235)],
    opponent: 'sawblaze', ai: 'rookie',
    starter: starter('bite-force', 'Ironwood IW-3', (d) => { d.drive.ratio = 12; }),
  },
  {
    id: 'b4', n: 4, team: 'Team Lowgear', title: 'Inside the rule',
    topic: 'Rates: rotor rpm and tip speed',
    text: 'The inspector will measure tip speed, and the rule is 250 mph. Ours is too hot. Re-gear the weapon to land between 180 and 250 mph, and show your rpm and tip speed.',
    hidden: ['weaponRpm', 'tipSpeedMph'],
    specs: [SPEC.tipBand(180, 250), SPEC.weight(235)],
    opponent: 'copperhead', ai: 'veteran',
    starter: starter('whiplash', 'Lowgear LG-4'),
  },
  {
    id: 'b5', n: 5, team: 'Hangar Nine', title: 'Gear to the number',
    topic: 'Proportions: the ratio for a target speed',
    text: 'The driver wants 16 mph on the ground and 3,000 rpm on the drum. Work out the drive reduction and the belt ratio that hit those numbers, then set them.',
    think: 'If you double the reduction, what happens to the speed?',
    hidden: ['driveRatio', 'weaponRatio'], targetMph: 16, targetRpm: 3000,
    specs: [SPEC.speedBand(15, 17), SPEC.rpmBand(2850, 3150), SPEC.weight(235)],
    opponent: 'hydra', ai: 'veteran',
    starter: starter('copperhead', 'Hangar H9-5', (d) => scaleArmor(d, 0.85)),
  },
  {
    id: 'b6', n: 6, team: 'Flywheel Collective', title: 'Store the hit',
    topic: 'Squares and exponents: ½·I·ω²',
    text: 'Our bar spinner taps people instead of hurting them. We need at least 30 kJ in the rotor, without breaking the 250 mph tip rule or the weight limit. Show the stored energy.',
    think: 'Double the rpm or double the radius: which one multiplies the energy by more, and by how much?',
    hidden: ['energyKJ'],
    specs: [SPEC.energyMin(30), SPEC.tipBand(0, 250), SPEC.weight(235)],
    opponent: 'bite-force', ai: 'veteran',
    starter: starter('lock-jaw', 'Flywheel FC-6'),
  },
  {
    id: 'b7', n: 7, team: 'Last Bell Robotics', title: 'Make it to the bell',
    topic: 'Rates: watt-hours and average draw',
    text: 'Big disk, small battery: this robot dies before the final bell. Get the runtime to at least 3:00 while keeping 40 kJ or more on the disk. Batteries weigh something, so tell us the weight too.',
    hidden: ['runtimeMin', 'weightLb'],
    specs: [SPEC.runtimeMin(3), SPEC.energyMin(40), SPEC.weight(235)],
    opponent: 'witch-doctor', ai: 'champion',
    starter: starter('end-game', 'Last Bell LB-7', (d) => scaleArmor(d, 0.9)),
  },
  {
    id: 'b8', n: 8, team: 'Redline Works', title: 'The finale wedge',
    topic: 'Slope, and a system of two equations',
    text: 'Season finale. The wedge has to get under spinners: front slope 0.60 or flatter. The side plates take the hits, so they are twice as thick as the top. Solve both plate thicknesses so the robot weighs exactly 249 lb.',
    think: 'A steeper wedge has a bigger or smaller slope?',
    hidden: ['slope', 'sideMm', 'topMm'], targetLb: 249, sideToTop: 2,
    specs: [SPEC.slopeMax(0.6), SPEC.weight(247)],
    opponent: 'tombstone', ai: 'champion',
    starter: starter('hypershock', 'Redline RW-8', (d) => { d.chassis.shape = 'wedge'; d.chassis.wedgeLength = 6 * IN; }),
  },
];

export const briefById = (id: string) => BRIEFS.find((b) => b.id === id);
