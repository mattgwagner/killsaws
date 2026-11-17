// Design Office: a season of design briefs. Build to a spec in the Garage with
// the key numbers hidden, calculate them from the reference card, and let tech
// inspection and the arena check the work. See src/sim/briefs.ts.
import { useCallback, useState } from 'react';
import { BotDesign } from '../sim/design';
import { SeatConfig } from '../game';
import { BRIEFS, Brief, CARD_CONSTANTS, Inspection, QUANTITIES, QuantityId, garageMask, inspect, referenceCard } from '../sim/briefs';
import { ROSTER } from '../sim/roster';
import { Garage } from './Garage';
import { infinityReplacer, infinityReviver, shortStats, weaponLabel } from './data';

const KEY = 'killsaws.office.v1';

type Stage = 'brief' | 'design' | 'spec' | 'inspect' | 'done';
export interface OfficeFightResult { won: boolean; method: string; time: number; reason?: string }
interface BriefRecord {
  stage: Stage;
  design?: BotDesign;
  entries: Partial<Record<QuantityId, string>>;
  inspections: Inspection[];
  revised: boolean;
  result?: OfficeFightResult & { forfeit?: boolean };
}
interface OfficeState { records: Record<string, BriefRecord> }

const fresh = (): BriefRecord => ({ stage: 'brief', entries: {}, inspections: [], revised: false });
function load(): OfficeState {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null', infinityReviver); if (s?.records) return s; } catch { /* none */ }
  return { records: {} };
}
function store(s: OfficeState) {
  try { localStorage.setItem(KEY, JSON.stringify(s, infinityReplacer)); } catch { /* private mode */ }
}
/** The first brief not yet finished; the season is over when there is none. */
const currentBrief = (s: OfficeState) => BRIEFS.find((b) => s.records[b.id]?.stage !== 'done');

/** A fight came back from the arena: write it to the current brief before the office screen mounts, so a reload can't lose it. */
export function recordOfficeFight(result: OfficeFightResult) {
  const s = load();
  const b = currentBrief(s);
  if (!b || s.records[b.id]?.stage !== 'inspect') return;
  store({ ...s, records: { ...s.records, [b.id]: { ...s.records[b.id], stage: 'done', result } } });
}
const opponentOf = (b: Brief) => ROSTER.find((r) => r.id === b.opponent)!;

/** Lines for the result screen: what the design was meant to be and what it was. */
function fightNotes(ins: Inspection): string[] {
  const out: string[] = [];
  for (const e of ins.entries) if (!e.ok) out.push(e.cost ?? `You designed for ${e.designedFor}, you got ${e.got}.`);
  for (const s of ins.specs) if (!s.ok) out.push(`Spec missed: ${s.label}. You got ${s.got}.`);
  if (!out.length) out.push('Every number on your spec sheet was right, and the design met the brief.');
  return out;
}

