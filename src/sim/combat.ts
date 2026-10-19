// Weapon contact models. Spinner hits are resolved as an impulsive collision
// between the rotor (effective mass I/ρ² at the tooth) and the target point
// (effective mass from its inertia tensor), scaled by tooth "bite". The kinetic
// energy that doesn't end up as motion is deformation, which is the damage.

import type RAPIERNS from '@dimforge/rapier3d-compat';
import { RAPIER, COLLIDE } from './physics';
import { ActuatorState, BotRuntime, Face, ColliderTag, Internals, TagMap } from './bot';
import { MATERIALS } from './parts';
import type { FlipperWeapon } from './design';
import { V3, add, clamp, cross, dot, len, madd, norm, rotate, scale, sub, v3 } from './vec';

type Collider = RAPIERNS.Collider;

export type HitKind = 'spinner' | 'clash' | 'wall' | 'flip' | 'hammer' | 'saw' | 'crush' | 'hazard' | 'ram' | 'landing';

export interface HitEvent {
  type: 'hit';
  kind: HitKind;
  pos: V3;
  dir: V3;
  energy: number; // J of deformation
  impulse: number; // N·s
  bite?: number;
  attacker: number; // bot index, -1 = arena
  target: number; // bot index, -1 = arena
  face?: Face;
  material?: string;
  hazardId?: string;
}
export interface BreakEvent {
  type: 'break';
  bot: number;
  part: 'panel' | 'wheel' | 'weapon' | 'tooth' | 'battery' | 'electronics' | 'driveL' | 'driveR';
  face?: Face;
  pos: V3;
  severity: number; // 0..1
}
export interface FireEvent { type: 'fire'; bot: number }
export interface ActuateEvent { type: 'actuate'; bot: number; kind: 'flip' | 'hammer' | 'saw' | 'crush' | 'self-right' | 'lift'; pos: V3 }
export interface DebrisEvent { type: 'debris'; id: number; spec: DebrisSpawn }
export interface PhaseEvent { type: 'phase'; phase: 'fight' }
export interface KoEvent { type: 'ko-start' | 'ko-cancel' | 'deck-count' | 'pin-start' | 'separate'; bot: number }
export interface HazardsLiveEvent { type: 'hazards-live' }
export interface OverEvent { type: 'over'; result: import('./match').MatchResult }
export type SimEvent = HitEvent | BreakEvent | FireEvent | ActuateEvent | DebrisEvent | PhaseEvent | KoEvent | OverEvent | HazardsLiveEvent;

export interface DebrisSpawn {
  kind: 'plate' | 'wheel' | 'tooth' | 'chunk' | 'bolt';
  size: V3;
  color: string;
  material: string;
  pos: V3;
  vel: V3;
  angvel: V3;
}

export interface CombatContext {
  tags: TagMap;
  world: RAPIERNS.World;
  bots: BotRuntime[];
  emit: (e: SimEvent) => void;
  spawn: (d: DebrisSpawn) => void;
  rand: () => number;
  time: number;
}

const FACE_INTERNALS: Record<Face, [keyof Internals, number][]> = {
  front: [['weapon', 0.5], ['electronics', 0.15], ['battery', 0.15], ['driveL', 0.1], ['driveR', 0.1]],
  rear: [['battery', 0.35], ['electronics', 0.3], ['driveL', 0.175], ['driveR', 0.175]],
  left: [['driveL', 0.55], ['battery', 0.2], ['electronics', 0.1], ['weapon', 0.15]],
  right: [['driveR', 0.55], ['battery', 0.2], ['electronics', 0.1], ['weapon', 0.15]],
  top: [['electronics', 0.35], ['battery', 0.35], ['weapon', 0.3]],
  bottom: [['battery', 0.3], ['driveL', 0.25], ['driveR', 0.25], ['electronics', 0.2]],
};

/** Which armor face takes a hit: the contact point, biased toward the face that looks back at the blow. */
export function faceStruck(b: BotRuntime, pWorld: V3, dir: V3): Face {
  const l = b.toLocal(pWorld);
  const d = rotateInv(b, dir);
  const h = b.half;
  const cand: [Face, number][] = [
    ['front', l.x / h.x - d.x * 1.2], ['rear', -l.x / h.x + d.x * 1.2],
    ['right', l.z / h.z - d.z * 1.2], ['left', -l.z / h.z + d.z * 1.2],
    ['top', l.y / h.y - d.y * 1.2 - 0.3], ['bottom', -l.y / h.y + d.y * 1.2 - 0.6],
  ];
  cand.sort((a, b2) => b2[1] - a[1]);
  return cand[0][0];
}
function rotateInv(b: BotRuntime, v: V3): V3 {
  const q = b.rot;
  return rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
}

