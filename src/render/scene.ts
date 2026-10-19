// The broadcast: renderer, lights, camera direction, robots, effects, and
// turning sim events into sparks, smoke, scars and camera shake.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ArenaLayout, ARENA_SIZE, HALF } from '../sim/arena';
import { BotDesign } from '../sim/design';
import { MatchView } from '../sim/match';
import { DebrisSpawn, SimEvent } from '../sim/combat';
import { MATERIALS } from '../sim/parts';
import { ArenaView } from './arena';
import { BotMesh, buildBot, hideBroken, poseBot } from './botmesh';
import { Effects, FloorScars } from './effects';

export type CameraMode = 'broadcast' | 'chase' | 'overhead' | 'free' | 'intro' | 'gallery' | 'hero';

export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private controls: OrbitControls;
  arena!: ArenaView;
  private bots: BotMesh[] = [];
  private designs: BotDesign[] = [];
  private debris = new Map<number, THREE.Object3D>();
  readonly fx: Effects;
  private scars: FloorScars;
  mode: CameraMode = 'broadcast';
  focus = 0; // chase cam target
  private camPos = new THREE.Vector3(0, 3.6, 6.5);
  private camLook = new THREE.Vector3();
  private lastView: MatchView | null = null;
  private dents: THREE.Mesh[] = [];
  private dentMat: THREE.MeshStandardMaterial;
  private dentGeo = new THREE.SphereGeometry(1, 8, 6);
  quality: 'high' | 'low' = 'high';
  private bloomPulse = 0;
  private keyLight!: THREE.DirectionalLight;
  private redWash!: THREE.SpotLight;
  private keyFlick = 0;
  private washLeft = 0;
  private pyroLeft = 0;
  private pyroVictory = false;
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly smokeAt = new THREE.Vector3();
  /** World offset of the KO camera, captured once so a spinning winner doesn't swing it through the body. */
  private heroHold = new THREE.Vector3();
  private heroHeld = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color('#05060a');
    this.scene.fog = new THREE.Fog('#05060a', 22, 48);

    // lights: big overhead key with shadows, cool fill, red & blue corner washes
    const hemi = new THREE.HemisphereLight('#c9d6ff', '#1a1410', 0.8);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight('#fff3e2', 2.5);
    this.keyLight = key;
    key.position.set(4, 14, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const s = HALF + 1;
    Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 40 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    for (const [x, z, c] of [[-HALF, 0, '#ff3344'], [HALF, 0, '#3388ff']] as const) {
      const sp = new THREE.SpotLight(c, 45, 30, 0.7, 0.7, 1.4);
      sp.position.set(x * 1.1, 6, z);
      sp.target.position.set(x * 0.3, 0, z);
      this.scene.add(sp, sp.target);
      if (c === '#ff3344') this.redWash = sp;
    }
    // (no overhead white spots: their specular on flat metal decks bloomed into blobs)

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.4, 2.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = false;
    this.controls.target.set(0, 0, 0);
    this.controls.maxPolarAngle = Math.PI * 0.48;

    this.fx = new Effects(this.camera);
    this.scene.add(this.fx.group);
    this.scars = new FloorScars(ARENA_SIZE);
    this.scene.add(this.scars.mesh);
    this.dentMat = new THREE.MeshStandardMaterial({ color: '#151210', roughness: 0.9, metalness: 0.5, emissive: '#ff5a10', emissiveIntensity: 2 });
  }

  setLayout(layout: ArenaLayout) {
    if (this.arena) this.scene.remove(this.arena.group);
    this.arena = new ArenaView(layout);
    this.arena.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = true; });
    this.scene.add(this.arena.group);
  }

  setBots(designs: BotDesign[]) {
    for (const b of this.bots) this.scene.remove(b.root);
    for (const d of this.debris.values()) this.scene.remove(d);
    this.debris.clear();
    for (const d of this.dents) d.parent?.remove(d);
    this.dents = [];
    this.scars.clear();
    this.designs = designs;
    this.bots = designs.map((d) => {
      const m = buildBot(d);
      this.scene.add(m.root);
      return m;
    });
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setMode(mode: CameraMode) {
    if (mode !== this.mode) this.heroHeld = false;
    this.mode = mode;
    this.controls.enabled = mode === 'free';
    if (mode === 'free') this.controls.target.copy(this.camLook);
  }

  /** Feed one frame of sim state. */
  apply(view: MatchView, extra: { slide: number[]; secondary: number[] } = { slide: [0, 0], secondary: [0, 0] }) {
    this.lastView = view;
    view.bots.forEach((bv, i) => {
      const m = this.bots[i];
      if (!m) return;
      m.root.position.set(bv.pos.x, bv.pos.y, bv.pos.z);
      m.root.quaternion.set(bv.rot.x, bv.rot.y, bv.rot.z, bv.rot.w);
      poseBot(m, this.designs[i], bv, extra.slide[i], extra.secondary[i]);
      // battle damage darkens and roughens the paint
      const avg = (bv.panels.top + bv.panels.front + bv.panels.left + bv.panels.right) / 4;
      m.paint.roughness = 0.58 + (1 - avg) * 0.35;
      m.paint.clearcoat = 0.35 * avg;
      m.paint.color.set(this.designs[i].look.primary).multiplyScalar(0.55 + 0.45 * avg);
    });
    for (const d of view.debris) {
      const o = this.debris.get(d.id);
      if (o) { o.position.set(d.pos.x, d.pos.y, d.pos.z); o.quaternion.set(d.rot.x, d.rot.y, d.rot.z, d.rot.w); }
    }
    const live = new Set(view.debris.map((d) => d.id));
    for (const [id, o] of this.debris) if (!live.has(id)) { this.scene.remove(o); this.debris.delete(id); }
    this.arena.update(view.hazards, view.hazardsLive, view.phase, view.countdown);
  }

  /** Turn sim events into visuals. Returns the biggest impact energy (J) for slow-mo / audio.
   *  A replay feeds the same events back for sparks and flashes, and leaves scars and dents as they were. */
  events(evs: SimEvent[], replay = false) {
    let biggest = 0;
    for (const e of evs) {
      if (e.type === 'hit') {
        const p = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);
        const dir = new THREE.Vector3(e.dir.x, e.dir.y, e.dir.z);
        const mat = MATERIALS[e.material as keyof typeof MATERIALS];
        const sparkiness = mat ? mat.spark : 1;
        const kj = e.energy / 1000;
        const n = Math.min(260, Math.floor((8 + kj * 9) * sparkiness * (e.kind === 'saw' ? 0.5 : 1)));
        if (n > 0) this.fx.sparksAt(p, dir, n, 6 + Math.min(18, kj * 0.9), mat?.id === 'titanium' ? 1.3 : 1);
        if (!sparkiness && kj > 2) this.fx.smoke(p, 3, 0.85, 0.12); // UHMW shavings
        if (kj > 4) this.fx.flash(p, kj);
        if (kj > 15) this.pulseBloom();
        if (kj > 2 && e.kind !== 'saw') this.fx.smoke(p, Math.min(8, Math.floor(kj / 4)), 0.35, 0.25);
        if (e.kind === 'spinner' || e.kind === 'clash' || e.kind === 'hammer' || e.kind === 'hazard') {
          this.fx.shake = Math.min(1.4, this.fx.shake + kj * 0.035);
        }
        if (!replay && p.y < 0.12 && kj > 1) this.scars.gouge(p.x, p.z, dir.x, dir.z, 0.15 + kj * 0.01);
        if (!replay && kj > 6) this.scars.scorch(p.x, p.z, 0.3 + kj * 0.01, 0.6);
        if (!replay && e.target >= 0 && kj > 3) this.addDent(e.target, p, kj);
        biggest = Math.max(biggest, e.energy);
      } else if (e.type === 'debris') {
        this.spawnDebris(e.id, e.spec);
      } else if (e.type === 'break') {
        const p = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);
        this.fx.sparksAt(p, new THREE.Vector3(0, 1, 0), 60, 8);
        this.fx.smoke(p, 10, 0.3, 0.3);
        if (!replay && (e.part === 'weapon' || e.part === 'tooth') && this.bots[e.bot]) hideBroken(this.bots[e.bot], e.part);
      } else if (!replay && e.type === 'phase') {
        this.fightStart();
      } else if (!replay && e.type === 'hazards-live') {
        this.hazardWash();
      } else if (e.type === 'actuate') {
        const p = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);
        if (e.kind === 'flip') this.fx.smoke(p, 6, 0.85, 0.3); // pneumatic exhaust
        if (e.kind === 'hammer' && e.bot === -1) { this.fx.shake += 0.4; this.scars.scorch(p.x, p.z, 0.5, 0.3); }
      }
    }
    return biggest;
  }

  private addDent(bot: number, p: THREE.Vector3, kj: number) {
    const m = this.bots[bot];
    if (!m) return;
    const dent = new THREE.Mesh(this.dentGeo, this.dentMat.clone());
    const local = m.root.worldToLocal(p.clone());
    const h = m.hullHalf;
    local.x = THREE.MathUtils.clamp(local.x, -h.x * 1.6, h.x * 1.6);
    local.y = THREE.MathUtils.clamp(local.y, -h.y, h.y);
    local.z = THREE.MathUtils.clamp(local.z, -h.z, h.z);
    dent.position.copy(local);
    const r = 0.02 + Math.min(0.08, kj * 0.0015);
    dent.scale.set(r * 2.2, r * 0.5, r);
    dent.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    dent.userData.born = performance.now();
    m.body.add(dent);
    this.dents.push(dent);
    if (this.dents.length > 80) { const old = this.dents.shift()!; old.parent?.remove(old); }
  }

  private spawnDebris(id: number, spec: DebrisSpawn) {
    if (this.debris.has(id)) return;
    let mesh: THREE.Object3D;
    const mat = new THREE.MeshStandardMaterial({ color: spec.kind === 'wheel' ? spec.color : spec.color, metalness: spec.kind === 'wheel' ? 0 : 0.7, roughness: 0.5 });
    if (spec.kind === 'wheel') {
      const g = new THREE.CylinderGeometry(spec.size.x, spec.size.x, spec.size.z, 24);
      g.rotateX(Math.PI / 2);
      mesh = new THREE.Mesh(g, mat);
    } else {
      // jagged plate fragment
      const g = new THREE.BoxGeometry(spec.size.x, Math.max(0.006, spec.size.y), spec.size.z, 2, 1, 2);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setX(i, pos.getX(i) * (0.7 + Math.random() * 0.5));
        pos.setZ(i, pos.getZ(i) * (0.7 + Math.random() * 0.5));
      }
      g.computeVertexNormals();
      mesh = new THREE.Mesh(g, mat);
    }
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.debris.set(id, mesh);
  }

  /** Per-frame: camera direction, effects, ambient smoke/fire from damaged bots. */
  frame(dt: number, flameOn: boolean[] = [false, false]) {
    const v = this.lastView;
    if (v) {
      v.bots.forEach((bv, i) => {
        const m = this.bots[i];
        if (!m) return;
        if (bv.onFire) {
          const p = m.root.position.clone().add(new THREE.Vector3(0, 0.15, 0));
          if (Math.random() < dt * 30) this.fx.smoke(p, 1, 0.82, 0.3); // LiPo smoke is white
          if (Math.random() < dt * 8) this.fx.sparksAt(p, new THREE.Vector3(0, 1, 0), 3, 2, 0.7);
        }
        const driveHurt = (bv.internals.driveL < 0.55 ? 1 : 0) + (bv.internals.driveR < 0.55 ? 1 : 0);
        if (driveHurt && Math.random() < dt * 14 * driveHurt) {
          this.smokeAt.copy(m.root.position);
          this.smokeAt.y = 0.06;
          this.fx.smoke(this.smokeAt, 1, 0.28, 0.16);
        }
        if (flameOn[i] && m.flameNozzle) {
          const p = m.flameNozzle.clone().applyMatrix4(m.body.matrixWorld);
          const dir = new THREE.Vector3(1, 0.25, 0).applyQuaternion(m.root.quaternion).normalize();
          this.fx.fire(p, dir, 3, this.designs[i].look.features?.includes('green-flame'));
        }
        // tire rubber on the floor while driving hard
        if (bv.speedMph > 8 && Math.random() < dt * 20) this.scars.rubber(bv.pos.x, bv.pos.z, 0.12);
      });
      // dents cool from glowing orange to dark
      const now = performance.now();
      for (const d of this.dents) {
        const age = (now - (d.userData.born as number)) / 1000;
        (d.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.max(0, 2.2 - age * 0.9);
      }
    }
    if (this.bloomPulse > 0 && this.quality === 'high') this.bloom.strength = 0.55 + this.bloomPulse * 6;
    else this.bloom.strength = 0.55;
    this.bloomPulse = Math.max(0, this.bloomPulse - dt);
    if (this.keyFlick > 0) {
      this.keyLight.intensity = 2.5 + 6 * (this.keyFlick / 0.12);
      this.keyFlick = Math.max(0, this.keyFlick - dt);
    } else if (this.keyLight.intensity !== 2.5) this.keyLight.intensity = 2.5;
    if (this.washLeft > 0) {
      const s = 0.5 + 0.5 * Math.sin(performance.now() * 0.02);
      this.redWash.intensity = 45 + s * 90;
      this.washLeft -= dt;
      if (this.arena) this.arena.siren = true;
    } else {
      if (this.redWash.intensity !== 45) this.redWash.intensity = 45;
      if (this.arena) this.arena.siren = false;
    }
    this.feedPyro(dt);
    this.fx.update(dt);
    this.scars.flush();
    this.updateCamera(dt);
    this.composer.render();
  }

  private updateCamera(dt: number) {
    const v = this.lastView;
    if (this.mode === 'free') {
      this.controls.update();
      return;
    }
    const a = v?.bots[0]?.pos ?? { x: -3, y: 0, z: 0 };
    const b = v?.bots[1]?.pos ?? { x: 3, y: 0, z: 0 };
    const mid = new THREE.Vector3((a.x + b.x) / 2, 0.2, (a.z + b.z) / 2);
    const sep = Math.hypot(a.x - b.x, a.z - b.z);
    let pos: THREE.Vector3, look: THREE.Vector3;
    if (this.mode === 'gallery') {
      // fixed 3/4 front view, distance from the bounding sphere so HUGE and DUCK! frame the same
      const me = this.bots[this.focus]?.root;
      if (!me) return;
      const box = new THREE.Box3().setFromObject(me);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(me.quaternion).setY(0).normalize();
      const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const dist = sphere.radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.05;
      const dir = fwd.clone().multiplyScalar(0.72).addScaledVector(left, 0.55).add(new THREE.Vector3(0, 0.42, 0)).normalize();
      this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
      this.camera.lookAt(sphere.center);
      this.camPos.copy(this.camera.position);
      this.camLook.copy(sphere.center);
      return;
    }
    if (this.mode === 'intro') {
      const me = this.bots[this.focus]?.root;
      const t = performance.now() / 1000;
      const c = me ? me.position : mid;
      pos = new THREE.Vector3(c.x + Math.cos(t * 0.5) * 2.1, 0.75, c.z + Math.sin(t * 0.5) * 2.1);
      look = new THREE.Vector3(c.x, 0.15, c.z);
      this.camPos.lerp(pos, 1 - Math.exp(-dt * 6));
      this.camLook.lerp(look, 1 - Math.exp(-dt * 8));
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      return;
    }
    if (this.mode === 'hero') {
      const me = this.bots[this.focus]?.root;
      const c = me ? me.position : mid;
      if (!this.heroHeld) {
        const fwd = new THREE.Vector3(1, 0, 0);
        if (me) fwd.applyQuaternion(me.quaternion);
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
        fwd.normalize();
        this.heroHold.set(fwd.x * 3.4, 1.05, fwd.z * 3.4);
        this.heroHeld = true;
        // Start here. Lerping in from the broadcast rail flies the lens through the winner.
        this.camPos.set(c.x + this.heroHold.x, this.heroHold.y, c.z + this.heroHold.z);
        this.camLook.set(c.x, 0.25, c.z);
      }
      pos = new THREE.Vector3(c.x + this.heroHold.x, this.heroHold.y, c.z + this.heroHold.z);
      look = new THREE.Vector3(c.x, 0.25, c.z);
      const k = 1 - Math.exp(-dt * 1.5);
      this.camPos.lerp(pos, k);
      this.camLook.lerp(look, 1 - Math.exp(-dt * 2));
      this.camera.position.copy(this.camPos);
      const sh = this.fx.shake;
      if (sh > 0) this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * sh * 0.12, (Math.random() - 0.5) * sh * 0.08, (Math.random() - 0.5) * sh * 0.12));
      this.camera.lookAt(this.camLook);
      return;
    }
    if (this.mode === 'overhead') {
      pos = new THREE.Vector3(mid.x * 0.6, 7 + sep * 0.55, mid.z * 0.6 + 0.01);
      look = mid;
    } else if (this.mode === 'chase') {
      const me = this.bots[this.focus]?.root;
      const other = v?.bots[1 - this.focus]?.pos ?? b;
      if (me) {
        const toOther = new THREE.Vector3(other.x - me.position.x, 0, other.z - me.position.z).normalize();
        pos = me.position.clone().addScaledVector(toOther, -3.2).add(new THREE.Vector3(0, 1.7, 0));
        look = me.position.clone().addScaledVector(toOther, 1.5);
      } else { pos = this.camPos; look = mid; }
    } else {
      // broadcast: the camera rides a rail behind the Lexan on the door side, below the truss,
      // tracking the midpoint and pulling back to keep both robots in frame
      const dist = 4.2 + sep * 0.75;
      pos = new THREE.Vector3(mid.x * 0.75, Math.min(4.0, 1.8 + sep * 0.3), Math.min(HALF - 0.4, mid.z + dist));
      look = mid.clone().add(new THREE.Vector3(0, 0, -0.4));
    }
    const k = 1 - Math.exp(-dt * 3.2);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, 1 - Math.exp(-dt * 5));
    this.camera.position.copy(this.camPos);
    const sh = this.fx.shake;
    if (sh > 0) this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * sh * 0.12, (Math.random() - 0.5) * sh * 0.12, (Math.random() - 0.5) * sh * 0.12));
    this.camera.lookAt(this.camLook);
  }

  /** A short bloom kick on a big flash. Low quality leaves the pass alone. */
  pulseBloom() {
    if (this.quality === 'low') return;
    this.bloomPulse = Math.max(this.bloomPulse, 0.14);
  }

  /** Fight horn: key-light flick and a flame burst from the corners. */
  fightStart() {
    this.keyFlick = 0.12;
    this.pyroLeft = Math.max(this.pyroLeft, 0.65);
    this.pyroVictory = false;
  }

  /** Red washes for the length of the hazards-live siren. */
  hazardWash() {
    this.washLeft = 2;
  }

  /** Fountain sparks and flame from the four corners. Judges' reveal and a KO. */
  victoryPyro() {
    this.pyroLeft = Math.max(this.pyroLeft, 1.4);
    this.pyroVictory = true;
  }

  private pyroScale() {
    return this.quality === 'low' ? 0.3 : 1;
  }

  private feedPyro(dt: number) {
    if (this.pyroLeft <= 0 || !this.arena) return;
    const s = this.pyroScale() * Math.min(1, this.pyroLeft / 0.35);
    const sparks = this.pyroVictory ? Math.max(1, Math.round(20 * s)) : 0;
    const flames = Math.max(1, Math.round((this.pyroVictory ? 4 : 5) * s));
    for (const c of this.arena.corners()) {
      if (sparks) this.fx.sparksAt(c, this.up, sparks, 8, 1.2);
      this.fx.fire(c, this.up, flames);
    }
    this.pyroLeft -= dt;
  }

  dispose() {
    this.renderer.dispose();
  }
}
