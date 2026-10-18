// Robot drivers for solo play and AI-vs-AI. Each weapon class has its own
// game plan, the way real drivers fight: spinners spin up before engaging,
// wedges and flippers drive straight in, hammers wait for range, and
// everyone stays out of the screws and the Pulverizer.

import { BotInput } from './bot';
import type { Match } from './match';
import { HALF } from './arena';
import { clamp, rng } from './vec';

export type AILevel = 'rookie' | 'veteran' | 'champion';

const LEVELS: Record<AILevel, { delay: number; gain: number; noise: number; throttle: number; hazardSense: number }> = {
  rookie: { delay: 0.35, gain: 1.6, noise: 0.35, throttle: 0.75, hazardSense: 0.4 },
  veteran: { delay: 0.18, gain: 2.4, noise: 0.15, throttle: 0.92, hazardSense: 0.8 },
  champion: { delay: 0.08, gain: 3.2, noise: 0.05, throttle: 1, hazardSense: 1 },
};

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export class BotAI {
  private hist: { t: number; x: number; z: number; vx: number; vz: number }[] = [];
  private stuck = 0;
  private reverseT = 0;
  private reverseTurn = 1;
  private retreatT = 0;
  private circleDir: number;
  private rand: () => number;
  private lastWeapon = false;
  private spunOnce = false;
  private cfg;

  constructor(readonly index: number, readonly level: AILevel = 'veteran', seed = 7) {
    this.cfg = LEVELS[level];
    this.rand = rng(seed * 31 + index);
    this.circleDir = this.rand() < 0.5 ? -1 : 1;
  }

  think(m: Match, dt: number): BotInput {
    const me = m.bots[this.index];
    const op = m.bots[1 - this.index];
    const out: BotInput = { throttle: 0, turn: 0, weapon: false, alt: false };
    if (m.phase !== 'fight') return out;
    const t = m.time;
    const op0 = op.pos;
    const ov = op.body.linvel();
    this.hist.push({ t, x: op0.x, z: op0.z, vx: ov.x, vz: ov.z });
    while (this.hist.length > 2 && this.hist[1].t < t - this.cfg.delay) this.hist.shift();
    const seen = this.hist[0];

    const p = me.pos;
    const f = me.forward;
    const inv = me.inverted;
    // heading in the XZ plane (yaw); when inverted, auto-invert keeps "forward" meaning body forward
    const heading = Math.atan2(-f.z, f.x);
    const w = me.design.weapon;
    const sp = me.spinner;

    // --- recovery ---
    if ((inv && !me.stats.invertible) || me.onSide) {
      const now = me.invertedTime > 0.3;
      out.alt = now && Math.floor(t * 2) % 2 === 0; // pulse srimech / lifter
      out.weapon = w.type === 'flipper' || w.type === 'hammer' ? now && Math.floor(t * 2) % 2 === 1 : false;
      if (sp && me.design.chassis.selfRighter === 'torque') out.weapon = !sp.on; // spin up to roll over
      out.throttle = Math.sin(t * 6);
      return out;
    }

    // upright but balanced on the rim of a spinning shell: cut the weapon and settle
    if (sp && !me.canMove() && me.up.y > 0.7 && sp.on && me.speed < 0.3) {
      out.weapon = !this.lastWeapon;
      this.lastWeapon = out.weapon;
      return out;
    }

    // --- spinners: keep it spinning, back off to re-spin after big hits ---
    if (sp && w.type === 'spinner') {
      if (!sp.on && !this.lastWeapon) { out.weapon = true; }
      const maxW = (me.stats.weapon?.maxRpm ?? 1000) * Math.PI * 2 / 60;
      const frac = Math.abs(sp.omega) / maxW;
      if (frac > 0.8) this.spunOnce = true;
      if (this.spunOnce && frac < 0.35 && this.retreatT <= 0 && me.internals.weapon > 0.2) this.retreatT = 1.6;
    }
    this.lastWeapon = out.weapon;

    // aim at where the opponent will be
    const lead = clamp(Math.hypot(seen.x - p.x, seen.z - p.z) / 6, 0, 0.6);
    let tx = seen.x + seen.vx * lead + (this.rand() - 0.5) * this.cfg.noise;
    let tz = seen.z + seen.vz * lead + (this.rand() - 0.5) * this.cfg.noise;
    const dist = Math.hypot(tx - p.x, tz - p.z);

    // spinners need room to spin up first
    const spinning = !sp || Math.abs(sp.omega) > ((me.stats.weapon?.maxRpm ?? 1000) * Math.PI * 2 / 60) * 0.55;
    if (sp && !spinning && dist < 3) {
      // circle away while the weapon comes up to speed
      const away = Math.atan2(-(p.z - tz), p.x - tx) + this.circleDir * 0.9;
      tx = p.x + Math.cos(away) * 3;
      tz = p.z - Math.sin(away) * 3;
    }
    if (this.retreatT > 0) {
      this.retreatT -= dt;
      const away = Math.atan2(-(p.z - op0.z), p.x - op0.x) + this.circleDir * 0.6;
      tx = p.x + Math.cos(away) * 3;
      tz = p.z - Math.sin(away) * 3;
    }

    // hazard and wall avoidance (steering bias), stronger for better drivers
    const sense = this.cfg.hazardSense;
    const lay = m.layout;
    let ax = 0, az = 0;
    const repel = (hx: number, hz: number, r: number, k: number) => {
      const dx = p.x - hx, dz = p.z - hz;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-3) { ax += (dx / d) * k * (1 - d / r); az += (dz / d) * k * (1 - d / r); }
    };
    for (const s of lay.screws) repel(s.x, s.z, 1.8, 6 * sense);
    for (const pz of lay.pulverizers) if (pz.team !== this.index) repel(pz.x, pz.z, 2.2, 5 * sense);
    if (m.hazardsLive) for (const k of lay.killsaws) repel(k.x, k.z, 1.3, 3 * sense);
    if (lay.deck) repel(lay.deck.x, lay.deck.z, 3.2, 3 * sense);
    const wallD = HALF - 1.2;
    if (p.x > wallD) ax -= 4 * sense; if (p.x < -wallD) ax += 4 * sense;
    if (p.z > wallD) az -= 4 * sense; if (p.z < -wallD) az += 4 * sense;
    // push the opponent toward hazards: aim slightly so our push carries them into the nearest screw
    tx += ax * 0.8; tz += az * 0.8;

    const want = Math.atan2(-(tz - p.z), tx - p.x);
    let err = wrap(want - heading);
    // horizontal spinners like to hit with the side of the bar: offset the approach a little
    if (w.type === 'spinner' && (w.style === 'horizontal-bar' || w.style === 'horizontal-disk' || w.style === 'undercutter') && dist < 2.5) {
      err = wrap(err + 0.25 * this.circleDir);
    }
    if (w.type === 'spinner' && w.style === 'shell') err = wrap(err + 0.5 * this.circleDir);

    let throttle = Math.cos(err) * this.cfg.throttle;
    if (Math.abs(err) > 1.4) throttle = -0.25; // pivot
    let turn = clamp(-err * this.cfg.gain, -1, 1);
    const angY = me.body.angvel().y;
    turn = clamp(turn - angY * 0.08, -1, 1);

    // --- unstick ---
    const speed = me.speed;
    if (Math.abs(throttle) > 0.5 && speed < 0.25 && dist > 1.4) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    if (this.stuck > 1.2) { this.reverseT = 0.8; this.stuck = 0; this.reverseTurn = this.rand() < 0.5 ? -1 : 1; }
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      throttle = -0.9; turn = 0.6 * this.reverseTurn;
    }

    out.throttle = clamp(throttle, -1, 1);
    out.turn = turn;

    // --- weapon timing ---
    const realDist = Math.hypot(op0.x - p.x, op0.z - p.z);
    const facing = Math.abs(wrap(Math.atan2(-(op0.z - p.z), op0.x - p.x) - heading)) < 0.45;
    const reach = me.half.x + op.half.x;
    if (w.type === 'flipper') out.weapon = facing && realDist < reach + w.plateLength * 0.55;
    if (w.type === 'hammer') {
      if (w.style === 'saw-arm') out.weapon = facing && realDist < reach + w.armLength * 0.75;
      else out.weapon = facing && realDist < reach + w.armLength * 0.6;
    }
    if (w.type === 'crusher') out.weapon = facing && realDist < reach + w.reach * 0.7;
    if (me.design.secondary) out.alt = facing && realDist < reach + (me.design.secondary.type === 'slide' ? 0.35 : 0.4);
    if (me.design.flame) out.flame = facing && realDist < 2.2 && Math.floor(t * 3) % 3 === 0;
    return out;
  }
}
