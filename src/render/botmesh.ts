// Procedural robot models, built from the same design numbers the physics
// uses (hull, wheel positions, rotor radius and mount), plus per-bot
// signature details so each roster bot reads as itself.

import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { BotDesign, isVertical, wheelCenterY } from '../sim/design';
import { chassisHull } from '../sim/bot';
import { paintTexture, textTexture } from './textures';
import { IN } from '../sim/parts';
import { blueprintGeometry, deckPlate } from './blueprintMesh';
import { frameOf, frontXAt } from '../sim/blueprint';

export interface BotMesh {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  rotor: THREE.Object3D | null;
  rotorAxis: 'y' | 'z';
  arm: THREE.Object3D | null; // flipper plate / hammer / saw arm / crusher jaw / lifter
  armKind: 'flipper' | 'hammer' | 'saw' | 'crusher' | 'lifter' | null;
  secondaryArm: THREE.Object3D | null;
  saw: THREE.Object3D | null;
  slide: THREE.Object3D | null;
  flameNozzle: THREE.Vector3 | null;
  glow: THREE.Mesh[];
  paint: THREE.MeshPhysicalMaterial;
  damage: THREE.Group;
  hullHalf: THREE.Vector3;
  /** blueprint arms: [rest, strike] angles (rad) */
  armRange?: [number, number];
  /** flame nozzle in the arm's frame (Blacksmith's flaming hammer head) */
  headFlame?: THREE.Vector3;
}

const std = (color: string | number, metal = 0.2, rough = 0.5, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}) =>
  new THREE.MeshPhysicalMaterial({ color, metalness: metal, roughness: rough, ...extra });

const steel = () => std('#8f959b', 0.8, 0.45);
const darkSteel = () => std('#3b3e43', 0.75, 0.55);
const rubber = (c = '#1b1b1b') => std(c, 0, 0.85);

