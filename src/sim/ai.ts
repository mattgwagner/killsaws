// Robot drivers for solo play and AI-vs-AI. Each robot runs its real team's
// game plan (src/sim/drivers.ts): how it closes, when it commits and backs
// out, weapon discipline, hazard play, the clock and the cards, and what it
// does once the weapon is gone. Difficulty is an overlay on the plan:
// reaction delay, aim noise, hazard sense and how well the plan is executed.

import { BotInput, BotRuntime } from './bot';
import type { Match } from './match';
import { HALF } from './arena';
import { clamp, rng } from './vec';
import { Approach, ClockMode, DriverProfile, clockMode, driverFor } from './drivers';

export type AILevel = 'rookie' | 'veteran' | 'champion';

const LEVELS: Record<AILevel, { delay: number; gain: number; noise: number; throttle: number; hazardSense: number; execution: number }> = {
  rookie: { delay: 0.35, gain: 1.6, noise: 0.35, throttle: 0.75, hazardSense: 0.4, execution: 0.4 },
  veteran: { delay: 0.18, gain: 2.4, noise: 0.15, throttle: 0.92, hazardSense: 0.8, execution: 0.75 },
  champion: { delay: 0.08, gain: 3.2, noise: 0.05, throttle: 1, hazardSense: 1, execution: 1 },
};

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
/** yaw of the direction (dx, dz) in the XZ plane, same convention as heading */
const yaw = (dx: number, dz: number) => Math.atan2(-dz, dx);

/** Down and not getting up by itself: let the count run. (Lifted robots are not down.) */
function down(b: BotRuntime) {
  if (b.dead || b.tappedOut) return true;
  if (b.internals.electronics <= 0 || b.internals.battery <= 0) return true;
  if (b.internals.driveL <= 0 && b.internals.driveR <= 0) return true;
  return b.onSide || (b.inverted && !b.stats.invertible);
}

function weaponWorks(b: BotRuntime) {
  const w = b.design.weapon;
  if (w.type === 'none' || b.internals.weapon <= 0.05) return false;
  if (b.spinner) return b.spinner.toothDamage < 0.9;
  if (b.actuator) return b.actuator.shots > 0;
  return true;
}

export class BotAI {
  /** the clock and the cards, re-read every tick */
  mode: ClockMode = 'plan';
  /** the approach actually being driven this tick (plan, clock and weapon state applied) */
  approach: Approach | null = null;
  private hist: { t: number; x: number; z: number; vx: number; vz: number }[] = [];
  private stuck = 0;
  private reverseT = 0;
  private reverseTurn = 1;
  private retreatT = 0;
  private circleDir: number;
  private rand: () => number;
  private lastWeapon = false;
  private spunOnce = false;
  private cornerDone = false;
  /** circle / stand-off bookkeeping */
  private orbitT = 0;
  private commitT = 0;
  private waitT = 0;
  /** no-progress detector: where we were when we last made real ground */
  private anchor = { x: 0, z: 0, t: -1, dmg: 0 };
  private escapeT = 0;
  private spinWait = 0;
  private downT = 0;
  private lastStall = -99;
  private escapeDir = 1;
  private touchT = 0;
  private touching = false;
  private cfg;

  /** @param profile override the team's game plan (default: the profile for the robot in this square) */
  constructor(readonly index: number, readonly level: AILevel = 'veteran', seed = 7, private plan?: DriverProfile) {
    this.cfg = LEVELS[level];
    this.rand = rng(seed * 31 + index);
    this.circleDir = this.rand() < 0.5 ? -1 : 1;
  }

  /** the team's game plan; resolved from the robot on the first tick */
  get profile() { return this.plan; }

