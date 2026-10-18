// Sparks, smoke, fire, flashes and floor scars.
import * as THREE from 'three';
import { softSprite } from './textures';

interface Spark { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; heat: number }
interface Puff { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; size: number; color: THREE.Color; additive: boolean }

const MAX_SPARKS = 3000;
const MAX_PUFFS = 600;

export class Effects {
  readonly group = new THREE.Group();
  private sparks: Spark[] = [];
  private sparkGeo: THREE.BufferGeometry;
  private sparkPos: Float32Array;
  private sparkCol: Float32Array;
  private puffs: Puff[] = [];
  private smokeMesh: THREE.InstancedMesh;
  private fireMesh: THREE.InstancedMesh;
  private flashes: { light: THREE.PointLight; life: number; max: number; power: number }[] = [];
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();
  shake = 0;

  constructor(private camera: THREE.Camera) {
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(MAX_SPARKS * 6);
    this.sparkCol = new Float32Array(MAX_SPARKS * 6);
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(this.sparkGeo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    lines.frustumCulled = false;
    this.group.add(lines);

    const tex = softSprite();
    const plane = new THREE.PlaneGeometry(1, 1);
    this.smokeMesh = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55, color: '#ffffff' }), MAX_PUFFS);
    this.smokeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 3), 3);
    this.smokeMesh.frustumCulled = false;
    this.fireMesh = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), MAX_PUFFS);
    this.fireMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 3), 3);
    this.fireMesh.frustumCulled = false;
    this.group.add(this.smokeMesh, this.fireMesh);

    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight('#ffb35c', 0, 6, 2);
      this.group.add(light);
      this.flashes.push({ light, life: 0, max: 1, power: 0 });
    }
  }

  /** A shower of sparks along a direction. hardness 0 = UHMW (no sparks), titanium = white-hot. */
  sparksAt(pos: THREE.Vector3, dir: THREE.Vector3, count: number, speed: number, heat = 1) {
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
      const v = dir.clone().multiplyScalar(speed * (0.3 + Math.random() * 0.9));
      v.x += (Math.random() - 0.5) * speed * 0.9;
      v.y += Math.random() * speed * 0.6;
      v.z += (Math.random() - 0.5) * speed * 0.9;
      const max = 0.25 + Math.random() * 0.7;
      this.sparks.push({ p: pos.clone(), v, life: max, max, heat: heat * (0.7 + Math.random() * 0.3) });
    }
  }

  smoke(pos: THREE.Vector3, amount: number, dark = 0.25, size = 0.35) {
    for (let i = 0; i < amount; i++) {
      if (this.puffs.length >= MAX_PUFFS) this.puffs.shift();
      const g = dark + Math.random() * 0.15;
      this.puffs.push({
        p: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2)),
        v: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4),
        life: 2.5 + Math.random() * 2, max: 4.5, size: size * (0.6 + Math.random() * 0.8), color: new THREE.Color(g, g, g * 1.02), additive: false,
      });
    }
  }

  fire(pos: THREE.Vector3, dir: THREE.Vector3, amount: number, green = false) {
    for (let i = 0; i < amount; i++) {
      if (this.puffs.length >= MAX_PUFFS) this.puffs.shift();
      const v = dir.clone().multiplyScalar(4 + Math.random() * 3);
      v.y += Math.random() * 1.5;
      v.x += (Math.random() - 0.5) * 1.2; v.z += (Math.random() - 0.5) * 1.2;
      this.puffs.push({
        p: pos.clone(), v, life: 0.35 + Math.random() * 0.25, max: 0.6, size: 0.18 + Math.random() * 0.2,
        color: green ? new THREE.Color(0.4, 1.6, 0.3) : new THREE.Color(2.2, 0.9 + Math.random() * 0.4, 0.2), additive: true,
      });
    }
  }

  flash(pos: THREE.Vector3, power: number, color = '#ffb35c') {
    const f = this.flashes.reduce((a, b) => (a.life < b.life ? a : b));
    f.light.position.copy(pos).add(new THREE.Vector3(0, 0.25, 0));
    f.light.color.set(color);
    f.life = f.max = 0.12 + Math.min(0.25, power * 0.02);
    f.power = power;
  }

  update(dt: number) {
    // sparks: integrate with gravity, bounce off the floor, cool from white to orange
    let n = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) { this.sparks.splice(i, 1); continue; }
      s.v.y -= 9.81 * dt;
      s.v.multiplyScalar(1 - dt * 0.6);
      s.p.addScaledVector(s.v, dt);
      if (s.p.y < 0.005 && s.v.y < 0) { s.p.y = 0.005; s.v.y *= -0.35; s.v.x *= 0.7; s.v.z *= 0.7; }
    }
    for (const s of this.sparks) {
      if (n >= MAX_SPARKS) break;
      const t = s.life / s.max;
      const tail = 0.012 + Math.min(0.06, s.v.length() * 0.004);
      const i6 = n * 6;
      this.sparkPos[i6] = s.p.x; this.sparkPos[i6 + 1] = s.p.y; this.sparkPos[i6 + 2] = s.p.z;
      const vl = s.v.length() || 1;
      this.sparkPos[i6 + 3] = s.p.x - (s.v.x / vl) * tail * 4;
      this.sparkPos[i6 + 4] = s.p.y - (s.v.y / vl) * tail * 4;
      this.sparkPos[i6 + 5] = s.p.z - (s.v.z / vl) * tail * 4;
      const h = s.heat * t;
      const r = 3 * h + 0.6, g = 2.2 * h * h + 0.25 * t, b = 1.6 * h * h * h;
      this.sparkCol[i6] = r; this.sparkCol[i6 + 1] = g; this.sparkCol[i6 + 2] = b;
      this.sparkCol[i6 + 3] = r * 0.2; this.sparkCol[i6 + 4] = g * 0.1; this.sparkCol[i6 + 5] = 0;
      n++;
    }
    this.sparkGeo.setDrawRange(0, n * 2);
    (this.sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.sparkGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    // puffs: billboards facing the camera
    this.camera.getWorldQuaternion(this.tmpQ);
    let ns = 0, nf = 0;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) { this.puffs.splice(i, 1); continue; }
      p.p.addScaledVector(p.v, dt);
      if (p.additive) { p.v.multiplyScalar(1 - dt * 3); p.v.y += dt * 2; } else { p.v.multiplyScalar(1 - dt * 0.4); }
      const t = 1 - p.life / p.max;
      const size = p.additive ? p.size * (1 - t * 0.6) : p.size * (1 + t * 3);
      this.tmpS.setScalar(size);
      this.tmpM.compose(p.p, this.tmpQ, this.tmpS);
      if (p.additive) {
        const fade = 1 - t;
        this.fireMesh.setMatrixAt(nf, this.tmpM);
        this.fireMesh.instanceColor!.setXYZ(nf, p.color.r * fade, p.color.g * fade * fade, p.color.b * fade);
        nf++;
      } else {
        const fade = Math.min(1, p.life / 1.5) * Math.min(1, t * 8);
        this.smokeMesh.setMatrixAt(ns, this.tmpM);
        this.smokeMesh.instanceColor!.setXYZ(ns, p.color.r * fade + (1 - fade) * 0.02, p.color.g * fade + (1 - fade) * 0.02, p.color.b * fade + (1 - fade) * 0.02);
        ns++;
      }
    }
    this.smokeMesh.count = ns;
    this.fireMesh.count = nf;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.fireMesh.instanceMatrix.needsUpdate = true;
    if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
    if (this.fireMesh.instanceColor) this.fireMesh.instanceColor.needsUpdate = true;

    for (const f of this.flashes) {
      f.life = Math.max(0, f.life - dt);
      f.light.intensity = f.life > 0 ? (f.life / f.max) * Math.min(60, 4 + f.power * 1.5) : 0;
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }
}

