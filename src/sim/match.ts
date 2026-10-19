// A match: the arena, two robots, hazards, the clock, the KO count and the
// judges. Runs at a fixed 240 Hz; the renderer and the network layer only
// ever read `view()` and the event stream.

import type RAPIERNS from '@dimforge/rapier3d-compat';
import { RAPIER, COLLIDE, G, initPhysics } from './physics';
import { ARENA_SIZE, HALF, LEXAN_HEIGHT, RAIL_DEPTH, RAIL_HEIGHT, WALL_HEIGHT, ArenaLayout, defaultLayout } from './arena';
import { BotInput, BotRuntime, FACES, Face, Internals, TagMap } from './bot';
import { BotDesign } from './design';
import {
  CombatContext, DebrisSpawn, SimEvent, actuatorStep, applyDamage, contactDamage, secondaryStep, selfRighterStep, spinnerStep,
} from './combat';
import { MATERIALS, radToRpm } from './parts';
import { Q4, V3, add, clamp, dot, len, norm, rng, scale, sub, v3 } from './vec';
import { JUDGING } from './rules';

export const DT = 1 / 240;
export const MATCH_SECONDS = 180;
export const COUNTDOWN_SECONDS = 3;
export const KO_COUNT_SECONDS = 10;

export type Phase = 'countdown' | 'fight' | 'over';
export type WinMethod = 'KO' | 'Judges';

export interface JudgeCard { damage: [number, number]; aggression: [number, number]; control: [number, number] }
export interface MatchResult {
  winner: 0 | 1;
  method: WinMethod;
  time: number;
  cards?: JudgeCard[];
  totals?: [number, number];
  koReason?: string;
  split?: boolean;
}

export interface MatchOptions {
  seed?: number;
  hazards?: boolean;
  layout?: ArenaLayout;
  matchSeconds?: number;
  /** 'broadcast' = the 10-count you see on TV; 'rulebook' = 2021 rules, 20 with the last 10 called aloud */
  koCount?: 'broadcast' | 'rulebook';
  /** which bots are human: their Pulverizer only fires when they press the button */
  humans?: [boolean, boolean];
}

export interface BotView {
  pos: V3; rot: Q4;
  wheels: { angle: number; attached: boolean; contact: boolean }[];
  weaponAngle: number;
  actuator: number;
  saw: number;
  panels: Record<Face, number>;
  internals: Internals;
  onFire: boolean;
  volts: number;
  amps: number;
  rpm: number;
  energyKJ: number;
  weaponOn: boolean;
  inverted: boolean;
  canMove: boolean;
  shots: number;
  speedMph: number;
  soc: number;
}
export interface DebrisView { id: number; pos: V3; rot: Q4 }
export interface HazardView {
  saws: { id: string; rise: number; angle: number }[];
  screws: { id: string; angle: number }[];
  pulverizers: { id: string; swing: number }[];
  paddles: { id: string; kick: number }[];
  ramrods: { id: string; rise: number }[];
}
export interface MatchView {
  time: number;
  phase: Phase;
  clock: number;
  countdown: number;
  ko: { bot: number; count: number; silent: boolean; reason: string } | null;
  hazardsLive: boolean;
  pin: { bot: number; count: number } | null;
  deckCount: { bot: number; count: number } | null;
  bots: BotView[];
  debris: DebrisView[];
  hazards: HazardView;
  result: MatchResult | null;
}

interface Debris { id: number; body: RAPIERNS.RigidBody; spec: DebrisSpawn; born: number }

export class Match {
  readonly world: RAPIERNS.World;
  readonly tags: TagMap = new Map();
  readonly bots: BotRuntime[];
  readonly designs: BotDesign[];
  readonly layout: ArenaLayout;
  readonly opts: Required<Omit<MatchOptions, 'layout'>>;
  hazardsLive = false;
  readonly debris: Debris[] = [];
  private nextDebrisId = 1;
  private events: SimEvent[] = [];
  private eq: RAPIERNS.EventQueue;
  private rand: () => number;
  time = 0;
  phase: Phase = 'countdown';
  fightTime = 0;
  ko: { bot: number; t: number; reason: string } | null = null;
  private deck: { bot: number; t: number }[] = [];
  private deckCountdown: { bot: number; t: number } | null = null;
  /** restraint limit: a robot holding a helpless opponent gets a 10 count, then the refs separate them */
  pin: { attacker: number; t: number } | null = null;
  result: MatchResult | null = null;
  private saws: { id: string; rise: number; angle: number; cooldown: number; hold: number; hit: number[] }[];
  private screws: { id: string; body: RAPIERNS.RigidBody; angle: number; axis: 'x' | 'z'; dir: number; deck: boolean }[] = [];
  private pulvs: { id: string; swing: number; phase: 'idle' | 'down' | 'up'; t: number; cooldown: number; struck: boolean }[];
  private paddles: { id: string; kick: number; cooldown: number }[];
  private ramrods: { id: string; rise: number; cooldown: number }[];
  private wopr = { t: 0, next: 0 };
  /** last bot to touch each bot, for crediting hazard damage */
  private lastTouch: (number | null)[] = [null, null];
  private lastTouchT = [0, 0];
  private immobile = [0, 0];

