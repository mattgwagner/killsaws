// A robot in the arena: one Rapier rigid body for chassis + armor, colliders
// for wheels and the weapon's swept volume, and analytic models for the
// drivetrain (DC motor + tire), battery sag and the weapon rotor.

import type RAPIERNS from '@dimforge/rapier3d-compat';
import { RAPIER, COLLIDE } from './physics';
import { blueprintHull } from './blueprint';
import {
  BotDesign, DerivedStats, computeStats, isVertical, panelAreas, rotorInertia, wheelCenterY,
} from './design';
import { ENGINE, MATERIALS, MOTORS, TIRES, batteryResistance, cellVoltage, motorKt } from './parts';
import {
  Q4, V3, add, clamp, cross, dot, len, madd, norm, qAxisAngle, qmul, rotate, scale, sub, v3, invRotate,
} from './vec';

type World = RAPIERNS.World;
type RigidBody = RAPIERNS.RigidBody;
type Collider = RAPIERNS.Collider;

export type PartKind = 'chassis' | 'wheel' | 'weapon' | 'fork' | 'wall' | 'floor' | 'hazard' | 'debris';
export interface ColliderTag {
  bot: BotRuntime | null;
  part: PartKind;
  index?: number;
  hazardId?: string;
}
export type TagMap = Map<number, ColliderTag>;

export interface BotInput {
  throttle: number; // -1..1
  turn: number; // -1..1 (+ = right)
  /** spinners: hold/toggle weapon on; flippers/hammers: fire */
  weapon: boolean;
  /** secondary: lifter arm / drum punch / self-righter / reverse spinner */
  alt?: boolean;
  /** cosmetic flamethrower */
  flame?: boolean;
  /** fire your team's Pulverizer */
  hazard?: boolean;
}
export const NO_INPUT: BotInput = { throttle: 0, turn: 0, weapon: false };

export type Face = 'front' | 'rear' | 'left' | 'right' | 'top' | 'bottom';
export const FACES: Face[] = ['front', 'rear', 'left', 'right', 'top', 'bottom'];

export interface PanelState {
  capacity: number; // J
  integrity: number; // 0..1
  material: string;
}

export interface WheelState {
  local: V3;
  side: 0 | 1; // 0 = left, 1 = right
  r: number;
  width: number;
  omega: number; // rad/s in "forward" sense
  angle: number;
  contact: boolean;
  normalForce: number;
  hp: number; // J of damage before it's torn off
  attached: boolean;
  collider: Collider | null;
}

export interface Internals {
  driveL: number; // 0..1 health
  driveR: number;
  weapon: number;
  battery: number;
  electronics: number;
}

export const INTERNAL_HP = { driveL: 26000, driveR: 26000, weapon: 42000, battery: 30000, electronics: 22000 };

export interface SpinnerState {
  kind: 'spinner';
  omega: number; // rad/s (signed)
  angle: number;
  on: boolean;
  inertia: number;
  axisLocal: V3;
  mountLocal: V3;
  radius: number;
  halfWidth: number;
  dir: 1 | -1;
  shape: RAPIERNS.Cylinder;
  shapeRotLocal: Q4;
  hitCooldown: number;
  toothDamage: number; // 0..1, reduces bite & stored energy (broken teeth)
  current: number;
  lastToggle: boolean;
}
export interface ActuatorState {
  kind: 'flipper' | 'hammer' | 'crusher';
  /** 0 = rest, 1 = fully extended */
  pos: number;
  phase: 'rest' | 'firing' | 'returning' | 'holding';
  timer: number;
  cooldown: number;
  shots: number;
  struck: boolean;
  lastFire: boolean;
  sawAngle: number;
}

export class BotRuntime {
  readonly design: BotDesign;
  readonly stats: DerivedStats;
  readonly index: number;
  readonly body: RigidBody;
  readonly mass: number;
  readonly invInertia: V3;
  readonly comLocal: V3;
  readonly half: V3;
  readonly wheels: WheelState[] = [];
  readonly panels: Record<Face, PanelState>;
  readonly internals: Internals = { driveL: 1, driveR: 1, weapon: 1, battery: 1, electronics: 1 };
  readonly spinner: SpinnerState | null = null;
  readonly actuator: ActuatorState | null = null;
  readonly secondaryAct: ActuatorState | null = null;
  selfRightCooldown = 0;
  spinAccel = 0;
  /** seconds left in a self-righting hop; the rotor's gyro reaction is held off meanwhile */
  selfRightFlight = 0;
  invertedTime = 0;
  flameOn = false;
  slidePos = 0;
  punchBoost = 1;
  deckTime = 0;
  chassisCollider!: Collider;
  weaponCollider: Collider | null = null;

