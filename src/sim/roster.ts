// The reboot-era heavyweights, as engineering designs. Published numbers
// (weapon mass, rpm, tip speed, wheel count, invertibility, self-righter)
// come from research/roster.json; anything unpublished is a builder-plausible
// estimate, and armor thickness is then scaled so every bot makes 250 lb.

import {
  BotDesign, Panel, SpinnerWeapon, fitToWeight, ratioFor, weaponRatioFor, SpinnerStyle,
} from './design';
import { IN, LB, MaterialId, MotorId, MPH } from './parts';
import { Blueprint, blueprintBox } from './blueprint';

const P = (material: MaterialId, thickness: number): Panel => ({ material, thickness });

interface Spec {
  id: string;
  name: string;
  team: string;
  L: number; W: number; H: number; // inches
  clear?: number; // in
  shape?: BotDesign['chassis']['shape'];
  wedge?: number; // in
  armor: BotDesign['chassis']['armor'];
  frame?: MaterialId;
  wheels: 2 | 4 | 6;
  wheelDia: number; // in
  wheelWidth?: number; // in
  track?: number; // in (default: width - wheelWidth)
  wheelbase?: number; // in
  axleX?: number; // in
  tire?: BotDesign['drive']['tire'];
  driveMotor?: MotorId;
  motorsPerSide?: number;
  topMph: number;
  cells?: number;
  packs?: number;
  ah?: number;
  weapon: BotDesign['weapon'];
  selfRighter?: BotDesign['chassis']['selfRighter'];
  forks?: boolean;
  noseTaper?: number;
  invertible?: boolean;
  secondary?: BotDesign['secondary'];
  flame?: boolean;
  look: BotDesign['look'];
  /** real silhouette; overrides L/W/H/clear/shape/wedge */
  bp?: Blueprint;
  axleStubs?: number; // in
}

function spinner(o: {
  style: SpinnerStyle; lb: number; dia: number; width: number; teeth: number; tooth?: number; rpm: number;
  motor: MotorId; motors?: number; mountX: number; mountY: number; material?: MaterialId; cells?: number; dir?: 1 | -1; reversible?: boolean;
}): SpinnerWeapon {
  return {
    type: 'spinner', style: o.style, rotorMass: o.lb * LB, radius: (o.dia / 2) * IN, width: o.width * IN,
    teeth: o.teeth, toothHeight: (o.tooth ?? 1) * IN, material: o.material ?? 's7', motor: o.motor,
    motorCount: o.motors ?? 1, ratio: weaponRatioFor(o.rpm, o.motor, o.cells ?? 12),
    mountX: o.mountX * IN, mountY: o.mountY * IN, dir: o.dir, reversible: o.reversible,
  };
}
/** rpm for a tip speed on a given diameter */
const rpmAt = (mph: number, diaIn: number) => (mph * MPH * 60) / (Math.PI * diaIn * IN);

function build(s: Spec): BotDesign {
  if (s.bp) {
    const b = blueprintBox(s.bp);
    s = { ...s, L: b.length / IN, W: b.width / IN, H: s.bp.height, clear: s.bp.clearance, wedge: 0, shape: 'box', noseTaper: undefined };
  }
  const cells = s.cells ?? 12;
  const dm = s.driveMotor ?? 'bl63-190';
  const ww = s.wheelWidth ?? 2;
  const d: BotDesign = {
    id: s.id, name: s.name, team: s.team,
    chassis: {
      shape: s.shape ?? 'box', length: s.L * IN, width: s.W * IN, height: s.H * IN, clearance: (s.clear ?? 0.5) * IN,
      wedgeLength: (s.wedge ?? 0) * IN, frame: s.frame ?? 'al7075', frameThickness: 6, armor: s.armor,
      selfRighter: s.selfRighter, forks: s.forks, noseTaper: s.noseTaper, invertibleOverride: s.invertible, blueprint: s.bp,
    },
    drive: {
      wheels: s.wheels, wheelDiameter: s.wheelDia * IN, wheelWidth: ww * IN, tire: s.tire ?? 'colson', motor: dm,
      motorsPerSide: s.motorsPerSide ?? (s.wheels >= 4 ? 2 : 1), ratio: ratioFor(s.topMph, s.wheelDia * IN, dm, cells),
      wheelbase: (s.wheelbase ?? (s.wheels === 2 ? 0 : s.L * 0.55)) * IN, track: (s.track ?? s.W - ww - 1) * IN, axleX: (s.axleX ?? 0) * IN, axleStubs: s.axleStubs ? s.axleStubs * IN : undefined,
    },
    battery: { cellsS: cells, capacityAh: s.ah ?? 5, packs: s.packs ?? 2, cRating: 65 },
    weapon: s.weapon,
    secondary: s.secondary,
    flame: s.flame,
    look: s.look,
  };
  // a vertical rotor can't sit lower than its own radius off the floor
  const w = d.weapon;
  if (w.type === 'spinner' && (w.style === 'vertical-disk' || w.style === 'vertical-bar' || w.style === 'drum' || w.style === 'eggbeater')) {
    const centerY = d.chassis.clearance + d.chassis.height / 2;
    w.mountY = Math.max(w.mountY, w.radius + 0.3 * IN - centerY);
  }
  return fitToWeight(d);
}