  static async create(designs: [BotDesign, BotDesign], opts: MatchOptions = {}) {
    await initPhysics();
    return new Match(designs, opts);
  }

  private constructor(designs: [BotDesign, BotDesign], opts: MatchOptions) {
    this.opts = {
      seed: opts.seed ?? 1, hazards: opts.hazards ?? true, matchSeconds: opts.matchSeconds ?? MATCH_SECONDS,
      koCount: opts.koCount ?? 'broadcast', humans: opts.humans ?? [true, true],
    };
    this.layout = opts.layout ?? defaultLayout();
    this.rand = rng(this.opts.seed);
    this.designs = designs;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = DT;
    this.world.integrationParameters.numSolverIterations = 6;
    this.eq = new RAPIER.EventQueue(true);
    this.buildArena();
    this.bots = designs.map((d, i) => new BotRuntime(this.world, d, i, this.tags, this.layout.starts[i]));
    this.saws = this.layout.killsaws.map((s) => ({ id: s.id, rise: 0, angle: 0, cooldown: 0, hold: 0, hit: [0, 0] }));
    this.pulvs = this.layout.pulverizers.map((p) => ({ id: p.id, swing: 0, phase: 'idle', t: 0, cooldown: 1, struck: false }));
    this.paddles = this.layout.paddles.map((p) => ({ id: p.id, kick: 0, cooldown: 0 }));
    this.ramrods = this.layout.ramrods.map((r) => ({ id: r.id, rise: 0, cooldown: 2 + this.rand() * 4 }));
  }