  input: BotInput = { ...NO_INPUT };
  soc = 1;
  volts: number;
  amps = 0;
  ampsDrive = 0;
  whUsed = 0;
  onFire = false;
  fireTimer = 0;
  dead = false;
  deadReason = '';
  tappedOut = false;
  autoInvert = true;
  /** smoothed telemetry */
  speed = 0;

  // judging + match stats
  damageDealt = 0;
  damageTaken = 0;
  bigHits = 0;
  aggression = 0;
  control = 0;
  hazardDamageDealt = 0;
  immobileTime = 0;

  private tags: TagMap;
  /** belly skids (2WD bots ride on these, like the real ones' front skids) */
  readonly skids: V3[] = [];
  private k: number;
  private c: number;
  private readonly world: World;

  constructor(world: World, design: BotDesign, index: number, tags: TagMap, start: { x: number; z: number; yaw: number }) {
    this.world = world;
    this.tags = tags;
    this.design = design;
    this.index = index;
    this.stats = computeStats(design);
    this.mass = this.stats.mass;
    const ch = design.chassis;
    this.half = v3(ch.length / 2, ch.height / 2, ch.width / 2);
    this.comLocal = v3(0, this.stats.comY, 0);
    const I = this.stats.inertia;
    this.invInertia = v3(1 / I.x, 1 / I.y, 1 / I.z);
    this.volts = this.stats.fullV;

    const r = design.drive.wheelDiameter / 2;
    const restY = ch.clearance + ch.height / 2 + 0.002;
    const q = qAxisAngle(v3(0, 1, 0), start.yaw);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, restY, start.z)
      .setRotation(q)
      .setCcdEnabled(true)
      .setLinearDamping(0.02)
      .setAngularDamping(0.15)
      .setCanSleep(false)
      .setAdditionalMassProperties(this.mass, this.comLocal, I, { x: 0, y: 0, z: 0, w: 1 });
    this.body = world.createRigidBody(desc);

    // --- chassis hull ---
    const hull = chassisHull(design);
    const cd = (RAPIER.ColliderDesc.convexHull(hull) ?? RAPIER.ColliderDesc.cuboid(this.half.x, this.half.y, this.half.z))
      .setDensity(0)
      .setFriction(MATERIALS[ch.armor.bottom.material].floorFriction)
      .setRestitution(0.15)
      .setCollisionGroups(COLLIDE.chassis)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(this.mass * 9.81 * 12);
    this.chassisCollider = world.createCollider(cd, this.body);
    tags.set(this.chassisCollider.handle, { bot: this, part: 'chassis' });

    if (ch.forks) {
      for (const s of [-1, 1]) {
        const fd = RAPIER.ColliderDesc.cuboid(0.09, 0.006, 0.05)
          .setTranslation(ch.length / 2 + ch.wedgeLength + 0.05, -ch.height / 2 - ch.clearance + 0.008, s * ch.width * 0.33)
          .setDensity(0).setFriction(0.25).setCollisionGroups(COLLIDE.chassis);
        const fc = world.createCollider(fd, this.body);
        tags.set(fc.handle, { bot: this, part: 'fork' });
      }
    }

