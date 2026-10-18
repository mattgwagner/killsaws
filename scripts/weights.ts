import { ROSTER } from '../src/sim/roster';
import { computeStats, kgToLb } from '../src/sim/design';
for (const d of ROSTER) {
  const s = computeStats(d);
  const w = s.weapon;
  const a = d.chassis.armor;
  console.log(d.name.padEnd(16), kgToLb(s.mass).toFixed(1).padStart(6), 'lb', s.topSpeedMph.toFixed(1).padStart(5), 'mph', ('push ' + (s.pushForceN / 4.448).toFixed(0) + 'lbf').padEnd(11), s.invertible ? 'INV' : '   ',
    w ? `${w.maxRpm.toFixed(0).padStart(5)}rpm ${w.tipSpeedMph.toFixed(0)}mph ${w.energyKJ.toFixed(1).padStart(5)}kJ spin ${w.spinUpS.toFixed(1)}s ${w.peakAmps.toFixed(0)}A` : d.weapon.type,
    `armor F${a.front.thickness} S${a.sides.thickness} T${a.top.thickness} B${a.bottom.thickness}`);
}
