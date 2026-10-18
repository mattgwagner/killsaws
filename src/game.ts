// Runs a match in the browser: fixed-step physics, drivers, slow-motion on
// the big hits, audio and the renderer.
import { Match, MatchOptions, MatchView, DT } from './sim/match';
import { BotDesign } from './sim/design';
import { BotAI, AILevel } from './sim/ai';
import { BotInput, NO_INPUT } from './sim/bot';
import { SimEvent } from './sim/combat';
import { CameraMode, GameView } from './render/scene';
import { ControllerKind, HumanDriver } from './input';
import { Audio } from './audio/audio';

export interface SeatConfig { kind: ControllerKind; ai?: AILevel }

export interface HitCallout { id: number; text: string; kj: number; bot: number; at: number; kind: string; bite?: number }

export interface FrameInfo {
  view: MatchView;
  inputs: BotInput[];
  slowmo: boolean;
  /** live fight, the KO shot, an instant replay, or the show handed back to the UI */
  moment: Moment;
}

export type Moment = 'live' | 'ko' | 'replay' | 'done';

const STOP_KINDS = new Set(['spinner', 'clash', 'hammer', 'flip', 'hazard']);

/** Freeze length for a hit. Wheel bumps and online matches stay at 0. 60–90 ms. */
export function hitStopSeconds(kind: string, joules: number, online = false) {
  if (online || !STOP_KINDS.has(kind)) return 0;
  const kj = joules / 1000;
  if (kj < 15) return 0;
  return Math.min(0.09, 0.06 + (kj - 15) * 0.001);
}

interface Snap {
  view: MatchView;
  events: SimEvent[];
  slide: number[];
  secondary: number[];
  flame: boolean[];
  /** Sim time, so the buffer is the last 6 s of the fight rather than of wall clock. */
  t: number;
}

function xyz(p: { x: number; y: number; z: number }) {
  return { x: p.x, y: p.y, z: p.z };
}
function quat(r: { x: number; y: number; z: number; w: number }) {
  return { x: r.x, y: r.y, z: r.z, w: r.w };
}

function cloneView(v: MatchView): MatchView {
  return {
    time: v.time, phase: v.phase, clock: v.clock, countdown: v.countdown,
    ko: v.ko ? { ...v.ko } : null,
    hazardsLive: v.hazardsLive,
    pin: v.pin ? { ...v.pin } : null,
    deckCount: v.deckCount ? { ...v.deckCount } : null,
    bots: v.bots.map((b) => ({
      ...b, pos: xyz(b.pos), rot: quat(b.rot),
      wheels: b.wheels.map((w) => ({ ...w })),
      panels: { ...b.panels }, internals: { ...b.internals },
    })),
    debris: v.debris.map((d) => ({ id: d.id, pos: xyz(d.pos), rot: quat(d.rot) })),
    hazards: {
      saws: v.hazards.saws.map((s) => ({ ...s })),
      screws: v.hazards.screws.map((s) => ({ ...s })),
      pulverizers: v.hazards.pulverizers.map((p) => ({ ...p })),
      paddles: v.hazards.paddles.map((p) => ({ ...p })),
      ramrods: v.hazards.ramrods.map((r) => ({ ...r })),
    },
    result: v.result,
  };
}

function cloneEvent(e: SimEvent): SimEvent {
  if (e.type === 'hit') return { ...e, pos: xyz(e.pos), dir: xyz(e.dir) };
  if (e.type === 'break' || e.type === 'actuate') return { ...e, pos: xyz(e.pos) };
  if (e.type === 'debris') {
    const s = e.spec;
    return { ...e, spec: { ...s, size: xyz(s.size), pos: xyz(s.pos), vel: xyz(s.vel), angvel: xyz(s.angvel) } };
  }
  return e;
}

function cloneSnap(s: Snap): Snap {
  return {
    view: cloneView(s.view), events: s.events.map(cloneEvent),
    slide: s.slide.slice(), secondary: s.secondary.slice(), flame: s.flame.slice(), t: s.t,
  };
}

