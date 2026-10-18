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
    // Hit-stop: the frame that landed the blow already drew it. Hold the sim
    // and keep rendering so the shake runs through the freeze.
    if (this.hitStop > 0) {
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
    for (const e of events) if (e.type === 'hit') stop = Math.max(stop, hitStopSeconds(e.kind, e.energy, this.online));
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
    this.view.frame(dt, m.bots.map((b) => b.flameOn));
    this.onTick?.(view, dt);
    this.onFrame({ view, inputs: this.inputs, slowmo: this.slow > 0 && this.moment !== 'ko', moment: this.moment });
    if (m.result) this.openFinale(m.result);
    if (this.moment === 'ko') {
      this.koLeft -= dt;
      if (this.koLeft <= 0) this.finishShow();
    }
  };

  /** KO: 0.2× for 2.5 s on a low hero shot. Judges go straight on (replay lands before results). */
  private openFinale(result: import('./sim/match').MatchResult) {
    if (this.presented) return;
    this.presented = true;
    this.winner = result.winner;
    if (!this.showcase || this.online || result.method !== 'KO') {
      this.moment = 'done';
      return;
    }
    const mode = this.view.mode;
    this.camBefore = mode === 'intro' || mode === 'gallery' || mode === 'hero' ? 'broadcast' : mode;
    this.moment = 'ko';
    this.koLeft = 2.5;
    this.view.focus = this.winner;
    this.view.setMode('hero');
    this.view.victoryPyro();
    this.audio.crowdFull();
  }

  /** Hand the fight back to the UI. The replay commit takes this over. */
  private finishShow() {
    this.moment = 'done';
    this.audio.replay = false;
    if (this.view.mode === 'hero') this.view.setMode(this.camBefore);
  }
}