export function DesignOffice({ onBack, onFight }: {
  onBack: () => void;
  onFight: (red: BotDesign, blue: BotDesign, seats: [SeatConfig, SeatConfig], notes: string[]) => void;
}) {
  const [state, setState] = useState<OfficeState>(load);
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const b = currentBrief(state);
  const rec = b ? state.records[b.id] ?? fresh() : null;
  // saved as it changes, not from an effect: SwiftShader can starve a passive effect past a reload
  const patch = useCallback((id: string, f: (r: BriefRecord) => BriefRecord) => {
    setState((s) => { const n = { ...s, records: { ...s.records, [id]: f(s.records[id] ?? fresh()) } }; store(n); return n; });
  }, []);

  const onDesignChange = useCallback((d: BotDesign) => { if (b) patch(b.id, (r) => ({ ...r, design: d })); }, [b?.id, patch]);

  if (!open || !b || !rec) {
    return <SeasonCard state={state} onBack={onBack} onOpen={() => setOpen(true)} confirmReset={confirmReset} setConfirmReset={setConfirmReset}
      onReset={() => { store({ records: {} }); setState({ records: {} }); setConfirmReset(false); }} />;
  }

  const design = rec.design ?? b.starter();
  const last = rec.inspections[rec.inspections.length - 1];

  if (rec.stage === 'brief') {
    return <BriefScreen b={b} onBack={() => setOpen(false)} onGo={() => patch(b.id, (r) => ({ ...r, stage: 'design', design: r.design ?? b.starter() }))} />;
  }
  if (rec.stage === 'design') {
    return (
      <Garage
        key={`${b.id}-${rec.inspections.length}`}
        onBack={() => patch(b.id, (r) => ({ ...r, stage: r.inspections.length ? 'inspect' : 'brief' }))}
        office={{
          title: `Brief ${b.n}: ${b.title}`,
          initial: design,
          mask: garageMask(b),
          onChange: onDesignChange,
          onDone: (d) => patch(b.id, (r) => ({ ...r, design: d, stage: 'spec' })),
          aside: (d) => (
            <div className="office-aside">
              <BriefStrip b={b} revised={rec.revised} />
              <details>
                <summary>Reference card (live for this design)</summary>
                <RefCard b={b} d={d} />
              </details>
            </div>
          ),
        }}
      />
    );
  }
  if (rec.stage === 'spec') {
    return (
      <SpecSheet b={b} d={design} entries={rec.entries}
        setEntry={(id, v) => patch(b.id, (r) => ({ ...r, entries: { ...r.entries, [id]: v } }))}
        onBack={() => patch(b.id, (r) => ({ ...r, stage: 'design' }))}
        onSubmit={() => patch(b.id, (r) => ({ ...r, stage: 'inspect', inspections: [...r.inspections, inspect(b, design, r.entries)] }))} />
    );
  }
  if (rec.stage === 'inspect' && last) {
    const canRevise = !rec.revised && !last.perfect;
    const fight = (seat: SeatConfig) => onFight(design, opponentOf(b), [seat, { kind: 'ai', ai: b.ai }], fightNotes(last));
    return (
      <InspectionScreen b={b} ins={last} revision={rec.revised}
        onRevise={canRevise ? () => patch(b.id, (r) => ({ ...r, stage: 'design', revised: true })) : undefined}
        onForfeit={() => { patch(b.id, (r) => ({ ...r, stage: 'done', result: { won: false, method: 'Forfeit', time: 0, reason: last.forfeitReason, forfeit: true } })); setOpen(false); }}
        onFightAI={() => fight({ kind: 'ai', ai: b.ai })}
        onFightMe={() => fight({ kind: 'kb1' })} />
    );
  }
  return null;
}

// ---------------- pieces ----------------

function BriefStrip({ b, revised }: { b: Brief; revised: boolean }) {
  return (
    <div className="brief-strip">
      <b>{b.team}</b>
      <span>{b.specs.map((s) => s.label).join(' · ')}</span>
      <span>Calculate: {b.hidden.map((q) => QUANTITIES[q].label.toLowerCase()).join(', ')}</span>
      {revised && <span className="flag">Revision: last chance before the fight</span>}
    </div>
  );
}

function BriefScreen({ b, onBack, onGo }: { b: Brief; onBack: () => void; onGo: () => void }) {
  const opp = opponentOf(b);
  const os = shortStats(opp);
  return (
    <div className="screen office">
      <div className="topbar">
        <button className="btn small" onClick={onBack}>← Season</button>
        <h2>Brief {b.n} of {BRIEFS.length}</h2>
      </div>
      <div className="brief">
        <div className="flag">DESIGN BRIEF · FROM {b.team.toUpperCase()}</div>
        <h3>{b.title}</h3>
        <p className="brief-text">{b.text}</p>
        <h4>Spec</h4>
        <ul className="specs">
          <li>Weight 250.0 lb or less at the weigh-in, or it forfeits</li>
          {b.specs.map((s) => <li key={s.label}>{s.label}</li>)}
        </ul>
        <h4>You calculate</h4>
        <ul className="specs">{b.hidden.map((q) => <li key={q}>{QUANTITIES[q].label}{QUANTITIES[q].unit ? ` (${QUANTITIES[q].unit})` : ''}</li>)}</ul>
        <p className="dim">The Garage shows these as ??. Use the reference card, and a calculator. Tech inspection allows ±3% (weight ±1 lb).</p>
        {b.think && <p className="think">Think about it: {b.think}</p>}
        <h4>Opponent</h4>
        <p><b>{opp.name}</b> · {weaponLabel(opp)} · {os.mph.toFixed(0)} mph{os.kj ? ` · ${os.kj.toFixed(0)} kJ` : ''} · {b.ai} AI driver</p>
        <p className="dim">Math: {b.topic}</p>
        <div className="row-btns">
          <button className="btn primary" onClick={onGo}>Open the garage</button>
        </div>
      </div>
    </div>
  );
}