export function faceAt(b: BotRuntime, pWorld: V3): Face {
  const l = b.toLocal(pWorld);
  const h = b.half;
  const nx = l.x / h.x, ny = l.y / h.y, nz = l.z / h.z;
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ax >= ay && ax >= az) return nx > 0 ? 'front' : 'rear';
  if (az >= ay) return nz > 0 ? 'right' : 'left';
  return ny > 0 ? 'top' : 'bottom';
}

/** Apply deformation energy to a robot at a world point. */
export function applyDamage(ctx: CombatContext, b: BotRuntime, pWorld: V3, joules: number, tag?: ColliderTag, forceFace?: Face) {
  if (joules <= 0 || b.dead && b.damageTaken > 1e7) return;
  b.damageTaken += joules;
  // wheels take hits directly
  if (tag?.part === 'wheel' && tag.index !== undefined) {
    const w = b.wheels[tag.index];
    if (w.attached) {
      w.hp -= joules * 0.75;
      const side: keyof Internals = w.side === 0 ? 'driveL' : 'driveR';
      b.takeInternal(side, joules * 0.15);
      if (w.hp <= 0) {
        const wp = b.toWorld(w.local);
        b.detachWheel(tag.index);
        ctx.emit({ type: 'break', bot: b.index, part: 'wheel', pos: wp, severity: 1 });
        ctx.spawn({
          kind: 'wheel', size: v3(w.r, w.r, w.width), color: b.design.look.tireColor ?? '#2a2a2a', material: 'rubber',
          pos: wp, vel: add(b.body.linvel(), v3((ctx.rand() - 0.5) * 6, 4 + ctx.rand() * 4, (ctx.rand() - 0.5) * 6)),
          angvel: v3(ctx.rand() * 30, ctx.rand() * 30, ctx.rand() * 30),
        });
      }
      return;
    }
  }
  if (tag?.part === 'weapon') {
    const broke = b.takeInternal('weapon', joules * 0.5);
    if (b.spinner) b.spinner.toothDamage = Math.min(0.8, b.spinner.toothDamage + joules / 300000);
    if (broke) ctx.emit({ type: 'break', bot: b.index, part: 'weapon', pos: pWorld, severity: 1 });
    joules *= 0.5;
  }
  const face = forceFace ?? faceAt(b, pWorld);
  const panel = b.panels[face];
  const before = panel.integrity;
  const through = joules * (0.06 + 0.7 * Math.pow(1 - before, 1.5));
  const toPanel = joules - through;
  panel.integrity = Math.max(0, before - toPanel / panel.capacity);
  let spill = through + Math.max(0, toPanel - before * panel.capacity);
  // plate fragments break off as the panel crosses thresholds
  for (const th of [0.66, 0.33, 0.0]) {
    if (before > th && panel.integrity <= th) {
      ctx.emit({ type: 'break', bot: b.index, part: 'panel', face, pos: pWorld, severity: 1 - th });
      const mat = MATERIALS[panel.material as keyof typeof MATERIALS];
      const s = 0.06 + ctx.rand() * 0.12;
      ctx.spawn({
        kind: th === 0 ? 'plate' : 'chunk', size: v3(s * (th === 0 ? 2.2 : 1), 0.008 + ctx.rand() * 0.01, s * (th === 0 ? 1.6 : 1)),
        color: face === 'top' || face === 'front' ? b.design.look.primary : b.design.look.secondary,
        material: mat?.id ?? 'ar500', pos: pWorld,
        vel: add(scale(norm(sub(pWorld, b.pos)), 4 + ctx.rand() * 5), v3(0, 3 + ctx.rand() * 4, 0)),
        angvel: v3(ctx.rand() * 40 - 20, ctx.rand() * 40 - 20, ctx.rand() * 40 - 20),
      });
    }
  }
  // what's behind the armor
  for (const [part, share] of FACE_INTERNALS[face]) {
    if (part === 'weapon' && b.design.weapon.type === 'none') continue;
    const broke = b.takeInternal(part, spill * share * (0.7 + ctx.rand() * 0.6));
    if (broke) {
      ctx.emit({ type: 'break', bot: b.index, part, pos: pWorld, severity: 1 });
      if (part === 'battery') { b.onFire = true; ctx.emit({ type: 'fire', bot: b.index }); }
    }
  }
  if (b.internals.battery < 0.45 && !b.onFire) { b.onFire = true; ctx.emit({ type: 'fire', bot: b.index }); }
  spill = 0;
}

