import { Blueprint, outlineArea } from './blueprint';
// A robot design: everything a builder chooses in the garage. Physical
// properties (mass, inertia, top speed, stored energy, invertibility) are
// derived from it, never typed in, so a design can't claim what its parts
// can't deliver.

import {
  BatterySpec, ELECTRONICS_MASS, IN, LB, MATERIALS, MOTORS, MaterialId, MotorId, TIRES, TireId,
  WEIGHT_LIMIT_KG, batteryMass, batteryMaxCurrent, batteryResistance, batteryWh, cellVoltage,
  motorKt, rpmToRad, radToRpm, MPH, ENGINE,
} from './parts';

export type SpinnerStyle =
  | 'horizontal-bar' | 'horizontal-disk' | 'undercutter' | 'vertical-disk' | 'vertical-bar'
  | 'drum' | 'eggbeater' | 'shell';

export interface SpinnerWeapon {
  type: 'spinner';
  style: SpinnerStyle;
  rotorMass: number; // kg
  radius: number; // m, to the tooth tips
  width: number; // m, axial thickness (drum: length)
  teeth: number; // impactors that bite per revolution
  toothHeight: number; // m, how far a tooth stands proud
  material: MaterialId;
  motor: MotorId;
  motorCount: number;
  ratio: number; // motor turns per rotor turn (belt / gear reduction)
  /** Axle position in body frame (m): x forward of chassis center, y up from chassis center. */
  mountX: number;
  mountY: number;
  /** For drums & verticals: how many separate disks (Witch Doctor = 1, Bite Force = 1, Lock-Jaw style = 1). */
  disks?: number;
  /** Spin direction: +1 = tips move up at the front (verticals) / counter-clockwise from above (horizontals). */
  dir?: 1 | -1;
  reversible?: boolean;
}

export interface FlipperWeapon {
  type: 'flipper';
  style: 'flipper' | 'lifter';
  actuator: 'pneumatic' | 'electric' | 'hydraulic';
  /** Energy delivered to the target per full shot (J). */
  energy: number;
  plateLength: number; // m
  plateWidth: number; // m
  shots: number; // gas supply (pneumatic) or Infinity for electric
  cooldown: number; // s between fires
  systemMass: number; // kg: tank, valve, ram, plate
}

export interface HammerWeapon {
  type: 'hammer';
  style: 'hammer' | 'axe' | 'saw-arm';
  headMass: number; // kg
  armLength: number; // m
  energy: number; // J at the head at impact
  swingTime: number; // s, rest to impact
  cooldown: number; // s
  systemMass: number; // kg: motor, gearbox, arm
  /** saw-arm: rpm of the circular saw on the arm tip */
  sawRpm?: number;
}

export interface CrusherWeapon {
  type: 'crusher';
  force: number; // N at the beak tip
  reach: number; // m
  cycleTime: number; // s
  systemMass: number;
}

export interface NoWeapon { type: 'none' }

export type Weapon = SpinnerWeapon | FlipperWeapon | HammerWeapon | CrusherWeapon | NoWeapon;

export type ChassisShape = 'box' | 'wedge' | 'double-wedge' | 'low-flat' | 'ring' | 'tall';

export interface Panel { material: MaterialId; thickness: number } // thickness in mm

export interface BotLook {
  primary: string;
  secondary: string;
  accent: string;
  pattern?: 'solid' | 'stripes' | 'flames' | 'checker' | 'split' | 'tiger' | 'rivets' | 'carbon';
  /** free-form feature tags the mesh builder knows how to draw */
  features?: string[];
  logo?: string;
  tireColor?: string;
}

