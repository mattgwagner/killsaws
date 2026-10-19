// Battle damage you can see, driven only by sim state (BotView) and hit events,
// so what the robot looks like is what the judges score.
//
// Marks live in a per-robot damage canvas laid out as a six-face atlas
// (top, bottom, front, rear, left, right). Each hull mesh gets a thin overlay
// shell, pushed a few millimetres out along its normals (so it sits above deck
// plates), with UVs box-projected into that atlas. Where the canvas is empty the
// shell is invisible, so an undamaged robot looks exactly as it did; where a hit
// stripped the paint the shell shows bare, scraped steel.
import * as THREE from 'three';
import type { BotMesh } from './botmesh';
import type { BotDesign } from '../sim/design';
import type { BotView } from '../sim/match';
import type { HitEvent } from '../sim/combat';
import type { Effects, FloorScars } from './effects';

export type Face = 'front' | 'rear' | 'left' | 'right' | 'top' | 'bottom';
const SIZE = 1024;
const FLUSH_HZ = 4; // canvas uploads per second per robot, at most
const CELL = { w: SIZE / 3, h: SIZE / 2 };
// atlas cells: row 0 = top, front, right; row 1 = bottom, rear, left
const CELLS: Record<Face, [number, number]> = { top: [0, 0], front: [1, 0], right: [2, 0], bottom: [0, 1], rear: [1, 1], left: [2, 1] };

export class BotDamage {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  readonly overlays: THREE.Mesh[] = [];
  private box = new THREE.Box3();
  private dirty = false;
  private sinceFlush = 0;
  private seed = 7;
  readonly marks: { face: Face; kind: string; kj: number }[] = [];

  constructor(
    readonly m: BotMesh,
    readonly d: BotDesign,
    readonly fx: Effects,
    readonly scars: FloorScars,
    readonly scene: THREE.Scene,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({
      map: this.tex, transparent: true, alphaTest: 0.02, metalness: 0.85, roughness: 0.38,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
    });
    // the union box of the hull pieces, in body frame, is the atlas projection frame
    for (const h of m.hullMeshes) { h.geometry.computeBoundingBox(); this.box.union(h.geometry.boundingBox!); }
    for (const h of m.hullMeshes) {
      const ov = new THREE.Mesh(this.overlayGeometry(h.geometry), mat);
      ov.renderOrder = 2;
      h.parent!.add(ov);
      this.overlays.push(ov);
    }
  }

  /** hull geometry, puffed out along each face's outward normal, with box-projected atlas UVs */
  private overlayGeometry(src: THREE.BufferGeometry) {
    const g = (src.index ? src.toNonIndexed() : src.clone()) as THREE.BufferGeometry;
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const p = g.attributes.position;
    const uv = new Float32Array(p.count * 2);
    const centre = this.box.getCenter(new THREE.Vector3());
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3(), mid = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      fn.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
      // blueprint bodies aren't consistently wound: point every face away from the body centre
      mid.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(centre);
      if (fn.dot(mid) < 0) fn.negate();
      const face = this.faceOfNormal(fn);
      for (let k = 0; k < 3; k++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i + k);
        const [u, w] = this.atlasUV(face, v);
        uv[(i + k) * 2] = u; uv[(i + k) * 2 + 1] = w;
        // puff out 7 mm so marks sit above deck plates and never z-fight the paint
        p.setXYZ(i + k, v.x + fn.x * 0.007, v.y + fn.y * 0.007, v.z + fn.z * 0.007);
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }

  private faceOfNormal(n: THREE.Vector3): Face {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ay >= ax && ay >= az) return n.y >= 0 ? 'top' : 'bottom';
    if (ax >= az) return n.x >= 0 ? 'front' : 'rear';
    return n.z >= 0 ? 'right' : 'left';
  }

  /** body-frame point -> atlas uv (0..1, flipY convention) for a face */
  private atlasUV(face: Face, v: THREE.Vector3): [number, number] {
    const b = this.box;
    const nx = (v.x - b.min.x) / Math.max(1e-6, b.max.x - b.min.x);
    const ny = (v.y - b.min.y) / Math.max(1e-6, b.max.y - b.min.y);
    const nz = (v.z - b.min.z) / Math.max(1e-6, b.max.z - b.min.z);
    let s = 0, t = 0;
    switch (face) {
      case 'top': s = nx; t = nz; break;
      case 'bottom': s = nx; t = 1 - nz; break;
      case 'front': s = nz; t = ny; break;
      case 'rear': s = 1 - nz; t = ny; break;
      case 'right': s = 1 - nx; t = ny; break;
      case 'left': s = nx; t = ny; break;
    }
    const [cx, cy] = CELLS[face];
    // inset a little so marks don't bleed across cells
    const px = (cx + 0.02 + s * 0.96) / 3;
    const py = (cy + 0.02 + t * 0.96) / 2;
    return [px, 1 - py];
  }

  /** atlas pixel and pixels-per-metre for a body-frame point on a face */
  private pixel(face: Face, v: THREE.Vector3) {
    const [u, w] = this.atlasUV(face, v);
    const b = this.box;
    const span = face === 'top' || face === 'bottom' ? Math.max(b.max.x - b.min.x, b.max.z - b.min.z)
      : face === 'front' || face === 'rear' ? b.max.z - b.min.z : b.max.x - b.min.x;
    return { x: u * SIZE, y: (1 - w) * SIZE, ppm: (CELL.w * 0.96) / Math.max(0.05, span) };
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private faceAt(local: THREE.Vector3): Face {
    const b = this.box;
    const c = b.getCenter(new THREE.Vector3()), h = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    return this.faceOfNormal(new THREE.Vector3((local.x - c.x) / h.x, (local.y - c.y) / h.y, (local.z - c.z) / h.z));
  }

  /** A hit landed on this robot: stamp a mark on the face it hit, at the impact, along the blow. */
  hit(e: HitEvent) {
    const kj = e.energy / 1000;
    if (kj < 0.3 && e.kind !== 'saw' && e.kind !== 'landing') return;
    this.m.root.updateMatrixWorld();
    const local = this.m.body.worldToLocal(new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z));
    local.clamp(this.box.min, this.box.max);
    const face: Face = (e.face as Face | undefined) ?? this.faceAt(local);
    const q = this.m.root.quaternion.clone().invert();
    const dir = new THREE.Vector3(e.dir.x, e.dir.y, e.dir.z).applyQuaternion(q);
    const kind = e.kind === 'spinner' || e.kind === 'clash' ? 'gouge'
      : e.kind === 'saw' || (e.kind === 'hazard' && (e.hazardId?.startsWith('saw') || e.hazardId?.includes('screw'))) ? 'scratch'
      : e.kind === 'ram' ? 'scuff' : 'dent';
    this.stamp(face, local, dir, kind, Math.max(kj, 0.5));
    this.marks.push({ face, kind, kj });
  }

  /** draw one mark; exposed for scorch (fire) and landings */
  stamp(face: Face, local: THREE.Vector3, dir: THREE.Vector3, kind: 'gouge' | 'dent' | 'scratch' | 'scuff' | 'scorch', kj: number) {
    const { x: cx, y: cy, ppm } = this.pixel(face, local);
    // the blow's direction projected into this face's atlas cell
    const a = this.pixel(face, local.clone().addScaledVector(dir, 0.05));
    let dx = a.x - cx, dy = a.y - cy;
    const dl = Math.hypot(dx, dy);
    if (dl < 1e-3) { const r = this.rand() * Math.PI; dx = Math.cos(r); dy = Math.sin(r); } else { dx /= dl; dy /= dl; }
    const [cellX, cellY] = CELLS[face];
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(cellX * CELL.w, cellY * CELL.h, CELL.w, CELL.h);
    g.clip();
    const steel = 'rgba(178,182,188,1)', burr = 'rgba(22,20,18,0.9)', soot = 'rgba(14,12,10,';
    if (kind === 'gouge') {
      // bar or disk tooth: a long scrape along the blow, bright steel with a dark burr each side
      const len = (0.08 + Math.min(0.3, kj * 0.012)) * ppm;
      const w = Math.max(4, (0.01 + Math.min(0.03, kj * 0.001)) * ppm);
      const x1 = cx - dx * len * 0.5, y1 = cy - dy * len * 0.5, x2 = cx + dx * len * 0.5, y2 = cy + dy * len * 0.5;
      g.lineCap = 'round';
      g.strokeStyle = burr; g.lineWidth = w * 2.3; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.strokeStyle = steel; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.strokeStyle = 'rgba(235,238,242,0.9)'; g.lineWidth = Math.max(1, w * 0.3); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    } else if (kind === 'dent') {
      // hammer, drum tooth or landing: a crater with the paint cracked off around it
      const r = Math.max(6, (0.022 + Math.min(0.06, kj * 0.002)) * ppm);
      g.fillStyle = 'rgba(20,18,16,0.6)'; g.beginPath(); g.arc(cx, cy, r * 1.4, 0, Math.PI * 2); g.fill();
      g.fillStyle = steel; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(70,70,74,0.75)'; g.beginPath(); g.arc(cx + r * 0.22, cy + r * 0.22, r * 0.55, 0, Math.PI * 2); g.fill();
      g.strokeStyle = burr; g.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        const t = this.rand() * Math.PI * 2;
        g.beginPath(); g.moveTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r); g.lineTo(cx + Math.cos(t) * r * (1.8 + this.rand()), cy + Math.sin(t) * r * (1.8 + this.rand())); g.stroke();
      }
    } else if (kind === 'scratch') {
      // saws and screws: a fan of fine parallel scratches
      const n = 6 + Math.floor(this.rand() * 6);
      const len = 0.1 * ppm;
      for (let i = 0; i < n; i++) {
        const off = (i - n / 2) * 3;
        g.strokeStyle = i % 2 ? steel : 'rgba(210,213,217,0.85)'; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(cx - dy * off - dx * len / 2, cy + dx * off - dy * len / 2); g.lineTo(cx - dy * off + dx * len / 2, cy + dx * off + dy * len / 2); g.stroke();
      }
    } else if (kind === 'scuff') {
      g.fillStyle = 'rgba(155,158,162,0.7)';
      g.beginPath(); g.ellipse(cx, cy, 0.035 * ppm, 0.012 * ppm, Math.atan2(dy, dx), 0, Math.PI * 2); g.fill();
    } else {
      const r = Math.max(8, 0.08 * ppm * Math.min(2, 0.6 + kj * 0.1));
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, soot + '0.85)'); grd.addColorStop(0.6, soot + '0.45)'); grd.addColorStop(1, soot + '0)');
      g.fillStyle = grd; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    g.restore();
    this.dirty = true;
  }

  /** Per rendered frame. */
  frame(dt: number, _bv: BotView) {
    this.sinceFlush += dt;
    if (this.dirty && this.sinceFlush >= 1 / FLUSH_HZ) {
      this.tex.needsUpdate = true;
      this.dirty = false;
      this.sinceFlush = 0;
    }
  }

  dispose() {
    this.tex.dispose();
    for (const o of this.overlays) o.geometry.dispose();
  }
}