export class GameSession {
  match!: Match;
  private drivers: (HumanDriver | BotAI | null)[] = [];
  private acc = 0;
  private raf = 0;
  private last = 0;
  private slow = 0;
  /** wall-clock seconds left in a hit-stop. Shake keeps running; the sim does not. */
  private hitStop = 0;
  private online = false;
  /** local exhibition / tournament: play the KO shot and the replay. Attract and online skip it. */
  showcase = false;
  moment: Moment = 'live';
  private koLeft = 0;
  private presented = false;
  private winner: 0 | 1 = 0;
  private camBefore: CameraMode = 'broadcast';
  private ring: Snap[] = [];
  private big: { j: number; t: number; clip: Snap[] | null } = { j: 0, t: 0, clip: null };
  private bigCap: { until: number; snaps: Snap[] } | null = null;
  private play: { snaps: Snap[]; acc: number; overhead: boolean } | null = null;
  private playedBig = false;
  paused = false;
  /** intro: render but don't advance the sim */
  hold = false;
  private calloutId = 1;
  onFrame: (f: FrameInfo) => void = () => {};
  onCallout: (c: HitCallout) => void = () => {};
  onEvents: (e: SimEvent[]) => void = () => {};
  /** per rendered frame, after the sim advanced (online host streams from here) */
  onTick?: (view: MatchView, dt: number) => void;
  /** online guests feed remote input here */
  remoteInput: BotInput = { ...NO_INPUT };
  private inputs: BotInput[] = [{ ...NO_INPUT }, { ...NO_INPUT }];

  constructor(readonly view: GameView, readonly audio: Audio) {}

