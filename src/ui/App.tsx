import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameView, CameraMode } from '../render/scene';
import { GameSession, HitCallout, SeatConfig, FrameInfo } from '../game';
import { Audio } from '../audio/audio';
import { BotDesign } from '../sim/design';
import { MatchResult } from '../sim/match';
import { ROSTER } from '../sim/roster';
import { bindKeys } from '../input';
import { BUILD, botById, loreFor, shortStats } from './data';
import { BotSelect, MatchSetup } from './Select';
import { Hud } from './Hud';
import { Results } from './Results';
import { Garage } from './Garage';
import { Tournament, TournamentState } from './Tournament';
import { Online } from './Online';
import { Files } from './Files';
import { Settings, SettingsState, loadSettings, saveSettings } from './Settings';
import { NetHost, NetGuest, BotSummary, summarize } from '../net/net';

export type Screen = 'title' | 'select' | 'intro' | 'fight' | 'results' | 'garage' | 'tournament' | 'online' | 'files' | 'settings';

export interface FightContext {
  designs: [BotDesign, BotDesign];
  seats: [SeatConfig, SeatConfig];
  from: 'exhibition' | 'tournament' | 'online';
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [screen, setScreen] = useState<Screen>(() => ((new URLSearchParams(location.search).get('join') || new URLSearchParams(location.search).get('host')) ? 'online' : 'title'));
  const [frame, setFrame] = useState<FrameInfo | null>(null);
  const [callouts, setCallouts] = useState<HitCallout[]>([]);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [summary, setSummary] = useState<BotSummary[]>([]);
  const [fight, setFight] = useState<FightContext | null>(null);
  const [introStep, setIntroStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cam, setCam] = useState<CameraMode>('broadcast');
  const [settings, setSettings] = useState<SettingsState>(loadSettings);
  const [tourney, setTourney] = useState<TournamentState | null>(null);
  const [net, setNet] = useState<{ host?: NetHost; guest?: NetGuest } | null>(null);
  const [setup, setSetup] = useState<MatchSetup | null>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const padDown = useRef(false);
  const lastMoment = useRef<FrameInfo['moment']>('live');
  const audioRef = useRef(new Audio());
  const frameTick = useRef(0);