function RefCard({ b, d }: { b: Brief; d: BotDesign }) {
  const card = referenceCard(b, d);
  return (
    <div className="refcard">
      <p className="dim">Calculator expected. These are the numbers the inspector uses.</p>
      {card.map((s) => (
        <section key={s.id}>
          <h5>{s.title}</h5>
          <ol className="formula">{s.formula.map((f) => <li key={f}>{f}</li>)}</ol>
          {s.inputs.length > 0 && (
            <table className="cardtbl"><tbody>
              {s.inputs.map((i) => <tr key={i.key}><td>{i.label}</td><td>{i.value.toFixed(i.digits)}{i.unit ? ` ${i.unit}` : ''}</td></tr>)}
            </tbody></table>
          )}
        </section>
      ))}
      <section>
        <h5>Constants</h5>
        <table className="cardtbl"><tbody>{CARD_CONSTANTS.map((c) => <tr key={c.label}><td>{c.label}</td><td>{c.value}</td></tr>)}</tbody></table>
      </section>
    </div>
  );
}

function SpecSheet({ b, d, entries, setEntry, onBack, onSubmit }: {
  b: Brief; d: BotDesign; entries: Partial<Record<QuantityId, string>>;
  setEntry: (id: QuantityId, v: string) => void; onBack: () => void; onSubmit: () => void;
}) {
  const filled = b.hidden.every((q) => (entries[q] ?? '').trim() !== '');
  return (
    <div className="screen office">
      <div className="topbar">
        <button className="btn small" onClick={onBack}>← Back to the garage</button>
        <h2>Spec sheet · Brief {b.n}</h2>
      </div>
      <div className="specsheet">
        <div className="col">
          <h4>Your numbers for {d.name}</h4>
          <p className="dim">Write what your calculation says. The inspector checks each one against the robot.</p>
          {b.hidden.map((q) => (
            <label className="entry" key={q}>
              <span>{QUANTITIES[q].label}</span>
              <input type="text" inputMode="decimal" autoComplete="off" value={entries[q] ?? ''}
                placeholder={q === 'runtimeMin' ? 'm:ss' : '0'} onChange={(e) => setEntry(q, e.target.value)} />
              <span className="unit">{q === 'runtimeMin' ? 'min' : QUANTITIES[q].unit}</span>
            </label>
          ))}
          <div className="row-btns">
            <button className="btn primary" disabled={!filled} onClick={onSubmit}>Submit for tech inspection</button>
          </div>
          {!filled && <p className="dim">Fill in every number to submit.</p>}
        </div>
        <div className="col">
          <h4>Reference card</h4>
          <RefCard b={b} d={d} />
        </div>
      </div>
    </div>
  );
}