  private buildArena() {
    const w = this.world;
    const floor = w.createCollider(
      RAPIER.ColliderDesc.cuboid(HALF + 1, 0.25, HALF + 1).setTranslation(0, -0.25, 0).setFriction(0.45).setCollisionGroups(COLLIDE.floor),
    );
    this.tags.set(floor.handle, { bot: null, part: 'floor' });
    const t = 0.3;
    const h = LEXAN_HEIGHT;
    const walls: [number, number, number, number][] = [
      [0, -HALF - t, HALF + t, t], [0, HALF + t, HALF + t, t],
      [-HALF - t, 0, t, HALF + t], [HALF + t, 0, t, HALF + t],
    ];
    for (const [x, z, hx, hz] of walls) {
      const c = w.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, h / 2, hz).setTranslation(x, h / 2, z).setFriction(0.3).setRestitution(0.25).setCollisionGroups(COLLIDE.wall),
      );
      this.tags.set(c.handle, { bot: null, part: 'wall' });
    }
    const roof = w.createCollider(RAPIER.ColliderDesc.cuboid(HALF, 0.1, HALF).setTranslation(0, h + 0.1, 0).setCollisionGroups(COLLIDE.wall));
    this.tags.set(roof.handle, { bot: null, part: 'wall' });
    void WALL_HEIGHT;
    // yellow spiked perimeter rail: robots pushed onto it get high-centred
    const rh = RAIL_HEIGHT / 2, rd = RAIL_DEPTH / 2;
    const rails: [number, number, number, number][] = [
      [0, -HALF + rd, HALF, rd], [0, HALF - rd, HALF, rd], [-HALF + rd, 0, rd, HALF], [HALF - rd, 0, rd, HALF],
    ];
    for (const [x, z, hx, hz] of rails) {
      const c = w.createCollider(RAPIER.ColliderDesc.cuboid(hx, rh, hz).setTranslation(x, rh, z).setFriction(0.5).setRestitution(0.2).setCollisionGroups(COLLIDE.floor | (G.WALL << 16) | G.WHEEL | G.WEAPON));
      this.tags.set(c.handle, { bot: null, part: 'wall', hazardId: 'rail' });
    }
    const deck = this.layout.deck;
    if (deck) {
      const c = w.createCollider(RAPIER.ColliderDesc.cuboid(deck.w / 2, deck.h / 2, deck.d / 2).setTranslation(deck.x, deck.h / 2, deck.z).setFriction(0.45).setCollisionGroups(COLLIDE.floor | (G.WALL << 16) | G.WHEEL));
      this.tags.set(c.handle, { bot: null, part: 'floor', hazardId: 'deck' });
    }

    for (const s of this.layout.screws) {
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicVelocityBased().setTranslation(s.x, s.radius * (s.deck ? 0.95 : 0.55), s.z));
      const q = s.axis === 'z' ? { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 } : { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
      body.setRotation(q, true);
      const c = w.createCollider(
        RAPIER.ColliderDesc.cylinder(s.length / 2, s.radius).setFriction(1.4).setRestitution(0.1).setCollisionGroups(COLLIDE.hazard),
        body,
      );
      this.tags.set(c.handle, { bot: null, part: 'hazard', hazardId: s.id });
      this.screws.push({ id: s.id, body, angle: 0, axis: s.axis, dir: s.dir, deck: !!s.deck });
    }
  }

  setInput(i: number, inp: BotInput) {
    this.bots[i].input = inp;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  private ctx(): CombatContext {
    return {
      tags: this.tags, world: this.world, bots: this.bots, time: this.time, rand: this.rand,
      emit: (e) => this.events.push(e),
      spawn: (d) => this.spawnDebris(d),
    };
  }

  spawnDebris(d: DebrisSpawn) {
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(d.pos.x, Math.max(0.1, d.pos.y), d.pos.z)
      .setLinvel(d.vel.x, d.vel.y, d.vel.z).setAngvel(d.angvel).setLinearDamping(0.1).setAngularDamping(0.4).setCcdEnabled(true);
    const body = this.world.createRigidBody(desc);
    const density = d.kind === 'wheel' ? 1100 : (MATERIALS[d.material as keyof typeof MATERIALS]?.density ?? 7800);
    const cd = d.kind === 'wheel'
      ? RAPIER.ColliderDesc.cylinder(d.size.z / 2, d.size.x).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 })
      : RAPIER.ColliderDesc.cuboid(d.size.x / 2, Math.max(0.004, d.size.y / 2), d.size.z / 2);
    cd.setDensity(density).setFriction(0.5).setRestitution(0.3).setCollisionGroups(COLLIDE.debris);
    const c = this.world.createCollider(cd, body);
    this.tags.set(c.handle, { bot: null, part: 'debris' });
    const id = this.nextDebrisId++;
    this.debris.push({ id, body, spec: d, born: this.time });
    this.events.push({ type: 'debris', id, spec: d });
    if (this.debris.length > 70) {
      const old = this.debris.shift()!;
      this.dropTags(old.body);
      this.world.removeRigidBody(old.body);
    }
  }

  step() {
    const ctx = this.ctx();
    this.time += DT;
    if (this.phase === 'countdown') {
      if (this.time >= COUNTDOWN_SECONDS) {
        this.phase = 'fight';
        this.events.push({ type: 'phase', phase: 'fight' });
      }
    } else if (this.phase === 'fight') {
      this.fightTime += DT;
    }

    const live = this.phase === 'fight';
    for (const b of this.bots) {
      const saved = b.input;
      if (!live) b.input = { throttle: 0, turn: 0, weapon: false };
      if (!live && b.spinner) b.spinner.on = false;
      b.update(DT, { tags: this.tags });
      b.input = saved;
    }
    if (live) {
      for (const b of this.bots) {
        spinnerStep(ctx, b, DT);
        actuatorStep(ctx, b, DT);
        secondaryStep(ctx, b, DT);
        selfRighterStep(ctx, b);
      }
      if (this.opts.hazards) this.hazardStep(ctx);
    } else if (this.phase === 'over') {
      // keep rotors coasting down
    }
    this.screwSpin();

    this.world.step(this.eq);
    this.eq.drainContactForceEvents((ev) => {
      const t1 = this.tags.get(ev.collider1());
      const t2 = this.tags.get(ev.collider2());
      const f = ev.totalForceMagnitude();
      const dir = ev.maxForceDirection() as V3;
      for (const [a, b] of [[t1, t2], [t2, t1]] as const) {
        const bot = a?.bot;
        if (!bot) continue;
        const other = b?.bot ?? null;
        if (other) { this.lastTouch[bot.index] = other.index; this.lastTouchT[bot.index] = this.time; }
        const toward = other ? norm(sub(other.pos, bot.pos)) : scale(norm(dir), -1);
        const at = add(bot.pos, v3(toward.x * bot.half.x, toward.y * bot.half.y, toward.z * bot.half.z));
        if (live) contactDamage(ctx, bot, other, f * (b?.part === 'hazard' ? 1.5 : 1), DT, at, dir);
      }
    });

    if (live) this.judgeStep();
    this.koStep();
    this.debrisCull();
  }

  private screwSpin() {
    const deckBusy = this.deck.length > 0;
    for (const s of this.screws) {
      // Upper Deck screws roll robots up onto the deck, then reverse once one is on it
      let w = 2.4 * s.dir;
      if (s.deck && deckBusy) w = -w;
      if (!this.opts.hazards) w = 0;
      s.body.setAngvel(s.axis === 'z' ? { x: 0, y: 0, z: w } : { x: w, y: 0, z: 0 }, true);
      s.angle += w * DT;
    }
  }

  private onDeck(b: BotRuntime) {
    const d = this.layout.deck;
    if (!d) return false;
    const p = b.pos;
    return Math.abs(p.x - d.x) < d.w / 2 && Math.abs(p.z - d.z) < d.d / 2 && p.y > d.h + 0.02;
  }

  private hazardStep(ctx: CombatContext) {
    // Killsaws: WOPR fires them in sequence during the final minute
    const finalMinute = this.opts.matchSeconds - this.fightTime <= 60;
    if (finalMinute && !this.hazardsLive) {
      this.hazardsLive = true;
      this.events.push({ type: 'hazards-live' });
    }
    if (this.hazardsLive) {
      this.wopr.t += DT;
      if (this.wopr.t >= this.wopr.next) {
        // every ~0.45 s fire the next saw in the pattern, plus any saw with a robot over it
        this.wopr.next = this.wopr.t + 0.45;
        const n = this.saws.length;
        const k = Math.floor(this.wopr.t / 0.45) % n;
        this.saws[k].hold = 0.55;
        this.layout.killsaws.forEach((slot, i) => {
          for (const b of this.bots) if (this.overSaw(b, slot) && this.rand() < 0.7) this.saws[i].hold = 0.55;
        });
      }
    }
    this.layout.killsaws.forEach((slot, i) => {
      const st = this.saws[i];
      st.angle += (this.hazardsLive ? 188 : 0) * DT; // 1,800 rpm
      st.hold = Math.max(0, st.hold - DT);
      st.rise = clamp(st.rise + (st.hold > 0 ? DT / 0.12 : -DT / 0.3), 0, 1);
      for (const b of this.bots) {
        st.hit[b.index] = Math.max(0, st.hit[b.index] - DT);
        if (st.rise > 0.7 && st.hit[b.index] <= 0 && this.overSaw(b, slot)) {
          st.hit[b.index] = 0.5;
          const p = v3(slot.x, Math.max(0.02, b.pos.y - b.half.y), slot.z);
          const along = slot.axis === 'x' ? v3(1, 0, 0) : v3(0, 0, 1);
          const J = b.mass * (1.4 + this.rand() * 1.3);
          b.impulse(add(v3(0, J, 0), scale(along, (this.rand() < 0.5 ? -1 : 1) * J * 0.4)), p);
          const E = 3500 + this.rand() * 3500;
          applyDamage(ctx, b, p, E, undefined, b.inverted ? 'top' : 'bottom');
          this.creditHazard(b, E);
          this.events.push({ type: 'hit', kind: 'hazard', pos: p, dir: v3(0, 1, 0), energy: E, impulse: J, attacker: -1, target: b.index, material: b.panels.bottom.material, hazardId: slot.id });
        }
      }
    });

    // Screws: friction does the grabbing (kinematic bodies); grinding does damage
    for (const s of this.layout.screws) {
      for (const b of this.bots) {
        const off = s.axis === 'z' ? Math.abs(b.pos.x - s.x) : Math.abs(b.pos.z - s.z);
        const along = s.axis === 'z' ? Math.abs(b.pos.z - s.z) : Math.abs(b.pos.x - s.x);
        const reach = s.radius + Math.min(b.half.x, b.half.z) + 0.05;
        if (off < reach && along < s.length / 2 + 0.15 && b.pos.y < 0.9) {
          const E = 1800 * DT;
          applyDamage(ctx, b, b.pos, E, undefined, 'bottom');
          this.creditHazard(b, E);
          if (this.rand() < DT * 14) {
            this.events.push({ type: 'hit', kind: 'hazard', pos: v3(s.axis === 'z' ? s.x : b.pos.x, 0.25, s.axis === 'z' ? b.pos.z : s.z), dir: v3(0, 1, 0), energy: 300, impulse: 0, attacker: -1, target: b.index, material: 'ar500', hazardId: s.id });
          }
        }
      }
    }

    // Pulverizers: team-controlled. Humans press their hazard button; AI teams fire on a victim.
    this.layout.pulverizers.forEach((pz, i) => {
      const st = this.pulvs[i];
      st.cooldown = Math.max(0, st.cooldown - DT);
      if (st.phase === 'idle') {
        const owner = this.bots[pz.team];
        const victim = this.bots.find((b) => Math.hypot(b.pos.x - pz.x, b.pos.z - pz.z) < pz.reach);
        const human = this.opts.humans[pz.team];
        const want = human ? !!owner?.input.hazard : !!victim && victim !== owner;
        if (want && st.cooldown <= 0) { st.phase = 'down'; st.t = 0; st.struck = false; }
      } else if (st.phase === 'down') {
        st.t += DT;
        st.swing = Math.min(1, (st.t / 0.28) ** 2);
        if (st.swing >= 1 && !st.struck) {
          st.struck = true;
          for (const b of this.bots) {
            if (Math.hypot(b.pos.x - pz.x, b.pos.z - pz.z) < pz.reach * 0.75 && b.pos.y < 1) {
              const p = add(b.pos, v3(0, b.half.y, 0));
              b.impulse(v3(0, -b.mass * 2.6, 0), p);
              const E = 6000 + this.rand() * 4000; // 100 lb diamond head
              applyDamage(ctx, b, p, E, undefined, b.inverted ? 'bottom' : 'top');
              this.creditHazard(b, E, pz.team);
              this.events.push({ type: 'hit', kind: 'hazard', pos: p, dir: v3(0, -1, 0), energy: E, impulse: b.mass * 2.6, attacker: -1, target: b.index, material: b.panels.top.material, hazardId: pz.id });
            }
          }
          this.events.push({ type: 'actuate', bot: -1, kind: 'hammer', pos: v3(pz.x, 0, pz.z) });
        }
        if (st.t > 0.5) { st.phase = 'up'; st.t = 0; }
      } else {
        st.t += DT;
        st.swing = Math.max(0, 1 - st.t / 1.0);
        if (st.swing <= 0) { st.phase = 'idle'; st.cooldown = 1.8; }
      }
    });

    // Paddles: pneumatic wall flippers swat robots back toward the Pulverizers
    this.layout.paddles.forEach((pd, i) => {
      const st = this.paddles[i];
      st.cooldown = Math.max(0, st.cooldown - DT);
      st.kick = Math.max(0, st.kick - DT * 4);
      if (st.cooldown > 0) return;
      for (const b of this.bots) {
        const dx = b.pos.x - pd.x, dz = b.pos.z - pd.z;
        const n = dx * pd.normal.x + dz * pd.normal.z;
        const t = Math.abs(dx * pd.normal.z - dz * pd.normal.x);
        if (n > 0 && n < Math.max(b.half.x, b.half.z) + 0.3 && t < pd.length / 2) {
          st.kick = 1; st.cooldown = 2.5;
          b.impulse(v3(pd.normal.x * b.mass * 3.2, b.mass * 0.6, b.mass * 1.8), add(b.pos, v3(0, -b.half.y, 0)));
          this.events.push({ type: 'actuate', bot: -1, kind: 'flip', pos: v3(pd.x, 0.3, pd.z) });
        }
      }
    });

    // Ramrods: spikes that punch up at random under the center logo
    this.layout.ramrods.forEach((rr, i) => {
      const st = this.ramrods[i];
      st.cooldown -= DT;
      st.rise = Math.max(0, st.rise - DT * 3);
      if (st.cooldown <= 0) {
        st.cooldown = 3 + this.rand() * 5;
        st.rise = 1;
        for (const b of this.bots) {
          const l = b.toLocal(v3(rr.x, 0, rr.z));
          if (Math.abs(l.x) < b.half.x && Math.abs(l.z) < b.half.z && b.pos.y < 0.6) {
            b.impulse(v3(0, b.mass * 1.1, 0), v3(rr.x, 0.02, rr.z));
            this.events.push({ type: 'hit', kind: 'hazard', pos: v3(rr.x, 0.05, rr.z), dir: v3(0, 1, 0), energy: 600, impulse: b.mass, attacker: -1, target: b.index, material: 'ar500', hazardId: rr.id });
          }
        }
      }
    });
  }

  private overSaw(b: BotRuntime, slot: { x: number; z: number; radius: number }) {
    const l = b.toLocal(v3(slot.x, 0.0, slot.z));
    return Math.abs(l.x) < b.half.x + 0.05 && Math.abs(l.z) < b.half.z + 0.05 && b.pos.y < 0.7;
  }

  private creditHazard(victim: BotRuntime, E: number, team?: number) {
    const other = this.bots[1 - victim.index];
    // pushing someone into a hazard (or dropping your Pulverizer on them) counts for you
    const recent = team === other.index || this.lastTouch[victim.index] === other.index && this.time - this.lastTouchT[victim.index] < 2.5;
    other.damageDealt += E * (recent ? 0.8 : 0.35);
    other.hazardDamageDealt += E;
    if (recent) other.control += 1.0;
  }

  private judgeStep() {
    const [a, b] = this.bots;
    for (const [me, op] of [[a, b], [b, a]] as const) {
      const toOp = sub(op.pos, me.pos);
      const dist = len(toOp);
      const dirTo = scale(toOp, 1 / Math.max(dist, 0.01));
      const vel = me.body.linvel() as V3;
      const closing = dot(vel, dirTo);
      const weaponLive = me.spinner ? Math.abs(me.spinner.omega) > 30 : true;
      if (me.canMove() && closing > 0.6 && weaponLive) me.aggression += DT;
      else if (me.canMove() && dist < 1.6 && weaponLive) me.aggression += DT * 0.6;
      // control: driving well while the other one is in trouble or being driven
      if (me.canMove()) {
        if (!op.canMove()) me.control += DT;
        if (dist < me.half.x + op.half.x + 0.25 && closing > 0.3) me.control += DT * 0.8;
        if (op.pos.y > op.half.y + op.design.chassis.clearance + 0.25) me.control += DT * 0.5; // opponent airborne/high-centered
      }
    }
  }

  private koStep() {
    if (this.phase !== 'fight') return;
    const countLen = this.opts.koCount === 'rulebook' ? 20 : KO_COUNT_SECONDS;
    // Upper Deck: stay up there too long and the refs count you off it
    this.deck = this.bots.filter((b) => this.onDeck(b)).map((b) => ({ bot: b.index, t: 0 }));
    for (const b of this.bots) {
      const up = this.onDeck(b);
      b.deckTime = up ? b.deckTime + DT : 0;
    }
    if (!this.deckCountdown) {
      const lingerer = this.bots.find((b) => b.deckTime > 6);
      if (lingerer) { this.deckCountdown = { bot: lingerer.index, t: 0 }; this.events.push({ type: 'deck-count', bot: lingerer.index }); }
    } else {
      const b = this.bots[this.deckCountdown.bot];
      if (b.deckTime === 0) this.deckCountdown = null;
      else {
        this.deckCountdown.t += DT;
        if (this.deckCountdown.t >= 10) {
          this.finish({ winner: (1 - b.index) as 0 | 1, method: 'KO', time: this.fightTime, koReason: `${b.design.name} was counted out on the Upper Deck` });
          return;
        }
      }
    }

    let held: { victim: BotRuntime; attacker: BotRuntime } | null = null;
    for (const b of this.bots) {
      const other = this.bots[1 - b.index];
      // two wheels on the spiked rail still "can move" by the wheel test, and still can't translate
      const mobile = b.canMove() && !this.propped(b);
      const inContact = !mobile && this.touching(b, other);
      if (inContact) held = { victim: b, attacker: other };
      // the count only runs on a robot that is down on its own: not being held, not unsupported in the air, not still sliding
      const counting = !mobile && !inContact && !b.airborne() && b.speed < 0.3;
      if (counting) this.immobile[b.index] += DT;
      // a robot that is actually driving is showing movement, even if it is still touching the rail
      else if (mobile || (b.canMove() && b.speed >= 0.3)) this.immobile[b.index] = Math.max(0, this.immobile[b.index] - DT * 2);
      if (!this.ko && this.immobile[b.index] > 1.5 && counting) {
        this.ko = { bot: b.index, t: 0, reason: this.koReason(b) };
        this.events.push({ type: 'ko-start', bot: b.index });
      }
    }
    // pin / lift / grapple limit
    if (held && !this.ko) {
      if (!this.pin || this.pin.attacker !== held.attacker.index) {
        this.pin = { attacker: held.attacker.index, t: 0 };
        this.events.push({ type: 'pin-start', bot: held.attacker.index });
      }
      this.pin.t += DT;
      if (this.pin.t >= 10) {
        // refs separate them: push apart and drop the victim back on the floor
        const a = held.attacker, v = held.victim;
        const d = norm(v3(v.pos.x - a.pos.x, 0, v.pos.z - a.pos.z));
        a.body.setLinvel({ x: -d.x * 1.5, y: 0, z: -d.z * 1.5 }, true);
        v.body.setLinvel({ x: d.x * 2.5, y: 1.5, z: d.z * 2.5 }, true);
        this.events.push({ type: 'separate', bot: a.index });
        this.pin = null;
      }
    } else if (this.pin) {
      this.pin = null;
    }

    if (this.ko) {
      const b = this.bots[this.ko.bot];
      if (b.canMove() && this.immobile[b.index] < 0.6 || this.touching(b, this.bots[1 - b.index])) {
        this.ko = null;
        this.events.push({ type: 'ko-cancel', bot: b.index });
      } else {
        this.ko.t += DT;
        this.ko.reason = this.koReason(b);
        if (this.ko.t >= countLen) {
          // both down? the one incapacitated last wins (TKO) - that's the other robot, already counted second
          this.finish({ winner: (1 - b.index) as 0 | 1, method: 'KO', time: this.fightTime, koReason: this.koReason(b) });
          return;
        }
      }
    }
    if (this.fightTime >= this.opts.matchSeconds) this.finish(this.judges());
  }

  judges(): MatchResult {
    const [a, b] = this.bots;
    const cards: JudgeCard[] = [];
    const split = (x: number, y: number, pts: number, bias: number): [number, number] => {
      const s = x + y;
      let share = s > 1e-6 ? x / s : 0.5;
      share = clamp(share + bias, 0, 1);
      const raw = share * pts;
      // exact halves go to whoever did more of it, not to the red square
      const ax = Math.abs(raw - Math.floor(raw) - 0.5) < 1e-6 ? (x >= y ? Math.ceil(raw) : Math.floor(raw)) : Math.round(raw);
      return [ax, pts - ax];
    };
    for (let j = 0; j < JUDGING.judges; j++) {
      const bias = () => (this.rand() - 0.5) * 0.12;
      cards.push({
        damage: split(a.damageDealt, b.damageDealt, JUDGING.points.damage, bias()),
        aggression: split(a.aggression, b.aggression, JUDGING.points.aggression, bias()),
        control: split(a.control, b.control, JUDGING.points.control, bias()),
      });
    }
    const tally = (i: 0 | 1) => cards.reduce((s, c) => s + c.damage[i] + c.aggression[i] + c.control[i], 0);
    const totals: [number, number] = [tally(0), tally(1)];
    const judgeWins = cards.map((c) => {
      const x = c.damage[0] + c.aggression[0] + c.control[0];
      const y = c.damage[1] + c.aggression[1] + c.control[1];
      return x === y ? (c.damage[0] >= c.damage[1] ? 0 : 1) : x > y ? 0 : 1;
    });
    const w0 = judgeWins.filter((w) => w === 0).length;
    const winner: 0 | 1 = w0 * 2 > cards.length ? 0 : 1;
    return { winner, method: 'Judges', time: this.fightTime, cards, totals, split: w0 !== 0 && w0 !== cards.length };
  }

  /** Read-only running score: the judges' points each robot would get on the
   * stats so far, without the per-judge noise. Drivers read it to manage the clock. */
  judgesEstimate(): [number, number] {
    const [a, b] = this.bots;
    const share = (x: number, y: number) => (x + y > 1e-6 ? x / (x + y) : 0.5);
    const p = JUDGING.points;
    const s = share(a.damageDealt, b.damageDealt) * p.damage + share(a.aggression, b.aggression) * p.aggression + share(a.control, b.control) * p.control;
    const total = (p.damage + p.aggression + p.control) * JUDGING.judges;
    return [s * JUDGING.judges, total - s * JUDGING.judges];
  }

  finish(r: MatchResult) {
    if (this.result) return;
    this.result = r;
    this.phase = 'over';
    this.ko = null;
    for (const b of this.bots) if (b.spinner) b.spinner.on = false;
    this.events.push({ type: 'over', result: r });
  }

  /** Collider contacts with the arena (floor, rail, deck, wall, hazard), by hazard id or part. */
  private restingOn(b: BotRuntime) {
    const on = new Set<string>();
    for (let i = 0; i < b.body.numColliders(); i++) {
      this.world.contactPairsWith(b.body.collider(i), (o) => {
        const t = this.tags.get(o.handle);
        if (t && !t.bot) on.add(t.hazardId ?? t.part);
      });
    }
    return on;
  }

  /** On the spiked rail or the deck lip with at most half its wheels down. More than that, and a brush with the rail is not a beaching. */
  private propped(b: BotRuntime) {
    const down = b.wheels.filter((w) => w.attached && w.contact).length;
    if (down > b.wheels.length / 2) return false;
    const on = this.restingOn(b);
    return on.has('rail') || (on.has('deck') && !this.onDeck(b));
  }

  private koReason(b: BotRuntime) {
    const base = koReason(b);
    if (!base.endsWith('could not show controlled movement')) return base;
    // wheels off the floor: say what it's beached on
    const on = this.restingOn(b);
    const n = b.design.name;
    if (on.has('rail')) return `${n} is high-centred on the spiked rail`;
    if (on.has('deck')) return `${n} is high-centred on the Upper Deck edge`;
    for (const h of on) if (h.includes('screw')) return `${n} is caught in the screws`;
    if (on.has('wall')) return `${n} is wedged against the wall`;
    const down = b.wheels.filter((w) => w.attached && w.contact);
    // a wheel still on the floor, but not enough of them to translate: say so.
    // "beached with its wheels off the floor" is only true when none of them are down.
    if (down.length > 0 && down.length < b.wheels.length) {
      if (b.wheels.some((w) => !w.attached)) return `${n} lost a wheel and can't drive`;
      return `${n} is high-centred`;
    }
    return `${n} is beached with its wheels off the floor`;
  }

  private dropTags(body: RAPIERNS.RigidBody) {
    for (let i = 0; i < body.numColliders(); i++) this.tags.delete(body.collider(i).handle);
  }

  /** Are these two robots physically touching (any collider pair in the narrow phase)? */
  touching(a: BotRuntime, b: BotRuntime) {
    let hit = false;
    for (let i = 0; i < a.body.numColliders() && !hit; i++) {
      this.world.contactPairsWith(a.body.collider(i), (other) => {
        if (this.tags.get(other.handle)?.bot === b) hit = true;
      });
    }
    return hit;
  }

  private debrisCull() {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      const p = d.body.translation();
      if (p.y < -2 || Math.abs(p.x) > ARENA_SIZE || Math.abs(p.z) > ARENA_SIZE) {
        this.dropTags(d.body);
        this.world.removeRigidBody(d.body);
        this.debris.splice(i, 1);
      }
    }
  }

  view(): MatchView {
    return {
      time: this.time,
      phase: this.phase,
      clock: Math.max(0, this.opts.matchSeconds - this.fightTime),
      countdown: Math.max(0, COUNTDOWN_SECONDS - this.time),
      ko: this.ko ? (() => {
        const len = this.opts.koCount === 'rulebook' ? 20 : KO_COUNT_SECONDS;
        const left = Math.max(0, Math.ceil(len - this.ko.t));
        return { bot: this.ko.bot, count: left, silent: left > 10, reason: this.ko.reason };
      })() : null,
      hazardsLive: this.hazardsLive,
      pin: this.pin ? { bot: this.pin.attacker, count: Math.max(0, Math.ceil(10 - this.pin.t)) } : null,
      deckCount: this.deckCountdown ? { bot: this.deckCountdown.bot, count: Math.max(0, Math.ceil(10 - this.deckCountdown.t)) } : null,
      bots: this.bots.map((b) => botView(b)),
      debris: this.debris.map((d) => ({ id: d.id, pos: d.body.translation(), rot: d.body.rotation() })),
      hazards: {
        saws: this.saws.map((s) => ({ id: s.id, rise: s.rise, angle: s.angle })),
        screws: this.screws.map((s) => ({ id: s.id, angle: s.angle })),
        pulverizers: this.pulvs.map((p) => ({ id: p.id, swing: p.swing })),
        paddles: this.paddles.map((p) => ({ id: p.id, kick: p.kick })),
        ramrods: this.ramrods.map((r) => ({ id: r.id, rise: r.rise })),
      },
      result: this.result,
    };
  }

  debrisSpec(id: number) {
    return this.debris.find((d) => d.id === id)?.spec;
  }

  dispose() {
    this.world.free();
    this.eq.free();
  }
}