// --------------------------------------------------------------------------

const tmpHits: { col: Collider; tag: ColliderTag }[] = [];

/** Spinner sweep: find what the rotor's swept volume overlaps and resolve the deepest strike. */
export function spinnerStep(ctx: CombatContext, a: BotRuntime, dt: number) {
  const sp = a.spinner;
  const w = a.design.weapon;
  if (!sp || w.type !== 'spinner' || sp.hitCooldown > 0) return;
  const omega = Math.abs(sp.omega);
  if (omega < 8) return;
  const pose = a.weaponPoseWorld();
  // rotor scraping the floor: a spray of sparks, nothing else
  {
    const ax = pose.axis;
    const low = pose.pos.y - sp.radius * Math.sqrt(Math.max(0, 1 - ax.y * ax.y)) - Math.abs(ax.y) * sp.halfWidth;
    if (low < 0.004 && omega > 40 && ctx.rand() < dt * 25) {
      const down = norm(v3(-ax.x * ax.y, 1 - ax.y * ax.y, -ax.z * ax.y));
      const p = sub(pose.pos, scale(down, sp.radius));
      p.y = 0.005;
      const tdir = norm(cross(ax, v3(0, -1, 0)));
      ctx.emit({ type: 'hit', kind: 'wall', pos: p, dir: scale(tdir, Math.sign(sp.omega)), energy: 150, impulse: 0, attacker: a.index, target: -1, material: 'ar500' });
    }
  }
  tmpHits.length = 0;
  ctx.world.intersectionsWithShape(pose.pos, pose.rot, sp.shape, (col) => {
    const tag = ctx.tags.get(col.handle);
    if (tag && tag.bot !== a) tmpHits.push({ col, tag });
    return true;
  }, undefined, COLLIDE.weaponQuery, undefined, a.body);
  if (!tmpHits.length) return;

  // deepest contact wins
  let best: { col: Collider; tag: ColliderTag; c: RAPIERNS.ShapeContact } | null = null;
  for (const h of tmpHits) {
    const c = sp.shape.contactShape(pose.pos, pose.rot, h.col.shape, h.col.translation(), h.col.rotation(), 0.0);
    if (!c || c.distance > 0.002) continue;
    // must be on the exposed part of the rotor (outside our own chassis)
    const lp = a.toLocal(c.point2);
    const inside = w.style !== 'shell' && Math.abs(lp.x) < a.half.x - 0.01 && Math.abs(lp.z) < a.half.z - 0.01 && Math.abs(lp.y) < a.half.y + 0.03;
    if (inside) continue;
    if (!best || c.distance < best.c.distance) best = { ...h, c };
  }
  if (!best) return;
  const { tag, c } = best;
  const p = c.point2 as V3;
  const axis = pose.axis;
  const center = pose.pos;
  const rv = sub(p, center);
  const rperp = sub(rv, scale(axis, dot(rv, axis)));
  let rho = len(rperp);
  if (rho < 0.25 * sp.radius) return; // hub, not teeth
  rho = Math.min(rho, sp.radius);
  const rhat = scale(rperp, 1 / rho);
  const t = scale(norm(cross(axis, rhat)), Math.sign(sp.omega));
  const vTip = omega * rho;

  const target = tag.bot;
  const vA = a.body.velocityAtPoint(p) as V3;
  const vT = target ? (target.body.velocityAtPoint(p) as V3) : v3();
  const vrel = vTip + dot(sub(vA, vT), t);
  if (vrel < 2) return;

  // bite: how far the target closes into the rotor between teeth
  const teeth = Math.max(1, w.teeth);
  const toothPeriod = (2 * Math.PI) / (omega * teeth);
  const vClose = Math.max(0.5, -dot(sub(vT, vA), rhat) + 0.4);
  const bite = clamp((vClose * toothPeriod) / Math.max(0.004, w.toothHeight), 0.1, 1) * (1 - sp.toothDamage * 0.5);

  const invMw = (rho * rho) / sp.inertia;
  let invMt = 0;
  let kind: HitKind = 'wall';
  if (target) {
    invMt = target.invMassAt(p, t);
    kind = tag.part === 'weapon' && target.spinner && Math.abs(target.spinner.omega) > 20 ? 'clash' : 'spinner';
  } else if (tag.part === 'hazard') kind = 'hazard';

  const e = 0.25;
  const engagement = 0.72;
  let J = (engagement * (1 + e) * vrel * bite * a.punchBoost) / (invMw + invMt);
  J = Math.min(J, (0.97 * sp.inertia * omega) / rho);

  // weapon-on-weapon: both rotors give up energy
  if (kind === 'clash' && target?.spinner) {
    const ts = target.spinner;
    const tw = target.design.weapon;
    if (tw.type === 'spinner') {
      const tpose = target.weaponPoseWorld();
      const trv = sub(p, tpose.pos);
      const trp = sub(trv, scale(tpose.axis, dot(trv, tpose.axis)));
      const trho = Math.max(0.05, Math.min(len(trp), ts.radius));
      const tt = scale(norm(cross(tpose.axis, scale(trp, 1 / trho))), Math.sign(ts.omega));
      const vrel2 = vTip - Math.abs(ts.omega) * trho * dot(tt, t);
      const invMw2 = (trho * trho) / ts.inertia;
      J = Math.min((0.8 * (1 + e) * Math.max(vrel2, vTip * 0.5)) / (invMw + invMw2 + invMt), (0.97 * sp.inertia * omega) / rho);
      const dL2 = J * trho * Math.max(0.3, Math.abs(dot(tt, t)));
      ts.omega = Math.sign(ts.omega) * Math.max(0, Math.abs(ts.omega) - dL2 / ts.inertia);
      ts.hitCooldown = 0.03;
    }
  }

  const E0 = 0.5 * sp.inertia * omega * omega;
  const newOmega = Math.max(0, omega - (J * rho) / sp.inertia);
  sp.omega = Math.sign(sp.omega) * newOmega;
  const E1 = 0.5 * sp.inertia * newOmega * newOmega;
  const dE = E0 - E1;
  const keTarget = 0.5 * J * J * invMt;
  const deform = Math.max(0, dE - keTarget) * 0.85;

  const impulse = scale(t, J);
  if (target) {
    target.impulse(impulse, p);
    applyDamage(ctx, target, p, deform * (kind === 'clash' ? 0.35 : 1), tag, faceStruck(target, p, t));
    target.damageTaken += 0; // (counted in applyDamage)
    a.damageDealt += deform;
    if (deform > 25000) a.bigHits++;
  }
  // reaction on the attacker goes through the axle; the spin-axis torque went into the rotor
  const reaction = scale(impulse, -1);
  a.body.applyImpulse(reaction, true);
  const arm = sub(center, a.comWorld);
  const tq = cross(arm, reaction);
  // off-axis component of the contact torque also reaches the chassis via the bearings
  const offAxis = cross(sub(p, center), reaction);
  const offAxisPerp = sub(offAxis, scale(axis, dot(offAxis, axis)));
  a.body.applyTorqueImpulse(add(tq, offAxisPerp), true);

  // the weapon pays for it too: hard targets break teeth and bearings
  const hard = target ? (MATERIALS[target.panels[faceStruck(target, p, t)].material as keyof typeof MATERIALS]?.hardness ?? 0.7) : 0.9;
  const selfDmg = deform * (kind === 'clash' ? 0.35 : 0.035 + 0.04 * hard);
  const broke = a.takeInternal('weapon', selfDmg);
  if (deform > 35000 && ctx.rand() < 0.12 + (kind === 'clash' ? 0.3 : 0)) {
    sp.toothDamage = Math.min(0.8, sp.toothDamage + 0.2);
    ctx.emit({ type: 'break', bot: a.index, part: 'tooth', pos: p, severity: 0.6 });
    ctx.spawn({
      kind: 'tooth', size: v3(0.07, 0.04, 0.05), color: '#9aa0a6', material: 's7', pos: p,
      vel: add(scale(t, 18 + ctx.rand() * 10), v3(0, 6, 0)), angvel: v3(50, 30, 20),
    });
  }
  if (broke) ctx.emit({ type: 'break', bot: a.index, part: 'weapon', pos: center, severity: 1 });

  ctx.emit({
    type: 'hit', kind, pos: p, dir: t, energy: deform, impulse: J, bite,
    attacker: a.index, target: target ? target.index : -1,
    face: target ? faceStruck(target, p, t) : undefined,
    material: target ? target.panels[faceStruck(target, p, t)].material : 'ar500',
    hazardId: tag.hazardId,
  });

  // the next tooth can't land until the rotor comes around and the target re-closes
  sp.hitCooldown = Math.max(toothPeriod, 0.012) + (kind === 'clash' ? 0.05 : 0);
  void dt;
}