    // --- wheels ---
    const d = design.drive;
    const wy = wheelCenterY(design) - 0.006; // sits 6 mm into its static sag
    const ax = d.axleX ?? 0;
    const xs = d.wheels === 2 ? [ax] : d.wheels === 4 ? [ax - d.wheelbase / 2, ax + d.wheelbase / 2] : [ax - d.wheelbase / 2, ax, ax + d.wheelbase / 2];
    const qWheel = qAxisAngle(v3(1, 0, 0), Math.PI / 2); // cylinder Y -> Z
    for (const x of xs) {
      for (const side of [0, 1] as const) {
        const local = v3(x, wy, (side === 0 ? -1 : 1) * d.track / 2);
        const wd = RAPIER.ColliderDesc.cylinder(d.wheelWidth / 2, r * 0.88)
          .setTranslation(local.x, local.y, local.z)
          .setRotation(qWheel)
          .setDensity(0).setFriction(0.6).setRestitution(0.2)
          .setCollisionGroups(COLLIDE.wheel);
        const wc = world.createCollider(wd, this.body);
        const idx = this.wheels.length;
        tags.set(wc.handle, { bot: this, part: 'wheel', index: idx });
        this.wheels.push({
          local, side, r, width: d.wheelWidth, omega: 0, angle: 0, contact: false, normalForce: 0,
          hp: (16000 + 90000 * r * d.wheelWidth) * (d.tire === 'uhmw-disc' ? 6 : d.tire === 'pneumatic-foam' ? 1.3 : 1), attached: true, collider: wc,
        });
      }
    }
    if (d.wheels === 2) {
      // two-wheelers rest on a skid at each end of the belly instead of nosing into the floor
      const belly = -ch.height / 2 - ch.clearance + 0.0025;
      const front = ch.wedgeLength > 0 ? ch.length / 2 + ch.wedgeLength * 0.6 : ch.length / 2 - 0.02;
      this.skids.push(v3(front, belly, 0), v3(-ch.length / 2 + 0.02, belly, 0));
    }
    if (d.axleStubs) {
      for (const side of [-1, 1]) {
        const sd = RAPIER.ColliderDesc.cylinder(d.axleStubs / 2, 0.02)
          .setTranslation(ax, wy, side * (d.track / 2 + d.wheelWidth / 2 + d.axleStubs / 2))
          .setRotation(qWheel).setDensity(0).setFriction(0.3).setCollisionGroups(COLLIDE.chassis);
        const sc = world.createCollider(sd, this.body);
        tags.set(sc.handle, { bot: this, part: 'chassis' });
      }
    }
    const n = this.wheels.length;
    this.k = (this.mass * 9.81) / (n * 0.006);
    this.c = 2 * 0.65 * Math.sqrt((this.k * this.mass) / n);

    // --- armor panels ---
    const A = panelAreas(design);
    const cap = (area: number, p: { material: keyof typeof MATERIALS; thickness: number }) =>
      area * p.thickness * MATERIALS[p.material].toughness;
    const arm = ch.armor;
    this.panels = {
      front: { capacity: cap(A.front, arm.front), integrity: 1, material: arm.front.material },
      rear: { capacity: cap(A.rear, arm.rear), integrity: 1, material: arm.rear.material },
      left: { capacity: cap(A.sides / 2, arm.sides), integrity: 1, material: arm.sides.material },
      right: { capacity: cap(A.sides / 2, arm.sides), integrity: 1, material: arm.sides.material },
      top: { capacity: cap(A.top, arm.top), integrity: 1, material: arm.top.material },
      bottom: { capacity: cap(A.bottom, arm.bottom), integrity: 1, material: arm.bottom.material },
    };

