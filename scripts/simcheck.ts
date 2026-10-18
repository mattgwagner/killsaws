// Headless AI-vs-AI matches: proves the sim runs whole fights without NaNs,
// that matches end by KO or judges, and reports what happened.
import { Match } from '../src/sim/match';
import { BotAI } from '../src/sim/ai';
import { ROSTER, rosterById } from '../src/sim/roster';

const args = process.argv.slice(2);
const n = Number(args[0] ?? 6);
const pairs: [string, string][] = args[1] ? [[args[1], args[2] ?? 'bite-force']] : [];
let fail = 0;
for (let i = 0; i < n; i++) {
  const [a, b] = pairs[0] ?? [ROSTER[(i * 7) % ROSTER.length].id, ROSTER[(i * 11 + 3) % ROSTER.length].id];
  const m = await Match.create([rosterById(a)!, rosterById(b)!], { seed: i + 1, humans: [false, false] });
  const ais = [new BotAI(0, 'champion', i), new BotAI(1, 'champion', i + 100)];
  const t0 = performance.now();
  let hits = 0, big = 0, maxE = 0, bad = false, debris = 0;
  let steps = 0;
  while (!m.result && steps < 240 * 200) {
    for (let k = 0; k < 2; k++) m.setInput(k, ais[k].think(m, 1 / 240));
    m.step();
    steps++;
    for (const e of m.drainEvents()) {
      if (e.type === 'hit' && e.attacker >= 0) { hits++; maxE = Math.max(maxE, e.energy); if (e.energy > 20000) big++; }
      if (e.type === 'debris') debris++;
    }
    const v = m.view();
    for (const bv of v.bots) if (!Number.isFinite(bv.pos.x + bv.pos.y + bv.pos.z)) bad = true;
    if (bad) break;
  }
  const r = m.result;
  const v = m.view();
  const ms = performance.now() - t0;
  const desc = v.bots.map((bv, k) => `${m.bots[k].design.name} armor ${Object.values(bv.panels).map((x) => x.toFixed(1)).join('/')} int ${Object.values(bv.internals).map((x) => x.toFixed(1)).join('/')} dealt ${(m.bots[k].damageDealt / 1000).toFixed(0)}kJ`).join(' | ');
  console.log(`${a} vs ${b}: ${r ? `${m.bots[r.winner].design.name} by ${r.method} at ${r.time.toFixed(0)}s${r.koReason ? ' (' + r.koReason + ')' : ''}${r.totals ? ' ' + r.totals.join('-') : ''}` : 'NO RESULT'}  hits ${hits} big ${big} max ${(maxE / 1000).toFixed(1)}kJ debris ${debris}  ${(ms / 1000).toFixed(1)}s cpu`);
  console.log('   ', desc);
  if (bad || !r) fail++;
  m.dispose();
}
if (fail) { console.error(`${fail} matches failed`); process.exit(1); }
