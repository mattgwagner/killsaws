// All sound is synthesized with WebAudio: brushless whine, the blade-pass
// "whum" of a spinner (rotor rpm × teeth), Icewave's two-stroke, metal
// impacts with inharmonic ringing, pneumatic hiss, the crowd, and the
// announcer through speech synthesis.
import { MatchView } from '../sim/match';
import { BotDesign } from '../sim/design';
import { BotRuntime } from '../sim/bot';
import { SimEvent } from '../sim/combat';

interface BotVoice {
  whine: OscillatorNode; whineGain: GainNode;
  drive: OscillatorNode; driveGain: GainNode; driveFilter: BiquadFilterNode;
  blade: OscillatorNode; bladeGain: GainNode; bladeFilter: BiquadFilterNode;
  hum: GainNode;
  engine: boolean;
}

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private crowd!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private voices: BotVoice[] = [];
  private excitement = 0.2;
  muted = false;
  announcer = true;
  volume = 0.8;
  /** Replay plays hit events only; the live weapon whine stays down. */
  replay = false;
  private fullCrowd = false;
  private lastCount = -1;
  private lastLight = -1;
  private lastDeck = -1;
  private designs: BotDesign[] = [];

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    // white noise buffer
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // crowd bed
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'bandpass'; this.crowdFilter.frequency.value = 900; this.crowdFilter.Q.value = 0.6;
    this.crowd = ctx.createGain();
    this.crowd.gain.value = 0.0;
    src.connect(this.crowdFilter).connect(this.crowd).connect(this.master);
    src.start();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }
  setMuted(m: boolean) { this.muted = m; this.setVolume(this.volume); }

  startMatch(designs: BotDesign[]) {
    this.designs = designs;
    this.lastCount = -1;
    this.lastLight = -1;
    this.replay = false;
    this.fullCrowd = false;
    const ctx = this.ctx;
    if (!ctx) return;
    this.stopMatch();
    this.voices = designs.map((d) => {
      const whine = ctx.createOscillator(); whine.type = 'sawtooth';
      const whineGain = ctx.createGain(); whineGain.gain.value = 0;
      const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.Q.value = 3; wf.frequency.value = 2000;
      whine.connect(wf).connect(whineGain).connect(this.sfx);
      const drive = ctx.createOscillator(); drive.type = 'square';
      const driveFilter = ctx.createBiquadFilter(); driveFilter.type = 'lowpass'; driveFilter.frequency.value = 1400;
      const driveGain = ctx.createGain(); driveGain.gain.value = 0;
      drive.connect(driveFilter).connect(driveGain).connect(this.sfx);
      const blade = ctx.createOscillator(); blade.type = d.weapon.type === 'spinner' && d.weapon.motor === 'ice-engine' ? 'sawtooth' : 'triangle';
      const bladeFilter = ctx.createBiquadFilter(); bladeFilter.type = 'lowpass'; bladeFilter.frequency.value = 400;
      const bladeGain = ctx.createGain(); bladeGain.gain.value = 0;
      blade.connect(bladeFilter).connect(bladeGain).connect(this.sfx);
      // whoosh: noise amplitude-modulated by the blade
      const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.8;
      const hum = ctx.createGain(); hum.gain.value = 0;
      n.connect(nf).connect(hum).connect(this.sfx);
      n.start();
      whine.start(); drive.start(); blade.start();
      return { whine, whineGain, drive, driveGain, driveFilter, blade, bladeGain, bladeFilter, hum, engine: d.weapon.type === 'spinner' && d.weapon.motor === 'ice-engine' };
    });
    this.crowd?.gain.setTargetAtTime(0.06, ctx.currentTime, 0.5);
  }

  stopMatch() {
    for (const v of this.voices) {
      try { v.whine.stop(); v.drive.stop(); v.blade.stop(); } catch { /* already stopped */ }
      v.hum.disconnect();
    }
    this.voices = [];
    if (this.ctx && this.crowd) this.crowd.gain.setTargetAtTime(0.02, this.ctx.currentTime, 0.4);
    speechSynthesis?.cancel();
  }

  update(view: MatchView, bots: BotRuntime[], dt: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (this.replay) {
      for (const v of this.voices) {
        v.whineGain.gain.setTargetAtTime(0, t, 0.04);
        v.driveGain.gain.setTargetAtTime(0, t, 0.04);
        v.bladeGain.gain.setTargetAtTime(0, t, 0.04);
        v.hum.gain.setTargetAtTime(0, t, 0.04);
      }
    }
    view.bots.forEach((bv, i) => {
      if (this.replay) return;
      const v = this.voices[i];
      const b = bots[i];
      if (!v || !b) return;
      const d = b.design;
      // weapon
      const rpm = bv.rpm;
      if (d.weapon.type === 'spinner') {
        const teeth = Math.max(1, d.weapon.teeth);
        const pass = (rpm / 60) * teeth;
        v.blade.frequency.setTargetAtTime(Math.max(20, v.engine ? (rpm * d.weapon.ratio) / 60 : pass), t, 0.03);
        v.bladeFilter.frequency.setTargetAtTime(200 + pass * 4, t, 0.05);
        const loud = Math.min(1, rpm / Math.max(1, b.stats.weapon?.maxRpm ?? 1));
        v.bladeGain.gain.setTargetAtTime((v.engine ? 0.09 : 0.06) * loud, t, 0.05);
        v.hum.gain.setTargetAtTime(0.08 * loud * loud, t, 0.05);
        const motorHz = v.engine ? 0 : (rpm * d.weapon.ratio * 7) / 60 / 8; // electrical whine (pole pairs), folded down an octave
        v.whine.frequency.setTargetAtTime(Math.max(30, Math.min(6000, motorHz)), t, 0.03);
        v.whineGain.gain.setTargetAtTime(v.engine ? 0 : Math.min(0.05, b.spinner!.current / 6000) + 0.012 * loud, t, 0.04);
      }
      // drive
      const wheel = b.wheels.find((w) => w.attached);
      const wOm = wheel ? Math.abs(wheel.omega) * d.drive.ratio : 0;
      v.drive.frequency.setTargetAtTime(Math.max(25, Math.min(1200, (wOm * 7) / (2 * Math.PI) / 6)), t, 0.03);
      v.driveGain.gain.setTargetAtTime(Math.min(0.035, Math.abs(b.ampsDrive) / 4000), t, 0.04);
    });
    // crowd: excitement decays, swells with hits. A KO pins it at full.
    if (this.fullCrowd) this.excitement = 1;
    else this.excitement = Math.max(0.15, this.excitement - dt * 0.12);
    this.crowd?.gain.setTargetAtTime(this.fullCrowd ? 0.2 : 0.03 + this.excitement * 0.12, t, this.fullCrowd ? 0.15 : 0.3);
    this.crowdFilter?.frequency.setTargetAtTime(700 + this.excitement * 900, t, 0.3);

    // start lights: a beep per second, high tone on green
    if (view.phase === 'countdown') {
      const n = Math.ceil(view.countdown);
      if (n !== this.lastLight && n > 0) { this.lastLight = n; this.countdownBeep(n); }
    } else if (this.lastLight > 0 && view.phase === 'fight') { this.lastLight = 0; this.countdownBeep(0); }

    // referee count, called aloud for the last ten
    if (view.ko && !view.ko.silent && view.ko.count !== this.lastCount && view.phase === 'fight') {
      this.lastCount = view.ko.count;
      if (view.ko.count > 0) this.say(String(view.ko.count), { rate: 1.1, pitch: 0.9 });
      this.beep(660, 0.12, 0.1);
    }
    if (!view.ko) this.lastCount = -1;
    if (view.deckCount && view.deckCount.count !== this.lastDeck) { this.lastDeck = view.deckCount.count; this.beep(880, 0.08, 0.08); }
  }

  events(evs: SimEvent[], view: MatchView) {
    if (!this.ctx) return;
    for (const e of evs) {
      if (e.type === 'hit') {
        const kj = e.energy / 1000;
        if (e.kind === 'saw') { this.grind(0.05, 3200); continue; }
        if (e.kind === 'crush') { this.grind(0.12, 500); continue; }
        if (e.kind === 'hazard' && e.energy < 1000) { this.grind(0.06, 1500); continue; }
        if (kj < 0.3) continue;
        this.impact(kj, e.material ?? 'ar500');
        this.excitement = Math.min(1, this.excitement + kj * 0.02);
      } else if (e.type === 'actuate') {
        if (e.kind === 'flip' || e.kind === 'self-right') this.hiss(0.35);
        if (e.kind === 'hammer') this.impact(e.bot === -1 ? 12 : 4, 'ar500');
      } else if (e.type === 'phase') {
        this.horn();
        this.excitement = 0.7;
      } else if (e.type === 'hazards-live') {
        this.siren();
        this.say('Hazards are live!', { rate: 1.05 });
      } else if (e.type === 'break' && e.part === 'wheel') {
        this.excitement = 1;
      } else if (e.type === 'fire') {
        this.excitement = Math.min(1, this.excitement + 0.3);
      } else if (e.type === 'over') {
        this.horn(1.4);
        this.excitement = 1;
        const r = e.result;
        const w = this.designs[r.winner]?.name ?? 'the winner';
        if (this.announcer) {
          setTimeout(() => {
            if (r.method === 'KO') this.say(`Your winner, by knockout... ${w}!`, { rate: 0.95, pitch: 0.8 });
            else this.say(`The judges have made their decision. By ${r.split ? 'split' : 'unanimous'} decision, your winner... ${w}!`, { rate: 0.98, pitch: 0.8 });
          }, 1400);
        }
      } else if (e.type === 'ko-start') {
        this.excitement = Math.min(1, this.excitement + 0.4);
      }
    }
    void view;
  }

  // --- primitives ---
  private env(g: GainNode, peak: number, attack: number, decay: number) {
    const t = this.ctx!.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  impact(kj: number, material: string) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const big = Math.min(1, kj / 40);
    // crack: filtered noise burst
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = material === 'uhmw' ? 600 : 2400 - big * 1200; f.Q.value = 0.7;
    const g = ctx.createGain();
    n.connect(f).connect(g).connect(this.sfx);
    this.env(g, 0.25 + big * 0.7, 0.002, 0.08 + big * 0.35);
    n.start(t, Math.random()); n.stop(t + 0.6);
    // thump
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120 - big * 60, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const og = ctx.createGain();
    o.connect(og).connect(this.sfx);
    this.env(og, 0.3 + big * 0.8, 0.003, 0.25 + big * 0.3);
    o.start(t); o.stop(t + 0.8);
    // metallic ring: inharmonic partials (plate modes)
    if (material !== 'uhmw' && material !== 'polycarb') {
      const base = material === 'titanium' ? 520 : 330;
      for (const r of [1, 2.32, 4.25, 6.63]) {
        const p = ctx.createOscillator(); p.type = 'sine';
        p.frequency.value = base * r * (0.9 + Math.random() * 0.2);
        const pg = ctx.createGain();
        p.connect(pg).connect(this.sfx);
        this.env(pg, (0.05 + big * 0.1) / r, 0.002, 0.3 + big * 0.9);
        p.start(t); p.stop(t + 1.5);
      }
    }
  }

  grind(dur: number, freq: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 2;
    const g = ctx.createGain();
    n.connect(f).connect(g).connect(this.sfx);
    this.env(g, 0.12, 0.005, dur);
    n.start(t, Math.random()); n.stop(t + dur + 0.1);
  }

  hiss(dur: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
    const g = ctx.createGain();
    n.connect(f).connect(g).connect(this.sfx);
    this.env(g, 0.35, 0.005, dur);
    n.start(t, Math.random()); n.stop(t + dur + 0.1);
    this.impact(3, 'ar500');
  }

  beep(freq: number, dur: number, vol = 0.15) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const g = ctx.createGain();
    o.connect(g).connect(this.sfx);
    g.gain.setValueAtTime(vol, t); g.gain.setValueAtTime(0, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  }

  horn(len = 0.9) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const fq of [233, 277, 349]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fq;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      const g = ctx.createGain();
      o.connect(f).connect(g).connect(this.sfx);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.03);
      g.gain.setValueAtTime(0.09, t + len); g.gain.linearRampToValueAtTime(0, t + len + 0.15);
      o.start(t); o.stop(t + len + 0.2);
    }
  }

  siren() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(500, t);
    for (let i = 0; i < 4; i++) { o.frequency.linearRampToValueAtTime(900, t + i * 0.5 + 0.25); o.frequency.linearRampToValueAtTime(500, t + i * 0.5 + 0.5); }
    const g = ctx.createGain(); g.gain.value = 0.05;
    o.connect(g).connect(this.sfx);
    o.start(t); o.stop(t + 2);
  }

  countdownBeep(n: number) {
    this.beep(n === 0 ? 1320 : 660, n === 0 ? 0.4 : 0.15, 0.12);
  }

  /** The KO: the room comes up and stays there through the shot. */
  crowdFull() {
    this.fullCrowd = true;
    this.excitement = 1;
  }

  say(text: string, o: { rate?: number; pitch?: number } = {}) {
    if (!this.announcer || this.muted || typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = o.rate ?? 1;
    u.pitch = o.pitch ?? 0.85;
    u.volume = Math.min(1, this.volume + 0.2);
    const voices = speechSynthesis.getVoices();
    const pick = voices.find((v) => /Daniel|Alex|Fred|Google UK English Male|Microsoft Guy|Aaron/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith('en'));
    if (pick) u.voice = pick;
    speechSynthesis.speak(u);
  }
}
