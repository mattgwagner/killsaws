// Battle damage you can see, driven only by sim state (BotView) and hit events,
// so what the robot looks like is what the judges score.
//
// Marks live in a per-robot damage canvas laid out as a six-face atlas
// (top, bottom, front, rear, left, right). Each hull mesh gets a thin overlay
// shell, pushed a few millimetres out along its normals (so it sits above deck
// plates), with UVs box-projected into that atlas. Where the canvas is empty the
// shell is invisible, so an undamaged robot looks exactly as it did; where a hit
// stripped the paint the shell shows bare, scraped steel.
//
// From the panel and internals health in BotView: faces below 0.6 dent in and
// crease at the edges, below 0.3 a corner tears up and flaps, and at 0 the
// plate is gone and the frame shows. Each damaged system smokes from where it
// lives (wheel wells, weapon motor, chassis seam, battery), and a LiPo fire is
// a white column with orange jets and its own light.
import * as THREE from 'three';
import type { BotMesh } from './botmesh';
import type { BotDesign } from '../sim/design';
import type { BotView } from '../sim/match';
import { FACES } from '../sim/bot';
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
  /** per face: where it was hit (body frame), what has been drawn for it, and its torn flap */
  private faces = Object.fromEntries(FACES.map((f) => [f, { sites: [] as THREE.Vector3[], level: 0, chips: 0, torn: null as Flap | null, holed: false }])) as Record<Face, FaceState>;
  private deform: { mesh: THREE.Mesh; base: Float32Array; toBody: THREE.Matrix4; fromBody: THREE.Matrix4; normals: boolean }[] | null = null;
  private deformDirty = false;
  private t = 0;
  private prevQ = new THREE.Quaternion();
  private omega = 0;
  private puffClock = { drive: [0, 0], weapon: 0, elec: 0, lipo: 2, fire: 0, jet: 0, spark: 0 };
  private lockedAngle: (number | null)[] = [];
  private glowBase: number[];
  private light: THREE.PointLight;
  private rotorReach = 0;
  readonly state = { deformed: [] as Face[], torn: [] as Face[], holes: [] as Face[], smoking: [] as string[], fire: false };

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
    this.glowBase = m.glow.map((g) => (g.material as THREE.MeshStandardMaterial).emissiveIntensity ?? 0);
    this.light = new THREE.PointLight('#ff7a22', 0, 5, 1.6);
    scene.add(this.light);
    if (m.rotor) {
      m.root.updateMatrixWorld(true);
      const sz = new THREE.Box3().setFromObject(m.rotor).getSize(new THREE.Vector3());
      this.rotorReach = Math.max(sz.x, sz.y, sz.z) / 2;
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
    // the panel bends where it is hit
    const fs = this.faces[face];
    fs.sites.push(local.clone());
    if (fs.sites.length > 6) fs.sites.shift();
    if (fs.level > 0) this.deformDirty = true;
    if (fs.torn) fs.torn.vel += Math.min(8, kj * 0.4) * (this.rand() < 0.5 ? -1 : 1);
    if (e.kind === 'landing' && kj > 0.3) {
      // a hard landing: dust off the floor and sparks along the edge that hit
      const p = new THREE.Vector3(e.pos.x, Math.max(0.02, e.pos.y), e.pos.z);
      this.fx.smoke(new THREE.Vector3(p.x, 0.03, p.z), Math.min(6, 2 + Math.floor(kj)), 0.5, 0.3);
      this.fx.sparksAt(p, new THREE.Vector3(e.dir.x, 0.3, e.dir.z).normalize(), Math.min(30, 6 + Math.floor(kj * 3)), 3, 0.8);
    }
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

  /** Per rendered frame, after the view has been applied. */
  frame(dt: number, bv: BotView) {
    this.t += dt;
    const m = this.m;
    m.root.updateMatrixWorld();
    // how hard the body is tumbling (rad/s), for the torn flaps
    const q = m.root.quaternion;
    if (dt > 0) this.omega = this.omega * 0.8 + 0.2 * (2 * Math.acos(Math.min(1, Math.abs(this.prevQ.dot(q)))) / dt);
    this.prevQ.copy(q);

    this.panels(bv);
    this.systems(dt, bv);
    this.fire(dt, bv);
    this.wheels(bv);
    for (const f of FACES) if (this.faces[f].torn) this.flap(this.faces[f].torn!, dt);

    this.sinceFlush += dt;
    if (this.sinceFlush >= 1 / FLUSH_HZ) {
      if (this.dirty) { this.tex.needsUpdate = true; this.dirty = false; }
      if (this.deformDirty) { this.applyDeform(bv); this.deformDirty = false; }
      this.sinceFlush = 0;
    }
  }

  // ---- 2. panels that bend and tear ----

  private panels(bv: BotView) {
    for (const f of FACES) {
      const h = bv.panels[f], fs = this.faces[f];
      const level = Math.round(Math.max(0, (0.6 - h) / 0.6) * 20);
      if (level > fs.level) {
        fs.level = level;
        this.deformDirty = true;
        if (!this.state.deformed.includes(f)) this.state.deformed.push(f);
      }
      // a chunk breaks off at each third: a missing chip of plate at the last hit
      const chips = h <= 0.33 ? 2 : h <= 0.66 ? 1 : 0;
      while (fs.chips < chips) { fs.chips++; this.chip(f); }
      if (h < 0.3 && !fs.torn) this.tear(f);
      if (h <= 0 && !fs.holed) this.hole(f);
    }
  }

  private axisOf(f: Face): { a: 'x' | 'y' | 'z'; s: 1 | -1 } {
    return f === 'front' ? { a: 'x', s: 1 } : f === 'rear' ? { a: 'x', s: -1 } : f === 'right' ? { a: 'z', s: 1 } : f === 'left' ? { a: 'z', s: -1 } : f === 'top' ? { a: 'y', s: 1 } : { a: 'y', s: -1 };
  }

  /** a site on a face to centre things on: the latest hit, or a stable spot near the middle */
  private site(f: Face) {
    const fs = this.faces[f];
    if (fs.sites.length) return fs.sites[fs.sites.length - 1].clone();
    const c = this.box.getCenter(new THREE.Vector3()), h = this.box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const { a, s } = this.axisOf(f);
    const p = c.clone();
    p[a] += s * h[a];
    for (const o of ['x', 'y', 'z'] as const) if (o !== a) p[o] += (this.rand() - 0.5) * h[o] * 0.8;
    return p;
  }

  /** the body-frame displacement field: each damaged face pushed in at its hit sites, creasing into its edges */
  private displacement(p: THREE.Vector3, bv: BotView, out: THREE.Vector3) {
    out.set(0, 0, 0);
    const c = this.box.getCenter(new THREE.Vector3()), h = this.box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    for (const f of FACES) {
      const fs = this.faces[f];
      if (!fs.level) continue;
      const dmg = Math.min(1, Math.max(0, (0.6 - bv.panels[f]) / 0.6));
      const { a, s } = this.axisOf(f);
      const q = ((p[a] - c[a]) / Math.max(1e-4, h[a])) * s;
      if (q < 0.3) continue;
      const w = THREE.MathUtils.smoothstep(q, 0.3, 1);
      const span = Math.max(...(['x', 'y', 'z'] as const).filter((o) => o !== a).map((o) => h[o]));
      const r = THREE.MathUtils.clamp(span * 0.45, 0.04, 0.16);
      const maxDepth = Math.min(0.05, h[a] * (a === 'y' ? 0.5 : 0.35));
      let k = 0.25; // the whole plate sags a little
      const sites = fs.sites.length ? fs.sites : [this.site(f)];
      if (!fs.sites.length) fs.sites.push(sites[0]);
      for (const st of sites) {
        let d2 = 0;
        for (const o of ['x', 'y', 'z'] as const) if (o !== a) d2 += (p[o] - st[o]) ** 2;
        k += Math.exp(-d2 / (r * r));
      }
      out[a] -= s * w * Math.pow(dmg, 0.7) * maxDepth * Math.min(1.4, k);
    }
    return out;
  }

  /** the hull and deck pieces as finely tessellated copies whose vertices can be pushed */
  private ensureDeformable() {
    if (this.deform) return this.deform;
    this.deform = [];
    const parts = [...this.m.hullMeshes, ...this.m.deckParts.filter((o) => (o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) as THREE.Mesh[]];
    for (const mesh of parts) {
      mesh.updateMatrix();
      const isHull = this.m.hullMeshes.includes(mesh);
      mesh.geometry = subdivide(mesh.geometry, 0.035, 3);
      const toBody = mesh.matrix.clone();
      this.deform.push({ mesh, base: (mesh.geometry.attributes.position.array as Float32Array).slice(), toBody, fromBody: toBody.clone().invert(), normals: true });
      if (isHull) {
        // its damage overlay follows the same tessellation, so marks ride the dents
        const ov = this.overlays[this.m.hullMeshes.indexOf(mesh)];
        if (ov) {
          ov.geometry.dispose();
          ov.geometry = this.overlayGeometry(mesh.geometry);
          ov.updateMatrix();
          const tb = ov.matrix.clone();
          this.deform.push({ mesh: ov, base: (ov.geometry.attributes.position.array as Float32Array).slice(), toBody: tb, fromBody: tb.clone().invert(), normals: true });
        }
      }
    }
    return this.deform;
  }

  private applyDeform(bv: BotView) {
    const parts = this.ensureDeformable();
    const v = new THREE.Vector3(), d = new THREE.Vector3();
    for (const pt of parts) {
      const pos = pt.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        v.set(pt.base[i], pt.base[i + 1], pt.base[i + 2]).applyMatrix4(pt.toBody);
        v.add(this.displacement(v, bv, d)).applyMatrix4(pt.fromBody);
        arr[i] = v.x; arr[i + 1] = v.y; arr[i + 2] = v.z;
      }
      pos.needsUpdate = true;
      if (pt.normals) pt.mesh.geometry.computeVertexNormals();
      pt.mesh.geometry.computeBoundingSphere();
    }
  }

  /** a chunk of plate gone at the last hit: dark hole, bright torn edge */
  private chip(f: Face) {
    const p = this.site(f);
    const { x: cx, y: cy, ppm } = this.pixel(f, p);
    const r = Math.max(6, 0.025 * ppm);
    this.withCell(f, (g) => {
      jagged(g, cx, cy, r, 9, () => this.rand());
      g.fillStyle = 'rgba(10,10,11,0.95)'; g.fill();
      g.strokeStyle = 'rgba(200,203,208,0.9)'; g.lineWidth = 2; g.stroke();
    });
  }

  /** the plate is gone: the frame and the inside show */
  private hole(f: Face) {
    const fs = this.faces[f];
    fs.holed = true;
    this.state.holes.push(f);
    const [cellX, cellY] = CELLS[f];
    const x0 = cellX * CELL.w + CELL.w * 0.14, y0 = cellY * CELL.h + CELL.h * 0.14, w = CELL.w * 0.72, h = CELL.h * 0.72;
    this.withCell(f, (g) => {
      g.beginPath();
      // a ragged opening most of the face wide
      const n = 22;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2, j = 0.86 + this.rand() * 0.14;
        const x = x0 + w / 2 + Math.cos(t) * (w / 2) * j, y = y0 + h / 2 + Math.sin(t) * (h / 2) * j;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
      g.fillStyle = 'rgba(22,19,17,0.97)'; g.fill();
      g.save(); g.clip();
      // the frame: two rails and a cross member, then wiring and a pack in the bay
      g.fillStyle = 'rgba(150,154,160,1)';
      g.fillRect(x0, y0 + h * 0.18, w, h * 0.07);
      g.fillRect(x0, y0 + h * 0.75, w, h * 0.07);
      g.fillRect(x0 + w * 0.48, y0, w * 0.06, h);
      g.fillStyle = 'rgba(40,40,44,1)'; g.fillRect(x0 + w * 0.12, y0 + h * 0.32, w * 0.3, h * 0.36);
      g.strokeStyle = 'rgba(190,40,30,0.9)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x0 + w * 0.42, y0 + h * 0.4); g.bezierCurveTo(x0 + w * 0.6, y0 + h * 0.3, x0 + w * 0.7, y0 + h * 0.6, x0 + w * 0.85, y0 + h * 0.5); g.stroke();
      g.restore();
      g.strokeStyle = 'rgba(205,208,212,0.95)'; g.lineWidth = 3; g.stroke();
    });
    // the deck plate, bolts and logo went with the top
    if (f === 'top') for (const o of this.m.deckParts) o.visible = false;
  }

  /** a torn corner of the plate, hinged where it still holds, lifting away from the body */
  private tear(f: Face) {
    const { a, s } = this.axisOf(f);
    const h = this.box.getSize(new THREE.Vector3()).multiplyScalar(0.5), c = this.box.getCenter(new THREE.Vector3());
    const ua: 'x' | 'z' = a === 'x' ? 'z' : 'x';
    const n = new THREE.Vector3(); n[a] = s;
    const site = this.site(f);
    const us = site[ua] >= c[ua] ? 1 : -1;
    const u = new THREE.Vector3(); u[ua] = us;
    const v = new THREE.Vector3().crossVectors(u, n);
    const len = h[ua] * 0.75, wid = Math.min(h[a === 'y' ? 'z' : 'y'] * (a === 'y' ? 1.0 : 1.4), 0.2);
    const hinge = c.clone();
    hinge[a] += s * (h[a] + 0.004);
    hinge[ua] += us * h[ua] * 0.2;
    // keep the hinge across the face at the hit
    const va: 'x' | 'y' | 'z' = (['x', 'y', 'z'] as const).find((o) => o !== a && o !== ua)!;
    hinge[va] = THREE.MathUtils.clamp(site[va], c[va] - h[va] + wid / 2, c[va] + h[va] - wid / 2);
    const pivot = new THREE.Group();
    pivot.position.copy(hinge);
    pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, n, v));
    const plate = new THREE.Mesh(new THREE.BoxGeometry(len, 0.006, wid), [this.m.paint, this.m.paint, this.m.paint, underside, this.m.paint, this.m.paint]);
    plate.position.x = len / 2;
    plate.castShadow = true;
    pivot.add(plate);
    this.m.body.add(pivot);
    this.faces[f].torn = { pivot, ang: 0, vel: 3 };
    this.state.torn.push(f);
    // under the lifted plate: the dark gap it left
    this.withCell(f, (g) => {
      const p0 = this.pixel(f, hinge), p1 = this.pixel(f, hinge.clone().addScaledVector(u, len));
      const vw = this.pixel(f, hinge.clone().addScaledVector(v, wid / 2));
      const half = Math.max(4, Math.hypot(vw.x - p0.x, vw.y - p0.y));
      const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      g.translate(p0.x, p0.y); g.rotate(ang);
      g.fillStyle = 'rgba(10,10,11,0.95)';
      g.fillRect(0, -half, Math.hypot(p1.x - p0.x, p1.y - p0.y), half * 2);
    });
  }

  private flap(fl: Flap, dt: number) {
    const target = 0.55 + Math.min(0.7, this.omega * 0.04);
    fl.vel += ((target - fl.ang) * 60 - fl.vel * 5 + (this.rand() - 0.5) * this.omega * 6) * dt;
    fl.ang = THREE.MathUtils.clamp(fl.ang + fl.vel * dt, 0.08, 2.4);
    fl.pivot.rotation.z = fl.ang;
  }

  // ---- 3. smoke that tells you what is hurt ----

  private world(local: THREE.Vector3) { return this.m.body.localToWorld(local.clone()); }

  private every(key: 'weapon' | 'elec' | 'lipo' | 'spark', rate: number, dt: number) {
    if (rate <= 0) return false;
    this.puffClock[key] -= dt;
    if (this.puffClock[key] > 0) return false;
    this.puffClock[key] = 1 / rate;
    return true;
  }

  private systems(dt: number, bv: BotView) {
    const m = this.m, it = bv.internals, smoking: string[] = [];
    // drive: from each side's wheel well
    for (const side of [0, 1] as const) {
      const h = side === 0 ? it.driveL : it.driveR;
      if (h >= 0.6) continue;
      smoking.push(side === 0 ? 'driveL' : 'driveR');
      const ws = m.wheels.filter((w) => (w.position.z < 0 ? 0 : 1) === side);
      if (!ws.length) continue;
      const rate = h < 0.3 ? 9 : 1.5 + (0.6 - h) * 18;
      this.puffClock.drive[side] -= dt;
      if (this.puffClock.drive[side] <= 0) {
        this.puffClock.drive[side] = 1 / rate;
        const w = ws[Math.floor(this.rand() * ws.length)];
        const p = m.root.localToWorld(w.position.clone().setY(w.position.y + 0.04));
        this.fx.smoke(p, 1, h < 0.3 ? 0.18 : 0.55 - (0.6 - h), h < 0.3 ? 0.28 : 0.14 + (0.6 - h) * 0.3);
        if (h < 0.3 && this.rand() < 0.12) this.fx.sparksAt(p, new THREE.Vector3(0, 1, 0), 4, 1.6, 0.8);
      }
    }
    // weapon: from the motor; a hurt rotor stutters, a dead one hangs loose
    const wh = it.weapon;
    const motor = m.weaponPivot ?? m.rotor ?? m.arm ?? m.saw;
    if (wh < 0.5 && motor) {
      smoking.push('weapon');
      if (this.every('weapon', 1 + (0.5 - wh) * 10, dt)) {
        const p = motor.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0));
        this.fx.smoke(p, 1, 0.3, 0.16 + (0.5 - wh) * 0.3);
      }
      if (m.rotor && wh > 0 && bv.rpm > 50) {
        // a dragging bearing: the angle catches and jumps
        if (this.rand() < 0.25) m.rotor.rotation[m.rotorAxis] += (this.rand() - 0.5) * (0.5 - wh) * 1.6;
      }
    }
    if (wh <= 0 && m.weaponPivot) m.weaponPivot.rotation.x = 0.3;
    // electronics: white smoke from the seam, and the lights flicker
    if (it.electronics < 0.5) {
      smoking.push('electronics');
      if (this.every('elec', 1 + (0.5 - it.electronics) * 8, dt)) this.fx.smoke(this.world(this.seamPoint()), 1, 0.88, 0.12);
      m.glow.forEach((g, i) => {
        const mat = g.material as THREE.MeshStandardMaterial;
        const off = this.rand() < (0.5 - it.electronics) * 0.8 || it.electronics <= 0;
        mat.emissiveIntensity = off ? 0.05 : this.glowBase[i];
      });
    }
    // battery: a LiPo puffs before it goes
    if (it.battery < 0.7 && !bv.onFire) {
      smoking.push('battery');
      if (this.every('lipo', 0.25 + (0.7 - it.battery) * 2.2, dt)) {
        this.fx.smoke(this.world(this.seamPoint()), 2 + Math.floor((0.7 - it.battery) * 12), 0.9, 0.22);
      }
    }
    // upside down with the weapon still spinning: it grinds the floor
    if (bv.inverted && bv.weaponOn && bv.rpm > 300 && m.rotor && this.rotorReach) {
      const c = m.rotor.getWorldPosition(new THREE.Vector3());
      if (c.y - this.rotorReach < 0.03 && this.every('spark', 25, dt)) {
        const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(m.root.quaternion);
        this.fx.sparksAt(new THREE.Vector3(c.x, 0.01, c.z), new THREE.Vector3(fwd.x, 0.4, fwd.z).normalize(), 6, 4, 1);
      }
    }
    this.state.smoking = smoking;
  }

  /** a random point on the seam where the top plate meets the walls, body frame */
  private seamPoint() {
    const b = this.box, t = this.rand() * 4, k = this.rand();
    const x = t < 1 ? b.min.x + (b.max.x - b.min.x) * k : t < 2 ? b.max.x : t < 3 ? b.min.x + (b.max.x - b.min.x) * k : b.min.x;
    const z = t < 1 ? b.min.z : t < 2 ? b.min.z + (b.max.z - b.min.z) * k : t < 3 ? b.max.z : b.min.z + (b.max.z - b.min.z) * k;
    return new THREE.Vector3(x * 0.92, b.max.y, z * 0.92);
  }

  // ---- 4. LiPo fire ----

  private fire(dt: number, bv: BotView) {
    this.state.fire = bv.onFire;
    if (!bv.onFire) { this.light.intensity = 0; return; }
    const m = this.m;
    // flames come out of a torn panel if there is one, else the top seam
    const torn = FACES.find((f) => this.faces[f].torn || this.faces[f].holed);
    const from = () => torn ? this.site(torn) : this.seamPoint();
    this.puffClock.fire -= dt;
    while (this.puffClock.fire <= 0) {
      this.puffClock.fire += 1 / 7;
      this.fx.plume(this.world(from()).add(new THREE.Vector3(0, 0.05, 0)), 1, 0.78, 0.32);
    }
    this.puffClock.jet -= dt;
    while (this.puffClock.jet <= 0) {
      this.puffClock.jet += 1 / 18;
      const p = this.world(from());
      const out = p.clone().sub(m.root.position).setY(0).normalize().multiplyScalar(0.35).add(new THREE.Vector3(0, 1, 0)).normalize();
      this.fx.fire(p, out.multiplyScalar(0.55), 2);
    }
    this.light.position.copy(m.root.position).add(new THREE.Vector3(0, 0.35, 0));
    this.light.intensity = 3.5 + Math.sin(this.t * 23) * 1 + this.rand() * 1.5;
  }

  // ---- 6. wheels ----

  private wheels(bv: BotView) {
    const m = this.m, it = bv.internals;
    m.wheels.forEach((w, i) => {
      const side = w.position.z < 0 ? 0 : 1;
      const h = side === 0 ? it.driveL : it.driveR;
      const attached = bv.wheels[i]?.attached ?? true;
      if (!attached) return;
      // a failing drive wobbles on its shaft, a dead one locks and drags
      w.rotation.x = h < 0.3 && h > 0 ? Math.sin(this.t * 31 + i) * 0.07 * (1 - h / 0.3) : 0;
      if (h <= 0) {
        this.lockedAngle[i] ??= w.rotation.z;
        w.rotation.z = this.lockedAngle[i]!;
        if (bv.speedMph > 1.5 && bv.wheels[i]?.contact) {
          const p = m.root.localToWorld(w.position.clone());
          this.scars.rubber(p.x, p.z, 0.07, 0.16);
        }
      }
    });
  }

  /** run a canvas draw clipped to one face's atlas cell, and mark the texture for upload */
  private withCell(f: Face, draw: (g: CanvasRenderingContext2D) => void) {
    const [cellX, cellY] = CELLS[f];
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(cellX * CELL.w, cellY * CELL.h, CELL.w, CELL.h);
    g.clip();
    draw(g);
    g.restore();
    this.dirty = true;
  }

  dispose() {
    this.tex.dispose();
    this.light.removeFromParent();
    this.light.dispose();
    for (const o of this.overlays) o.geometry.dispose();
  }
}