// --------------------------------------------------------------------------

function overlapBots(ctx: CombatContext, a: BotRuntime, center: V3, half: V3) {
  const shape = new RAPIER.Cuboid(half.x, half.y, half.z);
  const found = new Map<BotRuntime, { col: Collider; tag: ColliderTag }>();
  ctx.world.intersectionsWithShape(center, a.rot, shape, (col) => {
    const tag = ctx.tags.get(col.handle);
    if (tag?.bot && tag.bot !== a && !found.has(tag.bot)) found.set(tag.bot, { col, tag });
    return true;
  }, undefined, COLLIDE.weaponQuery, undefined, a.body);
  return [...found.entries()];
}


interface FlipperLike {
  style: 'flipper' | 'lifter';
  actuator: FlipperWeapon['actuator'];
  energy: number; plateLength: number; plateWidth: number; cooldown: number;
}

function runFlipper(ctx: CombatContext, a: BotRuntime, act: ActuatorState, w: FlipperLike, pressed: boolean, working: boolean, dt: number) {
  const L = a.design.chassis.length, H = a.design.chassis.height;
  const fwd = a.forward;
  if (act.phase === 'rest' && pressed && working && act.cooldown <= 0 && act.shots > 0) {
    act.phase = 'firing'; act.timer = 0; act.struck = false;
    if (w.actuator === 'pneumatic') act.shots--;
    // the clutch dumps whatever the flywheel holds into this shot; it re-spins from empty
    if (w.actuator === 'flywheel') { act.shotPower = act.charge ?? 0; act.charge = 0; }
  }
  if (act.phase === 'firing') {
    const rise = w.style === 'lifter' ? 0.45 : 0.07;
    act.timer += dt;
    act.pos = Math.min(1, act.timer / rise);
    if (!act.struck) {
      const zc = a.toWorld(v3(L / 2 + a.design.chassis.wedgeLength * 0.4 - w.plateLength * 0.35, H / 2 + 0.06, 0));
      const targets = overlapBots(ctx, a, zc, v3(w.plateLength * 0.55, H / 2 + 0.12, w.plateWidth / 2));
      if (targets.length) {
        act.struck = true;
        for (const [t] of targets) {
          const E = w.energy * (0.75 + 0.15 * a.internals.weapon) * (w.style === 'lifter' ? 0.45 : 1);
          const dir = norm(add(scale(v3(0, 1, 0), 0.9), scale(norm(v3(fwd.x, 0, fwd.z)), 0.42)));
          const pt = madd(madd(t.comWorld, norm(v3(fwd.x, 0, fwd.z)), -t.half.x * 0.6), v3(0, 1, 0), -0.04);
          const inv = t.invMassAt(pt, dir);
          const J = Math.sqrt((2 * E) / inv);
          t.impulse(scale(dir, J), pt);
          a.body.applyImpulse(scale(dir, -J * 0.35), true);
          applyDamage(ctx, t, pt, E * 0.05, undefined, 'bottom');
          a.damageDealt += E * 0.05;
          a.control += 2.5;
          ctx.emit({ type: 'hit', kind: 'flip', pos: pt, dir, energy: E * 0.05, impulse: J, attacker: a.index, target: t.index, face: 'bottom', material: t.panels.bottom.material });
        }
        ctx.emit({ type: 'actuate', bot: a.index, kind: w.style === 'lifter' ? 'lift' : 'flip', pos: zc });
      } else if (act.pos >= 1 && (a.inverted || a.onSide)) {
        act.struck = true;
        selfRight(ctx, a, w.energy * 0.6);
      } else if (act.pos >= 1) {
        act.struck = true;
        ctx.emit({ type: 'actuate', bot: a.index, kind: 'flip', pos: a.pos });
      }
    }
    if (act.timer > rise + 0.35) { act.phase = 'returning'; act.timer = 0; }
  } else if (act.phase === 'returning') {
    act.timer += dt;
    act.pos = Math.max(0, 1 - act.timer / 0.5);
    // a flywheel never blocks the trigger: its cooldown is the re-spin, paid as a weaker next shot
    if (act.pos <= 0) { act.phase = 'rest'; act.cooldown = w.actuator === 'flywheel' ? 0 : w.cooldown; }
  }
}

