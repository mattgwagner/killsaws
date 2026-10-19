// Headless round robin: every pair in the roster, champion vs champion, fixed
// seeds, full matches. Prints the standings and the driving pathologies the
// per-bot game plans are supposed to avoid.
//
//   npx tsx scripts/roundrobin.ts [--seeds 1] [--workers 12] [--level champion] [--only id,id] [--json out.json]
//
// Each pair fights `seeds` times, squares alternating. One seed (378 fights for 28 robots) runs in
// about 6 minutes on 12 workers; --seeds 2 is the fuller table and takes about twice as long.
// Work is sharded across child processes (one Rapier world each).
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Match } from '../src/sim/match';
import { BotAI, AILevel } from '../src/sim/ai';
import { ROSTER, rosterById } from '../src/sim/roster';
import { HALF } from '../src/sim/arena';
import type { SimEvent } from '../src/sim/combat';
import { driverFor } from '../src/sim/drivers';

interface BotStats {
  /** when its last KO count began: s since the last hazard hit on it, and how long the opponent had
   * been off it at that hit (hits during the count don't count: a dead robot by the screws keeps taking them) */
  hazardBeforeCount: number;
  untouchedAtHazard: number;
  /** longest run (s) pressed against a wall, slow, untouched for 1.5 s, wheels down and both drive sides working */
  wallStuck: number;
  /** spinners: did the weapon reach its plan's spin-up fraction before first contact? null = not a spinner */
  spunBeforeContact: boolean | null;
  /** s since the opponent last touched this robot when its last KO count began */
  untouchedAtCount: number;
}
interface Fight {
  ids: [string, string];
  seed: number;
  winner: 0 | 1;
  method: 'KO' | 'Judges' | 'none';
  time: number;
  koReason?: string;
  /** longest run (s) with both robots driveable and neither touching nor hitting the other */
  noContact: number;
  bots: [BotStats, BotStats];
}

/** KO reasons that name where it's beached */
const HAZARD_WORDS = ['screw', 'rail', 'deck'];

async function fight(a: string, b: string, seed: number, level: AILevel): Promise<Fight> {
  const m = await Match.create([rosterById(a)!, rosterById(b)!], { seed, humans: [false, false] });
  const ais = [new BotAI(0, level, seed), new BotAI(1, level, seed + 100)];
  const stats = (k: number): BotStats => ({
    hazardBeforeCount: Infinity, untouchedAtHazard: 0, wallStuck: 0, untouchedAtCount: 0,
    spunBeforeContact: m.bots[k].spinner ? false : null,
  });
  const st: [BotStats, BotStats] = [stats(0), stats(1)];
  const wallRun = [0, 0];
  const hazardAt = [-99, -99], untouchedAtHazard = [0, 0];
  let lastTouch = -10, noContactRun = 0, noContact = 0, contacted = false;
  let steps = 0;
  const dt = 1 / 240, every = 12;
  while (!m.result && steps < 240 * 200) {
    for (let k = 0; k < 2; k++) m.setInput(k, ais[k].think(m, dt));
    m.step();
    steps++;
    for (const e of m.drainEvents() as SimEvent[]) {
      if (e.type === 'hit' && e.kind === 'hazard' && e.target >= 0) {
        hazardAt[e.target] = m.time;
        untouchedAtHazard[e.target] = m.time - lastTouch;
      }
      // spinner strikes are impulses, not lasting contact: a robot-on-robot hit counts as contact
      if (e.type === 'hit' && e.attacker >= 0 && e.target >= 0 && e.attacker !== e.target) { lastTouch = m.time; contacted = true; }
      if (e.type === 'ko-start') {
        st[e.bot].untouchedAtCount = m.time - lastTouch;
        st[e.bot].hazardBeforeCount = m.time - hazardAt[e.bot];
        st[e.bot].untouchedAtHazard = untouchedAtHazard[e.bot];
      }
    }
    if (m.phase !== 'fight' || steps % every) continue;
    const touching = m.touching(m.bots[0], m.bots[1]);
    if (touching) { lastTouch = m.time; contacted = true; }
    // only a driveable robot counts as stalling: one that lost a wheel or a drive side, or is beached on
    // the rail / a deck edge with most wheels in the air, is stranded, which is a KO-rule question
    const driveable = m.bots.map((bt) => bt.canMove() && bt.wheels.every((w) => w.attached) && bt.internals.driveL > 0
      && bt.internals.driveR > 0 && bt.wheels.filter((w) => w.contact).length >= Math.max(2, bt.wheels.length / 2));
    noContactRun = m.time - lastTouch > dt * every && driveable[0] && driveable[1] ? noContactRun + dt * every : 0;
    noContact = Math.max(noContact, noContactRun);
    for (let k = 0; k < 2; k++) {
      const bt = m.bots[k];
      const p = bt.pos;
      const nearWall = Math.max(Math.abs(p.x), Math.abs(p.z)) > HALF - bt.half.x - 0.45;
      wallRun[k] = nearWall && bt.speed < 0.3 && m.time - lastTouch > 1.5 && driveable[k] ? wallRun[k] + dt * every : 0;
      st[k].wallStuck = Math.max(st[k].wallStuck, wallRun[k]);
      const sp = bt.spinner;
      if (sp && !contacted && st[k].spunBeforeContact === false) {
        const max = (bt.stats.weapon?.maxRpm ?? 1000) * Math.PI / 30;
        if (Math.abs(sp.omega) >= driverFor(bt.design).spinUp * max) st[k].spunBeforeContact = true;
      }
    }
  }
  const r = m.result;
  m.dispose();
  return {
    ids: [a, b], seed, winner: r?.winner ?? 0, method: r?.method ?? 'none', time: r?.time ?? 0,
    koReason: r?.koReason, noContact, bots: st,
  };
}

