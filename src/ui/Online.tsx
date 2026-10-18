import { useEffect, useMemo, useState } from 'react';
import { BotDesign } from '../sim/design';
import { GameSession, FrameInfo } from '../game';
import { MatchResult } from '../sim/match';
import { BotSummary, NetGuest, NetHost, makeCode } from '../net/net';
import { allBots, botById } from './data';
import { Dossier } from './Select';

export function Online({ onBack, net, setNet, session, onHostFight, onGuestStart, onGuestFrame, onGuestResult }: {
  onBack: () => void;
  net: { host?: NetHost; guest?: NetGuest } | null;
  setNet: (n: { host?: NetHost; guest?: NetGuest } | null) => void;
  session: GameSession | null;
  onHostFight: (red: BotDesign, blue: BotDesign) => void;
  onGuestStart: (d: [BotDesign, BotDesign]) => void;
  onGuestFrame: (f: FrameInfo) => void;
  onGuestResult: (r: MatchResult, s: BotSummary[]) => void;
}) {
  const bots = useMemo(allBots, []);
  const [pick, setPick] = useState('tombstone');
  const [name, setName] = useState(() => localStorage.getItem('killsaws.name') ?? '');
  const [join, setJoin] = useState(() => new URLSearchParams(location.search).get('join') ?? '');
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const host = net?.host, guest = net?.guest;

  useEffect(() => { try { localStorage.setItem('killsaws.name', name); } catch { /* private */ } }, [name]);
  useEffect(() => {
    if (host) { host.onChange = rerender; host.lobby(botById(pick) ?? null); }
    if (guest) {
      guest.onChange = rerender;
      guest.pick(botById(pick)!, name || 'Guest');
      guest.onStart = (designs) => {
        if (!session) return;
        session.stop();
        guest.play(session.view, session.audio, designs);
        onGuestStart(designs);
      };
      guest.onFrame = onGuestFrame;
      guest.onResult = onGuestResult;
    }
  }, [host, guest, pick, name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // host keeps re-announcing the lobby so a late joiner sees it
    if (!host) return;
    const t = setInterval(() => host.lobby(botById(pick) ?? null), 1500);
    return () => clearInterval(t);
  }, [host, pick]);

  const link = host ? `${location.origin}/?join=${host.code}` : '';
  const mine = botById(pick)!;
  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn small" onClick={onBack}>← Back</button>
        <h2>Fight Online</h2>
      </div>
      {!host && !guest && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, maxWidth: 900 }}>
          <div className="opts">
            <b style={{ fontFamily: 'var(--head)', fontSize: 24 }}>HOST A FIGHT</b>
            <p className="flag">You get a room link to paste in Discord. Your computer runs the physics; your friend drives from theirs.</p>
            <button className="btn primary" onClick={() => { session?.audio.unlock(); setNet({ host: new NetHost(makeCode()) }); }}>Open a room</button>
          </div>
          <div className="opts">
            <b style={{ fontFamily: 'var(--head)', fontSize: 24 }}>JOIN A FIGHT</b>
            <label>Room code <input type="text" value={join} maxLength={5} onChange={(e) => setJoin(e.target.value.toUpperCase())} placeholder="ABCDE" /></label>
            <label>Your name <input type="text" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="Nickname" /></label>
            <button className="btn primary" disabled={join.length !== 5} onClick={() => { session?.audio.unlock(); setNet({ guest: new NetGuest(join) }); }}>Join</button>
          </div>
        </div>
      )}
      {(host || guest) && (
        <div className="select" style={{ gridTemplateColumns: '1fr minmax(320px, 420px)' }}>
          <div className="corner red">
            <header><span>{host ? 'YOUR BOT · RED SQUARE' : 'YOUR BOT · BLUE SQUARE'}</span></header>
            <div className="grid" style={{ maxHeight: '36vh' }}>
              {bots.map((b) => (
                <button key={b.id} className={`card ${b.id === pick ? 'on' : ''}`} onClick={() => setPick(b.id)}>
                  <div className="swatch" style={{ background: `linear-gradient(90deg, ${b.look.primary} 0 60%, ${b.look.accent} 60%)` }} />
                  <b>{b.name}</b>
                </button>
              ))}
            </div>
            <Dossier d={mine} />
          </div>
          <div className="mid">
            <div className="opts">
              <b style={{ fontFamily: 'var(--head)', fontSize: 22 }}>ROOM {host?.code ?? guest?.code}</b>
              {host && (
                <>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 13, wordBreak: 'break-all' }}>{link}</div>
                  <button className="btn small" onClick={() => navigator.clipboard?.writeText(link)}>Copy link for Discord</button>
                </>
              )}
              <div className="flag">{host?.status ?? guest?.status}</div>
              {host && (host.guestDesign
                ? <div>Opponent{host.guestName ? ` (${host.guestName})` : ''} picked <b style={{ color: '#6aa8ff' }}>{host.guestDesign.name}</b></div>
                : <div className="flag">Waiting for them to pick a bot…</div>)}
              {guest && (guest.lobby.host
                ? <div>Host picked <b style={{ color: '#ff6b73' }}>{guest.lobby.host.name}</b>. They start the fight.</div>
                : <div className="flag">Waiting for the host…</div>)}
              {host && <button className="btn primary" disabled={!host.guestDesign} onClick={() => {
                const blue = host.guestDesign!;
                host.start([mine, blue]);
                onHostFight(mine, blue);
              }}>FIGHT!</button>}
              <p className="flag">Both of you drive with W A S D (weapon Space, alt E) or a gamepad. Custom Garage bots work: whatever you pick is sent to the other side.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
