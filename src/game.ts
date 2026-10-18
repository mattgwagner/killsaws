// Runs a match in the browser: fixed-step physics, drivers, slow-motion on
// the big hits, audio and the renderer.
import { Match, MatchOptions, MatchView, DT } from './sim/match';
import { BotDesign } from './sim/design';
import { BotAI, AILevel } from './sim/ai';
import { BotInput, NO_INPUT } from './sim/bot';
import { SimEvent } from './sim/combat';
import { GameView } from './render/scene';
import { ControllerKind, HumanDriver } from './input';
import { Audio } from './audio/audio';

export interface SeatConfig { kind: ControllerKind; ai?: AILevel }

export interface HitCallout { id: number; text: string; kj: number; bot: number; at: number; kind: string; bite?: number }

export interface FrameInfo {
  view: MatchView;
  inputs: BotInput[];
  slowmo: boolean;
}

export class GameSession {
  match!: Match;
  private drivers: (HumanDriver | BotAI | null)[] = [];
  private acc = 0;
  private raf = 0;
  private last = 0;
  private slow = 0;
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
    const scale = this.slow > 0 ? 0.28 : 1;
    this.slow = Math.max(0, this.slow - dt);
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
    this.onFrame({ view, inputs: this.inputs, slowmo: this.slow > 0 });
  };
}
