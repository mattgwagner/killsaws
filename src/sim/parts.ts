// Parts catalog: armor materials, motors, tires, batteries.
// Numbers are representative of what heavyweight (250 lb) builders actually
// run. Motor constants follow the standard DC model: Kt = 60 / (2π·Kv).

export const LB = 0.45359237; // kg per lb
export const IN = 0.0254; // m per inch
export const MPH = 0.44704; // m/s per mph
export const WEIGHT_LIMIT_LB = 250;
export const WEIGHT_LIMIT_KG = WEIGHT_LIMIT_LB * LB;

export const rpmToRad = (rpm: number) => (rpm * 2 * Math.PI) / 60;
export const radToRpm = (w: number) => (w * 60) / (2 * Math.PI);

export type MaterialId = 'ar500' | 'hardox' | 'titanium' | 'al7075' | 'uhmw' | 'polycarb' | 's7';

export interface Material {
  id: MaterialId;
  name: string;
  density: number; // kg/m^3
  /** Impact energy a 1 mm x 1 m^2 panel soaks up before it's spent (J). */
  toughness: number;
  /** 0..1 how much a hit chips it vs dents it; harder = more sparks, more shatter. */
  hardness: number;
  /** Coefficient of friction against the steel floor. */
  floorFriction: number;
  spark: number; // 0..1 spark intensity when struck
  blurb: string;
}

export const MATERIALS: Record<MaterialId, Material> = {
  ar500: {
    id: 'ar500', name: 'AR500 steel', density: 7850, toughness: 24000, hardness: 0.8,
    floorFriction: 0.3, spark: 1,
    blurb: 'Through-hardened abrasion-resistant plate. Heavy, cheap, takes a beating.',
  },
  hardox: {
    id: 'hardox', name: 'Hardox 500', density: 7850, toughness: 26000, hardness: 0.85,
    floorFriction: 0.3, spark: 1,
    blurb: 'Swedish wear plate. The go-to wedge material for spinner fights.',
  },
  s7: {
    id: 's7', name: 'S7 tool steel', density: 7830, toughness: 30000, hardness: 0.9,
    floorFriction: 0.3, spark: 1,
    blurb: 'Shock-resisting tool steel, heat treated. Weapon bars and teeth are made of it.',
  },
  titanium: {
    id: 'titanium', name: 'Titanium Ti-6Al-4V', density: 4430, toughness: 22000, hardness: 0.6,
    floorFriction: 0.35, spark: 1.4,
    blurb: 'Grade 5 titanium. Strength of steel at 56% of the weight, and white sparks.',
  },
  al7075: {
    id: 'al7075', name: '7075-T6 aluminum', density: 2810, toughness: 9000, hardness: 0.45,
    floorFriction: 0.4, spark: 0.2,
    blurb: 'Aircraft aluminum. Light for frames, but tears under big spinner hits.',
  },
  uhmw: {
    id: 'uhmw', name: 'UHMW polyethylene', density: 940, toughness: 5200, hardness: 0.1,
    floorFriction: 0.2, spark: 0,
    blurb: 'Ultra-high molecular weight plastic. Soaks energy and gouges instead of cracking.',
  },
  polycarb: {
    id: 'polycarb', name: 'Polycarbonate', density: 1200, toughness: 3500, hardness: 0.15,
    floorFriction: 0.3, spark: 0,
    blurb: 'Lexan. The arena walls are made of it; on a robot it is shell armor for light designs.',
  },
};

export type MotorId =
  | 'bl63-190' | 'bl80-150' | 'bl56-inrunner' | 'brushed-35' | 'bl80100-130' | 'bl120-70' | 'bl160-50'
  | 'hydraulic-pump' | 'etek' | 'ice-engine';

export interface Motor {
  id: MotorId;
  name: string;
  kind: 'brushless' | 'brushed';
  kv: number; // rpm per volt
  resistance: number; // ohms (winding + ESC)
  maxCurrent: number; // A, ESC current limit
  noLoadCurrent: number; // A
  mass: number; // kg
  use: 'drive' | 'weapon' | 'both';
  blurb: string;
}

