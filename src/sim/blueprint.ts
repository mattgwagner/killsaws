// A robot's body as a blueprint: a top-view outline (inches, body frame,
// x forward, z right) extruded between the belly and the deck, with an
// optional sloped nose and tail. The physics hull and the rendered mesh are
// both derived from it, so what you see is what collides.

import { IN } from './parts';

export interface Slope {
  /** x (in) where the deck starts to slope */
  at: number;
  /** height of the top surface above the floor at the tip (in) */
  lip: number;
  /** the belly drops to the floor too (a true wedge), instead of only the top sloping */
  floor?: boolean;
}

export interface Blueprint {
  /** closed polygon, inches, body frame; concave is fine (render keeps it, the collider uses its hull) */
  outline: [number, number][];
  /** body height, belly to deck (in) */
  height: number;
  /** belly above the floor (in) */
  clearance: number;
  front?: Slope;
  rear?: Slope;
}

export interface BlueprintFrame {
  pts: { x: number; z: number }[]; // meters, CCW seen from above
  hy: number; // half height (m)
  floorY: number; // floor in body frame (m)
  minX: number; maxX: number; minZ: number; maxZ: number;
  creases: number[]; // x positions (m) where the top surface bends
  top: (x: number) => number;
  bottom: (x: number) => number;
}

export function frameOf(bp: Blueprint): BlueprintFrame {
  let pts = bp.outline.map(([x, z]) => ({ x: x * IN, z: z * IN }));
  // CCW when viewed from +Y (x right, z down the screen is clockwise in x-z): normalise by signed area
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a.x * b.z - b.x * a.z;
  }
  if (area > 0) pts = pts.reverse();
  const hy = (bp.height * IN) / 2;
  const floorY = -hy - bp.clearance * IN;
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const fAt = bp.front ? Math.min(bp.front.at * IN, maxX - 0.005) : maxX;
  const rAt = bp.rear ? Math.max(bp.rear.at * IN, minX + 0.005) : minX;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));
  const top = (x: number) => {
    if (bp.front && x > fAt) return lerp(hy, floorY + bp.front.lip * IN, (x - fAt) / (maxX - fAt));
    if (bp.rear && x < rAt) return lerp(hy, floorY + bp.rear.lip * IN, (rAt - x) / (rAt - minX));
    return hy;
  };
  const lipBottom = floorY + 0.004;
  const bottom = (x: number) => {
    if (bp.front?.floor && x > fAt) return lerp(-hy, lipBottom, (x - fAt) / (maxX - fAt));
    if (bp.rear?.floor && x < rAt) return lerp(-hy, lipBottom, (rAt - x) / (rAt - minX));
    return -hy;
  };
  const creases = [...(bp.rear ? [rAt] : []), ...(bp.front ? [fAt] : [])];
  return { pts, hy, floorY, minX, maxX, minZ: Math.min(...zs), maxZ: Math.max(...zs), creases, top, bottom };
}

/** Outline with extra vertices wherever an edge crosses a crease line. */
export function withCreases(f: BlueprintFrame) {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < f.pts.length; i++) {
    const a = f.pts[i], b = f.pts[(i + 1) % f.pts.length];
    out.push(a);
    const cs = f.creases.filter((c) => (a.x - c) * (b.x - c) < 0).sort((p, q) => (b.x > a.x ? p - q : q - p));
    for (const c of cs) {
      const t = (c - a.x) / (b.x - a.x);
      out.push({ x: c, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/** Sutherland-Hodgman clip of the outline to xmin <= x <= xmax. */
export function clipX(pts: { x: number; z: number }[], xmin: number, xmax: number) {
  const clip = (poly: { x: number; z: number }[], keep: (p: { x: number }) => boolean, edge: number) => {
    const res: { x: number; z: number }[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ia = keep(a), ib = keep(b);
      if (ia) res.push(a);
      if (ia !== ib) {
        const t = (edge - a.x) / (b.x - a.x);
        res.push({ x: edge, z: a.z + (b.z - a.z) * t });
      }
    }
    return res;
  };
  let p = clip(pts, (q) => q.x >= xmin, xmin);
  p = clip(p, (q) => q.x <= xmax, xmax);
  return p;
}

/** Collider points: every outline vertex at its belly and deck height. */
export function blueprintHull(bp: Blueprint): Float32Array {
  const f = frameOf(bp);
  const out: number[] = [];
  for (const p of withCreases(f)) out.push(p.x, f.bottom(p.x), p.z, p.x, f.top(p.x), p.z);
  return new Float32Array(out);
}

/** Bounding dimensions (m) and the offset of the bbox center from the body origin. */
export function blueprintBox(bp: Blueprint) {
  const f = frameOf(bp);
  return { length: f.maxX - f.minX, width: f.maxZ - f.minZ, height: bp.height * IN, clearance: bp.clearance * IN, cx: (f.maxX + f.minX) / 2, cz: (f.maxZ + f.minZ) / 2 };
}

/** Plan-view area (m²) for armor accounting. */
export function outlineArea(bp: Blueprint) {
  const f = frameOf(bp);
  let a = 0;
  for (let i = 0; i < f.pts.length; i++) {
    const p = f.pts[i], q = f.pts[(i + 1) % f.pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

/** Front-most x (m) of the outline at lateral position z (m): where a fork or leg mounts. */
export function frontXAt(bp: Blueprint, z: number) {
  const f = frameOf(bp);
  let best = -Infinity;
  for (let i = 0; i < f.pts.length; i++) {
    const a = f.pts[i], b = f.pts[(i + 1) % f.pts.length];
    if ((a.z - z) * (b.z - z) > 0 || a.z === b.z) continue;
    const t = (z - a.z) / (b.z - a.z);
    best = Math.max(best, a.x + (b.x - a.x) * t);
  }
  return Number.isFinite(best) ? best : f.maxX;
}