  // boot: renderer + attract-mode fight behind the title
  useEffect(() => {
    bindKeys();
    const canvas = canvasRef.current!;
    const view = new GameView(canvas);
    view.quality = settings.quality;
    const onResize = () => view.resize(window.innerWidth, window.innerHeight);
    onResize();
    window.addEventListener('resize', onResize);
    const session = new GameSession(view, audioRef.current);
    sessionRef.current = session;
    session.onFrame = (f) => {
      const pads = navigator.getGamepads?.() ?? [];
      let down = false;
      for (const p of pads) if (p?.buttons.some((b) => b.pressed)) down = true;
      if (down && !padDown.current && f.moment === 'replay') session.skipClip();
      padDown.current = down;
      const momentChanged = f.moment !== lastMoment.current;
      lastMoment.current = f.moment;
      // throttle React updates to ~20 Hz; the canvas runs at full rate
      if (++frameTick.current % 3 === 0 || f.view.result || momentChanged) setFrame(f);
    };
    session.onCallout = (c) => setCallouts((cs) => [...cs.slice(-3), c]);
    startAttract(session);
    (window as unknown as { killsaws: unknown }).killsaws = { session, view, setScreen, roster: ROSTER };
    return () => { window.removeEventListener('resize', onResize); session.stop(); view.dispose(); };
  }, []);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => { audioRef.current.announcer = settings.announcer; audioRef.current.setVolume(settings.volume); }, [settings]);
  useEffect(() => {
    const v = sessionRef.current?.view;
    if (v) v.quality = settings.quality;
  }, [settings.quality]);

  const attractRef = useRef(false);
  const startAttract = useCallback((session: GameSession) => {
    attractRef.current = true;
    const pool = ROSTER.filter((b) => b.weapon.type === 'spinner' || b.weapon.type === 'flipper');
    const a = pool[Math.floor(Math.random() * pool.length)];
    let b = pool[Math.floor(Math.random() * pool.length)];
    if (b.id === a.id) b = pool[(pool.indexOf(a) + 3) % pool.length];
    session.showcase = false;
    session.start([a, b], [{ kind: 'ai', ai: 'champion' }, { kind: 'ai', ai: 'champion' }], { seed: Math.floor(Math.random() * 1e6), matchSeconds: 180 }).then(() => {
      session.view.setMode('broadcast');
    });
  }, []);

  // when the attract fight ends, start another
  useEffect(() => {
    if (!attractRef.current || !frame?.view.result) return;
    const t = setTimeout(() => sessionRef.current && attractRef.current && startAttract(sessionRef.current), 4000);
    return () => clearTimeout(t);
  }, [frame?.view.result, startAttract]);

  // live fight result
  useEffect(() => {
    if (screen !== 'fight' || !frame?.view.result || result) return;
    const r = frame.view.result;
    if (fight?.from === 'online' && !sessionRef.current?.match) return; // guest: result arrives over the wire
    // Online keeps the old pause-on-the-graphic. A local fight waits out the KO shot and the replay.
    if (fight?.from === 'online') {
      const t = setTimeout(() => { setSummary(summarize(sessionRef.current!)); setResult(r); setScreen('results'); }, r.method === 'KO' ? 2600 : 1800);
      return () => clearTimeout(t);
    }
    if (frame.moment !== 'done') return;
    setSummary(summarize(sessionRef.current!));
    setResult(r);
    setScreen('results');
  }, [frame, screen, result, fight]);

  const beginFight = useCallback(async (ctx: FightContext, opts: { seed?: number } = {}) => {
    const s = sessionRef.current!;
    audioRef.current.unlock();
    attractRef.current = false;
    setResult(null);
    setCallouts([]);
    setFight(ctx);
    setPaused(false);
    s.showcase = ctx.from !== 'online';
    await s.start(ctx.designs, ctx.seats, {
      seed: opts.seed ?? Math.floor(Math.random() * 1e9), hazards: settings.hazards, koCount: settings.koCount, matchSeconds: settings.matchSeconds,
    });
    if (ctx.from === 'online' && net?.host) net.host.attach(s);
    s.hold = true;
    setIntroStep(0);
    setScreen('intro');
  }, [settings, net]);

  useEffect(() => {
    const k = (window as unknown as { killsaws?: { begin?: (ctx: FightContext) => Promise<void> } }).killsaws;
    if (k) k.begin = (ctx) => beginFight(ctx);
  }, [beginFight]);

  // intro: lower-thirds for each corner, then release the sim (3-2-1 is in the sim countdown)
  useEffect(() => {
    if (screen !== 'intro' || !fight) return;
    const s = sessionRef.current!;
    const a = audioRef.current;
    if (introStep < 2) {
      s.view.focus = introStep;
      s.view.setMode('intro');
      const d = fight.designs[introStep];
      const lore = loreFor(d.id);
      const st = shortStats(d);
      if (settings.announcer) {
        speechSynthesis?.cancel();
        a.say(`In the ${introStep === 0 ? 'red' : 'blue'} square... ${lore ? `from ${lore.hometown.split('(')[0].replace(/,?\s*CA\b/, ', California')}... ` : ''}weighing in at ${Math.round(st.lb)} pounds... ${d.name}!`, { rate: 1.0, pitch: 0.75 });
      }
      const t = setTimeout(() => setIntroStep((n) => n + 1), settings.announcer ? 4200 : 2200);
      return () => clearTimeout(t);
    }
    s.view.setMode(cam);
    s.hold = false;
    setScreen('fight');
    if (settings.announcer) a.say('Robots ready? ... Fight!', { rate: 1.05, pitch: 0.8 });
  }, [screen, introStep, fight, settings.announcer, cam]);

  // keys during a fight: C camera, Esc pause, Enter skip intro
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = sessionRef.current;
      if (!s) return;
      if (screen === 'intro' && (e.code === 'Enter' || e.code === 'Escape')) { setIntroStep(2); return; }
      if (screen === 'fight' && e.code === 'Enter' && s.moment === 'replay') { s.skipClip(); return; }
      if (screen !== 'fight') return;
      if (e.code === 'KeyC') {
        const order: CameraMode[] = ['broadcast', 'chase', 'overhead', 'free'];
        const next = order[(order.indexOf(cam) + 1) % order.length];
        setCam(next); s.view.setMode(next);
      }
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (fight?.from === 'online') return;
        s.paused = !s.paused; setPaused(s.paused);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, cam, fight]);

  const toMenu = useCallback(() => {
    net?.host?.close(); net?.guest?.close(); setNet(null);
    setScreen('title');
    setResult(null);
    setPaused(false);
    if (sessionRef.current) { sessionRef.current.paused = false; startAttract(sessionRef.current); }
  }, [startAttract, net]);

  const callTimeout = useMemo(() => callouts.filter((c) => performance.now() - c.at < 1700), [callouts, frame]);

  const goExhibition = () => { audioRef.current.unlock(); setScreen('select'); };

  return (
    <>
      <canvas ref={canvasRef} className="game" />
      {screen === 'title' && (
        <div className="layer title">
          <h1 className="logo">KILL<span>SAWS</span></h1>
          <div className="tag">Robot combat simulator · 250 lb heavyweights · the BattleBox</div>
          <nav className="menu">
            <button onClick={goExhibition} autoFocus>Exhibition<small>Pick two robots. You vs a friend on one keyboard, or vs the AI.</small></button>
            <button onClick={() => { audioRef.current.unlock(); setScreen('tournament'); }}>Giant Nut Tournament<small>16-robot bracket. Win four fights, lift the nut.</small></button>
            <button onClick={() => setScreen('garage')}>Garage<small>Build your own 250 lb bot from real parts.</small></button>
            <button onClick={() => { audioRef.current.unlock(); setScreen('online'); }}>Fight Online<small>Send a room code to a friend on Discord.</small></button>
            <button onClick={() => setScreen('files')}>Robot Files<small>Teams, records, famous fights.</small></button>
            <button onClick={() => setScreen('settings')}>Settings &amp; Controls</button>
          </nav>
          <div className="foot">build {BUILD} · physics: Rapier · all {ROSTER.length} roster bots weigh in under 250.0 lb</div>
        </div>
      )}
      {screen === 'select' && (
        <BotSelect
          initial={setup}
          onBack={() => setScreen('title')}
          onFight={(m) => {
            setSetup(m);
            beginFight({ designs: [m.red, m.blue], seats: [m.redSeat, m.blueSeat], from: 'exhibition' });
          }}
        />
      )}
      {(screen === 'intro' || screen === 'fight' || screen === 'results') && frame && fight && (
        <Hud frame={frame} designs={fight.designs} callouts={callTimeout} intro={screen === 'intro' ? introStep : -1} cam={cam} seats={fight.seats} moment={frame.moment} />
      )}
      {paused && screen === 'fight' && (
        <div className="pausemenu">
          <nav className="menu">
            <h2 style={{ fontFamily: 'var(--head)', margin: 0 }}>PAUSED</h2>
            <button onClick={() => { sessionRef.current!.paused = false; setPaused(false); }}>Resume</button>
            <button onClick={() => fight && beginFight(fight)}>Restart fight</button>
            <button onClick={toMenu}>Quit to menu</button>
          </nav>
        </div>
      )}
      {screen === 'results' && result && fight && (
        <Results
          result={result}
          designs={fight.designs}
          stats={summary}
          from={fight.from}
          onRematch={() => beginFight(fight)}
          onMenu={toMenu}
          onNew={() => setScreen('select')}
          onReveal={() => { if (result.method === 'Judges') sessionRef.current?.view.victoryPyro(); }}
          onTournament={() => {
            if (tourney) setTourney({ ...tourney, pendingResult: { winner: fight.designs[result.winner].id, method: result.method, time: result.time } });
            setScreen('tournament');
          }}
        />
      )}
      {screen === 'garage' && <Garage onBack={() => setScreen('title')} onTest={(d) => beginFight({ designs: [d, ROSTER[Math.floor(Math.random() * ROSTER.length)]], seats: [{ kind: 'kb1' }, { kind: 'ai', ai: 'rookie' }], from: 'exhibition' })} />}
      {screen === 'tournament' && (
        <Tournament
          state={tourney}
          setState={setTourney}
          onBack={() => setScreen('title')}
          onFight={(red, blue, seats) => beginFight({ designs: [red, blue], seats, from: 'tournament' })}
          settings={settings}
        />
      )}
      {screen === 'online' && (
        <Online
          onBack={toMenu}
          net={net}
          setNet={setNet}
          session={sessionRef.current}
          onHostFight={(red, blue) => beginFight({ designs: [red, blue], seats: [{ kind: 'kb1' }, { kind: 'net' }], from: 'online' })}
          onGuestStart={(designs) => {
            attractRef.current = false;
            audioRef.current.unlock();
            setFight({ designs, seats: [{ kind: 'net' }, { kind: 'kb1' }], from: 'online' });
            setResult(null);
            setScreen('fight');
          }}
          onGuestFrame={(f) => { if (++frameTick.current % 3 === 0) setFrame(f); }}
          onGuestResult={(r, s) => { setTimeout(() => { setSummary(s); setResult(r); setScreen('results'); }, 2200); }}
        />
      )}
      {screen === 'files' && <Files onBack={() => setScreen('title')} />}
      {screen === 'settings' && <Settings value={settings} onChange={setSettings} onBack={() => setScreen('title')} />}
      {frame?.slowmo && screen === 'fight' && <div className="slowmo" />}
    </>
  );
}

export { botById };