export interface BotDesign {
  id: string;
  name: string;
  team: string;
  chassis: {
    shape: ChassisShape;
    length: number; // m (x)
    width: number; // m (z)
    height: number; // m (y)
    clearance: number; // m, chassis belly to floor
    wedgeLength: number; // m, forward of the box (0 = none)
    frame: MaterialId;
    frameThickness: number; // mm
    armor: { front: Panel; rear: Panel; sides: Panel; top: Panel; bottom: Panel };
    /** arm = powered srimech; pole = passive roll-over bar; torque = weapon spin-up torque rolls it back */
    selfRighter?: 'arm' | 'pole' | 'torque';
    forks?: boolean; // hinged wedgelets that drag the floor
    /** front face width as a fraction of the body (tapered nose) */
    noseTaper?: number;
    /** ears / horns / outrigger wheels that let it drive inverted regardless of wheel size */
    invertibleOverride?: boolean;
    /** real silhouette: outline + side profile. When set, length/width/height/clearance are its bounding box. */
    blueprint?: Blueprint;
  };
  /** second actuator: Whiplash's lifting arm, Tantrum's sliding drum */
  secondary?: { type: 'lifter'; energy: number; plateLength: number; plateWidth: number; cooldown: number; systemMass: number }
    | { type: 'slide'; distance: number; cycleTime: number; systemMass: number };
  /** cosmetic flamethrower (Witch Doctor, Blacksmith, SawBlaze) */
  flame?: boolean;
  drive: {
    wheels: 2 | 4 | 6;
    wheelDiameter: number; // m
    wheelWidth: number; // m
    tire: TireId;
    motor: MotorId;
    motorsPerSide: number;
    ratio: number; // gear reduction
    wheelbase: number; // m between front and rear axle (0 for 2WD)
    track: number; // m between left and right wheel centers
    axleX?: number; // m, wheel set x offset from chassis center
  };
  battery: BatterySpec;
  weapon: Weapon;
  look: BotLook;
}

// ---------- derived numbers ----------

export interface MassItem { label: string; kg: number }

export interface DerivedStats {
  massItems: MassItem[];
  mass: number;
  legal: boolean;
  invertible: boolean;
  topSpeedMps: number;
  topSpeedMph: number;
  pushForceN: number;
  accel0to10ft: number; // s
  nominalV: number;
  fullV: number;
  batteryWh: number;
  batteryMaxA: number;
  batteryR: number;
  weapon?: {
    inertia: number; // kg m^2
    maxRpm: number;
    tipSpeedMph: number;
    energyKJ: number;
    spinUpS: number; // to 90% of max
    peakAmps: number;
  };
  /** COM height above chassis center, m (negative = lower) */
  comY: number;
  inertia: { x: number; y: number; z: number };
}

export function rotorInertia(w: SpinnerWeapon) {
  const k: Record<SpinnerStyle, number> = {
    'horizontal-bar': 0.4, // tip-weighted bar
    'vertical-bar': 0.4,
    'horizontal-disk': 0.55,
    'vertical-disk': 0.55,
    undercutter: 0.45,
    drum: 0.75,
    eggbeater: 0.7,
    shell: 0.85,
  };
  return k[w.style] * w.rotorMass * w.radius * w.radius;
}

export function isVertical(style: SpinnerStyle) {
  return style === 'vertical-disk' || style === 'vertical-bar' || style === 'drum' || style === 'eggbeater';
}

/** Wheel center height relative to chassis center when resting on the floor. */
export function wheelCenterY(d: BotDesign) {
  const r = d.drive.wheelDiameter / 2;
  return r - d.chassis.clearance - d.chassis.height / 2;
}

/** Wheels must stand proud of the top deck to drive upside down. */
export function computeInvertible(d: BotDesign) {
  if (d.chassis.invertibleOverride !== undefined) return d.chassis.invertibleOverride;
  const r = d.drive.wheelDiameter / 2;
  const top = d.chassis.height / 2;
  const wy = wheelCenterY(d);
  if (d.chassis.shape === 'ring' || d.weapon.type === 'spinner' && d.weapon.style === 'shell') return false;
  return wy + r > top + 0.005 || wy + r > top - 0.002 && d.chassis.shape === 'double-wedge';
}

export function panelAreas(d: BotDesign) {
  const { length: L, width: W, height: H, wedgeLength } = d.chassis;
  const plan = d.chassis.blueprint ? outlineArea(d.chassis.blueprint) : L * W;
  const wedgeSlant = wedgeLength > 0 ? Math.hypot(wedgeLength, H) * W : 0;
  return {
    front: wedgeLength > 0 ? wedgeSlant : W * H,
    rear: d.chassis.shape === 'double-wedge' ? Math.hypot(Math.min(L * 0.35, 0.3), H) * W : W * H,
    sides: 2 * L * H + (wedgeLength > 0 ? wedgeLength * H : 0),
    top: plan,
    bottom: plan,
  };
}