  think(m: Match, dt: number): BotInput {
    const me = m.bots[this.index];
    const op = m.bots[1 - this.index];
    const prof = (this.plan ??= driverFor(me.design));
    const out: BotInput = { throttle: 0, turn: 0, weapon: false, alt: false };
    if (m.phase !== 'fight') return out;
    const cfg = this.cfg;
    const t = m.time;
    const op0 = op.pos;
    const ov = op.body.linvel();
    this.hist.push({ t, x: op0.x, z: op0.z, vx: ov.x, vz: ov.z });
    while (this.hist.length > 2 && this.hist[1].t < t - cfg.delay) this.hist.shift();
    const seen = this.hist[0];

    const p = me.pos;
    const f = me.forward;
    const inv = me.inverted;
    // heading in the XZ plane (yaw); when inverted, auto-invert keeps "forward" meaning body forward
    const heading = Math.atan2(-f.z, f.x);
    const w = me.design.weapon;
    const sp = me.spinner;

    // --- recovery --- (an "invertible" robot whose wheels don't reach the floor upside down needs it too)
    const beached = inv && me.invertedTime > 1 && !me.wheels.some((wh) => wh.contact);
    if ((inv && !me.stats.invertible) || me.onSide || beached) {
      const now = me.invertedTime > 0.3;
      out.alt = now && Math.floor(t * 2) % 2 === 0; // pulse srimech / lifter
      out.weapon = w.type === 'flipper' || w.type === 'hammer' ? now && Math.floor(t * 2) % 2 === 1 : false;
      if (sp && me.design.chassis.selfRighter === 'torque') out.weapon = !sp.on; // spin up to roll over
      // no srimech: cycle the rotor so the spin-up / spin-down reaction rocks the chassis over
      else if (sp && beached) out.weapon = !this.lastWeapon && sp.on !== (Math.floor(t / 1.5) % 2 === 0);
      this.lastWeapon = out.weapon;
      out.throttle = Math.sin(t * 6);
      // a self-right isn't a stall: don't resume a half-played rock or count this time against the anchor
      this.escapeT = 0; this.anchor.t = -1;
      return out;
    }

    // upright but balanced on the rim of a spinning shell: cut the weapon and settle
    if (sp && !me.canMove() && me.up.y > 0.7 && sp.on && me.speed < 0.3) {
      out.weapon = !this.lastWeapon;
      this.lastWeapon = out.weapon;
      return out;
    }

    // --- the clock and the cards ---
    const remaining = m.opts.matchSeconds - m.fightTime;
    const cards = m.judgesEstimate();
    this.mode = clockMode(remaining, cards[this.index], cards[1 - this.index]);
    const armed = weaponWorks(me);
    let approach: Approach = prof.approach;
    if (!armed) approach = 'wedge-in'; // pusher / wedge-and-pin
    else if (this.mode === 'aggress' && (approach === 'stand-off' || approach === 'circle')) approach = 'square-up';
    else if (this.mode === 'control' && prof.standLate) approach = 'stand-off';
    this.approach = approach;
    const pressure = !armed || this.mode === 'aggress' ? 1 : prof.pressure;
    // weapon gone: a pusher shoves them onto the hazards, a wedge pins them on the wall
    const hazardPlay = (armed || prof.fallback !== 'pusher' ? prof.hazardPlay : Math.max(prof.hazardPlay, 0.7)) * cfg.execution;
    const wallPlay = prof.wallPlay || !armed && prof.fallback === 'wedge-pin';

    const realDist = Math.hypot(op0.x - p.x, op0.z - p.z);
    const reach = me.half.x + op.half.x;
    const toOp = yaw(op0.x - p.x, op0.z - p.z);
    const facing = Math.abs(wrap(toOp - heading)) < 0.45;
    const close = realDist < reach + 0.35;

    // --- spinners: spin discipline ---
    let spunUp = true;
    if (sp && w.type === 'spinner') {
      const maxW = (me.stats.weapon?.maxRpm ?? 1000) * Math.PI / 30;
      const frac = Math.abs(sp.omega) / maxW;
      // a dying pack: only spin when there's something to hit
      const conserve = me.soc < 0.15 && realDist > 3.5;
      const wantOn = armed && !conserve;
      if (sp.on !== wantOn && !this.lastWeapon) out.weapon = true;
      const need = prof.spinUp * (0.8 + 0.2 * cfg.execution);
      if (frac > need) this.spunOnce = true;
      // a slow or sagging rotor doesn't get to keep everyone waiting
      this.spinWait = frac >= need || !sp.on ? 0 : this.spinWait + dt;
      spunUp = !armed || conserve || frac >= need || this.mode === 'aggress' || this.spinWait > (me.stats.weapon?.spinUpS ?? 4) + 3;
      // back off to re-spin after a hit took the energy out of the rotor
      if (prof.respin > 0 && this.mode !== 'aggress' && armed && this.spunOnce && frac < prof.respin && this.retreatT <= 0) {
        this.retreatT = prof.respinTime;
        this.spunOnce = false;
      }
    }
    this.lastWeapon = out.weapon;

    // aim at where the opponent will be
    const lead = clamp(Math.hypot(seen.x - p.x, seen.z - p.z) / 6, 0, 0.6);
    const ax0 = seen.x + seen.vx * lead + (this.rand() - 0.5) * cfg.noise;
    const az0 = seen.z + seen.vz * lead + (this.rand() - 0.5) * cfg.noise;
    let tx = ax0, tz = az0;
    const dist = Math.hypot(tx - p.x, tz - p.z);
    let hold = false; // stand still and face the opponent
    let pushing = false; // driving the opponent somewhere: hazard repulsion is relaxed
    const goTo = (x: number, z: number) => { tx = x; tz = z; };
    const awayFrom = (x: number, z: number, bend: number, r = 3) => {
      const a = yaw(p.x - x, p.z - z) + this.circleDir * bend;
      goTo(p.x + Math.cos(a) * r, p.z - Math.sin(a) * r);
    };

    const lay = m.layout;
    const hazardNear = () => {
      // the live hazard nearest the opponent that a push could put them on
      let best: { x: number; z: number; d: number } | null = null;
      const consider = (x: number, z: number) => {
        const d = Math.hypot(x - op0.x, z - op0.z);
        if (d < 4.5 && (!best || d < best.d)) best = { x, z, d };
      };
      for (const s of lay.screws) consider(s.x, s.z);
      if (m.hazardsLive) for (const k of lay.killsaws) consider(k.x, k.z);
      if (wallPlay && !best) {
        // no hazard handy: the nearest wall to pin or flip them against
        const wx = Math.sign(op0.x) * HALF, wz = Math.sign(op0.z) * HALF;
        if (HALF - Math.abs(op0.x) < HALF - Math.abs(op0.z)) consider(wx, op0.z); else consider(op0.x, wz);
      }
      return best as { x: number; z: number; d: number } | null;
    };

    // caught in the beak / under the saw: back straight out rather than shoving deeper in
    const opW0 = op.design.weapon;
    if ((opW0.type === 'crusher' || opW0.type === 'hammer' && opW0.style === 'saw-arm') && (op.actuator?.pos ?? 0) > 0.5 && close
      && Math.abs(wrap(yaw(p.x - op0.x, p.z - op0.z) - Math.atan2(-op.forward.z, op.forward.x))) < 0.7 && this.retreatT <= 0) {
      this.retreatT = 0.9 * cfg.execution;
    }
    if (!down(op) || m.ko?.bot === op.index) this.downT = 0; // a count that won't start (beached on the rail) means finish them
    if (this.retreatT > 0) {
      this.retreatT -= dt;
      awayFrom(op0.x, op0.z, 0.6);
    } else if (down(op) && (this.downT += dt) < 3 || m.ko?.bot === op.index) {
      // they're down: back off and let the count run (contact stops it). A flipper that follows up hovers
      // just inside plate range of a robot that can right itself, and flips it the moment it lands
      const plate = w.type === 'flipper' ? w.plateLength * 0.4 : 0.6;
      const keep = prof.follow && op.design.chassis.selfRighter ? reach + plate : reach + 1.2;
      if (realDist < keep) awayFrom(op0.x, op0.z, 0.3, 2); else hold = true;
    } else if (prof.cornerSpinUp && !this.cornerDone && armed) {
      // spin up in the corner on our side, away from the opponent, then go
      if (spunUp || realDist < reach + 1.4) this.cornerDone = true;
      const cx = Math.sign(p.x || 1) * (HALF - 2.2), cz = (Math.sign(-op0.z) || 1) * (HALF - 2.4);
      goTo(cx, cz);
      if (Math.hypot(cx - p.x, cz - p.z) < 0.8) hold = true;
    } else if (!spunUp && sp) {
      // let the weapon come up to speed: face them from range, kite once they close
      if (realDist > 4.5) hold = true; else awayFrom(tx, tz, 0.9);
    } else if (close && facing && hazardPlay > 0) {
      // in contact, weapon side on: carry / push / drag them onto a hazard (or into the wall)
      const h = hazardNear();
      if (h) {
        const k = clamp(hazardPlay, 0, 1);
        goTo(tx + (h.x - tx) * k, tz + (h.z - tz) * k);
        pushing = true;
      }
    } else {
      // line up a push from the far side when they're near a hazard
      const h = hazardPlay > 0.6 ? hazardNear() : null;
      if (h && realDist > reach + 0.8 && realDist < 4 && h.d < 2.5) {
        const ux = (op0.x - h.x) / Math.max(h.d, 1e-3), uz = (op0.z - h.z) / Math.max(h.d, 1e-3);
        const behindErr = Math.abs(wrap(yaw(h.x - op0.x, h.z - op0.z) - toOp));
        if (behindErr > 0.9) goTo(op0.x + ux * (reach + 0.5), op0.z + uz * (reach + 0.5));
      }
      switch (approach) {
        case 'angle-off': {
          // offset the line so the weapon meets a side or corner, straightening out at contact
          // wide on the way in, and still most of a half-width at contact so the weapon meets a corner
          const lat = Math.sin(prof.angle) * (clamp(dist - reach, 0, 2) + op.half.z * 1.6) * this.circleDir / Math.max(dist, 1e-3);
          const dx = tx - p.x, dz = tz - p.z;
          tx -= dz * lat;
          tz += dx * lat;
          break;
        }
        case 'circle': {
          // orbit at range; commit for one hit when spun up and they aren't facing us (or after a while)
          const opFacing = Math.abs(wrap(yaw(p.x - op0.x, p.z - op0.z) - Math.atan2(-op.forward.z, op.forward.x)));
          if (this.commitT > 0) { this.commitT -= dt; break; }
          if (dist > prof.engageRange + 0.8) { this.orbitT = 0; break; }
          this.orbitT += dt;
          if (spunUp && (opFacing > 1.2 || this.orbitT > 3)) { this.commitT = 1.6; this.orbitT = 0; break; }
          const a = yaw(p.x - tx, p.z - tz) + this.circleDir * 0.9;
          const r = prof.engageRange;
          goTo(tx + Math.cos(a) * r, tz - Math.sin(a) * r);
          break;
        }
        case 'stand-off': {
          // let them come; hold facing them, don't wait forever
          if (dist < prof.engageRange || this.waitT > 6) { if (close) this.waitT = 0; break; }
          this.waitT += dt;
          hold = true;
          break;
        }
        default:
          // square-up / wedge-in: straight at them
          break;
      }
      // can't afford to be flipped: never present the front or side to a flipper's plate;
      // and nobody wants to drive into a crusher's beak or under a saw arm
      const opW = op.design.weapon;
      const grabber = opW.type === 'crusher' || opW.type === 'hammer' && opW.style === 'saw-arm';
      if ((prof.flipperShy && opW.type === 'flipper' || grabber) && weaponWorks(op) && realDist < 3.2 && this.commitT <= 0) {
        const opYaw = Math.atan2(-op.forward.z, op.forward.x);
        if (Math.abs(wrap(yaw(p.x - op0.x, p.z - op0.z) - opYaw)) < 0.8) {
          // swing round to their side
          const a = opYaw + this.circleDir * 1.8;
          goTo(op0.x + Math.cos(a) * (reach + 0.9), op0.z - Math.sin(a) * (reach + 0.9));
        }
      }
    }

    // never aim at a point beyond the rail (retreats and kites pick a spot 3 m away, which can be in the wall)
    // unless the point is to drive someone into it
    if (!pushing) { const lim = HALF - 1.6; tx = clamp(tx, -lim, lim); tz = clamp(tz, -lim, lim); }
    // on the Upper Deck: its own 10-count runs, so get off it toward the arena floor
    const dk = lay.deck;
    if (dk && Math.abs(p.x - dk.x) < dk.w / 2 && Math.abs(p.z - dk.z) < dk.d / 2 + 0.2) {
      hold = false; tx = clamp(p.x, dk.x - dk.w / 2 + 0.4, dk.x + dk.w / 2 - 0.4); tz = dk.z + Math.sign(-dk.z || 1) * (dk.d / 2 + 2);
    }

    // hazard and wall avoidance (steering bias), stronger for better drivers
    const sense = cfg.hazardSense * (pushing ? 0.6 : 1);
    let ax = 0, az = 0;
    const repel = (hx: number, hz: number, r: number, k: number) => {
      const dx = p.x - hx, dz = p.z - hz;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-3) { ax += (dx / d) * k * (1 - d / r); az += (dz / d) * k * (1 - d / r); }
    };
    for (const s of lay.screws) repel(s.x, s.z, 1.8, 6 * sense);
    // both Pulverizers: an AI team's hammer fires on anything in reach, and the strike catches its owner too
    for (const pz of lay.pulverizers) repel(pz.x, pz.z, 2.2, 5 * sense);
    if (m.hazardsLive) for (const k of lay.killsaws) repel(k.x, k.z, 1.3, 3 * sense);
    if (dk) {
      // the Upper Deck is a long platform: keep off it from the nearest point of its edge
      repel(clamp(p.x, dk.x - dk.w / 2, dk.x + dk.w / 2), clamp(p.z, dk.z - dk.d / 2, dk.z + dk.d / 2), 1.6, 5 * sense);
    }
    const wallD = HALF - 1.2;
    const wallK = pushing ? 0 : 4 * sense;
    if (p.x > wallD) ax -= wallK; if (p.x < -wallD) ax += wallK;
    if (p.z > wallD) az -= wallK; if (p.z < -wallD) az += wallK;
    tx += ax * 0.8; tz += az * 0.8;