/** A KO loss the arena did: counted out beached on the rail, deck or screws, or a hazard (killsaw,
 * screw, Pulverizer, ramrod) hit it in the 3 s before its final count began. Self-inflicted: it got
 * there on its own. For a hazard hit, the opponent hadn't touched it for 1.5 s before the hit; for a
 * beaching, not for 5 s before the count (which starts 1.5 s after it stops, and a big hit can fling
 * a robot for a second or more). */
function hazardLoss(f: Fight, loser: 0 | 1) {
  if (f.method !== 'KO') return { hazard: false, self: false };
  const s = f.bots[loser];
  const hit = s.hazardBeforeCount < 3;
  const beached = HAZARD_WORDS.some((w) => (f.koReason ?? '').toLowerCase().includes(w));
  const hazard = hit || beached;
  return { hazard, self: hazard && (hit ? s.untouchedAtHazard > 1.5 : s.untouchedAtCount > 5) };
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seeds = Number(flag('--seeds') ?? 1);
const level = (flag('--level') ?? 'champion') as AILevel;
const only = flag('--only')?.split(',');
const ids = ROSTER.map((d) => d.id).filter((id) => !only || only.includes(id));
const jobs: [string, string, number][] = [];
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    for (let s = 0; s < seeds; s++) {
      const seed = 1000 + i * 97 + j * 13 + s;
      // swap squares on alternate fights so no robot always starts red
      jobs.push((s + i + j) % 2 ? [ids[j], ids[i], seed] : [ids[i], ids[j], seed]);
    }
  }
}

const shard = flag('--shard');
if (shard) {
  // child: run every nth job and write one JSON line per fight
  const [k, n] = shard.split('/').map(Number);
  for (let i = k; i < jobs.length; i += n) {
    const [a, b, seed] = jobs[i];
    process.stdout.write(JSON.stringify(await fight(a, b, seed, level)) + '\n');
  }
} else {
  const workers = Math.min(Number(flag('--workers') ?? Math.min(12, Math.max(1, availableParallelism() - 2))), jobs.length);
  const self = fileURLToPath(import.meta.url);
  const passthrough = process.argv.slice(2);
  const t0 = performance.now();
  const fights: Fight[] = [];
  let done = 0;
  await Promise.all(Array.from({ length: workers }, (_, k) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, self, ...passthrough, '--shard', `${k}/${workers}`], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.startsWith('{')) continue;
        fights.push(JSON.parse(line));
        done++;
        if (done % 25 === 0) process.stderr.write(`  ${done}/${jobs.length} fights, ${((performance.now() - t0) / 1000).toFixed(0)}s\n`);
      }
    });
    child.on('exit', (code) => (code ? reject(new Error(`shard ${k} exited ${code}`)) : resolve()));
  })));
  report(fights, (performance.now() - t0) / 1000);
  const out = flag('--json');
  if (out) writeFileSync(out, JSON.stringify(fights, null, 1));
}