export function computeStats(d: BotDesign): DerivedStats {
  const items: MassItem[] = [];
  const A = panelAreas(d);
  const panelMass = (area: number, p: Panel) => area * (p.thickness / 1000) * MATERIALS[p.material].density;
  const arm = d.chassis.armor;
  items.push({ label: `Front armor (${MATERIALS[arm.front.material].name} ${arm.front.thickness} mm)`, kg: panelMass(A.front, arm.front) });
  items.push({ label: `Side armor (${MATERIALS[arm.sides.material].name} ${arm.sides.thickness} mm)`, kg: panelMass(A.sides, arm.sides) });
  items.push({ label: `Rear armor (${MATERIALS[arm.rear.material].name} ${arm.rear.thickness} mm)`, kg: panelMass(A.rear, arm.rear) });
  items.push({ label: `Top armor (${MATERIALS[arm.top.material].name} ${arm.top.thickness} mm)`, kg: panelMass(A.top, arm.top) });
  items.push({ label: `Belly plate (${MATERIALS[arm.bottom.material].name} ${arm.bottom.thickness} mm)`, kg: panelMass(A.bottom, arm.bottom) });
  // internal frame rails: a perimeter + cross members
  const { length: L, width: W, height: H } = d.chassis;
  const frameArea = (2 * (L + W) + 2 * W) * H * 0.5;
  items.push({ label: `Frame (${MATERIALS[d.chassis.frame].name})`, kg: frameArea * (d.chassis.frameThickness / 1000) * MATERIALS[d.chassis.frame].density });

  const dm = MOTORS[d.drive.motor];
  const tire = TIRES[d.drive.tire];
  const wheelKg = d.drive.wheels * (tire.massPerDiaM * d.drive.wheelDiameter * (d.drive.wheelWidth / 0.05) * 0.5 + 0.25);
  items.push({ label: `${d.drive.wheels} × ${(d.drive.wheelDiameter / IN).toFixed(1)}" ${tire.name} wheels + hubs`, kg: wheelKg });
  const nDrive = d.drive.motorsPerSide * 2;
  items.push({ label: `${nDrive} × ${dm.name} + gearboxes`, kg: nDrive * (dm.mass + 0.55 + 0.02 * d.drive.ratio) });
  items.push({ label: `LiPo ${d.battery.cellsS}S ${d.battery.capacityAh} Ah × ${d.battery.packs}`, kg: batteryMass(d.battery) });
  items.push({ label: 'Receiver, ESCs, wiring, switch', kg: ELECTRONICS_MASS });
  if (d.chassis.selfRighter === 'arm') items.push({ label: 'Self-righting arm', kg: 3.5 });
  if (d.chassis.selfRighter === 'pole') items.push({ label: 'Self-righting pole', kg: 1.6 });
  if (d.secondary) items.push({ label: d.secondary.type === 'lifter' ? 'Lifting arm drive' : 'Sliding weapon carriage', kg: d.secondary.systemMass });
  if (d.flame) items.push({ label: 'Flamethrower (propane, cosmetic)', kg: 1.8 });
  if (d.chassis.forks) items.push({ label: 'Hinged forks / wedgelets', kg: 2.2 });

  const w = d.weapon;
  let weaponStats: DerivedStats['weapon'];
  const fullV = d.battery.cellsS * cellVoltage(1);
  const nominalV = d.battery.cellsS * 3.85; // under-load average
  const battR = batteryResistance(d.battery);
  if (w.type === 'spinner') {
    const wm = MOTORS[w.motor];
    items.push({ label: `Rotor (${MATERIALS[w.material].name})`, kg: w.rotorMass });
    items.push({ label: `${w.motorCount} × ${wm.name}`, kg: wm.mass * w.motorCount });
    items.push({ label: 'Weapon shaft, bearings, belts, pulleys', kg: 2.5 + 0.08 * w.rotorMass });
    const I = rotorInertia(w);
    const sp = simulateSpinUp(w, I, nominalV, battR);
    weaponStats = {
      inertia: I,
      maxRpm: sp.maxRpm,
      tipSpeedMph: (rpmToRad(sp.maxRpm) * w.radius) / MPH,
      energyKJ: (0.5 * I * rpmToRad(sp.maxRpm) ** 2) / 1000,
      spinUpS: sp.t90,
      peakAmps: sp.peakA,
    };
  } else if (w.type === 'flipper') {
    items.push({ label: `${w.actuator} ${w.style} system`, kg: w.systemMass });
  } else if (w.type === 'hammer') {
    items.push({ label: `${w.style} drive and arm`, kg: w.systemMass });
    items.push({ label: `${w.style} head`, kg: w.headMass });
  } else if (w.type === 'crusher') {
    items.push({ label: 'Hydraulic crusher', kg: w.systemMass });
  }

  const mass = items.reduce((s, i) => s + i.kg, 0);

  // drive
  const r = d.drive.wheelDiameter / 2;
  const Kt = motorKt(dm);
  const wFree = rpmToRad(dm.kv * nominalV); // motor rad/s
  const topSpeedMps = (wFree / d.drive.ratio) * r * 0.86;
  const stallTorqueWheelSide = d.drive.motorsPerSide * Kt * Math.min(dm.maxCurrent, nominalV / (dm.resistance + battR)) * d.drive.ratio * 0.9;
  const tractionLimited = tire.mu * mass * 9.81;
  const pushForceN = Math.min(tractionLimited, (2 * stallTorqueWheelSide) / r);
  const accel = pushForceN / mass;
  // time to cover 10 ft accelerating with linearly falling force
  let v = 0, x = 0, t = 0;
  while (x < 3.048 && t < 5) {
    const a = accel * Math.max(0, 1 - v / topSpeedMps);
    v += a * 0.002; x += v * 0.002; t += 0.002;
  }

  // inertia: treat as a box of the chassis dims, weighted toward the perimeter by armor
  const Ix = (mass / 12) * (W * W + H * H);
  const Iy = (mass / 12) * (L * L + W * W) * 1.1;
  const Iz = (mass / 12) * (L * L + H * H);

  return {
    massItems: items,
    mass,
    legal: mass <= WEIGHT_LIMIT_KG + 1e-6,
    invertible: computeInvertible(d),
    topSpeedMps,
    topSpeedMph: topSpeedMps / MPH,
    pushForceN,
    accel0to10ft: t,
    nominalV,
    fullV,
    batteryWh: batteryWh(d.battery),
    batteryMaxA: batteryMaxCurrent(d.battery),
    batteryR: battR,
    weapon: weaponStats,
    comY: -H * 0.12,
    inertia: { x: Ix, y: Iy, z: Iz },
  };
}