    // --- weapon ---
    const w = design.weapon;
    if (w.type === 'spinner') {
      const vertical = isVertical(w.style);
      const axisLocal = vertical ? v3(0, 0, 1) : v3(0, 1, 0);
      const shapeRotLocal = vertical ? qWheel : { x: 0, y: 0, z: 0, w: 1 };
      const halfWidth = w.width / 2;
      const shape = new RAPIER.Cylinder(halfWidth + 0.01, w.radius);
      const restLow = ch.clearance + ch.height / 2 + w.mountY - (vertical ? w.radius : halfWidth);
      const wcd = RAPIER.ColliderDesc.cylinder(halfWidth, w.radius * 0.97)
        .setTranslation(w.mountX, w.mountY, 0)
        .setRotation(shapeRotLocal)
        .setDensity(0).setFriction(0).setRestitution(0.1)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(restLow < 0.03 ? COLLIDE.weapon : COLLIDE.weaponHigh);
      this.weaponCollider = world.createCollider(wcd, this.body);
      tags.set(this.weaponCollider.handle, { bot: this, part: 'weapon' });
      this.spinner = {
        kind: 'spinner', omega: 0, angle: 0, on: false, inertia: rotorInertia(w), axisLocal,
        mountLocal: v3(w.mountX, w.mountY, 0), radius: w.radius, halfWidth, dir: w.dir ?? 1,
        shape, shapeRotLocal, hitCooldown: 0, toothDamage: 0, current: 0, lastToggle: false,
      };
    } else if (w.type === 'flipper' || w.type === 'hammer' || w.type === 'crusher') {
      this.actuator = {
        kind: w.type, pos: 0, phase: 'rest', timer: 0, cooldown: 0,
        shots: w.type === 'flipper' ? w.shots : Infinity, struck: false, lastFire: false, sawAngle: 0,
      };
    }
    if (design.secondary) {
      this.secondaryAct = {
        kind: 'flipper', pos: 0, phase: 'rest', timer: 0, cooldown: 0, shots: Infinity, struck: false, lastFire: false, sawAngle: 0,
      };
    }
  }

  // ---------- frame helpers ----------
  get pos(): V3 { return this.body.translation(); }
  get rot(): Q4 { return this.body.rotation(); }
  toWorld(p: V3): V3 { return add(this.body.translation(), rotate(this.body.rotation(), p)); }
  toLocal(p: V3): V3 { return invRotate(this.body.rotation(), sub(p, this.body.translation())); }
  dirWorld(d: V3): V3 { return rotate(this.body.rotation(), d); }
  get up(): V3 { return this.dirWorld(v3(0, 1, 0)); }
  get forward(): V3 { return this.dirWorld(v3(1, 0, 0)); }
  get comWorld(): V3 { return this.toWorld(this.comLocal); }
  get inverted() { return this.up.y < -0.25; }
  get onSide() { return Math.abs(this.up.y) <= 0.25; }

  /** 1 / effective mass of this body at world point p along unit direction t */
  invMassAt(p: V3, t: V3) {
    const rp = sub(p, this.comWorld);
    const rxt = cross(rp, t);
    const q = this.rot;
    const l = invRotate(q, rxt);
    const iw = rotate(q, v3(l.x * this.invInertia.x, l.y * this.invInertia.y, l.z * this.invInertia.z));
    return 1 / this.mass + dot(rxt, iw);
  }

  impulse(j: V3, p: V3) {
    this.body.applyImpulseAtPoint(j, p, true);
  }

  // ---------- per-step simulation ----------

  /** drivetrain, battery, weapon motor. Call before world.step(). */
  update(dt: number, ctx: StepContext) {
    const d = this.design;
    const inp = this.dead || this.tappedOut ? NO_INPUT : this.input;
    const elecOK = this.internals.electronics > 0 && this.internals.battery > 0;

    // battery
    const battR = batteryResistance(d.battery) * (1 + (1 - this.internals.battery) * 3);
    const ocv = d.battery.cellsS * cellVoltage(this.soc);
    this.volts = Math.max(0, ocv - this.amps * battR);
    const V = elecOK ? this.volts : 0;

    // control mixing (arcade), with auto-invert when upside down
    let t = clamp(inp.throttle, -1, 1), u = clamp(inp.turn, -1, 1);
    let left = t + u, right = t - u;
    const m = Math.max(1, Math.abs(left), Math.abs(right));
    left /= m; right /= m;
    if (this.autoInvert && this.inverted) {
      const l = -(t - u), r = -(t + u);
      const mm = Math.max(1, Math.abs(l), Math.abs(r));
      left = l / mm; right = r / mm;
    }

    // ---- wheels ----
    const pos = this.pos;
    const q = this.rot;
    const lin = this.body.linvel();
    const ang = this.body.angvel();
    const tire = TIRES[d.drive.tire];
    const dm = MOTORS[d.drive.motor];
    const Kt = motorKt(dm);
    const Rm = dm.resistance;
    const nM = d.drive.motorsPerSide;
    const G = d.drive.ratio;
    const eta = 0.88;
    const s0 = 0.18; // m/s slip at which tire force saturates (~76%)
    const axisW = rotate(q, v3(0, 0, 1));
    let driveAmps = 0;

    type Contact = { w: WheelState; p: V3; n: V3; f: V3; l: V3; N: number; v: number; vl: number; other: RigidBody | null };
    const contacts: Contact[][] = [[], []];
    for (const w of this.wheels) {
      w.contact = false;
      w.normalForce = 0;
      if (!w.attached) continue;
      const center = add(pos, rotate(q, w.local));
      if (Math.abs(axisW.y) > 0.92) continue; // wheel lying flat
      const ray = new RAPIER.Ray(center, { x: 0, y: -1, z: 0 });
      // a leaning wheel touches down on its rim edge: center height is r·cos(lean)
      const lean = Math.sqrt(Math.max(0, 1 - axisW.y * axisW.y));
      // ears / horns: upside down, an override-invertible bot rides on its outriggers
      const rEff = this.inverted && d.chassis.invertibleOverride ? Math.max(w.r, d.chassis.height / 2 - w.local.y + d.chassis.clearance * 0.5 + 0.006) : w.r * lean;
      const hit = this.world.castRayAndGetNormal(ray, rEff + 0.02, true, undefined, COLLIDE.wheelRay, undefined, this.body);
      if (!hit) continue;
      const tag = ctx.tags.get(hit.collider.handle);
      if (tag?.bot === this) continue;
      const toi = hit.timeOfImpact;
      const comp = Math.min(w.r * 0.5, rEff - toi);
      if (comp <= 0) continue;
      let nrm = hit.normal as V3;
      if (toi === 0) nrm = v3(0, 1, 0);
      const p = madd(center, v3(0, -1, 0), toi);
      // velocity of the contact point relative to the ground under it
      const rp = sub(p, this.body.translation());
      let vp = add(lin, cross(ang, rp));
      const otherBody = hit.collider.parent();
      const other = otherBody && otherBody.isDynamic() ? otherBody : null;
      if (other) vp = sub(vp, other.velocityAtPoint(p));
      const closing = -dot(vp, nrm);
      // rim contact grips less the further the wheel leans
      const N = clamp(this.k * comp + this.c * closing, 0, this.mass * 9.81 * 8) * (0.35 + 0.65 * lean);
      if (N <= 0) continue;
      const f = norm(cross(nrm, axisW));
      const l = norm(sub(axisW, scale(nrm, dot(axisW, nrm))));
      w.contact = true;
      w.normalForce = N;
      contacts[w.side].push({ w, p, n: nrm, f, l, N, v: dot(vp, f), vl: dot(vp, l), other });
    }

    // skids: stiff, low-friction contact points that only carry load when the bot pitches onto them
    for (const sk of this.skids) {
      const p0 = add(pos, rotate(q, sk));
      const probe = 0.04;
      const ray = new RAPIER.Ray(madd(p0, v3(0, 1, 0), probe), { x: 0, y: -1, z: 0 });
      const hit = this.world.castRayAndGetNormal(ray, probe + 0.01, true, undefined, COLLIDE.wheelRay, undefined, this.body);
      if (!hit || ctx.tags.get(hit.collider.handle)?.bot === this) continue;
      const comp = probe - hit.timeOfImpact;
      if (comp <= 0) continue;
      const p = madd(p0, v3(0, 1, 0), comp);
      const vp = add(lin, cross(ang, sub(p, pos)));
      const N = clamp(this.k * 1.5 * comp + this.c * -vp.y, 0, this.mass * 9.81 * 4);
      const vh = v3(vp.x, 0, vp.z);
      const sp = len(vh);
      const Ff = sp > 1e-4 ? scale(vh, (-0.28 * N * Math.tanh(sp / 0.05)) / sp) : v3();
      this.body.applyImpulseAtPoint(scale(add(v3(0, N, 0), Ff), dt), p, true);
    }

    for (const side of [0, 1] as const) {
      const cmd = side === 0 ? left : right;
      const health = side === 0 ? this.internals.driveL : this.internals.driveR;
      const Vm = cmd * V * (health > 0 ? 1 : 0);
      const iMax = dm.maxCurrent * (0.35 + 0.65 * health);
      const torqueAt = (om: number) => {
        const i = clamp((Vm - Kt * om * G) / Rm, -iMax, iMax);
        return { T: nM * eta * G * Kt * i, i };
      };
      const cs = contacts[side];
      const ws = this.wheels.filter((w) => w.side === side && w.attached);
      if (!ws.length) continue;
      const r = ws[0].r;
      let omega: number;
      if (cs.length && health > 0) {
        const mu = tire.mu;
        const g = (om: number) => {
          let F = 0;
          for (const c of cs) F += mu * c.N * Math.tanh((om * r - c.v) / s0);
          return torqueAt(om).T - F * r;
        };
        let vmax = 0;
        for (const c of cs) vmax = Math.max(vmax, Math.abs(c.v));
        const bound = (Kt > 0 ? (V / (Kt * G)) * 1.6 : 50) + (vmax / r) * 1.6 + 5;
        let lo = -bound, hi = bound;
        for (let it = 0; it < 26; it++) {
          const mid = (lo + hi) / 2;
          if (g(mid) > 0) lo = mid; else hi = mid;
        }
        omega = (lo + hi) / 2;
      } else {
        // wheel in the air (or dead side): spins toward free speed / coasts
        const target = health > 0 ? (Vm / (Kt * G)) * 0.95 : ws[0].omega * 0.98;
        omega = ws[0].omega + (target - ws[0].omega) * Math.min(1, dt * 10);
      }
      const { i } = torqueAt(omega);
      driveAmps += nM * i * cmd; // battery sees duty-cycled motor current
      for (const w of ws) { w.omega = omega; w.angle += omega * dt; }

      for (const c of cs) {
        const mu = tire.mu;
        const slip = omega * r - c.v;
        let Fl = mu * c.N * Math.tanh(slip / s0);
        let Ft = -mu * 0.95 * c.N * Math.tanh(c.vl / 0.12);
        const roll = -0.012 * c.N * Math.tanh(c.v / 0.05);
        const mag = Math.hypot(Fl, Ft);
        const lim = mu * c.N;
        if (mag > lim) { Fl *= lim / mag; Ft *= lim / mag; }
        const F = add(add(scale(c.f, Fl + roll), scale(c.l, Ft)), scale(c.n, c.N));
        const J = scale(F, dt);
        this.body.applyImpulseAtPoint(J, c.p, true);
        if (c.other) c.other.applyImpulseAtPoint(scale(J, -1), c.p, true);
      }
    }

    // ---- weapon motor ----
    let weaponAmps = 0;
    const sp = this.spinner;
    const w = d.weapon;
    if (sp && w.type === 'spinner') {
      const wm = MOTORS[w.motor];
      const wKt = motorKt(wm);
      // toggle on press
      if (inp.weapon && !sp.lastToggle) sp.on = !sp.on;
      sp.lastToggle = inp.weapon;
      if (inp.alt && !d.secondary && w.reversible && Math.abs(sp.omega) < 5) sp.dir = (sp.dir === 1 ? -1 : 1);
      const health = this.internals.weapon;
      const working = health > 0 && (elecOK || wm.id === 'ice-engine' && this.internals.electronics > 0);
      let drive = 0;
      if (wm.id === 'ice-engine') {
        // gasoline engine through a centrifugal clutch: power-limited, no battery draw
        const om = Math.abs(sp.omega) * w.ratio;
        const wMax = (ENGINE.maxRpm * Math.PI * 2) / 60;
        if (sp.on && working && om < wMax) drive = Math.min((ENGINE.power * (0.5 + 0.5 * health)) / Math.max(om, 40), 95) * w.ratio * 0.9;
        sp.current = 0;
      } else {
        const Vw = sp.on && working ? V : 0;
        const omM = Math.abs(sp.omega) * w.ratio;
        let iw = 0;
        if (Vw > 0) iw = clamp((Vw - wKt * omM) / wm.resistance, 0, wm.maxCurrent * (0.4 + 0.6 * health));
        sp.current = iw * w.motorCount;
        weaponAmps = sp.current;
        drive = w.motorCount * wKt * Math.max(0, iw - wm.noLoadCurrent) * w.ratio * 0.92;
      }
      const fric = 0.6 + 0.02 * Math.abs(sp.omega) + (1 - health) * 6;
      const windage = 0.00004 * sp.omega * sp.omega * sp.radius * sp.radius * (w.width * 30);
      let a = (drive - fric - windage) / sp.inertia;
      if (!sp.on || !working) a = -(fric + windage + (sp.on ? 0 : 2.5)) / sp.inertia; // ESC brake when off
      const mag = Math.max(0, Math.abs(sp.omega) + a * dt);
      this.spinAccel = a;
      sp.omega = mag * sp.dir;
      sp.angle += sp.omega * dt;
      sp.hitCooldown = Math.max(0, sp.hitCooldown - dt);

      // gyroscopic reaction on the chassis: tau = -(Omega x L), except mid self-right
      this.selfRightFlight = Math.max(0, this.selfRightFlight - dt);
      if (this.selfRightFlight <= 0) {
      const Lw = scale(this.dirWorld(sp.axisLocal), sp.inertia * sp.omega);
      const tau = scale(cross(ang, Lw), -1);
      const tmag = len(tau);
      // a shell's spin axis is vertical, so driving never loads it; only cap the top-like precession on its rim
      const tmax = this.mass * 9.81 * (w.style === 'shell' ? 0.05 : 0.6);
      const tt = tmag > tmax ? scale(tau, tmax / tmag) : tau;
      this.body.applyTorqueImpulse(scale(tt, dt), true);
      }
    }

    this.flameOn = !!inp.flame && !!d.flame && elecOK;
    this.invertedTime = this.inverted || this.onSide ? this.invertedTime + dt : 0;
    this.selfRightCooldown = Math.max(0, this.selfRightCooldown - dt);

    // ---- battery accounting ----
    this.ampsDrive = driveAmps;
    const total = Math.max(-40, driveAmps + weaponAmps + 1.5);
    this.amps = this.amps + (total - this.amps) * Math.min(1, dt * 60);
    const capAs = d.battery.capacityAh * d.battery.packs * 3600;
    this.soc = Math.max(0, this.soc - (this.amps * dt) / capAs);
    this.whUsed += (this.amps * this.volts * dt) / 3600;

    // battery fire: smolders when the pack is badly damaged
    if (this.internals.battery < 0.45 && !this.onFire) this.onFire = true;
    if (this.onFire) {
      this.fireTimer += dt;
      this.internals.battery = Math.max(0, this.internals.battery - dt * 0.004);
    }

    this.speed = len(lin);
  }

  takeInternal(part: keyof Internals, joules: number) {
    if (joules <= 0) return;
    const before = this.internals[part];
    this.internals[part] = Math.max(0, before - joules / INTERNAL_HP[part]);
    return before > 0 && this.internals[part] === 0;
  }

  /** Clear of the floor (thrown, launched, falling). */
  airborne() {
    return this.pos.y > this.design.chassis.clearance + Math.max(this.half.y, this.design.drive.wheelDiameter / 2) + 0.12;
  }

  /** Is the robot capable of controlled translational movement? (KO rule) */
  canMove() {
    if (this.dead || this.tappedOut) return false;
    if (this.internals.electronics <= 0 || this.internals.battery <= 0) return false;
    if (this.internals.driveL <= 0 && this.internals.driveR <= 0) return false;
    if (this.onSide) return false;
    if (this.inverted && !this.stats.invertible) return false;
    return this.wheels.some((w) => w.attached && w.contact);
  }

  weaponEnergy() {
    const sp = this.spinner;
    return sp ? 0.5 * sp.inertia * sp.omega * sp.omega : 0;
  }

  detachWheel(i: number) {
    const w = this.wheels[i];
    if (!w.attached) return;
    w.attached = false;
    if (w.collider) { this.tags?.delete(w.collider.handle); this.world.removeCollider(w.collider, true); w.collider = null; }
  }

  weaponPoseWorld() {
    const sp = this.spinner!;
    return {
      pos: this.toWorld(sp.mountLocal),
      rot: qmul(this.rot, sp.shapeRotLocal),
      axis: this.dirWorld(sp.axisLocal),
    };
  }
}

