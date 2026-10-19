// HUGE stability probe: spin the bar up on the spot and watch the body pitch.
import { Match } from '../src/sim/match';
import { rosterById } from '../src/sim/roster';
const m = await Match.create([rosterById('huge')!, rosterById('duck')!], { hazards: false, humans: [true, true] });
const b = m.bots[0];
for (let i = 0; i < 240 * 3.1; i++) m.step();
let maxPitch = 0, flips = 0, last = 0;
for (let i = 0; i < 240 * 8; i++) {
  m.setInput(0, { throttle: 0, turn: 0, weapon: i === 1 });
  m.step();
  const pitch = Math.asin(Math.max(-1, Math.min(1, b.forward.y))) * 57.3;
  const ang = Math.atan2(b.forward.y, Math.hypot(b.forward.x, b.forward.z));
  if (Math.abs(ang - last) > Math.PI) flips++;
  last = ang;
  maxPitch = Math.max(maxPitch, Math.abs(pitch));
  if (i % 240 === 0) console.log(`t=${(i / 240).toFixed(0)}s rpm=${Math.round(Math.abs(b.spinner!.omega) * 9.55)} pitch=${pitch.toFixed(1)} up.y=${b.up.y.toFixed(2)} canMove=${b.canMove()}`);
}
console.log('max |pitch|', maxPitch.toFixed(1), 'deg; final up.y', b.up.y.toFixed(2));

// driving: full throttle, then hard turns, with the bar at speed
{
  const m2 = await Match.create([rosterById('huge')!, rosterById('duck')!], { hazards: false, humans: [true, true] });
  const h = m2.bots[0];
  for (let i = 0; i < 240 * 3.1; i++) m2.step();
  let maxP = 0, rolls = 0, prevUp = 1, minUp = 1;
  for (let i = 0; i < 240 * 12; i++) {
    const t = i / 240;
    const throttle = t > 4 ? (Math.floor(t) % 2 ? 1 : -1) : 0;
    const turn = t > 6 ? (Math.floor(t * 0.7) % 2 ? 1 : -1) : 0;
    m2.setInput(0, { throttle, turn, weapon: i === 1 });
    m2.step();
    const p = Math.abs(Math.asin(Math.max(-1, Math.min(1, h.forward.y))) * 57.3);
    maxP = Math.max(maxP, p);
    minUp = Math.min(minUp, h.up.y);
    if (prevUp > 0 && h.up.y < 0) rolls++;
    prevUp = h.up.y;
  }
  console.log('DRIVING: max |pitch|', maxP.toFixed(1), 'deg; min up.y', minUp.toFixed(2), '; times it went over', rolls);
}