/** Integrate the weapon motor against the rotor inertia (current-limited). */
export function simulateSpinUp(w: SpinnerWeapon, I: number, V: number, battR: number) {
  const m = MOTORS[w.motor];
  if (m.id === 'ice-engine') {
    const wMax = rpmToRad(ENGINE.maxRpm) / w.ratio;
    let om = 0, t = 0, t90 = 0;
    while (t < 40 && om < wMax) {
      const torque = Math.min(ENGINE.power / Math.max(om * w.ratio, 40) * w.ratio, 95);
      om = Math.min(wMax, om + (torque * 0.9 / I) * 0.005);
      t += 0.005;
      if (!t90 && om >= 0.9 * wMax) t90 = t;
    }
    return { maxRpm: radToRpm(wMax), t90: t90 || t, peakA: 0 };
  }
  const Kt = motorKt(m);
  let omega = 0, t = 0, peakA = 0, t90 = 0;
  const wMax = (rpmToRad(m.kv * V) / w.ratio) * 0.93;
  const dt = 0.005;
  while (t < 30) {
    const wm = omega * w.ratio;
    const iRaw = (V - wm * Kt) / (m.resistance + battR * w.motorCount);
    const i = Math.min(m.maxCurrent, Math.max(0, iRaw));
    peakA = Math.max(peakA, i * w.motorCount);
    const torque = w.motorCount * (Kt * (i - m.noLoadCurrent)) * w.ratio * 0.92; // belt efficiency
    const drag = 0.00002 * omega * omega * w.radius * w.radius * w.width * 40; // windage
    omega += ((torque - drag) / I) * dt;
    if (omega >= wMax) { omega = wMax; }
    t += dt;
    if (!t90 && omega >= 0.9 * wMax) t90 = t;
    if (t90 && t > t90 + 0.5) break;
  }
  return { maxRpm: radToRpm(wMax), t90: t90 || 30, peakA };
}

export const kgToLb = (kg: number) => kg / LB;
export const WEIGHT_LIMIT = WEIGHT_LIMIT_KG;

/** Gear reduction that gives a target top speed on a given wheel and motor. */
export function ratioFor(targetMph: number, wheelDia: number, motor: MotorId, cellsS: number) {
  const V = cellsS * 3.85;
  const wFree = rpmToRad(MOTORS[motor].kv * V);
  return Math.max(1, (wFree * (wheelDia / 2) * 0.86) / (targetMph * MPH));
}

/** Weapon belt/gear ratio that hits a target rotor rpm. */
export function weaponRatioFor(rpm: number, motor: MotorId, cellsS: number) {
  const m = MOTORS[motor];
  if (m.id === 'ice-engine') return ENGINE.maxRpm / rpm;
  return Math.max(0.3, (m.kv * cellsS * 3.85 * 0.93) / rpm);
}