/** Flippers, lifters, hammers, axes, saw arms and crushers. */
export function actuatorStep(ctx: CombatContext, a: BotRuntime, dt: number) {
  const act = a.actuator;
  const w = a.design.weapon;
  if (!act || w.type === 'none' || w.type === 'spinner') return;
  const inp = a.dead || a.tappedOut ? { weapon: false } : a.input;
  const working = a.internals.weapon > 0 && a.internals.electronics > 0 && a.internals.battery > 0;
  const pressed = inp.weapon && !act.lastFire;
  act.lastFire = inp.weapon;
  act.cooldown = Math.max(0, act.cooldown - dt);
  const L = a.design.chassis.length, H = a.design.chassis.height;
  const up = a.up;

  if (w.type === 'flipper') {
    if (w.actuator === 'flywheel') {
      // the weapon motor re-spins the flywheel: full speed in `cooldown` seconds, slower as the motor is hurt
      if (working) act.charge = Math.min(1, (act.charge ?? 0) + (dt * a.internals.weapon) / w.cooldown);
      // energy is read when the plate lands, after the trigger has set this shot's share of the flywheel
      if (pressed || act.phase !== 'rest') runFlipper(ctx, a, act, { ...w, get energy() { return w.energy * (act.shotPower ?? 0); } }, pressed, working, dt);
      return;
    }
    runFlipper(ctx, a, act, w, pressed, working, dt);
    return;
  }

  if (w.type === 'hammer') {
    if (w.style === 'saw-arm') {
      if ((a.inverted || a.onSide) && pressed && working && act.cooldown <= 0) {
        act.cooldown = 2; selfRight(ctx, a, 1600);
      }
      // hold to drop the saw onto the opponent
      const target = inp.weapon && working ? 1 : 0;
      act.pos += clamp(target - act.pos, -dt / (w.swingTime * 0.8), dt / w.swingTime);
      act.sawAngle += ((w.sawRpm ?? 4000) * Math.PI * 2 / 60) * dt * (working ? 1 : 0);
      if (act.pos > 0.75) {
        const zc = a.toWorld(v3(L / 2 + w.armLength * 0.45, H / 2 + 0.05, 0));
        const targets = overlapBots(ctx, a, zc, v3(w.armLength * 0.4, 0.25, 0.14));
        act.timer += dt;
        for (const [t] of targets) {
          const power = 9000 * a.internals.weapon; // W into the target
          const pt = madd(t.comWorld, v3(0, 1, 0), t.half.y);
          applyDamage(ctx, t, pt, power * dt, undefined, faceAt(t, a.toWorld(v3(L / 2 + w.armLength * 0.5, H, 0))) === 'bottom' ? 'bottom' : 'top');
          a.damageDealt += power * dt;
          t.impulse(v3(0, -900 * dt, 0), pt);
          if (act.timer > 0.05) {
            act.timer = 0;
            ctx.emit({ type: 'hit', kind: 'saw', pos: a.toWorld(v3(L / 2 + w.armLength * 0.6, H / 2, 0)), dir: up, energy: power * 0.05, impulse: 0, attacker: a.index, target: t.index, face: 'top', material: t.panels.top.material });
          }
        }
      }
      return;
    }
    if (act.phase === 'rest' && pressed && working && act.cooldown <= 0) {
      act.phase = 'firing'; act.timer = 0; act.struck = false;
      ctx.emit({ type: 'actuate', bot: a.index, kind: 'hammer', pos: a.pos });
    }
    if (act.phase === 'firing') {
      act.timer += dt;
      const s = act.timer / w.swingTime;
      act.pos = Math.min(1, s * s);
      if (act.pos >= 1 && !act.struck) {
        act.struck = true;
        const reach = w.armLength;
        const zc = a.toWorld(v3(L / 2 + reach * 0.45, H / 2 + 0.1, 0));
        const targets = overlapBots(ctx, a, zc, v3(reach * 0.45, 0.32, 0.2));
        const E = w.energy * (0.4 + 0.6 * a.internals.weapon);
        const pImpact = Math.sqrt(2 * E * w.headMass);
        if (targets.length) {
          for (const [t, h] of targets) {
            const pt = madd(t.comWorld, v3(0, 1, 0), t.half.y * 0.9);
            const tFace = faceAt(t, pt);
            t.impulse(v3(0, -pImpact * 1.6, 0), pt);
            a.body.applyImpulseAtPoint(v3(0, pImpact * 0.8, 0), a.toWorld(v3(L / 2, 0, 0)), true);
            const deform = E * 0.85;
            applyDamage(ctx, t, pt, deform, h.tag.part === 'wheel' ? h.tag : undefined, tFace);
            a.damageDealt += deform;
            if (deform > 6000) a.bigHits++;
            ctx.emit({ type: 'hit', kind: 'hammer', pos: pt, dir: v3(0, -1, 0), energy: deform, impulse: pImpact, attacker: a.index, target: t.index, face: tFace, material: t.panels[tFace].material });
          }
        } else if (a.inverted || a.onSide) {
          selfRight(ctx, a, E * 0.7);
        } else {
          // hammer hits the floor: the robot hops
          a.body.applyImpulseAtPoint(v3(0, pImpact * 0.9, 0), a.toWorld(v3(L / 2, 0, 0)), true);
          ctx.emit({ type: 'hit', kind: 'wall', pos: zc, dir: v3(0, 1, 0), energy: E * 0.3, impulse: pImpact, attacker: a.index, target: -1, material: 'ar500' });
        }
      }
      if (act.timer > w.swingTime + 0.15) { act.phase = 'returning'; act.timer = 0; }
    } else if (act.phase === 'returning') {
      act.timer += dt;
      act.pos = Math.max(0, 1 - act.timer / (w.swingTime * 1.6));
      if (act.pos <= 0) { act.phase = 'rest'; act.cooldown = w.cooldown; }
    }
    return;
  }

  if (w.type === 'crusher') {
    const target = inp.weapon && working ? 1 : 0;
    act.pos += clamp(target - act.pos, -dt / (w.cycleTime * 0.6), dt / w.cycleTime);
    if (act.pos > 0.55 && inp.weapon) {
      const zc = a.toWorld(v3(L / 2 + w.reach * 0.5, H / 2, 0));
      const targets = overlapBots(ctx, a, zc, v3(w.reach * 0.5, 0.3, 0.18));
      act.timer += dt;
      for (const [t] of targets) {
        const power = w.force * 0.06 * a.internals.weapon; // N × closing speed
        const pt = madd(t.comWorld, v3(0, 1, 0), t.half.y);
        applyDamage(ctx, t, pt, power * dt, undefined, 'top');
        a.damageDealt += power * dt;
        a.control += dt;
        // grip: drag the target along with us
        const rel = sub(a.body.linvel() as V3, t.body.linvel() as V3);
        t.impulse(scale(rel, t.mass * 0.15), pt);
        if (act.timer > 0.12) {
          act.timer = 0;
          ctx.emit({ type: 'hit', kind: 'crush', pos: pt, dir: v3(0, -1, 0), energy: power * 0.12, impulse: 0, attacker: a.index, target: t.index, face: 'top', material: t.panels.top.material });
        }
      }
    }
  }
}

