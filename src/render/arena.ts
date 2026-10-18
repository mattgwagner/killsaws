// The BattleBox, drawn: steel floor, markings, spiked rails, Lexan box,
// screws, killsaws, Pulverizers, paddles, Upper Deck, lights and the crowd.
import * as THREE from 'three';
import { ARENA_SIZE, ArenaLayout, FT, HALF, LEXAN_HEIGHT, RAIL_DEPTH, RAIL_HEIGHT } from '../sim/arena';
import { HazardView } from '../sim/match';
import { crowdTexture, floorTextures, hazardStripes, textTexture } from './textures';

const std = (color: string, metal = 0.3, rough = 0.5, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...extra });

export class ArenaView {
  readonly group = new THREE.Group();
  private saws = new Map<string, { blade: THREE.Object3D; base: number }>();
  private screws = new Map<string, { mesh: THREE.Object3D; axis: 'x' | 'z' }>();
  private pulvs = new Map<string, THREE.Object3D>();
  private paddles = new Map<string, { mesh: THREE.Object3D; nx: number; nz: number; base: THREE.Vector3 }>();
  private ramrods = new Map<string, THREE.Object3D>();
  private leds: THREE.MeshStandardMaterial;
  private startLights: THREE.MeshStandardMaterial[] = [];
  readonly screens: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }[] = [];

  constructor(readonly layout: ArenaLayout) {
    const g = this.group;
    // --- floor ---
    const ft = floorTextures(2048, 12);
    ft.map.wrapS = ft.map.wrapT = THREE.ClampToEdgeWrapping;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE), new THREE.MeshStandardMaterial({
      map: ft.map, roughnessMap: ft.rough, metalness: 0.65, roughness: 0.62, envMapIntensity: 0.6,
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);

    // markings painted on the floor
    const marks = document.createElement('canvas');
    marks.width = marks.height = 2048;
    const mc = marks.getContext('2d')!;
    const px = (m: number) => (m / ARENA_SIZE + 0.5) * 2048;
    const sq = (x: number, z: number, size: number, color: string) => {
      mc.strokeStyle = color; mc.lineWidth = 16;
      mc.strokeRect(px(x - size / 2), px(z - size / 2), (size / ARENA_SIZE) * 2048, (size / ARENA_SIZE) * 2048);
      mc.fillStyle = color.replace('1)', '0.18)');
      mc.fillRect(px(x - size / 2), px(z - size / 2), (size / ARENA_SIZE) * 2048, (size / ARENA_SIZE) * 2048);
    };
    sq(layout.starts[0].x, layout.starts[0].z, 8 * FT, 'rgba(225,30,40,1)');
    sq(layout.starts[1].x, layout.starts[1].z, 8 * FT, 'rgba(30,110,235,1)');
    sq(0, 2.0, 8 * FT, 'rgba(235,235,235,1)'); // white square through the center killsaw set
    // killsaw slot outlines
    for (const k of layout.killsaws) {
      const w = k.axis === 'x' ? 1.2 : 0.18, h = k.axis === 'x' ? 0.18 : 1.2;
      mc.fillStyle = '#0a0a0a';
      mc.fillRect(px(k.x - w / 2), px(k.z - h / 2), (w / ARENA_SIZE) * 2048, (h / ARENA_SIZE) * 2048);
      mc.strokeStyle = '#f2c400'; mc.lineWidth = 6;
      mc.strokeRect(px(k.x - w / 2 - 0.08), px(k.z - h / 2 - 0.08), ((w + 0.16) / ARENA_SIZE) * 2048, ((h + 0.16) / ARENA_SIZE) * 2048);
    }
    // Pulverizer impact zones (red and blue dots)
    for (const p of layout.pulverizers) {
      mc.fillStyle = p.team === 0 ? 'rgba(225,30,40,0.55)' : 'rgba(30,110,235,0.55)';
      mc.beginPath(); mc.arc(px(p.x), px(p.z), (p.reach * 0.75 / ARENA_SIZE) * 2048, 0, Math.PI * 2); mc.fill();
      mc.strokeStyle = '#f2c400'; mc.lineWidth = 6; mc.stroke();
    }
    // center logo
    mc.save();
    mc.translate(1024, 1024);
    mc.font = '900 120px Oswald, Impact, sans-serif';
    mc.textAlign = 'center'; mc.textBaseline = 'middle';
    mc.lineWidth = 10; mc.strokeStyle = 'rgba(0,0,0,0.5)';
    mc.strokeText('KILLSAWS', 0, -60);
    mc.fillStyle = 'rgba(240,240,240,0.55)';
    mc.fillText('KILLSAWS', 0, -60);
    mc.font = '700 40px Oswald, Impact, sans-serif';
    mc.fillStyle = 'rgba(242,196,0,0.6)';
    mc.fillText('HEAVYWEIGHT  ·  250 LB', 0, 20);
    mc.restore();
    // ramrod holes
    for (const r of layout.ramrods) {
      mc.fillStyle = '#111'; mc.beginPath(); mc.arc(px(r.x), px(r.z), 8, 0, Math.PI * 2); mc.fill();
      mc.strokeStyle = '#f2c400'; mc.lineWidth = 3; mc.stroke();
    }
    const markTex = new THREE.CanvasTexture(marks);
    markTex.colorSpace = THREE.SRGBColorSpace;
    markTex.anisotropy = 8;
    const markMesh = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE), new THREE.MeshStandardMaterial({ map: markTex, color: '#9a9a9a', transparent: true, depthWrite: false, roughness: 0.85, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1 }));
    markMesh.rotation.x = -Math.PI / 2;
    markMesh.position.y = 0.001;
    markMesh.receiveShadow = true;
    g.add(markMesh);

    // --- spiked perimeter rail ---
    const stripes = hazardStripes();
    stripes.repeat.set(40, 1);
    const railMat = std('#f2c400', 0.3, 0.5, { map: stripes });
    const spikeMat = std('#d9dce0', 0.9, 0.3);
    const spikeGeo = new THREE.ConeGeometry(0.035, 0.12, 8);
    const spikes = new THREE.InstancedMesh(spikeGeo, spikeMat, 600);
    let si = 0;
    const m4 = new THREE.Matrix4();
    for (const [x, z, sx, sz] of [[0, -HALF + RAIL_DEPTH / 2, ARENA_SIZE, RAIL_DEPTH], [0, HALF - RAIL_DEPTH / 2, ARENA_SIZE, RAIL_DEPTH], [-HALF + RAIL_DEPTH / 2, 0, RAIL_DEPTH, ARENA_SIZE], [HALF - RAIL_DEPTH / 2, 0, RAIL_DEPTH, ARENA_SIZE]]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(sx, RAIL_HEIGHT, sz), railMat);
      rail.position.set(x, RAIL_HEIGHT / 2, z);
      rail.castShadow = rail.receiveShadow = true;
      g.add(rail);
      const n = 70;
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1) - 0.5) * ARENA_SIZE * 0.98;
        const sxp = sx > sz ? t : x + (x < 0 ? 1 : -1) * RAIL_DEPTH * 0.45;
        const szp = sx > sz ? z + (z < 0 ? 1 : -1) * RAIL_DEPTH * 0.45 : t;
        const q = new THREE.Quaternion().setFromAxisAngle(sx > sz ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), (sx > sz ? (z < 0 ? 1 : -1) : (x < 0 ? -1 : 1)) * 1.2);
        m4.compose(new THREE.Vector3(sxp, RAIL_HEIGHT * 0.75, szp), q, new THREE.Vector3(1, 1, 1));
        if (si < 600) spikes.setMatrixAt(si++, m4);
      }
    }
    spikes.count = si;
    spikes.castShadow = true;
    g.add(spikes);

    // --- walls: steel kick plates + Lexan to the roof ---
    const kick = std('#24272b', 0.85, 0.45);
    const lexan = new THREE.MeshPhysicalMaterial({ color: '#bcd4e6', metalness: 0, roughness: 0.06, transmission: 0.0, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.5 });
    const frame = std('#16181b', 0.8, 0.4);
    const panel = 4 * FT;
    for (let side = 0; side < 4; side++) {
      const wallG = new THREE.Group();
      const kp = new THREE.Mesh(new THREE.BoxGeometry(ARENA_SIZE, 0.6, 0.08), kick);
      kp.position.set(0, 0.3, -HALF - 0.04);
      kp.receiveShadow = true;
      wallG.add(kp);
      const lx = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_SIZE, LEXAN_HEIGHT - 0.6), lexan);
      lx.position.set(0, 0.6 + (LEXAN_HEIGHT - 0.6) / 2, -HALF - 0.06);
      wallG.add(lx);
      for (let i = 0; i <= 12; i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, LEXAN_HEIGHT, 0.08), frame);
        post.position.set(-HALF + i * panel, LEXAN_HEIGHT / 2, -HALF - 0.1);
        wallG.add(post);
      }
      for (const y of [0.6, 0.6 + panel, 0.6 + panel * 2, LEXAN_HEIGHT]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(ARENA_SIZE, 0.07, 0.07), frame);
        beam.position.set(0, y, -HALF - 0.1);
        wallG.add(beam);
      }
      // LED strip: lights up when the killsaws go live
      wallG.rotation.y = (side * Math.PI) / 2;
      g.add(wallG);
    }
    this.leds = std('#ff2a1a', 0, 0.4, { emissive: '#ff2a1a', emissiveIntensity: 0.05 });
    for (let side = 0; side < 4; side++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(ARENA_SIZE, 0.03, 0.02), this.leds);
      led.position.set(0, 0.62, -HALF - 0.02);
      const holder = new THREE.Group();
      holder.add(led);
      holder.rotation.y = (side * Math.PI) / 2;
      g.add(holder);
    }

    // roof truss with lights
    const truss = std('#1b1d20', 0.7, 0.5);
    for (let i = -2; i <= 2; i++) {
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(ARENA_SIZE, 0.25, 0.25), truss);
      b1.position.set(0, LEXAN_HEIGHT + 0.3, i * 3);
      g.add(b1);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, ARENA_SIZE), truss);
      b2.position.set(i * 3, LEXAN_HEIGHT + 0.3, 0);
      g.add(b2);
    }
    const lampMat = std('#fff', 0, 0.3, { emissive: '#fff4e0', emissiveIntensity: 2.5 });
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 16), lampMat);
      lamp.position.set(i * 3, LEXAN_HEIGHT + 0.12, j * 3);
      g.add(lamp);
    }

    // starting lights (red -> green) in the corners
    for (const [x, z] of [[-HALF, -HALF], [HALF, HALF], [-HALF, HALF], [HALF, -HALF]]) {
      const m = std('#ff0000', 0, 0.3, { emissive: '#ff0000', emissiveIntensity: 3 });
      this.startLights.push(m);
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), m);
      l.position.set(x * 0.98, 1.0, z * 0.98);
      g.add(l);
    }

    // --- screws ---
    const screwMat = std('#c3c7cc', 0.95, 0.28);
    const troughMat = std('#0d0e10', 0.6, 0.7);
    for (const s of layout.screws) {
      const holder = new THREE.Group();
      const y = s.radius * (s.deck ? 0.95 : 0.55);
      holder.position.set(s.x, y, s.z);
      const auger = new THREE.Group();
      const core = new THREE.Mesh(new THREE.CylinderGeometry(s.radius * 0.35, s.radius * 0.35, s.length, 16), screwMat);
      auger.add(core);
      // helical flight
      const turns = s.length / (s.radius * 1.1);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= turns * 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * s.radius * 0.82, -s.length / 2 + (i / (turns * 32)) * s.length, Math.sin(a) * s.radius * 0.82));
      }
      const flight = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.floor(turns * 64), s.radius * 0.17, 6), screwMat);
      flight.scale.set(1, 1, 1);
      auger.add(flight);
      // serrated teeth
      const teeth = new THREE.InstancedMesh(new THREE.ConeGeometry(0.02, 0.06, 4), screwMat, Math.floor(turns * 8));
      for (let i = 0; i < teeth.count; i++) {
        const a = (i / 8) * Math.PI * 2;
        const yy = -s.length / 2 + (i / teeth.count) * s.length;
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
        m4.compose(new THREE.Vector3(Math.cos(a) * s.radius, yy, Math.sin(a) * s.radius), q, new THREE.Vector3(1, 1, 1));
        teeth.setMatrixAt(i, m4);
      }
      auger.add(teeth);
      auger.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
      if (s.axis === 'z') auger.rotation.x = Math.PI / 2; else auger.rotation.z = Math.PI / 2;
      const spinner = new THREE.Group();
      spinner.add(auger);
      holder.add(spinner);
      g.add(holder);
      this.screws.set(s.id, { mesh: spinner, axis: s.axis });
      if (!s.deck) {
        const trough = new THREE.Mesh(new THREE.BoxGeometry(s.axis === 'z' ? s.radius * 2.6 : s.length + 0.3, 0.02, s.axis === 'z' ? s.length + 0.3 : s.radius * 2.6), troughMat);
        trough.position.set(s.x, 0.004, s.z);
        g.add(trough);
      }
    }

    // --- Upper Deck ---
    if (layout.deck) {
      const d = layout.deck;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.d), std('#a3161c', 0.3, 0.55));
      deck.position.set(d.x, d.h / 2, d.z);
      deck.castShadow = deck.receiveShadow = true;
      g.add(deck);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(d.w * 0.8, d.d * 0.4), new THREE.MeshBasicMaterial({ map: textTexture('UPPER DECK', { color: 'rgba(255,255,255,0.7)' }), transparent: true }));
      lbl.rotation.x = -Math.PI / 2;
      lbl.position.set(d.x, d.h + 0.003, d.z);
      g.add(lbl);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(d.w, 0.03, 0.06), railMat);
      edge.position.set(d.x, d.h + 0.015, d.z + d.d / 2);
      g.add(edge);
    }

    // --- killsaws ---
    const bladeMat = std('#dfe3e8', 1, 0.2);
    for (const k of layout.killsaws) {
      const holder = new THREE.Group();
      holder.position.set(k.x, -k.radius, k.z);
      const blade = new THREE.Group();
      for (let layer = 0; layer < 3; layer++) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(k.radius * (1 - layer * 0.08), k.radius * (1 - layer * 0.08), 0.008, 48), bladeMat);
        disc.rotation.x = Math.PI / 2;
        disc.position.z = (layer - 1) * 0.012;
        blade.add(disc);
      }
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 3), bladeMat);
        tooth.position.set(Math.cos(a) * k.radius, Math.sin(a) * k.radius, 0);
        tooth.rotation.z = a - Math.PI / 2;
        blade.add(tooth);
      }
      if (k.axis === 'x') holder.rotation.y = 0; else holder.rotation.y = Math.PI / 2;
      holder.add(blade);
      g.add(holder);
      this.saws.set(k.id, { blade: holder, base: -k.radius });
      (blade as THREE.Object3D).userData.spin = blade;
    }

    // --- Pulverizers ---
    for (const p of layout.pulverizers) {
      const holder = new THREE.Group();
      // pivot sits behind the corner rail, arm swings down toward the arena
      const toCenter = new THREE.Vector3(-p.x, 0, -p.z).normalize();
      const pivot = new THREE.Vector3(p.x, 0, p.z).addScaledVector(toCenter, -1.35);
      holder.position.set(pivot.x, 1.7, pivot.z);
      holder.lookAt(new THREE.Vector3(p.x, 1.7, p.z));
      const arm = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.4), std('#2b2e33', 0.8, 0.4));
      beam.position.z = 0.7;
      arm.add(beam);
      const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), std('#8a8f95', 0.95, 0.3));
      head.scale.set(1, 0.7, 1);
      head.position.set(0, -0.15, 1.35);
      arm.add(head);
      arm.traverse((o) => { o.castShadow = true; });
      holder.add(arm);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.9, 0.3), std(p.team === 0 ? '#9c1b20' : '#1b4f9c', 0.5, 0.4));
      post.position.set(0, -0.85, -0.1);
      holder.add(post);
      g.add(holder);
      this.pulvs.set(p.id, arm);
    }

    // --- paddles ---
    for (const pd of layout.paddles) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, pd.length), railMat);
      const base = new THREE.Vector3(pd.x + pd.normal.x * 0.05, 0.25, pd.z + pd.normal.z * 0.05);
      m.position.copy(base);
      if (pd.normal.z !== 0) m.rotation.y = Math.PI / 2;
      g.add(m);
      this.paddles.set(pd.id, { mesh: m, nx: pd.normal.x, nz: pd.normal.z, base });
    }

    // --- ramrods ---
    for (const r of layout.ramrods) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 10), std('#cfd2d6', 0.9, 0.3));
      sp.position.set(r.x, -0.12, r.z);
      g.add(sp);
      this.ramrods.set(r.id, sp);
    }

    // --- outside the box: stands, crowd, screens ---
    const stand = std('#0b0c0f', 0.2, 0.9);
    const crowd = crowdTexture();
    crowd.repeat.set(6, 1);
    for (let side = 0; side < 4; side++) {
      const holder = new THREE.Group();
      for (let row = 0; row < 3; row++) {
        const tier = new THREE.Mesh(new THREE.BoxGeometry(ARENA_SIZE + 10, 1.2, 2.2), stand);
        tier.position.set(0, 0.6 + row * 1.3, -HALF - 3.2 - row * 2.2);
        holder.add(tier);
      }
      const people = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_SIZE + 10, 4.2), new THREE.MeshBasicMaterial({ map: crowd, color: '#8a8a95' }));
      people.position.set(0, 3.3, -HALF - 4.6);
      people.rotation.x = 0.35;
      holder.add(people);
      holder.rotation.y = (side * Math.PI) / 2;
      g.add(holder);
    }
    for (let i = 0; i < 2; i++) {
      const c = document.createElement('canvas');
      c.width = 1024; c.height = 512;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      scr.position.set(i === 0 ? -5 : 5, LEXAN_HEIGHT + 1.2, -HALF - 1.5);
      g.add(scr);
      this.screens.push({ canvas: c, tex });
    }
  }

  update(h: HazardView, live: boolean, phase: string, countdown: number) {
    this.layout.killsaws.forEach((k, i) => {
      const s = this.saws.get(k.id)!;
      const v = h.saws[i];
      s.blade.position.y = s.base + v.rise * (k.radius + 0.17) + (live ? 0.02 : 0);
      const spin = s.blade.children[0];
      spin.rotation.z = v.angle;
    });
    this.layout.screws.forEach((sc, i) => {
      const s = this.screws.get(sc.id)!;
      if (sc.axis === 'z') s.mesh.rotation.z = h.screws[i].angle; else s.mesh.rotation.x = h.screws[i].angle;
    });
    this.layout.pulverizers.forEach((p, i) => {
      const arm = this.pulvs.get(p.id)!;
      arm.rotation.x = -0.7 + h.pulverizers[i].swing * 1.62;
    });
    this.layout.paddles.forEach((p, i) => {
      const pd = this.paddles.get(p.id)!;
      const k = h.paddles[i].kick;
      pd.mesh.position.set(pd.base.x + pd.nx * k * 0.35, pd.base.y, pd.base.z + pd.nz * k * 0.35);
    });
    this.layout.ramrods.forEach((r, i) => {
      this.ramrods.get(r.id)!.position.y = -0.12 + h.ramrods[i].rise * 0.2;
    });
    const t = performance.now() / 1000;
    this.leds.emissiveIntensity = live ? 2 + Math.sin(t * 10) * 1.6 : 0.05;
    const green = phase === 'fight';
    for (const m of this.startLights) {
      const c = green ? '#00ff44' : countdown > 0 ? '#ff0000' : '#ff0000';
      m.color.set(c); m.emissive.set(c);
      m.emissiveIntensity = green ? 3 : 2 + Math.sin(t * 8);
    }
  }
}
