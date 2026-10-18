import { Match } from '../src/sim/match';
import { rosterById } from '../src/sim/roster';
for (const id of ['end-game', 'tantrum', 'bronco', 'blacksmith', 'gigabyte', 'bloodsport', 'witch-doctor', 'whiplash', 'hydra', 'quantum', 'sawblaze', 'beta', 'cobalt']) {
  const m = await Match.create([rosterById(id)!, rosterById('duck')!], { hazards: false, humans: [true, true] });
  const b = m.bots[0];
  for (let i = 0; i < 240 * 3.2; i++) m.step(); // countdown
  b.body.setTranslation({ x: 0, y: 0.5, z: 0 }, true);
  b.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true); // upside down (roll 180)
  let righted = -1;
  for (let i = 0; i < 240 * 8; i++) {
    const t = i / 240;
    const pulse = righted < 0 && t > 1 && Math.floor(t * 2) % 2 === 0;
    m.setInput(0, { throttle: 0, turn: 0, weapon: b.spinner ? t > 0.5 && t < 0.55 : pulse && t % 1 < 0.1, alt: pulse });
    m.step();
    if (righted < 0 && b.up.y > 0.8 && t > 1) righted = t;
  }
  console.log(id.padEnd(14), righted > 0 ? `righted at ${righted.toFixed(2)}s` : `STILL ${b.inverted ? 'INVERTED' : b.onSide ? 'ON SIDE' : 'upright?'} up.y=${b.up.y.toFixed(2)}`, 'canMove', b.canMove());
  m.dispose();
}
