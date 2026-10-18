// After settling, where is each rotor's lowest point relative to the floor, and how is the chassis pitched?
import { Match } from '../src/sim/match';
import { ROSTER } from '../src/sim/roster';

for (const d of ROSTER) {
  const m = await Match.create([d, ROSTER[0]], { hazards: false });
  for (let i = 0; i < 240 * 2.5; i++) m.step();
  const b = m.bots[0];
  const f = b.forward;
  let low = NaN;
  const w = d.weapon;
  if (w.type === 'spinner' && b.spinner) {
    const c = b.toWorld(b.spinner.mountLocal);
    const ax = b.dirWorld(b.spinner.axisLocal);
    // lowest point of a circle radius R around axis ax: c.y - R*sqrt(1-ax.y^2), plus half-width tilt
    low = c.y - w.radius * Math.sqrt(Math.max(0, 1 - ax.y * ax.y)) - Math.abs(ax.y) * w.width / 2;
  }
  console.log(d.name.padEnd(16), 'pitch', (Math.asin(f.y) * 57.3).toFixed(1).padStart(6), 'deg  y', b.pos.y.toFixed(3), ' rotor low', Number.isNaN(low) ? '-' : (low * 39.37).toFixed(2) + ' in', ' wheels', b.wheels.map((x) => (x.contact ? 'C' : '.')).join(''));
  m.dispose();
}