/** Persistent floor scars: scorch, gouges and tire rubber stamped into a canvas overlay. */
export class FloorScars {
  readonly mesh: THREE.Mesh;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private dirty = false;
  constructor(private size: number, res = 2048) {
    const c = document.createElement('canvas');
    c.width = c.height = res;
    this.ctx = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: this.tex, transparent: true, depthWrite: false, roughness: 0.9, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.002;
    this.mesh.receiveShadow = true;
  }
  private toPx(x: number, z: number) {
    const r = this.ctx.canvas.width;
    return [(x / this.size + 0.5) * r, (z / this.size + 0.5) * r];
  }
  scorch(x: number, z: number, radius: number, strength = 0.5) {
    const [px, py] = this.toPx(x, z);
    const rp = (radius / this.size) * this.ctx.canvas.width;
    const g = this.ctx.createRadialGradient(px, py, 0, px, py, rp);
    g.addColorStop(0, `rgba(10,8,6,${0.5 * strength})`);
    g.addColorStop(0.6, `rgba(25,18,10,${0.25 * strength})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    this.ctx.fillStyle = g;
    this.ctx.fillRect(px - rp, py - rp, rp * 2, rp * 2);
    this.dirty = true;
  }
  gouge(x: number, z: number, dx: number, dz: number, len: number) {
    const [px, py] = this.toPx(x, z);
    const s = this.ctx.canvas.width / this.size;
    this.ctx.strokeStyle = 'rgba(200,205,210,0.55)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(px, py);
    this.ctx.lineTo(px + dx * len * s, py + dz * len * s);
    this.ctx.stroke();
    this.ctx.strokeStyle = 'rgba(15,15,15,0.5)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(px + 2, py + 1);
    this.ctx.lineTo(px + dx * len * s + 2, py + dz * len * s + 1);
    this.ctx.stroke();
    this.dirty = true;
  }
  rubber(x: number, z: number, w: number) {
    const [px, py] = this.toPx(x, z);
    const s = (w / this.size) * this.ctx.canvas.width;
    this.ctx.fillStyle = 'rgba(8,8,8,0.035)';
    this.ctx.fillRect(px - s / 2, py - s / 2, s, s);
    this.dirty = true;
  }
  clear() {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.dirty = true;
  }
  flush() {
    if (this.dirty) { this.tex.needsUpdate = true; this.dirty = false; }
  }
}