/** Use the weapon against the floor to get back on the wheels. */
export function selfRight(ctx: CombatContext, a: BotRuntime, energy: number) {
  // pop up and rotate half a turn during the flight, about whichever axis gets us back on the wheels
  const m = a.mass;
  const v = Math.min(Math.sqrt((2 * energy) / m), 3.0);
  const flight = (2 * v) / 9.81 + 0.08;
  const lv = a.body.linvel();
  a.body.setLinvel({ x: lv.x * 0.3, y: v, z: lv.z * 0.3 }, true);
  const upNow = a.up;
  // rotate up-vector toward world up: axis = upNow x worldUp (falls back to the long axis when exactly inverted)
  let axis = cross(upNow, v3(0, 1, 0));
  if (len(axis) < 0.2) axis = a.forward; // exactly inverted: roll over the narrow side so the wedge doesn't dig in
  axis = norm(axis);
  const angle = Math.acos(clamp(upNow.y, -1, 1));
  a.body.setAngvel(scale(axis, angle / flight), true);
  a.selfRightFlight = flight + 0.25;
  ctx.emit({ type: 'actuate', bot: a.index, kind: 'self-right', pos: a.pos });
}

/** Big contact forces (rams, wall slams, landings) do a little damage. */
export function contactDamage(ctx: CombatContext, b: BotRuntime, other: BotRuntime | null, forceMag: number, dt: number, at: V3, dir: V3) {
  const J = forceMag * dt;
  const mred = other ? 1 / (1 / b.mass + 1 / other.mass) : b.mass;
  const E = (J * J) / (2 * mred);
  if (E < 400) return;
  const dmg = (E - 400) * 0.35;
  applyDamage(ctx, b, at, dmg);
  if (other) other.damageDealt += dmg * 0.5;
  if (E > 1500) {
    ctx.emit({ type: 'hit', kind: other ? 'ram' : 'landing', pos: at, dir, energy: dmg, impulse: J, attacker: other ? other.index : -1, target: b.index, face: faceAt(b, at), material: b.panels[faceAt(b, at)].material });
  }
}

