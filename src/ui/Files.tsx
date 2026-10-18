import { useState } from 'react';
import { ROSTER } from '../sim/roster';
import { Dossier } from './Select';
import { loreFor } from './data';
import rules from '../data/rules.json';

interface Champ { event: string; year: number; champion: string; runnerUp: string; finalResult: string }

export function Files({ onBack }: { onBack: () => void }) {
  const [id, setId] = useState('tombstone');
  const champs = (rules as unknown as { champions: Champ[] }).champions;
  const d = ROSTER.find((b) => b.id === id)!;
  const lore = loreFor(id);
  return (
    <div className="screen">
      <div className="topbar"><button className="btn small" onClick={onBack}>← Back</button><h2>Robot Files</h2></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(340px, 1fr) minmax(300px, 420px)', gap: 16, height: 'calc(100vh - 110px)' }}>
        <div className="corner" style={{ overflow: 'auto' }}>
          {ROSTER.map((b) => (
            <button key={b.id} className={`card ${b.id === id ? 'on' : ''}`} style={{ width: '100%', minHeight: 0 }} onClick={() => setId(b.id)}>
              <b>{b.name}</b><i>{b.team}</i>
            </button>
          ))}
        </div>
        <div className="corner" style={{ overflow: 'auto' }}>
          <Dossier d={d} />
          {lore && (
            <div className="dossier">
              {lore.awards.length > 0 && <><h4 style={{ fontFamily: 'var(--head)', color: 'var(--yellow)', margin: '6px 0' }}>AWARDS</h4>{lore.awards.map((a) => <div key={a}>· {a}</div>)}</>}
              {lore.records.length > 0 && <><h4 style={{ fontFamily: 'var(--head)', color: 'var(--yellow)', margin: '10px 0 6px' }}>RECORDS</h4>{lore.records.map((a) => <div key={a}>· {a}</div>)}</>}
              {lore.armor.length > 0 && <p className="flag">Armor and frame: {lore.armor.join(', ')}</p>}
              {lore.selfRighting && <p className="flag">Self-righting: {lore.selfRighting}</p>}
              {lore.uncertain.length > 0 && <p className="flag">Not confirmed by a primary source: {lore.uncertain.join(', ')}. In-game weapon numbers for these are builder-plausible estimates.</p>}
              {lore.sources.length > 0 && <p className="flag">Sources: {lore.sources.join(' · ')}</p>}
            </div>
          )}
        </div>
        <div className="corner" style={{ overflow: 'auto' }}>
          <header><span>GIANT NUT CHAMPIONS</span></header>
          <table className="cards" style={{ margin: 0 }}>
            <tbody>
              {champs.map((c) => (
                <tr key={c.event}>
                  <td><div style={{ color: 'var(--dim)', fontSize: 12 }}>{c.event} · {c.year}</div><b style={{ color: 'var(--yellow)' }}>🔩 {c.champion}</b><div style={{ fontSize: 12 }}>def. {c.runnerUp}</div><div className="flag" style={{ fontSize: 11 }}>{c.finalResult}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