const SPECS: Spec[] = [
  {
    id: 'tombstone', name: 'Tombstone', team: 'Hardcore Robotics',
    L: 30, W: 22, H: 7, clear: 2.5, shape: 'low-flat', noseTaper: 0.6,
    bp: {
      outline: [[-15, -11], [9, -11], [15, -4], [22, -2.5], [22, 2.5], [15, 4], [9, 11], [-15, 11]],
      height: 7, clearance: 2.5, front: { at: 9, lip: 6.5 },
    },
    armor: { front: P('ar500', 12), rear: P('ar500', 6), sides: P('ar500', 8), top: P('titanium', 5), bottom: P('al7075', 5) },
    wheels: 2, wheelDia: 10, wheelWidth: 3.5, track: 28, axleX: -9, tire: 'pneumatic-foam', topMph: 14, driveMotor: 'bl80-150',
    weapon: spinner({ style: 'horizontal-bar', lb: 72, dia: 42, width: 2, teeth: 2, tooth: 1.5, rpm: rpmAt(200, 42), motor: 'etek', mountX: 21, mountY: -4.6 }),
    look: { primary: '#1b1b1d', secondary: '#2c2d30', accent: '#b01e1e', logo: 'TOMBSTONE', features: ['reaper', 'vents'], tireColor: '#151515' },
  },
  {
    id: 'bite-force', name: 'Bite Force', team: 'Aptyx Designs',
    L: 30, W: 30, H: 7, shape: 'wedge', wedge: 7,
    bp: {
      outline: [[-15, -14], [-13, -15], [10, -15], [15, -13], [15, -2.2], [6, -2.2], [6, 2.2], [15, 2.2], [15, 13], [10, 15], [-13, 15], [-15, 14]],
      height: 7, clearance: 0.5, front: { at: 4, lip: 0.4, floor: true },
    },
    armor: { front: P('hardox', 12), rear: P('al7075', 8), sides: P('al7075', 10), top: P('al7075', 6), bottom: P('al7075', 5) },
    wheels: 4, wheelDia: 6, topMph: 17, forks: true,
    weapon: spinner({ style: 'vertical-bar', lb: 40, dia: 20, width: 2.5, teeth: 1, tooth: 1.4, rpm: rpmAt(200, 20), motor: 'bl80100-130', motors: 1, mountX: 12, mountY: 0.5 }),
    look: { primary: '#a7aaad', secondary: '#8f9396', accent: '#1f5fbf', logo: 'BITE FORCE', pattern: 'rivets', features: ['triangle-sides', 'sponsor-decals', 'battle-scars', 'accent-forks'] },
  },
  {
    id: 'witch-doctor', name: 'Witch Doctor', team: 'Team Witch Doctor',
    L: 31, W: 29, H: 8,
    // wedge plow split by the weapon slot, flaring out over the front wheels; sloped tail
    bp: {
      outline: [[-14, -13], [8, -14], [14, -14.5], [17, -9], [17, -2.5], [5, -2.5], [5, 2.5], [17, 2.5], [17, 9], [14, 14.5], [8, 14], [-14, 13]],
      height: 8, clearance: 0.5, front: { at: 6, lip: 0.4, floor: true }, rear: { at: -11, lip: 5 },
    },
    armor: { front: P('ar500', 10), rear: P('al7075', 8), sides: P('al7075', 10), top: P('al7075', 6), bottom: P('al7075', 5) },
    wheels: 4, wheelDia: 6, track: 30, wheelbase: 17, topMph: 15, selfRighter: 'arm', flame: true,
    // the 'drisk': two disks on one hub, 47 lb, 4,000 rpm
    weapon: spinner({ style: 'vertical-disk', lb: 47, dia: 17, width: 3.5, teeth: 2, tooth: 1.2, rpm: 4000, motor: 'bl80100-130', motors: 2, mountX: 10, mountY: 0.5, material: 'ar500' }),
    look: { primary: '#5b2c8f', secondary: '#3d1d63', accent: '#7cfc00', logo: 'WITCH DOCTOR', features: ['ribcage', 'flame-nozzle'] },
  },
  {
    id: 'minotaur', name: 'Minotaur', team: 'Team RioBotz',
    L: 29, W: 30, H: 9,
    // short and wide: drum across the whole front between two mounting arms, wheels in angled side guards
    bp: {
      outline: [
        [-13, -12], [-8.6, -12.7], [-8.6, -11], [2.6, -11], [2.6, -14], [6, -15], [16, -15], [16, -11.5], [9, -11.5],
        [9, 11.5], [16, 11.5], [16, 15], [6, 15], [2.6, 14], [2.6, 11], [-8.6, 11], [-8.6, 12.7], [-13, 12],
      ],
      height: 9, clearance: 0.5, front: { at: 6, lip: 5 }, rear: { at: -9, lip: 4 },
    },
    armor: { front: P('hardox', 10), rear: P('titanium', 8), sides: P('titanium', 10), top: P('titanium', 7), bottom: P('titanium', 4) },
    wheels: 2, wheelDia: 10, wheelWidth: 3, track: 26, axleX: -3, topMph: 16, driveMotor: 'bl80-150', invertible: true,
    weapon: spinner({ style: 'drum', lb: 70, dia: 9.3, width: 22, teeth: 2, tooth: 0.75, rpm: 8000, motor: 'bl120-70', motors: 2, mountX: 14, mountY: -1, reversible: true }),
    look: { primary: '#1c1c1c', secondary: '#2b2b2b', accent: '#c9a227', logo: 'MINOTAUR', features: ['bull', 'gold-drum'] },
  },
  {
    id: 'hypershock', name: 'HyperShock', team: 'Team HyperShock',
    L: 34, W: 19, H: 6,
    // long, narrow race-car body, tapered nose with the disk between forks, four exposed race tires
    bp: {
      outline: [[-20, -8], [-18, -9.5], [8, -9.5], [14, -4.5], [14, -2], [9.5, -2], [9.5, 2], [14, 2], [14, 4.5], [8, 9.5], [-18, 9.5], [-20, 8]],
      height: 6, clearance: 0.5, front: { at: 5, lip: 1.2, floor: true }, rear: { at: -16, lip: 3.5 },
    },
    armor: { front: P('ar500', 8), rear: P('al7075', 6), sides: P('al7075', 6), top: P('al7075', 5), bottom: P('al7075', 4) },
    wheels: 4, wheelDia: 7.5, wheelWidth: 3, track: 26, wheelbase: 24, axleX: -4, tire: 'nhra', topMph: 28, invertible: true, forks: true,
    weapon: spinner({ style: 'vertical-disk', lb: 40, dia: 17, width: 1.6, teeth: 2, rpm: 4200, motor: 'bl80100-130', motors: 1, mountX: 12.5, mountY: 0 }),
    look: { primary: '#fff01f', secondary: '#111111', accent: '#e0e0e0', logo: 'HYPERSHOCK', features: ['race-tires', 'horns', 'qr-belly'] },
  },
  {
    id: 'end-game', name: 'End Game', team: 'Team End Game',
    L: 30, W: 28, H: 9,
    // boxy 4WD with chamfered front corners; disk in a centre slot, orange forks under it
    bp: {
      outline: [[-15, -12], [-13, -14], [11, -14], [15, -10], [15, -2], [9, -2], [9, 2], [15, 2], [15, 10], [11, 14], [-13, 14], [-15, 12]],
      height: 9, clearance: 0.5, front: { at: 11, lip: 4.5 },
    },
    armor: { front: P('hardox', 12), rear: P('al7075', 8), sides: P('titanium', 8), top: P('titanium', 6), bottom: P('al7075', 5) },
    wheels: 4, wheelDia: 6, topMph: 15, selfRighter: 'arm', forks: true,
    weapon: spinner({ style: 'vertical-disk', lb: 55, dia: 14, width: 1.6, teeth: 1, tooth: 1.5, rpm: 6000, motor: 'bl120-70', motors: 2, mountX: 13, mountY: 0 }),
    look: { primary: '#b5b8ba', secondary: '#9a9da0', accent: '#f28c28', logo: 'END GAME', features: ['fern', 'yellow-stripe', 'kill-count', 'accent-forks'] },
  },
  {
    id: 'sawblaze', name: 'SawBlaze', team: 'Team SawBlaze',
    L: 32, W: 28, H: 8,
    // low black box with a full-width scoop taking the front third; big wheels at the back
    bp: {
      outline: [[-16, -13], [12, -14], [12, 14], [-16, 13]],
      height: 8, clearance: 0.5, front: { at: -2, lip: 0.4, floor: true }, rear: { at: -14, lip: 5 },
    },
    armor: { front: P('hardox', 12), rear: P('al7075', 8), sides: P('al7075', 8), top: P('al7075', 6), bottom: P('al7075', 5) },
    wheels: 2, wheelDia: 8, wheelWidth: 3, track: 31, axleX: -9, topMph: 14, driveMotor: 'bl80-150', forks: true, flame: true, invertible: false,
    weapon: { type: 'hammer', style: 'saw-arm', headMass: 6, armLength: 27 * IN, energy: 900, swingTime: 0.35, cooldown: 0.2, systemMass: 15, sawRpm: 5000 },
    look: { primary: '#1a1a1a', secondary: '#7cff00', accent: '#7cff00', logo: 'SAWBLAZE', features: ['three-forks', 'green-flame'] },
  },
  {
    id: 'whiplash', name: 'Whiplash', team: 'Team Fast Electric Robots',
    L: 32, W: 30, H: 7, shape: 'box',
    bp: {
      outline: [[-16, -11], [14, -11], [16, -9], [16, 9], [14, 11], [-16, 11]],
      height: 7, clearance: 0.5, front: { at: 8, lip: 2.5 },
    },
    armor: { front: P('ar500', 10), rear: P('al7075', 8), sides: P('al7075', 8), top: P('al7075', 5), bottom: P('al7075', 5) },
    track: 26, wheels: 4, wheelDia: 7, wheelWidth: 3, tire: 'urethane', topMph: 15, forks: true, selfRighter: 'arm',
    weapon: spinner({ style: 'vertical-disk', lb: 22, dia: 14, width: 1.25, teeth: 2, rpm: 6500, motor: 'bl80100-130', motors: 1, mountX: 18, mountY: 3 }),
    secondary: { type: 'lifter', energy: 2600, plateLength: 0.5, plateWidth: 0.4, cooldown: 0.9, systemMass: 9 },
    look: { primary: '#d0ff00', secondary: '#111111', accent: '#c8102e', logo: 'WHIPLASH', features: ['lifter-arm', 'exposed-wheels'] },
  },
  {
    id: 'lock-jaw', name: 'Lock-Jaw', team: 'Mutant Robots',
    L: 28, W: 28, H: 7, shape: 'box',
    bp: {
      outline: [[-14, -14], [12, -14], [14, -12], [14, -2.5], [6, -2.5], [6, 2.5], [14, 2.5], [14, 12], [12, 14], [-14, 14]],
      height: 7, clearance: 0.5, front: { at: 7, lip: 3 },
    },
    armor: { front: P('ar500', 10), rear: P('al7075', 8), sides: P('al7075', 8), top: P('al7075', 5), bottom: P('al7075', 5) },
    wheels: 4, wheelDia: 6, topMph: 16, forks: true, invertible: true,
    weapon: spinner({ style: 'vertical-bar', lb: 38, dia: 15, width: 3, teeth: 2, rpm: rpmAt(120, 15), motor: 'bl80100-130', motors: 1, mountX: 12, mountY: 0 }),
    look: { primary: '#7cfc00', secondary: '#6c0ba9', accent: '#1a1a1a', logo: 'LOCK-JAW', features: ['ears', 'fork-letters'] },
  },
  {
    id: 'hydra', name: 'Hydra', team: 'Team Whyachi',
    L: 36, W: 34, H: 6, shape: 'wedge', wedge: 8,
    armor: { front: P('hardox', 10), rear: P('al7075', 8), sides: P('al7075', 8), top: P('al7075', 6), bottom: P('al7075', 5) },
    wheels: 6, wheelDia: 5, wheelbase: 22, topMph: 13, forks: true,
    weapon: { type: 'flipper', style: 'flipper', actuator: 'hydraulic', energy: 7500, plateLength: 0.55, plateWidth: 0.7, shots: Infinity, cooldown: 3.6, systemMass: 26 },
    look: { primary: '#4b1f6f', secondary: '#2e8b8b', accent: '#cdf939', logo: 'HYDRA', features: ['piano-keys', 'hydra-art'] },
  },
  {
    id: 'bronco', name: 'Bronco', team: 'Inertia Labs',
    L: 40, W: 32, H: 12, shape: 'wedge', wedge: 10,
    armor: { front: P('al7075', 10), rear: P('al7075', 8), sides: P('al7075', 8), top: P('al7075', 8), bottom: P('al7075', 5) },
    wheels: 4, wheelDia: 8, topMph: 13, frame: 'al7075',
    weapon: { type: 'flipper', style: 'flipper', actuator: 'pneumatic', energy: 9500, plateLength: 0.8, plateWidth: 0.75, shots: 24, cooldown: 1.2, systemMass: 30 },
    look: { primary: '#a8a9ad', secondary: '#8c8d91', accent: '#ff4949', logo: 'BRONCO', features: ['pwangers', 'bare-metal'] },
  },
  {
    id: 'blacksmith', name: 'Blacksmith', team: 'Team Half Fast Astronaut',
    L: 32, W: 30, H: 12, shape: 'box',
    armor: { front: P('ar500', 8), rear: P('al7075', 8), sides: P('al7075', 8), top: P('al7075', 6), bottom: P('al7075', 5) },
    wheels: 4, wheelDia: 7, topMph: 12, forks: true, flame: true,
    weapon: { type: 'hammer', style: 'hammer', headMass: 13 * LB, armLength: 30 * IN, energy: 3200, swingTime: 0.32, cooldown: 0.6, systemMass: 18 },
    look: { primary: '#48db70', secondary: '#1a1a1a', accent: '#ff6a00', logo: 'BLACKSMITH', features: ['trefoil', 'skulls', 'flame-hammer'] },
  },
  {
    id: 'huge', name: 'HUGE', team: 'Team HUGE',
    L: 8, W: 30, H: 5, clear: 17.5, shape: 'box',
    armor: { front: P('uhmw', 20), rear: P('uhmw', 20), sides: P('uhmw', 20), top: P('uhmw', 15), bottom: P('uhmw', 15) },
    wheels: 2, wheelDia: 40, wheelWidth: 1.75, track: 33, axleStubs: 6, tire: 'uhmw-disc', topMph: 15, driveMotor: 'bl80-150', invertible: true,
    weapon: spinner({ style: 'vertical-bar', lb: 35, dia: 26, width: 3, teeth: 2, tooth: 1.5, rpm: rpmAt(180, 26), motor: 'bl80100-130', motors: 1, mountX: 0, mountY: 0 }),
    look: { primary: '#f2f2ee', secondary: '#e2e2de', accent: '#24406b', logo: 'HUGE', features: ['uhmw-wheels', 'axle-stubs'], tireColor: '#f2f2ee' },
  },
  {
    id: 'tantrum', name: 'Tantrum', team: 'Seems Reasonable Robotics',
    L: 30, W: 30, H: 9,
    // squat and wide; the front is split by a channel where the drum carriage slides, cheek pods either side
    bp: {
      outline: [
        [-15, -14], [-9.5, -15], [-9.5, -13.5], [1.5, -13.5], [1.5, -15], [15, -15], [15, -5.5], [4, -5.5],
        [4, 5.5], [15, 5.5], [15, 15], [1.5, 15], [1.5, 13.5], [-9.5, 13.5], [-9.5, 15], [-15, 14],
      ],
      height: 9, clearance: 0.5, front: { at: 7, lip: 1.5, floor: true },
    },
    armor: { front: P('ar500', 10), rear: P('al7075', 8), sides: P('al7075', 8), top: P('al7075', 6), bottom: P('al7075', 5) },
    wheels: 2, wheelDia: 9, wheelWidth: 3, track: 27, axleX: -4, topMph: 15, driveMotor: 'bl80-150', selfRighter: 'arm',
    weapon: spinner({ style: 'drum', lb: 18, dia: 6.5, width: 9, teeth: 2, tooth: 0.7, rpm: 8500, motor: 'bl80100-130', motors: 1, mountX: 11, mountY: -0.5 }),
    secondary: { type: 'slide', distance: 0.16, cycleTime: 0.18, systemMass: 10 },
    look: { primary: '#f26a1e', secondary: '#1a1a1a', accent: '#ffffff', logo: 'TANTRUM', features: ['angry-eyes', 'fists', 'outline-stripes'] },
  },
  {
    id: 'son-of-whyachi', name: 'Son of Whyachi', team: 'Team Whyachi',
    L: 32, W: 32, H: 7, shape: 'wedge', wedge: 4,
    bp: {
      outline: [[-16, -15], [-15, -16], [12, -16], [16, -16], [16, 16], [12, 16], [-15, 16], [-16, 15]],
      height: 7, clearance: 0.5, front: { at: 11, lip: 0.4, floor: true },
    },
    armor: { front: P('ar500', 8), rear: P('al7075', 6), sides: P('al7075', 6), top: P('al7075', 5), bottom: P('al7075', 5) },
    wheels: 4, wheelDia: 6, topMph: 8,
    weapon: spinner({ style: 'horizontal-bar', lb: 120, dia: 60, width: 9, teeth: 3, tooth: 2, rpm: rpmAt(150, 60), motor: 'bl120-70', motors: 2, mountX: 0, mountY: 2.5 }),
    look: { primary: '#b8bcc0', secondary: '#8e9091', accent: '#d11f2b', logo: 'SON OF WHYACHI', features: ['cage-of-death'] },
  },
  {
    id: 'copperhead', name: 'Copperhead', team: 'Caustic Creations',
    L: 26, W: 30, H: 9, shape: 'box',
    bp: {
      outline: [[-12, -9], [5, -10], [14, -10], [18, -9], [14, -8.3], [8, -8.3], [8, 8.3], [14, 8.3], [18, 9], [14, 10], [5, 10], [-12, 9]],
      height: 9, clearance: 0.5, front: { at: 8, lip: 5 }, rear: { at: -9, lip: 5 },
    },
    armor: { front: P('ar500', 10), rear: P('titanium', 8), sides: P('titanium', 8), top: P('titanium', 6), bottom: P('al7075', 5) },
    wheels: 2, wheelDia: 11, wheelWidth: 6, track: 26, axleX: -4, topMph: 15, driveMotor: 'bl80-150', invertible: true,
    weapon: spinner({ style: 'drum', lb: 50, dia: 10, width: 16, teeth: 1, tooth: 1.2, rpm: rpmAt(140, 10), motor: 'bl80100-130', motors: 1, mountX: 13, mountY: 0 }),
    look: { primary: '#c41e2e', secondary: '#8a4a2b', accent: '#e3b53a', logo: 'COPPERHEAD', features: ['snake-scales', 'wide-wheels'] },
  },
  {
    id: 'icewave', name: 'Icewave', team: 'Team Icewave',
    L: 34, W: 34, H: 6, shape: 'wedge', wedge: 7,
    bp: {
      outline: [[-17, -16], [-15, -17], [9, -17], [17, -17], [17, 17], [9, 17], [-15, 17], [-17, 16]],
      height: 6, clearance: 0.5, front: { at: 9, lip: 0.4, floor: true },
    },
    armor: { front: P('ar500', 8), rear: P('al7075', 6), sides: P('al7075', 6), top: P('polycarb', 6), bottom: P('al7075', 5) },
    wheels: 4, wheelDia: 5, topMph: 11,
    weapon: spinner({ style: 'horizontal-bar', lb: 47, dia: 54, width: 1.5, teeth: 2, tooth: 1.5, rpm: rpmAt(200, 54), motor: 'ice-engine', mountX: 2, mountY: 6.5 }),
    look: { primary: '#a9abae', secondary: '#1f3570', accent: '#e7a62c', logo: 'ICEWAVE', features: ['engine-housing', 'clear-top', 'exhaust'] },
  },
  {
    id: 'duck', name: 'DUCK!', team: 'Team Black and Blue',
    L: 34, W: 30, H: 7, shape: 'wedge', wedge: 7,
    armor: { front: P('ar500', 14), rear: P('ar500', 8), sides: P('ar500', 10), top: P('ar500', 6), bottom: P('ar500', 5) },
    wheels: 4, wheelDia: 7.5, wheelWidth: 3, topMph: 13, driveMotor: 'bl80-150', invertible: true,
    weapon: { type: 'flipper', style: 'lifter', actuator: 'electric', energy: 4200, plateLength: 0.45, plateWidth: 0.35, shots: Infinity, cooldown: 0.7, systemMass: 16 },
    look: { primary: '#ececE8', secondary: '#d8d8d4', accent: '#f26b21', logo: 'DUCK!', features: ['beak', 'bolt-grid', 'duck-face'] },
  },
  {
    id: 'bloodsport', name: 'Bloodsport', team: "Bots 'n' Stuff Robotics",
    L: 26, W: 26, H: 6, shape: 'box',
    bp: {
      outline: [[-13, -11], [-11, -13], [-10, -13], [-10, -10.5], [-4, -10.5], [-4, -13], [4, -13], [4, -10.5], [10, -10.5], [10, -13], [11, -13], [13, -11],
        [13, 11], [11, 13], [10, 13], [10, 10.5], [4, 10.5], [4, 13], [-4, 13], [-4, 10.5], [-10, 10.5], [-10, 13], [-11, 13], [-13, 11]],
      height: 6, clearance: 0.5,
    },
    armor: { front: P('ar500', 10), rear: P('al7075', 8), sides: P('al7075', 8), top: P('ar500', 6), bottom: P('al7075', 5) },
    track: 23, wheels: 4, wheelDia: 5, topMph: 14, forks: true, selfRighter: 'torque',
    weapon: spinner({ style: 'horizontal-bar', lb: 72, dia: 47, width: 2, teeth: 2, tooth: 1.5, rpm: rpmAt(250, 47), motor: 'bl120-70', motors: 2, mountX: 0, mountY: 7 }),
    look: { primary: '#1a1a1a', secondary: '#141414', accent: '#d7191f', logo: 'BLOODSPORT', features: ['head-eyes', 'blood-splatter', 'righting-pole', 'accent-forks'], tireColor: '#a01418' },
  },
  {
    id: 'beta', name: 'Beta', team: 'Team Hurtz',
    L: 34, W: 32, H: 9, shape: 'wedge', wedge: 7,
    armor: { front: P('ar500', 10), rear: P('ar500', 6), sides: P('ar500', 8), top: P('polycarb', 6), bottom: P('al7075', 5) },
    wheels: 4, wheelDia: 6, topMph: 12,
    weapon: { type: 'hammer', style: 'hammer', headMass: 16 * LB, armLength: 34 * IN, energy: 7000, swingTime: 0.2, cooldown: 1.6, systemMass: 22 },
    look: { primary: '#5a5a55', secondary: '#45453f', accent: '#e8692a', logo: 'BETA', features: ['truss-arm', 'raw-steel', 'clear-panels'] },
  },
  {
    id: 'quantum', name: 'Quantum', team: 'Team Robo Challenge',
    L: 38, W: 30, H: 9, shape: 'wedge', wedge: 8,
    armor: { front: P('hardox', 10), rear: P('al7075', 6), sides: P('al7075', 8), top: P('titanium', 6), bottom: P('al7075', 5) },
    wheels: 4, wheelDia: 6, topMph: 12, selfRighter: 'arm',
    weapon: { type: 'crusher', force: 155000, reach: 0.42, cycleTime: 0.45, systemMass: 30 },
    look: { primary: '#1f4fa3', secondary: '#2b2b2e', accent: '#c9cdd2', logo: 'QUANTUM', features: ['skull-head', 'fangs'] },
  },
  {
    id: 'rotator', name: 'ROTATOR', team: 'Team Revolution',
    L: 32, W: 30, H: 6, shape: 'wedge', wedge: 5,
    bp: {
      outline: [[-16, -12], [-3, -14], [12, -7], [16, -3], [16, 3], [12, 7], [-3, 14], [-16, 12]],
      height: 6, clearance: 0.5, front: { at: 5, lip: 1.5, floor: true },
    },
    armor: { front: P('ar500', 8), rear: P('al7075', 6), sides: P('al7075', 8), top: P('al7075', 5), bottom: P('al7075', 5) },
    wheels: 2, wheelDia: 10, wheelWidth: 3.5, track: 30, axleX: -8, tire: 'pneumatic-foam', topMph: 15, driveMotor: 'bl80-150', invertible: true,
    weapon: spinner({ style: 'undercutter', lb: 30, dia: 30, width: 1.25, teeth: 2, tooth: 1.4, rpm: rpmAt(245, 30), motor: 'bl80100-130', motors: 1, mountX: 10, mountY: -2.2 }),
    look: { primary: '#151515', secondary: '#1f1f1f', accent: '#d4af37', logo: 'ROTATOR', features: ['gold-stripe', 'gold-plow', 'orange-leds'] },
  },
  {
    id: 'valkyrie', name: 'Valkyrie', team: 'Team VALKYRIE',
    L: 30, W: 32, H: 6, shape: 'wedge', wedge: 6, noseTaper: 0.3,
    bp: {
      outline: [[16, 0], [-10, -16], [-14, -16], [-14, -10], [-7, -4], [-7, 4], [-14, 10], [-14, 16], [-10, 16]],
      height: 6, clearance: 0.5, front: { at: -2, lip: 1, floor: true },
    },
    armor: { front: P('ar500', 8), rear: P('al7075', 6), sides: P('al7075', 8), top: P('al7075', 5), bottom: P('al7075', 5) },
    wheels: 2, wheelDia: 9, wheelWidth: 3, track: 33, axleX: -9, topMph: 15, driveMotor: 'bl80-150', invertible: true,
    weapon: spinner({ style: 'undercutter', lb: 65, dia: 36, width: 1, teeth: 1, tooth: 2, rpm: rpmAt(220, 36), motor: 'bl120-70', motors: 1, mountX: 8, mountY: -2.2 }),
    look: { primary: '#1e2a6e', secondary: '#141c4a', accent: '#e6e8ec', logo: 'VALKYRIE', features: ['chevron', 'blue-eyes', 'bolt-rows'] },
  },
  {
    id: 'cobalt', name: 'Cobalt', team: 'Robotic Death Company',
    L: 32, W: 30, H: 10, shape: 'wedge', wedge: 8,
    bp: {
      outline: [[-16, -15], [10, -15], [16, -12], [16, -2], [6, -2], [6, 2], [16, 2], [16, 12], [10, 15], [-16, 15]],
      height: 10, clearance: 0.5, front: { at: 0, lip: 0.4, floor: true }, rear: { at: -11, lip: 2, floor: true },
    },
    armor: { front: P('ar500', 10), rear: P('al7075', 8), sides: P('ar500', 8), top: P('al7075', 6), bottom: P('al7075', 5) },
    wheels: 4, wheelDia: 6, topMph: 14, forks: true, selfRighter: 'torque',
    weapon: spinner({ style: 'vertical-disk', lb: 45, dia: 19, width: 1.75, teeth: 3, tooth: 1.2, rpm: rpmAt(225, 19), motor: 'bl80100-130', motors: 2, mountX: 13, mountY: 2 }),
    look: { primary: '#0e0e0e', secondary: '#151515', accent: '#3ddc3a', logo: 'COBALT', features: ['green-teeth', 'green-forks', 'speed-lines'] },
  },
  {
    id: 'gigabyte', name: 'Gigabyte', team: 'Robotic Death Company',
    L: 46, W: 46, H: 10, clear: 0.6, shape: 'ring',
    armor: { front: P('al7075', 3), rear: P('al7075', 3), sides: P('al7075', 3), top: P('al7075', 3), bottom: P('al7075', 3) },
    wheels: 2, wheelDia: 7, track: 18, topMph: 12, selfRighter: 'pole', packs: 1, ah: 8,
    weapon: spinner({ style: 'shell', lb: 120, dia: 47, width: 9, teeth: 2, tooth: 1.5, rpm: rpmAt(170, 47), motor: 'bl160-50', motors: 1, mountX: 0, mountY: 0, material: 'ar500' }),
    look: { primary: '#111111', secondary: '#9a9ea3', accent: '#ff7a1a', logo: 'GIGABYTE', features: ['flames', 'wear-plates', 'pole'] },
  },
];

export const ROSTER: BotDesign[] = SPECS.map(build);
export const rosterById = (id: string) => ROSTER.find((b) => b.id === id);
