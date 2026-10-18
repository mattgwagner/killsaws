import { useEffect, useState } from 'react';
import { BotDesign } from '../sim/design';
import { MatchResult } from '../sim/match';
import { BotRuntime } from '../sim/bot';

export function Results({ result, designs, bots, from, onRematch, onMenu, onNew, onTournament }: {
  result: MatchResult; designs: BotDesign[]; bots: BotRuntime[]; from: string;
  onRematch: () => void; onMenu: () => void; onNew: () => void; onTournament: () => void;
}) {
  const [shown, setShown] = useState(result.method === 'Judges' ? 0 : 99);
  useEffect(() => {
    if (shown >= (result.cards?.length ?? 0) + 1) return;
    const t = setTimeout(() => setShown((n) => n + 1), 900);
    return () => clearTimeout(t);
  }, [shown, result]);
  const w = designs[result.winner];
  const mm = Math.floor(result.time / 60), ss = Math.floor(result.time % 60);
  const reveal = result.method !== 'Judges' || shown > (result.cards?.length ?? 0);
  const color = (i: number) => (i === 0 ? 'var(--red)' : 'var(--blue)');
  return (
    <div className="results">
      <div className="box">
        {reveal ? (
          <>
            <div className="flag">YOUR WINNER</div>
            <div className="winner" style={{ color: color(result.winner) }}>{w.name}</div>
            <div className="method">
              {result.method === 'KO' ? `BY KNOCKOUT · ${mm}:${ss.toString().padStart(2, '0')}` : `BY ${result.split ? 'SPLIT' : 'UNANIMOUS'} JUDGES' DECISION`}
            </div>
            {result.koReason && <div style={{ marginBottom: 10 }}>{result.koReason}</div>}
          </>
        ) : (
          <>
            <div className="winner" style={{ fontSize: 40 }}>THE JUDGES' DECISION</div>
            <div className="method">THREE JUDGES · DAMAGE 5 · AGGRESSION 3 · CONTROL 3</div>
          </>
        )}
        {result.cards && (
          <table className="cards">
            <thead>
              <tr><th>Judge</th><th>Damage</th><th>Aggression</th><th>Control</th><th>Total</th></tr>
            </thead>
            <tbody>
              {result.cards.slice(0, shown).map((c, j) => {
                const a = c.damage[0] + c.aggression[0] + c.control[0];
                const b = c.damage[1] + c.aggression[1] + c.control[1];
                return (
                  <tr key={j} className="judge">
                    <td>Judge {j + 1}</td>
                    <td><Split a={c.damage[0]} b={c.damage[1]} /></td>
                    <td><Split a={c.aggression[0]} b={c.aggression[1]} /></td>
                    <td><Split a={c.control[0]} b={c.control[1]} /></td>
                    <td><b style={{ color: a > b ? 'var(--red)' : a < b ? 'var(--blue)' : undefined }}><Split a={a} b={b} /></b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {reveal && (
          <table className="cards">
            <thead><tr><th /><th style={{ color: 'var(--red)' }}>{designs[0].name}</th><th style={{ color: 'var(--blue)' }}>{designs[1].name}</th></tr></thead>
            <tbody>
              <tr><td>Damage dealt</td><td>{(bots[0].damageDealt / 1000).toFixed(0)} kJ</td><td>{(bots[1].damageDealt / 1000).toFixed(0)} kJ</td></tr>
              <tr><td>Big hits (25 kJ+)</td><td>{bots[0].bigHits}</td><td>{bots[1].bigHits}</td></tr>
              <tr><td>Hazard damage caused</td><td>{(bots[0].hazardDamageDealt / 1000).toFixed(0)} kJ</td><td>{(bots[1].hazardDamageDealt / 1000).toFixed(0)} kJ</td></tr>
              <tr><td>Aggression time</td><td>{bots[0].aggression.toFixed(0)} s</td><td>{bots[1].aggression.toFixed(0)} s</td></tr>
              <tr><td>Battery used</td><td>{bots[0].whUsed.toFixed(0)} Wh</td><td>{bots[1].whUsed.toFixed(0)} Wh</td></tr>
              <tr><td>Armor left</td><td>{armor(bots[0])}%</td><td>{armor(bots[1])}%</td></tr>
            </tbody>
          </table>
        )}
        <div className="row-btns">
          {from === 'tournament' ? (
            <button className="btn primary" onClick={onTournament}>Back to the bracket</button>
          ) : from === 'online' ? (
            <button className="btn primary" onClick={onMenu}>Done</button>
          ) : (
            <>
              <button className="btn primary" onClick={onRematch}>Rematch</button>
              <button className="btn" onClick={onNew}>New matchup</button>
              <button className="btn" onClick={onMenu}>Menu</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const armor = (b: BotRuntime) => Math.round((Object.values(b.panels).reduce((s, p) => s + p.integrity, 0) / 6) * 100);

function Split({ a, b }: { a: number; b: number }) {
  return <><span style={{ color: '#ff6b73' }}>{a}</span>–<span style={{ color: '#6aa8ff' }}>{b}</span></>;
}
