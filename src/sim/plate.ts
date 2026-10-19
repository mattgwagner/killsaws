// Where a flipper plate, a lifter beak or a lifting arm actually is, in the
// robot's body frame (x forward, y up, z right, origin at the chassis centre).
// Hinge, footprint and surface are the ones the renderer draws
// (src/render/botmesh.ts), so a robot flips only if it is on the plate the
// player sees.

import type { BotDesign } from './design';
import { frameOf, frontXAt } from './blueprint';

export type PlateKind = 'flipper' | 'lifter' | 'arm';

export interface Plate {
  /** hinge line (m, body frame); the plate swings about the lateral axis through it */
  hingeX: number;
  hingeY: number;
  /** footprint: x from `fromX` to tipX(z), |z| <= halfWidth */
  fromX: number;
  tipX: (z: number) => number;
  halfWidth: number;
  /** plate surface height at rest (m, body frame) */
  surface: (x: number) => number;
  /** lowest point of a target that still counts as over the plate: a lid sits on the body, a beak runs along the floor */
  low: (x: number) => number;
  /** a lid or arm: the target must rest on it, clear below `low`, not reach up through it from the nose wedge.
   * A beak has no collider and runs along the floor, so anything over it counts. */
  restsOn: boolean;
}

const LID = 0.018; // plate thickness

/** The body's top surface and front edge, from the blueprint when there is one, else the chassis numbers. */
function body(d: BotDesign) {
  const ch = d.chassis;
  const hx = ch.length / 2, hy = ch.height / 2;
  if (ch.blueprint) {
    const f = frameOf(ch.blueprint);
    return { hx, hy, floorY: f.floorY, top: f.top, front: (z: number) => frontXAt(ch.blueprint!, z) };
  }
  const wl = ch.wedgeLength;
  const lipY = -hy - ch.clearance + 0.005;
  const top = (x: number) => (wl > 0 && x > hx * 0.97 ? hy + (lipY - hy) * Math.min(1, (x - hx * 0.97) / (hx + wl - hx * 0.97)) : hy);
  return { hx, hy, floorY: -hy - ch.clearance, top, front: () => hx + wl };
}

/** The plate for a robot's flipper / lifter weapon, or (kind 'arm') its secondary lifting arm. */
export function plateOf(d: BotDesign, kind: PlateKind): Plate {
  const b = body(d);
  const { hx, hy } = b;
  if (kind === 'arm') {
    // Whiplash: a flat arm over the deck, hinged at the back, reaching the disk mount
    const w = d.weapon;
    const reach = w.type === 'spinner' ? w.mountX : hx;
    const y = hy + 0.03 + 0.01;
    return {
      hingeX: -hx * 0.8, hingeY: hy + 0.03, fromX: -hx * 0.8, tipX: () => reach, halfWidth: (d.chassis.width * 0.55) / 2,
      surface: () => y, low: () => y - 0.03, restsOn: true,
    };
  }
  const w = d.weapon;
  if (w.type !== 'flipper') throw new Error(`${d.id} has no flipper or lifter`);
  if (kind === 'lifter') {
    // DUCK!'s beak: a low plate out in front, hinged inside the nose
    const y = -hy * 0.6 + 0.0175;
    return {
      hingeX: hx * 0.4, hingeY: 0, fromX: hx * 0.8, tipX: () => hx * 0.8 + w.plateLength, halfWidth: w.plateWidth / 2,
      surface: () => y, low: () => b.floorY, restsOn: false,
    };
  }
  // a lid hinged at the back of the plate, as drawn: flat at deck height (so a robot on the nose wedge is
  // under it, not on it), or for a 'sloped-lid' robot (Blip) laid along the nose slope from its own hinge
  const top = hy + LID + LID / 2;
  if (d.look?.features?.includes('sloped-lid') && d.chassis.blueprint) {
    const tilt = Math.asin(Math.min(1, (hy - b.top(hx)) / w.plateLength));
    const hingeX = hx - w.plateLength * Math.cos(tilt);
    const surface = (x: number) => top - (x - hingeX) * Math.tan(tilt);
    return {
      hingeX, hingeY: hy + LID, fromX: hingeX, tipX: () => hx, halfWidth: w.plateWidth / 2,
      surface, low: (x) => surface(x) - 0.03, restsOn: true,
    };
  }
  const hingeX = hx + d.chassis.wedgeLength * 0.4 - w.plateLength;
  return {
    hingeX, hingeY: hy + LID, fromX: hingeX,
    tipX: (z) => Math.min(hingeX + w.plateLength, b.front(z)), halfWidth: w.plateWidth / 2,
    surface: () => top, low: () => top - 0.03, restsOn: true,
  };
}

/** Sample points over the plate at rest: the surface point and the bottom of the column under it. */
export function plateSamples(p: Plate, nx = 6, nz = 5) {
  const out: { surface: { x: number; y: number; z: number }; low: { x: number; y: number; z: number } }[] = [];
  for (let j = 0; j < nz; j++) {
    const z = (-1 + (2 * (j + 0.5)) / nz) * p.halfWidth;
    const tip = p.tipX(z);
    for (let i = 0; i < nx; i++) {
      const x = p.fromX + ((i + 0.5) / nx) * (tip - p.fromX);
      if (x > tip) continue;
      out.push({ surface: { x, y: p.surface(x), z }, low: { x, y: p.low(x), z } });
    }
  }
  return out;
}
