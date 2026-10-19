import { FrameInfo, HitCallout, Moment, SeatConfig } from '../game';
import { BotDesign } from '../sim/design';
import { BotView } from '../sim/match';
import { CameraMode } from '../render/scene';
import { KEY_LABELS } from '../input';
import { loreFor, shortStats } from './data';

export function Hud({ frame, designs, callouts, intro, cam, seats, moment }: {
  frame: FrameInfo; designs: BotDesign[]; callouts: HitCallout[]; intro: number; cam: CameraMode; seats: SeatConfig[]; moment: Moment;
}) {
  const v = frame.view;
  const mm = Math.floor(v.clock / 60), ss = Math.floor(v.clock % 60);
  if (intro >= 0 && intro < 2) {
    const d = designs[intro];
    const lore = loreFor(d.id);
    const st = shortStats(d);
    return (
      <div className="intro" key={intro}>
        <div className="corner-lbl" style={{ background: intro === 0 ? 'var(--red)' : 'var(--blue)' }}>{intro === 0 ? 'RED SQUARE' : 'BLUE SQUARE'}</div>
        <div className="bigname">{d.name}</div>
        <div className="facts">
          {d.team}{lore ? ` · ${lore.hometown.split(' (')[0]}` : ''} · {st.lb.toFixed(1)} lb
          {lore?.giantNuts.length ? <div className="trophy">🔩 {lore.giantNuts.length}× Giant Nut champion</div> : null}
          <div className="flag">Enter to skip</div>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="hud-top">
        <Plate color="red" d={designs[0]} b={v.bots[0]} />
        <div className={`clock ${v.clock < 60 && v.phase === 'fight' ? 'hot' : ''}`}>
          {v.phase === 'countdown' ? '3:00' : `${mm}:${ss.toString().padStart(2, '0')}`}
          <small>{v.phase === 'over' ? 'FINAL' : v.hazardsLive ? 'FINAL MINUTE' : 'WORLD CHAMPIONSHIP'}</small>
        </div>
        <Plate color="blue" d={designs[1]} b={v.bots[1]} />
      </div>
      {v.hazardsLive && v.phase === 'fight' && <div className="live">KILLSAWS LIVE</div>}
      <Telemetry color="red" d={designs[0]} b={v.bots[0]} />
      <Telemetry color="blue" d={designs[1]} b={v.bots[1]} />
      {v.phase === 'countdown' && (
        <div className="center-msg">
          <div className="lbl">ROBOTS READY</div>
          <div className="huge" style={{ color: '#ff3a3a' }}>{Math.ceil(v.countdown)}</div>
        </div>
      )}
      {v.phase === 'fight' && v.time < 3.9 && (
        <div className="center-msg"><div className="huge" style={{ color: '#3ee06b' }}>FIGHT!</div></div>
      )}
      {v.ko && v.phase === 'fight' && (
        <div className="center-msg">
          <div className="lbl">{v.ko.silent ? 'SHOW MOVEMENT' : 'COUNT'}: {designs[v.ko.bot].name.toUpperCase()}</div>
          <div className="huge" style={{ color: v.ko.silent ? '#9aa1ab' : '#f2c400' }}>{v.ko.count}</div>
          <div className="lbl" style={{ fontSize: 16, letterSpacing: '0.08em', color: '#fff' }}>{v.ko.reason}</div>
        </div>
      )}
      {v.pin && v.phase === 'fight' && !v.ko && (
        <div className="center-msg" style={{ top: '60%' }}>
          <div className="lbl">PIN · {designs[v.pin.bot].name.toUpperCase()} MUST RELEASE IN {v.pin.count}</div>
        </div>
      )}
      {v.deckCount && v.phase === 'fight' && (
        <div className="center-msg" style={{ top: '60%' }}>
          <div className="lbl">UPPER DECK COUNT · {designs[v.deckCount.bot].name.toUpperCase()} · {v.deckCount.count}</div>
        </div>
      )}
      {v.phase === 'over' && v.result && moment !== 'ko' && moment !== 'replay' && (
        <div className="center-msg">
          <div className="huge" style={{ color: '#f2c400', fontSize: 'clamp(60px, 10vw, 140px)' }}>{v.result.method === 'KO' ? 'KNOCKOUT' : 'TIME!'}</div>
          {v.result.koReason && <div className="lbl" style={{ fontSize: 18, letterSpacing: '0.06em', color: '#fff' }}>{v.result.koReason}</div>}
        </div>
      )}
      {moment === 'ko' && (
        <div className="intro">
          <div className="corner-lbl" style={{ background: 'var(--yellow)', color: '#1a1400' }}>KNOCKOUT</div>
          <div className="bigname">IT'S OVER</div>
        </div>
      )}
      {moment === 'replay' && <div className="replay-badge">REPLAY</div>}
      <div className="callouts">
        {callouts.map((c) => (
          <div key={c.id} className="callout" style={{ color: c.bot === 0 ? '#ff5a63' : '#6aa8ff' }}>
            {c.text || `${c.kj.toFixed(1)} kJ HIT`}
            {c.bite !== undefined && c.kind === 'spinner' && <small>bite {(c.bite * 100).toFixed(0)}%</small>}
          </div>
        ))}
      </div>
      {v.phase !== 'over' && moment !== 'replay' && (
        <div className="hint">
          {seats.map((s, i) => s.kind === 'kb1' || s.kind === 'kb2' ? (
            <span key={i} style={{ marginRight: 14 }}>
              <b style={{ color: i === 0 ? 'var(--red)' : 'var(--blue)' }}>{designs[i].name}</b> {KEY_LABELS[s.kind].drive} · weapon <b>{KEY_LABELS[s.kind].weapon}</b> · alt <b>{KEY_LABELS[s.kind].alt}</b> · Pulverizer <b>{KEY_LABELS[s.kind].hazard}</b>
            </span>
          ) : null)}
          <span>camera <b>C</b> ({cam}) · pause <b>Esc</b></span>
        </div>
      )}
    </>
  );
}

function health(b: BotView) {
  const p = Object.values(b.panels).reduce((s, x) => s + x, 0) / 6;
  const i = b.internals;
  const core = (Math.min(i.battery, i.electronics) * 2 + (i.driveL + i.driveR) / 2 + i.weapon) / 4;
  return Math.max(0, Math.min(1, p * 0.4 + core * 0.6));
}

function Plate({ color, d, b }: { color: 'red' | 'blue'; d: BotDesign; b: BotView }) {
  return (
    <div className={`nameplate ${color}`}>
      <div className="n">{d.name}</div>
      <div className="t">{d.team}</div>
      <div className="bar"><i style={{ width: `${health(b) * 100}%` }} /></div>
      <DamageGlyph b={b} flip={color === 'blue'} />
    </div>
  );
}

/** white (whole) to red (gone) */
const hurt = (h: number) => `hsl(${Math.round(Math.max(0, h) * 8 + 352) % 360}, ${Math.round((1 - Math.max(0, h)) * 85)}%, ${Math.round(100 - (1 - Math.max(0, h)) * 48)}%)`;

/** The robot from above, nose right, each armour face coloured by its health; then drive, weapon and battery. */
function DamageGlyph({ b, flip }: { b: BotView; flip: boolean }) {
  const p = b.panels, i = b.internals;
  const drive = Math.min(i.driveL, i.driveR);
  const sys = (h: number, warn: number) => (h <= 0 ? '#e5232f' : h < warn ? '#f2c400' : '#e8e8e8');
  return (
    <div className={`dmg-glyph${flip ? ' flip' : ''}`} title="armour from above (nose right), drive, weapon, battery">
      <svg viewBox="0 0 44 26" width="57" height="34">
        <rect x="9" y="7" width="26" height="12" fill={hurt(p.top)} />
        <polygon points="3,3 41,3 35,7 9,7" fill={hurt(p.left)} />
        <polygon points="3,23 41,23 35,19 9,19" fill={hurt(p.right)} />
        <polygon points="41,3 41,23 35,19 35,7" fill={hurt(p.front)} />
        <polygon points="3,3 3,23 9,19 9,7" fill={hurt(p.rear)} />
        <rect x="3" y="3" width="38" height="20" fill="none" stroke="#000" strokeOpacity="0.5" />
      </svg>
      <svg viewBox="0 0 54 18" width="70" height="23">
        <g fill="none" stroke={sys(drive, 0.6)} strokeWidth="2.2"><circle cx="9" cy="9" r="6" /><circle cx="9" cy="9" r="1.6" fill={sys(drive, 0.6)} /></g>
        <path d="M27 2 L31 7 L36 9 L31 11 L27 16 L23 11 L18 9 L23 7 Z" fill={sys(i.weapon, 0.5)} />
        <g fill={b.onFire ? '#ff7a1a' : sys(i.battery, 0.7)}><rect x="41" y="4" width="11" height="11" rx="1" /><rect x="44" y="2" width="5" height="2" /></g>
      </svg>
    </div>
  );
}

const cls = (x: number) => (x <= 0 ? 'bad' : x < 0.5 ? 'warn' : '');

function Telemetry({ color, d, b }: { color: 'red' | 'blue'; d: BotDesign; b: BotView }) {
  const spinner = d.weapon.type === 'spinner';
  return (
    <div className={`telemetry ${color}`}>
      <div className="row">
        <span><span className="big">{b.speedMph.toFixed(0)}</span> <span className="k">mph</span></span>
        {spinner ? (
          <span><span className="big">{Math.round(b.rpm).toLocaleString()}</span> <span className="k">rpm</span> <span className="big" style={{ color: b.energyKJ > 5 ? '#f2c400' : undefined }}>{b.energyKJ.toFixed(1)}</span> <span className="k">kJ</span></span>
        ) : b.shots >= 0 ? (
          <span><span className="big">{b.shots}</span> <span className="k">shots left</span></span>
        ) : <span className="k">{d.weapon.type}</span>}
      </div>
      <div className="row">
        <span className="k">pack</span><span>{b.volts.toFixed(1)} V · {Math.max(0, b.amps).toFixed(0)} A · {(b.soc * 100).toFixed(0)}%</span>
      </div>
      <div className="armor" title="armor: front rear left right top bottom">
        {(['front', 'rear', 'left', 'right', 'top', 'bottom'] as const).map((f) => (
          <span key={f} title={`${f} ${(b.panels[f] * 100).toFixed(0)}%`} style={{ background: b.panels[f] > 0.66 ? '#3ee06b' : b.panels[f] > 0.33 ? '#f2c400' : b.panels[f] > 0 ? '#ff7a1a' : '#e5232f', opacity: 0.4 + b.panels[f] * 0.6 }} />
        ))}
      </div>
      <div className="parts">
        <span className={cls(b.internals.driveL)}>DRIVE L</span>
        <span className={cls(b.internals.driveR)}>DRIVE R</span>
        <span className={cls(b.internals.weapon)}>WEAPON</span>
        <span className={b.onFire ? 'bad' : cls(b.internals.battery)}>{b.onFire ? 'FIRE!' : 'BATTERY'}</span>
        <span className={cls(b.internals.electronics)}>RX/ESC</span>
      </div>
      {b.inverted && <div style={{ color: '#f2c400', marginTop: 4 }}>▼ INVERTED{b.canMove ? ' (driving)' : ' (self-right: alt)'}</div>}
    </div>
  );
}