    const want = yaw(tx - p.x, tz - p.z);
    let err = wrap((hold ? toOp : want) - heading);
    // horizontal spinners like to hit with the side of the bar: offset the approach a little
    if (w.type === 'spinner' && (w.style === 'horizontal-bar' || w.style === 'horizontal-disk' || w.style === 'undercutter') && dist < 2.5 && approach !== 'angle-off') {
      err = wrap(err + 0.25 * this.circleDir);
    }
    if (w.type === 'spinner' && w.style === 'shell') err = wrap(err + 0.5 * this.circleDir);

    let throttle = hold ? 0 : Math.cos(err) * cfg.throttle;
    if (!hold && realDist < reach + 0.8 && Math.abs(err) < 0.6) throttle = Math.max(throttle, pressure * cfg.throttle);
    if (!hold && Math.abs(err) > 1.4) throttle = -0.25; // pivot
    let turn = clamp(-err * cfg.gain, -1, 1);
    const angY = me.body.angvel().y;
    turn = clamp(turn - angY * 0.08, -1, 1);

    // --- unstick: shoving nothing, or parked against a wall ---
    const speed = me.speed;
    const nearWall = Math.max(Math.abs(p.x), Math.abs(p.z)) > HALF - me.half.x - 0.5;
    const shoving = Math.abs(throttle) > 0.5 && speed < 0.25 && dist > 1.4;
    if (shoving || nearWall && speed < 0.3 && realDist > reach + 0.6) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    if (this.stuck > (shoving ? 1.2 : 2.5)) {
      this.reverseT = 0.8; this.stuck = 0; this.reverseTurn = this.rand() < 0.5 ? -1 : 1;
      this.waitT = 99; // a stand-off at the wall is over
    }
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      throttle = -0.9; turn = 0.6 * this.reverseTurn;
    }
    // no ground made and no damage done in 3 s: a shoving stalemate means back out and reset;
    // alone, it's beached on the rail or wedged in a corner, so rock out.
    if ((this.touchT -= dt) <= 0) { this.touchT = 0.05; this.touching = m.touching(me, op); }
    const moved = Math.hypot(p.x - this.anchor.x, p.z - this.anchor.z) > 0.4;
    if (this.anchor.t < 0 || moved || hold || me.damageDealt - this.anchor.dmg > 1500 || this.retreatT > 0) {
      this.anchor = { x: p.x, z: p.z, t, dmg: me.damageDealt };
    } else if (t - this.anchor.t > 3 && this.escapeT <= 0) {
      // a retreat that also went nowhere (jammed, pivoting in place) gets the rock instead
      if (this.touching && t - this.lastStall > 6) this.retreatT = 1.2;
      else { this.escapeT = 1.6; this.escapeDir = -this.escapeDir; }
      this.anchor.t = t;
      this.lastStall = t;
    }
    if (this.escapeT > 0) {
      this.escapeT -= dt;
      const rock = this.escapeT > 0.8 ? -1 : 1;
      throttle = rock; turn = this.escapeDir * (rock < 0 ? 0.5 : -0.8);
    }

    out.throttle = clamp(throttle, -1, 1);
    out.turn = turn;

    // --- weapon discipline ---
    const opUpright = !(op.inverted && !op.stats.invertible) && !op.onSide;
    if (w.type === 'flipper') {
      // don't flip a beached robot back onto its wheels; save limited gas for a robot on the plate
      const plate = Number.isFinite(w.shots) ? 0.45 : 0.55;
      out.weapon = armed && opUpright && facing && realDist < reach + w.plateLength * plate;
    }
    if (w.type === 'hammer') {
      // over the top deck only
      if (w.style === 'saw-arm') out.weapon = facing && realDist < reach + w.armLength * 0.75;
      else out.weapon = facing && Math.abs(wrap(toOp - heading)) < 0.35 && realDist < reach + w.armLength * 0.6;
    }
    // bite and hold for as long as they're in the beak
    if (w.type === 'crusher') out.weapon = facing && realDist < reach + w.reach * 0.7;
    if (me.design.secondary) {
      const r = reach + (me.design.secondary.type === 'slide' ? 0.35 : 0.4);
      out.alt = facing && realDist < (prof.secondaryOnLift ? reach + 0.25 : r);
    }
    if (me.design.flame) out.flame = facing && close && Math.floor(t * 3) % 3 === 0;
    return out;
  }
}
