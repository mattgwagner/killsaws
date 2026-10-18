// Giant Nut tournament: a seeded 16-robot bracket. Your fights are played;
// everyone else's are simulated with the real physics, champion AI on both sides.
import { useEffect, useMemo, useState } from 'react';
import { BotDesign } from '../sim/design';
import { SeatConfig } from '../game';
import { AILevel, BotAI } from '../sim/ai';
import { Match } from '../sim/match';
import { ROSTER } from '../sim/roster';
import { SettingsState } from './Settings';
import { allBots, botById, loreFor } from './data';

interface Bout { a: string; b: string; winner?: string; method?: string; time?: number; reason?: string }
export interface TournamentState {
  player: string;
  seat: SeatConfig;
  ai: AILevel;
  rounds: Bout[][];
  round: number;
  out: boolean;
  champion?: string;
  pendingResult?: { winner: string; method: string; time: number };
}
const KEY = 'killsaws.tournament.v1';
const ROUND_NAMES = ['Round of 16', 'Quarterfinals', 'Semifinals', 'Giant Nut Final'];

/** Seed by résumé: Giant Nuts, then finals, then everyone else (stable order). */
function seeds(player: string) {
  const score = (id: string) => { const l = loreFor(id); return l ? l.giantNuts.length * 10 + l.runnerUp.length * 4 + l.fights.length * 0.1 : 0; };
  const field = ROSTER.map((b) => b.id).filter((id) => id !== player).sort((x, y) => score(y) - score(x)).slice(0, 15);
  return [player, ...field];
}
// standard 16-seed bracket order: 1v16, 8v9, 5v12, 4v13, 3v14, 6v11, 7v10, 2v15
const ORDER = [[0, 15], [7, 8], [4, 11], [3, 12], [2, 13], [5, 10], [6, 9], [1, 14]];

export function simulateBout(a: BotDesign, b: BotDesign, seed: number, settings: SettingsState): Promise<{ winner: string; method: string; time: number; reason?: string }> {
  return new Promise((resolve) => {
    Match.create([a, b], { seed, hazards: settings.hazards, koCount: settings.koCount, matchSeconds: settings.matchSeconds, humans: [false, false] }).then((m) => {
      const ais = [new BotAI(0, 'champion', seed), new BotAI(1, 'champion', seed + 7)];
      const chunk = () => {
        for (let i = 0; i < 240 * 4 && !m.result; i++) {
          for (let k = 0; k < 2; k++) m.setInput(k, ais[k].think(m, 1 / 240));
          m.step();
          m.drainEvents();
        }
        if (m.result || m.time > 300) {
          const r = m.result ?? m.judges();
          const out = { winner: [a, b][r.winner].id, method: r.method === 'Judges' ? (r.split ? 'Split decision' : 'Unanimous decision') : 'KO', time: r.time, reason: r.koReason };
          m.dispose();
          resolve(out);
        } else setTimeout(chunk, 0);
      };
      chunk();
    });
  });
}