export const MOTORS: Record<MotorId, Motor> = {
  'bl63-190': {
    id: 'bl63-190', name: '63 mm brushless outrunner, 190 Kv', kind: 'brushless', kv: 190,
    resistance: 0.032, maxCurrent: 110, noLoadCurrent: 2.2, mass: 0.85, use: 'both',
    blurb: 'The 6374-size outrunner. Common drive motor through a planetary gearbox.',
  },
  'bl80-150': {
    id: 'bl80-150', name: '80 mm brushless outrunner, 150 Kv', kind: 'brushless', kv: 150,
    resistance: 0.022, maxCurrent: 160, noLoadCurrent: 3, mass: 1.6, use: 'both',
    blurb: 'Bigger can, more torque. Pushers love these.',
  },
  'bl56-inrunner': {
    id: 'bl56-inrunner', name: '56 mm brushless inrunner, 800 Kv', kind: 'brushless', kv: 800,
    resistance: 0.011, maxCurrent: 120, noLoadCurrent: 3.5, mass: 0.7, use: 'drive',
    blurb: 'Compact high-speed motor. Needs a deep reduction, rewards you with snap.',
  },
  'brushed-35': {
    id: 'brushed-35', name: '3.5 in brushed DC (24 V class)', kind: 'brushed', kv: 230,
    resistance: 0.075, maxCurrent: 180, noLoadCurrent: 4, mass: 2.9, use: 'both',
    blurb: 'Old-school brushed motor. Heavy and forgiving, the classic 2000s drive.',
  },
  'bl80100-130': {
    id: 'bl80100-130', name: '80100 brushless outrunner, 130 Kv', kind: 'brushless', kv: 130,
    resistance: 0.016, maxCurrent: 340, noLoadCurrent: 4, mass: 2.2, use: 'weapon',
    blurb: 'The heavyweight spinner motor. Belt-driven to a bar, disk or drum.',
  },
  'bl120-70': {
    id: 'bl120-70', name: '120 mm brushless outrunner, 70 Kv', kind: 'brushless', kv: 70,
    resistance: 0.011, maxCurrent: 520, noLoadCurrent: 5, mass: 4.6, use: 'weapon',
    blurb: 'Huge torque for spinning a 70 lb bar from a standstill. Pulls hundreds of amps.',
  },
  'bl160-50': {
    id: 'bl160-50', name: '160 mm brushless outrunner, 50 Kv', kind: 'brushless', kv: 50,
    resistance: 0.009, maxCurrent: 650, noLoadCurrent: 6, mass: 7.5, use: 'weapon',
    blurb: 'Direct-drive monster for full-body and huge-disk spinners.',
  },
  etek: {
    id: 'etek', name: 'Etek-class brushed motor (15 hp)', kind: 'brushed', kv: 72,
    resistance: 0.012, maxCurrent: 520, noLoadCurrent: 6, mass: 9.5, use: 'weapon',
    blurb: 'Pancake brushed motor the size of a dinner plate. Brutal torque, chain or belt to the weapon.',
  },
  'ice-engine': {
    id: 'ice-engine', name: '15 hp two-stroke engine (concrete-saw)', kind: 'brushed', kv: 0,
    resistance: 0, maxCurrent: 0, noLoadCurrent: 0, mass: 9.8, use: 'weapon',
    blurb: 'Gasoline engine through a centrifugal clutch. Draws nothing from the battery, takes a while to wind up.',
  },
  'hydraulic-pump': {
    id: 'hydraulic-pump', name: 'Hydraulic pump motor', kind: 'brushless', kv: 160,
    resistance: 0.02, maxCurrent: 220, noLoadCurrent: 4, mass: 2.4, use: 'weapon',
    blurb: 'Drives a hydraulic pump for crushers and lifters.',
  },
};

export const motorKt = (m: Motor) => (m.kv > 0 ? 60 / (2 * Math.PI * m.kv) : 0); // N·m/A
/** Internal-combustion weapon engines: shaft power (W) and governed max rpm. */
export const ENGINE = { power: 11200, maxRpm: 9500 };
export const motorKe = (m: Motor) => motorKt(m); // V·s/rad

export type TireId = 'colson' | 'pneumatic-foam' | 'urethane' | 'hard-plastic' | 'nhra' | 'uhmw-disc';

export interface Tire {
  id: TireId;
  name: string;
  mu: number; // friction coefficient on the BattleBox steel floor
  massPerDiaM: number; // kg per meter of diameter (rough)
  blurb: string;
}

export const TIRES: Record<TireId, Tire> = {
  colson: { id: 'colson', name: 'Colson performa', mu: 0.92, massPerDiaM: 6, blurb: 'Gray rubber over a plastic hub. Tough, grippy, the default.' },
  'pneumatic-foam': { id: 'pneumatic-foam', name: 'Foam-filled pneumatic', mu: 1.05, massPerDiaM: 8, blurb: 'Big grip and bounce. Hard to pop because there is no air in it.' },
  urethane: { id: 'urethane', name: 'Cast urethane', mu: 1.0, massPerDiaM: 7, blurb: 'Custom-poured tread, high grip, gets chewed by spinners.' },
  'hard-plastic': { id: 'hard-plastic', name: 'Hard plastic', mu: 0.55, massPerDiaM: 5, blurb: 'Cheap and slippery. Useful only for a spin-around shell.' },
  'uhmw-disc': { id: 'uhmw-disc', name: 'UHMW disc wheel', mu: 0.62, massPerDiaM: 30, blurb: 'Solid plastic disc with spoke cutouts, the whole wheel is the armor. HUGE runs a pair 40 inches across.' },
  nhra: { id: 'nhra', name: 'Racing slick (custom)', mu: 1.12, massPerDiaM: 9, blurb: 'Sticky compound, the pushing-match choice.' },
};

export interface BatterySpec {
  cellsS: number; // series cells (4.2 V full, 3.7 nominal)
  capacityAh: number; // per pack
  packs: number; // in parallel
  cRating: number;
}

export const CELL_FULL = 4.2;
export const CELL_NOMINAL = 3.7;
export const CELL_EMPTY = 3.3;

export function batteryMass(b: BatterySpec) {
  return b.cellsS * b.packs * b.capacityAh * 0.026 + 0.18 * b.packs;
}
export function batteryResistance(b: BatterySpec) {
  // ~2.5 mΩ per cell for a 5 Ah high-discharge cell, scaling inversely with capacity.
  const cellR = 0.0125 / b.capacityAh;
  return (b.cellsS * cellR) / b.packs + 0.006; // + wiring & switch
}
export function batteryMaxCurrent(b: BatterySpec) {
  return b.cRating * b.capacityAh * b.packs;
}
export function batteryWh(b: BatterySpec) {
  return b.cellsS * CELL_NOMINAL * b.capacityAh * b.packs;
}
/** Open-circuit cell voltage vs state of charge (0..1), a typical LiPo curve. */
export function cellVoltage(soc: number) {
  const s = Math.max(0, Math.min(1, soc));
  // steep start, long plateau, knee at the bottom
  return CELL_EMPTY + 0.25 * s + 0.4 * s * s * s + 0.25 * (1 - Math.exp(-12 * s));
}

/** Fixed internal mass: receiver, ESCs, wiring, power switch, fasteners. */
export const ELECTRONICS_MASS = 3.2;
