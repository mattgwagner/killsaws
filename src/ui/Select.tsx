import { useMemo, useState } from 'react';
import { BotDesign } from '../sim/design';
import { SeatConfig } from '../game';
import { padCount } from '../input';
import { allBots, loreFor, shortStats, weaponLabel } from './data';

export interface MatchSetup { red: BotDesign; blue: BotDesign; redSeat: SeatConfig; blueSeat: SeatConfig }

const SEATS: { label: string; seat: SeatConfig }[] = [
  { label: 'Keyboard (WASD + Space)', seat: { kind: 'kb1' } },
  { label: 'Keyboard (Arrows + /)', seat: { kind: 'kb2' } },
  { label: 'Gamepad 1', seat: { kind: 'pad0' } },
  { label: 'Gamepad 2', seat: { kind: 'pad1' } },
  { label: 'AI: Rookie', seat: { kind: 'ai', ai: 'rookie' } },
  { label: 'AI: Veteran', seat: { kind: 'ai', ai: 'veteran' } },
  { label: 'AI: Champion', seat: { kind: 'ai', ai: 'champion' } },
];
const seatKey = (s: SeatConfig) => s.kind + (s.ai ?? '');

export function BotSelect({ initial, onBack, onFight }: { initial: MatchSetup | null; onBack: () => void; onFight: (m: MatchSetup) => void }) {
  const bots = useMemo(allBots, []);
  const [red, setRed] = useState(initial?.red.id ?? 'tombstone');
  const [blue, setBlue] = useState(initial?.blue.id ?? 'bite-force');
  const [redSeat, setRedSeat] = useState<SeatConfig>(initial?.redSeat ?? { kind: 'kb1' });
  const [blueSeat, setBlueSeat] = useState<SeatConfig>(initial?.blueSeat ?? { kind: 'ai', ai: 'veteran' });
  const pads = padCount();
  const R = bots.find((b) => b.id === red) ?? bots[0];
  const B = bots.find((b) => b.id === blue) ?? bots[1];
  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn small" onClick={onBack}>← Back</button>
        <h2>Exhibition</h2>
        <span className="spacer" />
        <span className="sub" style={{ margin: 0 }}>{pads ? `${pads} gamepad${pads > 1 ? 's' : ''} connected` : 'Gamepads: press a button to connect'}</span>
      </div>
      <div className="select">
        <Corner color="red" bots={bots} pick={red} setPick={setRed} seat={redSeat} setSeat={setRedSeat} design={R} />
        <div className="mid">
          <div className="vs">VS</div>
          <button className="btn primary" style={{ fontSize: 30 }} onClick={() => onFight({ red: R, blue: B, redSeat, blueSeat })}>FIGHT!</button>
          <div className="opts">
            <b style={{ fontFamily: 'var(--head)', letterSpacing: '0.1em' }}>TALE OF THE TAPE</b>
            <Tape a={R} b={B} />
          </div>
          <div className="opts flag">
            Same keyboard: Red drives with W A S D (weapon Space), Blue with the arrow keys (weapon /). Press <b>C</b> in the fight to change cameras.
          </div>
        </div>
        <Corner color="blue" bots={bots} pick={blue} setPick={setBlue} seat={blueSeat} setSeat={setBlueSeat} design={B} />
      </div>
    </div>
  );
}

function Corner({ color, bots, pick, setPick, seat, setSeat, design }: {
  color: 'red' | 'blue'; bots: BotDesign[]; pick: string; setPick: (id: string) => void; seat: SeatConfig; setSeat: (s: SeatConfig) => void; design: BotDesign;
}) {
  return (
    <div className={`corner ${color}`}>
      <header>
        <span>{color === 'red' ? 'RED SQUARE' : 'BLUE SQUARE'}</span>
        <select value={seatKey(seat)} onChange={(e) => setSeat(SEATS.find((s) => seatKey(s.seat) === e.target.value)!.seat)}>
          {SEATS.map((s) => <option key={seatKey(s.seat)} value={seatKey(s.seat)}>{s.label}</option>)}
        </select>
      </header>
      <div className="grid" style={{ maxHeight: '38vh' }}>
        {bots.map((b) => {
          const lore = loreFor(b.id);
          return (
            <button key={b.id} className={`card ${b.id === pick ? 'on' : ''}`} onClick={() => setPick(b.id)}>
              <div className="swatch" style={{ background: `linear-gradient(90deg, ${b.look.primary} 0 60%, ${b.look.accent} 60%)` }} />
              <b>{b.name}</b>
              <i>{weaponLabel(b)}</i>
              {lore?.giantNuts.length ? <span className="nut" title="Giant Nut wins">{'🔩'.repeat(lore.giantNuts.length)}</span> : null}
              {!lore && <span className="nut">CUSTOM</span>}
            </button>
          );
        })}
      </div>
      <Dossier d={design} />
    </div>
  );
}