export interface StepContext {
  tags: TagMap;
}

/** Convex hull points for the chassis, in body frame. */
export function chassisHull(d: BotDesign): Float32Array {
  if (d.chassis.blueprint) return blueprintHull(d.chassis.blueprint);
  const { length: L, width: W, height: H, wedgeLength: wl, clearance, shape } = d.chassis;
  const hx = L / 2, hy = H / 2, hz = W / 2;
  const pts: number[] = [];
  const P = (x: number, y: number, z: number) => pts.push(x, y, z);
  const lipY = -hy - clearance + 0.005;
  if (shape === 'ring') {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      for (const y of [-hy, hy]) P(Math.cos(a) * hx, y, Math.sin(a) * hz);
    }
    return new Float32Array(pts);
  }
  // main box (top slightly inset for a beveled look); the nose can taper
  const tf = d.chassis.noseTaper ?? 1;
  for (const x of [-hx, hx]) for (const z of [-hz, hz]) {
    const zz = x > 0 ? z * tf : z;
    P(x, -hy, zz); P(x * 0.97, hy, zz * 0.97);
  }
  if (wl > 0) {
    P(hx + wl, lipY, -hz * tf); P(hx + wl, lipY, hz * tf);
    if (shape === 'double-wedge') {
      const rl = Math.min(L * 0.35, 0.3);
      P(-hx - rl, lipY, -hz); P(-hx - rl, lipY, hz);
    }
  }
  return new Float32Array(pts);
}

export function velAt(b: BotRuntime, p: V3) { return b.body.velocityAtPoint(p) as V3; }
export { len, sub, dot, norm };
