// Mesh for a blueprint body: walls around the (possibly concave) outline,
// and top/bottom faces triangulated per crease segment so slopes stay planar.
import * as THREE from 'three';
import { Blueprint, clipX, frameOf, withCreases } from '../sim/blueprint';

function triangulate(poly: { x: number; z: number }[], y: (x: number) => number, flip: boolean, out: number[]) {
  if (poly.length < 3) return;
  const contour = poly.map((p) => new THREE.Vector2(p.x, p.z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const t of tris) {
    const idx = flip ? [t[0], t[2], t[1]] : t;
    for (const i of idx) out.push(poly[i].x, y(poly[i].x), poly[i].z);
  }
}

export function blueprintGeometry(bp: Blueprint) {
  const f = frameOf(bp);
  const pos: number[] = [];
  const ring = withCreases(f);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ab = [a.x, f.bottom(a.x), a.z], bb = [b.x, f.bottom(b.x), b.z];
    const bt = [b.x, f.top(b.x), b.z], at = [a.x, f.top(a.x), a.z];
    pos.push(...ab, ...bb, ...bt, ...ab, ...bt, ...at);
  }
  const cuts = [f.minX - 1, ...f.creases, f.maxX + 1];
  for (let k = 0; k < cuts.length - 1; k++) {
    const seg = clipX(f.pts, cuts[k], cuts[k + 1]);
    triangulate(seg, f.top, false, pos);
    triangulate(seg, f.bottom, true, pos);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return { geometry: g, frame: f };
}

/** The flat middle of the deck (between the creases), shrunk toward its centroid, for the deck plate. */
export function deckPlate(bp: Blueprint, shrink = 0.86) {
  const f = frameOf(bp);
  const lo = f.creases.length === 2 ? f.creases[0] : bp.rear ? f.creases[0] : f.minX;
  const hi = bp.front ? f.creases[f.creases.length - 1] : f.maxX;
  const seg = clipX(f.pts, lo, hi);
  if (seg.length < 3) return null;
  const cx = seg.reduce((s, p) => s + p.x, 0) / seg.length;
  const cz = seg.reduce((s, p) => s + p.z, 0) / seg.length;
  const shape = new THREE.Shape(seg.map((p) => new THREE.Vector2(cx + (p.x - cx) * shrink, cz + (p.z - cz) * shrink)));
  const g = new THREE.ShapeGeometry(shape);
  // ShapeGeometry is in XY; lay it on the deck (x -> x, y -> z)
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getY(i); p.setXYZ(i, x, f.hy + 0.003, z); }
  g.computeVertexNormals();
  return { geometry: g, center: new THREE.Vector3(cx, f.hy, cz), seg };
}