export function Dossier({ d }: { d: BotDesign }) {
  const lore = loreFor(d.id);
  const s = shortStats(d);
  return (
    <div className="dossier">
      <h3 style={{ color: d.look.accent === '#ffffff' ? d.look.primary : d.look.accent }}>{d.name}</h3>
      <div className="who">{d.team}{lore ? ` · ${lore.hometown.split(' (')[0]}` : ''}{lore?.captain ? ` · captain ${lore.captain}` : ''}</div>
      {lore?.giantNuts.map((g) => <div key={g} className="trophy">🔩 Giant Nut: {g}</div>)}
      {lore?.runnerUp.map((g) => <div key={g} className="flag">Runner-up: {g}</div>)}
      <div className="stats">
        <Stat v={`${s.lb.toFixed(1)} lb`} k="weight" />
        <Stat v={`${s.mph.toFixed(0)} mph`} k="top speed" />
        <Stat v={s.inv ? 'yes' : 'no'} k="invertible" />
        {s.kj !== undefined && <Stat v={`${s.kj.toFixed(1)} kJ`} k="stored energy" />}
        {s.tip !== undefined && <Stat v={`${s.tip.toFixed(0)} mph`} k="tip speed" />}
        {s.rpm !== undefined && <Stat v={`${Math.round(s.rpm).toLocaleString()}`} k="weapon rpm" />}
        {s.spin !== undefined && <Stat v={`${s.spin.toFixed(1)} s`} k="spin-up" />}
        {d.weapon.type === 'flipper' && <Stat v={`${(d.weapon.energy / 1000).toFixed(1)} kJ`} k="per flip" />}
        {d.weapon.type === 'flipper' && <Stat v={Number.isFinite(d.weapon.shots) ? String(d.weapon.shots) : '∞'} k="shots" />}
        {d.weapon.type === 'hammer' && <Stat v={`${(d.weapon.energy / 1000).toFixed(1)} kJ`} k="per swing" />}
        {d.weapon.type === 'crusher' && <Stat v={`${Math.round(d.weapon.force / 4.448).toLocaleString()} lbf`} k="tip force" />}
        <Stat v={`${d.battery.cellsS}S`} k="LiPo" />
      </div>
      <div style={{ fontSize: 14 }}>{lore?.weapon ?? weaponLabel(d)}</div>
      {lore && lore.fights.length > 0 && (
        <>
          <h4 style={{ fontFamily: 'var(--head)', color: 'var(--yellow)', margin: '10px 0 4px', letterSpacing: '0.08em' }}>FAMOUS FIGHTS</h4>
          {lore.fights.map((f) => (
            <div key={f.opponent + f.season} className="fight">
              <div><b>vs {f.opponent}</b> <span className="flag">{f.season}</span></div>
              <div style={{ fontSize: 14 }}>{f.summary}</div>
              <div className="res">{f.result}</div>
            </div>
          ))}
        </>
      )}
      {lore?.trivia && <p className="flag">💡 {lore.trivia}</p>}
    </div>
  );
}

function Stat({ v, k }: { v: string; k: string }) {
  return <div className="stat"><b>{v}</b><span>{k}</span></div>;
}

function Tape({ a, b }: { a: BotDesign; b: BotDesign }) {
  const A = shortStats(a), B = shortStats(b);
  const rows: [string, string, string][] = [
    ['Weight', `${A.lb.toFixed(1)} lb`, `${B.lb.toFixed(1)} lb`],
    ['Top speed', `${A.mph.toFixed(0)} mph`, `${B.mph.toFixed(0)} mph`],
    ['Weapon', weaponLabel(a), weaponLabel(b)],
    ['Energy', A.kj ? `${A.kj.toFixed(0)} kJ` : '—', B.kj ? `${B.kj.toFixed(0)} kJ` : '—'],
    ['Invertible', A.inv ? 'yes' : 'no', B.inv ? 'yes' : 'no'],
  ];
  return (
    <table className="cards" style={{ margin: 0 }}>
      <tbody>
        {rows.map(([k, x, y]) => (
          <tr key={k}><td style={{ color: 'var(--red)', textAlign: 'right' }}>{x}</td><td style={{ color: 'var(--dim)', textAlign: 'center' }}>{k}</td><td style={{ color: '#6aa8ff', textAlign: 'left' }}>{y}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