interface Flap { pivot: THREE.Group; ang: number; vel: number }
interface FaceState { sites: THREE.Vector3[]; level: number; chips: number; torn: Flap | null; holed: boolean }

const underside = new THREE.MeshStandardMaterial({ color: '#3a3b3e', metalness: 0.8, roughness: 0.5 });

function jagged(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number, rand: () => number) {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, j = 0.6 + rand() * 0.6;
    const x = cx + Math.cos(t) * r * j, y = cy + Math.sin(t) * r * j;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
}

/** Split every triangle into four, `levels` times (fewer if the longest edge is already short), interpolating every attribute. */
export function subdivide(src: THREE.BufferGeometry, target: number, maxLevels: number) {
  let g = (src.index ? src.toNonIndexed() : src.clone()) as THREE.BufferGeometry;
  const p = g.attributes.position;
  let longest = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) for (let k = 0; k < 3; k++) {
    a.fromBufferAttribute(p, i + k); b.fromBufferAttribute(p, i + ((k + 1) % 3));
    longest = Math.max(longest, a.distanceTo(b));
  }
  const levels = Math.min(maxLevels, Math.max(0, Math.ceil(Math.log2(longest / target))));
  for (let l = 0; l < levels; l++) g = split4(g);
  return g;
}

function split4(g: THREE.BufferGeometry) {
  const out = new THREE.BufferGeometry();
  const n = g.attributes.position.count;
  for (const [name, attr] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
    const k = attr.itemSize, src = attr.array as ArrayLike<number>, dst = new Float32Array(n * 4 * k);
    let o = 0;
    const mid = (i: number, j: number, c: number) => (src[i * k + c] + src[j * k + c]) / 2;
    for (let t = 0; t < n; t += 3) {
      const [i0, i1, i2] = [t, t + 1, t + 2];
      // corners and midpoints as (i, j) pairs: a vertex is the midpoint of itself
      const tri: [number, number][][] = [
        [[i0, i0], [i0, i1], [i2, i0]],
        [[i0, i1], [i1, i1], [i1, i2]],
        [[i2, i0], [i1, i2], [i2, i2]],
        [[i0, i1], [i1, i2], [i2, i0]],
      ];
      for (const tr of tri) for (const [i, j] of tr) for (let c = 0; c < k; c++) dst[o++] = mid(i, j, c);
    }
    out.setAttribute(name, new THREE.BufferAttribute(dst, k));
  }
  for (const gr of g.groups) out.addGroup(gr.start * 4, gr.count * 4, gr.materialIndex);
  return out;
}