export function Tournament({ state, setState, onBack, onFight, settings }: {
  state: TournamentState | null; setState: (s: TournamentState | null) => void; onBack: () => void;
  onFight: (r: BotDesign, b: BotDesign, seats: [SeatConfig, SeatConfig]) => void; settings: SettingsState;
}) {
  const [busy, setBusy] = useState('');
  const [pick, setPick] = useState('bite-force');
  const [ai, setAi] = useState<AILevel>('veteran');
  const [seat, setSeat] = useState<SeatConfig>({ kind: 'kb1' });
  const bots = useMemo(allBots, []);

  // restore a saved bracket
  useEffect(() => {
    if (state) return;
    try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s) setState(s); } catch { /* none */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { if (state) localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private */ } }, [state]);

  // a played fight came back from the arena
  useEffect(() => {
    if (!state?.pendingResult) return;
    const r = state.pendingResult;
    const rounds = state.rounds.map((rd) => rd.map((b) => ({ ...b })));
    const bout = rounds[state.round].find((b) => b.a === state.player || b.b === state.player)!;
    bout.winner = r.winner; bout.method = r.method === 'Judges' ? 'Decision' : 'KO'; bout.time = r.time;
    setState({ ...state, rounds, out: r.winner !== state.player, pendingResult: undefined });
  }, [state?.pendingResult]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) {
    return (
      <div className="screen">
        <div className="topbar"><button className="btn small" onClick={onBack}>← Back</button><h2>Giant Nut Tournament</h2></div>
        <p className="sub">Sixteen robots, seeded by their championship résumés. Win four fights and the Giant Nut is yours. Every other bout is fought out by the real physics with champion-level AI drivers.</p>
        <div className="opts" style={{ maxWidth: 560 }}>
          <label>Your robot
            <select value={pick} onChange={(e) => setPick(e.target.value)}>{bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </label>
          <label>Your controls
            <select value={seat.kind} onChange={(e) => setSeat({ kind: e.target.value as SeatConfig['kind'] })}>
              <option value="kb1">Keyboard (WASD + Space)</option><option value="kb2">Keyboard (Arrows + /)</option><option value="pad0">Gamepad 1</option>
            </select>
          </label>
          <label>Opponent drivers
            <select value={ai} onChange={(e) => setAi(e.target.value as AILevel)}>
              <option value="rookie">Rookie</option><option value="veteran">Veteran</option><option value="champion">Champion</option>
            </select>
          </label>
          <button className="btn primary" onClick={() => {
            const s = seeds(pick);
            setState({ player: pick, seat, ai, round: 0, out: false, rounds: [ORDER.map(([i, j]) => ({ a: s[i], b: s[j] }))] });
          }}>Draw the bracket</button>
        </div>
      </div>
    );
  }

  const cur = state.rounds[state.round];
  const myBout = cur.find((b) => b.a === state.player || b.b === state.player);
  const roundDone = cur.every((b) => b.winner);
  const name = (id: string) => botById(id)?.name ?? id;

  const simulateRest = async () => {
    const rounds = state.rounds.map((rd) => rd.map((b) => ({ ...b })));
    const todo = rounds[state.round].filter((b) => !b.winner && (state.out || (b.a !== state.player && b.b !== state.player)));
    for (const [i, b] of todo.entries()) {
      setBusy(`Simulating ${name(b.a)} vs ${name(b.b)} (${i + 1}/${todo.length})…`);
      const r = await simulateBout(botById(b.a)!, botById(b.b)!, (state.round + 1) * 1000 + rounds[state.round].indexOf(b), settings);
      Object.assign(b, r);
      setState({ ...state, rounds: rounds.map((rd) => rd.map((x) => ({ ...x }))) });
    }
    setBusy('');
    advance(rounds);
  };

  const advance = (rounds: Bout[][]) => {
    const rd = rounds[state.round];
    if (!rd.every((b) => b.winner)) { setState({ ...state, rounds }); return; }
    if (rd.length === 1) { setState({ ...state, rounds, champion: rd[0].winner }); return; }
    const next: Bout[] = [];
    for (let i = 0; i < rd.length; i += 2) next.push({ a: rd[i].winner!, b: rd[i + 1].winner! });
    setState({ ...state, rounds: [...rounds, next], round: state.round + 1 });
  };

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn small" onClick={onBack}>← Back</button>
        <h2>Giant Nut Tournament</h2>
        <span className="spacer" />
        <button className="btn small" onClick={() => { localStorage.removeItem(KEY); setState(null); }}>New tournament</button>
      </div>
      {state.champion ? (
        <div style={{ textAlign: 'center', margin: '10px 0 20px' }}>
          <div className="nut-big">🔩</div>
          <div className="logo" style={{ fontSize: 64, color: state.champion === state.player ? 'var(--yellow)' : '#fff' }}>{name(state.champion)}</div>
          <div className="tag">{state.champion === state.player ? 'GIANT NUT CHAMPION. YOU DID IT.' : 'WINS THE GIANT NUT'}</div>
        </div>
      ) : (
        <div className="opts" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <b style={{ fontFamily: 'var(--head)', fontSize: 22 }}>{ROUND_NAMES[state.round]}</b>
          {busy ? <span>{busy}</span> : state.out ? (
            <>
              <span>{name(state.player)} is eliminated.</span>
              {!roundDone ? <button className="btn small" onClick={simulateRest}>Simulate the rest of the round</button> : <button className="btn small" onClick={() => advance(state.rounds)}>Next round</button>}
            </>
          ) : myBout && !myBout.winner ? (
            <>
              <span>Your fight: <b>{name(myBout.a)}</b> vs <b>{name(myBout.b)}</b></span>
              <button className="btn small primary" onClick={() => {
                const me = botById(state.player)!;
                const opp = botById(myBout.a === state.player ? myBout.b : myBout.a)!;
                onFight(me, opp, [state.seat, { kind: 'ai', ai: state.ai }]);
              }}>Enter the BattleBox</button>
            </>
          ) : !roundDone ? (
            <button className="btn small primary" onClick={simulateRest}>You won! Simulate the other bouts</button>
          ) : (
            <button className="btn small primary" onClick={() => advance(state.rounds)}>On to the {ROUND_NAMES[state.round + 1]}</button>
          )}
        </div>
      )}
      <div className="bracket">
        {ROUND_NAMES.map((rn, ri) => (
          <div className="round" key={rn}>
            <h5>{rn.toUpperCase()}</h5>
            {(state.rounds[ri] ?? Array.from({ length: 8 >> ri }, () => null)).map((b, i) => (
              <div key={i} className={`bout ${b && ri === state.round && (b.a === state.player || b.b === state.player) && !b.winner ? 'next' : ''}`}>
                {b ? (
                  <>
                    <Side id={b.a} b={b} me={state.player} name={name} />
                    <Side id={b.b} b={b} me={state.player} name={name} />
                    {b.winner && <div style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>{b.method}{b.time !== undefined && b.method === 'KO' ? ` · ${Math.floor(b.time / 60)}:${String(Math.floor(b.time % 60)).padStart(2, '0')}` : ''}</div>}
                  </>
                ) : (<><div>—</div><div>—</div></>)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Side({ id, b, me, name }: { id: string; b: Bout; me: string; name: (id: string) => string }) {
  const cls = b.winner ? (b.winner === id ? 'w' : 'l') : '';
  return <div className={`${cls} ${id === me ? 'me' : ''}`}><span>{name(id)}</span>{b.winner === id && <span>✓</span>}</div>;
}