export function botView(b: BotRuntime): BotView {
  const sp = b.spinner;
  const panels = {} as Record<Face, number>;
  for (const f of FACES) panels[f] = b.panels[f].integrity;
  return {
    pos: b.body.translation(),
    rot: b.body.rotation(),
    wheels: b.wheels.map((w) => ({ angle: w.angle, attached: w.attached, contact: w.contact })),
    weaponAngle: sp ? sp.angle : 0,
    actuator: b.actuator ? b.actuator.pos : 0,
    saw: b.actuator ? b.actuator.sawAngle : 0,
    panels,
    internals: { ...b.internals },
    onFire: b.onFire,
    volts: b.volts,
    amps: b.amps,
    rpm: sp ? radToRpm(Math.abs(sp.omega)) : 0,
    energyKJ: b.weaponEnergy() / 1000,
    weaponOn: sp ? sp.on : false,
    inverted: b.inverted,
    canMove: b.canMove(),
    shots: b.actuator ? (Number.isFinite(b.actuator.shots) ? b.actuator.shots : -1) : -1,
    speedMph: b.speed / 0.44704,
    soc: b.soc,
  };
}

function koReason(b: BotRuntime) {
  const n = b.design.name;
  if (b.internals.battery <= 0) return `${n} lost power: battery destroyed`;
  if (b.internals.electronics <= 0) return `${n}'s electronics are dead`;
  if (b.internals.driveL <= 0 && b.internals.driveR <= 0) return `${n} lost both drive sides`;
  if (b.onSide) return `${n} is stuck on its side`;
  if (b.inverted && !b.stats.invertible) return `${n} is flipped and can't self-right`;
  if (!b.wheels.some((w) => w.attached)) return `${n} lost all its wheels`;
  return `${n} could not show controlled movement`;
}

export type { BotInput };
