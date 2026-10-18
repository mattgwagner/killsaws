// The 20-fight seeded baseline from tests/sim.test.ts, printing each result.
import { Match } from '../src/sim/match';
import { BotAI } from '../src/sim/ai';
import { ROSTER } from '../src/sim/roster';
for (let i = 0; i < 20; i++) {
  const a = ROSTER[(i * 7) % ROSTER.length], b = ROSTER[(i * 11 + 3) % ROSTER.length];
  const m = await Match.create([a, b], { seed: i + 1, humans: [false, false] });
  const ais = [new BotAI(0, 'champion', i), new BotAI(1, 'champion', i + 100)];
  let steps = 0;
  while (!m.result && steps < 240 * 200) { for (let k = 0; k < 2; k++) m.setInput(k, ais[k].think(m, 1 / 240)); m.step(); m.drainEvents(); steps++; }
  const r = m.result!;
  const v = m.bots[1 - r.winner];
  console.log(i, `${a.name} vs ${b.name}:`, m.bots[r.winner].design.name, r.method, r.time.toFixed(0), r.koReason ?? '', r.koReason?.includes('beached') ? `<< pos ${v.pos.x.toFixed(2)},${v.pos.y.toFixed(3)},${v.pos.z.toFixed(2)} up ${v.up.y.toFixed(2)} fwd.y ${v.forward.y.toFixed(2)} wheels ${v.wheels.map((w) => (w.attached ? (w.contact ? 'C' : 'a') : 'X')).join('')}` : '');
  m.dispose();
}