export { rotate };

/** Secondary actuators: lifting arms and sliding drum carriages. */
export function secondaryStep(ctx: CombatContext, a: BotRuntime, dt: number) {
  const sec = a.design.secondary;
  const st = a.secondaryAct;
  if (!sec || !st) return;
  const alt = !!a.input.alt && !a.dead && !(sec.type === 'slide' && (a.inverted || a.onSide));
  const pressed = alt && !st.lastFire;
  st.lastFire = alt;
  st.cooldown = Math.max(0, st.cooldown - dt);
  const working = a.internals.weapon > 0.15 && a.internals.electronics > 0 && a.internals.battery > 0;
  if (sec.type === 'lifter') {
    runFlipper(ctx, a, st, { style: 'lifter', actuator: 'electric', energy: sec.energy, plateLength: sec.plateLength, plateWidth: sec.plateWidth, cooldown: sec.cooldown }, pressed, working, dt);
    return;
  }
  // sliding drum: punch forward while held
  const target = alt && working ? 1 : 0;
  const before = a.slidePos;
  a.slidePos = clamp(a.slidePos + (target ? dt / sec.cycleTime : -dt / (sec.cycleTime * 2)), 0, 1);
  st.pos = a.slidePos;
  const sp = a.spinner;
  if (sp && a.weaponCollider && a.design.weapon.type === 'spinner') {
    sp.mountLocal.x = a.design.weapon.mountX + a.slidePos * sec.distance;
    a.weaponCollider.setTranslationWrtParent({ x: sp.mountLocal.x, y: sp.mountLocal.y, z: 0 });
    // the carriage's own momentum goes into whatever it punches
    if (a.slidePos > before && a.slidePos > 0.6) a.punchBoost = 1.6; else a.punchBoost = 1;
  }
}

/** Self-righting: powered arms (alt), passive poles, and weapon-torque roll-overs. */
export function selfRighterStep(ctx: CombatContext, a: BotRuntime) {
  const sr = a.design.chassis.selfRighter;
  if (!sr || a.dead || a.selfRightCooldown > 0 || !(a.inverted || a.onSide)) return;
  const ok = a.internals.electronics > 0 && a.internals.battery > 0;
  if (!ok) return;
  if (sr === 'arm' && a.input.alt && a.design.secondary?.type !== 'lifter') {
    a.selfRightCooldown = 2.2; selfRight(ctx, a, 1900);
  } else if (sr === 'pole' && a.invertedTime > 1.2) {
    a.selfRightCooldown = 3; selfRight(ctx, a, 1500);
  } else if (sr === 'torque' && a.spinner && a.spinner.on && a.invertedTime > 0.7) {
    a.selfRightCooldown = 2.5; selfRight(ctx, a, 1700);
  }
}