function box(w: number, h: number, d: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(r: number, h: number, mat: THREE.Material, seg = 32, axis: 'x' | 'y' | 'z' = 'y') {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Planar UVs from the top view so paint patterns land on the deck. */
function topUV(g: THREE.BufferGeometry, L: number, W: number) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / (L * 1.4) + 0.5;
    uv[i * 2 + 1] = p.getZ(i) / (W * 1.4) + 0.5 + p.getY(i) * 0.3;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function buildBot(d: BotDesign): BotMesh {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const look = d.look;
  const f = new Set(look.features ?? []);
  const { length: L, width: W, height: H, clearance } = d.chassis;
  const hx = L / 2, hy = H / 2, hz = W / 2;
  const glow: THREE.Mesh[] = [];

  const paintTex = paintTexture(look.primary, look.secondary, look.accent, f.has('snake-scales') ? 'checker' : look.pattern ?? 'solid', d.id.length * 13);
  const paint = std(look.primary, f.has('bare-metal') || f.has('raw-steel') ? 0.75 : 0.25, f.has('bare-metal') ? 0.5 : 0.58, {
    map: paintTex, clearcoat: f.has('raw-steel') || f.has('bare-metal') ? 0 : 0.35, clearcoatRoughness: 0.5,
  });
  const second = std(look.secondary, 0.35, 0.62, { clearcoat: 0.12 });
  const accent = std(look.accent, 0.25, 0.5, { clearcoat: 0.3 });

  // --- hull (same convex hull as the physics collider) ---
  const pts = chassisHull(d);
  const vecs: THREE.Vector3[] = [];
  for (let i = 0; i < pts.length; i += 3) vecs.push(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
  let hullGeo: THREE.BufferGeometry;
  const bp = d.chassis.blueprint;
  if (bp) {
    hullGeo = blueprintGeometry(bp).geometry;
    topUV(hullGeo, L, W);
    paint.side = THREE.DoubleSide;
  } else if (d.chassis.shape === 'ring') {
    hullGeo = new THREE.CylinderGeometry(hx * 0.97, hx, H, 48);
  } else {
    hullGeo = new ConvexGeometry(vecs);
    topUV(hullGeo, L, W);
  }
  const hull = new THREE.Mesh(hullGeo, bp?.front?.color ? [paint, std(bp.front.color, 0.75, 0.5, { side: THREE.DoubleSide })] : paint);
  hull.castShadow = true; hull.receiveShadow = true;
  body.add(hull);
  // vertical spinners sit in a slot cut through the nose: draw the hull as a rear block + two cheeks
  const wv = d.weapon;
  if (!bp && wv.type === 'spinner' && isVertical(wv.style) && d.id !== 'huge' && d.chassis.shape !== 'ring') {
    const slot = wv.width / 2 + 0.012;
    const xs = wv.mountX - wv.radius * 0.45;
    const maxX = Math.max(...vecs.map((v) => v.x));
    if (xs < maxX - 0.01) {
      const pieces: THREE.Vector3[][] = [vecs.map((v) => new THREE.Vector3(Math.min(v.x, xs), v.y, v.z))];
      for (const sgn of [-1, 1]) {
        const side = vecs.map((v) => new THREE.Vector3(Math.max(v.x, xs), v.y, sgn > 0 ? Math.max(v.z, slot) : Math.min(v.z, -slot)));
        if (Math.max(...side.map((v) => Math.abs(v.z))) > slot + 0.015) pieces.push(side);
      }
      hull.visible = false;
      for (const pc of pieces) {
        const g = new ConvexGeometry(pc);
        topUV(g, L, W);
        const m = new THREE.Mesh(g, paint);
        m.castShadow = true; m.receiveShadow = true;
        body.add(m);
      }
      // dark slot floor so you see into it
      const floorPlate = box(Math.max(0.02, maxX - xs), 0.006, slot * 2, std('#111214', 0.6, 0.6));
      floorPlate.position.set((xs + maxX) / 2, -hy, 0);
      body.add(floorPlate);
    }
  }

  // deck plate, bolts, logo
  let logoAt = new THREE.Vector3(-L * 0.08, hy, 0);
  if (bp) {
    const plate = deckPlate(bp);
    if (plate) {
      const m = new THREE.Mesh(plate.geometry, second);
      second.side = THREE.DoubleSide;
      m.receiveShadow = true;
      body.add(m);
      logoAt = plate.center;
      // bolts around the deck plate edge
      const boltGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.006, 8);
      const ring = plate.seg;
      const bolts = new THREE.InstancedMesh(boltGeo, darkSteel(), 64);
      let k = 0;
      for (let i = 0; i < ring.length && k < 64; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const n = Math.max(1, Math.floor(Math.hypot(b.x - a.x, b.z - a.z) / 0.12));
        for (let j = 0; j < n && k < 64; j++) {
          const t = (j + 0.5) / n;
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          bolts.setMatrixAt(k++, new THREE.Matrix4().makeTranslation(logoAt.x + (x - logoAt.x) * 0.93, hy + 0.005, logoAt.z + (z - logoAt.z) * 0.93));
        }
      }
      bolts.count = k;
      body.add(bolts);
    }
  }
  if (!bp && d.chassis.shape !== 'ring') {
    const deck = box(L * 0.82, 0.004, W * 0.78 * (d.chassis.noseTaper ?? 1) ** 0.3, second);
    deck.position.set(-L * 0.04, hy + 0.002, 0);
    body.add(deck);
    const boltMat = darkSteel();
    const boltGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.006, 8);
    const bolts = new THREE.InstancedMesh(boltGeo, boltMat, 24);
    let k = 0;
    for (let i = 0; i < 6; i++) for (const sz of [-1, 1]) {
      const m = new THREE.Matrix4().makeTranslation(-hx * 0.9 + (i / 5) * hx * 1.6, hy + 0.004, sz * hz * 0.9 * (i > 3 ? (d.chassis.noseTaper ?? 1) : 1));
      bolts.setMatrixAt(k++, m);
    }
    for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) {
      const m = new THREE.Matrix4().makeTranslation(sx * hx * 0.94, hy + 0.004, -hz * 0.8 + (i / 5) * hz * 1.6);
      bolts.setMatrixAt(k++, m);
    }
    bolts.count = k;
    body.add(bolts);
  }
  if (look.logo) {
    const t = textTexture(look.logo, { color: f.has('bare-metal') ? '#1a1a1a' : '#ffffff', stroke: '#000', font: '"Oswald", "Impact", sans-serif' });
    const logoW = d.chassis.shape === 'ring' ? W * 0.7 : Math.min(L * 0.75, W * 1.5);
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(logoW, logoW * 0.25), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    logo.rotation.x = -Math.PI / 2;
    logo.rotation.z = Math.PI / 2;
    logo.position.set(logoAt.x, hy + 0.0065, logoAt.z);
    if (d.chassis.shape === 'ring') logo.position.y = hy + 0.02;
    body.add(logo);
  }

  // forks / wedgelets
  if (d.chassis.forks) {
    const forkMat = f.has('green-forks') || f.has('three-forks') || f.has('accent-forks') || f.has('crab-legs') ? accent : f.has('piano-keys') ? second : steel();
    const n = f.has('piano-keys') ? 6 : f.has('three-forks') ? 3 : f.has('crab-legs') ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const zc = n === 2 ? (i === 0 ? -1 : 1) * W * 0.33 : (i / (n - 1) - 0.5) * W * 0.8;
      const legs = f.has('crab-legs');
      const fz = legs ? (i < 2 ? -1 : 1) * (i % 3 === 0 ? W * 0.33 : W * 0.19) : zc;
      const fx = bp ? frontXAt(bp, fz) : hx + d.chassis.wedgeLength;
      if (legs) {
        // crab legs: long black blades angled down from the front edge to the floor
        const leg = box(0.28, 0.035, 0.03, forkMat);
        leg.position.set(fx + 0.1, -hy - clearance * 0.5 + 0.05, fz);
        leg.rotation.z = -0.42;
        body.add(leg);
        continue;
      }
      const fork = box(0.22, 0.012, n > 3 ? W * 0.12 : 0.07, forkMat);
      fork.position.set(fx + 0.05, -hy - clearance + 0.012, zc);
      fork.rotation.z = -0.08;
      body.add(fork);
    }
  }

  // --- wheels ---
  const wheels: THREE.Object3D[] = [];
  const r = d.drive.wheelDiameter / 2;
  const wy = wheelCenterY(d) - 0.006;
  const xs = d.drive.wheels === 2 ? [d.drive.axleX ?? 0] : d.drive.wheels === 4
    ? [(d.drive.axleX ?? 0) - d.drive.wheelbase / 2, (d.drive.axleX ?? 0) + d.drive.wheelbase / 2]
    : [(d.drive.axleX ?? 0) - d.drive.wheelbase / 2, d.drive.axleX ?? 0, (d.drive.axleX ?? 0) + d.drive.wheelbase / 2];
  const tireMat = rubber(look.tireColor ?? '#1b1b1b');
  const hubMat = f.has('uhmw-wheels') ? std('#f2f2ee', 0, 0.6) : std(look.accent === '#ffffff' ? '#888' : look.accent, 0.5, 0.4);
  for (const x of xs) for (const side of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(x, wy, side * d.drive.track / 2);
    if (f.has('uhmw-wheels')) {
      // HUGE: a flat white disc with two rings of six teardrop cut-outs
      const disc = new THREE.Mesh(new THREE.RingGeometry(r * 0.86, r, 64), hubMat);
      const shape = new THREE.Shape();
      shape.absarc(0, 0, r, 0, Math.PI * 2, false);
      for (const [rr, sz] of [[r * 0.62, r * 0.13], [r * 0.32, r * 0.09]] as const) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + (rr < r * 0.5 ? Math.PI / 6 : 0);
          const hole = new THREE.Path();
          hole.absellipse(Math.cos(a) * rr, Math.sin(a) * rr, sz, sz * 1.5, 0, Math.PI * 2, false, a);
          shape.holes.push(hole);
        }
      }
      const ex = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: d.drive.wheelWidth, bevelEnabled: false, curveSegments: 32 }), hubMat);
      ex.position.z = -d.drive.wheelWidth / 2;
      ex.castShadow = true;
      g.add(ex);
      void disc;
      const stub = cyl(0.015, 0.16, steel(), 12, 'z');
      stub.position.z = side * 0.08;
      g.add(stub);
    } else {
      const tire = cyl(r, d.drive.wheelWidth, tireMat, 36, 'z');
      g.add(tire);
      // tread blocks so you can see it turning
      const tread = new THREE.InstancedMesh(new THREE.BoxGeometry(r * 0.12, r * 0.06, d.drive.wheelWidth * 1.02), tireMat, 18);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const m = new THREE.Matrix4().makeRotationZ(a).setPosition(Math.cos(a) * r * 0.99, Math.sin(a) * r * 0.99, 0);
        tread.setMatrixAt(i, m);
      }
      g.add(tread);
      const hub = cyl(r * 0.55, d.drive.wheelWidth * 1.04, hubMat, 6, 'z');
      g.add(hub);
      if (f.has('race-tires')) {
        const lip = cyl(r * 0.62, d.drive.wheelWidth * 1.06, std('#d0d0d0', 0.9, 0.3), 24, 'z');
        g.add(lip);
      }
    }
    root.add(g);
    wheels.push(g);
  }

  // --- weapon ---
  let rotor: THREE.Object3D | null = null;
  let rotorAxis: 'y' | 'z' = 'y';
  let arm: THREE.Object3D | null = null;
  let armKind: BotMesh['armKind'] = null;
  let saw: THREE.Object3D | null = null;
  let armRange: [number, number] | undefined;
  let headFlame: THREE.Vector3 | undefined;
  let slide: THREE.Object3D | null = null;
  let secondaryArm: THREE.Object3D | null = null;
  const w = d.weapon;
  const toolSteel = std(f.has('gold-drum') ? '#a8843a' : '#7d838a', 0.8, 0.42);
  if (w.type === 'spinner') {
    const R = w.radius;
    const pivot = new THREE.Group();
    pivot.position.set(w.mountX, w.mountY, 0);
    const spin = new THREE.Group();
    pivot.add(spin);
    rotor = spin;
    rotorAxis = isVertical(w.style) ? 'z' : 'y';
    const barMat = d.id === 'tombstone' ? std(look.accent, 0.7, 0.35, { clearcoat: 0.3 }) : d.id === 'huge' ? std('#24406b', 0.7, 0.35) : f.has('black-rotor') ? std('#161616', 0.6, 0.5) : f.has('blue-rotor') ? std('#2f6fd0', 0.6, 0.45) : toolSteel;
    const toothMat = f.has('green-teeth') ? std('#3ddc3a', 0.4, 0.35) : f.has('gold-plow') || f.has('gold-stripe') ? std('#c9a332', 0.8, 0.38) : std('#b4b8bd', 0.8, 0.36);
    const tw = w.width;
    switch (w.style) {
      case 'horizontal-bar': {
        const rs = bp?.rotor;
        if (f.has('cage-of-death')) {
          // Son of Whyachi: three black box arms, red tube triangle, hammers hanging low
          const armMat = std('#141414', 0.5, 0.3, { clearcoat: 0.8 });
          const tubeMat = std('#c81e28', 0.3, 0.5, { clearcoat: 0.2 });
          const aw = (rs?.chord ?? 3.5) * IN, tubeR = ((rs?.tube ?? 1.4) * IN) / 2;
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2;
            const armM = box(R, aw * 0.8, aw, armMat);
            armM.position.set(Math.cos(a) * R / 2, 0.05, -Math.sin(a) * R / 2);
            armM.rotation.y = a;
            spin.add(armM);
            // hammer heads the size of bricks hanging below the arm tips
            const hammer = box(aw * 1.7, 0.2, aw * 1.5, armMat);
            hammer.position.set(Math.cos(a) * R * 0.95, -0.04, -Math.sin(a) * R * 0.95);
            hammer.rotation.y = a;
            spin.add(hammer);
            const a2 = a + (Math.PI * 2) / 3;
            const p1 = new THREE.Vector3(Math.cos(a) * R * 0.92, 0.07, -Math.sin(a) * R * 0.92);
            const p2 = new THREE.Vector3(Math.cos(a2) * R * 0.92, 0.07, -Math.sin(a2) * R * 0.92);
            const tube = cyl(tubeR, p1.distanceTo(p2), tubeMat, 14);
            tube.position.copy(p1).add(p2).multiplyScalar(0.5);
            tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
            spin.add(tube);
          }
          const hub = cyl(((rs?.hub ?? 8) * IN) / 2, aw * 1.1, std('#2a2a2a', 0.7, 0.4), 32);
          hub.position.y = 0.05;
          spin.add(hub);
          const cap = cyl(((rs?.hub ?? 8) * IN) / 4, aw * 1.25, std('#d11f2b', 0.3, 0.35), 20);
          cap.position.y = 0.06;
          spin.add(cap);
        } else if (rs) {
          // a real bar: flat blade with chord, weighted or hooked tips, on a hub
          const chord = (rs.chord ?? 4) * IN;
          const bm = std(rs.color ?? '#8d939a', 0.65, 0.42);
          const tm = std(rs.tipColor ?? '#3a3d42', 0.75, 0.45);
          const bt = rs.depth ? rs.depth * IN : tw;
          const blade = box(R * 2 * 0.86, bt, chord, bm);
          spin.add(blade);
          for (const s of [-1, 1]) {
            if (rs.tips === 'hooked') {
              const hook = box(R * 0.22, bt * 1.05, chord * 1.35, bm);
              hook.position.set(s * R * 0.9, 0, s * chord * 0.35);
              hook.rotation.y = s * 0.55;
              spin.add(hook);
              const edge = box(R * 0.12, bt * 1.15, chord * 0.7, tm);
              edge.position.set(s * R * 0.98, 0, s * chord * 0.75);
              spin.add(edge);
              // bolted-on impactor: a row of bolt heads on top
              for (let b = 0; b < 3; b++) {
                const bolt = cyl(0.008, 0.008, steel(), 8);
                bolt.position.set(s * R * (0.9 + b * 0.035), bt * 0.58 + 0.004, s * chord * 0.75);
                spin.add(bolt);
              }
            } else {
              const tip = box(R * 0.16, bt * 1.7, chord * 1.15, tm);
              tip.position.set(s * R * 0.9, 0, 0);
              spin.add(tip);
            }
          }
          spin.add(cyl(((rs.hub ?? 5) * IN) / 2, bt * 1.35, std('#c41a1f', 0.4, 0.4), 28));
          spin.add(cyl(((rs.hub ?? 5) * IN) / 5, bt * 1.7, steel(), 16));
          if (rs.post) {
            // fixed post from the deck up to the hub (not part of the spinning group)
            const postH = Math.max(0.01, w.mountY - hy);
            const post = cyl(((rs.hub ?? 5) * IN) / 2.6, postH, darkSteel(), 20);
            post.position.set(w.mountX, hy + postH / 2, 0);
            body.add(post);
          }
        } else {
          const bar = box(R * 2, tw, Math.max(0.07, R * 0.16), barMat);
          spin.add(bar);
          for (const s of [-1, 1]) {
            const tooth = box(0.07, tw * 1.25, Math.max(0.09, R * 0.2), toothMat);
            tooth.position.set(s * (R - 0.035), 0, s * 0.02);
            spin.add(tooth);
          }
          const hub = cyl(0.07, tw * 1.6, steel(), 20);
          spin.add(hub);
        }
        break;
      }
      case 'horizontal-disk':
      case 'undercutter': {
        if (w.teeth === 1) {
          // single-tooth disk: a crescent, the cut-out window balancing the tooth
          const sh = new THREE.Shape();
          sh.absarc(0, 0, R * 0.92, 0, Math.PI * 2, false);
          const hole = new THREE.Path();
          hole.absarc(-R * 0.3, 0, R * 0.55, 0, Math.PI * 2, true);
          sh.holes.push(hole);
          const g = new THREE.ExtrudeGeometry(sh, { depth: tw, bevelEnabled: false, curveSegments: 40 });
          g.rotateX(Math.PI / 2);
          g.translate(0, tw / 2, 0);
          const crescent = new THREE.Mesh(g, barMat);
          crescent.castShadow = true;
          spin.add(crescent);
          const tooth = box(R * 0.28, tw * 1.3, 0.09, toothMat);
          tooth.position.set(R * 0.9, 0, 0);
          spin.add(tooth);
          spin.add(cyl(R * 0.16, tw * 1.6, steel(), 20));
          break;
        }
        const disk = cyl(R * 0.9, tw, barMat, 40);
        spin.add(disk);
        for (let i = 0; i < w.teeth; i++) {
          const a = (i / w.teeth) * Math.PI * 2;
          const tooth = box(R * 0.25, tw * 1.2, 0.08, toothMat);
          tooth.position.set(Math.cos(a) * R * 0.9, 0, Math.sin(a) * R * 0.9);
          tooth.rotation.y = -a;
          spin.add(tooth);
        }
        const window = cyl(R * 0.3, tw * 1.05, std('#050505', 0, 1), 20);
        window.position.x = R * 0.45;
        spin.add(window);
        break;
      }
      case 'vertical-disk': {
        const disks = d.weapon.type === 'spinner' && tw > 0.06 ? 2 : 1;
        for (let k = 0; k < disks; k++) {
          const z = disks === 1 ? 0 : (k === 0 ? -1 : 1) * tw * 0.3;
          const disk = cyl(R * 0.86, disks === 1 ? tw : tw * 0.35, f.has('green-teeth') ? std('#0e0e0e', 0.6, 0.4) : barMat, 48, 'z');
          disk.position.z = z;
          spin.add(disk);
          const nT = f.has('green-teeth') ? 12 : w.teeth;
          for (let i = 0; i < nT; i++) {
            const a = (i / nT) * Math.PI * 2;
            const big = !f.has('green-teeth');
            const tooth = box(big ? R * 0.28 : R * 0.12, big ? 0.06 : 0.04, (disks === 1 ? tw : tw * 0.35) * 1.15, toothMat);
            tooth.position.set(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9, z);
            tooth.rotation.z = a + Math.PI / 2;
            spin.add(tooth);
          }
        }
        const hub = cyl(R * 0.2, tw * 1.4, steel(), 16, 'z');
        spin.add(hub);
        break;
      }
      case 'vertical-bar': {
        if (d.id === 'huge') {
          const bar = box(R * 2, 0.06, tw, barMat);
          bar.rotation.x = 0.3; // twisted bar
          spin.add(bar);
        } else {
          const bar = box(R * 2, 0.07, tw, barMat);
          spin.add(bar);
        }
        for (const s of [-1, 1]) {
          const tooth = box(0.06, 0.09, tw * 1.1, toothMat);
          tooth.position.set(s * (R - 0.03), s * 0.02, 0);
          spin.add(tooth);
        }
        spin.add(cyl(0.06, tw * 1.4, steel(), 16, 'z'));
        break;
      }
      case 'drum':
      case 'eggbeater': {
        const drum = cyl(R * 0.82, tw, barMat, 40, 'z');
        spin.add(drum);
        const rows = f.has('gold-drum') ? 4 : 2;
        for (let i = 0; i < w.teeth * 2; i++) {
          const a = (i / (w.teeth * 2)) * Math.PI * 2;
          for (let j = 0; j < rows; j++) {
            const tooth = box(R * 0.28, R * 0.32, tw / rows * 0.55, toothMat);
            tooth.position.set(Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85, (j / (rows - 1 || 1) - 0.5) * tw * 0.75);
            tooth.rotation.z = a;
            spin.add(tooth);
          }
        }
        for (const s of [-1, 1]) {
          const cap = cyl(R * 0.4, 0.02, steel(), 16, 'z');
          cap.position.z = s * (tw / 2 + 0.01);
          spin.add(cap);
        }
        break;
      }
      case 'shell': {
        // Gigabyte: low black dome with flames and wear plates, teeth on the rim
        const shellMat = std('#111111', 0.4, 0.35, { map: paintTexture('#111111', '#ff7a1a', '#ffc21a', 'flames', 5), clearcoat: 0.8 });
        const shell = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.86, R, H * 0.95, 64, 1, true), shellMat);
        shell.castShadow = true;
        spin.add(shell);
        const top = new THREE.Mesh(new THREE.CircleGeometry(R * 0.86, 64), std('#141414', 0.6, 0.4));
        top.rotation.x = -Math.PI / 2;
        top.position.y = H * 0.475;
        spin.add(top);
        const plate = std('#9a9ea3', 0.9, 0.35);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const p = box(R * 0.32, 0.01, R * 0.2, plate);
          p.position.set(Math.cos(a) * R * 0.55, H * 0.48, Math.sin(a) * R * 0.55);
          p.rotation.y = -a;
          spin.add(p);
        }
        const name = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.995, R * 0.995, H * 0.3, 64, 1, true),
          new THREE.MeshBasicMaterial({ map: (() => { const t = textTexture('GIGABYTE   GIGABYTE   GIGABYTE', { color: '#fff', w: 2048, h: 128 }); return t; })(), transparent: true }));
        name.position.y = H * 0.1;
        spin.add(name);
        for (const s of [0, Math.PI]) {
          const tooth = box(0.12, H * 0.5, 0.1, toothMat);
          tooth.position.set(Math.cos(s) * R, -H * 0.12, Math.sin(s) * R);
          spin.add(tooth);
        }
        hull.visible = false;
        break;
      }
    }
    // belts / weapon mounts for verticals: side uprights
    if (isVertical(w.style) && d.id !== 'huge') {
      for (const s of [-1, 1]) {
        const up = box(Math.min(0.2, R * 1.1), Math.max(0.05, w.mountY + hy + 0.03), 0.025, second);
        up.position.set(w.mountX - R * 0.25, (w.mountY - hy) / 2 + 0.015, s * (tw / 2 + 0.03));
        body.add(up);
      }
    }
    if (f.has('boom')) {
      const boom = box(Math.max(0.05, w.mountX - hx), 0.05, 0.08, darkSteel());
      boom.position.set((hx + w.mountX) / 2, w.mountY + 0.035, 0);
      body.add(boom);
      const post = cyl(0.05, 0.1, darkSteel(), 16);
      post.position.set(w.mountX, w.mountY + 0.04, 0);
      body.add(post);
    }
    if (d.secondary?.type === 'slide') {
      slide = pivot;
    }
    if (d.secondary?.type === 'lifter') {
      // Whiplash: big flat arm over the deck, hinged at the back, disk at its tip
      const armG = new THREE.Group();
      armG.position.set(-hx * 0.8, hy + 0.03, 0);
      const plate = box(w.mountX + hx * 0.8, 0.02, W * 0.55, paint);
      plate.position.set((w.mountX + hx * 0.8) / 2, 0, 0);
      armG.add(plate);
      body.add(armG);
      secondaryArm = armG;
    }
    body.add(pivot);
  } else if (w.type === 'flipper') {
    const g = new THREE.Group();
    if (w.style === 'flipper') {
      // big lid hinged at the back of the plate, folds to a scoop at the front
      const hingeX = hx + d.chassis.wedgeLength * 0.4 - w.plateLength;
      g.position.set(hingeX, hy + 0.012, 0);
      // brushed, not chrome: the lid is the robot's whole top and caught the key light
      const lid = box(w.plateLength, 0.018, w.plateWidth, f.has('bare-metal') ? std('#8e9094', 0.7, 0.6) : paint);
      lid.position.x = w.plateLength / 2;
      g.add(lid);
      if (look.logo) {
        // the name is painted on the lid itself, so it rides up with the flip
        const t = textTexture(look.logo, { color: look.accent, font: '"Oswald", "Impact", sans-serif' });
        const lw = Math.min(w.plateLength * 0.8, w.plateWidth * 1.1);
        const name = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw * 0.25), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
        name.rotation.x = -Math.PI / 2;
        name.rotation.z = Math.PI / 2;
        name.position.set(w.plateLength * 0.55, 0.0095, 0);
        g.add(name);
      }
      const lip = box(0.06, 0.014, w.plateWidth, accent);
      lip.position.set(w.plateLength, -0.02, 0);
      lip.rotation.z = -0.6;
      g.add(lip);
      armKind = 'flipper';
    } else {
      // lifter (DUCK!'s beak)
      g.position.set(hx * 0.4, 0, 0);
      const beak = box(w.plateLength, 0.035, w.plateWidth, accent);
      beak.position.set(w.plateLength / 2 + hx * 0.4, -hy * 0.6, 0);
      g.add(beak);
      for (const s of [-1, 1]) {
        const nostril = cyl(0.012, 0.04, std('#141414', 0, 1), 10);
        nostril.position.set(hx * 0.4 + w.plateLength * 0.65, -hy * 0.6 + 0.02, s * 0.04);
        g.add(nostril);
      }
      armKind = 'lifter';
    }
    body.add(g);
    arm = g;
  } else if (w.type === 'hammer' && bp?.arm) {
    // pivoting arm from the blueprint: beam (solid or truss), head at the tip
    const a = bp.arm;
    const g = new THREE.Group();
    g.position.set(a.pivot[0] * IN, hy + a.pivot[1] * IN, 0);
    const len = a.length * IN, depth = a.beam[0] * IN, width = a.beam[1] * IN;
    const armMat = std(a.color, a.truss ? 0.85 : 0.45, a.truss ? 0.38 : 0.5);
    if (a.truss) {
      for (const sy of [-1, 1]) {
        const rail = box(len, depth * 0.22, width, armMat);
        rail.position.set(len / 2, (sy * depth) / 2, 0);
        g.add(rail);
      }
      const n = Math.max(3, Math.round(len / (depth * 1.1)));
      for (let i = 0; i < n; i++) {
        const strut = box(Math.hypot(len / n, depth), depth * 0.16, width * 0.8, armMat);
        strut.position.set((i + 0.5) * (len / n), 0, 0);
        strut.rotation.z = (i % 2 ? 1 : -1) * Math.atan2(depth, len / n);
        g.add(strut);
      }
    } else {
      const beam = box(len, depth, width, armMat);
      beam.position.x = len / 2;
      g.add(beam);
    }
    const pin = cyl(depth * 0.45, width * 1.6, steel(), 16, 'z');
    g.add(pin);
    const hm = std(a.head.color, 0.6, 0.45);
    const [h0, h1, h2] = a.head.size.map((v) => (v ?? 0) * IN);
    if (a.head.kind === 'saw' || a.head.kind === 'blade') {
      const sawG = new THREE.Group();
      sawG.position.set(len, 0, 0);
      const r = h0 / 2;
      if (a.head.kind === 'saw') {
        sawG.add(cyl(r * 0.94, h1, hm, 48, 'z'));
        for (let i = 0; i < 28; i++) {
          const ang = (i / 28) * Math.PI * 2;
          const tooth = box(r * 0.14, r * 0.1, h1 * 1.1, std('#e0e0e0', 0.85, 0.3));
          tooth.position.set(Math.cos(ang) * r * 0.97, Math.sin(ang) * r * 0.97, 0);
          tooth.rotation.z = ang;
          sawG.add(tooth);
        }
      } else {
        // asymmetric hammer-saw blade: a crescent with one big tooth
        const sh = new THREE.Shape();
        sh.absarc(0, 0, r, 0, Math.PI * 2, false);
        const hole = new THREE.Path();
        hole.absarc(-r * 0.25, 0, r * 0.5, 0, Math.PI * 2, true);
        sh.holes.push(hole);
        const geo = new THREE.ExtrudeGeometry(sh, { depth: h1, bevelEnabled: false, curveSegments: 32 });
        geo.translate(0, 0, -h1 / 2);
        const blade = new THREE.Mesh(geo, hm);
        blade.castShadow = true;
        sawG.add(blade);
        const tooth = box(r * 0.45, r * 0.3, h1 * 1.05, hm);
        tooth.position.set(r * 0.95, 0, 0);
        tooth.rotation.z = -0.4;
        sawG.add(tooth);
      }
      sawG.add(cyl(depth * 0.5, width * 1.2, steel(), 16, 'z'));
      g.add(sawG);
      saw = sawG;
      armKind = 'saw';
    } else {
      const head = a.head.kind === 'cylinder' ? cyl(h0 / 2, h1, hm, 24, 'z') : box(h0, h2 || h1, h1, hm);
      // the head hangs below the beam so the blow lands face-first
      head.position.set(len, a.head.kind === 'cylinder' ? 0 : -((h2 || h1) / 2 - depth / 2), 0);
      g.add(head);
      if (d.flame) {
        const nozzle = cyl(0.012, 0.06, darkSteel(), 10, 'x');
        nozzle.position.set(len + h0 / 2 + 0.02, 0, 0);
        g.add(nozzle);
        headFlame = new THREE.Vector3(len + h0 / 2 + 0.05, 0, 0);
      }
      armKind = 'hammer';
    }
    armRange = [(a.rest * Math.PI) / 180, (a.strike * Math.PI) / 180];
    body.add(g);
    arm = g;
  } else if (w.type === 'hammer') {
    const g = new THREE.Group();
    g.position.set(-hx * 0.55, hy + 0.06, 0);
    const reach = w.armLength;
    const armMat = f.has('truss-arm') ? std('#d4d7db', 0.9, 0.3) : w.style === 'saw-arm' ? std(look.primary, 0.5, 0.4) : second;
    const beam = box(reach, 0.07, 0.07, armMat);
    beam.position.x = reach / 2;
    g.add(beam);
    if (w.style === 'saw-arm') {
      const sawG = new THREE.Group();
      sawG.position.set(reach, 0, 0);
      const blade = cyl(0.16, 0.012, std('#c7cacd', 0.95, 0.25), 48, 'z');
      sawG.add(blade);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const tooth = box(0.025, 0.02, 0.014, std('#e0e0e0', 1, 0.2));
        tooth.position.set(Math.cos(a) * 0.165, Math.sin(a) * 0.165, 0);
        tooth.rotation.z = a;
        sawG.add(tooth);
      }
      g.add(sawG);
      saw = sawG;
      armKind = 'saw';
    } else {
      const head = f.has('flame-hammer') || f.has('trefoil')
        ? cyl(0.07, 0.17, std('#48db70', 0.4, 0.35), 20, 'x')
        : cyl(0.075, 0.16, steel(), 20);
      head.position.set(reach, -0.06, 0);
      if (!(f.has('flame-hammer') || f.has('trefoil'))) head.rotation.z = 0;
      g.add(head);
      armKind = 'hammer';
    }
    body.add(g);
    arm = g;
  } else if (w.type === 'crusher') {
    // Quantum: polished skeletal beak hinged at the back, fangs at the front
    const g = new THREE.Group();
    g.position.set(-hx * 0.3, hy + 0.05, 0);
    const jawMat = std('#d9dde2', 1, 0.18);
    const jaw = box(hx * 0.3 + w.reach + hx, 0.04, W * 0.4, jawMat);
    jaw.position.x = (hx * 0.3 + w.reach + hx) / 2;
    g.add(jaw);
    for (const s of [-1, 1]) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 10), std('#141414', 0.5, 0.3));
      fang.position.set(hx * 0.3 + w.reach + hx - 0.02, -0.08, s * W * 0.12);
      fang.rotation.z = Math.PI;
      g.add(fang);
    }
    body.add(g);
    arm = g;
    armKind = 'crusher';
  }

  // --- signature details ---
  const cream = std('#ede6d6', 0.1, 0.5);
  if (f.has('ribcage')) {
    // Witch Doctor's bone self-righter
    const cage = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(W * 0.32, 0.012, 8, 24, Math.PI), cream);
      rib.rotation.y = Math.PI / 2;
      rib.position.set(-hx * 0.6 + i * (hx * 0.28), hy, 0);
      rib.scale.set(1, 0.35, 1);
      cage.add(rib);
    }
    const spine = box(hx * 1.3, 0.02, 0.03, cream);
    spine.position.set(-hx * 0.05, hy + W * 0.11, 0);
    cage.add(spine);
    body.add(cage);
  }
  if (f.has('horns')) {
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.22, 10), darkSteel());
      horn.position.set(hx * 0.8, hy + 0.11, s * 0.08);
      horn.rotation.z = -0.5;
      body.add(horn);
    }
  }
  if (f.has('ears')) {
    for (const s of [-1, 1]) {
      const ear = box(0.18, 0.12, 0.05, second);
      ear.position.set(-hx * 0.5, hy + 0.05, s * (hz + 0.02));
      body.add(ear);
      const ew = cyl(0.04, 0.03, rubber(), 16, 'z');
      ew.position.set(-hx * 0.5, hy + 0.1, s * (hz + 0.05));
      body.add(ew);
    }
  }
  if (f.has('angry-eyes')) {
    for (const s of [-1, 1]) {
      const pod = box(hx * 0.6, 0.06, W * 0.28, paint);
      pod.position.set(hx * 0.45, hy + 0.03, s * W * 0.3);
      body.add(pod);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), std('#ffffff', 0, 0.3));
      eye.position.set(hx * 0.55, hy + 0.06, s * W * 0.3);
      body.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), std('#000', 0, 0.3));
      pupil.position.set(hx * 0.55 + 0.03, hy + 0.09, s * W * 0.28);
      body.add(pupil);
      const brow = box(0.1, 0.018, 0.025, std('#000', 0, 0.5));
      brow.position.set(hx * 0.55, hy + 0.13, s * W * 0.3);
      brow.rotation.y = s * 0.5;
      brow.rotation.z = 0.3;
      body.add(brow);
    }
    if (f.has('fists')) for (const s of [-1, 1]) {
      const fist = box(0.08, 0.08, 0.08, steel());
      fist.position.set(-hx * 0.6, hy + 0.06, s * W * 0.3);
      body.add(fist);
    }
  }
  if (f.has('engine-housing')) {
    // Icewave: the 15 hp concrete-saw engine in a black box housing on top of the bar,
    // blue stripe, angled exhaust, pull-start on top
    const cx = d.weapon.type === 'spinner' ? d.weapon.mountX : 0;
    const top = d.weapon.type === 'spinner' ? d.weapon.mountY + d.weapon.width / 2 + 0.01 : hy + 0.1;
    const house = box(0.34, 0.2, 0.3, std('#141516', 0.4, 0.55));
    house.position.set(cx - 0.02, top + 0.1, 0);
    house.rotation.y = 0.25;
    body.add(house);
    const stripe = box(0.345, 0.03, 0.06, std('#1f5fd0', 0.3, 0.45));
    stripe.position.set(cx - 0.02, top + 0.17, 0.08);
    stripe.rotation.y = 0.25;
    body.add(stripe);
    const ex = cyl(0.028, 0.2, std('#202224', 0.7, 0.45), 14);
    ex.position.set(cx - 0.05, top + 0.27, -0.05);
    ex.rotation.z = 0.35;
    body.add(ex);
    const pull = box(0.08, 0.02, 0.02, std('#e33', 0.2, 0.5));
    pull.position.set(cx + 0.08, top + 0.21, 0.05);
    body.add(pull);
  }
  if (f.has('head-eyes')) {
    // Bloodsport's head with angry red eyes and the curved self-righting pole
    const head = box(0.26, 0.11, 0.2, std('#141414', 0.5, 0.4));
    head.position.set(0.02, hy + 0.06, 0);
    body.add(head);
    for (const s of [-1, 1]) {
      const eye = box(0.012, 0.025, 0.05, std('#ff1a1a', 0, 0.3, { emissive: '#ff1a1a', emissiveIntensity: 3 }));
      eye.position.set(0.152, hy + 0.08, s * 0.05);
      eye.rotation.x = s * 0.4;
      body.add(eye);
      glow.push(eye);
    }
  }
  if (f.has('righting-pole') || f.has('pole')) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, hy + 0.08, 0), new THREE.Vector3(0, hy + 0.35, 0), new THREE.Vector3(-0.12, hy + 0.48, 0), new THREE.Vector3(-0.3, hy + 0.45, 0),
    ]);
    const pole = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.022, 10), f.has('pole') ? std('#e8504f', 0.3, 0.4) : std('#111', 0.5, 0.4));
    pole.castShadow = true;
    body.add(pole);
  }
  if (f.has('blue-eyes') || f.has('orange-leds')) {
    const c = f.has('blue-eyes') ? '#59a6ff' : '#ff8c1a';
    for (const s of [-1, 1]) {
      const e = box(0.04, 0.012, 0.02, std(c, 0, 0.3, { emissive: c, emissiveIntensity: 4 }));
      e.position.set(hx * 0.55, hy + 0.008, s * 0.05);
      body.add(e);
      glow.push(e);
    }
  }
  if (f.has('cat-eyes') && bp) {
    // Cheshire Cat eyes painted across the sloped front cheeks
    const fr = frameOf(bp);
    for (const sgn of [-1, 1]) {
      const z = sgn * W * 0.3;
      const x0 = frontXAt(bp, z) - 0.09, x1 = x0 + 0.02;
      const y0 = fr.top(x0), slope = Math.atan2(fr.top(x1) - y0, 0.02);
      const eye = new THREE.Group();
      eye.position.set(x0, y0 + 0.004, z);
      eye.rotation.z = slope;
      const white = new THREE.Mesh(new THREE.CircleGeometry(0.075, 28), std('#58b7ff', 0.1, 0.35, { emissive: '#1d4f80', emissiveIntensity: 0.4 }));
      white.scale.set(1.25, 0.8, 1);
      white.rotation.x = -Math.PI / 2;
      eye.add(white);
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), std('#0a0a0a', 0, 0.6));
      pupil.scale.set(0.22, 1, 1);
      pupil.rotation.x = -Math.PI / 2;
      pupil.position.y = 0.001;
      eye.add(pupil);
      body.add(eye);
    }
  }
  if (f.has('gold-stripe')) {
    const st = box(L * 0.9, 0.002, W * 0.18, std('#c9a332', 0.85, 0.3));
    st.position.y = hy + 0.0045; // under the logo
    body.add(st);
  }
  if (f.has('pwangers')) {
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
      const pw = box(0.12, 0.012, 0.06, steel());
      pw.position.set(-hx * 0.6 + i * hx * 0.38, 0, s * (hz + 0.03));
      pw.rotation.x = s * 0.6;
      body.add(pw);
    }
  }
  if (f.has('wheel-guards')) {
    for (const s of [-1, 1]) {
      const g = box(L * 0.55, H * 0.85, 0.02, second);
      g.position.set(-L * 0.12, 0, s * (hz + 0.06));
      body.add(g);
    }
  }
  if (f.has('fangs')) {
    for (const s of [-1, 1]) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 4), std('#e3b53a', 0.8, 0.3));
      fang.position.set(hx + 0.02, -hy * 0.4, s * hz * 0.8);
      fang.rotation.z = -Math.PI / 2;
      body.add(fang);
    }
  }
  if (f.has('fern')) {
    const fern = new THREE.Group();
    fern.position.set(hx * 0.2, hy + 0.02, -hz * 0.45);
    const stem = box(hx * 0.9, 0.012, 0.012, std('#e8e8e8', 0.4, 0.4));
    stem.position.x = 0;
    fern.add(stem);
    for (let i = 0; i < 7; i++) {
      const leaf = box(0.012, 0.008, 0.07 - i * 0.007, std('#e8e8e8', 0.4, 0.4));
      leaf.position.set(-hx * 0.4 + i * hx * 0.13, 0.002, 0);
      fern.add(leaf);
    }
    body.add(fern);
  }
  if (f.has('yellow-stripe')) {
    const st = box(L * 0.95, 0.003, 0.05, std('#f2c200', 0.3, 0.4));
    st.position.set(0, hy + 0.006, hz * 0.55);
    body.add(st);
  }
  if (f.has('outline-stripes')) {
    const st = new THREE.LineSegments(new THREE.EdgesGeometry(hullGeo, 25), new THREE.LineBasicMaterial({ color: '#000' }));
    body.add(st);
  }
  if (f.has('clear-top') || f.has('clear-panels')) {
    const glass = box(L * 0.6, 0.006, W * 0.5, new THREE.MeshPhysicalMaterial({ color: '#cde', transmission: 0.6, roughness: 0.1, transparent: true, opacity: 0.45 }));
    glass.position.set(-L * 0.1, hy + 0.008, 0);
    body.add(glass);
  }

  // flame nozzle location (front top)
  const flameNozzle = d.flame ? new THREE.Vector3(hx + 0.03, hy + 0.05, f.has('flame-hammer') ? 0 : hz * 0.3) : null;

  const damage = new THREE.Group();
  body.add(damage);

  return {
    root, body, wheels, rotor, rotorAxis, arm, armKind, saw, slide, secondaryArm, flameNozzle, glow, paint, damage, armRange, headFlame,
    hullHalf: new THREE.Vector3(hx, hy, hz),
  };
}