function report(fights: Fight[], secs: number) {
  const row = new Map(ids.map((id) => [id, { w: 0, l: 0, koW: 0, koL: 0, len: 0, n: 0, hazL: 0, selfHazL: 0 }]));
  let losses = 0, hazardLosses = 0, selfHazard = 0, noResult = 0;
  const wallStuck: string[] = [], circling: string[] = [], coldSpin = new Map<string, number>(), spinFights = new Map<string, number>();
  for (const f of fights) {
    if (f.method === 'none') { noResult++; continue; }
    const loser = (1 - f.winner) as 0 | 1;
    const w = row.get(f.ids[f.winner])!, l = row.get(f.ids[loser])!;
    w.w++; l.l++; losses++;
    if (f.method === 'KO') { w.koW++; l.koL++; }
    for (const r of [w, l]) { r.len += f.time; r.n++; }
    const h = hazardLoss(f, loser);
    if (h.hazard) { l.hazL++; hazardLosses++; }
    if (h.self) { l.selfHazL++; selfHazard++; }
    const tag = `${f.ids[0]} v ${f.ids[1]} #${f.seed}`;
    for (let k = 0; k < 2; k++) {
      if (f.bots[k].wallStuck > 10) wallStuck.push(`${f.ids[k]} ${f.bots[k].wallStuck.toFixed(0)}s (${tag})`);
      if (f.bots[k].spunBeforeContact !== null) {
        spinFights.set(f.ids[k], (spinFights.get(f.ids[k]) ?? 0) + 1);
        if (!f.bots[k].spunBeforeContact) coldSpin.set(f.ids[k], (coldSpin.get(f.ids[k]) ?? 0) + 1);
      }
    }
    if (f.noContact > 30) circling.push(`${tag} ${f.noContact.toFixed(0)}s`);
  }
  const rows = [...row.entries()].sort((x, y) => y[1].w / Math.max(1, y[1].n) - x[1].w / Math.max(1, x[1].n) || y[1].koW - x[1].koW);
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  console.log(`\n${fights.length} fights (${seeds} per pair, ${level}) in ${secs.toFixed(0)}s\n`);
  console.log(`${'#'.padStart(3)}  ${'robot'.padEnd(15)}${pad('W', 4)}${pad('L', 4)}${pad('win%', 6)}${pad('KO-W', 6)}${pad('KO-L', 6)}${pad('avg s', 7)}${pad('haz-L', 7)}${pad('self', 6)}`);
  rows.forEach(([id, r], i) => {
    console.log(`${pad(i + 1, 3)}  ${id.padEnd(15)}${pad(r.w, 4)}${pad(r.l, 4)}${pad(Math.round(100 * r.w / Math.max(1, r.n)), 6)}${pad(r.koW, 6)}${pad(r.koL, 6)}${pad((r.len / Math.max(1, r.n)).toFixed(0), 7)}${pad(r.hazL, 7)}${pad(r.selfHazL, 6)}`);
  });
  const ko = fights.filter((f) => f.method === 'KO').length;
  console.log(`\nKO rate ${(100 * ko / Math.max(1, fights.length)).toFixed(0)}%, judges ${fights.length - ko - noResult}, no result ${noResult}`);
  console.log(`hazard-caused losses ${hazardLosses}/${losses}; self-inflicted ${selfHazard} (${(100 * selfHazard / Math.max(1, losses)).toFixed(1)}% of all losses, bound 5%)`);
  console.log(`wall-stuck > 10 s: ${wallStuck.length}${wallStuck.length ? '\n  ' + wallStuck.slice(0, 12).join('\n  ') : ''}`);
  console.log(`no contact > 30 s: ${circling.length}${circling.length ? '\n  ' + circling.slice(0, 12).join('\n  ') : ''}`);
  const cold = [...coldSpin.entries()].map(([id, n]) => `${id} ${n}/${spinFights.get(id)}`);
  console.log(`spinner hit cold (under its plan's spin-up before first contact): ${cold.length ? cold.join(', ') : 'none'}`);
}