function InspectionScreen({ b, ins, revision, onRevise, onForfeit, onFightAI, onFightMe }: {
  b: Brief; ins: Inspection; revision: boolean;
  onRevise?: () => void; onForfeit: () => void; onFightAI: () => void; onFightMe: () => void;
}) {
  return (
    <div className="screen office">
      <div className="topbar">
        <h2>Tech inspection · Brief {b.n}</h2>
      </div>
      <div className="inspect">
        {ins.forfeit && <div className="forfeit">FAILS THE WEIGH-IN · {ins.realLb.toFixed(1)} LB · FORFEIT</div>}
        <table className="cards insp">
          <thead><tr><th /><th>You said</th><th>Inspector</th><th /></tr></thead>
          <tbody>
            {ins.entries.map((e) => (
              <tr key={e.id} className={e.ok ? 'ok' : 'miss'}>
                <td>{e.label}</td><td>{e.designedFor}</td><td>{e.got}</td><td>{e.ok ? '✔ within tolerance' : '✖ outside tolerance'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ins.entries.filter((e) => e.cost).map((e) => <p key={e.id} className="cost">✖ {e.label}: {e.cost}</p>)}
        <h4>Brief spec</h4>
        <ul className="specs">
          {ins.specs.map((s) => <li key={s.label} className={s.ok ? 'ok' : 'miss'}>{s.ok ? '✔' : '✖'} {s.label}: {s.got}</li>)}
        </ul>
        {ins.perfect && <p className="nut-line">Exactly right. A nut goes on the season card.</p>}
        <div className="row-btns">
          {onRevise && <button className="btn" onClick={onRevise}>Fix the design (one revision)</button>}
          {ins.forfeit
            ? <button className="btn primary" onClick={onForfeit}>Take the forfeit</button>
            : <>
                <button className="btn primary" onClick={onFightAI}>Fight: AI drives both</button>
                <button className="btn" onClick={onFightMe}>Fight: I drive</button>
              </>}
        </div>
        {!onRevise && !ins.perfect && <p className="dim">{revision ? 'Your revision is used. This design goes to the arena as it is.' : ''}</p>}
        {!ins.forfeit && <p className="dim">With the AI driving both robots at the same skill, the design decides it.</p>}
      </div>
    </div>
  );
}

function SeasonCard({ state, onBack, onOpen, confirmReset, setConfirmReset, onReset }: {
  state: OfficeState; onBack: () => void; onOpen: () => void; confirmReset: boolean; setConfirmReset: (v: boolean) => void; onReset: () => void;
}) {
  const cur = currentBrief(state);
  const recs = BRIEFS.map((b) => state.records[b.id]);
  const done = recs.filter((r) => r?.stage === 'done');
  const wins = done.filter((r) => r!.result?.won).length;
  const forfeits = done.filter((r) => r!.result?.forfeit).length;
  const finals = done.map((r) => r!.inspections[r!.inspections.length - 1]).filter(Boolean);
  const nuts = finals.filter((i) => i.perfect).length;
  const calcs = finals.flatMap((i) => i.entries);
  return (
    <div className="screen office">
      <div className="topbar">
        <button className="btn small" onClick={onBack}>← Back</button>
        <h2>Design Office</h2>
      </div>
      <p className="sub">You're the engineer. Each team sends a brief; you build to it, work out the numbers the Garage won't show you, and the arena checks your math.</p>
      <div className="tally">
        <div className="stat"><b>{wins}–{done.length - wins}</b><span>record{forfeits ? ` · ${forfeits} forfeit${forfeits > 1 ? 's' : ''}` : ''}</span></div>
        <div className="stat"><b>{nuts} / {BRIEFS.length}</b><span>nuts (exactly right)</span></div>
        <div className="stat"><b>{calcs.filter((e) => e.ok).length} / {calcs.length}</b><span>calculations right</span></div>
        <div className="stat"><b>{done.filter((r) => r!.revised).length}</b><span>revisions used</span></div>
      </div>
      <table className="cards season">
        <thead><tr><th>#</th><th>Brief</th><th>Math</th><th>Opponent</th><th>Result</th><th>Nut</th></tr></thead>
        <tbody>
          {BRIEFS.map((b, i) => {
            const r = recs[i];
            const fin = r?.inspections[r.inspections.length - 1];
            const res = r?.stage === 'done' ? r.result : undefined;
            const t = res ? `${Math.floor(res.time / 60)}:${String(Math.floor(res.time % 60)).padStart(2, '0')}` : '';
            return (
              <tr key={b.id} className={cur?.id === b.id ? 'current' : ''}>
                <td>{b.n}</td>
                <td><b>{b.title}</b><br /><span className="dim">{b.team}</span></td>
                <td className="dim">{b.topic}</td>
                <td>{opponentOf(b).name}</td>
                <td>{res ? (res.forfeit ? <span className="miss">Forfeit (weigh-in)</span> : <span className={res.won ? 'ok' : 'miss'}>{res.won ? 'W' : 'L'} · {res.method}{res.method === 'KO' ? ` ${t}` : ''}</span>) : cur?.id === b.id ? (r && r.stage !== 'brief' ? 'In progress' : 'Up next') : '—'}</td>
                <td>{res && fin?.perfect ? <span className="nut" title="Exactly right">⬢</span> : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row-btns">
        {cur
          ? <button className="btn primary" onClick={onOpen}>{state.records[cur.id] && state.records[cur.id].stage !== 'brief' ? `Continue brief ${cur.n}` : `Open brief ${cur.n}`}</button>
          : <p className="nut-line">Season complete: {wins}–{BRIEFS.length - wins}, {nuts} nut{nuts === 1 ? '' : 's'}.</p>}
        {confirmReset
          ? <><span className="dim">Start the season over? Your designs and results are cleared.</span>
              <button className="btn small" onClick={onReset}>Yes, reset</button>
              <button className="btn small" onClick={() => setConfirmReset(false)}>Keep it</button></>
          : <button className="btn small" onClick={() => setConfirmReset(true)}>Reset season</button>}
      </div>
    </div>
  );
}