/** Pose the moving parts from the sim view. */
export function poseBot(m: BotMesh, d: BotDesign, v: { weaponAngle: number; actuator: number; saw: number; wheels: { angle: number; attached: boolean }[] }, slidePos = 0, secondary = 0) {
  v.wheels.forEach((w, i) => {
    const g = m.wheels[i];
    if (!g) return;
    g.visible = w.attached;
    g.rotation.z = -w.angle;
  });
  if (m.rotor) {
    if (m.rotorAxis === 'y') m.rotor.rotation.y = v.weaponAngle + Math.PI / 2;
    else m.rotor.rotation.z = v.weaponAngle;
  }
  if (m.slide && d.secondary?.type === 'slide' && d.weapon.type === 'spinner') m.slide.position.x = d.weapon.mountX + slidePos * d.secondary.distance;
  if (m.secondaryArm) m.secondaryArm.rotation.z = secondary * 0.9;
  if (m.arm) {
    const a = v.actuator;
    if (m.armRange && (m.armKind === 'hammer' || m.armKind === 'saw')) {
      // ease in like a swing: slow off the rest pose, fastest into the strike
      const [rest, strike] = m.armRange;
      m.arm.rotation.z = rest + (strike - rest) * a;
      if (m.headFlame && m.flameNozzle) {
        // keep the body-frame nozzle on the hammer head as it swings
        const c = Math.cos(m.arm.rotation.z), s = Math.sin(m.arm.rotation.z);
        m.flameNozzle.set(m.arm.position.x + c * m.headFlame.x, m.arm.position.y + s * m.headFlame.x, 0);
      }
    } else switch (m.armKind) {
      case 'flipper': m.arm.rotation.z = a * 1.75; break;
      case 'lifter': m.arm.rotation.z = a * 0.7; break;
      case 'hammer': m.arm.rotation.z = 1.9 - a * 2.2; break; // rests back over the deck, slams forward
      case 'saw': m.arm.rotation.z = 0.5 - a * 0.85; break;
      case 'crusher': m.arm.rotation.z = 0.45 - a * 0.6; break;
    }
  }
  if (m.saw) m.saw.rotation.z = -v.saw;
}