/** Scale armor thickness so the robot lands just under the weight limit. */
export function fitToWeight(d: BotDesign, targetKg = WEIGHT_LIMIT_KG - 0.35): BotDesign {
  const out: BotDesign = structuredClone(d); // JSON would turn shots: Infinity into null
  const keys = ['front', 'rear', 'sides', 'top', 'bottom'] as const;
  const base = keys.map((k) => out.chassis.armor[k].thickness);
  let lo = 0.15, hi = 7;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    keys.forEach((k, j) => (out.chassis.armor[k].thickness = Math.max(1.5, base[j] * mid)));
    if (computeStats(out).mass > targetKg) hi = mid; else lo = mid;
  }
  keys.forEach((k, j) => (out.chassis.armor[k].thickness = Math.round(Math.max(1.5, base[j] * lo) * 10) / 10));
  return out;
}

/** Rotor speed vs time from a standing start (for the garage chart). */
export function spinUpCurve(w: SpinnerWeapon, V: number, battR: number, seconds = 12) {
  const I = rotorInertia(w);
  const m = MOTORS[w.motor];
  const Kt = motorKt(m);
  const pts: { t: number; rpm: number; amps: number }[] = [];
  let om = 0;
  const dt = 0.01;
  const wMaxEngine = rpmToRad(ENGINE.maxRpm) / w.ratio;
  for (let t = 0; t <= seconds; t += dt) {
    let torque = 0, amps = 0;
    if (m.id === 'ice-engine') {
      torque = om < wMaxEngine ? Math.min(ENGINE.power / Math.max(om * w.ratio, 40) * w.ratio, 95) * 0.9 : 0;
    } else {
      const iRaw = (V - om * w.ratio * Kt) / (m.resistance + battR * w.motorCount);
      const i = Math.min(m.maxCurrent, Math.max(0, iRaw));
      amps = i * w.motorCount;
      torque = w.motorCount * Kt * Math.max(0, i - m.noLoadCurrent) * w.ratio * 0.92;
    }
    const drag = 0.6 + 0.02 * om + 0.00004 * om * om * w.radius * w.radius * (w.width * 30);
    om = Math.max(0, om + ((torque - drag) / I) * dt);
    if (Math.round(t / dt) % 5 === 0) pts.push({ t, rpm: radToRpm(om), amps });
  }
  return pts;
}

/** Ground speed vs time from a standing start, both sides full throttle (for the garage chart). */
export function accelCurve(d: BotDesign, seconds = 3) {
  const s = computeStats(d);
  const dm = MOTORS[d.drive.motor];
  const Kt = motorKt(dm);
  const r = d.drive.wheelDiameter / 2;
  const V = s.nominalV;
  const mu = TIRES[d.drive.tire].mu;
  const pts: { t: number; mph: number; amps: number }[] = [];
  let v = 0;
  const dt = 0.005;
  for (let t = 0; t <= seconds; t += dt) {
    const om = (v / r) * d.drive.ratio;
    const i = Math.min(dm.maxCurrent, Math.max(-dm.maxCurrent, (V - Kt * om) / (dm.resistance + s.batteryR)));
    const F = Math.min(mu * s.mass * 9.81, (2 * d.drive.motorsPerSide * Kt * i * d.drive.ratio * 0.88) / r);
    v = Math.max(0, v + ((F - 0.012 * s.mass * 9.81) / s.mass) * dt);
    if (Math.round(t / dt) % 10 === 0) pts.push({ t, mph: v / MPH, amps: i * 2 * d.drive.motorsPerSide });
  }
  return pts;
}

/** Rough fight-time estimate: drive at 35% average power, weapon held at speed against windage + re-spins. */
export function runtimeMinutes(d: BotDesign) {
  const s = computeStats(d);
  const dm = MOTORS[d.drive.motor];
  const driveW = 2 * d.drive.motorsPerSide * dm.maxCurrent * s.nominalV * 0.12;
  let weaponW = 0;
  if (d.weapon.type === 'spinner' && s.weapon) weaponW = (s.weapon.energyKJ * 1000) / 12 + (d.weapon.motor === 'ice-engine' ? 0 : 400);
  if (d.weapon.type === 'flipper' && d.weapon.actuator !== 'pneumatic') weaponW = 300;
  if (d.weapon.type === 'hammer' || d.weapon.type === 'crusher') weaponW = 500;
  return (s.batteryWh * 0.8) / (driveW + weaponW + 40) * 60;
}