  async start(designs: [BotDesign, BotDesign], seats: [SeatConfig, SeatConfig], opts: MatchOptions = {}) {
    this.stop();
    const humans: [boolean, boolean] = [seats[0].kind !== 'ai', seats[1].kind !== 'ai'];
    this.match = await Match.create(designs, { ...opts, humans });
    this.drivers = seats.map((s, i) => (s.kind === 'ai' ? new BotAI(i, s.ai ?? 'veteran', (opts.seed ?? 1) + i) : s.kind === 'net' ? null : new HumanDriver(s.kind)));
    this.view.setLayout(this.match.layout);
    this.view.setBots(designs);
    this.view.focus = seats[0].kind === 'ai' && seats[1].kind !== 'ai' ? 1 : 0;
    this.online = seats.some((s) => s.kind === 'net');
    this.hitStop = 0;
    this.slow = 0;
    this.koLeft = 0;
    this.presented = false;
    this.moment = 'live';
    this.ring = [];
    this.big = { j: 0, t: 0, clip: null };
    this.bigCap = null;
    this.play = null;
    this.playedBig = false;
    this.audio.replay = false;
    this.audio.startMatch(designs);
    this.acc = 0;
    this.last = performance.now();
    this.loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.audio.stopMatch();
    this.match?.dispose();
    this.match = undefined as unknown as Match;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.paused || this.hold) {
      if (this.match) this.view.apply(this.match.view());
      this.view.frame(this.paused ? 0 : dt);
      return;
    }
    if (this.moment === 'replay' && this.play) {
      this.renderReplay(dt);
      return;
    }
    // Hit-stop: the frame that landed the blow already drew it. Hold the sim
    // and keep rendering so the shake runs through the freeze.
    if (this.hitStop > 0 && this.moment !== 'ko') {
      this.hitStop = Math.max(0, this.hitStop - dt);
      const held = this.match.view();
      this.view.apply(held, { slide: this.match.bots.map((b) => b.slidePos), secondary: this.match.bots.map((b) => b.secondaryAct?.pos ?? 0) });
      this.view.frame(dt, this.match.bots.map((b) => b.flameOn));
      this.onFrame({ view: held, inputs: this.inputs, slowmo: false, moment: this.moment });
      return;
    }
    const scale = this.moment === 'ko' ? 0.2 : this.slow > 0 ? 0.28 : 1;
    if (this.moment !== 'ko') this.slow = Math.max(0, this.slow - dt);
    this.acc += dt * scale;
    let steps = 0;
    const m = this.match;
    const events: SimEvent[] = [];
    while (this.acc >= DT && steps < 16) {
      for (let i = 0; i < 2; i++) {
        const d = this.drivers[i];
        if (d instanceof BotAI) this.inputs[i] = d.think(m, DT);
        else if (d instanceof HumanDriver) this.inputs[i] = d.read(DT);
        else this.inputs[i] = this.remoteInput;
        m.setInput(i, this.inputs[i]);
      }
      m.step();
      events.push(...m.drainEvents());
      this.acc -= DT;
      steps++;
    }
    if (steps === 16) this.acc = 0;
    const view = m.view();
    this.view.apply(view, { slide: m.bots.map((b) => b.slidePos), secondary: m.bots.map((b) => b.secondaryAct?.pos ?? 0) });
    const biggest = this.view.events(events);
    let stop = 0;
    for (const e of events) {
      if (e.type !== 'hit') continue;
      stop = Math.max(stop, hitStopSeconds(e.kind, e.energy, this.online));
      if (this.moment === 'live' && STOP_KINDS.has(e.kind) && e.energy > 40000 && e.energy > this.big.j) {
        this.big = { j: e.energy, t: view.time, clip: null };
        this.bigCap = { until: view.time + 2.5, snaps: this.ring.filter((s) => s.t >= view.time - 1.5).map(cloneSnap) };
      }
    }
    if (stop > 0) this.hitStop = Math.max(this.hitStop, stop);
    if (biggest > 30000 && this.slow <= 0) this.slow = 0.9;
    for (const e of events) {
      if (e.type === 'hit' && e.attacker >= 0 && e.energy > 2500 && (e.kind === 'spinner' || e.kind === 'clash' || e.kind === 'hammer' || e.kind === 'flip')) {
        this.onCallout({ id: this.calloutId++, text: e.kind === 'clash' ? 'WEAPON CLASH' : e.kind === 'flip' ? 'FLIPPED' : '', kj: e.energy / 1000, bot: e.attacker, at: now, kind: e.kind, bite: e.bite });
      }
    }
    this.audio.events(events, view);
    this.audio.update(view, m.bots, dt * scale);
    this.onEvents(events);
    const flame = m.bots.map((b) => b.flameOn);
    this.view.frame(dt, flame);
    const slide = m.bots.map((b) => b.slidePos);
    const secondary = m.bots.map((b) => b.secondaryAct?.pos ?? 0);
    if (this.moment === 'live') this.record(view, events, slide, secondary, flame);
    this.onTick?.(view, dt);
    this.onFrame({ view, inputs: this.inputs, slowmo: this.slow > 0 && this.moment !== 'ko', moment: this.moment });
    if (m.result) this.openFinale(m.result);
    if (this.moment === 'ko') {
      this.koLeft -= dt;
      if (this.koLeft <= 0) this.startFinishReplay();
    }
  };

  /**
   * Step the sim forward without drawing. One recorded frame per 1/60 s of sim
   * time, so a test can reach a KO and still have a replay of it.
   */
  fastForward(seconds: number) {
    const m = this.match;
    if (!m) return;
    const frames = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < frames && !m.result; i++) {
      const events: SimEvent[] = [];
      for (let s = 0; s < 4; s++) {
        for (let b = 0; b < 2; b++) {
          const d = this.drivers[b];
          if (d instanceof BotAI) this.inputs[b] = d.think(m, DT);
          else if (d instanceof HumanDriver) this.inputs[b] = d.read(DT);
          else this.inputs[b] = this.remoteInput;
          m.setInput(b, this.inputs[b]);
        }
        m.step();
        events.push(...m.drainEvents());
      }
      const view = m.view();
      for (const e of events) {
        if (e.type === 'hit' && STOP_KINDS.has(e.kind) && e.energy > 40000 && e.energy > this.big.j) {
          this.big = { j: e.energy, t: view.time, clip: null };
          this.bigCap = { until: view.time + 2.5, snaps: this.ring.filter((sn) => sn.t >= view.time - 1.5).map(cloneSnap) };
        }
      }
      const slide = m.bots.map((b) => b.slidePos);
      const secondary = m.bots.map((b) => b.secondaryAct?.pos ?? 0);
      const flame = m.bots.map((b) => b.flameOn);
      if (this.moment === 'live') this.record(view, events, slide, secondary, flame);
      if (m.result) this.openFinale(m.result);
    }
  }

  /** KO: 0.2× for 2.5 s on a low hero shot. Judges go straight on (replay lands before results). */
  private openFinale(result: import('./sim/match').MatchResult) {
    if (this.presented) return;
    this.presented = true;
    this.winner = result.winner;
    if (!this.showcase || this.online) {
      this.moment = 'done';
      return;
    }
    if (this.bigCap) { this.big.clip = this.bigCap.snaps; this.bigCap = null; }
    const mode = this.view.mode;
    this.camBefore = mode === 'intro' || mode === 'gallery' || mode === 'hero' ? 'broadcast' : mode;
    if (result.method !== 'KO') {
      this.startFinishReplay();
      return;
    }
    this.moment = 'ko';
    this.koLeft = 2.5;
    this.view.focus = this.winner;
    this.view.setMode('hero');
    this.view.victoryPyro();
    this.audio.crowdFull();
  }

  /** Final 4 s, chase on the winner, overhead for the last second of the clip. */
  private startFinishReplay() {
    const end = this.ring[this.ring.length - 1];
    const snaps = end ? this.ring.filter((s) => s.t >= end.t - 4) : [];
    if (snaps.length < 2) { this.afterClip(); return; }
    this.playClip(snaps, true);
  }

  private playClip(snaps: Snap[], overhead: boolean) {
    this.moment = 'replay';
    this.play = { snaps, acc: 0, overhead };
    this.audio.replay = true;
    this.audio.duck();
    this.view.focus = this.winner;
    this.view.setMode('chase');
  }

  private renderReplay(dt: number) {
    const p = this.play;
    if (!p) return;
    p.acc += dt * 0.35;
    const target = p.snaps[0].t + p.acc;
    let snap = p.snaps[0];
    for (const s of p.snaps) { if (s.t <= target) snap = s; else break; }
    const end = p.snaps[p.snaps.length - 1].t;
    this.view.setMode(p.overhead && target >= end - 1 ? 'overhead' : 'chase');
    this.view.focus = this.winner;
    this.view.apply(snap.view, { slide: snap.slide, secondary: snap.secondary });
    const shown = snap.events.filter((e) => e.type === 'hit' || e.type === 'break' || e.type === 'actuate' || e.type === 'debris');
    this.view.events(shown, true);
    this.audio.events(shown.filter((e) => e.type === 'hit' || e.type === 'break'), snap.view);
    this.view.frame(dt, snap.flame);
    this.onFrame({ view: snap.view, inputs: this.inputs, slowmo: false, moment: 'replay' });
    if (target >= end) { this.play = null; this.afterClip(); }
  }

  /** Enter or a gamepad button drops the clip that's playing. */
  skipClip() {
    if (this.moment !== 'replay') return;
    this.play = null;
    this.afterClip();
  }

  private afterClip() {
    const endT = this.ring[this.ring.length - 1]?.t ?? this.big.t;
    const clip = this.big.clip;
    if (!this.playedBig && this.big.j > 40000 && clip && clip.length > 2 && endT - this.big.t >= 1.5) {
      this.playedBig = true;
      this.playClip(clip, false);
      return;
    }
    this.moment = 'done';
    this.audio.replay = false;
    if (this.view.mode !== this.camBefore) this.view.setMode(this.camBefore);
  }

  private record(view: MatchView, events: SimEvent[], slide: number[], secondary: number[], flame: boolean[]) {
    const snap: Snap = {
      view: cloneView(view), events: events.map(cloneEvent),
      slide: slide.slice(), secondary: secondary.slice(), flame: flame.slice(), t: view.time,
    };
    const last = this.ring[this.ring.length - 1];
    if (last && Math.abs(last.t - snap.t) < 1e-4) this.ring[this.ring.length - 1] = snap;
    else this.ring.push(snap);
    const cutoff = view.time - 6;
    while (this.ring.length > 2 && this.ring[0].t < cutoff) this.ring.shift();
    if (this.bigCap) {
      this.bigCap.snaps.push(cloneSnap(snap));
      if (view.time >= this.bigCap.until) { this.big.clip = this.bigCap.snaps; this.bigCap = null; }
    }
  }
}
